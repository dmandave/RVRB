import websocket
import os
import json
import random
import time

# Set your API key and channel
os.environ['apikey'] = '606a3d2e0628a7ded8b8e3150d9e7fd2'
CHANNEL_ID = '635f1ddba557db2254f486b2'

# WebSocket URL with API key
url = f"wss://app.rvrb.one/ws-bot?apiKey={os.environ.get('apikey')}"

ws = None
joinId = None

def send_message(message):
    ws.send(json.dumps({
        "jsonrpc": "2.0",
        "method": "sendChannelMessage",
        "params": {
            "channelId": CHANNEL_ID,
            "message": {
                "type": "chat",
                "content": message,
                "timestamp": int(time.time() * 1000)
            }
        },
        "id": random.randint(1, 1000)
    }))

def join():
    global joinId
    joinId = round(random.random() * 100)
    join_request = {
        "jsonrpc": "2.0",
        "method": "join",
        "params": {
            "channelId": CHANNEL_ID
        },
        "id": joinId
    }
    ws.send(json.dumps(join_request))

def leave():
    ws.send(json.dumps({
        "jsonrpc": "2.0",
        "method": "leave",
        "params": {
            "channelId": CHANNEL_ID
        },
        "id": random.randint(1, 1000)
    }))

def on_message(ws, message):
    print(f"Received message: {message}")
    data = json.loads(message)

    # Handle keepAwake messages
    if data.get("method") == "keepAwake":
        ws.send(json.dumps({
            "jsonrpc": "2.0",
            "method": "stayAwake",
            "params": {
                "date": int(time.time() * 1000)
            }
        }))
        return

    # Handle ready message - both old and new format
    if data.get("method") == "ready":
        print("Got ready message")
        # New format: channelId in ready event
        if "channelId" in data.get("params", {}):
            global CHANNEL_ID
            CHANNEL_ID = data["params"]["channelId"]
            print(f"Using channelId from ready event: {CHANNEL_ID}")
        join()
        return

    # Handle join response
    if data.get("id") == joinId:
        if "error" in data:
            print(f"Error joining channel: {data['error']}")
        else:
            print("Successfully joined channel")
            # Wait a moment before sending first message
            time.sleep(1)
            send_message("Hello! I'm test2 bot")

    # Debug: print all incoming messages to help diagnose
    print(f"DEBUG - Received message type: {data.get('method')}")
    if 'params' in data:
        print(f"DEBUG - Message params: {data['params']}")

def on_error(ws, error):
    print(f"Error: {error}")

def on_close(ws, close_status_code, close_msg):
    print(f"### closed ### {close_status_code} - {close_msg}")
    # Try to leave gracefully before closing
    try:
        leave()
    except:
        pass

def on_open(ws):
    print("Connected to server")

def connect():
    global ws
    websocket.enableTrace(True)
    ws = websocket.WebSocketApp(url,
                              on_message=on_message,
                              on_error=on_error,
                              on_close=on_close,
                              on_open=on_open)
    # Add ping_interval and ping_timeout to keep connection alive
    ws.run_forever(ping_interval=10, ping_timeout=5)

if __name__ == "__main__":
    connect()