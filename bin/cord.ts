#!/usr/bin/env bun
/**
 * Cord CLI - Manage your Discord-Claude bridge
 *
 * Commands:
 *   cord start   - Start bot and worker
 *   cord stop    - Stop all processes
 *   cord status  - Show running status
 *   cord logs    - Show combined logs
 *   cord setup   - Interactive setup wizard
 */

import { spawn, spawnSync } from 'bun';
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import * as readline from 'readline';
import { homedir } from 'os';

const PID_FILE = join(process.cwd(), '.cord.pid');

const command = process.argv[2];

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

Usage: cord <command>

Commands:
  start   Start bot and worker
  stop    Stop all processes
  status  Show running status
  setup   Interactive setup wizard
  help    Show this help

Examples:
  cord setup    # First-time configuration
  cord start    # Start the bot
  cord status   # Check if running
  cord stop     # Stop everything
`);
}

// Main
switch (command) {
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
    default:
        console.log(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
}
