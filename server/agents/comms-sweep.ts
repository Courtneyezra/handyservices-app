/**
 * The comms agent's durable trigger — the one that survives deploys.
 *
 * Found live on 20 Aug 2026, during the first real end-to-end test: the on-inbound debounce is an
 * in-process setTimeout, a deploy swaps the process, and the "SLA sweep every 30 min" the staff
 * card promised was never actually scheduled anywhere — so a message that loses its timer is not
 * picked up by anything, ever. The owner sat watching WhatsApp while the agent brain, fully
 * working, was simply never asked to think.
 *
 * This sweep is DB-driven and runs 24/7: every few minutes it looks for live threads whose last
 * word was the customer's and runs the agent on them. It deliberately does NOT gate on UK hours —
 * the THINKING can happen at 5am; the hours gate inside direct send is what stops the SENDING,
 * by queueing the reply for the morning. Cost is bounded per-thread (metadata timestamp), the
 * fresh-burst window is left to the on-inbound timer, and test-range numbers are skipped.
 */
import { db } from '../db';
import { conversations, messages, messageDrafts } from '@shared/schema';
import { and, eq, gte, isNull, notInArray, sql } from 'drizzle-orm';

/** Don't race the on-inbound debounce: only pick up threads quiet at least this long. */
const MIN_QUIET_MINUTES = 3;
/** Loop guard only: a thread the sweep ran this recently is skipped even if the customer has
 *  spoken again, so a run that decides nothing cannot burn tokens on every pass. */
const MIN_MINUTES_BETWEEN_RUNS = 5;
/** Older than this is the backlog's business, not the live pipeline's. */
const MAX_AGE_HOURS = 48;
/** Threads per pass — the queue drains across passes, never in one expensive burst. */
const MAX_PER_PASS = 5;
const SWEEP_EVERY_MS = 5 * 60_000;
const BOOT_DELAY_MS = 30_000;

function isTestNumber(phone: string): boolean {
    return phone.replace(/\D/g, '').includes('7700900');
}

async function sweepOnce(): Promise<void> {
    const { getCommsAgentConfig, runCommsAgent } = await import('./comms');
    const config = await getCommsAgentConfig();
    if (!config.enabled) return;

    const now = Date.now();
    const oldest = new Date(now - MAX_AGE_HOURS * 3600_000);
    const newest = new Date(now - MIN_QUIET_MINUTES * 60_000);

    const candidates = await db.select({
        id: conversations.id,
        phoneNumber: conversations.phoneNumber,
        lastCustomerContactAt: conversations.lastCustomerContactAt,
        lastMessageAt: conversations.lastMessageAt,
        metadata: conversations.metadata,
    }).from(conversations).where(and(
        isNull(conversations.archivedAt),
        notInArray(conversations.stage, ['closed', 'won']),
        gte(conversations.lastCustomerContactAt, oldest),
    )).limit(200);

    let ran = 0;
    for (const c of candidates) {
        if (ran >= MAX_PER_PASS) break;
        if (!c.lastCustomerContactAt || c.lastCustomerContactAt > newest) continue;
        if (isTestNumber(c.phoneNumber ?? '')) continue;

        // Skip only when the agent already ran AFTER the customer's latest word — a cooldown that
        // ignores new inbound silences a live conversation (found within the hour on 20 Aug: the
        // photo run stamped the thread, the postcode arrived four minutes later, and the flat
        // 20-minute window blocked every pass while the customer waited). The small floor below is
        // purely a loop guard for runs that decide nothing and would otherwise retry every pass.
        const lastSweep = (c.metadata as any)?.lastAutoTriageAt;
        if (lastSweep) {
            const sweepMs = new Date(lastSweep).getTime();
            const custMs = c.lastCustomerContactAt ? new Date(c.lastCustomerContactAt).getTime() : 0;
            if (sweepMs > custMs) continue;
            if (now - sweepMs < MIN_MINUTES_BETWEEN_RUNS * 60_000) continue;
        }

        // Only threads where the CUSTOMER had the last word. One indexed lookup per candidate that
        // got this far, which is a handful per pass, not the whole board.
        const [lastMsg] = await db.select({ direction: messages.direction })
            .from(messages).where(eq(messages.conversationId, c.id))
            .orderBy(sql`${messages.createdAt} DESC`).limit(1);
        if (!lastMsg || lastMsg.direction !== 'inbound') continue;

        // A pending draft means the agent already spoke and the reply is waiting on Ben or the
        // morning — running again would only write the same reply twice.
        const digits = (c.phoneNumber ?? '').replace(/\D/g, '');
        const [pending] = await db.select({ id: messageDrafts.id }).from(messageDrafts)
            .where(and(eq(messageDrafts.status, 'pending'),
                sql`regexp_replace(${messageDrafts.phone}, '[^0-9]', '', 'g') = ${digits}`))
            .limit(1);
        if (pending) continue;

        // Stamp BEFORE running: a run that crashes must not become a run that retries forever.
        await db.update(conversations).set({
            metadata: sql`coalesce(${conversations.metadata}, '{}'::jsonb) || jsonb_build_object('lastAutoTriageAt', ${new Date().toISOString()}::text)`,
        }).where(eq(conversations.id, c.id));

        ran++;
        console.log(`[CommsSweep] Unanswered inbound on ${c.id} — running the agent (durable trigger).`);
        try {
            const outcome = await runCommsAgent(c.id, 'sla_sweep');
            console.log(`[CommsSweep] ${c.id}: ${outcome.actions.map((a) => a.tool).join(', ') || 'no actions'}${outcome.autosent ? ' (sent direct)' : ''}`);
        } catch (error: any) {
            console.error(`[CommsSweep] Run failed for ${c.id}:`, error?.message);
        }
    }
}

/**
 * The FAST ticker: acts on the DB-scheduled debounce that comms-lanes.arm() writes. Every 30s it
 * claims conversations whose nextTriageAt has fallen due and runs the agent on them, so on-inbound
 * latency is debounce + ≤30s and a deploy costs at most one tick. The claim clears the field
 * first, matched on its exact value, so a message arriving mid-claim re-arms cleanly and a run
 * that crashes cannot retry every 30 seconds forever (the slow sweep remains the backstop).
 */
async function tickDueTriage(): Promise<void> {
    const { getCommsAgentConfig, runCommsAgent } = await import('./comms');
    const config = await getCommsAgentConfig();
    if (!config.enabled || !config.onInbound) return;

    const due: any = await db.execute(sql`
        SELECT id, metadata->>'nextTriageAt' AS due_at FROM conversations
        WHERE archived_at IS NULL AND metadata->>'nextTriageAt' <= ${new Date().toISOString()}
        LIMIT 3`);
    for (const row of ((due.rows ?? due) as { id: string; due_at: string }[])) {
        // The claim is a LEASE, not a delete. The first version removed the row before running,
        // so a process death mid-run (a deploy swap, 20 Aug 08:07, first message of the retest)
        // consumed the claim and orphaned the message with only the slow sweep left to notice.
        // Pushing the due time out instead means a successful run clears it below, and a dead
        // run's lease simply expires and the ticker tries again four minutes later.
        const lease = new Date(Date.now() + 4 * 60_000).toISOString();
        const claimed: any = await db.execute(sql`
            UPDATE conversations
            SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('nextTriageAt', ${lease}::text)
            WHERE id = ${row.id} AND metadata->>'nextTriageAt' = ${row.due_at}
            RETURNING id`);
        if (!((claimed.rows ?? claimed).length)) continue; // re-armed by a newer message — not due yet
        console.log(`[CommsSweep] On-inbound triage due for ${row.id} — running (lease ${lease}).`);
        try {
            const outcome = await runCommsAgent(row.id, 'inbound_message');
            console.log(`[CommsSweep] ${row.id}: ${outcome.actions.map((a) => a.tool).join(', ') || 'no actions'}${outcome.autosent ? ' (sent direct)' : ''}`);
            // Success: release the lease, unless a newer inbound re-armed it mid-run.
            await db.execute(sql`
                UPDATE conversations SET metadata = metadata - 'nextTriageAt'
                WHERE id = ${row.id} AND metadata->>'nextTriageAt' = ${lease}`);
        } catch (error: any) {
            console.error(`[CommsSweep] On-inbound run failed for ${row.id} (lease stands, will retry):`, error?.message);
        }
    }
}

/**
 * MORNING RELEASE. A draft held overnight ONLY for the hour (guards passed, no money — tagged
 * [morning_release] at queue time) is a delayed send, not a review item: nobody chose to hold it,
 * the clock did. From 08:00 UK this releases them by itself. The one care taken: if the customer
 * wrote again while it waited, the reply is stale by definition — it is rejected and the agent
 * re-runs on the fresher thread instead of sending last night's words into this morning's context.
 */
async function releaseMorningHolds(): Promise<void> {
    const ukHour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Europe/London' }).format(new Date()));
    if (ukHour < 8 || ukHour >= 20) return;
    const { getCommsAgentConfig } = await import('./comms');
    const config = await getCommsAgentConfig();
    if (!config.autosend.enabled) return; // kill switch off = everything really does wait for a human

    const held = await db.select().from(messageDrafts)
        .where(and(
            eq(messageDrafts.status, 'pending'),
            eq(messageDrafts.source, 'comms_agent'),
            sql`${messageDrafts.reason} LIKE '%[morning_release]%'`,
        )).limit(5);

    for (const d of held) {
        if (d.conversationId) {
            const [newer] = await db.select({ id: messages.id }).from(messages)
                .where(and(
                    eq(messages.conversationId, d.conversationId),
                    eq(messages.direction, 'inbound'),
                    sql`${messages.createdAt} > ${d.createdAt.toISOString()}::timestamptz`,
                )).limit(1);
            if (newer) {
                await db.update(messageDrafts)
                    .set({ status: 'rejected', approvedBy: 'hours_gate:stale_by_morning', approvedAt: new Date() })
                    .where(and(eq(messageDrafts.id, d.id), eq(messageDrafts.status, 'pending')));
                await db.update(conversations).set({
                    metadata: sql`coalesce(${conversations.metadata}, '{}'::jsonb) || jsonb_build_object('nextTriageAt', ${new Date().toISOString()}::text)`,
                }).where(eq(conversations.id, d.conversationId));
                console.log(`[CommsSweep] Morning release: ${d.id} went stale overnight — rejected, agent re-running on the fresh thread.`);
                continue;
            }
        }
        const { approveAndSendDraft } = await import('../message-drafts');
        console.log(`[CommsSweep] Morning release: sending ${d.id} (held overnight for the hour, not for a human).`);
        try {
            await approveAndSendDraft(d.id, 'hours_gate:morning_release');
        } catch (error: any) {
            console.error(`[CommsSweep] Morning release failed for ${d.id}:`, error?.message);
        }
    }
}

/**
 * CALLBACK FALLBACK. A thread tagged callback_due is parked on Ben's desk because the classifier
 * heard a promised (or interrupted) call — the human gets first right of the warm move, and an
 * outbound call clears the tag by itself (server/call-thread.ts). This pass is the guarantee
 * underneath that courtesy: when the callback never happens within callbackFallbackMinutes, the
 * consent-mapped video template goes out through the SAME rails as the live post-call send
 * (mobile only, dedupe, quiet hours, approval queue — sendCallbackFallbackForCall reuses them,
 * nothing is re-implemented here). Gated on the post_call_video_request master flag, so while
 * that ships disabled this pass decides nothing and sends nothing.
 */
async function fallbackOverdueCallbacks(): Promise<void> {
    const ukHour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Europe/London' }).format(new Date()));
    if (ukHour < 8 || ukHour >= 20) return;

    const { getOutreachConfig, callbackFallbackEligible, sendCallbackFallbackForCall } = await import('../post-call-outreach');
    const cfg = await getOutreachConfig();
    if (!cfg.enabled || !(cfg.callbackFallbackMinutes > 0)) return;

    const tagged = await db.select({
        id: conversations.id,
        phoneNumber: conversations.phoneNumber,
        tags: conversations.tags,
        metadata: conversations.metadata,
    }).from(conversations).where(and(
        isNull(conversations.archivedAt),
        sql`'callback_due' = ANY(${conversations.tags})`,
    )).limit(20);

    let acted = 0;
    for (const c of tagged) {
        if (acted >= 3) break; // the queue drains across passes, never in one burst
        const callbackDueAt = (c.metadata as any)?.callbackDueAt as string | undefined;
        if (!callbackFallbackEligible({ tags: c.tags, callbackDueAt, cfg, ukHour })) continue;

        acted++;
        try {
            // Re-read the stored verdict off the call that parked this thread: the newest
            // classified inbound call for the number. The consent mapping (as-discussed vs
            // generic) must reflect what was actually said, not a guess made hours later.
            const digits = (c.phoneNumber ?? '').replace('@c.us', '').replace(/\D/g, '');
            const [call] = await db.execute(sql`
                SELECT id FROM calls
                WHERE regexp_replace(phone_number, '[^0-9]', '', 'g') = ${digits}
                  AND classification IS NOT NULL
                  AND (direction IS NULL OR direction NOT LIKE 'out%')
                ORDER BY start_time DESC NULLS LAST
                LIMIT 1`).then((r: any) => (r.rows ?? r) as { id: string }[]);

            const decision = call
                ? await sendCallbackFallbackForCall(call.id)
                : { sent: false, reason: 'NO_CLASSIFIED_CALL' };

            // The debt is settled either way: the fallback fired and the rails had their say.
            // Leaving the tag on a refusal (a landline, an already-asked number) would retry the
            // same refusal every 15 seconds forever. A thrown error skips this, so a transient
            // failure retries next pass instead of silently swallowing the callback.
            await db.update(conversations).set({
                tags: (c.tags ?? []).filter((t) => t !== 'callback_due'),
                metadata: sql`coalesce(${conversations.metadata}, '{}'::jsonb) - 'callbackDueAt'`,
                updatedAt: new Date(),
            }).where(eq(conversations.id, c.id));
            console.log(`[CommsSweep] Callback fallback on ${c.id} (due ${callbackDueAt}): ${decision.reason} — callback_due cleared.`);
        } catch (error: any) {
            console.error(`[CommsSweep] Callback fallback failed for ${c.id} (tag stands, will retry):`, error?.message);
        }
    }
}

const TICK_EVERY_MS = 15_000;
let started = false;

/** Idempotent; called once from server boot. The first pass runs shortly after start, so a deploy
 *  that killed someone's debounce timer costs them minutes, not a night. */
export function startCommsInboundSweep(): void {
    if (started) return;
    started = true;
    const tick = () => sweepOnce().catch((e) => console.error('[CommsSweep] pass failed:', e?.message ?? e));
    setTimeout(tick, BOOT_DELAY_MS);
    setInterval(tick, SWEEP_EVERY_MS).unref?.();
    const fast = () => Promise.all([
        tickDueTriage().catch((e) => console.error('[CommsSweep] fast tick failed:', e?.message ?? e)),
        releaseMorningHolds().catch((e) => console.error('[CommsSweep] morning release failed:', e?.message ?? e)),
        fallbackOverdueCallbacks().catch((e) => console.error('[CommsSweep] callback fallback failed:', e?.message ?? e)),
    ]);
    setInterval(fast, TICK_EVERY_MS).unref?.();
    console.log(`[CommsSweep] Started: fast tick every ${TICK_EVERY_MS / 1000}s (DB-scheduled debounce), boot catch-up in ${BOOT_DELAY_MS / 1000}s, slow sweep every ${SWEEP_EVERY_MS / 60_000} min, 24/7.`);
}
