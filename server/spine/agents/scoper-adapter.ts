/**
 * Thin adapter between the Scoper and the legacy world. `runCommsAgent` (server/agents/comms.ts)
 * is untouched; this is the seam Phase 3 flips through, and until then it refuses to run unless
 * `spine.enabled` AND `spine.agents.scoper.enabled` are on.
 *
 * It does not build case files or triage (pane A owns those): the caller hands in a CaseFile,
 * TriageResult and PolicyPack, which is exactly the SpineAgent contract, plus the run id the
 * spine minted so every write the belt makes carries it.
 */
import { newRunId } from '../../approver';
import { isSpineEnabled } from '../config';
import type { CaseFile, PolicyPack, Proposal, TriageResult } from '../types';
import { scoperAgent } from './scoper';

export interface LegacyShapedOutcome {
    /** Mirrors CommsAgentOutcome's `actions` so sweeps/logs can print the same line. */
    actions: Array<{ tool: string; summary: string }>;
    /** Always false here: the Scoper never sends; the spine's exit does. */
    autosent: false;
    proposal: Proposal | null;
    runId: string;
}

/** What the legacy log lines print, derived from a proposal. */
export function proposalToLegacyOutcome(proposal: Proposal | null, runId: string): LegacyShapedOutcome {
    const actions: LegacyShapedOutcome['actions'] = [];
    if (proposal?.body.length) actions.push({ tool: 'propose_reply', summary: `${proposal.intent}: ${proposal.body[0].slice(0, 80)}` });
    if (proposal?.flag) actions.push({ tool: 'flag', summary: `${proposal.flag.exception}: ${proposal.flag.note.slice(0, 80)}` });
    if (proposal?.contactName) actions.push({ tool: 'set_contact_name', summary: proposal.contactName });
    if (proposal?.recontactAt) actions.push({ tool: 'schedule_recontact', summary: proposal.recontactAt });
    if (proposal?.tags?.length) actions.push({ tool: 'tags', summary: proposal.tags.join(', ') });
    return { actions, autosent: false, proposal, runId };
}

/**
 * Run the Scoper on a prepared case file, if and only if the spine is switched on. Returns
 * `{ skipped: true }` while dark, so a caller wired in ahead of Phase 3 does nothing on a customer.
 */
export async function runScoperIfEnabled(input: {
    caseFile: CaseFile; triage: TriageResult; pack: PolicyPack; runId?: string;
}): Promise<LegacyShapedOutcome | { skipped: true; reason: string }> {
    if (!(await isSpineEnabled('scoper'))) return { skipped: true, reason: 'spine.enabled is false (ships dark until Phase 3)' };
    const runId = input.runId ?? newRunId('run');
    const proposal = await scoperAgent.run({ caseFile: input.caseFile, triage: input.triage, pack: input.pack, runId });
    return proposalToLegacyOutcome(proposal, runId);
}
