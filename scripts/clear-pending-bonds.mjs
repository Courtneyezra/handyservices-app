import { neon } from '@neondatabase/serverless';
import fs from 'fs';
const env = fs.readFileSync('/Users/courtneebonnick/v6-switchboard/.env', 'utf8');
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const sql = neon(url);

const all = await sql`SELECT id, status, stripe_payment_intent_id FROM dispatch_bonds ORDER BY created_at DESC`;
console.log(`${all.length} bonds total:`);
for (const r of all) console.log(`  ${r.id} | ${r.status} | ${r.stripe_payment_intent_id}`);

// Wipe non-held bonds — pending ones reference live PaymentIntents that the test secret can't reach.
const r = await sql`DELETE FROM dispatch_bonds WHERE status <> 'held'`;
console.log(`Deleted bonds with status != held`);

const after = await sql`SELECT count(*)::int n FROM dispatch_bonds`;
console.log(`Remaining bonds: ${after[0].n}`);
