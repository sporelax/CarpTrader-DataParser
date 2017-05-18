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
        avanza.socket.subscribe('5479', ['quotes']); // Telia
        console.log('subscribed to telia quote');
    });

    avanza.socket.on('quotes', data => {
        console.log('Received quote: ', data);
    });

    avanza.socket.on('error', data => {
        console.log('Received error: ', data);
    });

    avanza.authenticate({
        username: process.env.USER,
        password: process.env.PASSWORD
    }).then(() => {

        avanza.socket.initialize();
        /* We are authenticated and ready to process data */

        avanza.getPositions().then(positions => {
            console.log('current positions: '+positions);
        });

        avanza.getStock('5479').then(stock => {
            console.log('Telia stock: '+JSON.stringify(stock));
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