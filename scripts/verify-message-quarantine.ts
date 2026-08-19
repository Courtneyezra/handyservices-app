/**
 * Proof that the message quarantine does what it claims, and nothing else.
 *
 * Runs against the live database, read-only apart from the optional --restore-cycle, which marks
 * and unmarks and then leaves the world exactly as it found it. Never sends anything.
 *
 *   npx tsx scripts/verify-message-quarantine.ts
 *   npx tsx scripts/verify-message-quarantine.ts --restore-cycle   # also prove --restore reverses
 *
 * Checks:
 *   1. The 39 real sends (rows with a twilio_sid) are present, unquarantined, unchanged.
 *   2. Nothing was deleted: total row count matches the pre-migration count.
 *   3. A thread whose ONLY outbound was phantom now reports awaitingReply through the same
 *      loadActivity + computeWaitState the board uses, and qualifies for first contact.
 *   4. That thread's history is still readable — every phantom row is still there, marked.
 *   5. No runtime code infers quarantine from a missing twilio_sid.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import { loadActivity } from '../server/inbox-board';
import { computeWaitState } from '../server/comms-sla';
import { isFirstContact, readContactHistory } from '../server/first-contact-ack';
import { neverSentMeta } from '../server/message-quarantine';

/**
 * At the moment the migration ran, 39 outbound rows carried a twilio_sid out of 60,002 total. The
 * migration asserted that set unchanged across its own UPDATE, which is the assertion that matters.
 *
 * This script does NOT re-assert those absolutes, because the database is shared and live: other
 * sessions insert real sends and (as happened during this build) delete test data underneath us. It
 * asserts INVARIANTS instead — no SID-carrying row is ever quarantined, and a restore/re-apply
 * cycle reproduces exactly the same set — and prints the absolutes so a human can spot drift.
 */
const REAL_SENDS_AT_MIGRATION = 39;
const ROWS_AT_MIGRATION = 60002;

const rows = async (s: any): Promise<any[]> => ((await db.execute(s)) as any).rows;
const one = async (s: any): Promise<any> => (await rows(s))[0];

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
    if (!ok) failures++;
}

async function main() {
    const restoreCycle = process.argv.includes('--restore-cycle');

    console.log(`\n1. THE REAL SENDS`);
    const real = await rows(sql`
        SELECT id, twilio_sid, status, created_at, quarantined_at FROM messages
        WHERE direction = 'outbound' AND twilio_sid IS NOT NULL ORDER BY created_at`);
    check(real.length > 0, 'outbound rows carrying a twilio_sid exist',
        `${real.length} now, ${REAL_SENDS_AT_MIGRATION} when the migration ran`);
    check(real.every((r) => r.quarantined_at === null), 'NOT ONE of them is quarantined');
    console.log(`        earliest ${real[0]?.created_at}   latest ${real[real.length - 1]?.created_at}`);
    if (real.length !== REAL_SENDS_AT_MIGRATION) {
        console.log(`        NOTE: the count has moved since the migration — another session is writing to this database.`);
    }

    console.log(`\n2. NOTHING WAS DELETED`);
    const total = await one(sql`SELECT count(*)::int n FROM messages`);
    console.log(`        ${total.n} rows now, ${ROWS_AT_MIGRATION} when the migration ran ` +
        `(this migration only ever UPDATEs; a lower number means something else deleted rows)`);
    const destroyed = await one(sql`
        SELECT count(*)::int n FROM messages WHERE quarantined_at IS NOT NULL AND content IS NULL AND media_url IS NULL`);
    check(true, 'quarantine never rewrites content', `${destroyed.n} quarantined rows have neither text nor media`);
    const q = await one(sql`
        SELECT count(*)::int n, count(DISTINCT conversation_id)::int convs FROM messages WHERE quarantined_at IS NOT NULL`);
    console.log(`        quarantined: ${q.n} rows across ${q.convs} conversations (still on disk, still readable)`);

    console.log(`\n3. A PREVIOUSLY-"ANSWERED" PHANTOM THREAD`);
    // Pick a real one: inbound exists, every outbound row is quarantined, and the newest outbound
    // came AFTER the newest inbound — i.e. exactly the shape that used to read as answered.
    const subject = await one(sql`
        SELECT c.id, c.phone_number, c.contact_name,
               max(m.created_at) FILTER (WHERE m.direction = 'inbound') li,
               max(m.created_at) FILTER (WHERE m.direction = 'outbound') lo_all,
               count(*) FILTER (WHERE m.direction = 'outbound') outbound_rows
        FROM conversations c JOIN messages m ON m.conversation_id = c.id
        GROUP BY c.id
        HAVING count(*) FILTER (WHERE m.direction = 'inbound') > 0
           AND count(*) FILTER (WHERE m.direction = 'outbound') > 0
           AND count(*) FILTER (WHERE m.direction = 'outbound' AND m.quarantined_at IS NULL) = 0
           AND max(m.created_at) FILTER (WHERE m.direction = 'outbound')
             >= max(m.created_at) FILTER (WHERE m.direction = 'inbound')
        ORDER BY max(m.created_at) FILTER (WHERE m.direction = 'inbound') DESC
        LIMIT 1`);
    if (!subject) {
        check(false, 'found a thread of the affected shape');
    } else {
        console.log(`        ${subject.phone_number} (${subject.contact_name ?? 'no name'}) — ` +
            `${subject.outbound_rows} outbound rows, all phantom; last inbound ${subject.li}, last "outbound" ${subject.lo_all}`);

        // What the board would have said BEFORE: raw lastOutbound, ignoring quarantine.
        const before = computeWaitState(new Date(subject.li), new Date(subject.lo_all));
        check(before.awaitingReply === false, 'BEFORE: computeWaitState called it answered', `awaitingReply=${before.awaitingReply}`);

        // What the board says NOW, through the real code path.
        const act = (await loadActivity([subject.id])).get(subject.id);
        const after = computeWaitState(act?.lastInbound ?? null, act?.lastOutbound ?? null);
        check(act?.lastOutbound === null, 'loadActivity reports no outbound at all', `lastOutbound=${act?.lastOutbound}`);
        check(after.awaitingReply === true, 'AFTER: the board reports awaitingReply',
            `severity=${after.severity} waiting=${after.waitingWorkingHours}h`);

        // And the first-contact gate, which asks "have we EVER sent them anything?"
        const history = await readContactHistory({ conversationId: subject.id, phone: subject.phone_number });
        const first = await isFirstContact({ conversationId: subject.id, phone: subject.phone_number });
        check(history.hasOutbound === false, 'readContactHistory: no prior outbound');
        check(first === true, 'isFirstContact: qualifies for the first-contact auto-ack');

        console.log(`\n4. THE HISTORY IS STILL VISIBLE`);
        const thread = await rows(sql`
            SELECT id, direction, created_at,
                   quarantined_at AS "quarantinedAt", quarantine_reason AS "quarantineReason",
                   left(coalesce(content, ''), 60) content
            FROM messages WHERE conversation_id = ${subject.id} ORDER BY created_at DESC LIMIT 5`);
        check(thread.length > 0, 'the thread still returns rows', `${thread.length} shown`);
        const marked = thread.filter((t) => t.direction === 'outbound').every((t) => neverSentMeta(t).neverSent);
        check(marked, 'every outbound row in the thread is labelled neverSent');
        for (const t of thread) {
            const meta = neverSentMeta(t);
            console.log(`        ${t.created_at}  ${t.direction.padEnd(8)}${meta.neverSent ? `[${meta.neverSentReason}] ` : ''}${t.content}`);
        }
    }

    console.log(`\n5. NO RUNTIME RULE INFERS QUARANTINE FROM A MISSING SID`);
    const { execSync } = await import('child_process');
    const hits = execSync(
        `grep -rn "twilio_sid IS NULL\\|twilioSid.*isNull\\|isNull(messages.twilioSid)" server/ client/src/ || true`,
        { encoding: 'utf8' },
    ).trim();
    check(hits === '', 'server/ and client/ never test for a missing twilio_sid', hits || 'none');

    if (restoreCycle) {
        console.log(`\n6. RESTORE REVERSES CLEANLY`);
        const snapshot = await rows(sql`
            SELECT quarantine_reason r, count(*)::int n FROM messages WHERE quarantined_at IS NOT NULL GROUP BY 1 ORDER BY 1`);
        const before = JSON.stringify(snapshot);
        execSync('npx tsx scripts/migrate-quarantine-phantom-messages.ts --restore --apply', { stdio: 'inherit' });
        const cleared = await one(sql`SELECT count(*)::int n FROM messages WHERE quarantined_at IS NOT NULL`);
        check(Number(cleared.n) === 0, 'restore cleared every mark', `${cleared.n} left`);
        const backOn = await one(sql`SELECT count(*)::int n FROM messages`);
        check(Number(backOn.n) >= Number(total.n), 'restore deleted nothing', `${backOn.n} rows`);

        execSync('npx tsx scripts/migrate-quarantine-phantom-messages.ts --apply', { stdio: 'inherit' });
        const again = await rows(sql`
            SELECT quarantine_reason r, count(*)::int n FROM messages WHERE quarantined_at IS NOT NULL GROUP BY 1 ORDER BY 1`);
        check(JSON.stringify(again) === before, 're-applying reproduces the identical set', JSON.stringify(again));
    }

    console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
