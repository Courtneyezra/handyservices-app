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

const pool = new pg.Pool({ connectionString });

export const db = drizzle(pool, { schema });
