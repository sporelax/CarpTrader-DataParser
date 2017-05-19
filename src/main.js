import Avanza from 'avanza'
import dotenv from 'dotenv';
dotenv.config()
const avanza = new Avanza()
const readline = require('readline');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./stock_market_data.db');

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
function initDbTables(db) {
     db.run("CREATE TABLE IF NOT EXISTS orderdepths (instrumentId TEXT, orderTime NUMERIC, levels TEXT, total TEXT)");
     db.run("CREATE TABLE IF NOT EXISTS trades (seller TEXT, dealTime NUMERIC, instrumentId TEXT, price NUMERIC, volume NUMERIC)");
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


*/