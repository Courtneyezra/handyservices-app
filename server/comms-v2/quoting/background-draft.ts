/**
 * The quote drafted off the reply path (16 Sep 2026, the Kiran case study, F6).
 *
 * The draft chain can take a couple of minutes. Awaited inside the desk pass, it held the reply to
 * the turn that made the job ready, and every message the customer wrote meanwhile queued behind it
 * and was answered one by one once it finished (four near-identical wrap-ups in a minute). With a
 * background runner the pass starts the draft, writes and sends its reply, and ends; the draft
 * finishes on its own, Ben is notified by the same `draftQuote` as before, and the file is put again.
 *
 * Nothing here ever writes to a customer. A draft that finishes records its facts and notifies Ben;
 * one that fails holds the thread for Ben exactly as the inline failure does (desk.ts), without the
 * acknowledgement the inline path wove into that turn's reply, because that reply has already gone.
 *
 * Which drafts are in flight is kept for the whole process, so a gateway rebuilt for a switch flip
 * does not start a second one. What a restart loses is on the file: a `quote_drafting` fact marks the
 * draft started, and a later fact marks it done or failed. A clock pass that finds one started, with
 * no quote reference and nothing in flight here, starts it again (desk.ts `clockPass`), at most
 * `MAX_DRAFT_STARTS` times before holding for Ben.
 */
import { recordFact, type CaseFile, type CaseFileDeps } from '../desk/case-file';
import type { DraftQuoteOutcome } from './quoting-tools';

/** The internal fact that says where the background draft is: Ben's own, never cited in a reply (case-file.ts INTERNAL_FACT_KEYS). */
export const DRAFTING_FACT = 'quote_drafting';
export const DRAFTING_STARTED = 'started';
export const DRAFTING_DONE = 'done';
export const DRAFTING_FAILED = 'failed';
/** How many times one job's draft is started before a lost draft holds for Ben instead. */
export const MAX_DRAFT_STARTS = 2;

/** What the runner is told by the desk that owns it. */
export interface BackgroundDraftHooks {
    /** The file is put again once the draft has finished, and once when it starts. */
    persist(file: CaseFile): void;
    /** The draft failed: the thread holds for Ben, as the inline failure does. */
    onFailed(file: CaseFile, reason: string): void;
    log?(line: string): void;
}

const inFlight = new Map<string, Promise<void>>();

/** A draft for this file is running in this process. */
export function draftPending(fileId: string): boolean {
    return inFlight.has(fileId);
}

/** For tests and shutdown: every draft this process is running, settled. */
export async function settleBackgroundDrafts(): Promise<void> {
    while (inFlight.size) await Promise.allSettled(Array.from(inFlight.values()));
}

function stateOf(value: string): string {
    return value.split(':')[0].trim();
}

/** Where the file's background draft stands, from its newest `quote_drafting` fact; null when none was ever started. */
export function draftingState(file: CaseFile): 'started' | 'done' | 'failed' | null {
    for (let i = file.facts.length - 1; i >= 0; i--) {
        const f = file.facts[i];
        if (f.key !== DRAFTING_FACT) continue;
        const s = stateOf(f.value);
        return s === DRAFTING_STARTED || s === DRAFTING_DONE || s === DRAFTING_FAILED ? s : null;
    }
    return null;
}

/**
 * A draft a restart lost: started, never finished, no quote on the file and nothing running here.
 * `exhausted` when it has been started as often as it may be, so the clock holds for Ben rather
 * than starting it again. `turnId` is the turn the draft was started on.
 */
export function draftToRecover(file: CaseFile): { turnId: string | null; exhausted: boolean } | null {
    if (file.job.quoteRef || draftPending(file.id) || draftingState(file) !== 'started') return null;
    const starts = file.facts.filter((f) => f.key === DRAFTING_FACT && stateOf(f.value) === DRAFTING_STARTED);
    const newest = starts[starts.length - 1];
    const turnId = newest?.source.kind === 'thread' ? newest.source.turnId : null;
    return { turnId, exhausted: starts.length >= MAX_DRAFT_STARTS };
}

/** Records that the draft will not be started again, so a clock pass never picks it up. */
export function markDraftFailed(file: CaseFile, turnId: string, reason: string, deps: CaseFileDeps = {}): void {
    recordFact(file, { key: DRAFTING_FACT, value: `${DRAFTING_FAILED}: ${reason.slice(0, 200)}`, source: { kind: 'thread', turnId }, by: 'quoting' }, deps);
}

/**
 * Starts the draft and returns at once. `run` is the draft itself (`draftQuote`), which records the
 * quote's facts and notifies Ben. Refuses a second draft for a file that already has one running.
 */
export function startBackgroundDraft(file: CaseFile, turnId: string, run: () => Promise<DraftQuoteOutcome>, hooks: BackgroundDraftHooks, deps: CaseFileDeps = {}): boolean {
    if (draftPending(file.id)) return false;
    const log = hooks.log ?? (() => undefined);
    const started = Date.now();
    recordFact(file, { key: DRAFTING_FACT, value: `${DRAFTING_STARTED}: with the drafter`, source: { kind: 'thread', turnId }, by: 'quoting' }, deps);
    const work = (async () => {
        let outcome: DraftQuoteOutcome;
        try {
            outcome = await run();
        } catch (e: any) {
            outcome = { ok: false, reason: `the draft threw: ${e?.message ?? e}`, log: [], calls: [], factIds: [], notice: null, notified: false };
        }
        if (outcome.ok) {
            recordFact(file, { key: DRAFTING_FACT, value: `${DRAFTING_DONE}: ${outcome.slug}`, source: { kind: 'thread', turnId }, by: 'quoting' }, deps);
            log(`quoting: drafted ${outcome.slug} in the background on case ${file.id} in ${Math.round((Date.now() - started) / 1000)}s; Ben ${outcome.notified ? 'notified' : 'not notified'}`);
        } else {
            markDraftFailed(file, turnId, outcome.reason, deps);
            log(`quoting: the background draft failed on case ${file.id}: ${outcome.reason}`);
            try { hooks.onFailed(file, outcome.reason); } catch (e: any) { console.error(`[comms-v2 quoting] holding case ${file.id} for a failed draft failed: ${e?.message ?? e}`); }
        }
    })().finally(() => {
        inFlight.delete(file.id);
        try { hooks.persist(file); } catch (e: any) { console.error(`[comms-v2 quoting] putting case ${file.id} after its draft failed: ${e?.message ?? e}`); }
    });
    inFlight.set(file.id, work);
    hooks.persist(file);
    return true;
}
