# Cord

A Discord bot that connects to Claude Code CLI, plus a Claude Code skill that lets your assistant control the bot.

> **cord** /kôrd/ — a connection between two things.

[![npm version](https://badge.fury.io/js/cord-bot.svg)](https://www.npmjs.com/package/cord-bot)

## What You Get

**Discord Bot** — @mention the bot in Discord, it spawns Claude Code to respond. Conversations happen in threads with full context preserved across messages.

**Claude Code Skill** — Teaches your assistant how to send Discord messages, embeds, files, and interactive buttons. Installed automatically during setup.

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

## HTTP API

Cord exposes an HTTP API on port 2643 for external tools to interact with Discord:

- **Send messages** - Text, embeds, file attachments
- **Interactive buttons** - With inline or webhook handlers
- **Typing indicators** - Show typing before slow operations
- **Edit/delete messages** - Modify existing messages
- **Rename threads** - Update thread names

See [skills/cord/PRIMITIVES.md](./skills/cord/PRIMITIVES.md) for full API documentation.

## License

MIT
