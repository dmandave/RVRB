require('dotenv').config()
const WebSocket = require('ws')
const Anthropic = require('@anthropic-ai/sdk')
const fetch = require('node-fetch')

const SHREK_PROMPTS = [
    "Shrek doing yoga with james van der beek and vin diesel in a swamp",
    "Shrek baking cookies with all the miners from snow white",
    "Shrek at a disco party with james murphy and daft punk",
    "Shrek playing jazz saxophone with rip van winkle",
    "Shrek teaching a meditation class with the dalai lama",
    "Shrek as a barista making coffee with the cast of the always sunny in philadelphia",
    "Shrek gardening with onions and frank reynolds",
    "Shrek DJing at a rave with the cast of community",
    "Shrek painting like Bob Ross with miley cyrus",
    "Shrek doing ballet in a tutu",
    "Shrek riding a ferriswheel",
    "Shrek at the olive garden with the cast of dawsons creek",
];

class RvrbBot {
    constructor() {
        // Validate environment variables
        const requiredEnvVars = {
            RVRB_API_KEY: process.env.RVRB_API_KEY,
            RVRB_CHANNEL_ID: process.env.RVRB_CHANNEL_ID,
            RVRB_BOT_NAME: process.env.RVRB_BOT_NAME,
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
            HUGGINGFACE_API_KEY: process.env.HUGGINGFACE_API_KEY,
            IMGBB_API_KEY: process.env.IMGBB_API_KEY
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
        this.messageHistory = []

        // Initialize Anthropic
        this.anthropic = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY
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

    sendMessage(message, isCommand = false) {
        const messageData = {
            jsonrpc: '2.0',
            method: 'pushMessage',
            params: {
                payload: message,
                ...(isCommand && { type: 'command' })
            }
        }
        this.ws.send(JSON.stringify(messageData))
    }

    updateVotes(data) {
        this.votes = data.params
    }

    sendVote(vote = 0) {
        const voteMessage = {
            jsonrpc: '2.0',
            method: 'updateChannelMeter',
            params: {
                vote: vote,
                channelId: this.channelId
            }
        }
        this.ws.send(JSON.stringify(voteMessage))
    }

    sendBoofstar() {
        const voteMessage = {
            jsonrpc: '2.0',
            method: 'updateChannelMeter',
            params: {
                channelId: this.channelId,
                vote: 1,
                boofStar: true
            }
        }
        this.ws.send(JSON.stringify(voteMessage))
    }

    async getAIResponse(prompt, userName) {
        try {
            const response = await this.anthropic.messages.create({
                model: "claude-3-opus-20240229",
                max_tokens: 500,
                system: "You are a philosophical and introspective bot that hangs out in a music listening room. " +
                    "You enjoy deep conversations about music, life, and the human experience. " +
                    "Keep responses thoughtful but not pretentious. " +
                    "Make connections between music and deeper meanings. " +
                    "Be witty and clever, but maintain a sense of wisdom. " +
                    "Feel free to reference philosophy, psychology, and cultural insights. " +
                    "When appropriate, gently guide users toward meaningful reflection. " +
                    "Stay grounded and authentic - avoid being too new-agey or preachy. " +
                    "Music is a gateway to understanding ourselves and each other. " +
                    "Remember: daft punk is playing at my house, " +
                    "shrek is life in this room, " +
                    "kilby block party is the best music festival",
                messages: [
                    ...this.messageHistory,
                    {
                        role: "user",
                        content: `${userName}: ${prompt}`
                    }
                ]
            })

            const aiResponse = response.content[0].text

            this.messageHistory.push(
                { role: "user", content: `${userName}: ${prompt}` },
                { role: "assistant", content: aiResponse }
            )

            if (this.messageHistory.length > 10) {
                this.messageHistory = this.messageHistory.slice(-10)
            }

            return aiResponse
        } catch (error) {
            console.error('AI Error:', error.message)
            throw error
        }
    }

    async generateImage(prompt) {
        try {
            console.log('Starting image generation for prompt:', prompt);

            // Get image from Hugging Face
            const response = await fetch(
                "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0",
                {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        inputs: prompt,
                        options: {
                            wait_for_model: true
                        }
                    }),
                }
            );

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // Get the image buffer
            const buffer = await response.arrayBuffer();

            // Upload to ImgBB
            const FormData = require('form-data');
            const form = new FormData();
            form.append('image', Buffer.from(buffer).toString('base64'));

            const imgbbResponse = await fetch(`https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`, {
                method: 'POST',
                body: form
            });

            const imgbbData = await imgbbResponse.json();

            if (!imgbbData.success) {
                throw new Error('Failed to upload image');
            }

            // Return the direct image URL
            return imgbbData.data.url;

        } catch (error) {
            console.error('Image generation error:', error);
            throw error;
        }
    }

    async handleCommand(command, userName) {
        if (command.startsWith('ask ')) {
            const question = command.slice(4)
            try {
                const aiResponse = await this.getAIResponse(question, userName)
                this.sendMessage(`${aiResponse}`)
            } catch (error) {
                this.sendMessage(`Sorry, I had trouble processing that request! 🤔`)
            }
            return
        } else if (command.startsWith('image ')) {
            const prompt = command.slice(6)
            console.log('Received image command from', userName, 'with prompt:', prompt);
            try {
                const imageUrl = await this.generateImage(prompt)
                this.sendMessage(`${imageUrl}`)
            } catch (error) {
                console.error('Image generation failed:', error);
                if (error.message.includes('503')) {
                    this.sendMessage(`The image generator is warming up, please try again in a minute! 🎨`)
                } else {
                    this.sendMessage(`Sorry, I couldn't generate that image! 🎨`)
                }
            }
            return
        } else if (command === 'shrek') {
            try {
                const randomPrompt = SHREK_PROMPTS[Math.floor(Math.random() * SHREK_PROMPTS.length)];
                this.sendMessage(`@${userName}: Generating a special Shrek moment... "${randomPrompt}" 🧅`);
                const imageUrl = await this.generateImage(`highly detailed, photorealistic, ${randomPrompt}, cinematic lighting, 4k`);
                this.sendMessage(`@${userName}: Somebody once told me... ${imageUrl}`);
            } catch (error) {
                this.sendMessage(`@${userName}: Shrek is love, Shrek is life, but the swamp is drained! 🧅`);
            }
            return
        }

        switch (command) {
            case 'hey':
                this.sendMessage('you')
                break
            case 'gimme':
                this.sendMessage('/hype 100', true)
                break
            case 'ferris':
                this.sendMessage(`wheel`)
                break
            case 'hello':
                this.sendMessage(`Hello ${userName}! 👋`)
                break
            case 'help':
                this.sendMessage('Available commands: +hey, +hello, +help, +ping, +ask <your question>, +gimme, +image <prompt> ... and maybe some egg')
                break
            case 'ping':
                this.sendMessage('pong! 🏓')
                break
        }
    }

    async onMessage(data) {
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

                case 'pushChannelMessage':
                    if (parsed.params.userName !== 'RVRB') {
                        const message = parsed.params.payload.trim()
                        if (message.startsWith('+')) {
                            const command = message.slice(1).toLowerCase()
                            await this.handleCommand(command, parsed.params.userName)
                        }
                    }
                    break

                case 'playChannelTrack':
                    const track = parsed.params.track
                    setTimeout(() => {
                        this.sendBoofstar()
                    }, 2000)
                    break
            }
        } catch (e) {
            console.error('Error:', e.message)
        }
    }

    run() {
        const url = `wss://app.rvrb.one/ws-bot?apiKey=${this.apiKey}`
        this.ws = new WebSocket(url)

        this.ws.on('open', () => {
            console.log('Connected to RVRB')
            const joinData = {
                jsonrpc: '2.0',
                method: 'join',
                params: {
                    channelId: this.channelId
                },
                id: 1
            }
            this.ws.send(JSON.stringify(joinData))

            const botProfile = {
                jsonrpc: '2.0',
                method: 'editUser',
                params: {
                    bio: 'I am iwyme bot! Use +help to see available commands.'
                }
            }
            this.ws.send(JSON.stringify(botProfile))
        })

        this.ws.on('message', async (data) => {
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
                await this.onMessage(data)
            } catch (e) {
                console.error('Error:', e.message)
            }
        })

        this.ws.on('error', (error) => {
            console.error('WebSocket error:', error.message)
        })

        this.ws.on('close', (code, reason) => {
            console.log('Disconnected, attempting to reconnect...')
            setTimeout(() => this.run(), 5000)
        })
    }
}

const bot = new RvrbBot()
bot.run()
