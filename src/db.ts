/**
 * Database - SQLite for thread → session mappings
 *
 * Simple key-value store:
 * - thread_id (Discord thread ID)
 * - session_id (Claude session UUID)
 *
 * When a follow-up message comes in a thread, we look up
 * the session ID to use --resume.
 */

import { Database } from 'bun:sqlite';

const DB_PATH = process.env.DB_PATH || './data/threads.db';

// Ensure data directory exists
import { mkdirSync } from 'fs';
import { dirname } from 'path';
try {
    mkdirSync(dirname(DB_PATH), { recursive: true });
} catch {}

// Open database
export const db = new Database(DB_PATH);

// Create tables if they don't exist
db.run(`
    CREATE TABLE IF NOT EXISTS threads (
        thread_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// Create channels config table
db.run(`
    CREATE TABLE IF NOT EXISTS channels (
        channel_id TEXT PRIMARY KEY,
        working_dir TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// Add working_dir column to threads table (migration)
try {
    db.run(`ALTER TABLE threads ADD COLUMN working_dir TEXT`);
} catch {} // Column may already exist

// Create index for faster lookups
db.run(`
    CREATE INDEX IF NOT EXISTS idx_threads_session
    ON threads(session_id)
`);

console.log(`[db] SQLite database ready at ${DB_PATH}`);

// In-memory cache for channel configs (TTL: 5 minutes)
const CACHE_TTL_MS = 5 * 60 * 1000;
const channelConfigCache = new Map<string, { data: { working_dir: string | null } | null; expiresAt: number }>();

// Helper functions for channel config
function getChannelConfig(channelId: string): { working_dir: string | null } | null {
    return db.query('SELECT working_dir FROM channels WHERE channel_id = ?')
        .get(channelId) as { working_dir: string | null } | null;
}

export function getChannelConfigCached(channelId: string): { working_dir: string | null } | null {
    const cached = channelConfigCache.get(channelId);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
        return cached.data;
    }

    // Cache miss or expired - fetch from DB
    const data = getChannelConfig(channelId);
    channelConfigCache.set(channelId, { data, expiresAt: now + CACHE_TTL_MS });
    return data;
}

export function setChannelConfig(channelId: string, workingDir: string): void {
    db.run(`
        INSERT INTO channels (channel_id, working_dir) VALUES (?, ?)
        ON CONFLICT(channel_id) DO UPDATE SET working_dir = ?, updated_at = CURRENT_TIMESTAMP
    `, [channelId, workingDir, workingDir]);

    // Invalidate cache
    channelConfigCache.delete(channelId);
}
