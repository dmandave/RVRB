#!/bin/bash

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
else
    echo "⚠️  Warning: .env file not found. Using default values or environment variables."
fi

# Set default values if not provided
INSTANCE_NAME=${GCLOUD_INSTANCE_NAME:-""}
ZONE=${GCLOUD_ZONE:-"us-central1-a"}
PROJECT_ID=${GCLOUD_PROJECT_ID:-""}

# Check if required variables are set
if [ -z "$INSTANCE_NAME" ]; then
    echo "❌ Error: GCLOUD_INSTANCE_NAME not set in .env file"
    echo "Please set GCLOUD_INSTANCE_NAME in your .env file"
    exit 1
fi

echo "🚀 Deploying RVRB bot..."
echo "📋 Instance: $INSTANCE_NAME"
echo "📍 Zone: $ZONE"
echo "🏗️  Project: $PROJECT_ID"

# Set project if specified and valid
if [ ! -z "$PROJECT_ID" ] && [ "$PROJECT_ID" != "your_project_id_here" ]; then
    echo "🔧 Setting project to: $PROJECT_ID"
    gcloud config set project $PROJECT_ID
else
    echo "ℹ️  Using current gcloud project configuration"
fi

# Upload the ws-client.js file (only; .env is NOT uploaded — set POLLINATIONS_API_KEY,
# POLLINATIONS_TEXT_MODEL, POLLINATIONS_TEXT_MODEL_FREE etc. on the server in ~/rvrb-bot/.env)
echo "📤 Uploading ws-client.js..."
gcloud compute scp ws-client.js $INSTANCE_NAME:~/rvrb-bot/ --zone=$ZONE

# Keep ensure-bot-alive.sh in sync if present locally
if [ -f ensure-bot-alive.sh ]; then
    echo "📤 Uploading ensure-bot-alive.sh..."
    gcloud compute scp ensure-bot-alive.sh $INSTANCE_NAME:~/rvrb-bot/ --zone=$ZONE
    gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="chmod +x ~/rvrb-bot/ensure-bot-alive.sh"
fi

# Restart the bot
echo "🔄 Restarting bot..."
gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="cd ~/rvrb-bot && pm2 restart rvrb-bot"

# Show status
echo "📊 Checking bot status..."
gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="cd ~/rvrb-bot && pm2 status"

echo "✅ Deployment complete!"