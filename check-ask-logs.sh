#!/bin/bash

# Quick script to check +ask related logs
# Usage: ./check-ask-logs.sh [INSTANCE_NAME] [ZONE]

INSTANCE_NAME=${1:-${GCLOUD_INSTANCE_NAME}}
ZONE=${2:-${GCLOUD_ZONE:-us-central1-a}}

if [ -z "$INSTANCE_NAME" ]; then
    echo "Usage: $0 [INSTANCE_NAME] [ZONE]"
    echo "Or set GCLOUD_INSTANCE_NAME and GCLOUD_ZONE environment variables"
    exit 1
fi

echo "=== Checking +ask related logs for instance: $INSTANCE_NAME ==="
echo ""

echo "=== Recent +ask command logs (last 50 lines) ==="
gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="cd ~/rvrb-bot && pm2 logs rvrb-bot --lines 50 --nostream | grep -i -E '(ask|getAIResponse|pollinations|anthropic|ai error)'" 2>/dev/null || \
gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="cd ~/rvrb-bot && pm2 logs --lines 50 --nostream | grep -i -E '(ask|getAIResponse|pollinations|anthropic|ai error)'" 2>/dev/null

echo ""
echo "=== All recent errors (last 30 lines) ==="
gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="cd ~/rvrb-bot && pm2 logs rvrb-bot --lines 30 --nostream --err" 2>/dev/null || \
gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="cd ~/rvrb-bot && pm2 logs --lines 30 --nostream --err" 2>/dev/null

echo ""
echo "=== Recent console output (last 20 lines) ==="
gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="cd ~/rvrb-bot && pm2 logs rvrb-bot --lines 20 --nostream" 2>/dev/null || \
gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="cd ~/rvrb-bot && pm2 logs --lines 20 --nostream" 2>/dev/null

