#!/usr/bin/env bun
/**
 * Cord CLI - Manage your Discord-Claude bridge
 *
 * Management Commands:
 *   cord start   - Start bot and worker
 *   cord stop    - Stop all processes
 *   cord status  - Show running status
 *   cord setup   - Interactive setup wizard
 *
 * Discord Commands:
 *   cord send <channel> "message"
 *   cord embed <channel> "description" [--title, --color, --field, etc.]
 *   cord file <channel> <filepath> "message"
 *   cord buttons <channel> "prompt" --button label="..." id="..." [style, reply, webhook]
 *   cord typing <channel>
 *   cord edit <channel> <messageId> "content"
 *   cord delete <channel> <messageId>
 *   cord rename <threadId> "name"
 *   cord reply <channel> <messageId> "message"
 *   cord thread <channel> <messageId> "name"
 *   cord react <channel> <messageId> "emoji"
 *   cord state <channel> <messageId> <state>  (processing, done, error, or custom)
 */

import { spawn, spawnSync } from 'bun';
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import * as readline from 'readline';
import { homedir } from 'os';

const PID_FILE = join(process.cwd(), '.cord.pid');
const API_BASE = process.env.CORD_API_URL || 'http://localhost:2643';

const command = process.argv[2];
const args = process.argv.slice(3);

// Color name to Discord color int mapping
const COLORS: Record<string, number> = {
    red: 15158332,      // 0xE74C3C
    green: 3066993,     // 0x2ECC71
    blue: 3447003,      // 0x3498DB
    yellow: 16776960,   // 0xFFFF00
    purple: 10181046,   // 0x9B59B6
    orange: 15105570,   // 0xE67E22
    gray: 9807270,      // 0x95A5A6
    grey: 9807270,      // 0x95A5A6
};

// Button style name to Discord style int mapping
const BUTTON_STYLES: Record<string, number> = {
    primary: 1,
    secondary: 2,
    success: 3,
    danger: 4,
};

async function prompt(question: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

// ============ API Helper ============

async function apiCall(endpoint: string, body: any): Promise<any> {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await response.json();
        if (!response.ok || data.error) {
            console.error('Error:', data.error || 'Request failed');
            process.exit(1);
        }
        return data;
    } catch (error: any) {
        if (error.code === 'ECONNREFUSED') {
            console.error('Error: Cannot connect to Cord API. Is the bot running? (cord start)');
        } else {
            console.error('Error:', error.message);
        }
        process.exit(1);
    }
}

// ============ Discord Commands ============

async function sendMessage() {
    const channel = args[0];
    const message = args[1];
    if (!channel || !message) {
        console.error('Usage: cord send <channel> "message"');
        process.exit(1);
    }
    const result = await apiCall('/command', {
        command: 'send-to-thread',
        args: { thread: channel, message },
    });
    console.log(`Sent message: ${result.messageId}`);
}

async function sendEmbed() {
    const channel = args[0];
    if (!channel) {
        console.error('Usage: cord embed <channel> "description" [--title "..." --color green ...]');
        process.exit(1);
    }

    // Parse flags and find positional description
    const embed: any = {};
    const fields: any[] = [];
    let description = '';
    let i = 1;

    while (i < args.length) {
        const arg = args[i];
        if (arg === '--title' && args[i + 1]) {
            embed.title = args[++i];
        } else if (arg === '--url' && args[i + 1]) {
            embed.url = args[++i];
        } else if (arg === '--color' && args[i + 1]) {
            const colorArg = args[++i].toLowerCase();
            embed.color = COLORS[colorArg] || parseInt(colorArg.replace('0x', ''), 16) || 0;
        } else if (arg === '--author' && args[i + 1]) {
            embed.author = embed.author || {};
            embed.author.name = args[++i];
        } else if (arg === '--author-url' && args[i + 1]) {
            embed.author = embed.author || {};
            embed.author.url = args[++i];
        } else if (arg === '--author-icon' && args[i + 1]) {
            embed.author = embed.author || {};
            embed.author.icon_url = args[++i];
        } else if (arg === '--thumbnail' && args[i + 1]) {
            embed.thumbnail = { url: args[++i] };
        } else if (arg === '--image' && args[i + 1]) {
            embed.image = { url: args[++i] };
        } else if (arg === '--footer' && args[i + 1]) {
            embed.footer = embed.footer || {};
            embed.footer.text = args[++i];
        } else if (arg === '--footer-icon' && args[i + 1]) {
            embed.footer = embed.footer || {};
            embed.footer.icon_url = args[++i];
        } else if (arg === '--timestamp') {
            embed.timestamp = new Date().toISOString();
        } else if (arg === '--field' && args[i + 1]) {
            const fieldStr = args[++i];
            const parts = fieldStr.split(':');
            if (parts.length >= 2) {
                fields.push({
                    name: parts[0],
                    value: parts[1],
                    inline: parts[2]?.toLowerCase() === 'inline',
                });
            }
        } else if (!arg.startsWith('--')) {
            description = arg;
        }
        i++;
    }

    if (description) embed.description = description;
    if (fields.length > 0) embed.fields = fields;

    const result = await apiCall('/command', {
        command: 'send-to-thread',
        args: { thread: channel, embeds: [embed] },
    });
    console.log(`Sent embed: ${result.messageId}`);
}

async function sendFile() {
    const channel = args[0];
    const filepath = args[1];
    const message = args[2] || '';

    if (!channel || !filepath) {
        console.error('Usage: cord file <channel> <filepath> ["message"]');
        process.exit(1);
    }

    if (!existsSync(filepath)) {
        console.error(`Error: File not found: ${filepath}`);
        process.exit(1);
    }

    const fileContent = readFileSync(filepath, 'utf-8');
    const fileName = filepath.split('/').pop() || 'file.txt';

    const result = await apiCall('/send-with-file', {
        channelId: channel,
        fileName,
        fileContent,
        content: message,
    });
    console.log(`Sent file: ${result.messageId}`);
}

async function sendButtons() {
    const channel = args[0];
    if (!channel) {
        console.error('Usage: cord buttons <channel> "prompt" --button label="..." id="..." [style="success"] [reply="..."] [webhook="..."]');
        process.exit(1);
    }

    let promptText = '';
    const buttons: any[] = [];
    let i = 1;

    while (i < args.length) {
        const arg = args[i];
        if (arg === '--button') {
            // Collect all following key=value pairs until next flag or end
            const button: any = {};
            i++;
            while (i < args.length && !args[i].startsWith('--')) {
                const kvMatch = args[i].match(/^(\w+)=(.*)$/);
                if (kvMatch) {
                    const [, key, value] = kvMatch;
                    if (key === 'style') {
                        button.style = BUTTON_STYLES[value.toLowerCase()] || 1;
                    } else {
                        button[key] = value;
                    }
                }
                i++;
            }
            if (button.label && button.id) {
                // Convert to API format
                const apiButton: any = {
                    label: button.label,
                    customId: button.id,
                    style: button.style || 1,
                };
                if (button.reply || button.webhook) {
                    apiButton.handler = {};
                    if (button.reply) {
                        apiButton.handler.type = 'inline';
                        apiButton.handler.content = button.reply;
                        apiButton.handler.ephemeral = true;
                    }
                    if (button.webhook) {
                        apiButton.handler.type = button.reply ? 'inline' : 'webhook';
                        apiButton.handler.webhookUrl = button.webhook;
                    }
                }
                buttons.push(apiButton);
            }
            continue; // Don't increment i again
        } else if (!arg.startsWith('--')) {
            promptText = arg;
        }
        i++;
    }

    if (buttons.length === 0) {
        console.error('Error: At least one --button is required');
        process.exit(1);
    }

    const result = await apiCall('/send-with-buttons', {
        channelId: channel,
        content: promptText,
        buttons,
    });
    console.log(`Sent buttons: ${result.messageId}`);
}

async function startTyping() {
    const channel = args[0];
    if (!channel) {
        console.error('Usage: cord typing <channel>');
        process.exit(1);
    }
    await apiCall('/command', {
        command: 'start-typing',
        args: { channel },
    });
    console.log('Typing indicator sent');
}

async function editMessage() {
    const channel = args[0];
    const messageId = args[1];
    const content = args[2];
    if (!channel || !messageId || !content) {
        console.error('Usage: cord edit <channel> <messageId> "new content"');
        process.exit(1);
    }
    await apiCall('/command', {
        command: 'edit-message',
        args: { channel, message: messageId, content },
    });
    console.log(`Edited message: ${messageId}`);
}

async function deleteMessage() {
    const channel = args[0];
    const messageId = args[1];
    if (!channel || !messageId) {
        console.error('Usage: cord delete <channel> <messageId>');
        process.exit(1);
    }
    await apiCall('/command', {
        command: 'delete-message',
        args: { channel, message: messageId },
    });
    console.log(`Deleted message: ${messageId}`);
}

async function renameThread() {
    const threadId = args[0];
    const name = args[1];
    if (!threadId || !name) {
        console.error('Usage: cord rename <threadId> "new name"');
        process.exit(1);
    }
    await apiCall('/command', {
        command: 'rename-thread',
        args: { thread: threadId, name },
    });
    console.log(`Renamed thread: ${threadId}`);
}

async function replyToMessage() {
    const channel = args[0];
    const messageId = args[1];
    const message = args[2];
    if (!channel || !messageId || !message) {
        console.error('Usage: cord reply <channel> <messageId> "message"');
        process.exit(1);
    }
    const result = await apiCall('/command', {
        command: 'reply-to-message',
        args: { channel, message: messageId, content: message },
    });
    console.log(`Replied to message: ${result.messageId}`);
}

async function createThread() {
    const channel = args[0];
    const messageId = args[1];
    const name = args[2];
    if (!channel || !messageId || !name) {
        console.error('Usage: cord thread <channel> <messageId> "thread name"');
        process.exit(1);
    }
    const result = await apiCall('/command', {
        command: 'create-thread',
        args: { channel, message: messageId, name },
    });
    console.log(`Created thread: ${result.threadId}`);
}

async function addReaction() {
    const channel = args[0];
    const messageId = args[1];
    const emoji = args[2];
    if (!channel || !messageId || !emoji) {
        console.error('Usage: cord react <channel> <messageId> "emoji"');
        process.exit(1);
    }
    await apiCall('/command', {
        command: 'add-reaction',
        args: { channel, message: messageId, emoji },
    });
    console.log(`Added reaction: ${emoji}`);
}

// State presets for thread status updates
const STATE_PRESETS: Record<string, string> = {
    processing: '🤖 Processing...',
    thinking: '🧠 Thinking...',
    searching: '🔍 Searching...',
    writing: '✍️ Writing...',
    done: '✅ Done',
    error: '❌ Something went wrong',
    waiting: '⏳ Waiting for input...',
};

async function updateState() {
    const channel = args[0];
    const messageId = args[1];
    const stateOrCustom = args[2];

    if (!channel || !messageId || !stateOrCustom) {
        console.error('Usage: cord state <channel> <messageId> <state>');
        console.error('');
        console.error('Preset states:');
        console.error('  processing  - 🤖 Processing...');
        console.error('  thinking    - 🧠 Thinking...');
        console.error('  searching   - 🔍 Searching...');
        console.error('  writing     - ✍️ Writing...');
        console.error('  done        - ✅ Done');
        console.error('  error       - ❌ Something went wrong');
        console.error('  waiting     - ⏳ Waiting for input...');
        console.error('');
        console.error('Or use custom text: cord state <channel> <messageId> "Custom status"');
        process.exit(1);
    }

    const content = STATE_PRESETS[stateOrCustom.toLowerCase()] || stateOrCustom;

    await apiCall('/command', {
        command: 'edit-message',
        args: { channel, message: messageId, content },
    });
    console.log(`Updated state: ${content}`);
}

// ============ Management Commands ============

async function setup() {
    console.log('\n🔌 Cord Setup\n');

    // Check for .env
    const envPath = join(process.cwd(), '.env');
    const envExamplePath = join(process.cwd(), '.env.example');

    if (existsSync(envPath)) {
        console.log('✓ .env file exists');
    } else if (existsSync(envExamplePath)) {
        console.log('Creating .env from .env.example...\n');

        const token = await prompt('Discord Bot Token: ');
        if (!token) {
            console.log('Token required. Run setup again when ready.');
            process.exit(1);
        }

        const tz = await prompt('Timezone (default: America/New_York): ') || 'America/New_York';

        let envContent = readFileSync(envExamplePath, 'utf-8');
        envContent = envContent.replace('your-bot-token-here', token);
        envContent = envContent.replace('TZ=America/New_York', `TZ=${tz}`);

        writeFileSync(envPath, envContent);
        console.log('\n✓ .env file created');
    }

    // Check Redis
    const redis = spawnSync(['redis-cli', 'ping'], { stdout: 'pipe', stderr: 'pipe' });
    if (redis.exitCode === 0) {
        console.log('✓ Redis is running');
    } else {
        console.log('⚠ Redis not running. Start it with: redis-server');
    }

    // Check Claude CLI
    const claude = spawnSync(['claude', '--version'], { stdout: 'pipe', stderr: 'pipe' });
    if (claude.exitCode === 0) {
        console.log('✓ Claude CLI installed');
    } else {
        console.log('⚠ Claude CLI not found. Install from: https://claude.ai/code');
    }

    // Install Claude Code skill
    const skillsDir = join(homedir(), '.claude', 'skills', 'cord');
    const cordRoot = join(dirname(import.meta.dir));
    const sourceSkillsDir = join(cordRoot, 'skills', 'cord');

    if (existsSync(sourceSkillsDir)) {
        console.log('\n📚 Claude Code Skill');
        console.log('   Teaches your assistant how to send Discord messages, embeds,');
        console.log('   files, and interactive buttons.');
        const installSkill = await prompt('Install skill? (Y/n): ');
        if (installSkill.toLowerCase() !== 'n') {
            mkdirSync(skillsDir, { recursive: true });
            cpSync(sourceSkillsDir, skillsDir, { recursive: true });
            console.log(`✓ Skill installed to ${skillsDir}`);
        }
    }

    console.log('\n✨ Setup complete! Run: cord start\n');
}

async function start() {
    if (existsSync(PID_FILE)) {
        console.log('Cord is already running. Run: cord stop');
        process.exit(1);
    }

    console.log('Starting Cord...\n');

    // Start bot
    const bot = spawn(['bun', 'run', 'src/bot.ts'], {
        stdout: 'inherit',
        stderr: 'inherit',
        cwd: process.cwd(),
    });

    // Start worker
    const worker = spawn(['bun', 'run', 'src/worker.ts'], {
        stdout: 'inherit',
        stderr: 'inherit',
        cwd: process.cwd(),
    });

    // Save PIDs
    writeFileSync(PID_FILE, JSON.stringify({
        bot: bot.pid,
        worker: worker.pid,
        startedAt: new Date().toISOString(),
    }));

    console.log(`Bot PID: ${bot.pid}`);
    console.log(`Worker PID: ${worker.pid}`);
    console.log('\nCord is running. Press Ctrl+C to stop.\n');

    // Handle exit
    process.on('SIGINT', () => {
        console.log('\nStopping Cord...');
        bot.kill();
        worker.kill();
        if (existsSync(PID_FILE)) {
            const fs = require('fs');
            fs.unlinkSync(PID_FILE);
        }
        process.exit(0);
    });

    // Wait for processes
    await Promise.all([bot.exited, worker.exited]);
}

function stop() {
    if (!existsSync(PID_FILE)) {
        console.log('Cord is not running.');
        return;
    }

    const pids = JSON.parse(readFileSync(PID_FILE, 'utf-8'));

    try {
        process.kill(pids.bot);
        console.log(`Stopped bot (PID ${pids.bot})`);
    } catch {}

    try {
        process.kill(pids.worker);
        console.log(`Stopped worker (PID ${pids.worker})`);
    } catch {}

    const fs = require('fs');
    fs.unlinkSync(PID_FILE);
    console.log('Cord stopped.');
}

function status() {
    if (!existsSync(PID_FILE)) {
        console.log('Cord is not running.');
        return;
    }

    const pids = JSON.parse(readFileSync(PID_FILE, 'utf-8'));

    const botAlive = isProcessRunning(pids.bot);
    const workerAlive = isProcessRunning(pids.worker);

    console.log(`Bot:    ${botAlive ? '✓ running' : '✗ stopped'} (PID ${pids.bot})`);
    console.log(`Worker: ${workerAlive ? '✓ running' : '✗ stopped'} (PID ${pids.worker})`);
    console.log(`Started: ${pids.startedAt}`);
}

function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function showHelp() {
    console.log(`
Cord - Discord to Claude Code bridge

Usage: cord <command> [options]

Management Commands:
  start              Start bot and worker
  stop               Stop all processes
  status             Show running status
  setup              Interactive setup wizard
  help               Show this help

Discord Commands:
  send <channel> "message"
      Send a text message

  embed <channel> "description" [options]
      Send an embed with optional formatting
      --title "..."          Embed title
      --url "..."            Title link URL
      --color <name|hex>     red, green, blue, yellow, purple, orange, or 0xHEX
      --author "..."         Author name
      --author-url "..."     Author link
      --author-icon "..."    Author icon URL
      --thumbnail "..."      Small image (top right)
      --image "..."          Large image (bottom)
      --footer "..."         Footer text
      --footer-icon "..."    Footer icon URL
      --timestamp            Add current timestamp
      --field "Name:Value"   Add field (use :inline for inline)

  file <channel> <filepath> ["message"]
      Send a file attachment

  buttons <channel> "prompt" --button label="..." id="..." [options]
      Send interactive buttons
      Button options:
        label="..."          Button text (required)
        id="..."             Custom ID (required)
        style="..."          primary, secondary, success, danger
        reply="..."          Ephemeral reply when clicked
        webhook="..."        URL to POST click data to

  typing <channel>
      Show typing indicator

  edit <channel> <messageId> "content"
      Edit an existing message

  delete <channel> <messageId>
      Delete a message

  rename <threadId> "name"
      Rename a thread

  reply <channel> <messageId> "message"
      Reply to a specific message

  thread <channel> <messageId> "name"
      Create a thread from a message

  react <channel> <messageId> "emoji"
      Add a reaction to a message

  state <channel> <messageId> <state>
      Update thread status with preset or custom text
      Presets: processing, thinking, searching, writing, done, error, waiting

Examples:
  cord send 123456789 "Hello world!"
  cord embed 123456789 "Status update" --title "Daily Report" --color green --field "Tasks:5 done:inline"
  cord buttons 123456789 "Approve?" --button label="Yes" id="approve" style="success" reply="Approved!"
  cord file 123456789 ./report.md "Here's the report"
  cord state 123456789 1234567890 processing
  cord state 123456789 1234567890 done
`);
}

// ============ Main ============

switch (command) {
    // Management
    case 'start':
        start();
        break;
    case 'stop':
        stop();
        break;
    case 'status':
        status();
        break;
    case 'setup':
        setup();
        break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
        showHelp();
        break;

    // Discord commands
    case 'send':
        sendMessage();
        break;
    case 'embed':
        sendEmbed();
        break;
    case 'file':
        sendFile();
        break;
    case 'buttons':
        sendButtons();
        break;
    case 'typing':
        startTyping();
        break;
    case 'edit':
        editMessage();
        break;
    case 'delete':
        deleteMessage();
        break;
    case 'rename':
        renameThread();
        break;
    case 'reply':
        replyToMessage();
        break;
    case 'thread':
        createThread();
        break;
    case 'react':
        addReaction();
        break;
    case 'state':
        updateState();
        break;

    default:
        console.log(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
}
