/**
 * The exit (design §3.6): the ONLY place a spine decision touches the world.
 *
 *   send     queueDraft (source 'spine') → approveAndSendDraft(id, approver, runId): the same
 *            claimed-row path a human's click takes, so the near-duplicate / malformed-reason /
 *            opt-out holds and the gated sendCustomerMessage all apply.
 *   pending  queueDraft with due_at + run_id; a person decides, the rules layer holds the line
 *            if the due time passes.
 *   flag     agent_questions row (status flagged, due_at, run_id) + needs_ben tag + ONE Pushover.
 *            Deduped on the tag, like flagThreadForBen.
 *   drop /   ledger event only.
 *   none
 *
 * Every outcome appends `run_decided` to the ledger with the run id. Dependencies are injectable
 * so routing is unit-tested without a database.
 */
import type { Approver } from '../approver';
import { ledgerFlagRaised, ledgerRunDecided } from '../ledger';
import { maybeAskFromExit, type AskOutcome } from './asks';
import type { Decision, SpineRun } from './types';

export interface ExitFlagRow {
    id: string; conversationId: string; phone: string; question: string; context: string | null;
    source: string; status: 'flagged'; dueAt: Date; runId: string;
}

export interface ExitDeps {
    queueDraft: (input: {
        phone: string; body: string; source: 'spine'; reason: string; dueAt?: Date; runId: string; dedupe?: boolean;
    }) => Promise<string | null>;
    approveAndSendDraft: (draftId: string, approver: Approver, runId: string) => Promise<{ ok: boolean; code?: string; mode?: string; message?: string }>;
    /** Insert the flag row, tag the thread needs_ben (priority high unless urgent). Return the row id. */
    insertFlag: (row: ExitFlagRow, opts: { urgent: boolean }) => Promise<string>;
    notify: (alert: { customerName?: string | null; phoneNumber: string; note: string; conversationId: string }) => Promise<void>;
    now: () => Date;
    /** Phase 3: the rules layer's content-free ask on a first-contact silence (server/spine/asks.ts). */
    ask: (run: SpineRun) => Promise<AskOutcome | null>;
}

export interface ExitOutcome {
    kind: Decision['kind'];
    draftId?: string | null;
    sent?: boolean;
    mode?: string;
    questionId?: string | null;
    deduped?: boolean;
    detail?: string;
    /** Phase 3: what the rules layer asked (or would have asked in shadow) after a `none`. */
    ask?: AskOutcome | null;
}

async function defaultDeps(): Promise<ExitDeps> {
    const drafts = await import('../message-drafts');
    return {
        queueDraft: (input) => drafts.queueDraft(input),
        approveAndSendDraft: (id, approver, runId) => drafts.approveAndSendDraft(id, approver, runId),
        insertFlag: async (row, opts) => {
            const { db } = await import('../db');
            const { agentQuestions, conversations } = await import('@shared/schema');
            const { eq } = await import('drizzle-orm');
            await db.insert(agentQuestions).values({
                id: row.id, conversationId: row.conversationId, phone: row.phone, question: row.question, context: row.context,
                options: null, source: row.source, status: row.status, dueAt: row.dueAt, runId: row.runId,
            });
            const [conv] = await db.select({ tags: conversations.tags, priority: conversations.priority }).from(conversations).where(eq(conversations.id, row.conversationId));
            const tags = (conv?.tags as string[] | null) ?? [];
            await db.update(conversations).set({
                tags: Array.from(new Set([...tags, 'needs_ben'])),
                ...(conv?.priority === 'urgent' ? {} : { priority: opts.urgent ? 'urgent' : 'high' }),
                updatedAt: new Date(),
            }).where(eq(conversations.id, row.conversationId));
            return row.id;
        },
        notify: async (alert) => {
            const { notifyEscalation } = await import('../pushover');
            await notifyEscalation(alert);
        },
        now: () => new Date(),
        ask: (run) => maybeAskFromExit(run),
    };
}

function reasonFor(run: SpineRun): string {
    const intent = run.proposal?.intent ?? run.triage.intent;
    const why = (run.proposal?.reasons ?? run.triage.reasons).join(' ').slice(0, 400);
    return `[${intent}] [spine:${run.agent}] ${why || 'spine run'}`;
}

export async function exit(run: SpineRun, overrides: Partial<ExitDeps> = {}): Promise<ExitOutcome> {
    const deps: ExitDeps = { ...(await defaultDeps()), ...overrides };
    const { decision, caseFile } = run;
    let outcome: ExitOutcome = { kind: decision.kind };

    try {
        switch (decision.kind) {
            case 'send': {
                if (!run.proposal) { outcome = { kind: 'none', detail: 'send with no proposal' }; break; }
                const draftId = await deps.queueDraft({
                    phone: caseFile.phone, body: run.proposal.body.join('\n---\n'), source: 'spine',
                    reason: reasonFor(run), runId: run.runId, dedupe: false,
                });
                if (!draftId) { outcome = { kind: 'send', draftId: null, sent: false, detail: 'queueDraft refused (opt-out or unparseable number)' }; break; }
                const sent = await deps.approveAndSendDraft(draftId, decision.approver, run.runId);
                outcome = { kind: 'send', draftId, sent: sent.ok, mode: sent.mode, detail: sent.ok ? undefined : `${sent.code ?? 'refused'}: ${sent.message ?? ''}` };
                break;
            }
            case 'pending': {
                if (!run.proposal) { outcome = { kind: 'none', detail: 'pending with no proposal' }; break; }
                const draftId = await deps.queueDraft({
                    phone: caseFile.phone, body: run.proposal.body.join('\n---\n'), source: 'spine',
                    reason: `${reasonFor(run)} — ${decision.reason}`, dueAt: new Date(decision.dueAt), runId: run.runId,
                });
                outcome = { kind: 'pending', draftId, detail: draftId ? undefined : 'queueDraft refused' };
                break;
            }
            case 'flag': {
                if (caseFile.tags.includes('needs_ben') || caseFile.openFlags.length) {
                    outcome = { kind: 'flag', questionId: null, deduped: true, detail: 'thread already flagged for Ben' };
                    break;
                }
                const urgent = decision.exception === 'callback_requested';
                const id = `aq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                const question = `[${decision.exception}] ${decision.note}`.slice(0, 2000);
                const questionId = await deps.insertFlag({
                    id, conversationId: caseFile.conversationId, phone: caseFile.phone, question,
                    context: run.proposal ? `Proposed (not sent): ${run.proposal.body.join(' / ').slice(0, 600)}` : null,
                    source: `spine:${run.agent}`, status: 'flagged', dueAt: new Date(decision.dueAt), runId: run.runId,
                }, { urgent });
                void ledgerFlagRaised({ questionId, phone: caseFile.phone, conversationId: caseFile.conversationId, note: question, source: `spine:${run.agent}`, runId: run.runId, actor: `agent:${run.agent}` });
                try {
                    await deps.notify({ customerName: caseFile.contactName ?? null, phoneNumber: caseFile.phone, note: question, conversationId: caseFile.conversationId });
                } catch (e: any) {
                    console.warn('[Spine] escalation push failed (flag stands):', e?.message ?? e);
                }
                outcome = { kind: 'flag', questionId };
                break;
            }
            case 'drop':
            case 'none':
                outcome = { kind: decision.kind, detail: decision.reason };
                break;
        }
    } catch (error: any) {
        outcome = { ...outcome, detail: `exit failed: ${error?.message ?? error}` };
        console.error(`[Spine] exit ${decision.kind} failed for ${caseFile.conversationId}:`, error?.message ?? error);
    }

    // Phase 3: a first-contact run that ends in `none` is exactly the silence the rules layer
    // exists for — ask for the one thing that unblocks pricing (media, then postcode). Returns
    // null for every other run, so nothing above changes.
    if (decision.kind === 'none' && run.triage.lane === 'rules') {
        try {
            const ask = await deps.ask(run);
            if (ask) outcome = { ...outcome, ask };
        } catch (error: any) {
            console.warn(`[Spine] ask after exit failed for ${caseFile.conversationId}:`, error?.message ?? error);
        }
    }

    // Phase 4: an artifact proposal (the clerk's quote intake) is what the in-chat card renders;
    // tell the open thread panel over the comms SSE bus so it refetches without a reload.
    if (run.proposal?.artifact) {
        try {
            const { emitCommsEvent } = await import('../comms-events');
            emitCommsEvent({ type: 'artifact_delta', conversationId: caseFile.conversationId, runId: run.runId, kind: run.proposal.artifact.kind, at: new Date().toISOString() });
        } catch (e: any) {
            console.warn('[Spine] artifact_delta emit failed (run stands):', e?.message ?? e);
        }
    }

    void ledgerRunDecided({
        runId: run.runId, agent: run.agent, conversationId: caseFile.conversationId, phone: caseFile.phone,
        decision: decision.kind, lane: run.triage.lane, intent: run.proposal?.intent ?? run.triage.intent,
        detail: { ...outcome, packId: run.pack.id, packVersion: run.pack.version, guardsHit: run.guards?.guardsHit ?? [] },
    });
    return outcome;
}
