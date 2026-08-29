/**
 * Proves the live run-event stream (Brief B) end to end at the bus level:
 *
 *   runCommsAgent() → runner onEvent → emitCommsEvent → onCommsEvent subscriber
 *
 *   npx tsx scripts/_test-live-run-events.ts
 *
 * TEST NUMBER ONLY (Ofcom reserved drama range, no real subscriber). Nothing can reach a
 * customer or a phone: COMMS_CONFIG_OVERRIDE forces autosend, first-contact ack, quote-prep
 * and VA call tasks OFF for this process, and PUSHOVER_APP_TOKEN is deleted so every push
 * silently skips. The run costs one real Claude call; everything it writes is deleted after.
 *
 * Checks:
 *   1) exactly one run_started, then ≥1 run_event, then exactly one run_finished (ok: true)
 *   2) every event carries the same runId and the conversation's id
 *   3) ordering: run_started first, run_finished last
 *   4) the first tool_call streamed is get_thread (the standing orders demand it)
 *   5) lean payloads: no string anywhere in a run_event exceeds 520 chars
 */
import 'dotenv/config';
import crypto from 'crypto';
import { db } from '../server/db';
import { conversations, messages, messageDrafts, agentQuestions, agentOutcomes, nudgeQueue } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import { onCommsEvent, type CommsEvent } from '../server/comms-events';

const PHONE_E164 = '+447700900940';
const PHONE_WA = '447700900940@c.us';

function pass(ok: boolean, s: string) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${s}`); if (!ok) process.exitCode = 1; }

/** Longest string anywhere inside a JSON-ish value. */
function maxStringLen(v: unknown): number {
    if (typeof v === 'string') return v.length;
    if (Array.isArray(v)) return v.reduce((m, x) => Math.max(m, maxStringLen(x)), 0);
    if (v && typeof v === 'object') return Object.values(v).reduce((m, x) => Math.max(m, maxStringLen(x)), 0);
    return 0;
}

async function cleanup(convId: string | null) {
    if (convId) {
        await db.delete(messages).where(eq(messages.conversationId, convId));
        await db.delete(agentQuestions).where(eq(agentQuestions.conversationId, convId));
        await db.delete(agentOutcomes).where(eq(agentOutcomes.conversationId, convId));
        await db.delete(conversations).where(eq(conversations.id, convId));
    }
    await db.delete(messageDrafts).where(eq(messageDrafts.phone, PHONE_E164));
    await db.delete(nudgeQueue).where(eq(nudgeQueue.phone, PHONE_E164));
    await db.delete(conversations).where(eq(conversations.phoneNumber, PHONE_WA));
}

async function main() {
    // Process-local isolation: nothing sends, nothing pushes, nothing hands off.
    delete process.env.PUSHOVER_APP_TOKEN;
    process.env.COMMS_CONFIG_OVERRIDE = JSON.stringify({
        enabled: false,          // master switch off — a direct call still runs
        onInbound: false,
        autosend: { enabled: false },
        firstContactAutoAck: { enabled: false },
        quotePrep: { enabled: false },
        vaCallTask: { enabled: false },
    });

    // Neon cold-start warm-up (same pattern as the other _test scripts).
    for (let attempt = 1; ; attempt++) {
        try { await db.execute(sql`select 1`); break; }
        catch (e: any) {
            if (attempt >= 5) throw e;
            console.log(`DB warm-up attempt ${attempt} failed (${e?.message ?? e}), retrying...`);
            await new Promise((r) => setTimeout(r, 2000));
        }
    }

    let convId: string | null = null;
    const received: CommsEvent[] = [];
    const unsubscribe = onCommsEvent((evt) => {
        if ('conversationId' in evt && evt.conversationId === convId) received.push(evt);
    });

    try {
        await cleanup(null);

        convId = crypto.randomUUID();
        await db.insert(conversations).values({
            id: convId,
            phoneNumber: PHONE_WA,
            contactName: 'Live Run Events Test',
            stage: 'new',
            lastMessageAt: new Date(),
            lastCustomerContactAt: new Date(),
        });
        await db.insert(messages).values({
            id: `msg_liverun_${crypto.randomBytes(6).toString('hex')}`,
            conversationId: convId,
            direction: 'inbound',
            channel: 'whatsapp',
            content: 'Hi, do you fit bathroom extractor fans? Just checking that is something you cover before I send photos.',
            status: 'received',
            senderName: 'Live Run Events Test',
            createdAt: new Date(),
        });

        // Import AFTER the env overrides are set (module init order does not matter here, but
        // config reads happen inside the run anyway).
        const { runCommsAgent } = await import('../server/agents/comms');
        console.log('Running runCommsAgent against the test conversation…');
        const outcome = await runCommsAgent(convId, 'live_run_events_test');
        console.log(`Run done: ${outcome.result.turns} turns, ${outcome.actions.length} actions, autosent=${outcome.autosent}`);

        const started = received.filter((e) => e.type === 'run_started');
        const runEvents = received.filter((e): e is Extract<CommsEvent, { type: 'run_event' }> => e.type === 'run_event');
        const finished = received.filter((e): e is Extract<CommsEvent, { type: 'run_finished' }> => e.type === 'run_finished');
        // Agent A's emit-points (board_delta from set_board_state etc.) legitimately interleave
        // on the same bus — the run_* checks below must only look at run_* events.
        const runScoped = received.filter((e) => e.type === 'run_started' || e.type === 'run_event' || e.type === 'run_finished');

        console.log(`\nBus events received for this conversation: ${received.length}`);
        for (const e of received) {
            const inner: any = (e as any).event;
            console.log(`  ${e.type}${inner ? `  ${inner.type ?? '?'}${inner.tool ? `:${inner.tool}` : ''}` : ''}${(e as any).ok !== undefined ? `  ok=${(e as any).ok}` : ''}`);
        }

        pass(started.length === 1, `exactly one run_started (got ${started.length})`);
        pass(runEvents.length >= 1, `at least one run_event (got ${runEvents.length})`);
        pass(finished.length === 1 && finished[0].ok === true, `exactly one run_finished with ok=true`);

        const runId = started[0] && 'runId' in started[0] ? (started[0] as any).runId : null;
        pass(!!runId && runScoped.every((e: any) => e.runId === runId), 'all run_* events share one runId');
        pass(received.every((e: any) => e.conversationId === convId), 'all events carry the conversation id');
        pass(runScoped[0]?.type === 'run_started' && runScoped[runScoped.length - 1]?.type === 'run_finished',
            'ordering: run_started first, run_finished last');

        const firstToolCall = runEvents.map((e) => e.event as any).find((ev) => ev?.type === 'tool_call');
        pass(firstToolCall?.tool === 'get_thread', `first streamed tool_call is get_thread (got ${firstToolCall?.tool})`);

        const worstLen = runEvents.reduce((m, e) => Math.max(m, maxStringLen(e.event)), 0);
        pass(worstLen <= 520, `lean payloads: longest string in any run_event is ${worstLen} chars (≤ 520)`);

        const drafts = await db.select().from(messageDrafts).where(eq(messageDrafts.phone, PHONE_E164));
        console.log(`\nDrafts left behind (deleted next): ${drafts.map((d) => `${d.id}:${d.status}`).join(', ') || 'none'}`);
        pass(drafts.every((d) => d.status !== 'sent' && d.status !== 'approved'), 'nothing was sent (autosend forced off)');
    } finally {
        unsubscribe();
        delete process.env.COMMS_CONFIG_OVERRIDE;
        if (!process.argv.includes('--keep')) {
            await cleanup(convId);
            console.log('Test rows removed (Ofcom drama number only). Pass --keep to inspect.');
        }
    }
    process.exit(process.exitCode ?? 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
