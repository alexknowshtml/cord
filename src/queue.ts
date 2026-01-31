/**
 * Queue - BullMQ job queue for Claude processing
 *
 * Why a queue?
 * 1. Claude can take minutes to respond - Discord would timeout
 * 2. Rate limiting - don't spawn 100 Claude processes at once
 * 3. Persistence - if the bot crashes, jobs aren't lost
 */

import { Queue } from 'bullmq';
import IORedis from 'ioredis';

// Redis connection for BullMQ
const connection = new IORedis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: null, // Required for BullMQ
});

// The queue that holds Claude processing jobs
export const claudeQueue = new Queue('claude', {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 1000,
        },
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 50,      // Keep last 50 failed jobs
    },
});

// Job data structure
export interface ClaudeJob {
    prompt: string;
    threadId: string;
    sessionId: string;
    resume: boolean;
    userId: string;
    username: string;
    workingDir?: string;
}
