#!/bin/bash

# Update system package list only
sudo apt-get update

# Install curl and Node.js dependencies
sudo apt-get install -y curl

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 for process management
sudo npm install -g pm2

# Create app directory
mkdir -p ~/rvrb-bot
cd ~/rvrb-bot

# Move files to app directory
mv ~/ws-client.js ~/package.json ~/.env ~/rvrb-bot/

# Install dependencies
npm install

# Start the bot with PM2
pm2 start ws-client.js --name rvrb-bot
pm2 save
pm2 startup