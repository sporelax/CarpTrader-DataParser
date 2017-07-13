#!/bin/bash

export NODE_PATH=/usr/lib/nodejs:/usr/lib/node_modules:/usr/share/javascript
cd ~pi/Git/CarpTrader-DataParser/
git pull >> info.log 2>>info.log
npm run exec
git add -A >> info.log 2>>info.log
git commit -m "daily RPI parse" >> info.log 2>> info.log
git push
