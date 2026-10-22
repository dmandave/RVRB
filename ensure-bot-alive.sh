#!/bin/bash
# Daily / periodic kickstart for the RVRB bot.
# PM2 can stay "online" while the websocket is dead after an RVRB server reset.
# A fresh restart forces a new connection + channel join.

set -euo pipefail

LOG_DIR="${HOME}/rvrb-bot/logs"
LOG_FILE="${LOG_DIR}/ensure-bot-alive.log"
mkdir -p "$LOG_DIR"

ts() { date '+%Y-%m-%d %H:%M:%S %Z'; }

{
  echo "[$(ts)] ensure-bot-alive starting"

  export PATH="/usr/local/bin:/usr/bin:/bin:${PATH}"
  cd "${HOME}/rvrb-bot"

  if ! command -v pm2 >/dev/null 2>&1; then
    echo "[$(ts)] ERROR: pm2 not found"
    exit 1
  fi

  # Restart (or start) so we always get a fresh websocket join
  if pm2 describe rvrb-bot >/dev/null 2>&1; then
    echo "[$(ts)] Restarting rvrb-bot via pm2"
    pm2 restart rvrb-bot --update-env
  else
    echo "[$(ts)] rvrb-bot not in pm2 — starting"
    pm2 start ws-client.js --name rvrb-bot
    pm2 save
  fi

  sleep 3
  pm2 status rvrb-bot || pm2 status
  echo "[$(ts)] ensure-bot-alive done"
} >>"$LOG_FILE" 2>&1
