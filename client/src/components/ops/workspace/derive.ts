/**
 * deriveWorkspaceElements — pure derivation for the Ops Workspace (C-WP1).
 *
 * The lean transcript truncates tool RESULTS to ~500 chars (see
 * server/agents/transcript-lean.ts), so results are NOT a data source — the
 * one exception is queue_draft, whose results are small and parse via
 * parseQueueDraftResult. Instead, tool_call steps are SIGNALS: a
 * get_board_snapshot call means "the agent looked at the board", so the
 * workspace shows the live board itself. Tool INPUTS are small and survive
 * the lean shaper, so pipeline/availability calls carry their own props.
 *
 * Scans chronologically (oldest → newest); the last signal wins both the
 * per-tab props and `latest`, so `latest` is always the tab of the most
 * recent signal. Kept free of JSX/react so it can be exercised with npx tsx.
 */
import type { LeanRunStep, QueueDraftToolResult } from '@shared/ops-types';
import { parseQueueDraftResult } from '../DraftApprovalCard';

export type WorkspaceTabId = 'board' | 'pipeline' | 'availability' | 'drafts';

export interface WorkspaceElements {
    /** Any get_board_snapshot / get_desk tool_call seen → Board tab. */
    board: boolean;
    /** Props from the most recent get_pipeline_snapshot call (tab defaults 'all'). */
    pipeline: { tab: string } | null;
    /** Props from the most recent get_contractor_availability call. */
    availability: { dates: string[]; contractorId?: string } | null;
    /** Every queue_draft result in the session — pending first, newest first within status. */
    drafts: QueueDraftToolResult[];
    /** Tab of the most recent signal, null when the session has none. */
    latest: WorkspaceTabId | null;
    /** Total signals seen — lets the shell detect NEW signals arriving on a live run. */
    signalCount: number;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

export function deriveWorkspaceElements(steps: LeanRunStep[]): WorkspaceElements {
    let board = false;
    let pipeline: WorkspaceElements['pipeline'] = null;
    let availability: WorkspaceElements['availability'] = null;
    const drafts: Array<{ draft: QueueDraftToolResult; seq: number }> = [];
    let latest: WorkspaceTabId | null = null;
    let signalCount = 0;

    for (const step of steps) {
        if (step.type === 'tool_call') {
            if (step.tool === 'get_board_snapshot' || step.tool === 'get_desk') {
                board = true;
                latest = 'board';
                signalCount++;
            } else if (step.tool === 'get_pipeline_snapshot') {
                const input = asRecord(step.input);
                pipeline = { tab: typeof input.tab === 'string' && input.tab ? input.tab : 'all' };
                latest = 'pipeline';
                signalCount++;
            } else if (step.tool === 'get_contractor_availability') {
                const input = asRecord(step.input);
                const dates = Array.isArray(input.dates)
                    ? input.dates.filter((d): d is string => typeof d === 'string')
                    : [];
                const contractorId = typeof input.contractorId === 'string' ? input.contractorId
                    : typeof input.contractorId === 'number' ? String(input.contractorId)
                        : undefined;
                availability = contractorId !== undefined ? { dates, contractorId } : { dates };
                latest = 'availability';
                signalCount++;
            }
            continue;
        }
        if (step.type === 'tool_result' && step.tool === 'queue_draft') {
            const parsed = parseQueueDraftResult(step.result);
            if (!parsed) continue;
            // A durable transcript can replay a step the live stream already
            // delivered — dedupe by draftId (refusals have none; keep them all).
            if (parsed.draftId && drafts.some((d) => d.draft.draftId === parsed.draftId)) continue;
            drafts.push({ draft: parsed, seq: drafts.length });
            latest = 'drafts';
            signalCount++;
        }
    }

    const rank = (d: { draft: QueueDraftToolResult }) => (d.draft.status === 'pending' ? 0 : 1);
    drafts.sort((a, b) => rank(a) - rank(b) || b.seq - a.seq);

    return {
        board,
        pipeline,
        availability,
        drafts: drafts.map((d) => d.draft),
        latest,
        signalCount,
    };
}
