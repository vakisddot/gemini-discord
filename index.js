import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import { GoogleGenAI } from "@google/genai";

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
  console.error(`${colors.dim}[${timestamp}]${colors.reset} ${colors.red}ERROR: ${message}${colors.reset}`, error);
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID || !GEMINI_API_KEY) {
  logError(
    "Missing environment variables. Make sure DISCORD_TOKEN, DISCORD_CLIENT_ID, and GEMINI_API_KEY are set in your .env file.", ""
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Discord client
// ---------------------------------------------------------------------------
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ---------------------------------------------------------------------------
// Google Gemini
// ---------------------------------------------------------------------------
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// ---------------------------------------------------------------------------
// Slash command definition
// ---------------------------------------------------------------------------
const geminiCommand = new SlashCommandBuilder()
  .setName("gemini")
  .setDescription("Ask Google Gemini a question")
  .addStringOption((option) =>
    option
      .setName("prompt")
      .setDescription("What do you want to ask Gemini?")
      .setRequired(true)
  );

// ---------------------------------------------------------------------------
// Register slash commands when the bot is ready
// ---------------------------------------------------------------------------
client.once("clientReady", async () => {
    log(`${colors.green}Logged in as ${client.user.tag}${colors.reset}`);
    log(`${colors.cyan}Using model: ${GEMINI_MODEL}${colors.reset}`);

    const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

    try {
        await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), {
            body: [geminiCommand.toJSON()],
        });
        log(`${colors.green}Slash command /gemini registered successfully.${colors.reset}`);
    } catch (error) {
        logError("Failed to register slash commands:", error);
    }
});

// ---------------------------------------------------------------------------
// Handle interactions
// ---------------------------------------------------------------------------
const DISCORD_MAX_LENGTH = 2000;

/**
 * Split a long string into chunks that each fit within Discord's message
 * character limit.
 */
function splitMessage(text, maxLength = DISCORD_MAX_LENGTH) {
  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at the last newline within the limit so we don't cut mid-sentence
    let splitIndex = remaining.lastIndexOf("\n", maxLength);
    if (splitIndex === -1 || splitIndex === 0) {
      // Fall back to splitting at a space
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIndex === -1 || splitIndex === 0) {
      // No good break point — hard cut
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "gemini") return;

  const prompt = interaction.options.getString("prompt");
  const user = interaction.user.displayName;
  const guild = interaction.guild?.name || "DM";

  log(`${colors.cyan}[${guild}]${colors.reset} ${colors.magenta}${user}${colors.reset} asked: "${prompt}"`);

  // Defer the reply so Discord doesn't time out after 3 seconds
  await interaction.deferReply();

  try {
    const startTime = Date.now();

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const text = response.text;

    if (!text) {
      log(`${colors.yellow}[${guild}] Empty response for "${prompt}" (${elapsed}s)${colors.reset}`);
      await interaction.editReply(
        "Gemini returned an empty response. Try rephrasing your prompt."
      );
      return;
    }

    log(`${colors.green}[${guild}] Response: ${text.length} chars in ${elapsed}s${colors.reset}`);
    log(`${colors.magenta}[${guild}] Gemini reply:\n${text}${colors.reset}`);

    // Prepend the user's prompt so it's visible in the reply
    const header = `> **${interaction.user.displayName} asked:** ${prompt}\n\n`;
    const fullText = header + text;

    // Split long responses into multiple messages
    const chunks = splitMessage(fullText);

    if (chunks.length > 1) {
      log(`${colors.yellow}[${guild}] Response split into ${chunks.length} messages${colors.reset}`);
    }

    // First chunk goes as the edit to the deferred reply
    await interaction.editReply(chunks[0]);

    // Remaining chunks are sent as follow-up messages
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp(chunks[i]);
    }
  } catch (error) {
    logError(`[${guild}] Gemini API failed for "${prompt}":`, error);
    await interaction.editReply(
      "❌ Sorry, something went wrong while contacting Gemini. Please try again later."
    );
  }
});

// ---------------------------------------------------------------------------
// Start the bot
// ---------------------------------------------------------------------------
client.login(DISCORD_TOKEN);
