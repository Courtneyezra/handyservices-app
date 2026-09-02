/**
 * Quote clerk on the spine (Phase 2 / C, COMMS_AGENTS_V3_DESIGN §3.5, §6). Tier PROPOSE.
 *
 * Wraps the existing quote-prep agent (server/agents/quote-prep.ts): the spine builds the case
 * file, triages and resolves the pack; this agent asks the clerk for an intake, stamps a
 * `category` on every line (the SKU catalog by-product, §6) and hands it back as a Proposal
 * artifact. It NEVER prices, never sends, never books — the product is a quote Ben can send in
 * under a minute. Triggered by the `needs_quote` tag, a triage lane of `quote_clerk`, or a
 * `call_ended` trigger whose case file carries a transcript (the 261-of-301 threads that start
 * with a call).
 *
 * Runs only when the spine runner invokes it; the runner is gated by app_settings `spine`
 * (server/spine/config.ts), so this ships dark.
 */
import { newRunId } from '../../approver';
import { runQuotePrep } from '../../agents/quote-prep';
import { READY_TO_PRICE_TAG } from '../../agents/comms';
import { withLineCategories } from './line-category';
import { recordSpineRunStart, recordSpineRunFinish } from '../run-record';
import type { CaseFile, Proposal, SpineAgent, TriageResult, Trigger } from '../types';

export const QUOTE_CLERK_TRIGGER = 'spine:quote_clerk';

export function caseFileHasTranscript(caseFile: CaseFile): boolean {
    return caseFile.timeline.some((t) => (t.kind === 'call_in' || t.kind === 'call_out') && !!t.transcript && t.transcript.trim().length > 40);
}

export function quoteClerkAccepts(input: { caseFile: CaseFile; triage: TriageResult; trigger: Trigger }): boolean {
    const tagged = input.caseFile.tags.includes(READY_TO_PRICE_TAG) || input.triage.tags.includes(READY_TO_PRICE_TAG);
    if (tagged || input.triage.lane === 'quote_clerk') return true;
    return input.trigger === 'call_ended' && caseFileHasTranscript(input.caseFile);
}

export const quoteClerkAgent: SpineAgent = {
    name: 'quote_clerk',
    tier: 'PROPOSE',
    accepts: quoteClerkAccepts,
    async run({ caseFile, pack, triage, runId }): Promise<Proposal | null> {
        const startedAt = Date.now();
        const childRunId = newRunId('run');
        await recordSpineRunStart({ runId, agent: 'quote_clerk', trigger: QUOTE_CLERK_TRIGGER, caseFile, pack });
        const meta = { agent: 'quote_clerk' as const, caseFile };
        try {
            const { intake, summary } = await runQuotePrep(caseFile.conversationId, {
                runId: childRunId, trigger: QUOTE_CLERK_TRIGGER, parentRunId: runId,
            });
            if (!intake) {
                await recordSpineRunFinish(runId, meta, { decision: 'none', lane: triage.lane, durationMs: Date.now() - startedAt, proposal: { childRunId, summary: summary.slice(0, 500) } });
                return null;
            }
            const categorised = withLineCategories(intake);
            const proposal: Proposal = {
                intent: 'propose_intake',
                body: [],
                reasons: [summary.slice(0, 500)],
                citations: [`agent_runs:${childRunId}`],
                // A polite no is a Ben decision (docs/DECLINE_CRITERIA.md), surfaced as an exception.
                flag: intake.readiness === 'decline'
                    ? { exception: 'out_of_scope', note: `Clerk proposes a decline: ${intake.declineReason ?? 'no reason given'}` }
                    : null,
                contactName: intake.customerName ?? null,
                artifact: {
                    kind: 'quote_intake',
                    summary: `${categorised.lines.length} line(s), readiness ${intake.readiness}, ${intake.gaps.length} gap(s)`,
                    data: categorised,
                    childRunId,
                },
            };
            await recordSpineRunFinish(runId, meta, {
                decision: 'PROPOSE', lane: triage.lane, durationMs: Date.now() - startedAt,
                proposal: { intent: proposal.intent, artifact: proposal.artifact, flag: proposal.flag },
            });
            return proposal;
        } catch (error: any) {
            await recordSpineRunFinish(runId, meta, { error: error?.message ?? String(error), durationMs: Date.now() - startedAt, lane: triage.lane });
            throw error;
        }
    },
};
