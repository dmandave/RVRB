require('dotenv').config()
const WebSocket = require('ws')

class RvrbBot {
    constructor() {
        // Debug: Show all environment variables
        console.log('Environment variables:', {
            RVRB_API_KEY: process.env.RVRB_API_KEY?.substring(0, 5) + '...', // Show just first 5 chars
            RVRB_CHANNEL_ID: process.env.RVRB_CHANNEL_ID,
            RVRB_BOT_NAME: process.env.RVRB_BOT_NAME,
            PWD: process.env.PWD, // Show current working directory
        })

        // Add environment variable validation
        const requiredEnvVars = {
            RVRB_API_KEY: process.env.RVRB_API_KEY,
            RVRB_CHANNEL_ID: process.env.RVRB_CHANNEL_ID,
            RVRB_BOT_NAME: process.env.RVRB_BOT_NAME
        }

        const missingVars = Object.entries(requiredEnvVars)
            .filter(([key, value]) => !value)
            .map(([key]) => key)

        if (missingVars.length > 0) {
            throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`)
        }

        this.apiKey = process.env.RVRB_API_KEY
        this.channelId = process.env.RVRB_CHANNEL_ID
        this.botName = process.env.RVRB_BOT_NAME
        this.botId = null
        this.ws = null
        this.users = {}
        this.votes = null

        // Debug: Show initialized values
        console.log('Bot initialized with exact values:', {
            botName: this.botName,
            channelId: this.channelId,
            apiKeyLength: this.apiKey?.length,
            apiKeyStart: this.apiKey?.substring(0, 5)
        })
    }

    stayAwake(data) {
        const message = {
            jsonrpc: '2.0',
            method: 'stayAwake',
            params: {
                date: Date.now().toString()
            }
        }
        this.ws.send(JSON.stringify(message))
    }

    sendMessage(message) {
        const messageData = {
            jsonrpc: '2.0',
            method: 'pushMessage',
            params: {
                payload: message
            }
        }
        console.log('Sending message:', JSON.stringify(messageData, null, 2))
        this.ws.send(JSON.stringify(messageData))
    }

    // Add vote tracking like doopBot
    updateVotes(data) {
        this.votes = data.params
        console.log('Current votes:', this.votes)
    }

    // Send a vote (up=1, down=0)
    sendVote(vote = 0) {
        const voteMessage = {
            jsonrpc: '2.0',
            method: 'updateChannelMeter',  // This is the method doopBot uses for votes
            params: {
                vote: vote,  // 0 for down, 1 for up
                channelId: this.channelId
            }
        }
        console.log('Sending vote:', JSON.stringify(voteMessage, null, 2))
        this.ws.send(JSON.stringify(voteMessage))
    }

    sendBoofstar() {
        const voteMessage = {
            jsonrpc: '2.0',
            method: 'updateChannelMeter',
            params: {
                channelId: this.channelId,
                vote: 1,  // 1 for upvote
                boofStar: true  // explicitly set boofstar flag
            }
        }
        console.log('Sending boofstar vote:', JSON.stringify(voteMessage, null, 2))
        this.ws.send(JSON.stringify(voteMessage))
    }

    onMessage(data) {
        try {
            const parsed = JSON.parse(data)

            // Debug: Log every message type we receive
            console.log('DEBUG - Received message type:', parsed.method)
            console.log('DEBUG - Full message:', JSON.stringify(parsed, null, 2))

            switch (parsed.method) {
                case 'ready':
                    this.botId = parsed.params.userId || parsed.params._id
                    console.log('Connected as bot:', this.botName)
                    break

                case 'updateChannelUsers':
                    this.users = parsed.params.users.reduce((acc, user) => {
                        acc[user._id] = user
                        return acc
                    }, {})
                    if (!this.botId) {
                        const botUser = Object.values(this.users).find(u => u.userName === this.botName)
                        if (botUser) this.botId = botUser._id
                    }
                    break

                case 'pushChannelMessage':
                    console.log('DEBUG - Chat message detected!')
                    console.log('DEBUG - Message details:', {
                        userName: parsed.params.userName,
                        message: parsed.params.payload,
                        fullParams: parsed.params
                    })

                    // Only respond to messages not from RVRB
                    if (parsed.params.userName !== 'RVRB') {
                        const message = parsed.params.payload.trim()
                        console.log('DEBUG - Processing message:', message)

                        // Handle commands that start with '+'
                        if (message.startsWith('+')) {
                            const command = message.slice(1).toLowerCase() // remove the '+' and convert to lowercase

                            switch (command) {
                                case 'hey':
                                    this.sendMessage('you')
                                    break
                                case 'hello':
                                    this.sendMessage(`Hello ${parsed.params.userName}! 👋`)
                                    break
                                case 'help':
                                    this.sendMessage('Available commands: +hey, +hello, +help')
                                    break
                                case 'ping':
                                    this.sendMessage('pong! 🏓')
                                    break
                            }
                        }
                    }
                    break

                case 'playChannelTrack':
                    const track = parsed.params.track
                    console.log(`Now playing: ${track.name} by ${track.artists[0].name}`)
                    setTimeout(() => {
                        this.sendBoofstar()
                        // this.sendMessage(`Boofstarred: ${track.name} by ${track.artists[0].name}`)
                    }, 2000)
                    break
            }
        } catch (e) {
            console.error('Error handling message:', e)
            console.error('Error details:', e.stack)
        }
    }

    run() {
        const url = `wss://app.rvrb.one/ws-bot?apiKey=${this.apiKey}`
        console.log('Attempting to connect with:', {
            botName: this.botName,
            channelId: this.channelId,
            apiKeyLength: this.apiKey?.length
        })

        this.ws = new WebSocket(url)

        this.ws.on('open', () => {
            console.log('WebSocket connection established')
            // Match doopBot's join message exactly
            const joinData = {
                jsonrpc: '2.0',
                method: 'join',
                params: {
                    channelId: this.channelId
                },
                id: 1
            }
            console.log('Sending join data:', JSON.stringify(joinData))
            this.ws.send(JSON.stringify(joinData))

            // Add bot profile like doopBot does
            const botProfile = {
                jsonrpc: '2.0',
                method: 'editUser',
                params: {
                    bio: 'I am iwyme bot! Use +help to see available commands.'
                }
            }
            this.ws.send(JSON.stringify(botProfile))
        })

        this.ws.on('message', (data) => {
            console.log('Raw message received:', data.toString())
            // Add keepAwake handling here
            try {
                const parsed = JSON.parse(data)
                if (parsed.method === 'keepAwake') {
                    const stayAwakeMessage = {
                        jsonrpc: '2.0',
                        method: 'stayAwake',
                        params: {
                            date: Date.now().toString()
                        }
                    }
                    this.ws.send(JSON.stringify(stayAwakeMessage))
                    return
                }
                this.onMessage(data)
            } catch (e) {
                console.error('Error parsing message:', e)
            }
        })

        this.ws.on('error', (error) => {
            console.error('WebSocket error:', error)
        })

        this.ws.on('close', (code, reason) => {
            console.log('WebSocket closed:', {
                code: code,
                reason: reason?.toString()
            })
            // Try to reconnect after a delay
            setTimeout(() => {
                console.log('Attempting to reconnect...')
                this.run()
            }, 5000)
        })
    }
}

// Run the bot
const bot = new RvrbBot()
bot.run()
