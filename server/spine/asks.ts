/**
 * The rules layer's content-free asks from the spine exit (Phase 3 / C; design §3.5 "Rules layer":
 * ask_media / ask_postcode at SEND from launch).
 *
 * When triage says first contact (lane `rules`) and the run itself has nothing to say (the rules
 * placeholder decides `none`), the exit asks for the ONE thing that unblocks pricing: a photo or
 * video if the thread has no media, else the postcode if none has arrived in the last 30 days.
 * Never both in one tick, at most one ask per thread per 24h, and delivery goes through
 * rules-layer `sendAsk`, so the holding line's suppression (answered / opted out / recent rules
 * send / test number / archived) applies unchanged.
 *
 * Gated three ways, all fail-closed: spine `enabled`, `asks.enabled`, and mode — `shadow` logs
 * what it WOULD have asked and sends nothing.
 *
 * `decideAsk` is pure and unit-tested; `maybeAskFromExit` wires it with injectable dependencies.
 */
import type { CaseFile, Decision, SpineRun, TriageResult } from './types';
import { spineMode, type SpineConfig, type SpineMode } from './config';
import type { AskKind, RulesSendResult } from '../rules-layer';

export const ASK_COOLDOWN_MS = 24 * 3600_000;
export const POSTCODE_LOOKBACK_DAYS = 30;

/** UK postcode, tolerant of missing space and lower case ("Ng37eg" is how customers type it). */
export const UK_POSTCODE_RE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;

export function hasMedia(cf: CaseFile): boolean {
    if (cf.media.length > 0) return true;
    return cf.timeline.some((t) => t.kind === 'message_in' && !!t.mediaIds?.length);
}

export function hasRecentPostcode(cf: CaseFile, now: Date, days: number = POSTCODE_LOOKBACK_DAYS): boolean {
    const since = now.getTime() - days * 86_400_000;
    return cf.timeline.some((t) => t.kind === 'message_in' && new Date(t.at).getTime() >= since && UK_POSTCODE_RE.test(t.body ?? ''));
}

export interface AskDecisionInput {
    caseFile: CaseFile;
    triage: TriageResult;
    decision: Decision;
    now: Date;
    /** Newest rules-layer ask on the thread (rules-layer lastRulesAsk), if any. */
    lastAsk: { kind: AskKind; at: Date } | null;
}

export interface AskDecision { kind: AskKind | null; reason: string }

/** Which ask, if any, this run should make. Pure. */
export function decideAsk(input: AskDecisionInput): AskDecision {
    const { caseFile, triage, decision, now, lastAsk } = input;
    if (triage.lane !== 'rules') return { kind: null, reason: `lane ${triage.lane} is not first contact` };
    if (decision.kind !== 'none') return { kind: null, reason: `run decided ${decision.kind}; the ask only fills silence` };
    if (triage.exceptions.length) return { kind: null, reason: `exception ${triage.exceptions.join(',')} is Ben's` };
    if (caseFile.audience !== 'customer') return { kind: null, reason: `${caseFile.audience} audience` };
    if (caseFile.tags.includes('needs_ben') || caseFile.openFlags.length) return { kind: null, reason: 'thread is with Ben' };
    if (lastAsk && now.getTime() - lastAsk.at.getTime() < ASK_COOLDOWN_MS) {
        return { kind: null, reason: `asked ${lastAsk.kind} ${Math.round((now.getTime() - lastAsk.at.getTime()) / 60_000)} min ago; one ask per 24h` };
    }
    if (!hasMedia(caseFile)) return { kind: 'ask_media', reason: 'no photo or video on the thread' };
    if (!hasRecentPostcode(caseFile, now)) return { kind: 'ask_postcode', reason: `no postcode from the customer in ${POSTCODE_LOOKBACK_DAYS} days` };
    return { kind: null, reason: 'media and postcode already on the thread' };
}

export interface AskOutcome {
    kind: AskKind | null;
    action: 'sent' | 'shadow' | 'skipped' | 'suppressed' | 'failed';
    mode: SpineMode;
    reason: string;
    detail?: string;
}

export interface AskDeps {
    getConfig: () => Promise<SpineConfig>;
    lastAsk: (conversationId: string) => Promise<{ kind: AskKind; at: Date } | null>;
    sendAsk: (conversationId: string, kind: AskKind, runId: string) => Promise<RulesSendResult>;
    log: (summary: string, detail: Record<string, unknown>) => Promise<void>;
    now: () => Date;
}

async function defaultAskDeps(): Promise<AskDeps> {
    const config = await import('./config');
    const rules = await import('../rules-layer');
    const events = await import('../system-events');
    return {
        getConfig: () => config.getSpineConfig(),
        lastAsk: (id) => rules.lastRulesAsk(id),
        sendAsk: (id, kind, runId) => rules.sendAsk(id, kind, runId),
        log: async (summary, detail) => { await events.logSystemEvent({ kind: 'sweep', source: 'spine-asks', summary, detail, conversationId: String(detail.conversationId ?? '') || null, phone: String(detail.phone ?? '') || null }); },
        now: () => new Date(),
    };
}

/**
 * Called by the exit after its own decision. Returns null when the run is not a first-contact
 * silence (the common case), so the exit stays cheap and the config row is not even read.
 */
export async function maybeAskFromExit(run: SpineRun, overrides: Partial<AskDeps> = {}): Promise<AskOutcome | null> {
    if (run.triage.lane !== 'rules' || run.decision.kind !== 'none') return null;
    const deps: AskDeps = { ...(await defaultAskDeps()), ...overrides };
    const config = await deps.getConfig();
    const mode = spineMode(config);
    if (mode === 'off') return { kind: null, action: 'skipped', mode, reason: 'spine off' };
    if (!config.asks.enabled) return { kind: null, action: 'skipped', mode, reason: 'spine.asks.enabled is false' };

    const now = deps.now();
    const lastAsk = await deps.lastAsk(run.caseFile.conversationId).catch(() => null);
    const decided = decideAsk({ caseFile: run.caseFile, triage: run.triage, decision: run.decision, now, lastAsk });
    const base = { conversationId: run.caseFile.conversationId, phone: run.caseFile.phone, runId: run.runId, kind: decided.kind, reason: decided.reason, mode };
    if (!decided.kind) return { kind: null, action: 'skipped', mode, reason: decided.reason };

    if (mode === 'shadow') {
        await deps.log(`shadow: would ask ${decided.kind} (${decided.reason})`, base).catch(() => undefined);
        return { kind: decided.kind, action: 'shadow', mode, reason: decided.reason };
    }
    try {
        const r = await deps.sendAsk(run.caseFile.conversationId, decided.kind, run.runId);
        if (r.sent) return { kind: decided.kind, action: 'sent', mode, reason: decided.reason, detail: r.mode };
        return { kind: decided.kind, action: r.reason === 'SUPPRESSED' ? 'suppressed' : 'failed', mode, reason: decided.reason, detail: r.suppressedBy ?? r.reason };
    } catch (error: any) {
        return { kind: decided.kind, action: 'failed', mode, reason: decided.reason, detail: error?.message ?? String(error) };
    }
}
