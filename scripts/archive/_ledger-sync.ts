/**
 * Apply the comms_events migration (idempotent) and sync the ledger from source tables.
 *
 *   npx tsx scripts/_ledger-sync.ts            # migrate + sync + counts
 *   npx tsx scripts/_ledger-sync.ts --wipe     # drop all ledger rows first (full rebuild)
 *
 * Safe to re-run: the migration is CREATE IF NOT EXISTS and the sync is ON CONFLICT DO NOTHING.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import { syncCommsLedger, ledgerCounts } from '../server/comms-ledger';

async function main() {
    const wipe = process.argv.includes('--wipe');

    const migration = fs.readFileSync(path.join(process.cwd(), 'migrations', '20260823_comms_events.sql'), 'utf-8')
        .split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
    for (const stmt of migration.split(';').map((s) => s.trim()).filter(Boolean)) {
        await db.execute(sql.raw(stmt));
    }
    console.log('migration applied (idempotent)');

    if (wipe) {
        await db.execute(sql`delete from comms_events`);
        console.log('ledger wiped for full rebuild');
    }

    const result = await syncCommsLedger();
    console.log(`scanned: ${result.messagesScanned} messages, ${result.callsScanned} calls, ${result.draftsScanned} drafts`);
    console.log(`inserted: ${result.inserted} new ledger events`);
    console.log('totals by type:', JSON.stringify(await ledgerCounts()));
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
