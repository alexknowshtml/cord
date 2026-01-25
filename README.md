# Cord

A Discord bot that connects to Claude Code CLI, plus a Claude Code skill that lets your assistant control the bot.

> **cord** /kôrd/ — a connection between two things.

[![npm version](https://badge.fury.io/js/cord-bot.svg)](https://www.npmjs.com/package/cord-bot)

## What You Get

**Discord Bot** — @mention the bot in Discord, it spawns Claude Code to respond. Conversations happen in threads with full context preserved across messages.

**Claude Code Skill** — Teaches your assistant to use the bot to send messages, embeds, files, and interactive buttons. Installed automatically during setup. No MCP server needed.

## Quick Start

```bash
# Create a new Cord project
bunx create-cord my-bot
cd my-bot

# Start Redis (if not already running)
redis-server &

# Start Cord
cord start
```

<details>
<summary>Alternative: Clone from GitHub</summary>

```bash
git clone https://github.com/alexknowshtml/cord.git my-bot
cd my-bot
bun install
cord setup
cord start
```
</details>

## Prerequisites

- [Bun](https://bun.sh) runtime
- [Redis](https://redis.io) server
- [Claude Code CLI](https://claude.ai/code) installed and authenticated
- Discord bot token (see setup below)

## Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, give it a name
3. Go to **Bot** tab → Click **Add Bot**
4. Under **Privileged Gateway Intents**, enable:
   - **Message Content Intent** (required to read message text)
5. Click **Reset Token** → Copy the token (this is your `DISCORD_BOT_TOKEN`)
6. Go to **OAuth2** → **URL Generator**:
   - Scopes: `bot`
   - Bot Permissions: `Send Messages`, `Create Public Threads`, `Send Messages in Threads`, `Read Message History`
7. Copy the generated URL → Open in browser → Invite bot to your server

**Note:** This runs 100% locally. The bot connects *outbound* to Discord's gateway - no need to expose ports or use ngrok.

## Architecture

```
Discord Bot  →  BullMQ Queue  →  Claude Spawner
 (Node.js)       (Redis)          (Bun)
```

- **Bot** (`src/bot.ts`): Catches @mentions, creates threads, sends to queue
- **Queue** (`src/queue.ts`): BullMQ job queue for reliable processing
- **Worker** (`src/worker.ts`): Pulls jobs, spawns Claude, posts responses
- **Spawner** (`src/spawner.ts`): The Claude CLI integration (the core)
- **DB** (`src/db.ts`): SQLite for thread→session mapping

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_BOT_TOKEN` | Yes | - | Your Discord bot token |
| `REDIS_HOST` | No | `localhost` | Redis server host |
| `REDIS_PORT` | No | `6379` | Redis server port |
| `CLAUDE_WORKING_DIR` | No | `cwd` | Working directory for Claude |
| `DB_PATH` | No | `./data/threads.db` | SQLite database path |

## CLI Commands

Once running, Cord provides CLI commands for interacting with Discord:

```bash
cord send <channel> "message"           # Send a message
cord embed <channel> "text" --title "T" # Send formatted embed
cord file <channel> ./report.md         # Send file attachment
cord buttons <channel> "Pick:" --button label="Yes" id="yes" style="success"
cord typing <channel>                   # Show typing indicator
cord edit <channel> <msgId> "new text"  # Edit message
cord delete <channel> <msgId>           # Delete message
cord reply <channel> <msgId> "reply"    # Reply to message
cord react <channel> <msgId> "emoji"    # Add reaction
cord thread <channel> <msgId> "name"    # Create thread
cord rename <threadId> "new name"       # Rename thread
```

See [skills/cord/SKILL.md](./skills/cord/SKILL.md) for full CLI documentation.

## HTTP API

Cord also exposes an HTTP API on port 2643 for external scripts and webhooks.

See [skills/cord/HTTP-API.md](./skills/cord/HTTP-API.md) for API documentation.

## License

MIT
