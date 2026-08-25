import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../shared/schema";
import dotenv from "dotenv";
import dns from "dns";
import net from "net";

dotenv.config();

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set. Did you forget to copy .env?");
}

// Prefer IPv4 but do NOT forbid IPv6. This used to hard-force family=4 via a dns.lookup patch
// (added when IPv6 to Neon was broken on this machine); on 17 Aug 2026 the situation inverted —
// IPv4 to Neon timed out while IPv6 worked — and the forced-IPv4 patch made every local DB
// connection hang. ipv4first + happy-eyeballs tries IPv4 first and falls back automatically,
// which covers both failure modes. Verified 3/3 connects ~3s on the previously-dead network.
dns.setDefaultResultOrder("ipv4first");
if (net.setDefaultAutoSelectFamily) net.setDefaultAutoSelectFamily(true);
// Node's happy-eyeballs default gives each address only 250ms to complete the
// TCP handshake; on this network Neon takes ~2s+, so every attempt "timed out"
// even though the host was reachable (nc connected fine). Give each attempt a
// real budget — the overall cap is still pg's connectionTimeoutMillis.
if ((net as any).setDefaultAutoSelectFamilyAttemptTimeout) {
    (net as any).setDefaultAutoSelectFamilyAttemptTimeout(5000);
}

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

// Handle pool errors gracefully. NOTE: pool.on('error') ONLY fires for clients
// sitting idle in the pool — it does NOT cover a client that's checked out and
// in use when its socket dies.
pool.on('error', (err) => {
    console.error('[DB Pool] Unexpected error on idle client:', err.message);
});

// Attach a permanent error listener to EVERY client the moment it connects.
// When Neon drops a checked-out connection mid-flight, the client emits an
// 'error' event; with no listener, Node's default is to `throw` it as an
// unhandled 'error' event and kill the whole process (this is what took the
// server down repeatedly during Neon blips). Swallow + log instead — pg removes
// the dead client from the pool on its own, and callers see their query reject
// (handled by route try/catch + withRetry).
pool.on('connect', (client) => {
    client.on('error', (err: any) => {
        console.error('[DB Client] connection error (non-fatal):', err?.message);
    });
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
