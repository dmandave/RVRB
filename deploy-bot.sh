#!/bin/bash

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
else
    echo "⚠️  Warning: .env file not found. Using default values or environment variables."
fi

# Set default values if not provided
INSTANCE_NAME=${GCLOUD_INSTANCE_NAME:-""}
ZONE=${GCLOUD_ZONE:-"us-central1-f"}
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

# Upload the ws-client.js file
echo "📤 Uploading ws-client.js..."
gcloud compute scp ws-client.js $INSTANCE_NAME:~/rvrb-bot/ --zone=$ZONE

# Restart the bot
echo "🔄 Restarting bot..."
gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="cd ~/rvrb-bot && pm2 restart rvrb-bot"

# Show status
echo "📊 Checking bot status..."
gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="cd ~/rvrb-bot && pm2 status"

echo "✅ Deployment complete!"