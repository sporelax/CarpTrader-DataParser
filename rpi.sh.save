#!/bin/bash

export NODE_PATH=/usr/lib/nodejs:/usr/lib/node_modules:/usr/share/javascript
cd ~pi/Git/CarpTrader-DataParser/
npm run exec

if [ $? -eq 0 ]
then 
    git add -A >> info.log 2>>info.log
    git commit -m "daily RPI parse" >> info.log 2>> info.log
    git push >> info.log 2>> info.log
    exit 0
else
    echo "\nscript failed: $?" >> info.log
    exit 1    
fi
