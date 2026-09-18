/**
 * Handy Desk - the registry of changes the ask agent may propose, one entry per `ConfirmKind`
 * (shared/ops-types.ts). actions.ts is the only caller: it proposes through `preconditions` and
 * `preview`, and on Ben's confirm re-runs both and then `execute`.
 *
 * Adding a kind: write its definition in kinds/<kind>.ts and name it below. Its executor calls the
 * desk's one sender (desk/sender.ts `send`, through desk/human-reply.ts for a person's words) or the
 * one existing function for the change, never an admin HTTP route, never the old desk. It reads the
 * file it is given, changes it in place, and returns; actions.ts puts the file back to its store and
 * writes the audit. A kind that is absent here is refused at propose and at confirm; booking.create
 * stays absent until design-map Q8 is answered, and no kind ever hands a thread kept with a person
 * back to the desk (answer 114: that switch is Ben's, on the thread view).
 */
import type { ConfirmKind, OpsOutgoing } from '@shared/ops-types';
import type { ApproverSlot, CaseFile } from '../desk/case-file';
import type { HumanApprover } from '../../approver';
import type { BoardSource } from '../api/store';
import { draftRelease } from './kinds/draft-release';
import { quoteSetLine } from './kinds/quote-set-line';

/** What a kind reads while proposing or confirming. */
export interface ActionContext {
    src: BoardSource;
    /** The case file the arguments name, as the store holds it now; null for a kind with no file. */
    file: CaseFile | null;
    now: Date;
    /** The signed-in person's slot. */
    approver: ApproverSlot;
    /** The signed-in person: their email or user id. */
    person: string;
}

/** What a kind's executor is handed on Ben's confirm. */
export interface ExecuteContext extends ActionContext {
    /** The run id the change goes out under, minted per confirm. */
    runId: string;
    /** `human:<email or user id>`. */
    approverName: HumanApprover;
    /** The preview Ben confirmed: the executor refuses when the file no longer gives exactly this. */
    expectedPreview: string;
    mode: BoardSource['mode'];
}

export type PreviewResult = { ok: true; text: string; outgoing?: OpsOutgoing[] } | { ok: false; reason: string };

export type ExecuteResult =
    | {
        ok: true;
        /** What the change did, stored on the proposal and returned to the page. Bubbles as `{ text }` objects. */
        result: Record<string, unknown>;
        /** A kind that sends nothing: the case file's system line, without the "by <person>" tail. */
        audit?: string;
    }
    | { ok: false; reason: string };

export interface ActionKindDef<A = any> {
    kind: ConfirmKind;
    /** The confirm button's words. */
    label: string;
    /** True when the change is a customer message: its send record is its audit. */
    sends: boolean;
    /** The arguments as the kind reads them, or null when they do not fit. Run on the model's input and on the stored copy. */
    parseArgs(raw: unknown): A | null;
    caseFileOf(args: A): string | null;
    /** A refusal reason, or null when the change may go ahead. */
    preconditions(ctx: ActionContext, args: A): Promise<string | null>;
    /** Exactly what Ben is shown and confirms; recomputed at confirm and compared by hash. */
    preview(ctx: ActionContext, args: A): Promise<PreviewResult>;
    execute(ctx: ExecuteContext, args: A): Promise<ExecuteResult>;
}

export type ActionKinds = Partial<Record<ConfirmKind, ActionKindDef>>;

export const ACTION_KINDS: ActionKinds = {
    'draft.release': draftRelease,
    'quote.set_line': quoteSetLine,
};
