import Avanza from 'avanza'
import dotenv from 'dotenv';
dotenv.config()
const debugMode = false;
const avanza = new Avanza()
const readline = require('readline');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();;
const cheerio = require('cheerio')
var rp = require('request-promise');
const db_intraday = new sqlite3.Database('./databases/omxs_intraday.db');
const db_overview = new sqlite3.Database('./databases/omxs_overview.db');
const stockList = ['./stocklists/nasdaq_stockholm.txt',
    './stocklists/nasdaq_firstnorth.txt',
    './stocklists/ngm.txt',
    './stocklists/aktietorget.txt'];
const avaIdFile = "./stocklists/avanzaJsonIdFile.txt";
const fullDate = new Date();
/*var tmpDate = new Date();
tmpDate.setTime(fullDate.getTime() - (24 * 60 * 60 * 1000) * 5);
var date = tmpDate.toJSON().slice(0, -14); //YEAR-MONTH-DAY
console.log(date);
*/
var date = fullDate.toJSON().slice(0,-14); //YEAR-MONTH-DAY
var globalAvanzaIds = fs.readFileSync(avaIdFile, 'utf8');
var globalRetryAttempts = 0;
var diffBetweenDbAndList = 0;
var brokerInfo = {};
var arrClosedStockDays=[];

//****** DEBUG FUNCTION CALLS */
//storeAvaIdsInDb();
//scrapeAvanza(577898,'footway-group-pref');
//parseCheerioData('test');
//parseSerialized(0,[{'id':5468,'name':'fingerprint-cards-b'},{'id':577898,'name':'footway-group-pref'}]);
//****** END */

checkStockMarketOpen()
.then(parseNewListings)
.then(buildStockList)
.then(storeAvaIdsInDb)
.then(stockParse)
.then(finalizeBroker)
//.then(splitScan)
.catch(err => {console.log("Main:",err)});

console.log('Press \'q\' to exit.');
readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
process.stdin.on('keypress', (str, key) => {
    console.log(str);
    if (str == 'q') {
        process.exit(0);
    }
})

/**
 * Exit the script if the stock market is closed today. Otherwise saved all closed days in closedStockDays
 */
function checkStockMarketOpen() {
    return new Promise((resolve,reject) => {
        db_overview.all("SELECT date FROM marketStatus where market='test' and status='closed' COLLATE NOCASE ORDER BY date ASC", (err, rows) => {
            for (var i = 0; i<rows.length; i++){
                arrClosedStockDays.push(rows[i].date);
            }

            if(arrClosedStockDays.indexOf(date) > -1 ){
                console.log('Stock market closed today. Exiting.');
                resolve(process.exit(0));
            }else{
                resolve();
            }
        });
    })
}

/**
 * Initialize the stock parsing
 */
function stockParse() {
    return new Promise((resolve, reject) => {
        db_overview.run("CREATE TABLE IF NOT EXISTS dailyStock (date TEXT, id TEXT, marketPlace TEXT, currency TEXT, ticker TEXT, lastPrice NUMERIC, highestPrice NUMERIC, lowestPrice NUMERIC, numberOfOwners NUMERIC, priceChange NUMERIC, totalVolumeTraded NUMERIC, marketCap NUMERIC, volatility NUMERIC, beta NUMERIC, pe NUMERIC, ps NUMERIC, yield NUMERIC, brokerStats TEXT, UNIQUE(date,id))");
        db_overview.run("CREATE TABLE IF NOT EXISTS dailyBroker (date TEXT, broker TEXT, sellValue NUMERIC, buyValue NUMERIC, UNIQUE(date,broker))");
        db_overview.run("CREATE TABLE IF NOT EXISTS marketStatus (date TEXT, market TEXT, status TEXT, UNIQUE(date,market,status))");
        db_overview.all("SELECT ticker, id, name FROM stockIds", (err, rows) => {
            parseSerialized([0, rows])
                .then((nrParsed) => {
                    console.log((new Date()).toJSON()+" - Reached end of stock list! Parsed " + nrParsed + " stocks with " + globalRetryAttempts + " retries.");
                    resolve();
                }).catch((error) => {
                    console.log((new Date()).toJSON()+" - !parse error:", error)
                });
        });
    });
}

/**
 * Serialized part of the webscrape/stock parse. We do it serialized or we receive hundreds of timeouts
 * @param {*} idxAndRows 
 */
function parseSerialized(idxAndRows) {
    function decide(idxAndRows) {
        idxAndRows[0]++;
        if (idxAndRows[0] < idxAndRows[1].length) {
            return parseSerialized(idxAndRows);
        } else {
            return idxAndRows[0]; //this resolves the serialized chain
        }
    }

    function handleError(errormsg) {
        if (errormsg.error.code == 'ECONNRESET' || errormsg.error.code == 'ETIMEDOUT') {
            console.log((new Date()).toJSON()+" - Connection reset or timed out. Retrying...");
            globalRetryAttempts++;
            return parseSerialized(idxAndRows);
        } else {
            throw errormsg;
        }
    }

    return parseAsync(idxAndRows).then(decide, handleError);
}

/**
 * Async part of the web scraping / stock parsing
 * @param {*} idxAndRows 
 */
function parseAsync(idxAndRows) {
    return new Promise((resolve, reject) => {
        var idx = idxAndRows[0];
        var stock = idxAndRows[1][idx];
        var strAvaPage = 'https://www.avanza.se/aktier/om-aktien.html/' + stock.id + '/' + stock.name;
        rp(strAvaPage).then(htmlString => {
            return parseCheerioData(htmlString)
        }).then(data => {
            return prepareBroker(data)
        }).then(data => {
            console.log((new Date()).toJSON()+" - Found data for stock (" + (idx + 1) + "/" + idxAndRows[1].length + "): " + data.ticker + ", id: " + stock.id);
            //If time before 9, set date to prev day? 
            //If market = not open this day, dont store?

            var insert_values = [date];
            insert_values.push(stock.id);
            insert_values.push(data.marketPlace);
            insert_values.push(data.currency);
            insert_values.push(data.ticker);
            insert_values.push(data.lastPrice);
            insert_values.push(data.highestPrice);
            insert_values.push(data.lowestPrice);
            insert_values.push(data.numberOfOwners);
            insert_values.push(data.change);
            insert_values.push(data.totalVolumeTraded);
            insert_values.push(data.marketCapital);
            insert_values.push(data.volatility);
            insert_values.push(data.beta);
            insert_values.push(data.pe);
            insert_values.push(data.ps);
            insert_values.push(data.yield);
            insert_values.push(data.brokerStat);

            if (!debugMode) {
                db_overview.run("INSERT OR REPLACE INTO dailyStock VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", insert_values);
            }
            resolve(idxAndRows);
        }).catch((msg) => {
            console.log((new Date()).toJSON()+" - !Error: Promise rejected for stock " + stock.ticker + ", error: " + msg)
            reject(msg);
        });
    });
}

/**
 * Parse avanza html content to find the data we need
 * @param {*} content 
 */
function parseCheerioData(content) {
    const $ = cheerio.load(content);
    if (debugMode) {
        fs.writeFileSync('./testFile', content, 'utf-8');
    }

    var dbRow = {};
    var brokerStat = {};
    //Get broker statisticss
    $('.tRight.tableV2.solidRows.solidThickEnding.colorOddRows.shortened.tablesorter.tablesorterIcons').find('tbody').each(function () {
        var $tbody = $(this);
        $tbody.find('tr').each(function () {
            var brokerName = $(this).children('.tLeft').children('.tipTrigger').text();
            var buyPrice = $(this).children().eq(1).text().replace(/\s+/g, '').replace(',', '.');
            var buyVolume = $(this).children().eq(2).text().replace(/\s+/g, '');
            var sellVolume = $(this).children().eq(3).text().replace(/\s+/g, '');
            var sellPrice = $(this).children().eq(4).text().replace(/\s+/g, '').replace(',', '.');
            var netVolume = $(this).children('.last').text().replace(/\s+/g, '');
            var netPrice = 0;
            if (sellVolume == 0) {
                netPrice = buyPrice;
            } else if (buyVolume == 0) {
                netPrice = sellPrice;
            } else {
                //multiply by 1 to convert from string
                netPrice = (buyPrice * buyVolume + sellPrice * sellVolume) / (1 * sellVolume + 1 * buyVolume);
            }
            brokerStat[brokerName] = { 'buyVolume': buyVolume, 'buyPrice': buyPrice, 'sellVolume': sellVolume, 'sellPrice': sellPrice, 'netVolume': netVolume, 'netPrice': netPrice };
        })
    });
    dbRow['brokerStat'] = brokerStat;

    $('.component.quote').find('.content').each(function () {
        var $ul = $(this).find('ul');
        var change = $ul.children('li').eq(2).children('div').children('span').eq(1).text();
        dbRow['change'] = change.replace(/\s*(\+|[A-Za-z])/g, '').replace(',', '.');
        dbRow['lastPrice'] = $ul.children('li').eq(5).children('span').eq(1).children('span').text().replace(/\s+/g, '').replace(',', '.');
        dbRow['highestPrice'] = $ul.children('li').eq(6).children('span').eq(1).text().replace(/\s+/g, '').replace(',', '.');
        dbRow['lowestPrice'] = $ul.children('li').eq(7).children('span').eq(1).text().replace(/\s+/g, '').replace(',', '.');
        dbRow['totalVolumeTraded'] = $ul.children('li').eq(8).children('span').eq(1).text().replace(/\s+/g, '');
    });

    $('.stock_data').find('.content').find('.row').children().eq(0).find('dl').each(function () {
        var $dl = $(this);
        dbRow['ticker'] = $dl.children('dd').eq(0).children('span').text();
        dbRow['marketPlace'] = $dl.children('dd').eq(2).children('span').text().replace(/\s+/g, '');
        dbRow['currency'] = $dl.children('dd').eq(4).children('span').text();
        dbRow['beta'] = $dl.children('dd').eq(5).children('span').text().replace(',', '.');
        dbRow['volatility'] = $dl.children('dd').eq(6).children('span').text().replace(',', '.');
    });

    $('.stock_data').find('.content').find('.row').children().eq(1).find('dl').each(function () {
        var $dl = $(this);
        dbRow['marketCapital'] = $dl.children('dd').eq(1).children('span').text().replace(/\s+/g, '').replace(',', '.');
        dbRow['yield'] = $dl.children('dd').eq(2).children('span').text().replace(',', '.');
        dbRow['pe'] = $dl.children('dd').eq(3).children('span').text().replace(',', '.');
        dbRow['ps'] = $dl.children('dd').eq(4).children('span').text().replace(',', '.');
        dbRow['numberOfOwners'] = $dl.children('dd').eq(11).children('span').text().replace(/\s+/g, '');
    });

    if (debugMode) {
        //console.log(dbRow);
    }

    return dbRow;
}

/**
 * Prepare list of daily broker activites/trades/volumes
 * @param {*} jsonBrokerStats 
 */
function prepareBroker(data) {
    return new Promise((resolve, reject) => {
        var jsonBrokerStats = data.brokerStat;
        for (var broker in jsonBrokerStats) {
            if (broker) {
                var currSell = 0, currBuy = 0, newSell = 0, newBuy = 0, addSell = 0, addBuy = 0;

                if (brokerInfo[broker]) {
                    currBuy = brokerInfo[broker].buyValue;
                    currSell = brokerInfo[broker].sellValue;
                }

                if (jsonBrokerStats[broker].buyPrice != '-') { //to prevent NaN
                    addBuy = jsonBrokerStats[broker].buyVolume * jsonBrokerStats[broker].buyPrice;
                }
                if (jsonBrokerStats[broker].sellPrice != '-') {
                    addSell = jsonBrokerStats[broker].sellVolume * jsonBrokerStats[broker].sellPrice;
                }
                newBuy = currBuy + addBuy;
                newSell = currSell + addSell;

                brokerInfo[broker] = { 'buyValue': newBuy, 'sellValue': newSell };
            }
        }
        resolve(data);
    })
}

/**
 * Store all todays broker transactions in the database
 */
function finalizeBroker() {
    return new Promise((resolve, reject) => {
        db_overview.serialize(() => {
            var stmt = db_overview.prepare("INSERT OR REPLACE INTO dailyBroker VALUES (?,?,?,?)");
            console.log(brokerInfo);
            for (var broker in brokerInfo) {
                if (debugMode) {
                    console.log(date, broker, brokerInfo[broker].sellValue, brokerInfo[broker].buyValue);
                } else {
                    stmt.run(date, broker, brokerInfo[broker].sellValue, brokerInfo[broker].buyValue);
                }
            }
            stmt.finalize().then(() => {
                resolve()
            });
        })
    })
}

/**
 * Go through todays data and find out if any stocks have been splitted since yesterday.
 * We find this by comparing yesterdays closing price with todays closing price and the reported change in SEK.
 */
function splitScan() {
    return new Promise((resolve, reject) => {
        console.log((new Date()).toJSON()+" - Scanning for potential splits")

        var tmpDate = new Date();
        var foundDay = false;
        console.log(arrClosedStockDays);
        while( !foundDay ){
            tmpDate.setTime(tmpDate.getTime() - 86400000);
            if(tmpDate.getDay() != 0 && tmpDate.getDay() != 6 && arrClosedStockDays.indexOf(tmpDate.toJSON().slice(0, -14)) == -1 ) {
                foundDay = true;
            }
        }
        var yesterStockDay = tmpDate.toJSON().slice(0, -14);
        console.log(yesterStockDay);
        reject(process.exit(0))

        db_overview.all("SELECT ticker,id FROM stockIds", (err, rows) => {
            for (var i = 0; i < rows.length; i++) {
                db_overview.all("SELECT ticker,id,date,lastPrice,priceChange FROM dailyStock WHERE ticker = ? AND (date = ? OR date = ?)", [rows[i].ticker, date, yesterStockDay], (err, rows) => {
                    if (rows.length == 2) {
                        if (rows[0].date == yesterStockDay) {
                            //return these to normal once we get a few days worth of data
                            var r00 = rows[0].lastPrice.replace(/,/g, '.');
                            var r01 = rows[0].priceChange.replace(/,/g, '.');
                            var r10 = rows[1].lastPrice.replace(/,/g, '.');
                            var r11 = rows[1].priceChange.replace(/,/g, '.');

                            if (r00 + r01 - r10 != 0) {
                                console.log("Something fishy is up, stock " + rows[0].id + " might be splitted");
                                if (r00 == 0) {
                                    reject("error caught, lastprice should never be zero for stock ", rows[0].id)
                                } else {
                                    var splitRatio = (r10 - r11) / r00;
                                    fixSplit(rows[0].ticker, rows[0].id, splitRatio);
                                }
                            } else {
                                console.log("Check: ", (r00 + r01 - r10));
                            }
                        } else {
                            console.log("Strange error, first row should always be yesterstockday")
                        }
                    } else {
                        //console.log('no two-day data found for stock, ',rows);
                    }
                });
            }
        });
    });
}

/**
 * Fix split when detected
 * NOT DONE
 */
function fixSplit(ticker, id, sr) {
    return new Promise((resolve, reject) => {
        db_overview.all("SELECT id,date,lastPrice,highestPrice,lowestPrice,priceChange FROM dailyStock WHERE ticker = ?", ticker, (err, row) => {
            console.log("r:", row);
            var stmt = db_overview.prepare("UPDATE dailyStock SET (lastPrice, highestPrice, lowestPrice, priceChange) = (?,?,?,?) WHERE id=?, date=?");
            for (var i = 0; i < row.length; i++) {
                if (row && row[i].date != date) {
                    if (debugMode) {
                        console.log(row[i].lastPrice*sr, row[i].highestPrice*sr, row[i].lowestPrice*sr, row[i].priceChange*sr, row[i].id, row[i].date)
                    } else {
                        stmt.run(row[i].lastPrice*sr, row[i].highestPrice*sr, row[i].lowestPrice*sr, row[i].priceChange*sr, row[i].id, row[i].date);
                    }
                }
            }
            console.log("crash on finalize?")
            stmt.finalize().then(() => {
                resolve()
                console.log("safe!")
            });
        });
    });
}

/**
 * Store avanza ids and name in database
 */
function storeAvaIdsInDb() {
    return new Promise((resolve, reject) => {
        //this probably fails sometimes because of no real serialization
        db_overview.serialize(() => {
            db_overview.run("CREATE TABLE IF NOT EXISTS stockIds (ticker TEXT, id TEXT UNIQUE, name TEXT)");
            if (diffBetweenDbAndList || debugMode) {
                console.log((new Date()).toJSON()+" - Updating stockId database");
                var stmt = db_overview.prepare("INSERT OR IGNORE INTO stockIds VALUES (?,?,?)");
                var tickerList = JSON.parse(globalAvanzaIds);
                for (var ticker in tickerList) {
                    if (debugMode) {
                        console.log(ticker, tickerList[ticker].id, tickerList[ticker].name)
                    } else {
                        stmt.run(ticker, tickerList[ticker].id, tickerList[ticker].name);
                    }
                }
                stmt.finalize();
            }
            resolve();
        });
    });
}

/*
*   build list of avanza stock Id numbers from lists of Tickers. 
*   Compare list of Id Numbers to existing list stored in @globalAvanzaIds
*   Overwrite it if change is detected.
*   Modify @stockList in order to change included marketplaces.
*/
function buildStockList() {
    return new Promise((resolve, reject) => {
        var tickerList = [];
        var numOfRequests = 0;
        stockList.forEach((list) => {
            console.log((new Date()).toJSON()+" - Parsing stocklist: " + list);
            var contents = fs.readFileSync(list, 'utf8');
            contents.split('\n').forEach((ticker) => {
                tickerList.push(ticker.replace('\r','')); //need split with only \n for RaspPi, and replace \r for windows
            });
        })
        console.log("Number of stocks in list: " + tickerList.length); //should be ~830 for full list
        //Parse avanza if tickerList does not match avaIdFile
        var tmpTickerList = tickerList.slice();
        var globalTickerList = JSON.parse(globalAvanzaIds);
        for (var key in globalTickerList) {
            var idx = tmpTickerList.indexOf(key);
            if (idx > -1) {
                tmpTickerList.splice(idx, 1);
            } else {
                console.log((new Date()).toJSON()+" - Ticker " + key + " not found in tickerlist. tmpTickerList: " + tmpTickerList.toString());
                diffBetweenDbAndList = 1;
            }
        }

        if (tmpTickerList.length != 0) {
            diffBetweenDbAndList = 1;
            console.log((new Date()).toJSON()+" - Remaining tickers in list: " + tmpTickerList.toString());
        }

        if (diffBetweenDbAndList) {
            console.log((new Date()).toJSON()+" - globalAvanzaIds does not match Stocklist, rebuilding globalAvanzaIds.");
            avanza.authenticate({
                username: process.env.AVAUSER,
                password: process.env.PASSWORD
            }).then(() => {
                resolve(searchStocksSerialize([0, tickerList, {}]));
            });
        } else {
            console.log((new Date()).toJSON()+" - TickerList matched AvaJsonIdObj, DB update not required.");
            resolve();
        }
    });
}

/**
 * Synchronous fetcher of avanza stock ids. Parse results with function parseSearchString
 * @param {*} arr is an array with [current index, stocklist, returnArray]
 */
function searchStocksSerialize(arr) {
    function decide(arr) {
        arr[0]++;
        if (arr[0] < arr[1].length) {
            return searchStocksSerialize(arr);
        } else {
            console.log((new Date()).toJSON()+" - Reached end of stock list! Writing data to file. ");
            fs.writeFileSync(avaIdFile, JSON.stringify(arr[2]));
            globalAvanzaIds = arr[2];
            return 0; //this resolves the serialized chain
        }
    }

    return searchStocks(arr).then(decide, errormsg => { throw errormsg });
}

/**
 * Asynchronous part of fetching avanza stock ids.
 * @param {*} arr 
 */
function searchStocks(arr) {
    return new Promise((resolve, reject) => {
        var stockName = arr[1][arr[0]];
        avanza.search(stockName).then(searchAnswer => {
            if (searchAnswer.totalNumberOfHits != 0) {
                var parsedRes = parseSearchString(stockName, searchAnswer);
                parsedRes[1] = parsedRes[1].replace(/\s|\.|\&/g, '-').normalize('NFD').replace(/[\u0300-\u036f]/g, "").toLowerCase(); //remove åäö, and replace spaces, dots and & with -
                console.log("Found answer(" + arr[0] + "): " + parsedRes[0] + " and " + parsedRes[1] + " for stock " + parsedRes[2]);
                arr[2][parsedRes[2]] = { 'id': parsedRes[0], 'name': parsedRes[1] };
            } else {
                console.log((new Date()).toJSON()+" - Stock " + stockName + " potentially delisted? No matching stock found on Ava search.");
            }
            resolve(arr);
        }).catch((error) => {
            console.log((new Date()).toJSON()+" - !Error - Promise rejected at searchStocks for stock " + stockName + " at " + arr[0] + ", error: " + error);
            reject(error);
        });
    });
}

/**
 * 
 * Parse search response from avanza  
 *  {"totalNumberOfHits":1,"hits":[{"instrumentType":"STOCK","numberOfHits":1,"topHits":[{"lastPrice":644,"changePercent":-1.08,
 * "currency":"SEK","flagCode":"SE","tradable":true,"name":"ABB Ltb","id":"26268","tickerSymbol":"ABB"}]}]}
 */
function parseSearchString(name, answer) {
    var id, name, ticker;
    try {
        if (answer.totalNumberOfHits == 1) {
            id = answer.hits[0].topHits[0].id;
            name = answer.hits[0].topHits[0].name;
            ticker = answer.hits[0].topHits[0].tickerSymbol;
            return [id, name, ticker];
        } else {
            for (var j = 0; j < answer.hits.length; j++) {
                if (answer.hits[j].instrumentType == "STOCK") {
                    for (var k = 0; k < answer.hits[j].numberOfHits; k++) {
                        var tmp_answer = answer.hits[j].topHits[k];
                        if (tmp_answer.tickerSymbol == name || tmp_answer.name == name) {
                            id = tmp_answer.id;
                            name = tmp_answer.name;
                            ticker = tmp_answer.tickerSymbol;
                            return [id, name, ticker];
                        }
                    }
                } 
            }
        }
    } catch (err) {
        console.log((new Date()).toJSON()+" - Name: " + name + ", Answer: " + JSON.stringify(answer));
        console.log((new Date()).toJSON()+" - Error received: ", err);
    }
}

function parseNewListings() {
    return new Promise((resolve, reject) => {
        console.log((new Date()).toJSON()+" - Parsing websites for new listings matching todays date.");
        var objAvaListings = {};
        parseListingWebsite('http://www.nasdaqomxnordic.com/nyheter/noteringar/main-market/2017')
            .then(newListings => {
                return handleListingResults(newListings, 'nasdaq_stockholm')
            }).then(() => {
                return parseListingWebsite('http://www.nasdaqomxnordic.com/nyheter/noteringar/firstnorth/2017');
            }).then(newListings => {
                return handleListingResults(newListings, 'nasdaq_firstnorth')
            }).then(() => {
                return parseListingWebsite('https://www.aktietorget.se/QuoteStatistics.aspx?Year=2017&Type=1');
            }).then(newListings => {
                return handleListingResults(newListings, 'aktietorget')
            }).then(() => {
                resolve();
            }).catch(err =>{
                console.log(err)
                reject();
            });
    });
}

function handleListingResults(newListings, market) {
    return new Promise((resolve, reject) => {
        avanza.authenticate({
            username: process.env.AVAUSER,
            password: process.env.PASSWORD
        }).then(() => {
            return Promise.all(newListings.map(function (listing) {
                return new Promise((resolve, reject) => {
                    searchStocks([0, [listing.name], {}])
                    .then(searchRes => {
                        var tickerList = JSON.parse(globalAvanzaIds);
                        for (var ticker in searchRes[2]){
                            if (!tickerList[ticker]) { //not already listed on another market
                                console.log('Added new listing ' +ticker+ ' on market '+market+' to file.')
                                if(market == 'aktietorget'){
                                    fs.appendFileSync(stockList[3],'\n'+ticker)
                                }else if(market == 'nasdaq_stockholm'){
                                    fs.appendFileSync(stockList[0],'\n'+ticker)
                                }else if(market == 'nasdaq_firstnorth'){
                                    fs.appendFileSync(stockList[1],'\n'+ticker) //will \n mess up on RPI?
                                }
                                resolve();
                            }else{
                                console.log('Skipped new listing ' +ticker+ '. It\'s already listed on another market.')
                                resolve();
                            }
                        }
                    })
                });
            }));
        }).then(resultArr => resolve(resultArr) );
    })
}

function parseListingWebsite(website) {
    return new Promise((resolve, reject) => {
        rp(website).then(htmlString => {
            const $ = cheerio.load(htmlString);
            var newListings = [];

            if(website.match(/nasdaq/i) ){
                $('.nordic-right-content-area').children('article').each(function () {
                    var headerText = $(this).children('header').children('h3').text();
                    if (headerText.match(/listings 2017/i)) {
                        $(this).children('div').children('p').each(function () {
                            var $p = $(this)
                            var stock = {};
                            var locAndDate = $p.children('b').text().split(',');
                            var tmpDate = new Date(Date.parse('2017' + locAndDate[1] + ' GMT')); //GMT or we get wrong date
                            var listDate = tmpDate.toJSON().slice(0, -14);
                            if (locAndDate[0] == 'Stockholm' && listDate == date) {
                                stock['date'] = listDate;
                                stock['name'] = $p.children('a').text()
                                newListings.push(stock)
                            }
                        });
                    }
                })
            } else if(website.match(/aktietorget/i)) {
                $('#ctl00_ctl00_MasterContentBody_InvestorMasterContentBody_tblStatistic').children('tbody').children('tr').each(function () {
                    var $tr = $(this)
                    var stock = {};
                    stock['name'] = $tr.children('td').eq(0).text();
                    if (stock['name'] ) {
                        var listDate = new Date(Date.parse($tr.children('td').eq(1).text()  + ' 12:00')); //12:00 here or we get wrong date due to timezone
                        stock['date'] = listDate.toJSON().slice(0, -14);
                        if(stock['date'] == date){
                            newListings.push(stock)
                        }
                    }
                })
            }

            resolve(newListings);
        })
    });
}

/* 
    Reference data

Avanza getTrade:
{ 
    buyer: { ticker: 'SHB', name: 'Svenska Handelsbanken AB' },
    seller: { ticker: 'NON', name: 'NORDNET BANK AB' },
    cancelled: false,
    dealTime: 1495105636000,
    matchedOnMarket: true,
    instrumentId: '5479',
    price: 38.08,
    volume: 1000,
    volumeWeightedAveragePrice: undefined 
}

Avanza getQuote:
{ 
    change: -0.47,
    changePercent: -1.22,
    closingPrice: 38.55,
    highestPrice: 38.59,
    lastPrice: 38.08,
    lastUpdated: 1495105636000,
    lowestPrice: 38.04,
    instrumentId: '5479',
    totalValueTraded: 230743532.47,
    totalVolumeTraded: 6017413,
    updated: 1495105636000 
}
Avanza getStock:
{ 
    id: '5479',
    marketPlace: 'Stockholmsbörsen',
    marketList: 'Large Cap Stockholm',
    currency: 'SEK',
    name: 'Telia Company',
    country: 'Sverige',
    lastPrice: 38.46,
    totalValueTraded: 419759924.65,
    numberOfOwners: 33498,
    shortSellable: true,
    tradable: true,
    lastPriceUpdated: 1495207775000,
    changePercent: 0.5,
    change: 0.19,
    ticker: 'TELIA',
    totalVolumeTraded: 10937679,
    company:
    { marketCapital: 165712344568,
        chairman: 'Marie Ehrling',
        description: 'Telia Company är ett telekombolag som erbjuder nätanslutning och telekommunikationstjänster. Telia Company finns i de nordiska och baltiska länderna, Spanien,
    Azerbajdzjan, Georgien, Kazastan, Moldavien, Nepal, Ryssland, Tadzjistan, Turkiet och Uzbekistan. Tjänsterna marknadsförs under varumärken som Telia, Sonera, Halebop och NetCom
    . Den svenska marknaden svarar för 36% av omsättningen, och övriga Europa för 39%.',
        name: 'Telia Company',
        ceo: 'Johan Dennelind' },
    volatility: 14.9,
    pe: 23.39,
    yield: 5.61 
}
Avanza search result (ABB):
{"totalNumberOfHits":634,"hits":[
{"instrumentType":"STOCK","numberOfHits":4,"topHits":[{"lastPrice":219.8,"changePercent":-0.63,"currency":"SEK","flagCode":"SE","tra
dable":true,"name":"ABB Ltd","id":"5447","tickerSymbol":"ABB"},{"lastPrice":25.19,"changePercent":0.56,"currency":"USD","flagCode":"US","tradable":true,"name":"ABB L
td","id":"3889","tickerSymbol":"ABB"},{"lastPrice":71.35,"changePercent":0.18,"currency":"USD","flagCode":"US","tradable":true,"name":"AbbVie Inc","id":"390389","tic
kerSymbol":"ABBV"},{"lastPrice":48.59,"changePercent":-0.39,"currency":"USD","flagCode":"US","tradable":true,"name":"Abbott Laboratories","id":"4206","tickerSymbol":
"ABT"}]},
{"instrumentType":"FUTURE_FORWARD","numberOfHits":7,"topHits":[{"changePercent":0,"currency":"SEK","flagCode":"SE","tradable":true,"name":"ABB8X","id":"7137
45","tickerSymbol":"ABB8X"},{"changePercent":0,"currency":"SEK","flagCode":"SE","tradable":true,"name":"ABB7X","id":"617023","tickerSymbol":"ABB7X"},{"changePercent"
:0,"currency":"SEK","flagCode":"SE","tradable":true,"name":"ABB8R","id":"761022","tickerSymbol":"ABB8R"},{"changePercent":0,"currency":"SEK","flagCode":"SE","tradabl
e":true,"name":"ABB7U","id":"690460","tickerSymbol":"ABB7U"},{"changePercent":0,"currency":"SEK","flagCode":"SE","tradable":true,"name":"ABB7T","id":"754049","ticker
Symbol":"ABB7T"},{"changePercent":0,"currency":"SEK","flagCode":"SE","tradable":true,"name":"ABB7S","id":"745295","tickerSymbol":"ABB7S"}]},
{"instrumentType":"CERTIFICATE","numberOfHits":22},
{"instrumentType":"WARRANT","numberOfHits":255},
{"instrumentType":"OPTION","numberOfHits":346}
]}

{"totalNumberOfHits":1,"hits":[{"instrumentType":"STOCK","numberOfHits":1,"topHits":[{"lastPrice":644,"changePercent":-1.08,"currency":"SEK","flagCode":"SE","tradabl
e":true,"name":"AAK","id":"26268","tickerSymbol":"AAK"}]}]}

*/