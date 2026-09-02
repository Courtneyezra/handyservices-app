/**
 * Recovery on the spine (Phase 2 / C, COMMS_AGENTS_V3_DESIGN §3.5, §7). Tier PROPOSE.
 *
 * Wraps server/agents/recovery.ts: the legacy agent already reads its candidate list, judges each
 * thread and PROPOSES nudges into nudge_queue (the wa.me prefill send — the Sukhy lesson). Nothing
 * here sends. On the spine it is a cadence agent: it runs on the `cadence`/`manual` trigger, not
 * per inbound message, and reports the batch as a Proposal artifact so the run is on the ledger
 * under the spine's vocabulary. Ships dark behind app_settings `spine`.
 */
import { newRunId } from '../../approver';
import { runRecovery } from '../../agents/recovery';
import { recordSpineRunStart, recordSpineRunFinish } from '../run-record';
import type { Proposal, SpineAgent, Trigger } from '../types';

export const RECOVERY_TRIGGER = 'spine:recovery';
const CADENCE_TRIGGERS: readonly Trigger[] = ['cadence', 'manual'];

export const recoveryAgent: SpineAgent = {
    name: 'recovery',
    tier: 'PROPOSE',
    accepts: ({ trigger }) => CADENCE_TRIGGERS.includes(trigger),
    async run({ caseFile, pack, triage, runId }): Promise<Proposal | null> {
        const startedAt = Date.now();
        const childRunId = newRunId('run');
        await recordSpineRunStart({ runId, agent: 'recovery', trigger: RECOVERY_TRIGGER, caseFile, pack });
        const meta = { agent: 'recovery' as const, caseFile };
        try {
            const result = await runRecovery({ runId: childRunId, trigger: RECOVERY_TRIGGER, parentRunId: runId });
            const summary = (result.finalText ?? '').slice(0, 500);
            const proposal: Proposal = {
                intent: 'propose_nudges',
                body: [],
                reasons: [summary || 'recovery sweep completed'],
                citations: [`agent_runs:${childRunId}`, 'nudge_queue'],
                artifact: { kind: 'nudge_batch', summary: summary || 'see nudge_queue', data: { childRunId, turns: result.turns }, childRunId },
            };
            await recordSpineRunFinish(runId, meta, {
                decision: 'PROPOSE', lane: triage.lane, durationMs: Date.now() - startedAt,
                proposal: { intent: proposal.intent, artifact: proposal.artifact },
                usage: (result as any).usage ?? null, model: (result as any).model ?? null,
            });
            return proposal;
        } catch (error: any) {
            await recordSpineRunFinish(runId, meta, { error: error?.message ?? String(error), durationMs: Date.now() - startedAt, lane: triage.lane });
            throw error;
        }
    },
};
