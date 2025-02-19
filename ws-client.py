import websocket
import os
import json
import random
import time

url = f"wss://app.rvrb.one/ws-bot?apiKey={os.environ.get('apikey')}"
channelId = None
password = os.environ.get('password', None)

ws = None
latency = 0
reconnect = True
joinId = None

# Attempt to join my channel
def join():
    global joinId
    joinId = round(random.random() * 100) # Provide an ID to get a response
    joinRequest = {
        "method": "join",
        "params": {
            "channelId": channelId
        },
        "id": joinId
    }
    if password:
        joinRequest["params"]["password"] = password
    ws.send(json.dumps(joinRequest))

# Event handlers for the WebSocket connection
# These are called when the server sends a message
# with a method that matches the key
def keepAwake(data):
    global latency
    # Keep awake is like a ping but also used to measure latency
    latency = data["params"]["latency"]
    print(f"Latency: {latency}ms")
    # Send a stayAwake message back to the server
    # If the server doesn't receive a stayAwake message 3 times in a row
    # The server will close the connection
    ws.send(json.dumps({
        "jsonrpc": "2.0",
        "method": "stayAwake",
        "params": {
            "date": int(time.time() * 1000)
        }
    }))

def ready(data):
    global channelId
    if data.get("params", {}).get("channelId"):
        channelId = data["params"]["channelId"]
    print(f"\n=== CONNECTED TO CHANNEL {channelId} ===\n")
    join()

    time.sleep(2)
    print("\n=== ATTEMPTING TO SEND TEST MESSAGE ===\n")

    # New format matching the JavaScript client structure
    test_msg = {
        "jsonrpc": "2.0",
        "method": "sendChannelMessage",  # Not push, but send
        "params": {
            "channelId": channelId,
            "message": {  # Nested message object
                "type": "chat",
                "content": "Test message from admin bot",
                "timestamp": int(time.time() * 1000)
            }
        },
        "id": random.randint(1, 1000)  # Important: Include an ID for the response
    }
    print(f"Sending message: {json.dumps(test_msg, indent=2)}")
    ws.send(json.dumps(test_msg))

def pushChannelMessage(data):
    print("Received chat message", data["params"])

    # Extract the message content
    message = data["params"].get("message", {}).get("content", "")

    # Check if message starts with ! or ~ for bot commands
    if message.startswith("!") or message.startswith("~"):
        command = message[1:]  # Remove the prefix

        # Send a response
        ws.send(json.dumps({
            "jsonrpc": "2.0",
            "method": "sendChannelMessage",
            "params": {
                "channelId": channelId,
                "message": {
                    "type": "chat",
                    "content": f"Received command: {command}",
                    "timestamp": int(time.time() * 1000)
                }
            },
            "id": random.randint(1, 1000)
        }))

def pushNotification(data):
    print("Received notification", data["params"]) # Notification from the server

def updateChannel(data):
    print("Received channel update", data["params"]) # Channel name or description change

def updateChannelUsers(data):
    print("Received channel users update", data["params"]) # Users join or leave

def updateUser(data):
    print("Received user update", data["params"]) # User changes name or avatar, etc.

def updateChannelDjs(data):
    print("Received channel djs update", data["params"]) # DJs change

def updateChannelMeter(data):
    print("Received channel meter update", data["params"]) # Users vote

def updateChannelUserStatus(data):
    print("Received channel user status update", data["params"]) # User AFK, active, etc.

def leaveChannel(data):
    print("Received leave channel", data["params"]) # Command to leave channel
    global reconnect
    reconnect = False
    ws.close()

def playChannelTrack(data):
    print("Received play channel track", data["params"]) # Track starts playing

def pauseChannelTrack(data):
    print("Received pause channel track", data["params"]) # Track paused

eventHandlers = {
    "keepAwake": keepAwake,
    "ready": ready,
    "pushChannelMessage": pushChannelMessage,
    "pushNotification": pushNotification,
    "updateChannel": updateChannel,
    "updateChannelUsers": updateChannelUsers,
    "updateUser": updateUser,
    "updateChannelDjs": updateChannelDjs,
    "updateChannelMeter": updateChannelMeter,
    "updateChannelUserStatus": updateChannelUserStatus,
    "leaveChannel": leaveChannel,
    "playChannelTrack": playChannelTrack,
    "pauseChannelTrack": pauseChannelTrack
}

def onMessage(ws, message):
    data = json.loads(message)

    # Enhanced logging for all messages
    print(f"\n=== RECEIVED MESSAGE ===\nType: {data.get('method', 'response')}\nContent: {json.dumps(data, indent=2)}\n")

    if 'method' in data and data['method'] in eventHandlers:
        eventHandlers[data['method']](data)
    elif 'id' in data and data['id'] == joinId:
        if 'error' in data:
            print(f"Error joining channel: {data['error']['message']}")
        else:
            print(f"Successfully joined channel {channelId}")

def onPing(ws, message):
    print("Received ping from server")
    ws.pong()

def onPong(ws, message):
    print("Received pong from server")
    ws.ping()

def onOpen(ws):
    print("Connected to server")

def onClose(ws, close_status_code, close_msg):
    print(f"\n=== CONNECTION CLOSED ===\nStatus: {close_status_code}\nMessage: {close_msg}\n")
    if reconnect:
        print("Attempting to reconnect...")
        connect()

def onError(ws, error):
    print(f"WebSocket error: {error}")

def connect():
    global ws
    # attempt to connect to the WebSocket server
    ws = websocket.WebSocketApp(url, on_open=onOpen, on_message=onMessage, on_error=onError, on_close=onClose)
    ws.on_ping = onPing
    ws.on_pong = onPong
    ws.run_forever()

connect()