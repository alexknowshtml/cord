/**
 * HTTP API Server - Discord primitives for external tools
 *
 * Provides HTTP endpoints for sending messages, embeds, files, buttons,
 * and managing threads. Useful for scripts, automation, and Claude skills.
 */

import { Client, TextChannel, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const log = (msg: string) => process.stdout.write(`[api] ${msg}\n`);

// Button handler registry for dynamic button responses
type ButtonHandler = {
    type: 'inline';
    content: string;
    ephemeral?: boolean;
} | {
    type: 'webhook';
    url: string;
    data?: Record<string, unknown>;
};

export const buttonHandlers = new Map<string, ButtonHandler>();

/**
 * Start the HTTP API server
 */
export function startApiServer(client: Client, port: number = 2643) {
    const server = Bun.serve({
        port,
        async fetch(req) {
            const url = new URL(req.url);
            const headers = { 'Content-Type': 'application/json' };

            // Health check
            if (url.pathname === '/health' && req.method === 'GET') {
                return new Response(JSON.stringify({
                    status: 'ok',
                    connected: client.isReady(),
                    user: client.user?.tag || null,
                }), { headers });
            }

            // Send message to thread/channel
            if (url.pathname === '/command' && req.method === 'POST') {
                try {
                    const body = await req.json() as {
                        command: string;
                        args: Record<string, unknown>;
                    };

                    const result = await handleCommand(client, body.command, body.args);
                    return new Response(JSON.stringify(result), { headers });
                } catch (error) {
                    log(`Command error: ${error}`);
                    return new Response(JSON.stringify({ error: String(error) }), {
                        status: 500,
                        headers,
                    });
                }
            }

            // Send file attachment
            if (url.pathname === '/send-with-file' && req.method === 'POST') {
                try {
                    const body = await req.json() as {
                        channelId: string;
                        fileName: string;
                        fileContent: string;
                        content?: string;
                    };

                    const channel = await client.channels.fetch(body.channelId);
                    if (!channel?.isTextBased()) {
                        return new Response(JSON.stringify({ error: 'Invalid channel' }), {
                            status: 400,
                            headers,
                        });
                    }

                    const buffer = Buffer.from(body.fileContent, 'utf-8');
                    const message = await (channel as TextChannel).send({
                        content: body.content || undefined,
                        files: [{
                            attachment: buffer,
                            name: body.fileName,
                        }],
                    });

                    return new Response(JSON.stringify({
                        success: true,
                        messageId: message.id,
                    }), { headers });
                } catch (error) {
                    log(`Send file error: ${error}`);
                    return new Response(JSON.stringify({ error: String(error) }), {
                        status: 500,
                        headers,
                    });
                }
            }

            // Send message with buttons
            if (url.pathname === '/send-with-buttons' && req.method === 'POST') {
                try {
                    const body = await req.json() as {
                        channelId: string;
                        content?: string;
                        embeds?: Array<{
                            title?: string;
                            description?: string;
                            color?: number;
                            fields?: Array<{ name: string; value: string; inline?: boolean }>;
                            footer?: { text: string };
                        }>;
                        buttons: Array<{
                            label: string;
                            customId: string;
                            style: 'primary' | 'secondary' | 'success' | 'danger';
                            handler?: ButtonHandler;
                        }>;
                    };

                    const channel = await client.channels.fetch(body.channelId);
                    if (!channel?.isTextBased()) {
                        return new Response(JSON.stringify({ error: 'Invalid channel' }), {
                            status: 400,
                            headers,
                        });
                    }

                    // Build embed if provided
                    const embeds = body.embeds?.map(e => {
                        const embed = new EmbedBuilder();
                        if (e.title) embed.setTitle(e.title);
                        if (e.description) embed.setDescription(e.description);
                        if (e.color) embed.setColor(e.color);
                        if (e.fields) embed.addFields(e.fields);
                        if (e.footer) embed.setFooter(e.footer);
                        return embed;
                    });

                    // Build button row
                    const styleMap: Record<string, ButtonStyle> = {
                        primary: ButtonStyle.Primary,
                        secondary: ButtonStyle.Secondary,
                        success: ButtonStyle.Success,
                        danger: ButtonStyle.Danger,
                    };

                    const buttons = body.buttons.map(b => {
                        // Register handler if provided
                        if (b.handler) {
                            buttonHandlers.set(b.customId, b.handler);
                            log(`Registered button handler: ${b.customId}`);
                        } else {
                            log(`No handler for button: ${b.customId}`);
                        }
                        return new ButtonBuilder()
                            .setCustomId(b.customId)
                            .setLabel(b.label)
                            .setStyle(styleMap[b.style] || ButtonStyle.Primary);
                    });

                    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);

                    const message = await (channel as TextChannel).send({
                        content: body.content || undefined,
                        embeds: embeds || undefined,
                        components: [row],
                    });

                    return new Response(JSON.stringify({
                        success: true,
                        messageId: message.id,
                    }), { headers });
                } catch (error) {
                    log(`Send buttons error: ${error}`);
                    return new Response(JSON.stringify({ error: String(error) }), {
                        status: 500,
                        headers,
                    });
                }
            }

            // 404 for unknown routes
            return new Response(JSON.stringify({ error: 'Not found' }), {
                status: 404,
                headers,
            });
        },
    });

    log(`HTTP API server listening on port ${port}`);
    return server;
}

/**
 * Handle a command from the /command endpoint
 */
async function handleCommand(
    client: Client,
    command: string,
    args: Record<string, unknown>
): Promise<Record<string, unknown>> {
    switch (command) {
        case 'send-to-thread': {
            const threadId = args.thread as string;
            const message = args.message as string | undefined;
            const embeds = args.embeds as Array<{
                title?: string;
                description?: string;
                color?: number;
                fields?: Array<{ name: string; value: string; inline?: boolean }>;
                footer?: { text: string };
            }> | undefined;

            const channel = await client.channels.fetch(threadId);
            if (!channel?.isTextBased()) {
                throw new Error('Invalid thread/channel');
            }

            // Build embeds if provided
            const discordEmbeds = embeds?.map(e => {
                const embed = new EmbedBuilder();
                if (e.title) embed.setTitle(e.title);
                if (e.description) embed.setDescription(e.description);
                if (e.color) embed.setColor(e.color);
                if (e.fields) embed.addFields(e.fields);
                if (e.footer) embed.setFooter(e.footer);
                return embed;
            });

            const sent = await (channel as TextChannel).send({
                content: message || undefined,
                embeds: discordEmbeds || undefined,
            });

            return { success: true, messageId: sent.id };
        }

        case 'start-typing': {
            const channelId = args.channel as string;
            const channel = await client.channels.fetch(channelId);
            if (!channel?.isTextBased()) {
                throw new Error('Invalid channel');
            }
            await (channel as TextChannel).sendTyping();
            return { success: true };
        }

        case 'edit-message': {
            const channelId = args.channel as string;
            const messageId = args.message as string;
            const content = args.content as string;

            const channel = await client.channels.fetch(channelId);
            if (!channel?.isTextBased()) {
                throw new Error('Invalid channel');
            }

            const message = await (channel as TextChannel).messages.fetch(messageId);
            await message.edit(content);
            return { success: true };
        }

        case 'delete-message': {
            const channelId = args.channel as string;
            const messageId = args.message as string;

            const channel = await client.channels.fetch(channelId);
            if (!channel?.isTextBased()) {
                throw new Error('Invalid channel');
            }

            const message = await (channel as TextChannel).messages.fetch(messageId);
            await message.delete();
            return { success: true };
        }

        case 'rename-thread': {
            const threadId = args.thread as string;
            const name = args.name as string;

            const channel = await client.channels.fetch(threadId);
            if (!channel?.isThread()) {
                throw new Error('Invalid thread');
            }

            await channel.setName(name);
            return { success: true };
        }

        case 'reply-to-message': {
            const channelId = args.channel as string;
            const messageId = args.message as string;
            const content = args.content as string;

            const channel = await client.channels.fetch(channelId);
            if (!channel?.isTextBased()) {
                throw new Error('Invalid channel');
            }

            const targetMessage = await (channel as TextChannel).messages.fetch(messageId);
            const sent = await targetMessage.reply(content);
            return { success: true, messageId: sent.id };
        }

        case 'create-thread': {
            const channelId = args.channel as string;
            const messageId = args.message as string;
            const name = args.name as string;

            const channel = await client.channels.fetch(channelId);
            if (!channel?.isTextBased()) {
                throw new Error('Invalid channel');
            }

            const message = await (channel as TextChannel).messages.fetch(messageId);
            const thread = await message.startThread({ name });
            return { success: true, threadId: thread.id };
        }

        case 'add-reaction': {
            const channelId = args.channel as string;
            const messageId = args.message as string;
            const emoji = args.emoji as string;

            const channel = await client.channels.fetch(channelId);
            if (!channel?.isTextBased()) {
                throw new Error('Invalid channel');
            }

            const message = await (channel as TextChannel).messages.fetch(messageId);
            await message.react(emoji);
            return { success: true };
        }

        default:
            throw new Error(`Unknown command: ${command}`);
    }
}
