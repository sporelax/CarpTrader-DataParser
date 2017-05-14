import Avanza from 'avanza'
import dotenv from 'dotenv';
dotenv.config()
const avanza = new Avanza()

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

    avanza.authenticate({
        username: process.env.USER,
        password: process.env.PASSWORD
    }).then(() => {
        avanza.getPositions().then(positions => {
            console.log('current positions: '+positions);
        });
        avanza.socket.initialize();

        avanza.getStock('5479').then(stock => {
            console.log('Telia stock: '+JSON.stringify(stock));
        });
        console.log('Reached end');
    })
}else{
    console.log('wrong user!');
    process.exit(0);
}