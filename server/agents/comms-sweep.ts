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
/** A thread the sweep already ran recently is left alone this long. */
const MIN_MINUTES_BETWEEN_RUNS = 20;
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

        const lastSweep = (c.metadata as any)?.lastAutoTriageAt;
        if (lastSweep && now - new Date(lastSweep).getTime() < MIN_MINUTES_BETWEEN_RUNS * 60_000) continue;

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

let started = false;

/** Idempotent; called once from server boot. The first pass runs shortly after start, so a deploy
 *  that killed someone's debounce timer costs them minutes, not a night. */
export function startCommsInboundSweep(): void {
    if (started) return;
    started = true;
    const tick = () => sweepOnce().catch((e) => console.error('[CommsSweep] pass failed:', e?.message ?? e));
    setTimeout(tick, BOOT_DELAY_MS);
    setInterval(tick, SWEEP_EVERY_MS).unref?.();
    console.log(`[CommsSweep] Started: boot catch-up in ${BOOT_DELAY_MS / 1000}s, then every ${SWEEP_EVERY_MS / 60_000} min, 24/7 (the hours gate holds sends, not thinking).`);
}
