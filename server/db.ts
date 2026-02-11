import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../shared/schema";
import dotenv from "dotenv";
import dns from "dns";

dotenv.config();

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set. Did you forget to copy .env?");
}

// FIX: Aggressively force IPv4 by patching dns.lookup
// This is necessary because 'dns.setDefaultResultOrder' was insufficient to prevent
// IPv6 fallback issues on this Node v24 + Network environment.
const originalLookup = dns.lookup;
// @ts-ignore - TS might complain about matching exact signature, but this works at runtime
dns.lookup = (hostname, options, callback) => {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    } else if (!options) {
        options = {};
    }
    // @ts-ignore
    options.family = 4; // FORCE IPv4
    // @ts-ignore
    return originalLookup(hostname, options, callback);
};

// FIX: Use Direct Endpoint to bypass Pooler SSL issues
const connectionString = process.env.DATABASE_URL.replace("-pooler", "");

// Neon serverless connection pool configuration
// Handles cold starts with proper timeouts and keep-alive
const pool = new pg.Pool({
    connectionString,
    max: 10,                          // Maximum connections in pool
    idleTimeoutMillis: 30000,         // Close idle connections after 30s
    connectionTimeoutMillis: 10000,   // Wait 10s for connection (Neon cold start)
    allowExitOnIdle: false,           // Keep pool alive
});

// Handle pool errors gracefully
pool.on('error', (err) => {
    console.error('[DB Pool] Unexpected error on idle client:', err.message);
});

// Keep connection warm to avoid cold starts
const keepWarm = async () => {
    try {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
    } catch (err: any) {
        console.warn('[DB Pool] Keep-warm ping failed:', err.message);
    }
};

// Ping every 4 minutes to prevent Neon from sleeping (5 min timeout)
setInterval(keepWarm, 4 * 60 * 1000);

// Initial warm-up
keepWarm();

export const db = drizzle(pool, { schema });

/**
 * Retry wrapper for database operations with exponential backoff.
 * Use for critical operations that may fail due to Neon cold starts.
 *
 * @example
 * const result = await withRetry(() => db.select().from(users));
 */
export async function withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelayMs: number = 1000
): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error: any) {
            lastError = error;

            // Check if it's a connection/timeout error worth retrying
            const isRetryable =
                error.code === 'ECONNRESET' ||
                error.code === 'ETIMEDOUT' ||
                error.code === 'ENOTFOUND' ||
                error.message?.includes('timeout') ||
                error.message?.includes('Connection terminated') ||
                error.message?.includes('Control plane request failed');

            if (!isRetryable || attempt === maxRetries) {
                throw error;
            }

            // Exponential backoff: 1s, 2s, 4s...
            const delay = baseDelayMs * Math.pow(2, attempt - 1);
            console.warn(`[DB Retry] Attempt ${attempt}/${maxRetries} failed: ${error.message}. Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}
