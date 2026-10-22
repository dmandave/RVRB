#!/bin/bash

# Script to check PM2 logs on GCloud instance for RVRB bot errors

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Set default values if not provided
INSTANCE_NAME=${GCLOUD_INSTANCE_NAME:-""}
ZONE=${GCLOUD_ZONE:-"us-central1-a"}
PROJECT_ID=${GCLOUD_PROJECT_ID:-""}

# Check if required variables are set
if [ -z "$INSTANCE_NAME" ]; then
    echo "❌ Error: GCLOUD_INSTANCE_NAME not set"
    echo "Please set GCLOUD_INSTANCE_NAME in your .env file or export it"
    exit 1
fi

# Set project if specified
if [ ! -z "$PROJECT_ID" ] && [ "$PROJECT_ID" != "your_project_id_here" ]; then
    gcloud config set project $PROJECT_ID
fi

echo "📋 Checking logs for instance: $INSTANCE_NAME in zone: $ZONE"
echo ""

# Check PM2 logs (last 100 lines, focusing on errors)
echo "=== Recent PM2 Error Logs (last 100 lines) ==="
gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="cd ~/rvrb-bot && pm2 logs rvrb-bot --lines 100 --nostream --err" 2>/dev/null || \
gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="cd ~/rvrb-bot && pm2 logs --lines 100 --nostream --err" 2>/dev/null

echo ""
echo "=== Recent PM2 All Logs (last 50 lines, including AI errors) ==="
gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="cd ~/rvrb-bot && pm2 logs rvrb-bot --lines 50 --nostream" 2>/dev/null || \
gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="cd ~/rvrb-bot && pm2 logs --lines 50 --nostream" 2>/dev/null

echo ""
echo "=== Searching for AI/Pollinations errors ==="
gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="cd ~/rvrb-bot && pm2 logs rvrb-bot --lines 200 --nostream | grep -i -E '(pollinations|ai error|ai service|trouble|timeout|http error)' | tail -20" 2>/dev/null || \
gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="cd ~/rvrb-bot && pm2 logs --lines 200 --nostream | grep -i -E '(pollinations|ai error|ai service|trouble|timeout|http error)' | tail -20" 2>/dev/null

echo ""
echo "=== PM2 Status ==="
gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="cd ~/rvrb-bot && pm2 status"

