/**
 * E-WP3: end-to-end verification of the roster tool + quick replies.
 *
 * Static checks (no server needed):
 *   1. buildTools() from server/agents/ops-manager.ts contains get_contractors,
 *      total tool count is 22.
 *   2. SYSTEM prompt teaches the ```options quick-reply convention.
 *   3. parseQuickReplies (client/src/components/ops/quick-replies.ts, pure module)
 *      round-trips one valid and one invalid sample.
 *
 * Live check (ONE real agent run against the tsx watch dev server on :5001):
 *   - Mint a temp admin token: raw-SQL insert into contractor_sessions keyed on
 *     session_token (live table keys on session_token — never insert an `id`).
 *   - POST /api/ops/sessions → session; POST a read-only question about Craig's
 *     schedule → 202 {runId}; poll GET /api/ops/sessions/:id (~3s, 3 min cap)
 *     until the assistant row for that runId appears.
 *   - PASS path A (direct resolve): transcript has a tool_call get_contractors
 *     AND a tool_call get_jobs {view:'contractor_schedule', contractorId:'hp_…'}.
 *   - PASS path B (disambiguation): finalText ends in a ```options block that
 *     parseQuickReplies accepts.
 *   - FAIL LOUDLY if any write/send-shaped tool appears in the transcript, and
 *     report any messages/message_drafts rows created during the window.
 *
 * Cleanup: archive the ops session (rows stay, archived — ids reported), delete
 * the contractor_sessions row by session_token, verify zero left behind.
 *
 * Run: npx tsx scripts/_smoke-track-e.ts
 */
import crypto from 'node:crypto';
import { db } from '../server/db';
import { users } from '@shared/schema';
import { sql, eq, or } from 'drizzle-orm';
import { buildTools, SYSTEM } from '../server/agents/ops-manager';
import { parseQuickReplies } from '../client/src/components/ops/quick-replies';

const BASE = 'http://localhost:5001';
const QUESTION = "what's Craig's schedule this week?";

// Tools that could shape a message toward a customer or mutate state — a pure
// read question must call NONE of these.
const SEND_SHAPED = new Set([
    'queue_draft', 'run_comms_agent', 'run_quote_prep', 'run_recovery_sweep',
    'run_sla_sweep', 'create_va_call_task', 'complete_call_task',
    'dismiss_call_task', 'propose_job_assignment', 'generate_invoice',
    'flag_for_ben',
]);

let failures = 0;
function assert(cond: boolean, label: string): void {
    if (cond) console.log(`  ✓ ${label}`);
    else { failures++; console.error(`  ✗ FAIL: ${label}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let token: string | null = null;
async function api(method: string, path: string, body?: unknown) {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: any = null;
    try { json = await res.json(); } catch { /* non-JSON is fine */ }
    return { status: res.status, json };
}

async function main() {
    // ── PHASE 1: static checks ──────────────────────────────────────────────
    console.log('=== PHASE 1: static checks ===');
    const tools = buildTools();
    const names = tools.map((t: any) => t.name);
    assert(names.includes('get_contractors'), 'buildTools() contains get_contractors');
    assert(tools.length === 22, `buildTools() has 22 tools (got ${tools.length})`);
    assert(SYSTEM.includes('```options'), "SYSTEM teaches the '```options' convention");

    assert(typeof parseQuickReplies === 'function', 'parseQuickReplies is exported and callable');
    const valid = parseQuickReplies('Which Craig?\n\n```options\n["Craig Smith", "Craig Jones"]\n```');
    assert(
        valid.body === 'Which Craig?' && valid.options.length === 2 && valid.options[0] === 'Craig Smith',
        `valid sample round-trips (body=${JSON.stringify(valid.body)}, options=${JSON.stringify(valid.options)})`,
    );
    const invalid = parseQuickReplies('Text\n```options\nnot json at all\n```');
    assert(
        invalid.options.length === 0 && invalid.body.includes('not json at all'),
        'invalid sample is left untouched (no options, body intact)',
    );

    // ── PHASE 2: live run ───────────────────────────────────────────────────
    console.log('\n=== PHASE 2: live agent run ===');
    const testStart = new Date();

    // Temp admin token. The live contractor_sessions table keys on session_token
    // (no id column) — raw SQL keyed on session_token, per the drift warning.
    const admin = await db.query.users.findFirst({
        where: or(eq(users.role, 'admin'), eq(users.role, 'va')),
    });
    if (!admin) throw new Error('No admin/va user in DB — cannot mint a token');
    token = `smoke_e_${crypto.randomBytes(24).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await db.execute(sql`
        INSERT INTO contractor_sessions (session_token, user_id, expires_at)
        VALUES (${token}, ${admin.id}, ${expiresAt})
    `);
    console.log(`  minted temp token for ${admin.email ?? admin.id} (${admin.role})`);

    let sessionId: string | null = null;
    try {
        const created = await api('POST', '/api/ops/sessions', { title: 'E-SMOKE roster+quick-replies (safe to archive)' });
        assert(created.status === 201 && typeof created.json?.id === 'string', `POST /api/ops/sessions → 201 (got ${created.status})`);
        sessionId = created.json?.id ?? null;
        if (!sessionId) throw new Error('no session id — aborting live phase');

        const posted = await api('POST', `/api/ops/sessions/${sessionId}/messages`, { content: QUESTION });
        assert(posted.status === 202 && typeof posted.json?.runId === 'string', `POST message → 202 {runId} (got ${posted.status} ${JSON.stringify(posted.json)})`);
        const runId: string | undefined = posted.json?.runId;

        // Poll every ~3s, 3 min cap.
        let assistant: any = null;
        const pollStart = Date.now();
        for (let i = 0; i < 60; i++) {
            const got = await api('GET', `/api/ops/sessions/${sessionId}`);
            assistant = (got.json?.messages ?? []).find((m: any) => m.role === 'assistant' && (!runId || m.runId === runId)) ?? null;
            if (assistant) break;
            await sleep(3000);
        }
        const pollSecs = ((Date.now() - pollStart) / 1000).toFixed(1);
        assert(!!assistant, `assistant row appeared within 3 min (waited ${pollSecs}s)`);
        if (!assistant) throw new Error('no assistant message — aborting assertions');
        console.log(`  run completed in ~${pollSecs}s; assistant message id ${assistant.id}`);

        const transcript: any[] = Array.isArray(assistant.transcript) ? assistant.transcript : [];
        const toolCalls = transcript.filter((s) => s?.type === 'tool_call');
        console.log(`  transcript: ${transcript.length} steps, tool calls: ${toolCalls.map((c) => c.tool).join(', ') || '(none)'}`);

        assert(toolCalls.some((c) => c.tool === 'get_contractors'), 'transcript contains a get_contractors tool_call');

        const scheduleCall = toolCalls.find((c) =>
            c.tool === 'get_jobs' &&
            (c.input as any)?.view === 'contractor_schedule' &&
            typeof (c.input as any)?.contractorId === 'string' &&
            (c.input as any).contractorId.startsWith('hp_'));
        const parsed = parseQuickReplies(String(assistant.content ?? ''));
        const optionsPath = parsed.options.length >= 2;

        if (scheduleCall) {
            console.log(`  disambiguation path: DIRECT RESOLVE — get_jobs input ${JSON.stringify(scheduleCall.input)}`);
            assert(true, `get_jobs called with view=contractor_schedule and contractorId=${(scheduleCall.input as any).contractorId}`);
        } else if (optionsPath) {
            console.log(`  disambiguation path: OPTIONS BLOCK — options=${JSON.stringify(parsed.options)}`);
            assert(true, 'finalText ends with a ```options block that parseQuickReplies accepts');
        } else {
            assert(false, 'neither a contractor_schedule get_jobs call (hp_ id) nor a parseable ```options block');
        }

        const finalText = String(assistant.content ?? '');
        assert(finalText.trim().length > 0, 'finalText is non-empty');
        console.log('  ── finalText verbatim ──────────────────────────────');
        console.log(finalText.split('\n').map((l) => `  | ${l}`).join('\n'));
        console.log('  ────────────────────────────────────────────────────');

        const sendShaped = toolCalls.filter((c) => SEND_SHAPED.has(String(c.tool)));
        assert(sendShaped.length === 0, `NO send-shaped/write tool in transcript (found: ${sendShaped.map((c) => c.tool).join(', ') || 'none'})`);

        // Window checks — informational unless the transcript also shows a
        // send-shaped tool (live traffic can write rows independently).
        const newMsgs = await db.execute(sql`
            SELECT id, conversation_id FROM messages WHERE created_at > ${testStart}
        `);
        const newDrafts = await db.execute(sql`
            SELECT id, phone, source FROM message_drafts WHERE created_at > ${testStart}
        `);
        assert(newMsgs.rows.length === 0 || sendShaped.length === 0,
            `no customer message attributable to this run (messages in window: ${newMsgs.rows.length}, drafts: ${newDrafts.rows.length})`);
        if (newMsgs.rows.length > 0) console.warn('  ⚠ messages rows created during window (likely ambient live traffic):', JSON.stringify(newMsgs.rows));
        if (newDrafts.rows.length > 0) console.warn('  ⚠ message_drafts rows created during window:', JSON.stringify(newDrafts.rows));
    } finally {
        // ── PHASE 3: cleanup ────────────────────────────────────────────────
        console.log('\n=== PHASE 3: cleanup ===');
        try {
            if (sessionId) {
                const archived = await api('POST', `/api/ops/sessions/${sessionId}/archive`);
                assert(archived.status === 200 && archived.json?.status === 'archived', `ops session ${sessionId} archived (got ${archived.status})`);
                const msgs = await db.execute(sql`SELECT id FROM ops_messages WHERE session_id = ${sessionId}`);
                console.log(`  archived ops session ${sessionId}; ops_messages left archived: ${msgs.rows.map((r: any) => r.id).join(', ')}`);
            }
            const deleted = await db.execute(sql`
                DELETE FROM contractor_sessions WHERE session_token = ${token} RETURNING session_token
            `);
            assert(deleted.rows.length === 1, 'temp contractor_sessions row deleted by session_token');
            const remaining = await db.execute(sql`
                SELECT count(*)::int AS n FROM contractor_sessions WHERE session_token = ${token}
            `);
            assert((remaining.rows[0] as any).n === 0, 'zero temp session rows remain');
        } catch (error: any) {
            failures++;
            console.error(`  ✗ CLEANUP FAILED: ${error?.message} — delete contractor_sessions row with token prefix smoke_e_ by hand`);
        }
    }

    console.log(failures === 0 ? '\nALL ASSERTIONS PASSED' : `\n${failures} ASSERTION(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error('Smoke test crashed:', error);
    process.exit(1);
});
