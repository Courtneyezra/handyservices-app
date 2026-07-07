import { neon } from '@neondatabase/serverless';
import fs from 'fs';
const env = fs.readFileSync('/Users/courtneebonnick/v6-switchboard/.env', 'utf8');
const url = env.match(/^DATABASE_URL=(.+)$/m)[1].replace(/^["']|["']$/g, '');
const sql = neon(url);
const r = await sql`SELECT id, public_token, status, bond_required, bond_amount_pence, customer_first_name FROM job_dispatches WHERE public_token IS NOT NULL ORDER BY created_at DESC LIMIT 5`;
console.log(JSON.stringify(r, null, 2));
