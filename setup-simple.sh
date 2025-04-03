#!/bin/bash

# Step 1: Basic system setup
echo "Step 1: System setup..."
sudo apt-get update
sudo apt-get install -y curl

# Step 2: Install Node.js
echo "Step 2: Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version

# Step 3: Setup application
echo "Step 3: Setting up application..."
mkdir -p ~/rvrb-bot
cd ~/rvrb-bot
mv ~/ws-client.js ~/package.json ~/.env ./

# Step 4: Install project dependencies
echo "Step 4: Installing project dependencies..."
npm install

# Step 5: Install and setup PM2
echo "Step 5: Setting up PM2..."
sudo npm install -g pm2
pm2 start ws-client.js --name rvrb-bot
pm2 save
pm2 startup