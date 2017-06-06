import Avanza from 'avanza'
import dotenv from 'dotenv';
dotenv.config()
const avanza = new Avanza()
const readline = require('readline');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
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

/*
avanza.socket.once('connect', () => {
    avanza.socket.subscribe('5479', ['orderdepths','trades']); // Telia
    console.log('subscribed to telia.');
});

avanza.socket.on('orderdepths', data => {
    console.log('Received orderdepths: ', JSON.stringify(data));
});

avanza.socket.on('trades', data => {
    console.log('Received trades: ', data);
});
*/
generateAvanzaStockIdList();
storeAvaIdsInDb();

avanza.authenticate({
    username: process.env.USER,
    password: process.env.PASSWORD
}).then(() => {
    //avanza.socket.initialize();
    // We are authenticated and ready to process data 
    //avanza.getChartdata('5479').then((data) => {
    //    console.log(JSON.stringify(data));
    //});
    try{
        dailyStockParse();
    } catch (err) {
        console.log("Caught in try catch, ",err);
    }
}).catch((err) => {
    console.log("Error catched all the way up here?");
});

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
    db_overview.run("CREATE TABLE IF NOT EXISTS stock (date TEXT, id TEXT, marketPlace TEXT, marketList TEXT, currency TEXT, name TEXT, ticker TEXT, lastPrice NUMERIC, totalValueTraded NUMERIC, numberOfOwners NUMERIC, priceChange NUMERIC, totalVolumeTraded NUMERIC, marketCap NUMERIC, volatility NUMERIC, pe NUMERIC, yield NUMERIC, UNIQUE(date,id))");
    db_overview.all("SELECT ticker, id FROM stockIds", (err,rows) => {
        dailyStockParseSerializeCalls(0,rows)
    });
}

function dailyStockParseSerializeCalls(index,rows){
    if(index<rows.length){
        avanza.getStock(rows[index].id).then((data) => {
                console.log("found data for stock ("+(index+1)+"/"+rows.length+"): "+data.ticker);
                var date_str = date.toJSON().slice(0,-14); //YEAR-MONTH-DAY. Move to start?
                // make date-formatting function
                //If time before 9, set date to prev day? 
                //If market = not open this day, dont store
                var insert_values = [date_str];
                insert_values.push(data.id);
                insert_values.push(data.marketPlace);
                insert_values.push(data.marketList);
                insert_values.push(data.currency);
                insert_values.push(data.name);
                insert_values.push(data.ticker);
                insert_values.push(data.lastPrice);
                insert_values.push(data.totalValueTraded);
                insert_values.push(data.numberOfOwners);
                insert_values.push(data.change);
                insert_values.push(data.totalVolumeTraded || null); 
                insert_values.push(data.marketCapital || null); //remove || to trigger error. Can we catch it?
                insert_values.push(data.volatility || 0);
                insert_values.push(data.pe || null);
                insert_values.push(data.yield || 0);
                db_overview.run("INSERT OR REPLACE INTO stock VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", insert_values);
                dailyStockParseSerializeCalls(index+1,rows);
            }).catch((error) => {
                console.log("Promise rejected for stock "+row.ticker+", error: "+error);
            });
    } else {
        console.log("Reached end of stock list! Parsed "+index+" stocks.");
    }  
}

function storeAvaIdsInDb(){
    db_overview.serialize(()=>{
        db_overview.run("CREATE TABLE IF NOT EXISTS stockIds (ticker TEXT, id TEXT UNIQUE)");
        if(diffBetweenDbAndList){
            console.log("Updating stockId database");
            var stmt = db_overview.prepare("INSERT OR IGNORE INTO stockIds VALUES (?,?)");
            JSON.parse(avaIdsJsonObj, (key,value) => {
                if(key){
                    stmt.run(key, value);
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
    stockList.forEach((value) => {
        console.log("Parsing stocklist: "+value);
        var contents = fs.readFileSync(value,'utf8');
        contents.split('\r\n').forEach((tick) => {
            tickerList.push(tick);
        });
    })
    console.log("Number of stocks in list: "+tickerList.length); //should be ~830 for full list
    //Parse avanza if tickerList does not match avaIdFile
    var tmpTickerList = tickerList.slice();
    JSON.parse(avaIdsJsonObj, (key,value) => {
        var idx = tmpTickerList.indexOf(key);
        if (idx > -1){
            tmpTickerList.splice(idx,1);
        }else{
            if(key){ //last item from JSON.parse is ""
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
            var avaIds = {};
            searchStocks(0,tickerList,avaIds);
        });
    }else{
        console.log("TickerList matched AvaJsonIdObj, DB update not required.");
    }
}

//Synchronous fetcher of avanza stock ids. Parse results with function parseSearchString
function searchStocks(i,list,jsonObj){
    if(i<list.length){
        var stockName = list[i];
        avanza.search(stockName).then(answer => {
            var id = parseSearchString(stockName,answer);
            console.log("Found answer("+i+"): "+id+" for stock "+stockName);
            jsonObj[stockName] = id;
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

function parseSearchString(name,answer){
    try {
        if(answer.totalNumberOfHits==1){
            return answer.hits[0].topHits[0].id;
        }else{
            for (var j=0; j<answer.totalNumberOfHits; j++){
                if (answer.hits[j].instrumentType && answer.hits[j].instrumentType == "STOCK"){
                    for (var k=0; k<answer.hits[j].numberOfHits; k++){  
                        var tmp_answer = answer.hits[j].topHits[k];
                        if(tmp_answer.tickerSymbol == name){
                            //pot. issue: for example ABB has ticker ABB for both US and SWE stock. Only take currency = SEK?
                            return tmp_answer.id;
                        }
                    }
                } else {
                    console.log("instrument type undefined, trying default.. ")
                    return answer.hits[0].topHits[0].id;
                }
            }
        }
    } catch (err) {
        console.log("Name: "+name+", Answer: "+JSON.stringify(answer));
        console.log("Error received: ",err);
    }
}

//Run once
function initOverviewTables(db) {
     db.run("CREATE TABLE IF NOT EXISTS stock (date TEXT, id TEXT, marketPlace TEXT, marketList TEXT, currency TEXT, name TEXT, ticker TEXT, lastPrice NUMERIC, totalValueTraded NUMERIC, numberOfOwners NUMERIC, priceChange NUMERIC, totalVolumeTraded NUMERIC, marketCap NUMERIC, volatility NUMERIC, pe NUMERIC, yield NUMERIC, UNIQUE(date,id))");
     db.run("CREATE TABLE IF NOT EXISTS stockIds (ticker TEXT, id TEXT UNIQUE)");
}

//Run once
function initIntradayTables(db) {
     db.run("CREATE TABLE IF NOT EXISTS orderdepths (instrumentId TEXT, orderTime NUMERIC, levels TEXT, total TEXT)");
     db.run("CREATE TABLE IF NOT EXISTS trades (buyer TEXT, seller TEXT, dealTime NUMERIC, instrumentId TEXT, price NUMERIC, volume NUMERIC)");
}

/* 
    For reference

Trade:
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

Quote:
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
getStock:
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