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
// Configuration
// ---------------------------------------------------------------------------
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID || !GEMINI_API_KEY) {
  console.error(
    "Missing environment variables. Make sure DISCORD_TOKEN, DISCORD_CLIENT_ID, and GEMINI_API_KEY are set in your .env file."
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
    console.log(`Logged in as ${client.user.tag}`);

    const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

    try {
        await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), {
            body: [geminiCommand.toJSON()],
        });
        console.log("Slash command /gemini registered successfully.");
    } catch (error) {
        console.error("Failed to register slash commands:", error);
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

  // Defer the reply so Discord doesn't time out after 3 seconds
  await interaction.deferReply();

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
    });

    const text = response.text;

    if (!text) {
      await interaction.editReply(
        "Gemini returned an empty response. Try rephrasing your prompt."
      );
      return;
    }

    // Prepend the user's prompt so it's visible in the reply
    const header = `**${interaction.user.displayName} asked:** ${prompt}\n\n`;
    const fullText = header + text;

    // Split long responses into multiple messages
    const chunks = splitMessage(fullText);

    // First chunk goes as the edit to the deferred reply
    await interaction.editReply(chunks[0]);

    // Remaining chunks are sent as follow-up messages
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp(chunks[i]);
    }
  } catch (error) {
    console.error("Gemini API error:", error);
    await interaction.editReply(
      "❌ Sorry, something went wrong while contacting Gemini. Please try again later."
    );
  }
});

// ---------------------------------------------------------------------------
// Start the bot
// ---------------------------------------------------------------------------
client.login(DISCORD_TOKEN);
