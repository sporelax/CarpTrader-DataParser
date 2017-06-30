import Avanza from 'avanza'
import dotenv from 'dotenv';
dotenv.config()
const avanza = new Avanza()
const readline = require('readline');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();;
const cheerio = require('cheerio')
const rp = require('request-promise');

const db_overview = new sqlite3.Database('./databases/omxs_overview.db');
const stockList = ['./stocklists/nasdaq_stockholm.txt',
    './stocklists/nasdaq_firstnorth.txt',
    './stocklists/ngm.txt',
    './stocklists/aktietorget.txt'];
const logFile = "./info.log";

const debugLevel = process.env.DEBUGLEVEL || 2;
const fullDate = new Date();
const startTime = Date.now();
var date = fullDate.toJSON().slice(0,-14); //YEAR-MONTH-DAY
var globalRetryAttempts = 0;
var diffBetweenDbAndList = 0;
var brokerInfo = {};
var arrClosedStockDays=[];

//****** DEBUG FUNCTION CALLS */
//scrapeAvanza(577898,'footway-group-pref');
//parseCheerioData('test');
//fixSplit('FING B', 5468, 3);
//parseSerialized(0,[{'id':5468,'name':'fingerprint-cards-b'},{'id':577898,'name':'footway-group-pref'}]);
//splitScan()
//****** END */


initDbAndCheckMarketStatus()
.then(parseNewListings)
.then(buildStockList)
.then(stockParse)
.then(finalizeBroker)
.then(splitScan)
.then(()=>{
    process.exit(0);
}).catch(err => {logger(0,"Main loop:",err)});


logger(1,'Debuglevel: '+debugLevel);
logger(1,'Press \'q\' to exit.');
readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
process.stdin.on('keypress', (str, key) => {
    logger(1,str);
    if (str == 'q') {
        process.exit(0);
    }
})

/**
 * Exit the script if the stock market is closed today. Otherwise saved all closed days in closedStockDays
 */
function initDbAndCheckMarketStatus() {
    return new Promise((resolve,reject) => {
        db_overview.serialize(function() {
            db_overview.run("CREATE TABLE IF NOT EXISTS dailyStock (date TEXT, id TEXT, marketPlace TEXT, currency TEXT, ticker TEXT, lastPrice NUMERIC, highestPrice NUMERIC, lowestPrice NUMERIC, numberOfOwners NUMERIC, priceChange NUMERIC, totalVolumeTraded NUMERIC, marketCap NUMERIC, volatility NUMERIC, beta NUMERIC, pe NUMERIC, ps NUMERIC, yield NUMERIC, brokerStats TEXT, UNIQUE(date,id))");
            db_overview.run("CREATE TABLE IF NOT EXISTS dailyBroker (date TEXT, broker TEXT, sellValue NUMERIC, buyValue NUMERIC, UNIQUE(date,broker))");
            db_overview.run("CREATE TABLE IF NOT EXISTS marketStatus (date TEXT, market TEXT, status TEXT, UNIQUE(date,market,status))");
            db_overview.run("CREATE TABLE IF NOT EXISTS stockIds (ticker TEXT, id TEXT UNIQUE, name TEXT)");
            db_overview.all("SELECT date FROM marketStatus where market='sweden' and status='closed' COLLATE NOCASE ORDER BY date ASC", (err, rows) => {
                for (var i = 0; i<rows.length; i++){
                    arrClosedStockDays.push(rows[i].date);
                }

                if(arrClosedStockDays.indexOf(date) > -1 && debugLevel <= 1){
                    logger(0,"Stock market is closed today. Exiting.");
                    resolve(process.exit(0));
                }else{
                    logger(1,"Stock market closed days:",arrClosedStockDays);
                    resolve();
                }
            });
        });
    })
}


function parseNewListings() {
    return new Promise((resolve, reject) => {
        logger(1,"Parsing websites for new listings matching todays date.");
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
                reject(err);
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
                        for (var ticker in searchRes[2]) {
                            logger(0, 'Added new listing ' + ticker + ' on market ' + market + ' to file.')
                            if (market == 'aktietorget') {
                                fs.appendFileSync(stockList[3], '\n' + ticker)
                            } else if (market == 'nasdaq_stockholm') {
                                fs.appendFileSync(stockList[0], '\n' + ticker)
                            } else if (market == 'nasdaq_firstnorth') {
                                fs.appendFileSync(stockList[1], '\n' + ticker) //will \n mess up on RPI?
                            }
                        }
                        resolve();
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
*   build list of avanza stock Id numbers from lists of Tickers. 
*   Compare list of Id Numbers to existing list stored in database
*   Overwrite it if change is detected.
*   Modify @stockList in order to change included marketplaces.
*/
function buildStockList() {
    return new Promise((resolve, reject) => {
        var tickerList = [];
        var numOfRequests = 0;
        stockList.forEach((list) => {
            logger(1,"Parsing stocklist: " + list);
            var contents = fs.readFileSync(list, 'utf8');
            contents.split('\n').forEach((ticker) => {
                if(tickerList.indexOf(ticker)){ 
                    tickerList.push(ticker.replace('\r','')); //need split with only \n for RaspPi, and replace \r for windows
                }else{
                    logger(0,"Warn: Stock "+ticker+" seems to be listed on multiple lists.");
                }
            });
        })
        logger(1,"Number of stocks in lists: " + tickerList.length); //should be ~830 for full list
        //Parse avanza if tickerList does not match avaIdFile

        db_overview.all("SELECT ticker FROM stockIds", (err, rows) => {
            for (var i = 0; i<rows.length; i++){
                var idx = tickerList.indexOf(rows[i].ticker);
                if(idx > -1) {
                    tickerList.splice(idx, 1);
                } else {
                    logger(0,"Ticker " + rows[i].ticker + " not found in stock files, removing from database");
                    db_overview.run("DELETE FROM stockIds WHERE (ticker=?)",rows[i].ticker);
                }
            }

            if (tickerList.length != 0) {
                logger(0,"Database doesn\'t match parsed list, adding new stocks to DB:",tickerList);
                avanza.authenticate({
                    username: process.env.AVAUSER,
                    password: process.env.PASSWORD
                }).then(() => {
                    searchStocksSerialize([0, tickerList, {}]).then(newStocks => {
                        db_overview.serialize(function() {
                            logger(2,"Updating stockId database with stock: "+ticker);
                            var stmt = db_overview.prepare("INSERT OR IGNORE INTO stockIds VALUES (?,?,?)");
                            for (var ticker in newStocks) {
                                stmt.run(ticker, newStocks[ticker].id, newStocks[ticker].name);
                            }
                            stmt.finalize();
                            resolve();
                        });
                    })
                });
            } else {
                logger(1,"TickerList matched database, DB update not required.");
                resolve();
            }
        });
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
            return arr[2]; //this resolves the serialized chain
        }
    }
    function handleError(errormsg) {
        if (errormsg.code == 'ECONNRESET' || errormsg.code == 'ETIMEDOUT') {
            logger(0,"SearchStocks: Connection reset or timed out. Retrying...");
            globalRetryAttempts++;
            return searchStocksSerialize(arr);
        } else {
            throw errormsg;
        }
    }

    return searchStocks(arr).then(decide, handleError);
}

/**
 * Asynchronous part of fetching avanza stock ids.
 * @param {*} arr 
 */
function searchStocks(arr) {
    return new Promise((resolve, reject) => {
        var stockName = arr[1][arr[0]];
        avanza.search(stockName).then(searchAnswer => {
            var parsedRes = parseSearchString(stockName, searchAnswer);
            if (parsedRes !== undefined) {
                parsedRes[1] = parsedRes[1].replace(/\s|\.|\&/g, '-').normalize('NFD').replace(/[\u0300-\u036f]/g, "").toLowerCase(); //remove åäö, and replace spaces, dots and & with -
                logger(1,"Found answer(" + arr[0] + "): " + parsedRes[0] + " and " + parsedRes[1] + " for stock " + parsedRes[2]);
                arr[2][parsedRes[2]] = { 'id': parsedRes[0], 'name': parsedRes[1] };
            } else {
                logger(0,"Stock " + stockName + " potentially delisted? No matching stock found on Ava search.");
            }
            resolve(arr);
        }).catch((error) => {
            logger(0,"!Error - Promise rejected at searchStocks for stock " + stockName + " at " + arr[0] + ", error: " + error);
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
        if(answer === undefined){
            return undefined;
        }else if (answer.totalNumberOfHits == 1) {
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
        logger(0,"Name: " + name + ", Answer: " + JSON.stringify(answer)+", error received: ",err);
    }
}

/**
 * Initialize the stock parsing
 */
function stockParse() {
    return new Promise((resolve, reject) => {
        db_overview.all("SELECT ticker, id, name FROM stockIds", (err, rows) => {
            parseSerialized([0, rows])
                .then((nrParsed) => {
                    logger(0,"Reached end of stock list! Parsed " + nrParsed + " stocks with " + globalRetryAttempts + " retries in "+(Date.now() - startTime)/1000+" s.");
                    resolve();
                }).catch((error) => {
                    logger(0,"!parse error:", error)
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
            logger(0,"parseSerialized: Connection reset or timed out. Retrying...");
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
            logger(1,"Found data for stock (" + (idx + 1) + "/" + idxAndRows[1].length + "): " + data.ticker + ", id: " + stock.id);

            if (data === undefined){
                logger(0,"Found no data for stock: "+stock.name+" with id: "+stock.id);
                reject();
            }

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

            if (debugLevel <= 1) {
                db_overview.run("INSERT OR REPLACE INTO dailyStock VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", insert_values);
            }
            resolve(idxAndRows);
        }).catch((msg) => {
            logger(0,"!Error: Promise rejected for stock " + stock.ticker + ", error: " + msg)
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
    if (debugLevel >= 2) {
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

    logger(2,JSON.stringify(dbRow));
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
            logger(2,JSON.stringify(brokerInfo));
            for (var broker in brokerInfo) {
                if (debugLevel>=1) { //only run db transaction on debug lvl 0 but dont log until debug lvl 2.
                    logger(2,"Date: "+date+", "+broker+", "+brokerInfo[broker].sellValue+", "+brokerInfo[broker].buyValue);
                } else {
                    stmt.run(date, broker, brokerInfo[broker].sellValue, brokerInfo[broker].buyValue);
                }
            }
            resolve(stmt.finalize());
        })
    })
}

/**
 * Go through todays data and find out if any stocks have been splitted since yesterday.
 * We find this by comparing yesterdays closing price with todays closing price and the reported change in SEK.
 */
function splitScan() {
    return new Promise((resolve, reject) => {
        logger(1,"Scanning for potential splits")

        var tmpDate = new Date();
        var foundDay = false;

        if(tmpDate.getUTCHours() > 0 && tmpDate.getUTCHours() < 7){
            logger(0,"Skipping splitScan, swedish stock market not yet open.")
            resolve();
        }

        while( !foundDay ){
            //Move back one day at a time, and return true once day != saturday/sunday/closed
            tmpDate.setTime(tmpDate.getTime() - 86400000);
            if(tmpDate.getDay() != 0 && tmpDate.getDay() != 6 && arrClosedStockDays.indexOf(tmpDate.toJSON().slice(0, -14)) == -1 ) {
                foundDay = true;
            }
        }
        var yesterStockDay = tmpDate.toJSON().slice(0, -14);

        db_overview.all("SELECT ticker FROM stockIds", (err, tickRow) => {
            Promise.all(tickRow.map(function (obj) {
                return new Promise((resolve, reject) => {
                    db_overview.all("SELECT ticker,date,lastPrice,priceChange FROM dailyStock WHERE ticker = ? AND (date = ? OR date = ?)", [obj.ticker, date, yesterStockDay], (err, rows) => {
                        if (rows.length == 2) {
                            if (rows[0].date == yesterStockDay) {
                                if (rows[0].lastPrice + rows[1].priceChange - rows[1].lastPrice > 0.001) { //to account for rounding errors
                                    logger(0,"Something fishy is up, stock " + rows[0].ticker + " might be splitted, Yclose :"+rows[0].lastPrice+", change: "+rows[1].priceChange+", close: "+rows[1].lastPrice+", sum: "+(rows[0].lastPrice + rows[1].priceChange - rows[1].lastPrice));
                                    if (rows[0].lastPrice == 0) {
                                        reject("error caught, lastprice should never be zero for stock ", rows[0].ticker)
                                    } else {
                                        var splitRatio = (rows[1].lastPrice - rows[1].priceChange) / rows[0].lastPrice;
                                        if (splitRatio > 1.3 || splitRatio < 0.7){ //Sometimes avanza gives us the wrong close price. Could be a few % off at most we hope
                                            logger(1,"Ticker: "+rows[0].ticker+" , split ratio: "+splitRatio);
                                            resolve(fixSplit(rows[0].ticker, splitRatio));
                                        }
                                    }
                                }
                            } else {
                                logger(0,"Strange error, first row should always be yesterstockday")
                            }
                        }
                        resolve();
                    });
                });
            })).then(() => {
                resolve();
            });
        });
    });
}

/**
 * Fix split when detected
 * NOT DONE
 */
function fixSplit(ticker, sr) {
    return new Promise((resolve, reject) => {
        db_overview.all("SELECT id,date,lastPrice,highestPrice,lowestPrice,priceChange FROM dailyStock WHERE ticker = ?", ticker, (err, row) => {
            logger(2,"r:", row);
            var stmt = db_overview.prepare("UPDATE dailyStock SET lastPrice=?, highestPrice=?, lowestPrice=?, priceChange=? WHERE ticker=? AND date=?");
            for (var i = 0; i < row.length; i++) {
                if (row && row[i].date != date) {
                    if (debugLevel>=1) { //only run db transaction on debug lvl 0 but dont log until debug lvl 2.
                        logger(2,"Debug fixSplit: "+row[i].lastPrice*sr+", "+row[i].highestPrice*sr+", "+row[i].lowestPrice*sr+", "+row[i].priceChange*sr+", "+row[i].id+", "+row[i].date)
                    } else {
                        stmt.run(row[i].lastPrice*sr, row[i].highestPrice*sr, row[i].lowestPrice*sr, row[i].priceChange*sr, row[i].ticker, row[i].date);
                    }
                }
            }
            resolve();
        });
    });
}

function logger(level,string,optional){
    if(debugLevel > 0 && debugLevel >= level){
        if(optional === undefined){
            console.log((new Date()).toJSON()+" - "+string)
        }else{
            console.log((new Date()).toJSON()+" - "+string,optional)
        }
    } else if (debugLevel == 0 && level == 0) {
        var logStr = '\n'+(new Date()).toJSON()+" - "+string;
        if(optional === undefined){
            fs.appendFileSync(logFile,logStr);
        }else{
            fs.appendFileSync(logFile,logStr+optional.toString);
        }
    }
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