/**
 * agent_runs rows for spine agents (Phase 2 / C). Thin wrapper over server/agent-runs.ts so a
 * SpineAgent that wraps a legacy runner (which writes its OWN row under a child run id) still
 * leaves one spine-level row: agent name from the spine vocabulary, pack id/version, case file
 * hash, decision, lane, proposal. Never throws — bookkeeping cannot fail a run.
 */
import { startAgentRun, finishAgentRun, type FinishAgentRunInput } from '../agent-runs';
import type { AgentName, CaseFile, PolicyPack, Trigger } from './types';

export async function recordSpineRunStart(input: {
    runId: string; agent: AgentName; trigger: Trigger | string; caseFile: CaseFile;
    pack: Pick<PolicyPack, 'id' | 'version'>; model?: string | null;
}): Promise<void> {
    try {
        await startAgentRun({
            id: input.runId, agent: input.agent, trigger: input.trigger,
            conversationId: input.caseFile.conversationId, phone: input.caseFile.phone,
            packId: input.pack.id, packVersion: input.pack.version, caseFileRef: input.caseFile.hash,
            model: input.model ?? null,
        });
    } catch (error: any) {
        console.warn(`[Spine] could not record run start ${input.runId}:`, error?.message ?? error);
    }
}

export async function recordSpineRunFinish(
    runId: string,
    meta: { agent: AgentName; caseFile: CaseFile },
    patch: FinishAgentRunInput,
): Promise<void> {
    try {
        await finishAgentRun(runId, { agent: meta.agent, conversationId: meta.caseFile.conversationId, phone: meta.caseFile.phone }, patch);
    } catch (error: any) {
        console.warn(`[Spine] could not record run finish ${runId}:`, error?.message ?? error);
    }
}
