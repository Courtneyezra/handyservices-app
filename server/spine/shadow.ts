/**
 * Shadow runs (Phase 3). In 'shadow' mode the legacy tick calls this BEFORE it runs the legacy
 * agent on the same thread: the spine computes case file → triage → pack → agent → guards →
 * decision, records the run with `shadow_decision`, and touches nothing else. Never throws and
 * never blocks the legacy run: a shadow failure is a log line.
 */
import type { Trigger } from './types';
import { spineMode } from './switch';

export interface ShadowResult { ran: boolean; runId?: string; decision?: string; lane?: string; reason?: string }

export async function runShadow(conversationId: string, trigger: Trigger): Promise<ShadowResult> {
    try {
        if ((await spineMode()) !== 'shadow') return { ran: false, reason: 'not in shadow mode' };
        const { runOnce } = await import('./index');
        const startedAt = new Date();
        const run = await runOnce(conversationId, trigger, undefined, { shadow: true });
        console.log(`[Spine:shadow] ${conversationId} lane=${run.triage.lane} would=${run.decision.kind}${run.proposal ? ` intent=${run.proposal.intent}` : ''} (run ${run.runId})`);
        // D1 / D10: a shadow pass is still a look at this turn — without the stamp the untriggered-quote
        // net would re-request the thread every five minutes in shadow exactly as it did live.
        try {
            const { recordSpinePass, spinePassStamp } = await import('./request-run');
            await recordSpinePass(conversationId, spinePassStamp(run, startedAt));
        } catch (e: any) {
            console.warn(`[Spine:shadow] could not stamp the pass for ${conversationId}:`, e?.message ?? e);
        }
        return { ran: true, runId: run.runId, decision: run.decision.kind, lane: run.triage.lane };
    } catch (error: any) {
        console.error(`[Spine:shadow] run failed for ${conversationId} (legacy unaffected):`, error?.message ?? error);
        return { ran: false, reason: error?.message ?? String(error) };
    }
}
