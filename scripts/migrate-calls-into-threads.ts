/**
 * Backfill: put historic phone calls on the comms board.
 *
 * The board reads `messages`, and until now not a single call was ever written there. The result
 * was two invisible populations:
 *
 *   - callers WITH a conversation row, whose card had no channel icon, no preview and no SLA clock,
 *     because there was nothing in `messages` to derive them from;
 *   - callers with NO conversation row at all (183 of them), who had no card anywhere.
 *
 * This walks the `calls` table oldest-first and hands each row to the same
 * `ingestCallRow()` the live path uses, so the backfill and the live ingest can never drift.
 *
 * Idempotent: each call writes a message with the deterministic id `call_<callRecordId>`, so a
 * second run updates the wording at most. Safe to re-run whenever, and worth re-running because
 * roughly 4% of calls never reach finalizeCall and only ever exist as 'ringing' rows.
 *
 * It never messages anyone: `ack: false` means the first-contact responder is not invoked for
 * history, and `markUnread: false` means a two-month-old call does not light up an unread badge.
 * Test/Ofcom numbers (7700900) and withheld callers are skipped.
 *
 *   npx tsx scripts/migrate-calls-into-threads.ts --dry-run
 *   npx tsx scripts/migrate-calls-into-threads.ts
 *   npx tsx scripts/migrate-calls-into-threads.ts --since 2026-06-01 --limit 50
 */
import { db } from '../server/db';
import { calls } from '@shared/schema';
import { asc, gte, sql } from 'drizzle-orm';
import { ingestCallRow } from '../server/call-thread';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
};
const LIMIT = Number(flag('--limit') ?? 0) || Infinity;
const BATCH = Number(flag('--batch') ?? 0) || 200;
const SINCE = flag('--since') ? new Date(flag('--since')!) : null;

async function snapshot(label: string) {
    const [row]: any = (await db.execute(sql`
        SELECT
            (SELECT count(*)::int FROM messages WHERE channel = 'call')                    AS call_messages,
            (SELECT count(*)::int FROM conversations)                                      AS conversations,
            (SELECT count(*)::int FROM conversations c
               WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)) AS empty_conversations,
            (SELECT count(*)::int FROM (
                SELECT DISTINCT regexp_replace(k.phone_number, '[^0-9]', '', 'g') AS d
                FROM calls k WHERE k.direction = 'inbound'
             ) x
             LEFT JOIN conversations cv
               ON regexp_replace(cv.phone_number, '[^0-9]', '', 'g') = x.d
             WHERE cv.id IS NULL AND x.d <> '' AND x.d NOT LIKE '%7700900%')                AS callers_without_thread
    `)).rows ?? [];
    console.log(`\n--- ${label} ---`);
    console.table([row]);
    return row;
}

async function main() {
    console.log(`migrate-calls-into-threads ${DRY_RUN ? '(DRY RUN, nothing will be written)' : '(LIVE)'}`);
    if (SINCE) console.log(`  only calls from ${SINCE.toISOString()}`);

    const before = await snapshot('BEFORE');

    const tally: Record<string, number> = {};
    const bump = (k: string) => { tally[k] = (tally[k] ?? 0) + 1; };

    let processed = 0;
    let offset = 0;
    // Counted by number, not by call: in --dry-run nothing is written, so every one of a caller's
    // six calls would otherwise each report "would create a conversation" for the same person.
    const newThreadNumbers = new Set<string>();
    const examples: { phone: string; preview: string }[] = [];

    for (;;) {
        if (processed >= LIMIT) break;
        const batch = await db.select().from(calls)
            .where(SINCE ? gte(calls.startTime, SINCE) : sql`true`)
            .orderBy(asc(calls.startTime))
            .limit(Math.min(BATCH, LIMIT - processed))
            .offset(offset);
        if (!batch.length) break;
        offset += batch.length;

        for (const call of batch) {
            processed++;
            const res = await ingestCallRow(call, {
                skipTestNumbers: true,   // history stays free of smoke-test numbers
                markUnread: false,       // a call from May must not show as unread today
                ack: false,              // NEVER message anyone from a backfill
                advanceStage: false,     // a thread Ben closed stays closed; history is not news
                dryRun: DRY_RUN,
            });
            bump(`${res.status}:${res.reason}`);
            if (res.conversationCreated) {
                const digits = (call.phoneNumber ?? '').replace(/\D/g, '');
                if (!newThreadNumbers.has(digits)) {
                    newThreadNumbers.add(digits);
                    if (examples.length < 8) {
                        examples.push({ phone: call.phoneNumber ?? '?', preview: res.preview ?? '' });
                    }
                }
            }
            if (processed % 200 === 0) console.log(`  ... ${processed} calls`);
        }
    }

    console.log(`\nProcessed ${processed} call record(s).`);
    console.log('Outcomes:');
    console.table(Object.entries(tally)
        .sort((a, b) => b[1] - a[1])
        .map(([outcome, n]) => ({ outcome, n })));
    console.log(`Callers ${DRY_RUN ? 'who would get' : 'who got'} a new thread: ${newThreadNumbers.size}`);
    if (examples.length) {
        console.log('\nSample new threads:');
        console.table(examples);
    }

    const after = await snapshot('AFTER');
    console.log('\nDelta:');
    console.table([{
        call_messages: (after.call_messages ?? 0) - (before.call_messages ?? 0),
        conversations: (after.conversations ?? 0) - (before.conversations ?? 0),
        callers_without_thread: (after.callers_without_thread ?? 0) - (before.callers_without_thread ?? 0),
    }]);

    if (DRY_RUN) console.log('\nDRY RUN: nothing was written. Re-run without --dry-run to apply.');
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
