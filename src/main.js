import Avanza from 'avanza'
import dotenv from 'dotenv';
dotenv.config()
const avanza = new Avanza()
const readline = require('readline');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const db_intraday = new sqlite3.Database('./databases/omxs_intraday.db');
const db_overview = new sqlite3.Database('./databases/omxs_overview.db');
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

/*
avanza.authenticate({
    username: process.env.USER,
    password: process.env.PASSWORD
}).then(() => {
    //avanza.socket.initialize();
    // We are authenticated and ready to process data 
    dailyStockParse();
});
*/

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
    db_overview.all("SELECT ticker, id FROM stockIds", (err,rows) => {
        dailyStockParseSerializeCalls(0,rows)
    });
}

function dailyStockParseSerializeCalls(index,rows){
    if(index<rows.length){
        avanza.getStock(rows[index].id).then(data => {
                console.log("found Stock data for stock: "+data.ticker);
                var date_str = date.toJSON().slice(0,-14); //YEAR-MONTH-DAY. Move to start?
                //if data.ticker == ticker?
                var insert_values = [date.toJSON(), data.id, data.marketPlace, data.marketList, data.currency, data.name, data.ticker, data.lastPrice, data.totalValueTraded, data.numberOfOwners, data.change, data.totalVolumeTraded, data.company.marketCapital, data.volatility, data.pe, data.yield];
                //db_overview.run("INSERT INTO stock VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", insert_values);
                dailyStockParseSerializeCalls(index++,rows);
            }).catch( (error) => {
                console.log("Promise rejected for stock "+row.ticker+", error: "+error);
            });
    } else {
        console.log("Reached end of stock list! Parsed "+index+" stocks.");
    }  
}

function storeAvaIdsInDb(){
    var jsonObj = fs.readFileSync(avaIdFile,'utf8');
    db_overview.run("CREATE TABLE IF NOT EXISTS stockIds (ticker TEXT, id TEXT UNIQUE)");
    console.log("read ava id file and insert into db");
    var stmt = db_overview.prepare("INSERT OR IGNORE INTO stockIds VALUES (?,?)");
    var count = 0;
    var noKey = 0;
    JSON.parse(jsonObj, (key,value) => {
        if(key){
            count++;
            stmt.run(key, value);
        }else{
            noKey++;
        }
    });
    stmt.finalize();
    console.log("end, count: "+count+", no key: "+noKey);
}

/*
*   Generate list of avanza stock Id numbers
*   Store list in @avaIdFile (overwritten every time this function completes a run)
*   Modify @stockList in order to change included stocks
*/
function generateAvanzaStockIdList(){
    var stockList = ['./stocklists/nasdaq_stockholm.txt', 
                        './stocklists/nasdaq_firstnorth.txt',
                        './stocklists/ngm.txt',
                        './stocklists/aktietorget.txt'];
    var numOfRequests = 0;
    var tickerList = [];
    stockList.forEach((value) => {
        console.log(value);
        var contents = fs.readFileSync(value,'utf8');
        contents.split('\r\n').forEach((tick) => {
            tickerList.push(tick);
        });
    })
    console.log(tickerList.length); //should be 830 for full list

    avanza.authenticate({
        username: process.env.USER,
        password: process.env.PASSWORD
    }).then(() => {  
        var avaIds = {};
        searchStocks(0,tickerList,avaIds);
    }); 
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
     db.run("CREATE TABLE IF NOT EXISTS stock (date TEXT, id TEXT, marketPlace TEXT, marketList TEXT, currency TEXT, name TEXT, ticker TEXT, lastPrice NUMERIC, totalValueTraded NUMERIC, numberOfOwners NUMERIC, priceChange NUMERIC, totalVolumeTraded NUMERIC, marketCap NUMERIC, volatility NUMERIC, pe NUMERIC, yield NUMERIC)");
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