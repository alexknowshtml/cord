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
    SlashCommandBuilder,
    type Interaction,
} from 'discord.js';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { claudeQueue } from './queue.js';
import { db, getChannelConfig, setChannelConfig, getThreadWorkingDir } from './db.js';
import { startApiServer, buttonHandlers } from './api.js';

// Force unbuffered logging
const log = (msg: string) => process.stdout.write(`[bot] ${msg}\n`);

// Helper function to resolve working directory from message or channel config
function resolveWorkingDir(message: string, channelId: string): { workingDir: string; cleanedMessage: string } {
    // Check for [/path] prefix override
    const pathMatch = message.match(/^\[([^\]]+)\]\s*/);
    if (pathMatch && pathMatch[1]) {
        return {
            workingDir: pathMatch[1],
            cleanedMessage: message.slice(pathMatch[0].length)
        };
    }

    // Check channel config
    const channelConfig = getChannelConfig(channelId);
    if (channelConfig?.working_dir) {
        return { workingDir: channelConfig.working_dir, cleanedMessage: message };
    }

    // Fall back to env or cwd
    return {
        workingDir: process.env.CLAUDE_WORKING_DIR || process.cwd(),
        cleanedMessage: message
    };
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
    ],
});

client.once(Events.ClientReady, async (c) => {
    log(`Logged in as ${c.user.tag}`);

    // Register slash commands
    const command = new SlashCommandBuilder()
        .setName('cord')
        .setDescription('Configure Cord bot')
        .addSubcommand(sub =>
            sub.setName('config')
               .setDescription('Configure channel settings')
               .addStringOption(opt =>
                   opt.setName('dir')
                      .setDescription('Working directory for Claude in this channel')
                      .setRequired(true)
               )
        );

    await c.application?.commands.create(command);
    log('Slash commands registered');

    // Start HTTP API server
    const apiPort = parseInt(process.env.API_PORT || '2643');
    startApiServer(client, apiPort);
});

// Handle slash command and button interactions
client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    // Handle /cord slash command
    if (interaction.isChatInputCommand() && interaction.commandName === 'cord') {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'config') {
            let dir = interaction.options.getString('dir', true);

            // Expand ~ to home directory
            if (dir.startsWith('~')) {
                dir = dir.replace('~', homedir());
            }

            // Validate path exists
            if (!existsSync(dir)) {
                await interaction.reply({
                    content: `Directory not found: \`${dir}\``,
                    ephemeral: true
                });
                return;
            }

            setChannelConfig(interaction.channelId, dir);
            await interaction.reply({
                content: `Working directory set to \`${dir}\` for this channel.`,
                ephemeral: true
            });
            log(`Channel ${interaction.channelId} configured with working dir: ${dir}`);
        }
        return;
    }

    if (!interaction.isButton()) return;

    log(`Looking up handler for: ${interaction.customId}`);
    log(`Available handlers: ${Array.from(buttonHandlers.keys()).join(', ') || 'none'}`);
    const handler = buttonHandlers.get(interaction.customId);
    if (!handler) {
        log(`No handler found for: ${interaction.customId}`);
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

        // Look up session ID and working dir for this thread
        const mapping = db.query('SELECT session_id, working_dir FROM threads WHERE thread_id = ?')
            .get(thread.id) as { session_id: string; working_dir: string | null } | null;

        if (!mapping) {
            // Not a thread we created, ignore
            return;
        }

        log(`Thread message from ${message.author.tag}`);

        // Show typing indicator
        await thread.sendTyping();

        // Extract message content (strip @mentions)
        const content = message.content.replace(/<@!?\d+>/g, '').trim();

        // Use stored working dir or fall back to channel config / env / cwd
        const workingDir = mapping.working_dir ||
            getChannelConfig(thread.parentId || '')?.working_dir ||
            process.env.CLAUDE_WORKING_DIR ||
            process.cwd();

        // Queue for Claude processing with session resume
        await claudeQueue.add('process', {
            prompt: content,
            threadId: thread.id,
            sessionId: mapping.session_id,
            resume: true,
            userId: message.author.id,
            username: message.author.tag,
            workingDir,
        });

        return;
    }

    // =========================================================================
    // NEW MENTIONS: Start new conversations
    // =========================================================================
    if (!isMentioned) return;

    log(`New mention from ${message.author.tag}`);

    // Extract message content and resolve working directory
    const rawText = message.content.replace(/<@!?\d+>/g, '').trim();
    const { workingDir, cleanedMessage } = resolveWorkingDir(rawText, message.channelId);

    log(`Working directory: ${workingDir}`);

    // Post status message in channel, then create thread from it
    // This allows us to update the status message later (Processing... → Done)
    let statusMessage;
    let thread;
    try {
        // Post status message in the channel
        statusMessage = await (message.channel as TextChannel).send('Processing...');

        // Generate thread name from cleaned message content
        const threadName = cleanedMessage.length > 50
            ? cleanedMessage.slice(0, 47) + '...'
            : cleanedMessage || 'New conversation';

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
            await thread.send(`**${message.author.tag}:** ${cleanedMessage}`);
        }
    } catch (error) {
        log(`Failed to create thread: ${error}`);
        await message.reply('Failed to start thread. Try again?');
        return;
    }

    // Generate a new session ID for this conversation
    const sessionId = crypto.randomUUID();

    // Store the thread → session mapping with working directory
    // Note: thread.id === statusMessage.id because thread was created from that message
    db.run(
        'INSERT INTO threads (thread_id, session_id, working_dir) VALUES (?, ?, ?)',
        [thread.id, sessionId, workingDir]
    );

    log(`Created thread ${thread.id} with session ${sessionId}`);

    // Show typing indicator
    await thread.sendTyping();

    // Queue for Claude processing
    await claudeQueue.add('process', {
        prompt: cleanedMessage,
        threadId: thread.id,
        sessionId,
        resume: false,
        userId: message.author.id,
        username: message.author.tag,
        workingDir,
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
