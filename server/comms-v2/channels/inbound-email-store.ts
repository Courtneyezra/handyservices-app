/**
 * Inbound email, kept until the desk has it (the captain's "Separate safeguard", 16 Sep 2026).
 *
 * The webhook (email-inbound.ts) writes each accepted email here, keyed by Resend's email id, and
 * answers Resend only once the row is written; a write that fails is answered with an error, so
 * Resend delivers again. Then each row is handed to the desk until the desk has it:
 *
 *   store    one row per email id, whatever state it is in, so a redelivery adds nothing
 *   attempt  takes the row for one hand-over (`claim`: pending, due, and not held by another
 *            attempt, counted as it is taken), hands the envelope to the intake and waits for it
 *   handed   the intake returned, the desk has handled the turn, and the case file store has
 *            written that file: the row is done
 *   retry    the hand-over threw: the row is due again after the next of `RETRY_DELAYS_MS`, and
 *            after `MAX_ATTEMPTS` it is kept as failed, logged at error level and paged to Ben the
 *            way the worker alarm pages (production only). Nothing is ever deleted here.
 *
 * The first attempt runs as soon as the route has answered. Later ones run from the comms worker's
 * minute loop (server/cron.ts, `runInboundEmailRetryTick` in email-inbound.ts), and only while
 * inbound email is switched on; a restart picks up where the rows say. An attempt's hold on its row
 * lasts `CLAIM_MS`, so two attempts never hand the same row over at once, in one process or two.
 *
 * The hand-over carries the email's delivery id (`deliveryIdOf`), and the gateway never lands a
 * second turn with a delivery id a file already holds (channel-gateway.ts). The next attempt after
 * one that landed the turn and then failed, or died before marking the row, adds no second turn: it
 * runs the desk on that turn again only while no reply answers it and no desk run recorded a result
 * on it (`Turn.handledBy`; a hold or a deliberate no-reply is a result), so a desk run that threw is
 * run again and one that finished is not.
 *
 * The rows live where the intake's case files live: the database the switches give now
 * (live-database.ts), so the sandbox writes only the branch. No log line carries a value from an
 * email, only Resend's email id.
 */
import { randomUUID } from 'node:crypto';
import type { InboundEnvelope } from './envelope';
import { commsV2Db, type DatabasePurpose } from '../live-database';

/** The wait after each failed attempt, in order. */
export const RETRY_DELAYS_MS: readonly number[] = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000, 2 * 60 * 60_000, 4 * 60 * 60_000];
/** The first attempt and one after each wait: about eight hours from the first to the last. */
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
/** How long one attempt holds its row. A desk run takes well under this. */
export const CLAIM_MS = 10 * 60_000;
/** The most rows one retry pass takes. */
export const RETRY_BATCH = 20;
const ERROR_MAX = 500;

/** The id the gateway records on the email's turn, so the same email never lands twice. */
export function deliveryIdOf(emailId: string): string {
    return `resend:${emailId}`;
}

/** A row taken for one attempt: `attempts` counts this one. */
export interface ClaimedEmail { emailId: string; envelope: InboundEnvelope; attempts: number }

/** The table under the store. */
export interface InboundEmailRows {
    /** Writes the email once; false when a row for the id is already there, in any state. */
    insert(emailId: string, envelope: InboundEnvelope, now: Date): Promise<boolean>;
    has(emailId: string): Promise<boolean>;
    /** Takes the row when it is pending, due and not held, counting the attempt; null otherwise. */
    claim(emailId: string, claimId: string, now: Date, until: Date): Promise<ClaimedEmail | null>;
    /** Pending rows due now and not held, soonest first. */
    due(now: Date, limit: number): Promise<string[]>;
    /** The desk has it. Only the attempt that holds the row writes. */
    handed(emailId: string, claimId: string, now: Date): Promise<void>;
    /** The attempt failed: pending again at `next`, or failed for good when `next` is null. */
    release(emailId: string, claimId: string, error: string, next: Date | null, now: Date): Promise<void>;
}

interface MemoryRow { envelope: InboundEnvelope; status: 'pending' | 'done' | 'failed'; attempts: number; nextAttemptAt: number; claimId: string | null; claimedUntil: number | null; lastError: string | null; handedAt: number | null }

/** The rows in memory, for tests. */
export class MemoryInboundEmailRows implements InboundEmailRows {
    readonly rows = new Map<string, MemoryRow>();
    async insert(emailId: string, envelope: InboundEnvelope, now: Date): Promise<boolean> {
        if (this.rows.has(emailId)) return false;
        this.rows.set(emailId, { envelope: JSON.parse(JSON.stringify(envelope)), status: 'pending', attempts: 0, nextAttemptAt: now.getTime(), claimId: null, claimedUntil: null, lastError: null, handedAt: null });
        return true;
    }
    async has(emailId: string): Promise<boolean> { return this.rows.has(emailId); }
    private takeable(r: MemoryRow, now: number): boolean {
        return r.status === 'pending' && r.nextAttemptAt <= now && (r.claimedUntil === null || r.claimedUntil <= now);
    }
    async claim(emailId: string, claimId: string, now: Date, until: Date): Promise<ClaimedEmail | null> {
        const r = this.rows.get(emailId);
        if (!r || !this.takeable(r, now.getTime())) return null;
        r.attempts++;
        r.claimId = claimId;
        r.claimedUntil = until.getTime();
        return { emailId, envelope: JSON.parse(JSON.stringify(r.envelope)), attempts: r.attempts };
    }
    async due(now: Date, limit: number): Promise<string[]> {
        return Array.from(this.rows.entries()).filter(([, r]) => this.takeable(r, now.getTime())).sort((a, b) => a[1].nextAttemptAt - b[1].nextAttemptAt).slice(0, limit).map(([id]) => id);
    }
    async handed(emailId: string, claimId: string, now: Date): Promise<void> {
        const r = this.rows.get(emailId);
        if (!r || r.claimId !== claimId) return;
        Object.assign(r, { status: 'done', handedAt: now.getTime(), claimId: null, claimedUntil: null, lastError: null });
    }
    async release(emailId: string, claimId: string, error: string, next: Date | null, now: Date): Promise<void> {
        const r = this.rows.get(emailId);
        if (!r || r.claimId !== claimId) return;
        Object.assign(r, { status: next ? 'pending' : 'failed', nextAttemptAt: (next ?? now).getTime(), lastError: error, claimId: null, claimedUntil: null });
    }
}

/** Who the database refusal names when this store asked (live-database.ts). */
const READER = 'the inbound email store';

/** The `comms_v2_inbound_emails` table, for a purpose. Every call asks again before it opens a connection. */
export const inboundEmailRowsFor = (purpose: DatabasePurpose): InboundEmailRows => {
    const open = async () => {
        const db = await commsV2Db(READER, purpose);
        const { commsV2InboundEmails: t } = await import('@shared/schema');
        const orm = await import('drizzle-orm');
        return { db, t, ...orm };
    };
    return {
        async insert(emailId, envelope, now) {
            const { db, t } = await open();
            const rows = await db.insert(t).values({ emailId, envelope, status: 'pending', attempts: 0, nextAttemptAt: now, receivedAt: now, updatedAt: now }).onConflictDoNothing({ target: t.emailId }).returning({ emailId: t.emailId });
            return rows.length > 0;
        },
        async has(emailId) {
            const { db, t, eq } = await open();
            const rows = await db.select({ emailId: t.emailId }).from(t).where(eq(t.emailId, emailId)).limit(1);
            return rows.length > 0;
        },
        async claim(emailId, claimId, now, until) {
            const { db, t, and, eq, lte, or, isNull, sql } = await open();
            const rows = await db.update(t)
                .set({ attempts: sql`${t.attempts} + 1`, claimId, claimedUntil: until, updatedAt: now })
                .where(and(eq(t.emailId, emailId), eq(t.status, 'pending'), lte(t.nextAttemptAt, now), or(isNull(t.claimedUntil), lte(t.claimedUntil, now))))
                .returning({ emailId: t.emailId, envelope: t.envelope, attempts: t.attempts });
            const row = rows[0];
            return row ? { emailId: row.emailId, envelope: row.envelope as InboundEnvelope, attempts: row.attempts } : null;
        },
        async due(now, limit) {
            const { db, t, and, eq, lte, or, isNull, asc } = await open();
            const rows = await db.select({ emailId: t.emailId }).from(t)
                .where(and(eq(t.status, 'pending'), lte(t.nextAttemptAt, now), or(isNull(t.claimedUntil), lte(t.claimedUntil, now))))
                .orderBy(asc(t.nextAttemptAt)).limit(limit);
            return rows.map((r) => r.emailId);
        },
        async handed(emailId, claimId, now) {
            const { db, t, and, eq } = await open();
            await db.update(t).set({ status: 'done', handedAt: now, claimId: null, claimedUntil: null, lastError: null, updatedAt: now }).where(and(eq(t.emailId, emailId), eq(t.claimId, claimId)));
        },
        async release(emailId, claimId, error, next, now) {
            const { db, t, and, eq } = await open();
            await db.update(t).set({ status: next ? 'pending' : 'failed', nextAttemptAt: next ?? now, lastError: error, claimId: null, claimedUntil: null, updatedAt: now }).where(and(eq(t.emailId, emailId), eq(t.claimId, claimId)));
        },
    };
};

/** The rows for the purpose the switches give now, as the intake's gateway picks its own (intake.ts). */
async function rowsNow(): Promise<InboundEmailRows> {
    const { commsV2LiveState } = await import('../switch');
    const state = await commsV2LiveState();
    return inboundEmailRowsFor(state.live ? 'live' : 'sandbox');
}

/** The intake's hand-over, awaited: it throws when the desk did not take the email. */
async function intakeHandOver(emailId: string, envelope: InboundEnvelope): Promise<void> {
    const { forwardNow } = await import('./intake');
    await forwardNow({ kind: 'email_received', envelope, deliveryId: deliveryIdOf(emailId) });
}

async function pageBen(title: string, message: string): Promise<void> {
    const { notifyWorkerHealth } = await import('../../pushover');
    await notifyWorkerHealth({ title, message });
}

export interface InboundEmailQueueDeps {
    rows?: () => Promise<InboundEmailRows>;
    /** Hands one email to the desk and resolves once the desk has it; the default is the intake. */
    handOver?: (emailId: string, envelope: InboundEnvelope) => Promise<void>;
    now?: () => Date;
    newClaimId?: () => string;
    log?: { warn: (line: string) => void; error: (line: string) => void };
    notify?: (title: string, message: string) => Promise<void>;
    /** Whether an exhausted email pages; production only by default, as the worker alarm. */
    pageable?: boolean;
}

export type AttemptOutcome = 'handed' | 'retrying' | 'failed' | 'not_due';

export interface RetryPass { due: number; handed: number; retrying: number; failed: number; errors: number }

export interface InboundEmailQueue {
    has(emailId: string): Promise<boolean>;
    /** True when this call wrote the row, false when it was already there. Throws when it cannot write. */
    store(emailId: string, envelope: InboundEnvelope): Promise<boolean>;
    /** One hand-over of one row, when it is there to take. Throws only when the rows cannot be read or taken. */
    attempt(emailId: string): Promise<AttemptOutcome>;
    /** One attempt on each row due now. */
    retryDue(): Promise<RetryPass>;
}

export function inboundEmailQueue(deps: InboundEmailQueueDeps = {}): InboundEmailQueue {
    const rowsOf = deps.rows ?? rowsNow;
    const handOver = deps.handOver ?? intakeHandOver;
    const now = deps.now ?? (() => new Date());
    const newClaimId = deps.newClaimId ?? (() => randomUUID());
    const log = deps.log ?? { warn: (line: string) => console.warn(line), error: (line: string) => console.error(line) };
    const notify = deps.notify ?? pageBen;

    const exhausted = async (emailId: string, attempts: number, error: string) => {
        log.error(`[comms-v2 email] received email ${emailId} could not be handed to the desk after ${attempts} attempts; it is kept as failed in comms_v2_inbound_emails: ${error}`);
        const pageable = deps.pageable ?? (await import('../../worker-gate')).isProductionEnv();
        if (!pageable) return;
        await notify('Inbound email not handed to the desk', `Received email ${emailId} failed ${attempts} hand-overs to the comms desk and is kept as failed. docs/RUNBOOK.md, "Inbound email (Resend)", says how to hand it over again.`)
            .catch((err: any) => log.error(`[comms-v2 email] paging about received email ${emailId} failed: ${err?.message ?? err}`));
    };

    const attempt = async (emailId: string): Promise<AttemptOutcome> => {
        const rows = await rowsOf();
        const claimId = newClaimId();
        const at = now();
        const row = await rows.claim(emailId, claimId, at, new Date(at.getTime() + CLAIM_MS));
        if (!row) return 'not_due';
        try {
            await handOver(row.emailId, row.envelope);
        } catch (err: any) {
            const error = String(err?.message ?? err).slice(0, ERROR_MAX);
            const next = row.attempts < MAX_ATTEMPTS ? new Date(now().getTime() + RETRY_DELAYS_MS[row.attempts - 1]) : null;
            try {
                await rows.release(emailId, claimId, error, next, now());
            } catch (writeErr: any) {
                // The hold runs out and the row is taken again; the count already has this attempt.
                log.error(`[comms-v2 email] recording a failed hand-over of received email ${emailId} failed: ${writeErr?.message ?? writeErr}`);
            }
            if (!next) {
                await exhausted(emailId, row.attempts, error);
                return 'failed';
            }
            log.warn(`[comms-v2 email] handing received email ${emailId} to the desk failed (attempt ${row.attempts} of ${MAX_ATTEMPTS}); next attempt at ${next.toISOString()}: ${error}`);
            return 'retrying';
        }
        try {
            await rows.handed(emailId, claimId, now());
        } catch (err: any) {
            // The desk has the email; the next attempt finds its turn and marks the row without a second one.
            log.error(`[comms-v2 email] marking received email ${emailId} handed failed: ${err?.message ?? err}`);
        }
        return 'handed';
    };

    return {
        async has(emailId) { return (await rowsOf()).has(emailId); },
        async store(emailId, envelope) { return (await rowsOf()).insert(emailId, envelope, now()); },
        attempt,
        async retryDue() {
            const ids = await (await rowsOf()).due(now(), RETRY_BATCH);
            const pass: RetryPass = { due: ids.length, handed: 0, retrying: 0, failed: 0, errors: 0 };
            for (const id of ids) {
                try {
                    const out = await attempt(id);
                    if (out === 'handed') pass.handed++;
                    else if (out === 'retrying') pass.retrying++;
                    else if (out === 'failed') pass.failed++;
                } catch (err: any) {
                    pass.errors++;
                    log.error(`[comms-v2 email] retrying received email ${id} failed: ${err?.message ?? err}`);
                }
            }
            return pass;
        },
    };
}
