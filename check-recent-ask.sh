#!/bin/bash

# Check recent +ask attempts and see what's happening
INSTANCE_NAME="instance-20250402-214502"
ZONE="us-central1-a"

echo "=== Checking recent +ask attempts ==="
gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="cd ~/rvrb-bot && pm2 logs rvrb-bot --lines 100 --nostream | grep -i -E '(ask|getAIResponse|pollinations|anthropic|falling back|successfully got)' | tail -30"

echo ""
echo "=== Checking if Anthropic is configured ==="
gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="cd ~/rvrb-bot && printenv | grep -i anthropic || echo 'ANTHROPIC_API_KEY not found in environment'"

echo ""
echo "=== Recent errors ==="
gcloud compute ssh $INSTANCE_NAME --zone=$ZONE --command="cd ~/rvrb-bot && pm2 logs rvrb-bot --lines 50 --nostream --err | tail -20"

