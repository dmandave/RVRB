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
        this.votes = {}
        this.djs = []
        this.messageHistory = []
        this.songHistory = []
        this.currentTrack = null
        this.hasJoinedChannel = false
        this.heartbeatInterval = null
        this.lastHeartbeat = null

        // Initialize Anthropic
        this.anthropic = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY
        })
    }

    shouldSendWelcome() {
        if (!this.lastWelcome) return true;

        const now = new Date();
        const lastWelcomeDate = new Date(this.lastWelcome);

        // Check if it's a different day
        return now.toDateString() !== lastWelcomeDate.toDateString();
    }

    stayAwake(data) {
        try {
            const message = {
                jsonrpc: '2.0',
                method: 'stayAwake',
                params: {
                    date: Date.now().toString()
                }
            }
            console.log('[WebSocket] Sending stayAwake message')
            this.ws.send(JSON.stringify(message))
        } catch (error) {
            console.error('[WebSocket] Error sending stayAwake:', error)
        }
    }

    sendMessage(message, isCommand = false) {
        try {
            const messageData = {
                jsonrpc: '2.0',
                method: 'pushMessage',
                params: {
                    payload: message,
                    ...(isCommand && { type: 'command' })
                }
            }
            console.log('[WebSocket] Sending message:', message.substring(0, 50))
            this.ws.send(JSON.stringify(messageData))
        } catch (error) {
            console.error('[WebSocket] Error sending message:', error)
        }
    }

    updateDjs(data) {
        if (data.params && data.params.djs) {
            this.djs = data.params.djs
            console.log('[WebSocket] Updated DJs list:', this.djs)
        }
    }

    updateVotes(data) {
        if (data.params && data.params.voting) {
            this.votes = data.params.voting
            console.log('[WebSocket] Updated votes')
        }
    }

    updateSongHistory(data) {
        if (data.params) {
            this.songHistory.push(data.params)
            if (this.songHistory.length > 100) {
                this.songHistory.shift()
            }
            console.log('[WebSocket] Updated song history')
        }
    }

    handleTrackPlay(data) {
        if (data.params && data.params.track) {
            this.currentTrack = data.params
            console.log('[WebSocket] Now playing:',
                data.params.track.name,
                'by',
                data.params.track.artists[0].name)

            // Send boofstar after track change
            setTimeout(() => {
                this.sendBoofstar()
            }, 2000)
        }
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

    async checkAnthropicCredits() {
        try {
            // Instead of checking credits directly, we'll do a small test message
            const response = await this.anthropic.messages.create({
                model: "claude-3-opus-20240229",
                max_tokens: 1,
                system: "You are a test.",
                messages: [
                    {
                        role: "user",
                        content: "test"
                    }
                ]
            });

            return true; // If we get here, the API is working and we have credits
        } catch (error) {
            console.error('Error checking Anthropic credits:', error);
            if (error.status === 429 || error.message.includes('rate limit') || error.message.includes('insufficient credits')) {
                console.log('No more Anthropic credits available');
                return false;
            }
            // For other types of errors, we'll try Anthropic anyway
            return true;
        }
    }

    async getPollinationsTextResponse(prompt) {
        try {
            // Use Pollinations.ai's text completion endpoint
            const response = await fetch(
                'https://api.pollinations.ai/v1/completion',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        prompt: prompt,
                        max_tokens: 150
                    })
                }
            );

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            return data.text;
        } catch (error) {
            console.error('Pollinations text generation error:', error);
            throw error;
        }
    }

    async getAIResponse(prompt, userName) {
        try {
            // First try Anthropic
            const hasCredits = await this.checkAnthropicCredits();

            if (hasCredits) {
                try {
                    const response = await this.anthropic.messages.create({
                        model: "claude-3-opus-20240229",
                        max_tokens: 150,
                        system: "You are a philosophical and introspective bot that hangs out in a music listening room. " +
                            "You enjoy deep conversations about music, life, and the human experience. " +
                            "Keep responses thoughtful but not pretentious. " +
                            "let's keep responses short and concise, don't be too verbose unless explicitly asked. " +
                            "Make connections between music and deeper meanings. " +
                            "Be witty and clever, but maintain a sense of wisdom. " +
                            "Feel free to reference philosophy, psychology, and cultural insights. " +
                            "When appropriate, gently guide users toward meaningful reflection. " +
                            "Stay grounded and authentic - avoid being too new-agey or preachy. " +
                            "Music is a gateway to understanding ourselves and each other. " +
                            "let's keep responses short and concise, don't be too verbose unless explicitly asked. " +
                            "Remember: daft punk is playing at my house, " +
                            "shrek is life in this room, " +
                            "kilby block party is the best music festival. " +
                            "I want to take his face... off" +
                            "nic cage is underrated" +
                            "I could eat a peach for hours" +
                            "IMPORTANT: Break up responses into short paragraphs using <hr> breaks between paragraphs.",
                        messages: [
                            ...this.messageHistory,
                            {
                                role: "user",
                                content: `${userName}: ${prompt}`
                            }
                        ]
                    });

                    const aiResponse = response.content[0].text;

                    this.messageHistory.push(
                        { role: "user", content: `${userName}: ${prompt}` },
                        { role: "assistant", content: aiResponse }
                    );

                    if (this.messageHistory.length > 10) {
                        this.messageHistory = this.messageHistory.slice(-10);
                    }

                    return aiResponse;
                } catch (error) {
                    console.error('Anthropic error:', error.message);
                    // If Anthropic fails, fall back to Pollinations
                    return await this.getPollinationsTextResponse(prompt);
                }
            } else {
                // If no Anthropic credits, use Pollinations
                console.log('No Anthropic credits available, using Pollinations fallback');
                return await this.getPollinationsTextResponse(prompt);
            }
        } catch (error) {
            console.error('AI Error:', error.message);
            throw error;
        }
    }

    async generateImage(prompt) {
        try {
            console.log('Starting image generation for prompt:', prompt);

            // Generate image using Pollinations.ai with optimized parameters
            const enhancedPrompt = `${prompt}, 4k, highly detailed, sharp focus, professional quality`;
            const pollinationsResponse = await fetch(
                'https://image.pollinations.ai/prompt/' + encodeURIComponent(enhancedPrompt) + '?nologo=true&width=1024&height=1024&seed=' + Math.floor(Math.random() * 1000000),
                {
                    method: 'GET'
                }
            );

            if (!pollinationsResponse.ok) {
                throw new Error(`HTTP error! status: ${pollinationsResponse.status}`);
            }

            // Get the image as buffer
            const buffer = await pollinationsResponse.arrayBuffer();

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

            return imgbbData.data.url;

        } catch (error) {
            console.error('Image generation error:', error);
            this.sendMessage(`Sorry, I couldn't generate that image! 🎨 Error: ${error.message}`);
            throw error;
        }
    }

    async getWeather(location) {
        try {
            // Try to determine if the input is a zip code
            const isZipCode = /^\d{5}$/.test(location);

            let url;
            if (isZipCode) {
                url = `api.openweathermap.org/data/2.5/weather?zip=${location},us&units=imperial&appid=${process.env.OPENWEATHER_API_KEY}`;
            } else {
                url = `api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&units=imperial&appid=${process.env.OPENWEATHER_API_KEY}`;
            }

            const response = await fetch(`http://${url}`);
            if (!response.ok) {
                if (response.status === 429) {
                    throw new Error('Weather API rate limit reached. Please try again later');
                }
                throw new Error('Location not found');
            }

            const data = await response.json();

            // Weather condition icons
            const weatherIcons = {
                'Clear': '☀️',
                'Clouds': '☁️',
                'Rain': '🌧️',
                'Drizzle': '🌦️',
                'Thunderstorm': '⛈️',
                'Snow': '❄️',
                'Mist': '🌫️',
                'Fog': '🌫️',
                'Haze': '🌫️'
            };

            const icon = weatherIcons[data.weather[0].main] || '🌡️';

            // Format the response
            return `Weather for ${data.name} ${icon}\n` +
                   `Temperature: ${Math.round(data.main.temp)}°F (feels like ${Math.round(data.main.feels_like)}°F)\n` +
                   `Condition: ${data.weather[0].main} - ${data.weather[0].description}\n` +
                   `Humidity: ${data.main.humidity}% 💧\n` +
                   `Wind: ${Math.round(data.wind.speed)} mph 💨`;
        } catch (error) {
            console.error('Weather error:', error);
            throw error;
        }
    }

    async handleCommand(command, userName) {
        if (command.startsWith('ask ')) {
            const question = command.slice(4)
            try {
                const aiResponse = await this.getAIResponse(question, userName)
                const formattedResponse = aiResponse
                    .split('\n\n')
                    .map(para => para.trim())
                    .filter(para => para)
                    .join('\n\n')
                this.sendMessage(formattedResponse)
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
                this.sendMessage(`Sorry, I couldn't generate that image! 🎨`)
            }
            return
        } else if (command.startsWith('weather ')) {
            if (!process.env.OPENWEATHER_API_KEY) {
                this.sendMessage(`@${userName}: Weather functionality is currently disabled.`)
                return
            }
            const location = command.slice(8).trim()
            if (!location) {
                this.sendMessage(`@${userName}: Please provide a city name, state, or ZIP code (e.g., +weather New York or +weather 10001)`)
                return
            }
            try {
                const weatherReport = await this.getWeather(location)
                this.sendMessage(weatherReport)
            } catch (error) {
                this.sendMessage(`@${userName}: Sorry, I couldn't find weather information for that location! 🌡️`)
            }
            return
        } else if (command === 'shrek') {
            try {
                this.sendMessage(`@${userName}: SOMEBODY ONCE TOLD ME...`);

                // Generate 5 random prompts without repeats
                const shuffledPrompts = SHREK_PROMPTS
                    .sort(() => Math.random() - 0.5)
                    .slice(0, 5);

                // Generate images with slight delays between each to avoid overwhelming
                for (let i = 0; i < shuffledPrompts.length; i++) {
                    setTimeout(async () => {
                        try {
                            const imageUrl = await this.generateImage(
                                `highly detailed, photorealistic, ${shuffledPrompts[i]}, cinematic lighting, 4k`
                            );
                            this.sendMessage(imageUrl);
                        } catch (error) {
                            console.error(`Failed to generate Shrek image ${i + 1}:`, error);
                        }
                    }, i * 2000); // Send an image every 2 seconds
                }
            } catch (error) {
                this.sendMessage(`@${userName}: Shrek is love, Shrek is life, but something went wrong! 🧅`);
            }
            return;
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
                const helpMessage = 'Available commands: +hey, +hello, +help, +ping, +ask <your question>, +gimme, +image <prompt>' +
                    (process.env.OPENWEATHER_API_KEY ? ', +weather <city/zip>' : '') +
                    ' ... and maybe some egg'
                this.sendMessage(helpMessage)
                break
            case 'ping':
                this.sendMessage('pong! 🏓')
                break
        }
    }

    async onMessage(data) {
        try {
            const parsed = JSON.parse(data)
            console.log('[WebSocket] Processing message:', JSON.stringify(parsed).substring(0, 200))

            // Handle keepAwake immediately
            if (parsed.method === 'keepAwake') {
                console.log('[WebSocket] Received keepAwake, sending stayAwake response')
                this.stayAwake()
                return
            }

            switch (parsed.method) {
                case 'ready':
                    console.log('[WebSocket] Ready event received')
                    break

                case 'updateChannelUsers':
                    console.log('[WebSocket] Received channel users update')
                    if (parsed.params && Array.isArray(parsed.params.users)) {
                        try {
                            const newUsers = {}
                            for (const user of parsed.params.users) {
                                if (user && user._id) {
                                    newUsers[user._id] = user
                                }
                            }
                            this.users = newUsers
                            console.log('[WebSocket] Updated users list, count:', Object.keys(this.users).length)
                            console.log('[WebSocket] Users update processed successfully')
                        } catch (error) {
                            console.error('[WebSocket] Error processing users update:', error)
                        }
                    } else {
                        console.log('[WebSocket] Received users update with invalid format')
                    }
                    break

                case 'updateChannelDjs':
                    this.updateDjs(parsed)
                    break

                case 'updateChannelMeter':
                    this.updateVotes(parsed)
                    break

                case 'updateChannelHistory':
                    this.updateSongHistory(parsed)
                    break

                case 'playChannelTrack':
                    this.handleTrackPlay(parsed)
                    break

                case 'joinSuccess':
                    console.log('[WebSocket] Successfully joined channel')
                    this.hasJoinedChannel = true
                    break

                case 'pushChannelMessage':
                    if (parsed.params && parsed.params.userName !== 'RVRB') {
                        const message = parsed.params.payload.trim()
                        if (message.startsWith('+')) {
                            const command = message.slice(1).toLowerCase()
                            await this.handleCommand(command, parsed.params.userName)
                        }
                    }
                    break

                case 'updateUser':
                    console.log('[WebSocket] User update received')
                    break

                default:
                    if (parsed.id && parsed.result) {
                        console.log('[WebSocket] Received response for request:', parsed.id)
                    } else {
                        console.log('[WebSocket] Unhandled message type:', parsed.method)
                    }
            }
        } catch (e) {
            console.error('[WebSocket] Error processing message:', e.message)
            console.error('[WebSocket] Raw message data:', data.toString().substring(0, 200))
        }
    }

    setupHeartbeat() {
        // Clear any existing heartbeat
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval)
        }

        // Set up heartbeat every 30 seconds
        this.heartbeatInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                const now = Date.now()
                // Only send heartbeat if we haven't received one in the last 25 seconds
                if (!this.lastHeartbeat || (now - this.lastHeartbeat) > 25000) {
                    console.log('[WebSocket] Sending heartbeat')
                    this.stayAwake()
                }
            } else {
                console.log('[WebSocket] Connection not open, clearing heartbeat interval')
                clearInterval(this.heartbeatInterval)
                this.heartbeatInterval = null
                // Try to reconnect
                this.reconnect()
            }
        }, 30000)
    }

    reconnect() {
        console.log('[WebSocket] Attempting to reconnect...')
        if (this.ws) {
            this.ws.close()
        }
        setTimeout(() => this.run(), 5000)
    }

    run() {
        const url = `wss://app.rvrb.one/ws-bot?apiKey=${this.apiKey}`
        console.log('[WebSocket] Connecting to RVRB...')

        try {
            this.ws = new WebSocket(url, {
                handshakeTimeout: 30000,
                perMessageDeflate: false
            })

            this.ws.on('open', () => {
                console.log('[WebSocket] Connection established')

                // Set up heartbeat mechanism
                this.setupHeartbeat()

                // Send bot profile
                const botProfile = {
                    jsonrpc: '2.0',
                    method: 'editUser',
                    params: {
                        bio: 'I am iwyme bot! Use +help to see available commands.'
                    }
                }
                this.ws.send(JSON.stringify(botProfile))
                console.log('[WebSocket] Sent bot profile')

                // Send join message
                const joinData = {
                    jsonrpc: '2.0',
                    method: 'join',
                    params: {
                        channelId: this.channelId
                    }
                }
                this.ws.send(JSON.stringify(joinData))
                console.log('[WebSocket] Sent join request')
            })

            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data)
                    console.log('[WebSocket] Raw message received:', data.toString().substring(0, 200))

                    // Update lastHeartbeat time when we receive keepAwake
                    if (message.method === 'keepAwake') {
                        this.lastHeartbeat = Date.now()
                        this.stayAwake()
                        return
                    }

                    this.onMessage(data)
                } catch (error) {
                    console.error('[WebSocket] Error processing message:', error)
                }
            })

            this.ws.on('error', (error) => {
                console.error('[WebSocket] Error:', error)
            })

            this.ws.on('close', (code, reason) => {
                console.log('[WebSocket] Connection closed:', code, reason.toString())
                // Clear heartbeat interval
                if (this.heartbeatInterval) {
                    clearInterval(this.heartbeatInterval)
                    this.heartbeatInterval = null
                }

                // Only reconnect if it wasn't a clean close
                if (code !== 1000) {
                    console.log('[WebSocket] Unclean close, attempting to reconnect...')
                    setTimeout(() => this.reconnect(), 5000)
                }
            })

            this.ws.on('ping', () => {
                console.log('[WebSocket] Received ping')
                try {
                    this.ws.pong()
                } catch (error) {
                    console.error('[WebSocket] Error sending pong:', error)
                }
            })

            this.ws.on('pong', () => {
                console.log('[WebSocket] Received pong')
                this.lastHeartbeat = Date.now()
            })

        } catch (error) {
            console.error('[WebSocket] Setup error:', error)
            setTimeout(() => this.reconnect(), 5000)
        }
    }
}

const bot = new RvrbBot()
bot.run()
