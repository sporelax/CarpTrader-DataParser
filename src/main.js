import Avanza from 'avanza'
import dotenv from 'dotenv';
dotenv.config()
const avanza = new Avanza()
const readline = require('readline');
const sqlite3 = require('sqlite3').verbose();
const db_intraday = new sqlite3.Database('./omxs_intraday.db');
const db_overview = new sqlite3.Database('./omxs_overview.db');
const date = new Date();

const psw = process.env.PASSWORD;
const user = process.env.USER;
const acc = process.env.ACCOUNT;
const order = process.env.ORDER;
console.log('User: ' +user+ ', pass: '+psw+ ', acc: '+acc+ ', order: '+order);

if(user=='perik911') {
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

    avanza.authenticate({
        username: process.env.USER,
        password: process.env.PASSWORD
    }).then(() => {

        avanza.socket.initialize();
        /* We are authenticated and ready to process data */

        avanza.getStock('5479').then(data => {
        console.log('Telia stock: ',data);
        //console.log(data.id);
        //console.log(data.currency);
        //console.log(date);
        var insert_values = [date.toJSON(), data.id, data.marketPlace, data.marketList, data.currency, data.name, data.ticker, data.lastPrice, data.totalValueTraded, data.numberOfOwners, data.change, data.totalVolumeTraded, data.company.marketCapital, data.volatility, data.pe, data.yield];
        db_overview.run("INSERT INTO stock VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", insert_values);
   });
    })

    console.log('Press \'q\' to exit.');
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.on('keypress', (str, key) => {
        console.log(str);
        if(str == 'q'){
            process.exit(0);
        }
    })
    
}else{
    console.log('wrong user!');
    process.exit(0);
}

//Run once
function initOverviewTables(db) {
     db.run("CREATE TABLE IF NOT EXISTS stock (date TEXT, id TEXT, marketPlace TEXT, marketList TEXT, currency TEXT, name TEXT, ticker TEXT, lastPrice NUMERIC, totalValueTraded NUMERIC, numberOfOwners NUMERIC, priceChange NUMERIC, totalVolumeTraded NUMERIC, marketCap NUMERIC, volatility NUMERIC, pe NUMERIC, yield NUMERIC)");
}

//Run once
function initIntradayTables(db) {
     db.run("CREATE TABLE IF NOT EXISTS orderdepths (instrumentId TEXT, orderTime NUMERIC, levels TEXT, total TEXT)");
     db.run("CREATE TABLE IF NOT EXISTS trades (buyer TEXT, seller TEXT, dealTime NUMERIC, instrumentId TEXT, price NUMERIC, volume NUMERIC)");
}

/* 
    For future

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