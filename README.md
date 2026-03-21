# Gemini in Discord

A Discord bot that lets users query Google's Gemini AI directly from Discord using a `/gemini` slash command.

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- A Discord account
- A Google account

## Step 1 — Create a Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application**, give it a name (e.g. "Gemini Bot"), and click **Create**.
3. In the left sidebar, go to **Bot**.
4. Click **Reset Token** and copy the token — this is your `DISCORD_TOKEN`.
5. Go back to **General Information** in the sidebar and copy the **Application ID** — this is your `DISCORD_CLIENT_ID`.

## Step 2 — Get a Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/).
2. Sign in with your Google account.
3. Click **Get API key** in the left sidebar.
4. Click **Create API key** and copy it — this is your `GEMINI_API_KEY`.

The API key is free to use for getting started.

## Step 3 — Install and Configure

1. Clone this repository and navigate into it:

   ```bash
   git clone <repo-url>
   cd gemini-discord
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Open the `.env` file and replace the placeholder values with your actual keys:

   ```
   DISCORD_TOKEN=your_discord_bot_token_here
   DISCORD_CLIENT_ID=your_discord_client_id_here
   GEMINI_API_KEY=your_gemini_api_key_here
   GEMINI_MODEL=gemini-2.5-flash
   ```

## Step 4 — Invite the Bot to Your Server

1. Go back to the [Discord Developer Portal](https://discord.com/developers/applications) and select your application.
2. In the left sidebar, go to **OAuth2**.
3. Under **OAuth2 URL Generator**, select the following scopes:
   - `bot`
   - `applications.commands`
4. Under **Bot Permissions**, select:
   - Send Messages
   - Use Slash Commands
5. Copy the generated URL at the bottom and open it in your browser.
6. Select the server you want to add the bot to and click **Authorize**.

## Step 5 — Run the Bot

```bash
node index.js
```

You should see:

```
Logged in as Gemini Bot#1234
Slash command /gemini registered successfully.
```

## Usage

In any channel where the bot has access, type:

```
/gemini prompt: Who is Chuck Norris?
```

The bot will forward your prompt to Gemini 2.5 Flash and reply with the response. Long responses are automatically split into multiple messages.
