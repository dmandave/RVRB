#!/bin/bash

# Manual deployment script - uses hardcoded instance name from logs
INSTANCE_NAME="instance-20250402-214502"
ZONE="us-central1-a"

echo "🚀 Deploying RVRB bot to $INSTANCE_NAME..."
echo ""

# Upload the ws-client.js file
echo "📤 Uploading ws-client.js..."
gcloud compute scp ws-client.js $INSTANCE_NAME:~/rvrb-bot/ --zone=$ZONE

# Restart the bot
echo "🔄 Restarting bot..."
gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="cd ~/rvrb-bot && pm2 restart rvrb-bot"

# Show status
echo "📊 Checking bot status..."
gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="cd ~/rvrb-bot && pm2 status"

echo ""
echo "✅ Deployment complete!"

