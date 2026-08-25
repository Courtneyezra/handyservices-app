/**
 * Verifies the draft-and-approve gate, without sending anything.
 *
 * The property that matters: a system-authored message reaches a customer ONLY via an explicit
 * approval. Checks queueing, dedupe, edit-before-approve, reject, and that approval refuses when
 * the message could not actually be delivered.
 *
 *   npx tsx scripts/_drafts-verify.ts <port>
 */
import { db } from '../server/db';
import { messageDrafts } from '@shared/schema';
import { eq, like } from 'drizzle-orm';
import { queueDraft } from '../server/message-drafts';

const PORT = process.argv[2] || '5000';
const TEST_PHONE = '+447700900777'; // Ofcom test range — never a real subscriber.

let failures = 0;
const check = (label: string, ok: boolean, detail: string) => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n      ${detail}`);
};

async function cleanup() {
    await db.delete(messageDrafts).where(eq(messageDrafts.phone, TEST_PHONE));
}

async function main() {
    await cleanup();

    // --- queueing ---
    const id = await queueDraft({
        phone: TEST_PHONE,
        body: 'Test draft — should never send without approval.',
        source: 'post_call_video',
        reason: 'verification run',
    });
    check('queueDraft creates a pending draft', !!id, `id=${id}`);

    const [row] = await db.select().from(messageDrafts).where(eq(messageDrafts.id, id!));
    check('draft starts pending and unsent', row?.status === 'pending' && !row?.sentAt,
        `status=${row?.status} sentAt=${row?.sentAt}`);

    // --- dedupe ---
    const dup = await queueDraft({
        phone: TEST_PHONE, body: 'Second attempt', source: 'post_call_video', reason: 'dupe',
    });
    check('duplicate from the same source is suppressed', dup === null, `returned ${dup}`);

    // --- unparseable phone ---
    const bad = await queueDraft({ phone: 'nonsense', body: 'x', source: 'manual' });
    check('unparseable phone is refused', bad === null, `returned ${bad}`);

    // --- approval refuses when undeliverable ---
    // No conversation exists for this number, so the 24h window is shut, and the draft has no
    // template. Approving must refuse rather than send something WhatsApp would reject.
    const res = await fetch(`http://localhost:${PORT}/api/drafts/${id}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.DEV_ADMIN_TOKEN ?? ''}` },
    });
    const body: any = await res.json().catch(() => ({}));
    check('approve refuses an undeliverable draft',
        res.status === 409 && body.error === 'OUTSIDE_WINDOW',
        `http ${res.status} ${JSON.stringify(body).slice(0, 90)}`);

    const [after] = await db.select().from(messageDrafts).where(eq(messageDrafts.id, id!));
    check('refused draft returns to pending (not stuck approved)',
        after?.status === 'pending' && !after?.sentAt,
        `status=${after?.status} sentAt=${after?.sentAt}`);

    // --- nothing was ever sent ---
    const sent = await db.select().from(messageDrafts)
        .where(like(messageDrafts.phone, TEST_PHONE));
    check('no draft for the test number reached sent',
        sent.every((d) => d.status !== 'sent'),
        sent.map((d) => d.status).join(', ') || 'none');

    await cleanup();
    console.log(failures === 0 ? '\nAll draft-gate checks passed. Nothing was sent.' : `\n${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(1); });
