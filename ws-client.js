require('dotenv').config()
const WebSocket = require('ws')
const Anthropic = require('@anthropic-ai/sdk')
const fetch = require('node-fetch')
const fs = require('fs')

// Random Shrek generator using mad-libs style approach
const SHREK_VERBS = [
    "skydiving", "breakdancing", "performing surgery", "conducting an orchestra", "piloting",
    "working as a lifeguard", "doing standup comedy", "racing", "performing magic tricks",
    "running", "teaching", "hosting", "playing video games", "doing synchronized swimming",
    "working as a wedding photographer", "giving a ted talk", "participating in a drag race",
    "operating a food truck", "playing chess", "working as a barista", "gardening",
    "DJing", "painting", "doing ballet", "riding", "baking cookies", "doing yoga",
    "teaching meditation", "working as a detective", "flying a kite", "scuba diving",
    "rock climbing", "surfing", "skiing", "bungee jumping", "parasailing", "mountain biking",
    "working as a firefighter", "delivering mail", "working as a librarian", "selling insurance"
];

const SHREK_LOCATIONS = [
    "in a swamp", "underwater", "on mars", "at a bingo hall", "in a hot air balloon",
    "at a pool party", "in space", "at a taco stand", "in a construction site",
    "on a cooking show", "at a gaming tournament", "in a swimming pool", "at a wedding",
    "on a ted stage", "at a drag strip", "in a food truck", "at a chess tournament",
    "in a coffee shop", "in a garden", "at a rave", "in an art studio", "at a ballet",
    "on a ferris wheel", "in a bakery", "at a yoga studio", "in a meditation center",
    "at a crime scene", "in the sky", "under the sea", "on a mountain", "at the beach",
    "on a ski slope", "over a canyon", "in the clouds", "on a bike trail", "at a fire station",
    "on a mail route", "in a library", "at an insurance office", "in a laboratory",
    "at a circus", "in a haunted house", "at a theme park", "in a submarine", "olive garden"
];

const SHREK_COMPANIONS = [
    "dr phil", "the teletubbies", "gordon ramsay", "a mermaid and a robot",
    "andre 3000", "snoop dogg", "the cast of friends", "dave chappelle", "lewis hamilton and a tortoise",
    "david blaine and a confused goat", "neil armstrong and an alien", "confused construction workers",
    "martha stewart", "ninja and a goldfish", "the spice girls and a hippo", "elvis impersonators",
    "stephen hawking", "lightning mcqueen and a bicycle", "mythical creatures", "a rubber duck",
    "james van der beek", "vin diesel", "a confused penguin", "the miners from snow white",
    "james murphy", "daft punk", "ben gibbard", "the dalai lama", "frank reynolds",
    "nic cage", "john travolta", "miley cyrus", "brittany spears", "brittany murphy",
    "a group of confused dolphins", "a time-traveling wizard", "a sentient toaster",
    "a team of professional clowns", "a family of talking cats", "a robot butler",
    "a group of competitive eaters", "a choir of singing vegetables", "a detective duck",
    "a superhero squirrel", "a gang of dancing robots", "a wise old owl", "a group of ninja turtles", "nic cage", "the cast of the fast and the furious"
];

const SHREK_ACCESSORIES = [
    "in a tuxedo", "with a rubber duck", "wearing a wizard hat", "in a superhero cape",
    "with a monocle", "wearing bunny ears", "in a chef's hat", "with a detective badge",
    "wearing a crown", "with a magic wand", "in a lab coat", "wearing a cowboy hat",
    "with a pirate eyepatch", "wearing a top hat", "with a bow tie", "in a space suit",
    "wearing a tutu", "with a cape", "in a kimono", "wearing a sombrero", "with a propeller hat",
    "wearing a graduation cap", "with a chef's apron", "in a hazmat suit", "wearing a hard hat",
    "with a feather boa", "wearing a tiara", "in a karate gi", "with a butt snorkel",
    "wearing a firefighter helmet", "with a mail bag", "in a librarian outfit", "with a briefcase"
];

// Function to generate a random Shrek prompt
function generateRandomShrekPrompt() {
    const verb = SHREK_VERBS[Math.floor(Math.random() * SHREK_VERBS.length)];
    const location = SHREK_LOCATIONS[Math.floor(Math.random() * SHREK_LOCATIONS.length)];
    const companion = SHREK_COMPANIONS[Math.floor(Math.random() * SHREK_COMPANIONS.length)];
    const accessory = SHREK_ACCESSORIES[Math.floor(Math.random() * SHREK_ACCESSORIES.length)];

    // Sometimes add the accessory, sometimes don't for variety
    const useAccessory = Math.random() < 0.3; // 30% chance of using accessory

    if (useAccessory) {
        return `Shrek ${verb} ${accessory} ${location} with ${companion}`;
    } else {
        return `Shrek ${verb} ${location} with ${companion}`;
    }
}

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
        this.reconnectTimer = null
        this.isReconnecting = false
        this.intentionalClose = false
        // keepAwake arrives ~every 30s; treat silence longer than this as a dead socket
        this.heartbeatStaleMs = 2 * 60 * 1000
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
        this.conversationMemory = new Map(); // per-user chat history for +ask follow-ups
        this.conversationMaxMessages = 12; // keep last 6 user/assistant turns
        this.conversationTtlMs = 30 * 60 * 1000; // 30 min idle timeout
        this.roomChatHistory = []; // shared recent room chat for +ask context
        this.roomChatMaxMessages = 40;
        this.roomChatMaxAgeMs = 60 * 60 * 1000; // 1 hour
        this.aiSystemPrompt = 'You are a witty, clever bot in a music chat room on RVRB. Keep replies short, friendly, and authentic. Use the current user\'s prior turns for follow-ups. When helpful, also use recent room chat context (other people\'s messages). Use markdown only: **bold**, *italic*, and `code` — never raw HTML tags.';
        this.worldCupKnownGoals = new Set();
        this.worldCupAnnouncedFinals = new Set();
        this.worldCupAnnouncedKickoffs = new Set();
        this.worldCupLiveMatchIds = new Set();
        this.worldCupStateFile = 'worldcup-goals-state.json';
        this.worldCupRankings = null;
        this.worldCupRankingsFetchedAt = null;
        this.worldCupMatchesCache = null;
        this.worldCupMatchesCacheAt = null;
        this.worldCupStadiumsCache = null;
        this.worldCupDataSource = null;
        this.worldCupPollInterval = null;
        this.worldCupPollInProgress = false;
        this.worldCupAnnounceGoals = false;
        this.worldCupGoalsEnabled = process.env.WORLD_CUP_GOALS_ENABLED !== 'false';
        this.lastWorldCupGoal = null;
        this.lastWorldCupGoalFetchedAt = null;
        this.loadWorldCupGoalState();

        // User-registered stock shortcuts from +stock TICKER (e.g. +goog after +stock GOOG)
        this.customStockCommands = new Map([
            ['rddt', 'RDDT']
        ]);
        this.customStockCommandsFile = 'custom-stock-commands.json';
        this.reservedCommands = new Set([
            'ask', 'image', 'weather', 'spoiler', 'stock', 'hey', 'gimme', 'gme', 'gold', 'silver',
            'ferris', 'hello', 'help', 'ping', 'goal', 'shrek', 'vote', 'ouija', 'goodbye', 'forget',
            'pollen', 'spooky'
        ]);
        this.spookyScale = {
            5: { label: 'most spooky', gif: 'https://i.ibb.co/B2QnPZmm/spooky-scale-5.gif' },
            4: { label: 'pretty spooky', gif: 'https://i.ibb.co/jkc1Jv06/spooky-scale-4.gif' },
            3: { label: 'middle level spooky', gif: 'https://i.ibb.co/xS4kgnpp/spooky-scale-3.gif' },
            2: { label: 'not much', gif: 'https://i.ibb.co/ccf4WBqD/spooky-scale-2.gif' },
            1: { label: 'least spooky', gif: 'https://i.ibb.co/pvmdm00r/spooky-scale-1.gif' }
        };
        this.loadCustomStockCommands();

        // Initialize Anthropic
        this.anthropic = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY
        })

        // Periodic health check every 15 minutes (RVRB daily resets often drop the socket cleanly)
        this.healthCheckInterval = setInterval(() => this.performHealthCheck(), 15 * 60 * 1000);
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

    // RVRB chat sanitizes HTML: <strong>/<em> render; <b>/<i>/<code> are escaped as text.
    // Convert markdown (and disallowed tags) to the allowlisted forms. Leave `code` as backticks.
    formatMarkdownForChat(text) {
        if (!text || typeof text !== 'string') return text
        return text
            // Normalize disallowed emphasis tags the model may emit
            .replace(/<\/?b>/gi, (m) => m.startsWith('</') ? '</strong>' : '<strong>')
            .replace(/<\/?i>/gi, (m) => m.startsWith('</') ? '</em>' : '<em>')
            // Unwrap <code>…</code> back to backticks (tag is escaped in chat)
            .replace(/<code>([^<]*)<\/code>/gi, '`$1`')
            // Markdown → allowlisted HTML
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>')
            // Collapse fenced code blocks to plain text with backticks
            .replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) => `\`${String(code).trim()}\``)
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

        this.currentTrack = track

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

    _isPollinationsBillingError(error) {
        const msg = String(error?.message || error || '').toLowerCase();
        return (
            msg.includes('status: 402') ||
            msg.includes('insufficient balance') ||
            msg.includes('insufficient pollen') ||
            msg.includes('payment required') ||
            (msg.includes('pollen') && (msg.includes('balance') || msg.includes('credit')))
        );
    }

    _formatPollenAmount(balance) {
        const n = Number(balance);
        if (!Number.isFinite(n)) return String(balance);
        if (n === 0) return '0';
        if (Math.abs(n) >= 1) return (Math.round(n * 100) / 100).toString();
        // Small balances: up to 6 decimals, trim trailing zeros
        return n.toFixed(6).replace(/\.?0+$/, '');
    }

    async getPollinationsBalance() {
        const apiKey = process.env.POLLINATIONS_API_KEY;
        if (!apiKey) {
            throw new Error('POLLINATIONS_API_KEY is not configured');
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
            const response = await fetch('https://gen.pollinations.ai/account/balance', {
                method: 'GET',
                signal: controller.signal,
                headers: {
                    Accept: 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                    'User-Agent': 'RVRB-Bot/1.0'
                }
            });

            const bodyText = await response.text().catch(() => '');
            if (!response.ok) {
                let detail = bodyText.substring(0, 180).replace(/\s+/g, ' ');
                try {
                    const parsed = JSON.parse(bodyText);
                    detail = parsed?.error?.message || parsed?.message || detail;
                } catch (_) { /* keep raw snippet */ }
                throw new Error(`HTTP ${response.status}: ${detail || response.statusText}`);
            }

            const data = bodyText ? JSON.parse(bodyText) : {};
            const balance = data?.balance ?? data?.pollen ?? data?.pollenBalance;
            if (balance == null || !Number.isFinite(Number(balance))) {
                throw new Error('Balance response missing a numeric balance field');
            }
            return { balance: Number(balance), raw: data };
        } finally {
            clearTimeout(timeout);
        }
    }

    async getPollinationsTextResponse(prompt, historyMessages = [], systemPrompt = null) {
        const paidModel = process.env.POLLINATIONS_TEXT_MODEL || 'openai';
        const freeModel = process.env.POLLINATIONS_TEXT_MODEL_FREE || 'YoannDev90/laguna-s-2.1:free';

        try {
            return await this._pollinationsChatCompletions(prompt, historyMessages, systemPrompt, paidModel);
        } catch (paidError) {
            if (
                freeModel &&
                freeModel !== paidModel &&
                this._isPollinationsBillingError(paidError)
            ) {
                console.warn(
                    `[Pollinations] Paid model "${paidModel}" out of Pollen. Falling back to free model "${freeModel}"...`
                );
                return await this._pollinationsChatCompletions(prompt, historyMessages, systemPrompt, freeModel);
            }
            throw paidError;
        }
    }

    async _pollinationsChatCompletions(prompt, historyMessages = [], systemPrompt = null, model) {
        // Exponential backoff with jitter and limited retries
        const maxRetries = 4;
        let attempt = 0;
        let lastError;

        // Rate limit across attempts: ensure at least 2s between starts
        const now = Date.now();
        if (this.lastPollinationsRequest && (now - this.lastPollinationsRequest) < 2000) {
            const remaining = 2000 - (now - this.lastPollinationsRequest);
            console.log(`Rate limiting: Waiting ${remaining}ms before next Pollinations request`);
            await new Promise(resolve => setTimeout(resolve, remaining));
        }

        const messages = [
            { role: 'system', content: systemPrompt || this.aiSystemPrompt },
            ...historyMessages,
            { role: 'user', content: prompt }
        ];

        while (attempt <= maxRetries) {
            const startAttempt = Date.now();
            this.lastPollinationsRequest = startAttempt;

            const controller = new AbortController();
            const timeoutMs = 20000;
            const timeout = setTimeout(() => controller.abort(), timeoutMs);

            try {
                console.log(`[Pollinations] Attempt ${attempt + 1}/${maxRetries + 1} chat/completions (${messages.length} msgs, model=${model})...`);
                const headers = {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'Referer': 'https://rvrb.one',
                    'User-Agent': 'RVRB-Bot/1.0'
                };
                if (process.env.POLLINATIONS_API_KEY) {
                    headers['Authorization'] = `Bearer ${process.env.POLLINATIONS_API_KEY}`;
                }

                const response = await fetch('https://gen.pollinations.ai/v1/chat/completions', {
                    method: 'POST',
                    signal: controller.signal,
                    headers,
                    body: JSON.stringify({
                        model,
                        messages,
                        temperature: 0.7,
                        max_tokens: 400
                    })
                });

                clearTimeout(timeout);

                if (!response.ok) {
                    const errorText = await response.text().catch(() => '');
                    const httpError = new Error(
                        `HTTP error! status: ${response.status}${errorText ? ` — ${errorText.substring(0, 120)}` : ''}`
                    );

                    // Billing / empty wallet: fail fast (retries won't help)
                    if (response.status === 402 || this._isPollinationsBillingError(httpError)) {
                        throw httpError;
                    }

                    if ([429, 500, 502, 503, 504].includes(response.status)) {
                        const base = Math.min(2000 * Math.pow(2, attempt), 15000);
                        const jitter = Math.floor(Math.random() * 500);
                        const delay = base + jitter;
                        console.error(`Pollinations HTTP error: ${response.status} ${response.statusText} (attempt ${attempt + 1}). ${errorText.substring(0, 200)} Backing off ${delay}ms...`);
                        if (attempt < maxRetries) {
                            await new Promise(resolve => setTimeout(resolve, delay));
                            attempt++;
                            continue;
                        }
                    }
                    throw httpError;
                }

                const data = await response.json();
                const text = data?.choices?.[0]?.message?.content
                    || data?.choices?.[0]?.text
                    || '';
                console.log(`[Pollinations] chat response via ${model}:`, String(text).substring(0, 100) + '...');

                if (!text || String(text).trim() === '') {
                    throw new Error('Empty response from Pollinations');
                }

                return String(text).trim();
            } catch (error) {
                clearTimeout(timeout);
                lastError = error;

                // Don't retry empty-wallet / payment errors
                if (this._isPollinationsBillingError(error)) {
                    throw error;
                }

                if (error.name === 'AbortError') {
                    console.error(`[Pollinations] Request timed out on attempt ${attempt + 1}`);
                } else {
                    console.error('[Pollinations] chat generation error:', error);
                }

                if (attempt < maxRetries) {
                    const base = Math.min(2000 * Math.pow(2, attempt), 15000);
                    const jitter = Math.floor(Math.random() * 500);
                    const delay = base + jitter;
                    console.log(`[Pollinations] Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    attempt++;
                    continue;
                }

                if (error.name === 'AbortError') {
                    throw new Error('Request timed out. Please try again.');
                }
                throw new Error('Pollinations service is currently unavailable. Please try again later.');
            }
        }

        throw lastError || new Error('Unknown error contacting Pollinations');
    }

    async getAnthropicTextResponse(prompt, historyMessages = [], systemPrompt = null) {
        if (!this.anthropic || !process.env.ANTHROPIC_API_KEY) {
            throw new Error('Anthropic not configured');
        }
        try {
            const messages = [
                ...historyMessages.map(m => ({
                    role: m.role === 'assistant' ? 'assistant' : 'user',
                    content: m.content
                })),
                { role: 'user', content: prompt }
            ];
            // Anthropic requires alternating user/assistant; merge consecutive same-role if needed
            const normalized = [];
            for (const msg of messages) {
                const prev = normalized[normalized.length - 1];
                if (prev && prev.role === msg.role) {
                    prev.content += `\n\n${msg.content}`;
                } else {
                    normalized.push({ ...msg });
                }
            }
            if (normalized[0]?.role !== 'user') {
                normalized.unshift({ role: 'user', content: '(continuing conversation)' });
            }

            const resp = await this.anthropic.messages.create({
                model: process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest",
                max_tokens: 400,
                temperature: 0.7,
                system: systemPrompt || this.aiSystemPrompt,
                messages: normalized
            });
            const text = resp?.content?.[0]?.text || '';
            if (!text || text.trim() === '') {
                throw new Error('Empty response from Anthropic');
            }
            return text.trim();
        } catch (error) {
            console.error('[Anthropic] error:', error);
            throw error;
        }
    }

    pruneRoomChatHistory() {
        const cutoff = Date.now() - this.roomChatMaxAgeMs;
        this.roomChatHistory = this.roomChatHistory
            .filter(entry => entry.at >= cutoff)
            .slice(-this.roomChatMaxMessages);
    }

    recordRoomChat(userName, text, { isBot = false } = {}) {
        if (!text || typeof text !== 'string') return;
        const cleaned = text.replace(/\s+/g, ' ').trim();
        if (!cleaned) return;
        // Skip noisy/short noise; keep real chat + asks
        if (cleaned.length === 1) return;
        this.roomChatHistory.push({
            userName: String(userName || 'anon'),
            text: cleaned.slice(0, 280),
            isBot: !!isBot,
            at: Date.now()
        });
        this.pruneRoomChatHistory();
    }

    clearRoomChatHistory() {
        const had = this.roomChatHistory.length > 0;
        this.roomChatHistory = [];
        return had;
    }

    formatRoomChatContext(excludeUserName = null, limit = 25) {
        this.pruneRoomChatHistory();
        if (!this.roomChatHistory.length) return '';
        const lines = this.roomChatHistory
            .slice(-limit)
            .map(entry => {
                const who = entry.isBot ? (entry.userName || 'bot') : entry.userName;
                return `${who}: ${entry.text}`;
            });
        return lines.join('\n');
    }

    formatCurrentTrackContext() {
        const track = this.currentTrack;
        if (!track) return '';
        const artist = track.artists?.map(a => a.name).join(', ') || 'Unknown artist';
        const link = track.external_urls?.spotify || (track.id ? `https://open.spotify.com/track/${track.id}` : null);
        const album = track.album?.name;
        let line = `Currently playing in the room: "${track.name}" by ${artist}`;
        if (album) line += `, from the album "${album}"`;
        if (link) line += ` (${link})`;
        line += '. If asked about the current song, artist, album, or producer, use this and your own knowledge to answer.';
        return line;
    }

    buildAiSystemPrompt(userName) {
        const roomCtx = this.formatRoomChatContext(userName);
        const trackCtx = this.formatCurrentTrackContext();
        let prompt = this.aiSystemPrompt;
        if (trackCtx) {
            prompt += `\n\n${trackCtx}`;
        }
        if (roomCtx) {
            prompt += `\n\nRecent room chat (shared context — use when the user refers to the room, a song discussion, or what someone else said):\n${roomCtx}`;
        }
        return prompt;
    }

    getConversation(userName) {
        const key = String(userName || 'anon').toLowerCase();
        const existing = this.conversationMemory.get(key);
        if (!existing) return { key, messages: [] };
        if (Date.now() - existing.updatedAt > this.conversationTtlMs) {
            this.conversationMemory.delete(key);
            return { key, messages: [] };
        }
        return { key, messages: existing.messages };
    }

    rememberConversationTurn(userName, userContent, assistantContent) {
        const { key, messages } = this.getConversation(userName);
        const next = [
            ...messages,
            { role: 'user', content: userContent },
            { role: 'assistant', content: assistantContent }
        ].slice(-this.conversationMaxMessages);
        this.conversationMemory.set(key, { messages: next, updatedAt: Date.now() });
        // Also fold into shared room history so others' follow-ups can reference it
        this.recordRoomChat(userName, `+ask ${userContent}`);
        this.recordRoomChat(this.botName || 'bot', assistantContent, { isBot: true });
        return next;
    }

    clearConversation(userName) {
        const key = String(userName || 'anon').toLowerCase();
        const had = this.conversationMemory.has(key);
        this.conversationMemory.delete(key);
        return had;
    }

    // Asks the AI to rate the current track 1-5 on the spooky scale. Stateless: no chat memory is read or written.
    async getSpookyRating() {
        const track = this.currentTrack;
        const artist = track.artists?.map(a => a.name).join(', ') || 'Unknown artist';
        const systemPrompt = 'You rate songs on a 1-5 spooky scale: 5 = most spooky, 4 = pretty spooky, 3 = middle level spooky, 2 = not much, 1 = least spooky. ' +
            'Judge the mood, sound, lyrics, themes and reputation of the song. Reply with a single digit from 1 to 5 and nothing else.';
        const prompt = `Rate this song: "${track.name}" by ${artist}${track.album?.name ? `, from the album "${track.album.name}"` : ''}.`;

        let raw;
        try {
            raw = await this.getPollinationsTextResponse(prompt, [], systemPrompt);
        } catch (pollinationsError) {
            console.error('[SPOOKY] Pollinations failed:', pollinationsError?.message || pollinationsError);
            if (!process.env.ANTHROPIC_API_KEY) throw pollinationsError;
            raw = await this.getAnthropicTextResponse(prompt, [], systemPrompt);
        }

        const match = String(raw).match(/[1-5]/);
        if (!match) throw new Error(`Unparseable spooky rating: ${String(raw).slice(0, 80)}`);
        return Number(match[0]);
    }

    async getAIResponse(prompt, userName) {
        const { messages: history } = this.getConversation(userName);
        const systemPrompt = this.buildAiSystemPrompt(userName);
        console.log(`[AI] ${userName}: ${history.length} personal msg(s), ${this.roomChatHistory.length} room chat line(s)`);

        // Try Pollinations first with robust retry/backoff
        try {
            console.log('Attempting to get response from Pollinations...');
            const response = await this.getPollinationsTextResponse(prompt, history, systemPrompt);
            console.log('Successfully got response from Pollinations');
            this.rememberConversationTurn(userName, prompt, response);
            return response;
        } catch (pollinationsError) {
            console.error('[AI] Pollinations failed:', pollinationsError?.message || pollinationsError);
        }

        // Fallback to Anthropic if configured
        if (process.env.ANTHROPIC_API_KEY) {
            try {
                console.log('[AI] Falling back to Anthropic...');
                const response = await this.getAnthropicTextResponse(prompt, history, systemPrompt);
                console.log('Successfully got response from Anthropic');
                this.rememberConversationTurn(userName, prompt, response);
                return response;
            } catch (anthropicError) {
                console.error('[AI] Anthropic fallback failed:', anthropicError?.message || anthropicError);
            }
        } else {
            console.log('[AI] Anthropic not configured (ANTHROPIC_API_KEY not set), skipping fallback');
        }

        // Final friendly fallback (do not store in memory)
        console.error('[AI] All AI services failed. Returning fallback message.');
        return `Hey ${userName}! I'm having trouble with my AI service right now, but I'm still here and listening to the music with you! 🎵`;
    }

    _buildGenPollinationsImageUrl(enhancedPrompt, { model, width, height, seed }) {
        const u = new URL(`https://gen.pollinations.ai/image/${encodeURIComponent(enhancedPrompt)}`);
        u.searchParams.set('model', model);
        u.searchParams.set('width', String(width));
        u.searchParams.set('height', String(height));
        if (seed != null && seed !== '') {
            u.searchParams.set('seed', String(seed));
        }
        return u.toString();
    }

    _buildLegacyPollinationsImageUrl(enhancedPrompt, width, height, seed) {
        return `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}?width=${width}&height=${height}&nologo=true&seed=${seed}`;
    }

    async generateImage(prompt) {
        try {
            console.log('Starting image generation for prompt:', prompt);

            const enhancedPrompt = `${prompt}, highly detailed, sharp focus, professional quality, safe for work, no nudity, no explicit content`;
            const seed = Math.floor(Math.random() * 1000000);
            const apiKey = process.env.POLLINATIONS_API_KEY;
            // Docs: use Bearer OR ?key= — prefer Bearer only so long prompts + pk_ keys do not blow URL limits
            const baseHeaders = {
                'User-Agent': 'RVRB-Bot/1.0',
                Accept: '*/*'
            };
            if (apiKey) {
                baseHeaders['Authorization'] = `Bearer ${apiKey}`;
            }

            const strategies = [
                { label: 'gen flux 1024', url: this._buildGenPollinationsImageUrl(enhancedPrompt, { model: 'flux', width: 1024, height: 1024, seed }) },
                { label: 'gen zimage 1024', url: this._buildGenPollinationsImageUrl(enhancedPrompt, { model: 'zimage', width: 1024, height: 1024, seed }) },
                { label: 'gen flux 512 (no seed)', url: this._buildGenPollinationsImageUrl(enhancedPrompt, { model: 'flux', width: 512, height: 512, seed: null }) },
                { label: 'gen zimage 512 (no seed)', url: this._buildGenPollinationsImageUrl(enhancedPrompt, { model: 'zimage', width: 512, height: 512, seed: null }) },
                { label: 'legacy image.pollinations 1024', url: this._buildLegacyPollinationsImageUrl(enhancedPrompt, 1024, 1024, seed) }
            ];

            let pollinationsResponse;
            let pollinationsUrl;
            let lastStatus = 0;
            let lastBodySnippet = '';

            for (const { label, url } of strategies) {
                pollinationsUrl = url;
                let retries = 2;
                while (retries >= 0) {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 45000);

                    try {
                        pollinationsResponse = await fetch(url, {
                            method: 'GET',
                            signal: controller.signal,
                            headers: { ...baseHeaders }
                        });
                        clearTimeout(timeout);

                        if (pollinationsResponse.ok) {
                            console.log(`[Pollinations image] OK via ${label}`);
                            break;
                        }

                        lastStatus = pollinationsResponse.status;
                        const errBody = await pollinationsResponse.text();
                        lastBodySnippet = errBody.substring(0, 280).replace(/\s+/g, ' ');
                        console.error(`[Pollinations image] ${label} HTTP ${pollinationsResponse.status}: ${lastBodySnippet}`);

                        if ([500, 502, 503, 504].includes(pollinationsResponse.status) && retries > 0) {
                            await new Promise(r => setTimeout(r, 2000));
                            retries--;
                            continue;
                        }
                        pollinationsResponse = null;
                        break;
                    } catch (error) {
                        clearTimeout(timeout);
                        console.error(`[Pollinations image] ${label} fetch error:`, error?.message || error);
                        if ((error.name === 'AbortError' || error.message?.includes('fetch')) && retries > 0) {
                            await new Promise(r => setTimeout(r, 2000));
                            retries--;
                            continue;
                        }
                        pollinationsResponse = null;
                        break;
                    }
                }

                if (pollinationsResponse && pollinationsResponse.ok) {
                    break;
                }
            }

            if (!pollinationsResponse || !pollinationsResponse.ok) {
                const detail = lastBodySnippet ? ` (${lastBodySnippet})` : '';
                throw new Error(`HTTP error! status: ${lastStatus || pollinationsResponse?.status || 'unknown'}${detail}`);
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
            // Don't send message here - let the command handler do it
            throw error;
        }
    }

    async getPriceStatus(ticker, name) {
        try {
            // Use Yahoo Finance public API endpoint with proper headers
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=2d`;
            console.log(`[${name}] Fetching data from:`, url);

            // Add timeout using AbortController
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

            let response;
            try {
                response = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Accept': 'application/json',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Referer': 'https://finance.yahoo.com/'
                    },
                    signal: controller.signal
                });
                clearTimeout(timeout);
            } catch (fetchError) {
                clearTimeout(timeout);
                if (fetchError.name === 'AbortError') {
                    throw new Error('Request timed out');
                }
                throw fetchError;
            }

            console.log(`[${name}] Response status:`, response.status, response.statusText);

            if (!response.ok) {
                const errorText = await response.text().catch(() => '');
                console.error(`[${name}] API error response:`, errorText);
                throw new Error(`API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            console.log(`[${name}] Received data structure:`, JSON.stringify(data).substring(0, 500));

            if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
                console.error(`[${name}] No chart result in response`);
                throw new Error('No data available');
            }

            const result = data.chart.result[0];
            const quote = result.indicators?.quote?.[0];
            const meta = result.meta;

            console.log(`[${name}] Meta data:`, JSON.stringify(meta).substring(0, 300));
            console.log(`[${name}] Quote data available:`, !!quote);

            if (!quote || !quote.close || quote.close.length === 0) {
                console.error(`[${name}] No close prices in quote data`);
                throw new Error('No price data available');
            }

            // Get the most recent close price (last non-null value)
            const closePrices = quote.close.filter(price => price !== null && price !== undefined);
            if (closePrices.length === 0) {
                throw new Error('No valid price data available');
            }

            const currentPrice = closePrices[closePrices.length - 1];
            const previousClose = meta?.previousClose || (closePrices.length > 1 ? closePrices[closePrices.length - 2] : null);

            console.log(`[${name}] Current price:`, currentPrice, 'Previous close:', previousClose);

            if (!previousClose || !currentPrice) {
                throw new Error('Insufficient price data');
            }

            // Determine if price is up or down
            const isUp = currentPrice > previousClose;

            console.log(`[${name}] Price is`, isUp ? 'UP' : 'DOWN');

            return {
                isUp,
                currentPrice: currentPrice.toFixed(2),
                previousClose: previousClose.toFixed(2),
                change: (currentPrice - previousClose).toFixed(2),
                changePercent: (((currentPrice - previousClose) / previousClose) * 100).toFixed(2)
            };
        } catch (error) {
            console.error(`[${name}] Fetch error:`, error.message, error.stack);
            throw error;
        }
    }

    async getGMEStockStatus() {
        return this.getPriceStatus('GME', 'GME');
    }

    async getGoldStatus() {
        // GC=F is the gold futures ticker on Yahoo Finance
        return this.getPriceStatus('GC=F', 'GOLD');
    }

    async getSilverStatus() {
        // SI=F is the silver futures ticker on Yahoo Finance
        return this.getPriceStatus('SI=F', 'SILVER');
    }

    normalizeStockTicker(raw) {
        if (!raw || typeof raw !== 'string') return null;
        const ticker = raw.trim().toUpperCase();
        // Yahoo symbols: AAPL, BRK-B, BRK.B, GC=F, ^GSPC
        if (!/^[A-Z0-9.^=-]{1,12}$/.test(ticker)) return null;
        return ticker;
    }

    async sendStockSquare(ticker, label = ticker) {
        const stockData = await this.getPriceStatus(ticker, label);
        this.sendMessage(stockData.isUp ? '🟩' : '🟥');
        return stockData;
    }

    registerStockCommand(ticker) {
        const command = ticker.toLowerCase();
        if (this.reservedCommands.has(command)) {
            return { command, registered: false, reason: 'reserved' };
        }
        const isNew = !this.customStockCommands.has(command);
        this.customStockCommands.set(command, ticker);
        if (isNew) {
            this.saveCustomStockCommands();
        }
        return { command, registered: isNew, reason: null };
    }

    loadCustomStockCommands() {
        try {
            if (!fs.existsSync(this.customStockCommandsFile)) return;
            const data = JSON.parse(fs.readFileSync(this.customStockCommandsFile, 'utf8'));
            if (!data || typeof data !== 'object') return;
            for (const [cmd, ticker] of Object.entries(data)) {
                const normalized = this.normalizeStockTicker(String(ticker));
                const command = String(cmd).toLowerCase();
                if (!normalized || this.reservedCommands.has(command)) continue;
                this.customStockCommands.set(command, normalized);
            }
            console.log(`[STOCK] Loaded ${this.customStockCommands.size} custom stock command(s)`);
        } catch (error) {
            console.error('[STOCK] Failed to load custom stock commands:', error.message);
        }
    }

    saveCustomStockCommands() {
        try {
            const data = Object.fromEntries(this.customStockCommands);
            fs.writeFileSync(this.customStockCommandsFile, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('[STOCK] Failed to save custom stock commands:', error.message);
        }
    }

    startWorldCupGoalTracking() {
        if (!this.worldCupGoalsEnabled) {
            console.log('[World Cup] Goal tracking disabled via WORLD_CUP_GOALS_ENABLED=false');
            return;
        }

        if (this.worldCupPollInterval) {
            return;
        }

        console.log('[World Cup] Starting match tracking (polling every 25s)');
        logToFile('[World Cup] Starting match tracking');

        this.worldCupAnnounceGoals = false;

        this.pollWorldCupGoals().then(() => {
            this.worldCupAnnounceGoals = true;
            logToFile('[World Cup] Initial seed complete, will announce kickoffs, goals, and final scores');
        });

        this.worldCupPollInterval = setInterval(() => {
            this.pollWorldCupGoals();
        }, 25 * 1000);
    }

    stopWorldCupGoalTracking() {
        if (this.worldCupPollInterval) {
            clearInterval(this.worldCupPollInterval);
            this.worldCupPollInterval = null;
        }
    }

    onChannelJoined() {
        if (!this.botId) {
            return;
        }

        this.hasJoinedChannel = true;
        console.log('[WebSocket] Bot joined channel, botId:', this.botId);
        logToFile(`[WebSocket] Bot joined channel, botId: ${this.botId}`);
        this.startWorldCupGoalTracking();
    }

    goalKey(matchId, goal) {
        return `${String(matchId)}:${goal.minute}:${goal.scorer}`;
    }

    loadWorldCupGoalState() {
        try {
            if (fs.existsSync(this.worldCupStateFile)) {
                const data = JSON.parse(fs.readFileSync(this.worldCupStateFile, 'utf8'));
                this.worldCupKnownGoals = new Set((data.knownGoals || []).map(String));
                this.worldCupAnnouncedFinals = new Set((data.announcedFinals || []).map(String));
                this.worldCupAnnouncedKickoffs = new Set((data.announcedKickoffs || []).map(String));
                this.worldCupLiveMatchIds = new Set((data.liveMatchIds || []).map(String));
                console.log(`[World Cup] Loaded state: ${this.worldCupKnownGoals.size} goals, ${this.worldCupAnnouncedFinals.size} finals, ${this.worldCupAnnouncedKickoffs.size} kickoffs, ${this.worldCupLiveMatchIds.size} live`);
            }
        } catch (error) {
            console.error('[World Cup] Failed to load goal state:', error.message);
            this.worldCupKnownGoals = new Set();
            this.worldCupAnnouncedFinals = new Set();
            this.worldCupAnnouncedKickoffs = new Set();
            this.worldCupLiveMatchIds = new Set();
        }
    }

    saveWorldCupGoalState() {
        try {
            fs.writeFileSync(this.worldCupStateFile, JSON.stringify({
                knownGoals: [...this.worldCupKnownGoals],
                announcedFinals: [...this.worldCupAnnouncedFinals],
                announcedKickoffs: [...this.worldCupAnnouncedKickoffs],
                liveMatchIds: [...this.worldCupLiveMatchIds],
                updated: Date.now()
            }));
        } catch (error) {
            console.error('[World Cup] Failed to save goal state:', error.message);
        }
    }

    parseWorldCup26Date(localDate) {
        if (!localDate) return 0;
        const match = String(localDate).match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
        if (!match) return 0;
        const [, month, day, year, hour, minute] = match;
        return Math.floor(new Date(`${year}-${month}-${day}T${hour}:${minute}:00`).getTime() / 1000);
    }

    formatWorldCup26Round(game) {
        const typeMap = {
            group: game.group ? `Group ${game.group}` : 'Group stage',
            r32: 'Round of 32',
            r16: 'Round of 16',
            qf: 'Quarter-final',
            sf: 'Semi-final',
            final: 'Final',
            third: 'Third-place play-off'
        };
        if (game.type && typeMap[game.type]) {
            return typeMap[game.type];
        }
        if (game.group && game.group !== 'R32') {
            return `Group ${game.group}`;
        }
        return game.group || '';
    }

    parseWorldCup26Scorers(scorersStr) {
        if (!scorersStr || scorersStr === 'null') {
            return [];
        }

        const cleaned = String(scorersStr).replace(/[\u201c\u201d]/g, '"');
        const goals = [];
        const regex = /([^,"]+?)\s*(\d+)(?:\([^)]*\))?'/g;
        let match;
        while ((match = regex.exec(cleaned)) !== null) {
            const name = match[1].trim().replace(/^["{]+|["}]+$/g, '');
            if (name) {
                goals.push({ name, minute: parseInt(match[2], 10), assist: null });
            }
        }
        return goals;
    }

    normalizeWorldCup26Game(game, stadiums = {}) {
        const finished = String(game.finished || '').toUpperCase() === 'TRUE' ||
            String(game.time_elapsed || '').toLowerCase() === 'finished';
        const live = !finished && String(game.time_elapsed || '').toLowerCase() === 'live';
        const home = parseInt(game.home_score, 10) || 0;
        const away = parseInt(game.away_score, 10) || 0;

        let liveMinute = null;
        const elapsed = game.time_elapsed;
        if (live && elapsed && elapsed !== 'live') {
            const parsed = parseInt(elapsed, 10);
            if (!Number.isNaN(parsed)) {
                liveMinute = parsed;
            }
        }

        const stadium = stadiums[game.stadium_id];
        const ground = stadium ? `${stadium.city_en} (${stadium.name_en})` : null;

        return {
            id: String(game.id),
            team1: game.home_team_name_en || game.home_team_label || 'TBD',
            team2: game.away_team_name_en || game.away_team_label || 'TBD',
            score: [home, away],
            status: finished ? 'finished' : (live ? 'live' : 'scheduled'),
            live_minute: liveMinute,
            round: this.formatWorldCup26Round(game),
            ground,
            datetime: this.parseWorldCup26Date(game.local_date),
            goals1: this.parseWorldCup26Scorers(game.home_scorers),
            goals2: this.parseWorldCup26Scorers(game.away_scorers),
            source: 'worldcup26'
        };
    }

    normalizeWcup2026Match(match) {
        return {
            id: String(match.id),
            team1: match.team1,
            team2: match.team2,
            score: Array.isArray(match.score) ? match.score : [0, 0],
            status: match.status === 'live' ? 'live' : (match.status === 'finished' ? 'finished' : 'scheduled'),
            live_minute: match.live_minute ?? null,
            round: match.round || '',
            ground: match.ground || null,
            datetime: match.datetime || 0,
            goals1: match.goals1 || [],
            goals2: match.goals2 || [],
            source: 'wcup2026'
        };
    }

    async fetchWorldCup26Json(path, retries = 2) {
        const base = (process.env.WORLDCUP26_API_URL || 'https://worldcup26.ir').replace(/\/$/, '');
        const url = `${base}${path}`;
        let lastError;

        for (let attempt = 0; attempt <= retries; attempt++) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 20000);

            try {
                const response = await fetch(url, {
                    signal: controller.signal,
                    headers: { Accept: 'application/json' }
                });

                if (!response.ok) {
                    const retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
                    if (retryable && attempt < retries) {
                        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
                        continue;
                    }
                    throw new Error(`HTTP ${response.status}`);
                }

                return await response.json();
            } catch (error) {
                lastError = error;
                const message = error.name === 'AbortError' ? 'Request timed out' : error.message;
                const retryable = error.name === 'AbortError' ||
                    message.includes('HTTP 408') ||
                    message.includes('HTTP 502') ||
                    message.includes('HTTP 503') ||
                    message.includes('HTTP 504');

                if (retryable && attempt < retries) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
                    continue;
                }
                throw new Error(message);
            } finally {
                clearTimeout(timeout);
            }
        }

        throw lastError || new Error('worldcup26.ir request failed');
    }

    async fetchWorldCup26Stadiums() {
        if (this.worldCupStadiumsCache) {
            return this.worldCupStadiumsCache;
        }

        const data = await this.fetchWorldCup26Json('/get/stadiums', 1);
        const stadiums = data.stadiums || data.data || [];
        const map = {};
        for (const stadium of stadiums) {
            map[stadium.id] = stadium;
        }
        this.worldCupStadiumsCache = map;
        return map;
    }

    async fetchWorldCup26Matches() {
        const [gamesData, stadiums] = await Promise.all([
            this.fetchWorldCup26Json('/get/games'),
            this.fetchWorldCup26Stadiums()
        ]);

        const games = gamesData.games || gamesData.data || [];
        if (!Array.isArray(games)) {
            throw new Error('Invalid games response from worldcup26.ir');
        }

        return games.map(game => this.normalizeWorldCup26Game(game, stadiums));
    }

    async fetchWcup2026MatchesAll() {
        const [liveData, resultsData] = await Promise.all([
            this.fetchWorldCupApi('live'),
            this.fetchWorldCupApi('results', { limit: 20 }).catch(() => ({ matches: [] }))
        ]);

        const byId = new Map();
        for (const match of [...(liveData.matches || []), ...(resultsData.matches || [])]) {
            byId.set(String(match.id), match);
        }

        const matches = [];
        for (const [id, summary] of byId) {
            const needsDetail = summary.status === 'live' ||
                (Array.isArray(summary.score) && (summary.score[0] > 0 || summary.score[1] > 0));

            if (needsDetail) {
                try {
                    const detail = await this.fetchWorldCupApi('match', { id });
                    matches.push(this.normalizeWcup2026Match(detail.match || summary));
                } catch (error) {
                    console.error(`[World Cup] wcup2026 match ${id} detail failed:`, error.message);
                    matches.push(this.normalizeWcup2026Match(summary));
                }
            } else {
                matches.push(this.normalizeWcup2026Match(summary));
            }
        }

        return matches;
    }

    async fetchAllWorldCupMatches(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && this.worldCupMatchesCache && this.worldCupMatchesCacheAt &&
            (now - this.worldCupMatchesCacheAt) < 20000) {
            return this.worldCupMatchesCache;
        }

        try {
            const matches = await this.fetchWorldCup26Matches();
            this.worldCupDataSource = 'worldcup26.ir';
            this.worldCupMatchesCache = matches;
            this.worldCupMatchesCacheAt = now;
            console.log(`[World Cup] Fetched ${matches.length} matches from worldcup26.ir`);
            return matches;
        } catch (primaryError) {
            console.error('[World Cup] worldcup26.ir failed, trying wcup2026.org:', primaryError.message);
            const matches = await this.fetchWcup2026MatchesAll();
            this.worldCupDataSource = 'wcup2026.org';
            this.worldCupMatchesCache = matches;
            this.worldCupMatchesCacheAt = now;
            console.log(`[World Cup] Fetched ${matches.length} matches from wcup2026.org (fallback)`);
            return matches;
        }
    }

    async fetchWorldCupRankings() {
        const now = Date.now();
        if (this.worldCupRankings && this.worldCupRankingsFetchedAt && (now - this.worldCupRankingsFetchedAt) < 3600000) {
            return this.worldCupRankings;
        }

        const rankingUrls = [
            'https://worldcup26.ir/data/rankings.json',
            'https://wcup2026.org/data/rankings.json',
            'https://raw.githubusercontent.com/salah23222/worldcup2026/main/data/rankings.json'
        ];

        for (const url of rankingUrls) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000);
                const response = await fetch(url, {
                    signal: controller.signal,
                    headers: { Accept: 'application/json' }
                });
                clearTimeout(timeout);

                if (!response.ok) {
                    continue;
                }

                this.worldCupRankings = await response.json();
                this.worldCupRankingsFetchedAt = now;
                return this.worldCupRankings;
            } catch (error) {
                console.error(`[World Cup] Rankings failed from ${url}:`, error.message);
            }
        }

        return this.worldCupRankings || {};
    }

    formatWorldCupKickoffMessage(match, rankings = {}) {
        const round = match.round ? ` [${match.round}]` : '';
        const venue = match.ground ? ` at ${match.ground}` : '';
        const rank1 = rankings[match.team1];
        const rank2 = rankings[match.team2];

        let insight = '';
        if (rank1 && rank2) {
            const diff = Math.abs(rank1 - rank2);
            if (diff >= 15) {
                const favorite = rank1 < rank2 ? match.team1 : match.team2;
                insight = ` — FIFA #${rank1} vs #${rank2}, ${favorite} heavily favored`;
            } else if (diff >= 5) {
                const favorite = rank1 < rank2 ? match.team1 : match.team2;
                insight = ` — FIFA #${rank1} vs #${rank2}, slight edge to ${favorite}`;
            } else {
                insight = ` — FIFA #${rank1} vs #${rank2}, could go either way`;
            }
        }

        return `🟢 KICKOFF! ${match.team1} vs ${match.team2} is starting right now!${round}${venue}${insight}`;
    }

    processWorldCupKickoff(match, rankings = {}, announceNew = true) {
        const matchId = String(match.id);
        if (!match || this.worldCupAnnouncedKickoffs.has(matchId)) {
            return;
        }

        this.worldCupAnnouncedKickoffs.add(matchId);

        if (announceNew) {
            const msg = this.formatWorldCupKickoffMessage(match, rankings);
            console.log('[World Cup] Announcing kickoff:', msg);
            logToFile(`[World Cup] Kickoff: ${msg}`);
            this.sendMessage(msg);
        } else {
            console.log(`[World Cup] Seeded kickoff: ${match.id}`);
        }

        this.saveWorldCupGoalState();
    }

    formatWorldCupFinalScoreMessage(match) {
        const [home, away] = match.score || [0, 0];
        const round = match.round ? ` [${match.round}]` : '';
        let result;
        if (home > away) {
            result = `${match.team1} win`;
        } else if (away > home) {
            result = `${match.team2} win`;
        } else {
            result = 'Draw';
        }
        return `🏁 FULL TIME${round}: ${match.team1} ${home}-${away} ${match.team2} — ${result}`;
    }

    seedRecentFinals(matches) {
        for (const match of matches) {
            if (match.status === 'finished') {
                this.worldCupAnnouncedFinals.add(String(match.id));
            }
        }
        this.saveWorldCupGoalState();
        console.log(`[World Cup] Seeded ${this.worldCupAnnouncedFinals.size} announced finals`);
    }

    announceMatchFinalIfNeeded(matchId, announceNew = true, matchesById = null) {
        const id = String(matchId);
        if (this.worldCupAnnouncedFinals.has(id)) {
            return;
        }

        const match = matchesById?.get(id);
        if (!match || match.status !== 'finished') {
            return;
        }

        this.worldCupAnnouncedFinals.add(id);
        this.saveWorldCupGoalState();

        if (announceNew) {
            const msg = this.formatWorldCupFinalScoreMessage(match);
            console.log('[World Cup] Announcing final:', msg);
            logToFile(`[World Cup] Final: ${msg}`);
            this.sendMessage(msg);
        } else {
            console.log(`[World Cup] Seeded final: ${id}`);
        }
    }

    formatWorldCupGoalAnnouncement(goal) {
        const [home, away] = goal.score || [0, 0];
        const assist = goal.assist ? `, assist: ${goal.assist}` : '';
        const round = goal.round ? ` [${goal.round}]` : '';
        const live = goal.status === 'live' && goal.live_minute != null ? ` — LIVE ${goal.live_minute}'` : '';
        return `⚽ GOAL! ${goal.scorer} (${goal.minute}'${assist}) — ${goal.team} — ${goal.team1} ${home}-${away} ${goal.team2}${round}${live}`;
    }

    processWorldCupMatchGoals(match, announceNew = true) {
        const goals = this.collectGoalsFromMatch(match);
        goals.sort((a, b) => a.minute - b.minute);

        for (const goal of goals) {
            const key = this.goalKey(match.id, goal);
            if (this.worldCupKnownGoals.has(key)) {
                continue;
            }

            this.worldCupKnownGoals.add(key);

            if (announceNew) {
                const msg = this.formatWorldCupGoalAnnouncement(goal);
                console.log('[World Cup] Announcing goal:', msg);
                logToFile(`[World Cup] Goal: ${msg}`);
                this.sendMessage(msg);
                this.lastWorldCupGoal = goal;
                this.lastWorldCupGoalFetchedAt = Date.now();
            } else {
                console.log(`[World Cup] Seeded goal: ${key}`);
            }
        }

        this.saveWorldCupGoalState();
    }

    async fetchWorldCupApi(action, params = {}, retries = 3) {
        const url = new URL('https://wcup2026.org/api/data.php');
        url.searchParams.set('action', action);
        for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, String(value));
        }

        let lastError;

        for (let attempt = 0; attempt <= retries; attempt++) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);

            try {
                const response = await fetch(url.toString(), {
                    signal: controller.signal,
                    headers: { Accept: 'application/json' }
                });

                if (!response.ok) {
                    const retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
                    if (retryable && attempt < retries) {
                        const delay = 1000 * (attempt + 1);
                        console.log(`[World Cup] HTTP ${response.status} on ${action}, retrying in ${delay}ms...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }
                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await response.json();
                if (!data.ok) {
                    throw new Error('World Cup API returned ok:false');
                }

                return data;
            } catch (error) {
                lastError = error;
                const message = error.name === 'AbortError' ? 'Request timed out' : error.message;
                const retryable = error.name === 'AbortError' ||
                    message.includes('HTTP 408') ||
                    message.includes('HTTP 502') ||
                    message.includes('HTTP 503') ||
                    message.includes('HTTP 504');

                if (retryable && attempt < retries) {
                    const delay = 1000 * (attempt + 1);
                    console.log(`[World Cup] ${action} failed (${message}), retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                throw new Error(message);
            } finally {
                clearTimeout(timeout);
            }
        }

        throw lastError || new Error('World Cup API request failed');
    }

    collectGoalsFromMatch(match) {
        const goals = [];

        const addGoals = (list, teamName) => {
            if (!Array.isArray(list)) return;
            for (const goal of list) {
                goals.push({
                    scorer: goal.name,
                    minute: goal.minute,
                    assist: goal.assist || null,
                    team: teamName,
                    matchId: match.id,
                    team1: match.team1,
                    team2: match.team2,
                    score: match.score,
                    round: match.round,
                    status: match.status,
                    live_minute: match.live_minute,
                    timestamp: (match.datetime || 0) + (goal.minute || 0) * 60
                });
            }
        };

        addGoals(match.goals1, match.team1);
        addGoals(match.goals2, match.team2);
        return goals;
    }

    formatLastWorldCupGoalMessage(goal) {
        const [home, away] = goal.score || [0, 0];
        const assist = goal.assist ? `, assist: ${goal.assist}` : '';
        const round = goal.round ? ` [${goal.round}]` : '';
        const live = goal.status === 'live' && goal.live_minute != null ? ` — LIVE ${goal.live_minute}'` : '';
        return `⚽ Last goal: ${goal.scorer} (${goal.minute}'${assist}) — ${goal.team} — ${goal.team1} ${home}-${away} ${goal.team2}${round}${live}`;
    }

    async getLastWorldCupGoal() {
        const now = Date.now();
        if (this.lastWorldCupGoal && this.lastWorldCupGoalFetchedAt && (now - this.lastWorldCupGoalFetchedAt) < 30000) {
            return this.lastWorldCupGoal;
        }

        try {
            const matches = await this.fetchAllWorldCupMatches();
            const allGoals = [];

            for (const match of matches) {
                if (match.status === 'live' || match.status === 'finished') {
                    allGoals.push(...this.collectGoalsFromMatch(match));
                }
            }

            if (allGoals.length === 0) {
                return this.lastWorldCupGoal || null;
            }

            allGoals.sort((a, b) => b.timestamp - a.timestamp);
            this.lastWorldCupGoal = allGoals[0];
            this.lastWorldCupGoalFetchedAt = now;
            return this.lastWorldCupGoal;
        } catch (error) {
            console.error('[World Cup] getLastWorldCupGoal error:', error.message);
            if (this.lastWorldCupGoal) {
                return this.lastWorldCupGoal;
            }
            throw error;
        }
    }

    async pollWorldCupGoals() {
        if (this.worldCupPollInProgress) {
            return;
        }

        this.worldCupPollInProgress = true;
        const announceNew = this.worldCupAnnounceGoals;

        try {
            const matches = await this.fetchAllWorldCupMatches();
            const matchesById = new Map(matches.map(match => [String(match.id), match]));
            const liveMatches = matches.filter(match => match.status === 'live');
            const previousLiveIds = new Set(this.worldCupLiveMatchIds);
            const currentLiveIds = new Set();

            let rankings = {};
            try {
                rankings = await this.fetchWorldCupRankings();
            } catch (error) {
                console.error('[World Cup] Rankings unavailable:', error.message);
            }

            if (liveMatches.length === 0) {
                console.log(`[World Cup] No live matches (source: ${this.worldCupDataSource || 'unknown'})`);
            } else {
                console.log(`[World Cup] Polling ${liveMatches.length} live match(es) via ${this.worldCupDataSource}`);
            }

            for (const match of liveMatches) {
                const matchId = String(match.id);
                currentLiveIds.add(matchId);
                this.processWorldCupKickoff(match, rankings, announceNew);
                this.processWorldCupMatchGoals(match, announceNew);
            }

            for (const matchId of previousLiveIds) {
                if (!currentLiveIds.has(matchId)) {
                    this.announceMatchFinalIfNeeded(matchId, announceNew, matchesById);
                }
            }

            this.worldCupLiveMatchIds = currentLiveIds;
            this.saveWorldCupGoalState();

            if (!announceNew) {
                this.seedRecentFinals(matches);
            }
        } catch (error) {
            const message = error.name === 'AbortError' ? 'Request timed out' : error.message;
            console.error('[World Cup] Poll error:', message);
            logToFile(`[World Cup] Poll error: ${message}`);
        } finally {
            this.worldCupPollInProgress = false;
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
        if (command.startsWith('ask ') || command === 'ask') {
            const question = command === 'ask' ? '' : command.slice(4).trim()
            if (!question) {
                this.sendMessage(`@${userName}: Ask me anything with +ask <question>. I remember your follow-ups and recent room chat. +forget / +forget room / +forget all`);
                return
            }
            if (['clear', 'reset', 'forget', 'new'].includes(question.toLowerCase())) {
                const had = this.clearConversation(userName)
                this.sendMessage(had
                    ? `@${userName}: Personal memory wiped. Fresh start! 🧠✨`
                    : `@${userName}: Nothing to forget — we're already starting fresh.`)
                return
            }
            if (['clear room', 'reset room', 'forget room'].includes(question.toLowerCase())) {
                const had = this.clearRoomChatHistory()
                this.sendMessage(had
                    ? `@${userName}: Room chat memory wiped.`
                    : `@${userName}: Room chat memory was already empty.`)
                return
            }
            if (['clear all', 'reset all', 'forget all'].includes(question.toLowerCase())) {
                const personal = this.clearConversation(userName)
                const room = this.clearRoomChatHistory()
                this.sendMessage((personal || room)
                    ? `@${userName}: Personal + room memory wiped. 🧠✨`
                    : `@${userName}: Nothing to forget — already fresh.`)
                return
            }
            try {
                const aiResponse = await this.getAIResponse(question, userName)
                const formattedResponse = this.formatMarkdownForChat(
                    aiResponse
                        .split('\n\n')
                        .map(para => para.trim())
                        .filter(para => para)
                        .join('\n\n')
                )
                this.sendMessage(formattedResponse)
            } catch (error) {
                console.error('[ASK] error:', error?.message || error)
                this.sendMessage(`Sorry, I had trouble processing that request! 🤔`)
            }
            return
        } else if (command === 'spooky') {
            if (!this.currentTrack) {
                this.sendMessage(`@${userName}: No track is currently playing!`);
                return;
            }
            try {
                const score = await this.getSpookyRating();
                // Bare URL as the whole message, same as +image, so chat renders it inline
                this.sendMessage(this.spookyScale[score].gif);
            } catch (error) {
                console.error('[SPOOKY] error:', error?.message || error);
                this.sendMessage(`@${userName}: The spirits are being quiet, couldn't rate this one. 👻`);
            }
            return
        } else if (command === 'pollen') {
            try {
                const { balance } = await this.getPollinationsBalance();
                const formatted = this._formatPollenAmount(balance);
                const paidModel = process.env.POLLINATIONS_TEXT_MODEL || 'openai';
                const freeModel = process.env.POLLINATIONS_TEXT_MODEL_FREE || 'YoannDev90/laguna-s-2.1:free';
                if (balance <= 0) {
                    this.sendMessage(
                        `@${userName}: Pollinations Pollen: ${formatted}. Paid model (${paidModel}) is empty — +ask falls back to free (${freeModel}). Top up at enter.pollinations.ai`
                    );
                } else {
                    this.sendMessage(
                        `@${userName}: Pollinations Pollen balance: ${formatted} (≈ $${formatted}). Paid model: ${paidModel}`
                    );
                }
            } catch (error) {
                console.error('[Pollen] balance check failed:', error?.message || error);
                const msg = String(error?.message || '');
                if (msg.includes('not configured')) {
                    this.sendMessage(`@${userName}: Pollinations API key isn't configured, so I can't check Pollen.`);
                } else if (msg.includes('HTTP 401') || msg.includes('HTTP 403')) {
                    this.sendMessage(
                        `@${userName}: Can't read Pollen balance — the API key may need the account:balance / account:usage permission at enter.pollinations.ai`
                    );
                } else {
                    this.sendMessage(`@${userName}: Couldn't fetch Pollen balance right now. Try again in a bit.`);
                }
            }
            return
        } else if (command === 'forget' || command.startsWith('forget ')) {
            const scope = command === 'forget' ? '' : command.slice(7).trim().toLowerCase()
            if (!scope || scope === 'me' || scope === 'personal') {
                const had = this.clearConversation(userName)
                this.sendMessage(had
                    ? `@${userName}: Personal memory wiped. Fresh start! 🧠✨`
                    : `@${userName}: Nothing to forget — we're already starting fresh.`)
            } else if (scope === 'room') {
                const had = this.clearRoomChatHistory()
                this.sendMessage(had
                    ? `@${userName}: Room chat memory wiped.`
                    : `@${userName}: Room chat memory was already empty.`)
            } else if (scope === 'all') {
                const personal = this.clearConversation(userName)
                const room = this.clearRoomChatHistory()
                this.sendMessage((personal || room)
                    ? `@${userName}: Personal + room memory wiped. 🧠✨`
                    : `@${userName}: Nothing to forget — already fresh.`)
            } else {
                this.sendMessage(`Usage: +forget | +forget room | +forget all`)
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
                // Provide more helpful error messages
                if (error.message && error.message.includes('502')) {
                    this.sendMessage(`Sorry, I couldn't generate that image! 🎨 The image service is temporarily unavailable (502 error). Please try again in a moment.`)
                } else if (error.message && error.message.includes('503')) {
                    this.sendMessage(`Sorry, I couldn't generate that image! 🎨 The image service is temporarily overloaded (503 error). Please try again in a moment.`)
                } else if (error.message && (error.message.includes('500') || error.message.includes('status: 500'))) {
                    this.sendMessage(`Sorry, I couldn't generate that image! 🎨 The image service returned a server error. Please try again in a moment or a simpler prompt.`)
                } else if (error.message && error.message.includes('timeout')) {
                    this.sendMessage(`Sorry, I couldn't generate that image! 🎨 The request timed out. Please try again with a simpler prompt.`)
                } else {
                    this.sendMessage(`Sorry, I couldn't generate that image! 🎨 ${error.message || 'Unknown error occurred.'}`)
                }
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

                // Generate 5 completely random prompts each time
                const randomPrompts = [];
                for (let i = 0; i < 10; i++) {
                    randomPrompts.push(generateRandomShrekPrompt());
                }

                // Generate images with slight delays between each to avoid overwhelming
                for (let i = 0; i < randomPrompts.length; i++) {
                    setTimeout(async () => {
                        try {
                            const imageUrl = await this.generateImage(
                                `highly detailed, photorealistic, ${randomPrompts[i]}, cinematic lighting, 4k`
                            );
                            this.sendMessage(imageUrl);
                        } catch (error) {
                            console.error(`Failed to generate Shrek image ${i + 1}:`, error);
                        }
                    }, i * 2000); // Send an image every 2 seconds
                }
            } catch (error) {
                this.sendMessage(`@${userName}: Shrek is love, Shrek is life, but something went wrong in the swamp! 🧅`);
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
        } else if (command.startsWith('stock ') || command === 'stock') {
            const rawTicker = command === 'stock' ? '' : command.slice(6).trim();
            const ticker = this.normalizeStockTicker(rawTicker);
            if (!ticker) {
                this.sendMessage('Usage: +stock TICKER (e.g. +stock GOOG). That also unlocks +goog for later.');
                return;
            }
            try {
                const { command: shortCmd, registered, reason } = this.registerStockCommand(ticker);
                await this.sendStockSquare(ticker, ticker);
                if (reason === 'reserved') {
                    this.sendMessage(`Fetched ${ticker}. +${shortCmd} is reserved, so keep using +stock ${ticker}.`);
                } else if (registered) {
                    this.sendMessage(`Registered +${shortCmd} — same green/red check anytime.`);
                }
            } catch (error) {
                console.error(`[STOCK] Command error for ${ticker}:`, error.message, error.stack);
                this.sendMessage(`Sorry, couldn't fetch ${ticker} right now! 📈 Error: ${error.message}`);
            }
            return;
        }

        // User-registered stock shortcuts (+rddt, +goog after +stock GOOG, etc.)
        if (this.customStockCommands.has(command)) {
            const ticker = this.customStockCommands.get(command);
            try {
                await this.sendStockSquare(ticker, ticker);
            } catch (error) {
                console.error(`[STOCK] Command error for ${ticker}:`, error.message, error.stack);
                this.sendMessage(`Sorry, couldn't fetch ${ticker} right now! 📈 Error: ${error.message}`);
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
            case 'gme':
                try {
                    await this.sendStockSquare('GME', 'GME');
                } catch (error) {
                    console.error('[GME] Command error:', error.message, error.stack);
                    this.sendMessage(`Sorry, couldn't fetch GME data right now! 📈 Error: ${error.message}`);
                }
                break
            case 'gold':
                try {
                    await this.sendStockSquare('GC=F', 'GOLD');
                } catch (error) {
                    console.error('[GOLD] Command error:', error.message, error.stack);
                    this.sendMessage(`Sorry, couldn't fetch gold data right now! 🥇 Error: ${error.message}`);
                }
                break
            case 'silver':
                try {
                    await this.sendStockSquare('SI=F', 'SILVER');
                } catch (error) {
                    console.error('[SILVER] Command error:', error.message, error.stack);
                    this.sendMessage(`Sorry, couldn't fetch silver data right now! 🥈 Error: ${error.message}`);
                }
                break
            case 'ferris':
                this.sendMessage(`wheel`)
                break
            case 'hello':
                this.sendMessage(`Hello ${userName}! 👋`)
                break
            case 'help':
                const helpMessage = 'Available commands: +shrek, +hey, +hello, +help, +ping, +goal, +ask <question> (personal + room memory), +forget [room|all], +pollen, +spooky, +gimme, +gme, +gold, +silver, +rddt, +stock <ticker>, +image <prompt>' +
                    (process.env.OPENWEATHER_API_KEY ? ', +weather <city/zip>' : '') +
                    ' ... and maybe some egg'
                this.sendMessage(helpMessage)
                break
            case 'ping':
                this.sendMessage('pong! 🏓')
                break
            case 'goal':
                try {
                    const lastGoal = await this.getLastWorldCupGoal();
                    if (!lastGoal) {
                        this.sendMessage('No World Cup goals found yet! ⚽');
                        return;
                    }
                    const stale = this.lastWorldCupGoalFetchedAt &&
                        (Date.now() - this.lastWorldCupGoalFetchedAt) > 120000;
                    const msg = this.formatLastWorldCupGoalMessage(lastGoal);
                    this.sendMessage(stale ? `${msg} (cached — live data unavailable)` : msg);
                } catch (error) {
                    console.error('[World Cup] +goal command error:', error.message);
                    this.sendMessage('Sorry, could not fetch the last World Cup goal right now! ⚽');
                }
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

                            if (parsed.params.type === 'join' && this.botId) {
                                this.onChannelJoined()
                            }
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
                    this.onChannelJoined()
                    break

                case 'pushChannelMessage':
                    if (parsed.params) {
                        const sender = parsed.params.userName
                        // Ignore our own echoed messages
                        if (sender === 'RVRB' || sender === this.botName) {
                            break
                        }
                        if (this.botId && parsed.params.userId && parsed.params.userId === this.botId) {
                            break
                        }

                        const message = (parsed.params.payload || '').trim()
                        if (!message) break

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
                        } else {
                            // Capture general room chat for shared +ask context
                            this.recordRoomChat(parsed.params.userName, message)
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
                this.reconnect('heartbeat-socket-not-open')
            }
        }, 30000)
    }

    reconnect(reason = 'unspecified') {
        if (this.intentionalClose) {
            console.log('[WebSocket] Skipping reconnect (intentional close)')
            return
        }
        if (this.reconnectTimer) {
            console.log(`[WebSocket] Reconnect already scheduled, ignoring (${reason})`)
            return
        }

        this.isReconnecting = true
        console.log(`[WebSocket] Attempting to reconnect (${reason})...`)
        this.hasJoinedChannel = false
        this.botId = null

        const oldWs = this.ws
        this.ws = null
        try {
            if (oldWs && oldWs.readyState === WebSocket.OPEN) {
                oldWs.close()
            }
        } catch (error) {
            console.error('[WebSocket] Error closing socket before reconnect:', error?.message || error)
        }

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null
            this.isReconnecting = false
            this.run()
        }, 5000)
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
            this.reconnect('health-check-socket-closed');
            return;
        }

        // Zombie connection: socket looks open but RVRB stopped sending keepAwake (common after reset)
        if (this.lastHeartbeat && (now - this.lastHeartbeat) > this.heartbeatStaleMs) {
            const staleSec = Math.round((now - this.lastHeartbeat) / 1000);
            console.log(`[Health Check] No keepAwake for ${staleSec}s — treating as dead connection`);
            logToFile(`[Health Check] Stale heartbeat (${staleSec}s), reconnecting`);
            this.reconnect('health-check-stale-heartbeat');
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

        console.log('[Health Check] OK — socket open, in channel, heartbeat fresh');
        logToFile('[Health Check] OK');
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
                this.stopWorldCupGoalTracking()
                this.hasJoinedChannel = false

                // Always reconnect — RVRB daily resets often close with code 1000 (clean)
                if (this.intentionalClose) {
                    console.log('[WebSocket] Intentional close, not auto-reconnecting')
                    return
                }
                if (this.reconnectTimer || this.isReconnecting) {
                    console.log('[WebSocket] Reconnect already in progress after close')
                    return
                }
                console.log(`[WebSocket] Scheduling reconnect after close (code=${code})...`)
                this.reconnect(`socket-close-${code}`)
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