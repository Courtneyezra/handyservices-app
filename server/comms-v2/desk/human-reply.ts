/**
 * A person's reply from Ben's board, through the desk's one sender (Contract 5, behaviour.md
 * answers 29 and 43): Ben writes to the customer in his own words, the desk never rewrites them,
 * and they go out as a human-authored send with Ben as approver and a fresh run id. The send lands
 * on the file as Ben's turn (an outbound turn carrying approver `human:ben`), any hold clears with
 * Ben's words as the release, and the thread is back with automation (checklist 7.4: a thread
 * comes back to automation when any human replies): the next customer turn is the desk's again.
 *
 * The eight guards of Contract 4 do not run over his words (answer 43). They exist to stop the
 * composer inventing a figure, a date, a commitment or a claim about the business; Ben is the
 * source they check against, so over his own words they have nothing to say. The send records that
 * honestly: the author is a person and every guard is recorded as not applied, never as a pass it
 * never ran.
 *
 * What does hold is everything the sender owns: the window rule, so a shut window never carries
 * freeform words; an approver and a run id on every send; the party being on the file; and one run
 * id sending once. A refusal sends nothing and records nothing, and comes back with its reason for
 * the board to show Ben, never a silent hold.
 */
import { randomUUID } from 'node:crypto';
import { release as releaseHold, sameApprover, approverLabel, type ApproverSlot, type CaseFile, type CaseFileDeps, type HoldRelease, type Party, type Turn } from './case-file';
import type { DeskResult } from './desk-types';
import { guardsNotApplied } from './guards';
import { BUBBLE_CEILING, chooseChannel, render, send, windowOf, type SenderDeps } from './sender';
import { humanApprover, type Approver } from '../../approver';

export interface HumanReplyInput {
    file: CaseFile;
    /** The slot the signed-in session occupies (server/comms-v2/api/approvers.ts). A person, never a rule. */
    approver: ApproverSlot;
    /** Ben's words, sent as typed. A blank line is a bubble break, as for the composer. */
    words: string;
}

export interface HumanReplyDeps extends CaseFileDeps {
    mode?: 'dry_run' | 'live';
    sender?: SenderDeps;
}

export type HumanReplyOutcome =
    | { ok: true; result: DeskResult; release: HoldRelease | null }
    /** Nothing sent, nothing recorded; `result` carries the planned send that did not go. */
    | { ok: false; reason: string; result: DeskResult; release: null };

/** The approver name a person's send carries, in the exit's own enum (server/approver.ts). */
export function humanApproverName(slot: ApproverSlot): Approver {
    return humanApprover(slot.id);
}

/** The newest inbound turn: what the customer last said, which Ben's reply answers. */
function lastCustomerTurn(file: CaseFile, partyId: string): Turn | null {
    for (let i = file.turns.length - 1; i >= 0; i--) {
        const t = file.turns[i];
        if (t.partyId === partyId && t.direction === 'inbound') return t;
    }
    return null;
}

function nothing(file: CaseFile, party: Party, runId: string, approver: string, note: string, now: Date): DeskResult {
    const window = windowOf(party, 'whatsapp', now);
    return { runId, decision: 'none', partyId: party.personId, channel: null, windowState: window.state, templateId: null, bubbles: [], factIds: [], kbIds: [], guards: guardsNotApplied(), approver, hold: file.hold, delivered: false, stageAfter: file.stage, calls: [], note, summary: 'human reply from the board', error: null, landedTurnId: null, composerCalls: 0 };
}

/**
 * Ben's reply to the customer, through the one sender. Refuses: no words; a rule-based approver;
 * a hold named for someone else; no customer turn to answer; a render the sender refuses (over the
 * bubble ceiling, or a channel the desk cannot render); a shut window (a shut window never
 * produces freeform text, Contract 5); and whatever the sender itself refuses.
 */
export async function humanReply(input: HumanReplyInput, deps: HumanReplyDeps = {}): Promise<HumanReplyOutcome> {
    const now = deps.now ?? (() => new Date());
    const runId = `run_${randomUUID()}`;
    const { file, approver } = input;
    const words = input.words.replace(/\r\n/g, '\n').trim();
    const party: Party = file.parties.find((p) => p.role !== 'internal') ?? file.parties[0];
    const refuse = (reason: string): HumanReplyOutcome => ({ ok: false, reason, result: nothing(file, party, runId, approver.kind === 'human' ? humanApproverName(approver) : approverLabel(approver), reason, now()), release: null });

    if (approver.kind !== 'human') return refuse('only a person answers from the board; a rule-based approver has no words');
    if (!words) return refuse('a reply needs words');
    if (file.hold && !sameApprover(file.hold.approver, approver)) return refuse(`only ${approverLabel(file.hold.approver)} may answer while this hold stands`);
    const turn = lastCustomerTurn(file, party.personId);
    if (!turn) return refuse('no customer turn to answer');
    const approverName = humanApproverName(approver);

    // Channel, render, window: as the sender renders a composed reply, with nothing rewritten.
    const choice = chooseChannel(party, turn.channel);
    if (!choice.ok) return refuse(choice.reason);
    const rendered = render(choice.channel, words);
    if (!rendered.ok) {
        const why = rendered.reason === 'ceiling' ? `the reply renders to ${rendered.bubbles.length} bubbles, over the ceiling of ${BUBBLE_CEILING}; shorten it or use fewer blank lines` : rendered.reason === 'channel' ? `no render for ${choice.channel}: the desk replies on WhatsApp only` : 'the reply rendered to nothing';
        return refuse(why);
    }
    const window = windowOf(party, choice.channel, now());
    if (window.state === 'shut') return refuse(`the ${choice.channel} window is shut (${window.reason}); a shut window never carries freeform words, so this reply cannot go until the customer writes again`);

    // The one sender, with Ben as approver and a fresh run id. No guards: a person's own words are his (answer 43).
    const sent = await send({ file, partyId: party.personId, channel: choice.channel, window, bubbles: rendered.bubbles, template: null, runId, approver: approverName, guards: null, factIds: [], kbIds: [], fixedLines: [], calls: [], mode: deps.mode ?? 'dry_run' }, { ...deps.sender, now, newId: deps.newId });
    if (!sent.ok) return refuse(`send refused: ${sent.reason}`);

    // The hold clears with Ben's words as the release; with no hold there is nothing to clear. Either way the thread is automation's again.
    let release: HoldRelease | null = null;
    if (file.hold) {
        const rel = releaseHold(file, approver, words, { now, newId: deps.newId });
        if (rel.ok) release = rel.value;
    }

    const result: DeskResult = {
        runId, decision: 'send', partyId: party.personId, channel: choice.channel, windowState: window.state, templateId: null, bubbles: rendered.bubbles,
        factIds: [], kbIds: [], guards: guardsNotApplied(), approver: approverName, hold: file.hold, delivered: true, stageAfter: file.stage,
        calls: [], note: null, summary: `human reply from the board by ${approverName}${release ? `; hold released (${release.reason})` : ''}`, error: null, landedTurnId: sent.record.turnId, composerCalls: 0,
    };
    return { ok: true, result, release };
}
