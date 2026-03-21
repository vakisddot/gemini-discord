import "dotenv/config";
import {
    Client,
    ChannelType,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
} from "discord.js";
import { GoogleGenAI } from "@google/genai";
import http from "node:http";

// ---------------------------------------------------------------------------
// Logger with colors
// ---------------------------------------------------------------------------
const colors = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    red: "\x1b[31m",
    magenta: "\x1b[35m",
};

function log(message) {
    const timestamp = new Date().toLocaleString();
    console.log(`${colors.dim}[${timestamp}]${colors.reset} ${message}`);
}

function logError(message, error) {
    const timestamp = new Date().toLocaleString();
    console.error(
        `${colors.dim}[${timestamp}]${colors.reset} ${colors.red}ERROR: ${message}${colors.reset}`,
        error,
    );
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const SYSTEM_INSTRUCTION =
    "You are a helpful assistant in a Discord server. Keep responses concise and to the point — ideally under 500 characters. Use short paragraphs and bullet points when appropriate. Avoid long introductions or unnecessary detail.";

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID || !GEMINI_API_KEY) {
    logError(
        "Missing environment variables. Make sure DISCORD_TOKEN, DISCORD_CLIENT_ID, and GEMINI_API_KEY are set in your .env file.",
    );
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Discord client
// ---------------------------------------------------------------------------
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ---------------------------------------------------------------------------
// Google Gemini — Chat sessions per channel
// ---------------------------------------------------------------------------
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const channelChats = new Map();
const MAX_CHANNEL_CHATS = 100;

function getOrCreateChat(channelId) {
    if (channelChats.has(channelId)) {
        // Move to end (most recently used)
        const chat = channelChats.get(channelId);
        channelChats.delete(channelId);
        channelChats.set(channelId, chat);
        return chat;
    }

    // Evict oldest entry if at capacity
    if (channelChats.size >= MAX_CHANNEL_CHATS) {
        const oldest = channelChats.keys().next().value;
        channelChats.delete(oldest);
    }

    const chat = ai.chats.create({
        model: GEMINI_MODEL,
        config: {
            systemInstruction: SYSTEM_INSTRUCTION,
        },
    });

    channelChats.set(channelId, chat);
    return chat;
}

// ---------------------------------------------------------------------------
// Slash command definitions
// ---------------------------------------------------------------------------
const geminiCommand = new SlashCommandBuilder()
    .setName("gemini")
    .setDescription("Ask Google Gemini a question")
    .addStringOption((option) =>
        option
            .setName("prompt")
            .setDescription("What do you want to ask Gemini?")
            .setRequired(true),
    );

const resetCommand = new SlashCommandBuilder()
    .setName("gemini-reset")
    .setDescription("Reset Gemini conversation history for this channel");

// ---------------------------------------------------------------------------
// Register slash commands when the bot is ready
// ---------------------------------------------------------------------------
client.once("clientReady", async () => {
    log(`${colors.green}Logged in as ${client.user.tag}${colors.reset}`);
    log(`${colors.cyan}Using model: ${GEMINI_MODEL}${colors.reset}`);

    const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

    try {
        await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), {
            body: [geminiCommand.toJSON(), resetCommand.toJSON()],
        });
        log(
            `${colors.green}Slash commands /gemini and /gemini-reset registered successfully.${colors.reset}`,
        );
    } catch (error) {
        logError("Failed to register slash commands:", error);
        process.exit(1);
    }
});

// ---------------------------------------------------------------------------
// Handle interactions
// ---------------------------------------------------------------------------
const DISCORD_MAX_LENGTH = 2000;

function splitMessage(text, maxLength = DISCORD_MAX_LENGTH) {
    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
            chunks.push(remaining);
            break;
        }

        let splitIndex = remaining.lastIndexOf("\n", maxLength);
        if (splitIndex === -1 || splitIndex === 0) {
            splitIndex = remaining.lastIndexOf(" ", maxLength);
        }
        if (splitIndex === -1 || splitIndex === 0) {
            splitIndex = maxLength;
        }

        chunks.push(remaining.slice(0, splitIndex));
        remaining = remaining.slice(splitIndex).trimStart();
    }

    return chunks;
}

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // -----------------------------------------------------------------------
    // /gemini-reset
    // -----------------------------------------------------------------------
    if (interaction.commandName === "gemini-reset") {
        const guild = interaction.guild?.name || "DM";
        const channelId = interaction.channelId;

        channelChats.delete(channelId);
        log(
            `${colors.yellow}[${guild}] Conversation reset by ${interaction.user.displayName}${colors.reset}`,
        );
        await interaction.reply(
            "Conversation history has been reset for this channel.",
        );
        return;
    }

    // -----------------------------------------------------------------------
    // /gemini
    // -----------------------------------------------------------------------
    if (interaction.commandName !== "gemini") return;

    const prompt = interaction.options.getString("prompt");
    const user = interaction.user.displayName;
    const guild = interaction.guild?.name || "DM";
    const channelId = interaction.channelId;

    log(
        `${colors.cyan}[${guild}]${colors.reset} ${colors.magenta}${user}${colors.reset} asked: "${prompt}"`,
    );

    await interaction.deferReply();

    try {
        const startTime = Date.now();
        const chat = getOrCreateChat(channelId);
        const response = await chat.sendMessage({ message: prompt });
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const text = response.text;

        if (!text) {
            log(
                `${colors.yellow}[${guild}] Empty response for "${prompt}" (${elapsed}s)${colors.reset}`,
            );
            await interaction.editReply(
                "Gemini returned an empty response. Try rephrasing your prompt.",
            );
            return;
        }

        log(
            `${colors.green}[${guild}] Response: ${text.length} chars in ${elapsed}s${colors.reset}`,
        );
        log(
            `${colors.magenta}[${guild}] Gemini reply:\n${text}${colors.reset}`,
        );

        const header = `> **${user} asked:** ${prompt}\n\n`;
        const fullText = header + text;

        // If it fits in one message, reply directly
        if (fullText.length <= DISCORD_MAX_LENGTH) {
            await interaction.editReply(fullText);
            return;
        }

        // Long response — create a thread
        log(
            `${colors.yellow}[${guild}] Response too long (${text.length} chars), creating thread${colors.reset}`,
        );

        const threadName =
            prompt.length > 100 ? prompt.slice(0, 97) + "..." : prompt;
        await interaction.editReply(
            `${header}Response is long — check the thread below.`,
        );

        try {
            const replyMessage = await interaction.fetchReply();
            const thread = await replyMessage.startThread({
                name: threadName,
                autoArchiveDuration: 60,
                type: ChannelType.PublicThread,
            });

            const chunks = splitMessage(text);
            for (const chunk of chunks) {
                await thread.send(chunk);
            }
        } catch (threadError) {
            logError(
                `[${guild}] Failed to create thread for long response:`,
                threadError,
            );
            await interaction.editReply(
                `${header}${text.slice(0, DISCORD_MAX_LENGTH - header.length - 50)}\n\n*[Response truncated]*`,
            );
        }
    } catch (error) {
        logError(`[${guild}] Gemini API failed for "${prompt}":`, error);
        await interaction.editReply(
            "❌ Sorry, something went wrong while contacting Gemini. Please try again later.",
        );
    }
});

const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bot is running");
});
server.listen(process.env.PORT || 3000);

// ---------------------------------------------------------------------------
// Start the bot
// ---------------------------------------------------------------------------
client.login(DISCORD_TOKEN);