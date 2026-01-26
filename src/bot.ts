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
        GatewayIntentBits.GuildMessageReactions,
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

    // Post status message in channel, then create thread from it
    // This allows us to update the status message later (Processing... → Done)
    let statusMessage;
    let thread;
    try {
        // Post status message in the channel
        statusMessage = await (message.channel as TextChannel).send('🤖 Processing...');

        // Generate thread name from message content
        const rawText = message.content.replace(/<@!?\d+>/g, '').trim();
        const threadName = rawText.length > 50
            ? rawText.slice(0, 47) + '...'
            : rawText || 'New conversation';

        // Create thread from the status message
        thread = await statusMessage.startThread({
            name: threadName,
            autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
        });

        // Copy the original message content into the thread for context
        // (excluding the bot mention and the status message)
        const originalMessages = await message.channel.messages.fetch({ limit: 10 });
        const userMessage = originalMessages.find(m => m.id === message.id);
        if (userMessage) {
            await thread.send(`**${message.author.tag}:** ${rawText}`);
        }
    } catch (error) {
        log(`Failed to create thread: ${error}`);
        await message.reply('Failed to start thread. Try again?');
        return;
    }

    // Generate a new session ID for this conversation
    const sessionId = crypto.randomUUID();

    // Store the thread → session mapping
    // Note: thread.id === statusMessage.id because thread was created from that message
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

// =========================================================================
// REACTION HANDLER: ✅ on last message marks thread as done
// =========================================================================
client.on(Events.MessageReactionAdd, async (reaction, user) => {
    // Ignore bot reactions
    if (user.bot) return;

    // Only handle ✅ reactions
    if (reaction.emoji.name !== '✅') return;

    // Only handle reactions in threads
    const channel = reaction.message.channel;
    if (!channel.isThread()) return;

    try {
        const thread = channel;
        const parentChannelId = thread.parentId;
        if (!parentChannelId) return;

        // Check if this is the last message in the thread
        const messages = await thread.messages.fetch({ limit: 1 });
        const lastMessage = messages.first();

        if (!lastMessage || lastMessage.id !== reaction.message.id) {
            // Reaction is not on the last message, ignore
            return;
        }

        log(`✅ reaction on last message in thread ${thread.id}`);

        // Update thread starter message to "Done"
        // The thread ID equals the starter message ID (thread was created from that message)
        const parentChannel = await client.channels.fetch(parentChannelId);
        if (parentChannel?.isTextBased()) {
            const starterMessage = await (parentChannel as TextChannel).messages.fetch(thread.id);
            await starterMessage.edit('✅ Done');
            log(`Thread ${thread.id} marked as Done`);
        }
    } catch (error) {
        log(`Failed to mark thread done: ${error}`);
    }
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
