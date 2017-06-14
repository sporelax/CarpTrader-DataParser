import Avanza from 'avanza'
import dotenv from 'dotenv';
dotenv.config()
const avanza = new Avanza()
const readline = require('readline');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const phantom = require('phantom');
const cheerio = require('cheerio')
var request = require('request');
const db_intraday = new sqlite3.Database('./databases/omxs_intraday.db');
const db_overview = new sqlite3.Database('./databases/omxs_overview.db');
const stockList = ['./stocklists/nasdaq_stockholm.txt', 
                        './stocklists/nasdaq_firstnorth.txt',
                        './stocklists/ngm.txt',
                        './stocklists/aktietorget.txt'];
const avaIdFile = "./stocklists/avanzaJsonIdFile.txt";
var avaIdsJsonObj = fs.readFileSync(avaIdFile,'utf8');
var diffBetweenDbAndList = 0;
const date = new Date();    

const psw = process.env.PASSWORD;
const user = process.env.USER;

//****** DEBUG FUNCTION CALLS */
//storeAvaIdsInDb();
//scrapeAvanzaPhantom(577898);
//parseCheerioData('test');
//dailyStockParseSerializeCalls(0,[{'id':5468,'name':'fingerprint-cards-b'},{'id':577898,'name':'footway-group-pref'}]);
//****** END */

//generateAvanzaStockIdList();  //rewrite to promise so we can serialize. also change name..
//dailyStockParse();
testRequest();

console.log('Press \'q\' to exit.');
readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
process.stdin.on('keypress', (str, key) => {
    console.log(str);
    if(str == 'q'){
         process.exit(0);
    }
})

function dailyStockParse(){
    db_overview.run("CREATE TABLE IF NOT EXISTS dailyStock (date TEXT, id TEXT, marketPlace TEXT, currency TEXT, ticker TEXT, lastPrice NUMERIC, highestPrice NUMERIC, lowestPrice NUMERIC, numberOfOwners NUMERIC, priceChange NUMERIC, totalVolumeTraded NUMERIC, marketCap NUMERIC, volatility NUMERIC, beta NUMERIC, pe NUMERIC, ps NUMERIC, yield NUMERIC, brokerStats TEXT, UNIQUE(date,id))");
    db_overview.run("CREATE TABLE IF NOT EXISTS dailyBroker (date TEXT, broker TEXT, sellValue NUMERIC, buyValue NUMERIC, UNIQUE(date,broker))");
    db_overview.all("SELECT ticker, id, name FROM stockIds", (err,rows) => {
        dailyStockParseSerializeCalls(0,rows)
    });
}

function dailyStockParseSerializeCalls(idx,stockList){ 
    if(idx<stockList.length){
            scrapeAvanzaPhantom(stockList[idx].id,stockList[idx].name).then(data => {
                console.log("found data for stock ("+(idx+1)+"/"+stockList.length+"): "+data.ticker);
                var date_str = date.toJSON().slice(0,-14); //YEAR-MONTH-DAY. // make date-formatting function?
                //If time before 9, set date to prev day? 
                //If market = not open this day, dont store?
                
                var insert_values = [date_str];
                insert_values.push(data.id);
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
                
                db_overview.run("INSERT OR REPLACE INTO dailyStock VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", insert_values);

                updateDailyBroker(date_str, data.brokerStat);
                dailyStockParseSerializeCalls(idx+1,stockList);
            }).catch((error) => {
                console.log("Promise rejected for stock "+stockList.ticker+", error: "+error);
            });
    } else {
        console.log("Reached end of stock list! Parsed "+idx+" stocks.");
    }  
}


function scrapeAvanzaPhantom(id,name){
    return new Promise((resolve, reject) => {
        var strAvaPage = 'https://www.avanza.se/aktier/om-aktien.html/'+id+'/'+name;
        var phInstance = null;

        phantom.create([],{logLevel: 'error'}).then(instance => {
            phInstance = instance;
            return instance.createPage();
        }).then(page => {
            page.open(strAvaPage).then(status => {
                //status = fail/success?
                return page.property('content');
            }).then(content => {
                phInstance.exit().then(() => {
                    resolve(parseCheerioData(content))
                })
            }).catch(error => {
                phInstance.exit().then(() => {
                    reject(error)
                })
            });
        }).catch(error => {
            phInstance.exit().then(() => {
                reject(error)
            })
        });
    })
}

function testRequest(){
    var strAvaPage = 'https://www.avanza.se/aktier/om-aktien.html/5468/fingerprint-cards-b';
    request(strAvaPage, function(error, response, html){
        var dbrow = parseCheerioData(html);
        console.log(dbrow);
    })
}

/**
 * Parse avanza html content to find the data we need. Content fetched from phantom js scraper
 * @param {*} content 
 */
function parseCheerioData(content){
    const $ = cheerio.load(content);
    fs.writeFileSync('./testFile2',content,'utf-8');

    var dbRow = {};
    var brokerStat = {};
    //Get broker statisticss
    $('.tRight.tableV2.solidRows.solidThickEnding.colorOddRows.shortened.tablesorter.tablesorterIcons.avanzabank_tablesorter').find('tbody').each(function() {
        var $tbody = $(this);
        $tbody.find('tr').each(function(){
            var brokerName = $(this).children('.tLeft').children('.tipTrigger').text();
            var buyPrice = $(this).children().eq(1).text().replace(/\s+/g, '').replace(',','.');
            var buyVolume = $(this).children().eq(2).text().replace(/\s+/g, '');
            var sellVolume = $(this).children().eq(3).text().replace(/\s+/g, '');
            var sellPrice = $(this).children().eq(4).text().replace(/\s+/g, '').replace(',','.');
            var netVolume = $(this).children('.last').text().replace(/\s+/g, '');
            var netPrice = 0;
            if (sellVolume == 0) {
                netPrice = buyPrice;
            }else if(buyVolume == 0){
                netPrice = sellPrice;
            }else{
                //multiply by 1 to convert from string
                netPrice = (buyPrice*buyVolume+sellPrice*sellVolume)/(1*sellVolume+1*buyVolume);
            }
            brokerStat[brokerName] = {'buyVolume': buyVolume, 'buyPrice': buyPrice, 'sellVolume': sellVolume, 'sellPrice': sellPrice, 'netVolume': netVolume, 'netPrice': netPrice};
        })
    });
    dbRow['brokerStat'] = brokerStat;

     $('.component.quote.avanzabank_quote.avanzabank_rowpush').find('.content').each(function() {
        var $ul = $(this).find('ul');
        var change = $ul.children('li').eq(2).children('div').children('span').eq(1).text();
        dbRow['change'] = change.replace(/\s*(\+|[A-Za-z])/g, '');
        dbRow['lastPrice'] = $ul.children('li').eq(5).children('span').eq(1).children('span').text().replace(/\s+/g, '');
        dbRow['highestPrice'] = $ul.children('li').eq(6).children('span').eq(1).text().replace(/\s+/g, '');
        dbRow['lowestPrice'] = $ul.children('li').eq(7).children('span').eq(1).text().replace(/\s+/g, '');
        dbRow['totalVolumeTraded'] = $ul.children('li').eq(8).children('span').eq(1).text().replace(/\s+/g, '');
    });

    $('.stock_data').find('.content').find('.row').children().eq(0).find('dl').each(function() {
        var $dl = $(this);
        dbRow['ticker'] = $dl.children('dd').eq(0).children('span').text();
        dbRow['marketPlace'] = $dl.children('dd').eq(2).children('span').text().replace(/\s+/g, '');
        dbRow['currency'] = $dl.children('dd').eq(4).children('span').text();
        dbRow['beta'] = $dl.children('dd').eq(5).children('span').text();
        dbRow['volatility'] = $dl.children('dd').eq(6).children('span').text();
    });
  
    $('.stock_data').find('.content').find('.row').children().eq(1).find('dl').each(function() {
        var $dl = $(this);
        dbRow['marketCapital'] = $dl.children('dd').eq(1).children('span').text().replace(/\s+/g, '');
        dbRow['yield'] = $dl.children('dd').eq(2).children('span').text();
        dbRow['pe'] = $dl.children('dd').eq(3).children('span').text();
        dbRow['ps'] = $dl.children('dd').eq(4).children('span').text();
        dbRow['numberOfOwners'] = $dl.children('dd').eq(11).children('span').text().replace(/\s+/g, '');
    });
    return dbRow;
}

/**
 * Generate list of daily broker activites/trades/volumes
 * @param {*} date 
 * @param {*} jsonBrokerStats 
 */
function updateDailyBroker(date, jsonBrokerStats){
    for (var broker in jsonBrokerStats){
        //Wrap db statements is anon function to bind broker variable
        (function(broker){
            db_overview.get("SELECT sellValue,buyValue FROM dailyBroker WHERE date = ? AND broker = ?",[date,broker], function(err,row) {
                var currSell=0,currBuy=0,newSell=0,newBuy=0,addSell=0,addBuy=0;
                if(row){
                    currSell = row.sellValue || 0; //is null if not existing
                    currBuy = row.buyValue || 0;
                }

                if (jsonBrokerStats[broker].buyPrice != '-'){ //to prevent NaN
                    addBuy = jsonBrokerStats[broker].buyVolume*jsonBrokerStats[broker].buyPrice;
                }
                if (jsonBrokerStats[broker].sellPrice != '-'){
                    addSell = jsonBrokerStats[broker].sellVolume*jsonBrokerStats[broker].sellPrice;
                }
                newBuy = currBuy + addBuy;
                newSell = currSell + addSell;

                db_overview.run("INSERT OR REPLACE INTO dailyBroker VALUES (?,?,?,?)",[date,broker,newSell,newBuy]);
                //console.log(broker,currBuy,currSell,newBuy,newSell);
            });
        })(broker);
    }
}

/**
 * Store avanza ids and name in table stockIds
 */
function storeAvaIdsInDb(){
    //this probably fails sometimes because of no real serialization
    db_overview.serialize(()=>{
        db_overview.run("CREATE TABLE IF NOT EXISTS stockIds (ticker TEXT, id TEXT UNIQUE, name TEXT)");
        if(diffBetweenDbAndList){
            console.log("Updating stockId database");
            var stmt = db_overview.prepare("INSERT OR IGNORE INTO stockIds VALUES (?,?,?)");
            var id, name;
            JSON.parse(avaIdsJsonObj, (key,value) => {
                if(key=='id'){
                    id = value;
                }else if(key == 'name'){
                    name = value;
                }else if(key){
                    stmt.run(key, id, name);
                }
            });
            stmt.finalize();
        }
    });
}

/*
*   Generate list of avanza stock Id numbers from lists of Tickers. 
*   Compare list of Id Numbers to existing list stored in @avaIdsJsonObj
*   Overwrite it if change is detected.
*   Modify @stockList in order to change included stocks.
*/
function generateAvanzaStockIdList(){
    var tickerList = [];
    var numOfRequests = 0;
    stockList.forEach((list) => {
        console.log("Parsing stocklist: "+list);
        var contents = fs.readFileSync(list,'utf8');
        contents.split('\r\n').forEach((ticker) => {
            tickerList.push(ticker);
        });
    })
    console.log("Number of stocks in list: "+tickerList.length); //should be ~830 for full list
    //Parse avanza if tickerList does not match avaIdFile
    var tmpTickerList = tickerList.slice();
    JSON.parse(avaIdsJsonObj, (key,value) => {
        if(key && key !='id' && key != 'name'){
            var idx = tmpTickerList.indexOf(key);
            if (idx > -1){
                tmpTickerList.splice(idx,1);
            }else{
                console.log("Ticker "+key+" not found in tickerlist. tmpTickerList: "+tmpTickerList.toString());
                diffBetweenDbAndList = 1;    
            } 
        }
    });

    if(tmpTickerList.length != 0){
        diffBetweenDbAndList = 1;
        console.log("Remaining tickers in list: "+tmpTickerList.toString());
    }

    if(diffBetweenDbAndList){
        console.log("AvaIdJsonObj does not match Stocklist, rebuilding AvaIdJsonObj.");
        avanza.authenticate({
        username: process.env.USER,
        password: process.env.PASSWORD
        }).then(() => {  
            searchStocks(0,tickerList,{});
        });
    }else{
        console.log("TickerList matched AvaJsonIdObj, DB update not required.");
    }
}

/**
 * 
 *  Synchronous fetcher of avanza stock ids. Parse results with function parseSearchString
 * 
 */
function searchStocks(i,list,jsonObj){
    if(i<list.length){
        var stockName = list[i];
        avanza.search(stockName).then(answer => {
            //console.log(JSON.stringify(answer));
            if (answer.totalNumberOfHits != 0){
                var arrIdName = parseSearchString(stockName,answer);
                arrIdName[1] = arrIdName[1].replace(/\s|\.|\&/g, '-').normalize('NFD').replace(/[\u0300-\u036f]/g, "").toLowerCase(); //remove åäö, and replace spaces, dots and & with -
                console.log("Found answer("+i+"): "+arrIdName[0]+" and "+arrIdName[1]+" for stock "+stockName);
                //space AND DOT needs to be replaced with dash, see bald pref
                jsonObj[stockName] = {'id': arrIdName[0], 'name': arrIdName[1]};
            }else{
                console.log("Stock "+stockName+" potentially delisted? No matching stock found on Ava search.");
            }
            searchStocks(i+1,list,jsonObj);
        }).catch( (error) => {
            console.log("Promise rejected for stock "+stockName+" at "+i+", error: "+error);
        });
    } else {
        console.log("Reached end of stock list! Writing data to file: ");
        fs.writeFileSync(avaIdFile, JSON.stringify(jsonObj));
        console.log("Write completed");
        avaIdsJsonObj = jsonObj;
    }  
}

/**
 * 
 * Parse search response from avanza  
 *  
 */
function parseSearchString(name,answer){
    var id, name;
    try {
        if(answer.totalNumberOfHits==1){
            id = answer.hits[0].topHits[0].id;
            name = answer.hits[0].topHits[0].name;
            return [id,name];
        }else{
            for (var j=0; j<answer.totalNumberOfHits; j++){
                if ( typeof answer.hits[j].instrumentType !== 'undefined' && answer.hits[j].instrumentType == "STOCK"){
                    for (var k=0; k<answer.hits[j].numberOfHits; k++){  
                        var tmp_answer = answer.hits[j].topHits[k];
                        if(tmp_answer.tickerSymbol == name){
                            //pot. issue: for example ABB has ticker ABB for both US and SWE stock. Only take currency = SEK?
                            id = tmp_answer.id;
                            name = tmp_answer.name;
                            return [id,name];
                        }
                    }
                } else {
                    console.log("instrument type undefined, trying default.. ")
                    id = answer.hits[0].topHits[0].id;
                    name = answer.hits[0].topHits[0].name;
                    return [id,name];
                }
            }
        }
    } catch (err) {
        console.log("Name: "+name+", Answer: "+JSON.stringify(answer));
        console.log("Error received: ",err);
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

*/