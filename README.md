# Cord

A simple bridge that connects Discord to Claude Code CLI.

> **cord** /kôrd/ — a connection between two things.

[![npm version](https://badge.fury.io/js/cord-bot.svg)](https://www.npmjs.com/package/cord-bot)

## Install

```bash
npm install cord-bot
# or
bunx cord-bot
```

When someone @mentions your bot, it:
1. Creates a thread for the conversation
2. Queues the message for Claude processing
3. Posts Claude's response back to the thread
4. Remembers context for follow-up messages

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

## Quick Start

```bash
# Install dependencies
bun install

# Set environment variables
export DISCORD_BOT_TOKEN="your-bot-token"

# Start Redis (if not already running)
redis-server &

# Start the bot and worker
bun run src/bot.ts &
bun run src/worker.ts
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_BOT_TOKEN` | Yes | - | Your Discord bot token |
| `REDIS_HOST` | No | `localhost` | Redis server host |
| `REDIS_PORT` | No | `6379` | Redis server port |
| `CLAUDE_WORKING_DIR` | No | `cwd` | Working directory for Claude |
| `DB_PATH` | No | `./data/threads.db` | SQLite database path |

## How It Works

### New Mentions

1. User @mentions the bot with a question
2. Bot creates a thread from the message
3. Bot generates a UUID session ID
4. Bot stores thread_id → session_id in SQLite
5. Bot queues a job with the prompt and session ID
6. Worker picks up the job
7. Worker spawns Claude with `--session-id UUID`
8. Worker posts Claude's response to the thread

### Follow-up Messages

1. User sends another message in the thread
2. Bot looks up the session ID from SQLite
3. Bot queues a job with `resume: true`
4. Worker spawns Claude with `--resume UUID`
5. Claude has full context from previous messages

## Key CLI Flags

The magic is in `src/spawner.ts`:

```typescript
// For new sessions:
claude --print --session-id UUID -p "prompt"

// For follow-ups:
claude --print --resume UUID -p "prompt"

// Inject context that survives compaction:
claude --append-system-prompt "Current time: ..."
```

## HTTP API

Cord exposes an HTTP API on port 2643 for external tools to interact with Discord:

- **Send messages** - Text, embeds, file attachments
- **Interactive buttons** - With inline or webhook handlers
- **Typing indicators** - Show typing before slow operations
- **Edit/delete messages** - Modify existing messages
- **Rename threads** - Update thread names

See [skills/cord/PRIMITIVES.md](./skills/cord/PRIMITIVES.md) for full API documentation.

## Claude Code Skill

Cord includes a Claude Code skill that teaches Claude how to use the HTTP API:

```bash
# Copy to your Claude Code skills folder
cp -r skills/cord ~/.claude/skills/
```

Once installed, Claude Code automatically knows how to send Discord messages, embeds, and buttons when you ask.

See [skills/cord/SKILL.md](./skills/cord/SKILL.md) for skill documentation.

## License

MIT
