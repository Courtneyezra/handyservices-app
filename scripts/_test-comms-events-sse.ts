/**
 * Scratch verification for the comms SSE stream (Brief A, 29 Aug 2026).
 *
 * 1. Mints a short-lived admin session (deleted afterwards) so curl/EventSource can auth.
 * 2. Opens the SSE stream via fetch and prints every event that arrives.
 * 3. Fires emitCommsEvent IN-PROCESS? No — the stream lives in the dev server's process, so
 *    events must be produced THERE: this script instead queues a real draft via queueDraft's
 *    HTTP surface? There is none — so it exercises the PATCH/reject routes on a throwaway
 *    draft it creates directly in the DB, which drives the dev server's emit points.
 *
 * Usage: npx tsx scripts/_test-comms-events-sse.ts
 */
import { db } from '../server/db';
import { contractorSessions, users, messageDrafts } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

const BASE = process.env.BASE_URL ?? 'http://localhost:5001';

async function main() {
    const [admin] = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
    if (!admin) throw new Error('No admin user to mint a session for');

    const token = `smoke_${uuidv4()}`;
    await db.insert(contractorSessions).values({
        sessionToken: token,
        userId: admin.id,
        expiresAt: new Date(Date.now() + 10 * 60_000),
    } as any);
    console.log(`[SSE-Test] Minted 10-min session for ${admin.email ?? admin.id}`);

    // A throwaway pending draft on the Ofcom test range — nothing routes it anywhere.
    const draftId = `draft_ssetest_${Date.now()}`;
    await db.insert(messageDrafts).values({
        id: draftId,
        conversationId: null,
        phone: '+447700900123',
        body: 'SSE smoke test draft — never sent',
        channel: 'sms',
        source: 'manual',
        reason: 'SSE smoke test',
        status: 'pending',
    } as any);
    console.log(`[SSE-Test] Inserted throwaway draft ${draftId}`);

    const received: unknown[] = [];
    const controller = new AbortController();
    const streaming = (async () => {
        const res = await fetch(`${BASE}/api/comms/events?token=${token}`, {
            signal: controller.signal,
            headers: { Accept: 'text/event-stream' },
        });
        console.log(`[SSE-Test] Stream status ${res.status}, content-type ${res.headers.get('content-type')}`);
        if (!res.ok || !res.body) throw new Error(`stream refused: ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (; ;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n\n')) !== -1) {
                const frame = buf.slice(0, idx);
                buf = buf.slice(idx + 2);
                if (frame.startsWith(':')) { console.log(`[SSE-Test] comment frame: ${JSON.stringify(frame)}`); continue; }
                const data = frame.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('');
                if (data) {
                    const evt = JSON.parse(data);
                    received.push(evt);
                    console.log('[SSE-Test] EVENT:', evt);
                }
            }
        }
    })().catch((e) => { if (e?.name !== 'AbortError') throw e; });

    // Give the stream a beat to attach, then drive the dev server's emit points over HTTP.
    await new Promise((r) => setTimeout(r, 800));

    const patch = await fetch(`${BASE}/api/drafts/${draftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ body: 'SSE smoke test draft — edited body' }),
    });
    console.log(`[SSE-Test] PATCH /api/drafts/${draftId} → ${patch.status}`);

    const reject = await fetch(`${BASE}/api/drafts/${draftId}/reject`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`[SSE-Test] POST /api/drafts/${draftId}/reject → ${reject.status}`);

    await new Promise((r) => setTimeout(r, 1500));
    controller.abort();
    await streaming;

    // Tidy up: the throwaway draft and the smoke session.
    await db.delete(messageDrafts).where(eq(messageDrafts.id, draftId));
    await db.delete(contractorSessions).where(eq(contractorSessions.sessionToken, token));

    const types = received.map((e: any) => `${e.type}:${e.status ?? e.reason ?? ''}`);
    console.log(`[SSE-Test] Received ${received.length} events: ${types.join(', ')}`);
    const ok = types.includes('draft_delta:edited') && types.includes('draft_delta:rejected');
    console.log(ok ? '[SSE-Test] PASS' : '[SSE-Test] FAIL — expected draft_delta edited + rejected');
    process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('[SSE-Test] ERROR:', e); process.exit(1); });
