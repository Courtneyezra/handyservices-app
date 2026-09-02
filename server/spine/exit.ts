/**
 * The exit (design §3.6): the ONLY place a spine decision touches the world.
 *
 *   send     queueDraft (source 'spine') → approveAndSendDraft(id, approver, runId): the same
 *            claimed-row path a human's click takes, so the near-duplicate / malformed-reason /
 *            opt-out holds and the gated sendCustomerMessage all apply. With the 24h window shut
 *            the draft carries the pack's APPROVED template for the intent (P6); without one it
 *            is refused OUTSIDE_WINDOW and stays pending with a due time — never silent.
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

/** An approved Meta template resolved for a SEND whose 24h window is shut (P6, template-first exit). */
export interface ResolvedTemplate {
    name: string;
    contentSid: string;
    variables: Record<string, string>;
    /** The template body with its variables filled — what the customer will read. */
    body: string;
}

export interface ExitDeps {
    queueDraft: (input: {
        phone: string; body: string; source: 'spine'; reason: string; dueAt?: Date; runId: string; dedupe?: boolean;
        contentSid?: string; contentVariables?: Record<string, string>;
    }) => Promise<string | null>;
    approveAndSendDraft: (draftId: string, approver: Approver, runId: string) => Promise<{ ok: boolean; code?: string; mode?: string; message?: string }>;
    /**
     * P6 (template-first exit): the pack's approved template for this intent, via the same
     * approved-template lookup the rules layer uses (findApprovedTemplateWithValues, by NAME, so a
     * template that is pending today is picked up the day Meta approves it). Null when the pack
     * names no template for the intent or Meta has not approved it.
     */
    resolveTemplate: (input: { packId: string; intent: string; contactName?: string | null }) => Promise<ResolvedTemplate | null>;
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
    /** P6: the approved Meta template the send was queued with (window shut). */
    template?: string;
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
        resolveTemplate: (input) => resolvePackTemplate(input),
    };
}

/**
 * The default template resolver: pack.templates[intent] → findApprovedTemplateWithValues (the
 * rules layer's lookup) with {{1}} = the customer's first name or "there". Never throws; a lookup
 * failure is "no template", and the caller falls to the pending path.
 */
export async function resolvePackTemplate(input: { packId: string; intent: string; contactName?: string | null }): Promise<ResolvedTemplate | null> {
    try {
        const { PACKS } = await import('./packs');
        const name = (PACKS[input.packId]?.templates as Record<string, string | undefined> | undefined)?.[input.intent];
        if (!name) return null;
        const { findApprovedTemplateWithValues } = await import('../whatsapp-template-sync');
        const { templateNameSlot } = await import('../rules-layer');
        const picked = await findApprovedTemplateWithValues([name], [templateNameSlot(input.contactName)]);
        if (!picked) return null;
        return { name: picked.template.name, contentSid: picked.template.sid, variables: picked.variables, body: picked.body };
    } catch (error: any) {
        console.warn(`[Spine] template lookup failed for ${input.packId}/${input.intent} (falling to pending):`, error?.message ?? error);
        return null;
    }
}

/** A WhatsApp thread whose 24h window is shut: freeform is refused, only a template (or SMS) can deliver. */
export function windowShut(run: SpineRun): boolean {
    const w = run.caseFile.window;
    return !w.canFreeform && w.channelLastUsed !== 'sms';
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
                // P6 (template-first exit): with the 24h window shut, a freeform draft can only be
                // refused OUTSIDE_WINDOW. Resolve the pack's approved template for the intent first
                // and queue the draft with its content SID, so approveAndSendDraft sends the
                // template. No approved template → the freeform path below, whose refusal leaves
                // the draft pending with a due time (the rules layer holds the line at expiry):
                // never silent, never a freeform send outside the window.
                let template: ResolvedTemplate | null = null;
                if (windowShut(run)) {
                    try {
                        template = await deps.resolveTemplate({ packId: run.pack.id, intent: run.proposal.intent, contactName: caseFile.contactName ?? null });
                    } catch (e: any) {
                        // A broken lookup must not cost the customer the draft: fall to the pending path.
                        console.warn(`[Spine] template lookup threw for ${caseFile.conversationId} (falling to pending):`, e?.message ?? e);
                    }
                }
                const draftId = await deps.queueDraft({
                    phone: caseFile.phone, source: 'spine', runId: run.runId, dedupe: false,
                    body: template ? template.body : run.proposal.body.join('\n---\n'),
                    reason: template ? `${reasonFor(run)} Template ${template.name} (window shut).` : reasonFor(run),
                    ...(template ? { contentSid: template.contentSid, contentVariables: template.variables } : {}),
                });
                if (!draftId) { outcome = { kind: 'send', draftId: null, sent: false, detail: 'queueDraft refused (opt-out or unparseable number)' }; break; }
                const sent = await deps.approveAndSendDraft(draftId, decision.approver, run.runId);
                outcome = {
                    kind: 'send', draftId, sent: sent.ok, mode: sent.mode,
                    ...(template ? { template: template.name } : {}),
                    detail: sent.ok ? undefined : `${sent.code ?? 'refused'}: ${sent.message ?? ''}${!template && windowShut(run) ? ' (window shut, no approved template for this intent; draft left pending)' : ''}`,
                };
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
