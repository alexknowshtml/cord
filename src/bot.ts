/**
 * Discord Bot - Catches @mentions, creates threads, forwards to queue
 *
 * This is the entry point for the Discord → Claude bridge.
 * When someone @mentions the bot, it:
 * 1. Creates a thread for the conversation
 * 2. Queues the message for Claude processing
 * 3. Posts responses back to the thread
 */

import {
    Client,
    GatewayIntentBits,
    Events,
    Message,
    TextChannel,
    ThreadAutoArchiveDuration,
    Interaction,
} from 'discord.js';
import { claudeQueue } from './queue.js';
import { db } from './db.js';
import { startApiServer, buttonHandlers } from './api.js';

// Force unbuffered logging
const log = (msg: string) => process.stdout.write(`[bot] ${msg}\n`);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.once(Events.ClientReady, (c) => {
    log(`Logged in as ${c.user.tag}`);

    // Start HTTP API server
    const apiPort = parseInt(process.env.API_PORT || '2643');
    startApiServer(client, apiPort);
});

// Handle button interactions
client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (!interaction.isButton()) return;

    const handler = buttonHandlers.get(interaction.customId);
    if (!handler) {
        await interaction.reply({ content: 'This button has expired.', ephemeral: true });
        return;
    }

    try {
        if (handler.type === 'inline') {
            await interaction.reply({
                content: handler.content,
                ephemeral: handler.ephemeral ?? false,
            });
        } else if (handler.type === 'webhook') {
            await interaction.deferReply({ ephemeral: true });
            const response = await fetch(handler.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customId: interaction.customId,
                    userId: interaction.user.id,
                    channelId: interaction.channelId,
                    data: handler.data,
                }),
            });
            const result = await response.json() as { content?: string };
            await interaction.editReply({ content: result.content || 'Done.' });
        }
    } catch (error) {
        log(`Button handler error: ${error}`);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'An error occurred.', ephemeral: true });
        }
    }
});

client.on(Events.MessageCreate, async (message: Message) => {
    // Ignore bots
    if (message.author.bot) return;

    const isMentioned = client.user && message.mentions.has(client.user);
    const isInThread = message.channel.isThread();

    // =========================================================================
    // THREAD MESSAGES: Continue existing conversations
    // =========================================================================
    if (isInThread) {
        const thread = message.channel;

        // Look up session ID for this thread
        const mapping = db.query('SELECT session_id FROM threads WHERE thread_id = ?')
            .get(thread.id) as { session_id: string } | null;

        if (!mapping) {
            // Not a thread we created, ignore
            return;
        }

        log(`Thread message from ${message.author.tag}`);

        // Show typing indicator
        await thread.sendTyping();

        // Extract message content (strip @mentions)
        const content = message.content.replace(/<@!?\d+>/g, '').trim();

        // Queue for Claude processing with session resume
        await claudeQueue.add('process', {
            prompt: content,
            threadId: thread.id,
            sessionId: mapping.session_id,
            resume: true,
            userId: message.author.id,
            username: message.author.tag,
        });

        return;
    }

    // =========================================================================
    // NEW MENTIONS: Start new conversations
    // =========================================================================
    if (!isMentioned) return;

    log(`New mention from ${message.author.tag}`);

    // Create a thread for the conversation
    let thread;
    try {
        // Generate thread name from message content
        const rawText = message.content.replace(/<@!?\d+>/g, '').trim();
        const threadName = rawText.length > 50
            ? rawText.slice(0, 47) + '...'
            : rawText || 'New conversation';

        thread = await message.startThread({
            name: threadName,
            autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
        });
    } catch (error) {
        log(`Failed to create thread: ${error}`);
        await message.reply('Failed to start thread. Try again?');
        return;
    }

    // Generate a new session ID for this conversation
    const sessionId = crypto.randomUUID();

    // Store the thread → session mapping
    db.run(
        'INSERT INTO threads (thread_id, session_id) VALUES (?, ?)',
        [thread.id, sessionId]
    );

    log(`Created thread ${thread.id} with session ${sessionId}`);

    // Show typing indicator
    await thread.sendTyping();

    // Extract message content
    const content = message.content.replace(/<@!?\d+>/g, '').trim();

    // Queue for Claude processing
    await claudeQueue.add('process', {
        prompt: content,
        threadId: thread.id,
        sessionId,
        resume: false,
        userId: message.author.id,
        username: message.author.tag,
    });
});

// Start the bot
const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
    console.error('DISCORD_BOT_TOKEN required');
    process.exit(1);
}

client.login(token);

// Export for external use
export { client };
