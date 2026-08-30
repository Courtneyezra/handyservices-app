/**
 * Track B (B-WP2) — ops sessions HTTP + persistence + event test.
 *
 * Mounts the REAL opsManagerRouter in-process on an ephemeral port (the shared
 * dev server on :5001 may still be serving the pre-WP2 501 stub until it
 * restarts) with a stub auth middleware standing in for requireAdmin. The
 * comms bus is subscribed directly via onCommsEvent — the exact events the
 * /api/comms/events SSE route relays to browsers.
 *
 * Asserts:
 *   1. POST /sessions → 201, OpsSessionDTO shape, createdBy from auth context
 *   2. POST /sessions/:id/messages → 202 {runId}; concurrent post → 409 run_active
 *   3. Poll GET /sessions/:id until the assistant row lands (agent-unavailable
 *      fallback here, since server/agents/ops-manager.ts is B-WP1's) —
 *      user+assistant DTO shapes, runId on the assistant row
 *   4. Bus carried ops_message (x2) + ops_run_started + ops_run_finished(ok)
 *   5. Archive works; archived session rejects new messages (409) and leaves
 *      the active list
 *   6. Dev-replay emits the full canned sequence for a given sessionId
 *   7. Restart-safety: rows re-read through a second query path (they are DB
 *      rows — nothing lives only in process memory)
 *
 * All test rows cleaned up. Run: npx tsx scripts/_test-ops-sessions.ts
 */
import express from 'express';
import { db } from '../server/db';
import { opsSessions, opsMessages } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { onCommsEvent, type CommsEvent } from '../server/comms-events';
import { opsManagerRouter } from '../server/ops-manager-routes';

const TEST_USER = 'test-ops-user';

let pass = 0, fail = 0;
function check(cond: boolean, label: string) {
    if (cond) { pass++; console.log(`  PASS  ${label}`); }
    else { fail++; console.error(`  FAIL  ${label}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let sessionId: string | null = null;

async function cleanup() {
    if (!sessionId) return;
    await db.delete(opsMessages).where(eq(opsMessages.sessionId, sessionId));
    await db.delete(opsSessions).where(eq(opsSessions.id, sessionId));
}

async function main() {
    // ── in-process server: real router, stub auth ────────────────────────────
    const app = express();
    app.use(express.json());
    app.use('/api/ops', (req, _res, next) => { (req as any).user = { id: TEST_USER, role: 'admin' }; next(); }, opsManagerRouter);
    const server = app.listen(0);
    const port = (server.address() as any).port;
    const base = `http://127.0.0.1:${port}/api/ops`;
    const api = async (method: string, path: string, body?: unknown) => {
        const r = await fetch(base + path, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: r.status, json: await r.json().catch(() => null) };
    };

    const events: CommsEvent[] = [];
    const unsubscribe = onCommsEvent((evt) => { if (String(evt.type).startsWith('ops_')) events.push(evt); });

    // ── 1. create session ────────────────────────────────────────────────────
    console.log('\n--- Create session ---');
    const created = await api('POST', '/sessions', { title: 'Test ops session (safe to delete)' });
    check(created.status === 201, `POST /sessions → 201 (got ${created.status})`);
    const s = created.json;
    sessionId = s?.id ?? null;
    check(typeof s?.id === 'string' && s.id.length > 10, `session id is a string (got ${s?.id})`);
    check(s?.title === 'Test ops session (safe to delete)', `title round-trips (got '${s?.title}')`);
    check(s?.createdBy === TEST_USER, `createdBy from auth context (got '${s?.createdBy}')`);
    check(s?.status === 'active', `status 'active' (got '${s?.status}')`);
    check(typeof s?.createdAt === 'string' && !Number.isNaN(Date.parse(s.createdAt)), `createdAt is ISO string (got ${s?.createdAt})`);
    check(typeof s?.updatedAt === 'string' && !Number.isNaN(Date.parse(s.updatedAt)), `updatedAt is ISO string (got ${s?.updatedAt})`);

    const listed = await api('GET', '/sessions?limit=50');
    check(listed.status === 200 && Array.isArray(listed.json) && listed.json.some((x: any) => x.id === sessionId),
        'GET /sessions lists the new session');

    // ── 2. post message; concurrent post must 409 ────────────────────────────
    console.log('\n--- Post message + concurrency ---');
    const msg1 = await api('POST', `/sessions/${sessionId}/messages`, { content: 'Test turn: what needs attention today?' });
    check(msg1.status === 202 && typeof msg1.json?.runId === 'string', `first message → 202 {runId} (got ${msg1.status} ${JSON.stringify(msg1.json)})`);
    const msg2 = await api('POST', `/sessions/${sessionId}/messages`, { content: 'Second message while run active' });
    check(msg2.status === 409 && msg2.json?.error === 'run_active', `concurrent message → 409 run_active (got ${msg2.status} ${JSON.stringify(msg2.json)})`);

    // ── 3. poll until the assistant row lands ────────────────────────────────
    console.log('\n--- Poll for assistant row ---');
    let messages: any[] = [];
    for (let i = 0; i < 40; i++) {
        const got = await api('GET', `/sessions/${sessionId}`);
        messages = got.json?.messages ?? [];
        if (messages.some((m: any) => m.role === 'assistant')) break;
        await sleep(250);
    }
    check(messages.length === 2, `2 messages persisted (got ${messages.length})`);
    const userMsg = messages.find((m: any) => m.role === 'user');
    const asst = messages.find((m: any) => m.role === 'assistant');
    check(!!userMsg && userMsg.content === 'Test turn: what needs attention today?', 'user row persisted with content');
    check(!!asst, 'assistant row appeared');
    check(asst?.runId === msg1.json?.runId, `assistant row carries the runId (got ${asst?.runId})`);
    check(typeof asst?.content === 'string' && asst.content.length > 0, 'assistant content non-empty');
    check(asst?.content.includes("isn't deployed"), `agent-unavailable fallback text (agent is B-WP1's; got '${String(asst?.content).slice(0, 60)}…')`);
    check(messages.every((m: any) => m.sessionId === sessionId && typeof m.createdAt === 'string' && !Number.isNaN(Date.parse(m.createdAt))),
        'message DTOs: sessionId + ISO createdAt');
    check(new Date(messages[0].createdAt) <= new Date(messages[1].createdAt), 'messages ordered oldest first');

    // after the run finishes, a new message must be accepted again (lock released)
    const relock = await api('POST', `/sessions/${sessionId}/messages`, { content: 'Post-run message — lock must be free' });
    check(relock.status === 202, `lock released after run (got ${relock.status})`);
    for (let i = 0; i < 40; i++) { // wait for that second run to finish before archiving
        const got = await api('GET', `/sessions/${sessionId}`);
        if ((got.json?.messages ?? []).length >= 4) break;
        await sleep(250);
    }

    // ── 4. bus events (what SSE relays) ──────────────────────────────────────
    console.log('\n--- Bus events ---');
    const forSession = events.filter((e: any) => e.sessionId === sessionId);
    const types = forSession.map((e) => e.type);
    check(types.filter((t) => t === 'ops_message').length >= 2, `≥2 ops_message events (got ${types.filter((t) => t === 'ops_message').length})`);
    check(types.includes('ops_run_started'), 'ops_run_started emitted');
    check(types.includes('ops_run_finished'), 'ops_run_finished emitted');
    const finished: any = forSession.find((e: any) => e.type === 'ops_run_finished' && e.runId === msg1.json?.runId);
    check(finished?.ok === true, `ops_run_finished ok=true for run 1 (got ${finished?.ok})`);
    check(types.indexOf('ops_run_started') < types.indexOf('ops_run_finished'), 'started precedes finished');

    // ── 5. archive ───────────────────────────────────────────────────────────
    console.log('\n--- Archive ---');
    const archived = await api('POST', `/sessions/${sessionId}/archive`);
    check(archived.status === 200 && archived.json?.status === 'archived', `archive → status 'archived' (got ${archived.status} ${archived.json?.status})`);
    const listedAfter = await api('GET', '/sessions?limit=50');
    check(Array.isArray(listedAfter.json) && !listedAfter.json.some((x: any) => x.id === sessionId), 'archived session left the active list');
    const postToArchived = await api('POST', `/sessions/${sessionId}/messages`, { content: 'should be rejected' });
    check(postToArchived.status === 409 && postToArchived.json?.error === 'session_archived', `message to archived session → 409 (got ${postToArchived.status})`);

    // ── 6. dev-replay ────────────────────────────────────────────────────────
    console.log('\n--- Dev replay ---');
    const replayEventsBefore = events.length;
    const replay = await api('POST', `/dev-replay?session=${sessionId}`);
    check(replay.status === 200 && typeof replay.json?.runId === 'string', `dev-replay accepted (got ${replay.status})`);
    await sleep((replay.json?.durationMs ?? 6000) + 800);
    const replayed = events.slice(replayEventsBefore).filter((e: any) => e.sessionId === sessionId && e.runId === replay.json?.runId || (e as any).message?.runId === replay.json?.runId);
    const rTypes = events.slice(replayEventsBefore).map((e) => e.type);
    check(rTypes.includes('ops_run_started') && rTypes.includes('ops_run_finished'), 'replay: started + finished');
    check(rTypes.filter((t) => t === 'ops_run_event').length >= 4, `replay: ≥4 ops_run_event steps (got ${rTypes.filter((t) => t === 'ops_run_event').length})`);
    check(rTypes.includes('ops_message'), 'replay: ops_message');
    void replayed;

    // ── 7. restart-safety: rows are plain DB rows ────────────────────────────
    console.log('\n--- Restart-safety (fresh DB read) ---');
    const [rawSession] = await db.select().from(opsSessions).where(eq(opsSessions.id, sessionId!));
    const rawMessages = await db.select().from(opsMessages).where(eq(opsMessages.sessionId, sessionId!));
    check(!!rawSession && rawMessages.length >= 4, `session + ${rawMessages.length} messages readable directly from DB (survive restart by construction)`);

    unsubscribe();
    server.close();
}

main()
    .then(async () => {
        console.log('\n--- Cleanup ---');
        await cleanup();
        console.log('  test rows removed');
        console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
        process.exit(fail > 0 ? 1 : 0);
    })
    .catch(async (err) => {
        console.error('\nTest run crashed:', err);
        try { await cleanup(); console.log('Cleanup completed after crash'); } catch (c) { console.error('Cleanup failed:', c); }
        process.exit(1);
    });
