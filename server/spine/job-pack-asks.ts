/**
 * P13 part 2 — the rules layer's job-pack asks after the deposit.
 *
 * Delivery-critical fields (how we get in, who is on site, parking, pets, prep, delivery slot)
 * are asked AFTER the deposit so they never cost a sale: one question per message, fixed wording
 * per field (no price, no date), in a fixed order, at most one per thread per day, only in
 * proactive hours, stopping when nothing is missing. Non-UK numbers are never asked (acknowledge
 * only, as everywhere). Every send goes through the rules layer's own pipe (window / approved
 * template / SMS, else Ben's queue with the reason) under approver `rules.job_pack`.
 *
 * Runs from the worker's slow sweep (server/agents/comms-sweep.ts). The decision is pure
 * (`nextAskFor`); the sweep does the reads.
 */
import { DELIVERY_FIELDS_IN_ASK_ORDER, type DeliveryField, type JobPack } from './job-pack';
import { newRunId } from '../approver';

/** Fixed wording per field. House voice: short, no dashes, one question, no price, no date. */
export const JOB_PACK_ASK_COPY: Record<DeliveryField, string> = {
    'job.accessMethod': 'Quick one before the day: how will we get in? Will someone be home, or is there a key safe or a neighbour with a key?',
    'job.onSiteContact': 'Who should our handyman ask for on the day, and is the best number for them this one?',
    'job.parkingDistance': 'Where is best to park? On the drive, on the street outside, or a short walk away?',
    'job.pets': 'Any pets we should know about so we keep doors shut and everyone happy?',
    'job.prep': 'Is there anything you will clear or move before we arrive, so we can plan the day?',
    'job.deliverySlot': 'When is best for materials to be delivered, and is there somewhere safe to leave them?',
};

export const ASK_COOLDOWN_MS = 24 * 3600_000;
/** Proactive hours, UK time (same as the rules follow-up pack). */
export const ASK_FROM_HOUR = 8;
export const ASK_TO_HOUR = 20;

export function ukHour(at: Date): number {
    const h = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }).format(at);
    return Number(h) % 24;
}

export function inAskHours(at: Date): boolean {
    const h = ukHour(at);
    return h >= ASK_FROM_HOUR && h < ASK_TO_HOUR;
}

export interface NextAskInput {
    pack: Pick<JobPack, 'missing'>;
    lastAsk: { field: string; at: Date } | null;
    /** The customer's number, E.164; a non-UK number is never asked. */
    phone: string | null;
    ukNumber: boolean;
    now: Date;
}
export type NextAsk = { field: DeliveryField; body: string } | { field: null; reason: string };

/** Pure: the next question, or why not. */
export function nextAskFor(input: NextAskInput): NextAsk {
    const missing = DELIVERY_FIELDS_IN_ASK_ORDER.filter((f) => input.pack.missing.includes(f));
    if (!missing.length) return { field: null, reason: 'nothing missing' };
    if (!input.phone) return { field: null, reason: 'no phone' };
    if (!input.ukNumber) return { field: null, reason: 'non-UK number: acknowledge only' };
    if (!inAskHours(input.now)) return { field: null, reason: `outside ${ASK_FROM_HOUR}–${ASK_TO_HOUR} UK` };
    if (input.lastAsk && input.now.getTime() - input.lastAsk.at.getTime() < ASK_COOLDOWN_MS) {
        return { field: null, reason: `asked ${input.lastAsk.field} ${Math.round((input.now.getTime() - input.lastAsk.at.getTime()) / 60_000)} min ago; one a day` };
    }
    // Never the same field twice in a row while it is still missing: the customer did not answer,
    // move on and come back to it after the others.
    const next = missing.find((f) => f !== input.lastAsk?.field) ?? missing[0];
    return { field: next, body: JOB_PACK_ASK_COPY[next] };
}

export interface AskSweepDeps {
    /** Packs on deposit-paid quotes with a delivery field still missing (the reads). */
    candidates: (limit: number) => Promise<Array<{ pack: JobPack; conversationId: string; phone: string | null }>>;
    lastAsk: (conversationId: string) => Promise<{ field: string; at: Date } | null>;
    send: (conversationId: string, field: string, body: string, runId: string) => Promise<{ sent: boolean; reason: string; draftId?: string | null }>;
    isUk: (phone: string | null) => boolean;
    log: (e: { kind: 'send' | 'hold' | 'sweep'; summary: string; detail?: Record<string, unknown>; conversationId?: string | null; source: string }) => Promise<void>;
    newRunId: () => string;
    now: () => Date;
}

export interface AskSweepResult { checked: number; asked: Array<{ conversationId: string; field: string; sent: boolean; reason: string }>; skipped: Array<{ conversationId: string; reason: string }> }

/** The sweep, with deps: one pass over the candidates, one question each at most. Never throws. */
export async function sweepJobPackAsks(deps: AskSweepDeps, limit = 10): Promise<AskSweepResult> {
    const out: AskSweepResult = { checked: 0, asked: [], skipped: [] };
    let rows: Array<{ pack: JobPack; conversationId: string; phone: string | null }> = [];
    try { rows = await deps.candidates(limit); } catch (e: any) { await deps.log({ kind: 'sweep', summary: `job pack asks: candidates failed: ${e?.message ?? e}`, source: 'job-pack-asks' }).catch(() => undefined); return out; }
    for (const r of rows) {
        out.checked++;
        try {
            const lastAsk = await deps.lastAsk(r.conversationId);
            const next = nextAskFor({ pack: r.pack, lastAsk, phone: r.phone, ukNumber: deps.isUk(r.phone), now: deps.now() });
            if (!next.field) { out.skipped.push({ conversationId: r.conversationId, reason: next.reason }); continue; }
            const res = await deps.send(r.conversationId, next.field, next.body, deps.newRunId());
            out.asked.push({ conversationId: r.conversationId, field: next.field, sent: res.sent, reason: res.reason });
            await deps.log({ kind: res.sent ? 'send' : 'hold', conversationId: r.conversationId, source: 'job-pack-asks', summary: `job pack ask ${next.field}: ${res.reason}`, detail: { field: next.field, quoteId: r.pack.quoteId, draftId: res.draftId ?? null, missing: r.pack.missing } }).catch(() => undefined);
        } catch (e: any) {
            out.skipped.push({ conversationId: r.conversationId, reason: `error: ${e?.message ?? e}` });
        }
    }
    return out;
}

/** Live deps: the reads against the database, the rules layer for the send. */
export async function liveAskDeps(): Promise<AskSweepDeps> {
    return {
        candidates: async (limit) => {
            const { db } = await import('../db');
            const { sql } = await import('drizzle-orm');
            const { packFromRow } = await import('./job-pack');
            // Deposit paid, a pack with a delivery field still missing, a thread to ask on.
            const r: any = await db.execute(sql`
                select to_jsonb(p) as pack, c.id as conversation_id, c.phone_number as phone_number
                from job_packs p
                join personalized_quotes q on q.id = p.quote_id
                left join conversations c on c.id = p.conversation_id
                where q.deposit_paid_at is not null
                  and q.revoked_at is null
                  and c.id is not null
                  and c.archived_at is null
                  and p.missing && array['job.accessMethod','job.onSiteContact','job.parkingDistance','job.pets','job.prep','job.deliverySlot']::text[]
                order by q.deposit_paid_at asc
                limit ${limit}`);
            const rows: any[] = Array.isArray(r) ? r : (r?.rows ?? []);
            return rows.map((row) => {
                const digits = String(row.phone_number ?? '').replace('@c.us', '').replace(/\D/g, '');
                return { pack: packFromRow(row.pack), conversationId: String(row.conversation_id), phone: digits ? `+${digits}` : null };
            });
        },
        lastAsk: async (conversationId) => (await import('../rules-layer')).lastJobPackAsk(conversationId),
        send: async (conversationId, field, body, runId) => (await import('../rules-layer')).sendJobPackAsk(conversationId, field, body, runId),
        isUk: (phone) => !!phone && /^\+44\d{10}$/.test(phone),
        log: async (e) => { const { logSystemEvent } = await import('../system-events'); await logSystemEvent({ ...e, kind: e.kind === 'sweep' ? 'other' : e.kind } as any); },
        newRunId: () => newRunId('ask'),
        now: () => new Date(),
    };
}

/** The slow sweep's entry: worker-only caller, never throws, table absent = quiet. */
export async function runJobPackAskSweep(): Promise<AskSweepResult | null> {
    try {
        const deps = await liveAskDeps();
        return await sweepJobPackAsks(deps);
    } catch (error: any) {
        const { isMissingTable } = await import('./job-pack');
        if (!isMissingTable(error)) console.warn('[JobPackAsks] sweep failed:', error?.message ?? error);
        return null;
    }
}
