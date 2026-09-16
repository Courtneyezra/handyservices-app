/**
 * Can the desk answer? The desk's own model provider, read from the customer turns it actually ran.
 *
 * 16 Sep 2026: production's Anthropic key answered the router with a 400 ("Your credit balance is
 * too low…") at 05:41:16Z. The desk failed closed, as designed, with the fixed acknowledgement, and
 * nothing said so: the worker heartbeat was fresh, so /api/health/comms-worker read `ok`, and
 * vision-health (server/spine/vision-health.ts) watches Gemini, not the desk's own models.
 *
 * The verdict is structural, never a reading of the error text: a turn is FAILED when a model call
 * on it could not reach an answer from the provider (the client threw: an HTTP error of any status,
 * a revoked key, a spend cap, an outage, a timeout), or when the router or the composer, without
 * which the desk cannot write a reply, came back with nothing for a reason other than the model
 * declining. The provider's own error text is carried verbatim as the payload, so whoever reads the
 * page knows whether it is billing, auth or the provider. A turn is OK when its model calls
 * answered. A turn that made no model call (a thread already held on a fixed line) proves nothing
 * and leaves the verdict where it was.
 *
 * The verdict lives in one app_settings row, so any process can serve it and no health poll spends a
 * model call. What it proves: the newest customer turn that needed the model did, or did not, get
 * an answer from it. What it does not: that the provider works NOW. After a key is fixed the row
 * reads failing until the next customer turn succeeds; with no turns it says nothing new.
 *
 * The page rides the worker alarm's conventions (comms-worker-heartbeat.ts): the same Pushover key
 * (`worker_health`), one page for an episode then at most one an hour while turns keep failing, and
 * one "back" message on the first good turn after a page. Only a production process pages. It has
 * no UK daytime window: it can only fire when a customer has just written and been failed.
 *
 * The db is imported lazily so this module, and its tests, load without DATABASE_URL.
 */
import { appSettings } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import type { ModelCallRecord } from './case-file';
import type { ModelClient, StructuredCall, StructuredResult } from './models';

export const MODEL_HEALTH_KEY = 'comms_v2_model_health';
/** One page an episode, then at most one an hour while turns keep failing (STALE_ALERT_EVERY_MS). */
export const MODEL_ALERT_EVERY_MS = 60 * 60_000;

export interface ModelFailure {
    role: ModelCallRecord['role'];
    model: string;
    /** The provider's or the client's error, verbatim. */
    error: string;
    /** provider: no answer came back from the provider. output: an answer came back that was unusable. */
    kind: 'provider' | 'output';
}

/** What one customer turn says about the desk's models. */
export interface TurnModelOutcome {
    verdict: 'ok' | 'failed' | 'no_model_call';
    /** The failure that decided a failed turn, the first one on the turn. */
    failure: ModelFailure | null;
}

/**
 * A client for one turn: every call goes to `inner`, and the watcher remembers what came back.
 * One per turn, since the desk serves concurrent turns from one client.
 */
export class TurnModelWatch implements ModelClient {
    private answered = 0;
    private failures: ModelFailure[] = [];
    constructor(private readonly inner: ModelClient) {}

    async structured<T>(call: StructuredCall<T>): Promise<StructuredResult<T>> {
        const res = await this.inner.structured(call);
        if (res.output != null) this.answered++;
        else if (!res.refused && res.error) {
            const kind = res.failure ?? 'output';
            // A specialist's unusable answer is recorded on its own return and the turn goes on; the
            // router and the composer are the calls a reply cannot be written without.
            if (kind === 'provider' || call.role === 'router' || call.role === 'composer') {
                this.failures.push({ role: call.role, model: call.model, error: res.error, kind });
            }
        } else this.answered++;
        return res;
    }

    outcome(): TurnModelOutcome {
        if (this.failures.length) return { verdict: 'failed', failure: this.failures.find((f) => f.kind === 'provider') ?? this.failures[0] };
        return { verdict: this.answered ? 'ok' : 'no_model_call', failure: null };
    }
}

// ------------------------------------------------------------------ the row, pure

export interface ModelHealthRecord {
    state: 'ok' | 'failing';
    /** The newest turn that proved something. */
    lastTurnAt: string;
    lastOkAt: string | null;
    lastFailedAt: string | null;
    /** The first failed turn of the current run of failures. */
    failingSince: string | null;
    /** Failed turns in a row, ending at the newest. */
    failedTurns: number;
    lastFailure: (ModelFailure & { at: string; runId: string; caseId: string; decision: string | null }) | null;
    /** A page went out for the current episode; the first good turn sends one "back". */
    alerted: boolean;
    lastAlertAt: string | null;
}

export interface TurnReport {
    outcome: TurnModelOutcome;
    at: Date;
    runId: string;
    caseId: string;
    /** What the desk did with the turn (DeskResult.decision). Its note is not carried: it can quote the customer. */
    decision: string | null;
}

export type ModelAlert = { kind: 'failing' | 'recovered'; title: string; message: string };

export function parseModelHealth(value: unknown): ModelHealthRecord | null {
    if (!value || typeof value !== 'object') return null;
    const v = value as Partial<ModelHealthRecord>;
    if ((v.state !== 'ok' && v.state !== 'failing') || typeof v.lastTurnAt !== 'string') return null;
    return {
        state: v.state,
        lastTurnAt: v.lastTurnAt,
        lastOkAt: v.lastOkAt ?? null,
        lastFailedAt: v.lastFailedAt ?? null,
        failingSince: v.failingSince ?? null,
        failedTurns: typeof v.failedTurns === 'number' ? v.failedTurns : 0,
        lastFailure: v.lastFailure ?? null,
        alerted: !!v.alerted,
        lastAlertAt: v.lastAlertAt ?? null,
    };
}

/** The row after one turn, and the page it calls for. `pageable` false (not production) records without paging. */
export function nextModelHealth(prev: ModelHealthRecord | null, report: TurnReport, pageable: boolean): { record: ModelHealthRecord | null; alert: ModelAlert | null } {
    const { outcome } = report;
    if (outcome.verdict === 'no_model_call') return { record: prev, alert: null };
    if (prev && Date.parse(prev.lastTurnAt) > report.at.getTime()) return { record: prev, alert: null };
    const at = report.at.toISOString();
    const now = report.at.getTime();

    if (outcome.verdict === 'ok') {
        const record: ModelHealthRecord = {
            state: 'ok', lastTurnAt: at, lastOkAt: at, lastFailedAt: prev?.lastFailedAt ?? null,
            failingSince: null, failedTurns: 0, lastFailure: prev?.lastFailure ?? null, alerted: false, lastAlertAt: null,
        };
        if (!prev?.alerted) return { record, alert: null };
        const since = prev.failingSince ? Date.parse(prev.failingSince) : NaN;
        const message = [
            `A customer turn completed through the model again (${at}, case ${report.caseId}).`,
            `${prev.failedTurns} turn${prev.failedTurns === 1 ? '' : 's'} failed${Number.isFinite(since) ? ` over about ${Math.max(1, Math.round((now - since) / 60_000))} min` : ''}; the last error was:`,
            prev.lastFailure?.error ?? '(none recorded)',
            'Check the comms desk board for the threads held while it was failing.',
        ].join('\n');
        return { record, alert: { kind: 'recovered', title: 'comms desk is answering again', message } };
    }

    const failure = outcome.failure!;
    const failingSince = prev?.state === 'failing' && prev.failingSince ? prev.failingSince : at;
    const failedTurns = prev?.state === 'failing' ? prev.failedTurns + 1 : 1;
    const lastAlertMs = prev?.state === 'failing' && prev.lastAlertAt ? Date.parse(prev.lastAlertAt) : NaN;
    const page = pageable && !(Number.isFinite(lastAlertMs) && now - lastAlertMs < MODEL_ALERT_EVERY_MS);
    const record: ModelHealthRecord = {
        state: 'failing', lastTurnAt: at, lastOkAt: prev?.lastOkAt ?? null, lastFailedAt: at,
        failingSince, failedTurns,
        lastFailure: { ...failure, at, runId: report.runId, caseId: report.caseId, decision: report.decision },
        alerted: page || (prev?.state === 'failing' && prev.alerted),
        lastAlertAt: page ? at : (prev?.state === 'failing' ? prev.lastAlertAt : null),
    };
    if (!page) return { record, alert: null };
    const message = [
        `The ${failure.role} call (${failure.model}) failed at ${at}. The provider said:`,
        failure.error,
        `Case ${report.caseId}, ${report.runId}: the desk ${report.decision === 'hold' ? 'held the thread for Ben' : `decided ${report.decision ?? 'nothing'}`}.`,
        failedTurns > 1 ? `${failedTurns} customer turns in a row have failed since ${failingSince}.` : 'Every customer turn needs this model: until it answers, customers get the fixed acknowledgement at best.',
    ].join('\n');
    return { record, alert: { kind: 'failing', title: 'comms desk cannot answer: model call failed', message } };
}

// ------------------------------------------------------------------ db-backed

async function getDb() {
    const { db } = await import('../../db');
    return db;
}

export async function readModelHealth(): Promise<ModelHealthRecord | null> {
    const db = await getDb();
    const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, MODEL_HEALTH_KEY)).limit(1);
    return row ? parseModelHealth(row.value) : null;
}

/** Read, decide and write under a transaction-scoped lock on the key, so a writer in another process cannot interleave. */
async function updateModelHealth(next: (prev: ModelHealthRecord | null) => ModelHealthRecord | null, now: Date): Promise<void> {
    const db = await getDb();
    await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${MODEL_HEALTH_KEY}))`);
        const [row] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, MODEL_HEALTH_KEY)).limit(1);
        const record = next(row ? parseModelHealth(row.value) : null);
        if (!record) return;
        await tx.insert(appSettings)
            .values({
                id: MODEL_HEALTH_KEY, key: MODEL_HEALTH_KEY, value: record,
                description: 'Comms desk model health from real customer turns (see server/comms-v2/desk/model-health.ts)',
                updatedAt: now,
            })
            .onConflictDoUpdate({ target: appSettings.key, set: { value: record, updatedAt: now } });
    });
}

export interface ModelHealthStore {
    read(): Promise<ModelHealthRecord | null>;
    /** Hands `next` the current row and writes what it returns (nothing for null), with no other update in between. */
    update(next: (prev: ModelHealthRecord | null) => ModelHealthRecord | null, now: Date): Promise<void>;
}

export interface RecordTurnDeps {
    store?: ModelHealthStore;
    notify?: (title: string, message: string) => Promise<void>;
    pageable?: boolean;
}

async function defaultNotify(title: string, message: string): Promise<void> {
    const { notifyWorkerHealth } = await import('../../pushover');
    await notifyWorkerHealth({ title, message });
}

let recording: Promise<unknown> = Promise.resolve();

/**
 * After a customer turn: update the row, and page when the turn opens (or, hourly, continues) an episode, or ends one.
 * Turns are recorded one at a time in this process, and the page goes after the row is written, so
 * concurrent failures page once and an older turn never overwrites a newer verdict. Never throws.
 */
export function recordTurnModelHealth(report: TurnReport, deps: RecordTurnDeps = {}): Promise<ModelAlert | null> {
    const run = recording.then(() => recordOne(report, deps));
    recording = run.catch(() => undefined);
    return run;
}

async function recordOne(report: TurnReport, deps: RecordTurnDeps): Promise<ModelAlert | null> {
    if (report.outcome.verdict === 'no_model_call') return null;
    const store = deps.store ?? { read: readModelHealth, update: updateModelHealth };
    let pageable = deps.pageable;
    if (pageable === undefined) pageable = (await import('../../worker-gate')).isProductionEnv();
    let alert: ModelAlert | null = null;
    try {
        await store.update((prev) => {
            const next = nextModelHealth(prev, report, pageable!);
            alert = next.alert;
            return next.record === prev ? null : next.record;
        }, report.at);
    } catch (error: any) {
        console.error('[comms-v2 model-health] could not update the row:', error?.message ?? error);
        alert = nextModelHealth(null, report, pageable).alert;
    }
    if (report.outcome.verdict === 'failed') console.error(`[comms-v2 model-health] turn failed: ${report.outcome.failure!.role} ${report.outcome.failure!.model}: ${report.outcome.failure!.error}`);
    const page = alert as ModelAlert | null;
    if (page) {
        try {
            await (deps.notify ?? defaultNotify)(page.title, page.message);
        } catch (error: any) {
            console.error('[comms-v2 model-health] page failed:', error?.message ?? error);
        }
    }
    return page;
}

// ------------------------------------------------------------------ the health read

export interface DeskModelHealth {
    /** ok: the newest turn that needed the model got an answer. failing: it did not. idle: no turn recorded yet. unknown: the row could not be read. */
    status: 'ok' | 'failing' | 'idle' | 'unknown';
    canAnswer: boolean | null;
    lastTurnAt: string | null;
    lastOkAt: string | null;
    failingSince: string | null;
    failedTurns: number;
    /** The newest failure, verbatim, while failing. */
    reason: string | null;
    failedCall: { role: string; model: string } | null;
    /** What this signal proves, for whoever reads the JSON. */
    basis: string;
    error?: string;
}

const BASIS = 'the newest real customer turn that needed the model; no model call is made to answer this';

export function assessModelHealth(record: ModelHealthRecord | null): DeskModelHealth {
    if (!record) return { status: 'idle', canAnswer: null, lastTurnAt: null, lastOkAt: null, failingSince: null, failedTurns: 0, reason: null, failedCall: null, basis: BASIS };
    const failing = record.state === 'failing';
    return {
        status: record.state,
        canAnswer: !failing,
        lastTurnAt: record.lastTurnAt,
        lastOkAt: record.lastOkAt,
        failingSince: failing ? record.failingSince : null,
        failedTurns: failing ? record.failedTurns : 0,
        reason: failing ? record.lastFailure?.error ?? null : null,
        failedCall: failing && record.lastFailure ? { role: record.lastFailure.role, model: record.lastFailure.model } : null,
        basis: BASIS,
    };
}

/** For GET /api/health/comms-worker and the staff page. Never throws: an unreadable row is `unknown`. */
export async function deskModelHealth(read: () => Promise<ModelHealthRecord | null> = readModelHealth): Promise<DeskModelHealth> {
    try {
        return assessModelHealth(await read());
    } catch (error: any) {
        return { ...assessModelHealth(null), status: 'unknown', error: `model health unreadable: ${error?.message ?? error}` };
    }
}
