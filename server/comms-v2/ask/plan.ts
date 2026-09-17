/**
 * Handy Desk - the plan strip over a multi-step ask (ask-agent specification N14, answer A5).
 *
 * The reasoner names the steps of what Ben asked (give_answer's `plan`) and says which it has
 * finished; the router's `steps` stand in only for a run that proposed nothing and was refused
 * nothing, since they carry no done flags. Where a change stands is never the model's to say: the
 * step waiting on a confirm, or refused, is set here from the proposal itself. A plan of one step is
 * not shown. The strip is stored on the answer of the assistant message that offered it, and moves
 * with its proposal (`planAfter`) when Ben confirms or cancels; a refused step drops every step
 * after it, which is never re-planned silently. No step is ever dropped for length: the chain runs
 * through every step, bounded only by the reasoner's turn limit.
 */
import type { AskActionStatus, PlanStep } from '@shared/ops-types';

const LABEL_CAP = 80;

export interface PlannedStep { label: string; done: boolean }

export interface BuildPlanInput {
    steps: PlannedStep[];
    /** The proposal this run made, if any. */
    proposal?: { id: string } | null;
    /** The refusal that stopped this run's change, verbatim, if any. */
    refusal?: string | null;
}

export function cleanSteps(raw: unknown): PlannedStep[] {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((s): PlannedStep[] => {
        const label = typeof s === 'string' ? s : typeof s?.label === 'string' ? s.label : '';
        const clean = label.replace(/\s+/g, ' ').trim().slice(0, LABEL_CAP);
        return clean ? [{ label: clean, done: typeof s === 'object' && s?.done === true }] : [];
    });
}

/** The strip for an answer, or undefined when there is nothing to chain. */
export function buildPlan(input: BuildPlanInput): PlanStep[] | undefined {
    if (input.steps.length < 2) return undefined;
    let pivot = input.steps.findIndex((s) => !s.done);
    const plan: PlanStep[] = input.steps.map((s) => ({ label: s.label, state: s.done ? 'done' : 'waiting' }));
    if (pivot === -1) {
        if (!input.proposal && !input.refusal) return plan;
        // The model marked every step done but a change still waits: that change is the last step.
        pivot = plan.length - 1;
    }
    if (input.refusal) {
        plan[pivot] = { label: plan[pivot].label, state: 'refused', reason: input.refusal };
        for (let i = pivot + 1; i < plan.length; i++) plan[i] = { label: plan[i].label, state: 'dropped' };
    } else if (input.proposal) {
        plan[pivot] = { label: plan[pivot].label, state: 'current', actionId: input.proposal.id };
    }
    return plan;
}

/** The strip once its proposal has moved on. Unchanged when no step names the action. */
export function planAfter(plan: PlanStep[], action: { id: string; status: AskActionStatus; result: Record<string, unknown> | null }): PlanStep[] {
    const at = plan.findIndex((s) => s.actionId === action.id);
    if (at === -1) return plan;
    const next = plan.map((s) => ({ ...s }));
    if (action.status === 'executed') next[at] = { label: next[at].label, state: 'done', actionId: action.id };
    else if (action.status === 'proposed' || action.status === 'confirmed') next[at] = { label: next[at].label, state: 'current', actionId: action.id };
    else {
        const reason = typeof action.result?.reason === 'string' ? action.result.reason : `the change was ${action.status}`;
        next[at] = { label: next[at].label, state: 'refused', actionId: action.id, reason };
        for (let i = at + 1; i < next.length; i++) if (next[i].state === 'waiting' || next[i].state === 'current') next[i] = { label: next[i].label, state: 'dropped' };
    }
    return next;
}

/** The steps still to do after an executed change, for the next run of the chain. */
export function remainingAfter(plan: PlanStep[], actionId: string): PlanStep[] {
    const at = plan.findIndex((s) => s.actionId === actionId);
    return at === -1 ? [] : plan.slice(at + 1).filter((s) => s.state === 'waiting');
}
