#!/bin/bash

npm run exec

if [ $? -eq 0]
then 
    git add -A >> info.log 2>>info.log
    git commit -m "daily RPI parse" >> info.log 2>> info.log
    git push >> info.log 2>> info.log
    exit 0
else
    echo "script failed" >> info.log
    exit 1    
fi