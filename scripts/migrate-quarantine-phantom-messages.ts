/**
 * QUARANTINE THE PHANTOM OUTBOUND MESSAGES — mark them, never delete them.
 *
 * ─── WHAT IS WRONG ─────────────────────────────────────────────────────────────────────────────
 *
 * `messages` holds 58,255 outbound rows. 39 of them were actually sent. The other 58,216 were
 * written between 18 Feb and 14 Aug 2026 and reached nobody:
 *
 *   runaway_loop     Feb-Mar 2026. A retry loop wrote the same notice thousands of times to a
 *                    handful of threads ("Hi Test! Your quote is ready" x 11,751). Twilio's usage
 *                    records show ~171 real messages for the whole period.
 *   dead_sender      Apr - 14 Aug 2026. Ordinary automation (invoice chasers, day-before
 *                    confirmations) through a WhatsApp sender that could not deliver. See
 *                    memory project-whatsapp-ingest-incident: 57,768 attempts ever, 20 delivered.
 *   tenant_sandbox   The tenant-chat AI sandbox talking to itself on `tenant_*` conversations.
 *
 * The damage is one specific judgement: computeWaitState reads lastOutbound >= lastInbound as
 * ANSWERED, so 71 conversations where the customer was never replied to look handled — missing
 * from the Unanswered headline, skipped by the comms agent sweep, and disqualified from the
 * first-contact auto-ack.
 *
 * ─── WHY MARK AND NOT DELETE ───────────────────────────────────────────────────────────────────
 *
 * Customer communication is a business record: it is the evidence behind an invoice, a dispute and
 * a complaint, and it is also the only way Ben can see what the machine did in his name. A DELETE
 * cannot be unmade. So this sets `quarantined_at` + `quarantine_reason`, the thread view keeps
 * rendering every row (visibly marked "never sent"), and `--restore` clears the marks.
 *
 * ─── HOW THE ROWS ARE IDENTIFIED ───────────────────────────────────────────────────────────────
 *
 * The scope is a CLOSED HISTORICAL WINDOW, deliberately:
 *
 *     direction = 'outbound'  AND  twilio_sid IS NULL  AND  created_at < 2026-08-15
 *
 * Two independent facts make that window safe, and neither generalises past it:
 *   1. The outbound path only started writing `twilio_sid` when the sender was fixed on 15 Aug
 *      2026. The first row carrying one is 2026-08-15 12:06:25; the last row without one is
 *      2026-08-14 18:00:01. There is no overlap in either direction (asserted below).
 *   2. Everything sent before that cutover went through a sender that could not deliver.
 *
 * "No twilio_sid" is NOT a forward-looking rule and is not used as one: a Meta Cloud API send
 * (server/meta-whatsapp.ts) legitimately has no Twilio SID. That is exactly why this is a one-off
 * offline migration writing an explicit column, and why nothing at runtime re-derives it.
 *
 * NOTE the rows also carry an SM-shaped `id`: the old code put Twilio's SID in the primary key and
 * left `twilio_sid` null. So most of these were ACCEPTED by Twilio and then failed delivery, rather
 * than never leaving the building. Either way the customer never received them, which is the only
 * thing the SLA clock cares about.
 *
 * ─── GUARDS ────────────────────────────────────────────────────────────────────────────────────
 *
 * The 39 rows that carry a real twilio_sid are the only outbound this business has actually sent.
 * Their ids are snapshotted BEFORE the update and re-checked AFTER; any drift aborts (and, in a
 * transaction, rolls back).
 *
 *   npx tsx scripts/migrate-quarantine-phantom-messages.ts              # dry run (default)
 *   npx tsx scripts/migrate-quarantine-phantom-messages.ts --apply      # mark them
 *   npx tsx scripts/migrate-quarantine-phantom-messages.ts --status     # what is marked now
 *   npx tsx scripts/migrate-quarantine-phantom-messages.ts --restore --apply          # unmark all
 *   npx tsx scripts/migrate-quarantine-phantom-messages.ts --restore --reason dead_sender --apply
 *
 * Targeted DDL only. Never `npm run db:push` against this database.
 */
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

/** The moment the fixed sender went live and outbound rows started carrying a Twilio SID. */
const CUTOVER = '2026-08-15';
/** The runaway loop ends well before this; after it the rows are ordinary (undelivered) automation. */
const LOOP_END = '2026-04-01';

const REASONS = ['runaway_loop', 'dead_sender', 'tenant_sandbox'] as const;
type Reason = (typeof REASONS)[number];

const rows = async (s: any): Promise<any[]> => ((await db.execute(s)) as any).rows;
const one = async (s: any): Promise<any> => (await rows(s))[0];

// ── DDL ────────────────────────────────────────────────────────────────────────────────────────

async function ensureColumns(apply: boolean) {
    const existing = await rows(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'messages' AND column_name IN ('quarantined_at', 'quarantine_reason')`);
    if (existing.length === 2) {
        console.log('columns quarantined_at / quarantine_reason already present');
        return;
    }
    if (!apply) {
        console.log(`WOULD ADD columns quarantined_at (timestamp) + quarantine_reason (varchar 40) to messages`);
        return;
    }
    await db.execute(sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS quarantined_at timestamp`);
    await db.execute(sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS quarantine_reason varchar(40)`);
    // Every hot read is "the live rows on these conversations", so the index that matters is the
    // partial one over the rows that survive the filter.
    await db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_messages_live_conversation
        ON messages (conversation_id) WHERE quarantined_at IS NULL`);
    console.log('added quarantined_at, quarantine_reason, idx_messages_live_conversation');
}

async function columnsExist(): Promise<boolean> {
    const c = await rows(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'messages' AND column_name = 'quarantined_at'`);
    return c.length > 0;
}

// ── The real sends, which must survive untouched ───────────────────────────────────────────────

interface RealSends { count: number; ids: string[]; sids: string[] }

async function snapshotRealSends(): Promise<RealSends> {
    const r = await rows(sql`
        SELECT id, twilio_sid FROM messages
        WHERE direction = 'outbound' AND twilio_sid IS NOT NULL ORDER BY id`);
    return { count: r.length, ids: r.map((x) => x.id), sids: r.map((x) => x.twilio_sid) };
}

function assertRealSendsIntact(before: RealSends, after: RealSends) {
    const same = before.count === after.count
        && before.ids.join('|') === after.ids.join('|')
        && before.sids.join('|') === after.sids.join('|');
    if (!same) {
        throw new Error(
            `REAL SENDS CHANGED: ${before.count} rows with a twilio_sid before, ${after.count} after. Aborting.`);
    }
}

// ── Classification ─────────────────────────────────────────────────────────────────────────────

/**
 * The predicate, written once. Every count, the update and the report read from here so a dry run
 * cannot describe a different set of rows than the apply touches.
 */
const CANDIDATES = sql`
    direction = 'outbound'
    AND twilio_sid IS NULL
    AND created_at < ${CUTOVER}::timestamp
    AND quarantined_at IS NULL`;

const REASON_EXPR = sql`
    CASE
        WHEN conversation_id LIKE 'tenant\\_%' THEN 'tenant_sandbox'
        WHEN created_at < ${LOOP_END}::timestamp THEN 'runaway_loop'
        ELSE 'dead_sender'
    END`;

// ── Sanity assertions about the window itself ──────────────────────────────────────────────────

async function assertWindowIsClean() {
    const a = await one(sql`
        SELECT count(*)::int n, max(created_at) latest FROM messages
        WHERE direction = 'outbound' AND twilio_sid IS NULL AND created_at >= ${CUTOVER}::timestamp`);
    if (Number(a.n) !== 0) {
        throw new Error(
            `${a.n} outbound rows without a twilio_sid exist on/after the ${CUTOVER} cutover (latest ${a.latest}). ` +
            `A non-Twilio transport (Meta) may now be writing rows — re-scope this migration before running it.`);
    }
    const b = await one(sql`
        SELECT count(*)::int n, min(created_at) earliest FROM messages
        WHERE direction = 'outbound' AND twilio_sid IS NOT NULL`);
    if (new Date(b.earliest) < new Date(CUTOVER)) {
        throw new Error(`A real send predates the cutover (${b.earliest}). Re-scope before running.`);
    }
    console.log(`window clean: 0 unsent-shaped rows after ${CUTOVER}; earliest real send ${b.earliest} (${b.n} total)`);
}

// ── Reporting ──────────────────────────────────────────────────────────────────────────────────

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));

async function report(title: string) {
    console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 70 - title.length))}`);
    const totals = await one(sql`
        SELECT count(*)::int total,
               count(*) FILTER (WHERE direction = 'outbound')::int outbound,
               count(*) FILTER (WHERE direction = 'outbound' AND twilio_sid IS NOT NULL)::int real_sends,
               count(*) FILTER (WHERE quarantined_at IS NOT NULL)::int quarantined,
               count(*) FILTER (WHERE direction = 'outbound' AND quarantined_at IS NULL)::int live_outbound
        FROM messages`);
    console.log(`  messages total          ${totals.total}`);
    console.log(`  outbound                ${totals.outbound}`);
    console.log(`  outbound with a SID     ${totals.real_sends}   <- must stay 39, must stay unquarantined`);
    console.log(`  quarantined             ${totals.quarantined}`);
    console.log(`  outbound still counting ${totals.live_outbound}`);

    const byReason = await rows(sql`
        SELECT quarantine_reason r, count(*)::int n, count(DISTINCT conversation_id)::int convs
        FROM messages WHERE quarantined_at IS NOT NULL GROUP BY 1 ORDER BY n DESC`);
    for (const x of byReason) console.log(`    ${pad(x.r ?? '(null)', 18)} ${pad(String(x.n), 8)} rows  ${x.convs} conversations`);

    const leak = await one(sql`
        SELECT count(*)::int n FROM messages WHERE twilio_sid IS NOT NULL AND quarantined_at IS NOT NULL`);
    if (Number(leak.n) !== 0) throw new Error(`${leak.n} rows with a real twilio_sid are quarantined. Aborting.`);
    console.log(`  rows with a SID quarantined: 0 (asserted)`);
}

/** The point of the exercise: how the board's answer to "who is waiting on us?" changes. */
async function waitStateDelta() {
    const r = await one(sql`
        WITH a AS (
            SELECT c.id,
                   max(m.created_at) FILTER (WHERE m.direction = 'inbound') li,
                   max(m.created_at) FILTER (WHERE m.direction = 'outbound') lo_all,
                   max(m.created_at) FILTER (WHERE m.direction = 'outbound' AND m.quarantined_at IS NULL) lo_live
            FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id
            WHERE c.status IS DISTINCT FROM 'archived'
            GROUP BY c.id)
        SELECT count(*)::int convs,
               count(*) FILTER (WHERE li IS NOT NULL AND (lo_all IS NULL OR lo_all < li))::int awaiting_before,
               count(*) FILTER (WHERE li IS NOT NULL AND (lo_live IS NULL OR lo_live < li))::int awaiting_after,
               count(*) FILTER (WHERE li IS NOT NULL AND lo_all >= li AND (lo_live IS NULL OR lo_live < li))::int flipped
        FROM a`);
    const firstContact = await one(sql`
        SELECT count(*)::int n FROM (
            SELECT c.id FROM conversations c JOIN messages m ON m.conversation_id = c.id
            WHERE m.direction = 'outbound'
            GROUP BY c.id
            HAVING count(*) FILTER (WHERE m.quarantined_at IS NULL) = 0) t`);
    console.log(`\n── THE TRUE PICTURE ${'─'.repeat(58)}`);
    console.log(`  live conversations on the board       ${r.convs}`);
    console.log(`  "awaiting reply" BEFORE quarantine    ${r.awaiting_before}`);
    console.log(`  "awaiting reply" AFTER quarantine     ${r.awaiting_after}`);
    console.log(`  conversations answered -> awaiting    ${r.flipped}`);
    console.log(`  threads whose ONLY outbound was phantom (now first-contact eligible): ${firstContact.n}`);
}

// ── Actions ────────────────────────────────────────────────────────────────────────────────────

async function doPlan() {
    const plan = await rows(sql`
        SELECT ${REASON_EXPR} reason, count(*)::int n, count(DISTINCT conversation_id)::int convs,
               min(created_at) first_at, max(created_at) last_at
        FROM messages WHERE ${CANDIDATES} GROUP BY 1 ORDER BY n DESC`);
    console.log(`\n── WOULD QUARANTINE ${'─'.repeat(58)}`);
    console.log(`  ${pad('reason', 18)}${pad('rows', 10)}${pad('convs', 8)}window`);
    let total = 0;
    for (const p of plan) {
        total += Number(p.n);
        console.log(`  ${pad(p.reason, 18)}${pad(String(p.n), 10)}${pad(String(p.convs), 8)}${p.first_at} → ${p.last_at}`);
    }
    console.log(`  ${pad('TOTAL', 18)}${total}`);
    return total;
}

async function doApply() {
    const before = await snapshotRealSends();
    console.log(`\nsnapshot: ${before.count} outbound rows carry a real twilio_sid`);

    const updated = await rows(sql`
        UPDATE messages SET quarantined_at = now(), quarantine_reason = ${REASON_EXPR}
        WHERE ${CANDIDATES}
        RETURNING id`);
    console.log(`quarantined ${updated.length} row(s)`);

    const after = await snapshotRealSends();
    assertRealSendsIntact(before, after);
    console.log(`assert OK: the same ${after.count} real sends are present and unchanged`);
}

async function doRestore(apply: boolean, reason?: string) {
    const scope = reason ? sql`quarantine_reason = ${reason}` : sql`TRUE`;
    const n = await one(sql`SELECT count(*)::int n FROM messages WHERE quarantined_at IS NOT NULL AND ${scope}`);
    console.log(`${n.n} quarantined row(s)${reason ? ` with reason '${reason}'` : ''}`);
    if (!apply) {
        console.log(`Dry run. Add --apply to clear the marks and put them back into every read path.`);
        return;
    }
    const before = await snapshotRealSends();
    const r = await rows(sql`
        UPDATE messages SET quarantined_at = NULL, quarantine_reason = NULL
        WHERE quarantined_at IS NOT NULL AND ${scope} RETURNING id`);
    assertRealSendsIntact(before, await snapshotRealSends());
    console.log(`restored ${r.length} row(s). Nothing was ever deleted, so this is a full reversal.`);
}

// ── Main ───────────────────────────────────────────────────────────────────────────────────────

async function main() {
    const argv = process.argv.slice(2);
    const has = (f: string) => argv.includes(f);
    const val = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

    const apply = has('--apply');
    const restore = has('--restore');
    const status = has('--status');
    const reason = val('--reason');
    if (reason && !REASONS.includes(reason as Reason)) {
        console.error(`Unknown --reason '${reason}'. One of: ${REASONS.join(', ')}`);
        process.exit(1);
    }

    if (status) {
        if (!(await columnsExist())) { console.log('quarantine columns do not exist yet.'); process.exit(0); }
        await report('CURRENT STATE');
        await waitStateDelta();
        process.exit(0);
    }

    if (restore) {
        if (!(await columnsExist())) { console.log('quarantine columns do not exist; nothing to restore.'); process.exit(0); }
        await report('BEFORE RESTORE');
        await doRestore(apply, reason);
        if (apply) { await report('AFTER RESTORE'); await waitStateDelta(); }
        process.exit(0);
    }

    await assertWindowIsClean();
    await ensureColumns(apply);

    if (!(await columnsExist())) {
        // Dry run before the DDL has ever been applied: the reports below need the columns.
        console.log(`\nDRY RUN — columns do not exist yet, so only the plan can be shown.`);
        const plan = await rows(sql`
            SELECT ${REASON_EXPR} reason, count(*)::int n, count(DISTINCT conversation_id)::int convs
            FROM messages
            WHERE direction = 'outbound' AND twilio_sid IS NULL AND created_at < ${CUTOVER}::timestamp
            GROUP BY 1 ORDER BY n DESC`);
        for (const p of plan) console.log(`  ${pad(p.reason, 18)}${pad(String(p.n), 10)}${p.convs} conversations`);
        console.log(`\nRun with --apply.`);
        process.exit(0);
    }

    await report('BEFORE');
    const total = await doPlan();

    if (!apply) {
        await waitStateDelta();
        console.log(`\nDRY RUN. Nothing was changed. Run with --apply to quarantine those ${total} row(s).`);
        process.exit(0);
    }

    await doApply();
    await report('AFTER');
    await waitStateDelta();
    console.log(`\nReversible: npx tsx scripts/migrate-quarantine-phantom-messages.ts --restore --apply`);
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
