/**
 * system_events smoke test — insert via the real helper, read back like the route does,
 * assert ordering + filtering + the summary cap, then remove the test rows.
 *
 *   npx tsx scripts/_system-events-test.ts
 */
import 'dotenv/config';
import { db } from '../server/db';
import { systemEvents } from '../shared/schema';
import { logSystemEvent } from '../server/system-events';
import { desc, eq, and, like, inArray } from 'drizzle-orm';

const MARKER = `sevtest_${Date.now()}`;

function assert(cond: boolean, label: string) {
    if (!cond) { console.error(`✗ FAIL: ${label}`); process.exit(1); }
    console.log(`✓ ${label}`);
}

async function main() {
    // 1. Insert three events through the real helper, spaced so ordering is deterministic.
    await logSystemEvent({ kind: 'send', phone: '+447700900123', summary: `${MARKER} first`, detail: { n: 1 }, source: 'test' });
    await new Promise((r) => setTimeout(r, 25));
    await logSystemEvent({ kind: 'hold', summary: `${MARKER} second`, detail: { n: 2 }, source: 'test' });
    await new Promise((r) => setTimeout(r, 25));
    await logSystemEvent({ kind: 'send', summary: `${MARKER} third ${'x'.repeat(400)}`, detail: { n: 3 }, source: 'test' });

    // 2. Read back newest-first, exactly as the route does.
    const rows = await db.select().from(systemEvents)
        .where(like(systemEvents.summary, `${MARKER}%`))
        .orderBy(desc(systemEvents.at))
        .limit(100);

    assert(rows.length === 3, 'all 3 events inserted');
    assert(rows[0].summary.startsWith(`${MARKER} third`), 'newest first (row 0 = third)');
    assert(rows[2].summary.endsWith('first'), 'oldest last (row 2 = first)');
    assert(rows[0].summary.length <= 300, `summary capped at 300 chars (got ${rows[0].summary.length})`);
    assert(rows[2].phone === '+447700900123', 'phone stored');
    assert((rows[1].detail as any)?.n === 2, 'detail jsonb round-trips');

    // 3. Kind filter, as the route builds it.
    const sends = await db.select().from(systemEvents)
        .where(and(eq(systemEvents.kind, 'send'), like(systemEvents.summary, `${MARKER}%`)))
        .orderBy(desc(systemEvents.at));
    assert(sends.length === 2, "kind='send' filter returns exactly the 2 send rows");

    // 4. Clean up the test rows.
    const deleted = await db.delete(systemEvents)
        .where(inArray(systemEvents.id, rows.map((r) => r.id)))
        .returning({ id: systemEvents.id });
    assert(deleted.length === 3, 'test rows cleaned');

    // 5. The live smoke: one real event, left in place — the first genuine row on /admin/activity.
    await logSystemEvent({
        kind: 'config_change',
        summary: 'System event log switched on — live-beta observability (scripts/migrate-system-events.ts applied)',
        source: 'system-events',
    });
    console.log('✓ live smoke event logged (kind=config_change, kept)');
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
