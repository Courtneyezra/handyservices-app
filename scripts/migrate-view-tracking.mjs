import { neon } from '@neondatabase/serverless';
import fs from 'fs';
const env = fs.readFileSync('/Users/courtneebonnick/v6-switchboard/.env', 'utf8');
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const sql = neon(url);

await sql`ALTER TABLE job_dispatches ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0`;
await sql`ALTER TABLE job_dispatches ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMP`;
console.log('✓ view_count + last_viewed_at columns ensured');
