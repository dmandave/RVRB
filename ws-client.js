require('dotenv').config()
const WebSocket = require('ws')

class RvrbBot {
    constructor() {
        this.apiKey = process.env.RVRB_API_KEY
        this.channelId = process.env.RVRB_CHANNEL_ID
        this.botName = process.env.RVRB_BOT_NAME
        this.botId = null
        this.ws = null
        this.users = {}
        this.votes = null
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
        if (!this.botId) {
            console.error('No bot ID available for voting!')
            return
        }

        const voteMessage = {
            jsonrpc: '2.0',
            method: 'updateChannelMeter',
            params: {
                userId: this.botId,
                voting: {
                    [this.botId]: {
                        dope: 0,
                        nope: 1,
                        star: 1,
                        boofStar: 1,
                        votedCount: 1,
                        chat: 0
                    }
                }
            }
        }
        console.log('Sending boofstar for current track')
        this.ws.send(JSON.stringify(voteMessage))
    }

    onMessage(data) {
        try {
            const parsed = JSON.parse(data)

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

                case 'playChannelTrack':
                    const track = parsed.params.track
                    console.log(`Now playing: ${track.name} by ${track.artists[0].name}`)
                    setTimeout(() => {
                        this.sendBoofstar()
                        this.sendMessage(`Boofstarred: ${track.name} by ${track.artists[0].name}`)
                    }, 2000)
                    break
            }
        } catch (e) {
            console.error('Error handling message:', e)
        }
    }

    run() {
        const url = `wss://app.rvrb.one/ws-bot?apiKey=${this.apiKey}`
        this.ws = new WebSocket(url)

        this.ws.on('open', () => {
            console.log('Connected to RVRB')
            const joinData = {
                method: 'join',
                params: {
                    channelId: this.channelId
                },
                id: 1
            }
            this.ws.send(JSON.stringify(joinData))
        })

        this.ws.on('message', (data) => this.onMessage(data))
        this.ws.on('error', (error) => console.error('WebSocket error:', error))
        this.ws.on('close', () => console.log('Disconnected from RVRB'))
    }
}

// Run the bot
const bot = new RvrbBot()
bot.run()
