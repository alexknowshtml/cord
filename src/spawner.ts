/**
 * Spawner - The Claude CLI integration
 *
 * THIS IS THE CORE OF THE SYSTEM.
 *
 * Key flags:
 * - `--print`: Non-interactive mode, returns output
 * - `--session-id UUID`: Set session ID for new sessions
 * - `--resume UUID`: Resume an existing session (for follow-ups)
 * - `--append-system-prompt`: Inject context that survives compaction
 * - `-p "prompt"`: The actual prompt to send
 */

const log = (msg: string) => process.stdout.write(`[spawner] ${msg}\n`);

// Timezone for datetime injection (set via TZ env var)
const TIMEZONE = process.env.TZ || 'UTC';

interface SpawnOptions {
    prompt: string;
    sessionId: string;
    resume: boolean;
    systemPrompt?: string;
    workingDir?: string;
}

/**
 * Get current datetime in user's timezone
 * Claude Code doesn't know the time - we inject it
 */
function getDatetimeContext(): string {
    const now = new Date();
    return now.toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: TIMEZONE,
    });
}

/**
 * Spawn Claude CLI and return the response
 */
export async function spawnClaude(options: SpawnOptions): Promise<string> {
    const { prompt, sessionId, resume, systemPrompt, workingDir } = options;

    const cwd = workingDir || process.env.CLAUDE_WORKING_DIR || process.cwd();
    log(`Spawning Claude - Session: ${sessionId}, Resume: ${resume}`);
    log(`Working directory: ${cwd}`);

    // Build CLI arguments
    const args = ['claude'];

    // Non-interactive mode
    args.push('--print');

    // Session handling
    if (resume) {
        // Resume existing session for follow-up messages
        args.push('--resume', sessionId);
    } else {
        // New session - set the ID upfront
        args.push('--session-id', sessionId);
    }

    // Inject datetime context (survives session compaction)
    const datetimeContext = `Current date/time: ${getDatetimeContext()}`;
    const fullSystemPrompt = systemPrompt
        ? `${datetimeContext}\n\n${systemPrompt}`
        : datetimeContext;

    args.push('--append-system-prompt', fullSystemPrompt);

    // The actual prompt
    args.push('-p', prompt);

    log(`Command: ${args.join(' ').slice(0, 100)}...`);

    // Spawn the process
    const proc = Bun.spawn(args, {
        cwd,
        env: {
            ...process.env,
            TZ: TIMEZONE,
        },
        stdout: 'pipe',
        stderr: 'pipe',
    });

    // Collect output
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    // Wait for process to exit
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
        log(`Claude exited with code ${exitCode}`);
        log(`stderr: ${stderr}`);
        throw new Error(`Claude failed: ${stderr || 'Unknown error'}`);
    }

    log(`Claude responded (${stdout.length} chars)`);

    return stdout.trim();
}
