require('dotenv').config()
const WebSocket = require('ws')
const Anthropic = require('@anthropic-ai/sdk')
const fetch = require('node-fetch')
const fs = require('fs')

const SHREK_PROMPTS = [
    "Shrek doing yoga with james van der beek and vin diesel in a swamp",
    "Shrek baking cookies with all the miners from snow white",
    "Shrek at a disco party with james murphy and daft punk",
    "Shrek playing jazz saxophone with ben gibbard",
    "Shrek teaching a meditation class with the dalai lama",
    "Shrek as a barista making coffee with the cast of the always sunny in philadelphia",
    "Shrek gardening with onions and frank reynolds",
    "Shrek DJing at a rave with nic cage and john travolta",
    "Shrek painting like Bob Ross with miley cyrus",
    "Shrek doing ballet in a tutu with brittany spears and brittany murphy",
    "Shrek riding a ferriswheel with good friend james murphy",
    "Shrek at the olive garden with the cast of dawsons creek",
];

// Add file logging
const logToFile = (message) => {
    const timestamp = new Date().toISOString()
    const logMessage = `[${timestamp}] ${message}\n`
    fs.appendFileSync('bot-debug.log', logMessage)
}

class RvrbBot {
    constructor() {
        // Clear the log file on startup
        fs.writeFileSync('bot-debug.log', '')
        logToFile('Bot starting up...')

        // Validate environment variables
        const requiredEnvVars = {
            RVRB_API_KEY: process.env.RVRB_API_KEY,
            RVRB_CHANNEL_ID: process.env.RVRB_CHANNEL_ID,
            RVRB_BOT_NAME: process.env.RVRB_BOT_NAME,
            IMGBB_API_KEY: process.env.IMGBB_API_KEY,
            LASTFM_API_KEY: process.env.LASTFM_API_KEY
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
        this.healthCheckInterval = null
        this.lastHeartbeat = null
        this.lastHealthCheck = null
        this.ouijaSession = {
            active: false,
            message: '',
            lastUser: null,
            lastBotAddition: 0,  // Track when bot last added letters
            wordCompletionChance: 0.3,  // 30% chance to complete a word
            sentenceCompletionChance: 0.1  // 10% chance to complete a sentence
        };
        this.lastFmApiKey = process.env.LASTFM_API_KEY;
        this.lastPollinationsRequest = null;

        // Initialize Anthropic
        this.anthropic = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY
        })

        // Set up periodic health check (every 4 hours)
        this.healthCheckInterval = setInterval(() => this.performHealthCheck(), 4 * 60 * 60 * 1000);
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
        console.log('[WebSocket] Vote update received:', JSON.stringify(data))
        if (data.params && data.params.voting) {
            this.votes = data.params.voting
            console.log('[WebSocket] Updated votes:', JSON.stringify(this.votes))

            // Check if our bot's vote is in the data
            if (this.votes[this.botId]) {
                console.log('[WebSocket] Our vote was registered:', JSON.stringify(this.votes[this.botId]))
            } else {
                console.log('[WebSocket] Our vote was not found in the update')
            }
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

    async handleTrackPlay(data) {
        if (!data || !data.params || !data.params.track) {
            console.log('[WebSocket] Invalid track data received:', data)
            return
        }

        const track = data.params.track
        console.log('[WebSocket] Now playing:', track.name, 'by', track.artists[0].name)
        console.log('[WebSocket] Track ID:', track.id)
        console.log('[WebSocket] Initial voting state:', track.voting)

        // Wait for track to be fully loaded
        await new Promise(resolve => setTimeout(resolve, 5000))

        const voteMessage = {
            jsonrpc: '2.0',
            method: 'updateChannelMeter',
            params: {
                channelId: this.channelId,
                trackId: track.id,
                voting: {
                    bot: {
                        dope: 1,
                        nope: 0,
                        star: 0,
                        boofStar: 0,
                        votedCount: 1,
                        chat: 0
                    }
                }
            }
        }

        console.log('[WebSocket] Sending vote message:', JSON.stringify(voteMessage))
        try {
            this.ws.send(JSON.stringify(voteMessage))
            console.log('[WebSocket] Vote message sent successfully')
        } catch (error) {
            console.error('[WebSocket] Error sending vote:', error)
        }
    }

    autoVoteOnTrack(track) {
        this.sendBoofstar();
    }

    sendVote(vote = 0) {
        const voteMessage = {
            jsonrpc: '2.0',
            method: 'updateChannelMeter',
            params: {
                voting: {
                    bot: {
                        dope: vote > 0 ? 1 : 0,
                        nope: vote < 0 ? 1 : 0,
                        star: vote > 0.7 ? 1 : 0,
                        boofStar: 0,
                        votedCount: 1,
                        chat: 0
                    }
                }
            }
        }
        logToFile(`[Command] Sending vote: ${JSON.stringify(voteMessage)}`)
        console.log('[WebSocket] Sending vote:', JSON.stringify(voteMessage))
        this.ws.send(JSON.stringify(voteMessage))
    }

    sendBoofstar() {
        const voteMessage = {
            jsonrpc: '2.0',
            method: 'updateChannelMeter',
            params: {
                voting: {
                    [this.botId]: {
                        dope: 1,
                        nope: 0,
                        star: 1,
                        boofStar: 1,
                        votedCount: 1,
                        chat: 0
                    }
                }
            }
        }
        console.log('[WebSocket] Sending boofstar');
        this.ws.send(JSON.stringify(voteMessage));
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
            // Rate limiting - only allow one request every 2 seconds
            const now = Date.now();
            if (this.lastPollinationsRequest && (now - this.lastPollinationsRequest) < 2000) {
                console.log('Rate limiting: Waiting before next Pollinations request');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            this.lastPollinationsRequest = now;

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);

            // Add detailed personality traits and room-specific references
            const enhancedPrompt = `You are a musical/introspective bot that hangs out in a music listening room with a group of longtime friends. Keep responses thoughtful but not pretentious and not too verbose unless explicitly asked.
Be witty and clever, but maintain a sense of wisdom and you can be a bit edgy, dark, and sarcastic.
Stay grounded and authentic - avoid being too new-agey or preachy.
Music is a gateway to much of what we love and what we hate.
IMPORTANT: Keep responses brief unless asked to elaborate. Break up responses into short paragraphs using <hr> breaks between paragraph (if needed).

User's question: ${prompt}`;

            console.log('Sending request to Pollinations with prompt:', enhancedPrompt.substring(0, 100) + '...');

            const response = await fetch(`https://text.pollinations.ai/${encodeURIComponent(enhancedPrompt)}`, {
                method: 'GET',
                signal: controller.signal,
                headers: {
                    'Accept': 'text/plain',
                    'Referer': 'https://rvrb.one',
                    'User-Agent': 'RVRB-Bot/1.0'
                }
            });

            clearTimeout(timeout);

            if (!response.ok) {
                if (response.status === 429) {
                    console.error('Pollinations rate limit hit. Waiting before retry...');
                    // Wait 5 seconds before retrying
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    // Retry once
                    return this.getPollinationsTextResponse(prompt);
                }
                console.error('Pollinations HTTP error:', response.status, response.statusText);
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // Log the response headers for debugging
            console.log('Pollinations response headers:', response.headers);

            // Get the response as text
            const text = await response.text();
            console.log('Pollinations raw response:', text.substring(0, 100) + '...');

            // If the text is empty or just whitespace, throw an error
            if (!text || text.trim() === '') {
                console.error('Empty response from Pollinations');
                throw new Error('Empty response from Pollinations');
            }

            return text.trim();
        } catch (error) {
            if (error.name === 'AbortError') {
                console.error('Pollinations request timed out');
                throw new Error('Request timed out. Please try again.');
            }
            console.error('Pollinations text generation error:', error);
            throw new Error('Pollinations service is currently unavailable. Please try again later.');
        }
    }

    async getAIResponse(prompt, userName) {
        try {
            console.log('Attempting to get response from Pollinations...');
            const response = await this.getPollinationsTextResponse(prompt);
            console.log('Successfully got response from Pollinations');
            return response;
        } catch (error) {
            console.error('AI Error:', error.message);
            // Return a friendly fallback message instead of throwing
            return `Hey ${userName}! I'm having trouble with my AI service right now, but I'm still here and listening to the music with you! 🎵`;
        }
    }

    async generateImage(prompt) {
        try {
            console.log('Starting image generation for prompt:', prompt);

            // Generate image using Pollinations.ai with optimized parameters
            const enhancedPrompt = `${prompt}, highly detailed, sharp focus, professional quality, safe for work, no nudity, no explicit content`;
            const pollinationsUrl = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(enhancedPrompt) + '?nologo=true&width=1024&height=1024&seed=' + Math.floor(Math.random() * 1000000);

            const pollinationsResponse = await fetch(pollinationsUrl, {
                method: 'GET'
            });

            if (!pollinationsResponse.ok) {
                throw new Error(`HTTP error! status: ${pollinationsResponse.status}`);
            }

            // Get the image as buffer
            const buffer = await pollinationsResponse.arrayBuffer();

            if (!buffer || buffer.length === 0) {
                throw new Error('Generated image buffer is empty');
            }

            // Try uploading to ImgBB first
            try {
                const FormData = require('form-data');
                const form = new FormData();
                form.append('image', Buffer.from(buffer).toString('base64'));

                const imgbbResponse = await fetch(`https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`, {
                    method: 'POST',
                    body: form
                });

                const imgbbData = await imgbbResponse.json();

                if (imgbbData.success) {
                    return imgbbData.data.url;
                } else if (imgbbData.error && imgbbData.error.code === 100) {
                    // Rate limit reached, use direct Pollinations URL
                    console.log('ImgBB rate limit reached, using direct Pollinations URL');
                    return pollinationsUrl;
                } else {
                    console.error('ImgBB upload failed:', imgbbData);
                    // Fall through to Cloudinary
                }
            } catch (imgbbError) {
                console.error('ImgBB upload failed, falling back to Cloudinary:', imgbbError);
            }

            // Fallback to Cloudinary
            try {
                const cloudinary = require('cloudinary').v2;
                cloudinary.config({
                    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
                    api_key: process.env.CLOUDINARY_API_KEY,
                    api_secret: process.env.CLOUDINARY_API_SECRET
                });

                const result = await new Promise((resolve, reject) => {
                    cloudinary.uploader.upload_stream(
                        { resource_type: 'auto' },
                        (error, result) => {
                            if (error) reject(error);
                            else resolve(result);
                        }
                    ).end(Buffer.from(buffer));
                });

                if (!result || !result.secure_url) {
                    throw new Error('Failed to upload image to Cloudinary');
                }

                return result.secure_url;
            } catch (cloudinaryError) {
                console.error('Cloudinary upload failed:', cloudinaryError);
                // Final fallback: return direct Pollinations URL
                console.log('All upload services failed, returning direct Pollinations URL');
                return pollinationsUrl;
            }

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

            // Convert Fahrenheit to Celsius
            const tempF = Math.round(data.main.temp);
            const tempC = Math.round((tempF - 32) * 5 / 9);
            const feelsLikeF = Math.round(data.main.feels_like);
            const feelsLikeC = Math.round((feelsLikeF - 32) * 5 / 9);

            // Convert wind speed from mph to km/h (1 mph = 1.609344 km/h)
            const windMph = Math.round(data.wind.speed);
            const windKmh = Math.round(data.wind.speed * 1.609344);

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
                `Temperature: ${tempF}°F (${tempC}°C)\n` +
                `Feels like: ${feelsLikeF}°F (${feelsLikeC}°C)\n` +
                `Condition: ${data.weather[0].main} - ${data.weather[0].description}\n` +
                `Humidity: ${data.main.humidity}% 💧\n` +
                `Wind: ${windMph} mph (${windKmh} km/h) 💨`;
        } catch (error) {
            console.error('Weather error:', error);
            throw error;
        }
    }

    getMoodFromBPM(bpm) {
        if (bpm < 60) return 'chill and meditative';
        if (bpm < 90) return 'relaxed and mellow';
        if (bpm < 120) return 'upbeat and groovy';
        if (bpm < 140) return 'energetic and danceable';
        return 'intense and high-energy';
    }

    getVibeEmojis(track) {
        const emojis = [];

        // Energy level
        if (track.energy > 0.8) emojis.push('⚡');
        else if (track.energy > 0.5) emojis.push('✨');
        else emojis.push('🌙');

        // Danceability
        if (track.danceability > 0.8) emojis.push('💃');
        else if (track.danceability > 0.5) emojis.push('🕺');
        else emojis.push('🧘');

        // Mood
        if (track.valence > 0.8) emojis.push('😊');
        else if (track.valence > 0.5) emojis.push('😌');
        else emojis.push('😔');

        // Genre-specific
        if (track.genre?.toLowerCase().includes('house')) emojis.push('🏠');
        if (track.genre?.toLowerCase().includes('techno')) emojis.push('🔊');
        if (track.genre?.toLowerCase().includes('ambient')) emojis.push('🌌');

        return emojis.join(' ');
    }

    async getSimilarArtists(artistName) {
        try {
            const response = await fetch(
                `http://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${encodeURIComponent(artistName)}&api_key=${this.lastFmApiKey}&format=json`
            );
            const data = await response.json();

            if (data.similarartists?.artist) {
                return data.similarartists.artist
                    .slice(0, 5) // Get top 5 similar artists
                    .map(artist => artist.name);
            }
            return [];
        } catch (error) {
            console.error('Error fetching similar artists:', error);
            return [];
        }
    }

    async predictNextTrack(currentTrack) {
        try {
            const artistName = currentTrack.artists[0].name;
            const similarArtists = await this.getSimilarArtists(artistName);

            const predictions = [
                `Another ${currentTrack.genre || 'track'} from ${artistName}`,
                `A track by ${similarArtists[0] || 'a similar artist'}`,
                `A remix of this track`,
                `A classic from the same era`,
                `A track that samples this one`,
                `A collaboration between ${artistName} and ${similarArtists[1] || 'another artist'}`
            ];

            // Add more specific predictions if we have similar artists
            if (similarArtists.length > 0) {
                predictions.push(
                    `Something from ${similarArtists[2] || 'a similar artist'}'s discography`,
                    `A track that blends ${artistName} and ${similarArtists[3] || 'similar'} styles`
                );
            }

            return predictions[Math.floor(Math.random() * predictions.length)];
        } catch (error) {
            console.error('Error predicting next track:', error);
            return 'Something exciting and unexpected!';
        }
    }

    getCommonWords() {
        return [
            'hello', 'yes', 'no', 'maybe', 'help', 'danger', 'death', 'love', 'hate',
            'good', 'bad', 'soon', 'never', 'always', 'forever', 'spirit', 'ghost',
            'haunt', 'fear', 'hope', 'peace', 'war', 'life', 'die', 'live', 'come',
            'go', 'stay', 'leave', 'find', 'lost', 'search', 'seek', 'hide', 'show'
        ];
    }

    getCommonPhrases() {
        return [
            'the end is near',
            'beware the darkness',
            'trust no one',
            'help is coming',
            'you are not alone',
            'the truth lies within',
            'seek and you shall find',
            'time is running out',
            'the past haunts us',
            'future is uncertain',
            'death is not the end',
            'spirits are watching',
            'your fate is sealed',
            'escape while you can',
            'the answer is near'
        ];
    }

    shouldBotAddLetters() {
        const now = Date.now();
        // Only allow bot additions every 5 seconds
        if (now - this.ouijaSession.lastBotAddition < 5000) {
            return false;
        }
        return Math.random() < this.ouijaSession.wordCompletionChance;
    }

    shouldBotCompleteSentence() {
        const now = Date.now();
        if (now - this.ouijaSession.lastBotAddition < 5000) {
            return false;
        }
        return Math.random() < this.ouijaSession.sentenceCompletionChance;
    }

    getBotAddition(currentMessage) {
        // If message is empty or just started, don't add anything
        if (!currentMessage || currentMessage.length < 2) {
            return '';
        }

        // Check if we should complete a sentence
        if (this.shouldBotCompleteSentence()) {
            const phrases = this.getCommonPhrases();
            const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];
            return randomPhrase;
        }

        // Check if we should complete a word
        if (this.shouldBotAddLetters()) {
            const words = this.getCommonWords();
            const currentWord = currentMessage.split(' ').pop();

            // Find a word that starts with our current letters
            const possibleCompletions = words.filter(word =>
                word.startsWith(currentWord) && word !== currentWord
            );

            if (possibleCompletions.length > 0) {
                const completion = possibleCompletions[Math.floor(Math.random() * possibleCompletions.length)];
                return completion.slice(currentWord.length);
            }
        }

        return '';
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
                this.sendMessage(`Please provide a city name, state, or ZIP code (e.g., +weather New York or +weather 10001)`)
                return
            }
            try {
                const weatherReport = await this.getWeather(location)
                this.sendMessage(weatherReport)
            } catch (error) {
                this.sendMessage(`Sorry, I couldn't find weather information for that location! 🌡️`)
            }
            return
        } else if (command === 'ouija') {
            if (this.ouijaSession.active) {
                this.sendMessage(`The spirits are already speaking...`);
                return;
            }
            this.ouijaSession = {
                active: true,
                message: '',
                lastUser: null,
                lastBotAddition: 0,
                wordCompletionChance: 0.3,
                sentenceCompletionChance: 0.1
            };
            this.sendMessage(`The spirits are listening... Type a single letter or "goodbye" to end the session.`);
            return;
        } else if (command === 'nope') {
            logToFile(`[Command] Received nope command from ${userName}`)
            console.log('[WebSocket] Sending nope vote...')

            // Use sendVote with -1 for nope
            this.sendVote(-1)

            // Wait a moment before sending confirmation
            setTimeout(() => {
                this.sendMessage('👎 Nope vote cast!')
            }, 100)
            return
        } else if (this.ouijaSession.active) {
            // Handle ouija session messages
            if (command === 'goodbye') {
                const finalMessage = this.ouijaSession.message || '...';
                this.sendMessage(`The spirits say: "${finalMessage}"`);
                this.ouijaSession.active = false;
                return;
            }

            // Only allow single characters
            if (command.length === 1 && /[a-zA-Z0-9\s.,!?']/.test(command)) {
                if (this.ouijaSession.lastUser === userName) {
                    this.sendMessage(` The spirits don't like repeat messages...`);
                    return;
                }

                this.ouijaSession.message += command;
                this.ouijaSession.lastUser = userName;

                // Let the bot potentially add letters
                const botAddition = this.getBotAddition(this.ouijaSession.message);
                if (botAddition) {
                    this.ouijaSession.message += botAddition;
                    this.ouijaSession.lastBotAddition = Date.now();
                }

                this.sendMessage(`The spirits whisper: "${this.ouijaSession.message}"`);
                return;
            }

            this.sendMessage(`The spirits only understand single letters or "+goodbye"...`);
            return;
        } else if (command === 'mood') {
            if (!this.currentTrack) {
                this.sendMessage(`No track is currently playing!`);
                return;
            }
            const bpm = this.currentTrack.bpm || 120; // Default to 120 if BPM not available
            const mood = this.getMoodFromBPM(bpm);
            this.sendMessage(`Current track mood: ${mood} (${bpm} BPM)`);
            return;
        } else if (command === 'next') {
            if (!this.currentTrack) {
                this.sendMessage(`No track is currently playing!`);
                return;
            }
            const prediction = await this.predictNextTrack(this.currentTrack);
            this.sendMessage(`${prediction}`);
            return;
        } else if (command === 'vibe') {
            if (!this.currentTrack) {
                this.sendMessage(`No track is currently playing!`);
                return;
            }
            const emojis = this.getVibeEmojis(this.currentTrack);
            const vibeDescription = `Current track vibes: ${emojis}\n${this.currentTrack.name} by ${this.currentTrack.artists[0].name}`;
            this.sendMessage(`${vibeDescription}`);
            return;
        } else if (command === 'similar') {
            if (!this.currentTrack) {
                this.sendMessage(`No track is currently playing!`);
                return;
            }
            const artistName = this.currentTrack.artists[0].name;
            const similarArtists = await this.getSimilarArtists(artistName);

            if (similarArtists.length === 0) {
                this.sendMessage(`@${userName}: Couldn't find similar artists for ${artistName}. Try again later!`);
                return;
            }

            const similarList = similarArtists.map((artist, index) => `${index + 1}. ${artist}`).join('\n<hr>\n');
            this.sendMessage(`Artists similar to ${artistName}:\n<hr>\n${similarList}\n<hr>`);
            return;
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
        } else if (command.startsWith('+vote')) {
            console.log('[WebSocket] Received vote command')
            const voteMessage = {
                jsonrpc: '2.0',
                method: 'updateChannelMeter',
                params: {
                    voting: {
                        [this.botId]: {
                            dope: 1,
                            nope: 0,
                            star: 0,
                            boofStar: 0,
                            votedCount: 1,
                            chat: 0
                        }
                    }
                }
            }
            console.log('[WebSocket] Sending vote message:', JSON.stringify(voteMessage))
            try {
                this.ws.send(JSON.stringify(voteMessage))
                console.log('[WebSocket] Vote message sent successfully')
                return 'Vote sent!'
            } catch (error) {
                console.error('[WebSocket] Error sending vote:', error)
                return 'Error sending vote'
            }
        } else if (command.startsWith('spoiler ')) {
            const spoilerText = command.slice(8).trim();
            if (!spoilerText) {
                this.sendMessage('Please provide text to hide in the spoiler!');
                return;
            }

            // Create a clickable spoiler box using HTML
            const spoilerMessage = `<div style="background-color: #000; color: #000; padding: 5px; margin: 5px 0; cursor: pointer; user-select: none;" onclick="this.style.color='#fff'">Click to reveal spoiler</div><div style="display: none;">${spoilerText}</div>`;
            this.sendMessage(spoilerMessage);
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

            // --- BEGIN: Extra logging for vote/meter/track analysis ---
            const methodStr = parsed.method ? parsed.method.toLowerCase() : '';
            const paramsStr = parsed.params ? JSON.stringify(parsed.params).toLowerCase() : '';
            if (
                methodStr.includes('vote') ||
                methodStr.includes('meter') ||
                methodStr.includes('track') ||
                paramsStr.includes('vote') ||
                paramsStr.includes('meter') ||
                paramsStr.includes('track')
            ) {
                logToFile(`[DEBUG] Incoming message (method: ${parsed.method}): ${JSON.stringify(parsed)}`);
                console.log('[DEBUG] Incoming message (method:', parsed.method, '):', JSON.stringify(parsed));
            }
            // --- END: Extra logging ---

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
                                    // Check if this is our bot and set the botId
                                    if (user.type === 'bot' && user.displayName === this.botName) {
                                        console.log('[WebSocket] Found our bot in users list, setting botId:', user._id)
                                        this.botId = user._id
                                    }
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
                    console.log('[WebSocket] Full joinSuccess message:', JSON.stringify(parsed))
                    if (parsed.params && parsed.params.userId) {
                        this.botId = parsed.params.userId;
                        console.log('[WebSocket] Bot ID set to:', this.botId);
                    } else {
                        console.error('[WebSocket] No userId received in joinSuccess. Full params:', JSON.stringify(parsed.params));
                    }
                    this.hasJoinedChannel = true
                    break

                case 'pushChannelMessage':
                    if (parsed.params && parsed.params.userName !== 'RVRB') {
                        const message = parsed.params.payload.trim()

                        // Handle ouija session messages first
                        if (this.ouijaSession.active) {
                            if (message.toLowerCase() === 'goodbye') {
                                const finalMessage = this.ouijaSession.message || '...';
                                this.sendMessage(`The spirits say: "${finalMessage}"`);
                                this.ouijaSession.active = false;
                                return;
                            }

                            // Only allow single characters
                            if (message.length === 1 && /[a-zA-Z0-9\s.,!?']/.test(message)) {
                                if (this.ouijaSession.lastUser === parsed.params.userName) {
                                    this.sendMessage(`@${parsed.params.userName}: The spirits don't like repeat messages...`);
                                    return;
                                }
                                this.ouijaSession.message += message;
                                this.ouijaSession.lastUser = parsed.params.userName;
                                this.sendMessage(`The spirits whisper: "${this.ouijaSession.message}"`);
                                return;
                            }

                            // If it's not a valid ouija message, ignore it
                            return;
                        }

                        // Handle regular commands
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

    async performHealthCheck() {
        console.log('[Health Check] Starting periodic health check...');
        logToFile('[Health Check] Starting periodic health check...');

        const now = Date.now();
        this.lastHealthCheck = now;

        // Check if WebSocket connection is healthy
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.log('[Health Check] WebSocket connection is not healthy, attempting to reconnect...');
            logToFile('[Health Check] WebSocket connection is not healthy, attempting to reconnect...');
            this.reconnect();
            return;
        }

        // Check if we're still in the channel
        if (!this.hasJoinedChannel || !this.botId) {
            console.log('[Health Check] Bot not in channel, attempting to rejoin...');
            logToFile('[Health Check] Bot not in channel, attempting to rejoin...');

            // Send join message
            const joinData = {
                jsonrpc: '2.0',
                method: 'join',
                params: {
                    channelId: this.channelId
                }
            };
            console.log('[Health Check] Sending join request:', JSON.stringify(joinData));
            this.ws.send(JSON.stringify(joinData));
            return;
        }

        // Send a test message to verify we can still communicate
        try {
            const testMessage = {
                jsonrpc: '2.0',
                method: 'pushMessage',
                params: {
                    payload: '🤖 Health check passed - bot is still active!'
                }
            };
            this.ws.send(JSON.stringify(testMessage));
            console.log('[Health Check] Health check passed successfully');
            logToFile('[Health Check] Health check passed successfully');
        } catch (error) {
            console.error('[Health Check] Error during health check:', error);
            logToFile(`[Health Check] Error during health check: ${error.message}`);
            this.reconnect();
        }
    }

    run() {
        const url = `wss://app.rvrb.one/ws-bot?apiKey=${this.apiKey}`
        console.log('[WebSocket] Connecting to RVRB...')
        console.log('[WebSocket] Using API Key:', this.apiKey)
        console.log('[WebSocket] Bot Name:', this.botName)
        console.log('[WebSocket] Current botId:', this.botId)

        try {
            this.ws = new WebSocket(url, {
                handshakeTimeout: 30000,
                perMessageDeflate: false
            })

            this.ws.on('open', () => {
                console.log('[WebSocket] Connection established')
                console.log('[WebSocket] Connection state:', this.ws.readyState)
                console.log('[WebSocket] Current botId:', this.botId)

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
                console.log('[WebSocket] Sending bot profile:', JSON.stringify(botProfile))
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
                console.log('[WebSocket] Sending join request:', JSON.stringify(joinData))
                this.ws.send(JSON.stringify(joinData))
                console.log('[WebSocket] Sent join request')
            })

            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data)
                    console.log('[WebSocket] Raw message received:', data.toString())
                    console.log('[WebSocket] Message type:', message.method || 'response')
                    console.log('[WebSocket] Message params:', JSON.stringify(message.params))
                    console.log('[WebSocket] Current botId:', this.botId)

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