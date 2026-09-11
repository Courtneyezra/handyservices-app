/**
 * A person's reply from Ben's board, through the desk's one sender (Contract 5, behaviour.md
 * answers 29 and 43): Ben writes to the customer in his own words, the desk never rewrites them,
 * and they go out as a human-authored send with Ben as approver and a fresh run id. The approver is
 * the signed-in person, `human:<their email or user id>` as server/approver.ts defines it, so a
 * slot two people share still records which of them wrote the words. The send lands on the file as
 * Ben's turn (an outbound turn carrying that approver), any hold clears with Ben's words as the
 * release, and the thread is back with automation (checklist 7.4: a thread comes back to
 * automation when any human replies): the next customer turn is the desk's again.
 *
 * The eight guards of Contract 4 do not run over his words (answer 43). They exist to stop the
 * composer inventing a figure, a date, a commitment or a claim about the business; Ben is the
 * source they check against, so over his own words they have nothing to say. The record is honest
 * without any extra field: the send carries the `human:<person>` approver, which no automated path
 * can produce, and no send record stores a guard result, so nothing claims a pass.
 *
 * A human reply is not checked, but it is recorded. The ask ledger and `callOffered` are
 * bookkeeping of what the business has already said, not a check on what may go, and they are the
 * one place the never-ask-twice rule lives: the same text detectors the desk runs over its own
 * reply (`textAsks`, `offersCall`) run over Ben's, so the desk does not ask the customer for a
 * photo Ben has just asked for or offer a call he has just promised.
 *
 * What else holds is everything the sender owns: the window rule, so a shut window never carries
 * freeform words; an approver and a run id on every send; the party being on the file; and one run
 * id sending once. A refusal sends nothing and records nothing, and comes back with its reason for
 * the board to show Ben, never a silent hold.
 */
import { randomUUID } from 'node:crypto';
import { ask as ledgerAsk, release as releaseHold, sameApprover, approverLabel, type ApproverSlot, type CaseFile, type CaseFileDeps, type HoldRelease, type Party, type RenderedBubble, type ReplyChannel, type Turn } from './case-file';
import { approverFor } from './guards';
import { offersCall, textAsks } from './lexicon';
import { BUBBLE_CEILING, chooseChannel, render, send, windowOf, type SenderDeps } from './sender';
import { humanApprover, type Approver } from '../../approver';

export interface HumanReplyInput {
    file: CaseFile;
    /** The slot the signed-in session occupies (server/comms-v2/api/approvers.ts). A person, never a rule. */
    approver: ApproverSlot;
    /** Who that session is: their email or user id, the identity the send and the turn record. */
    person: string;
    /** Ben's words, sent as typed: a blank line is a bubble break, and his line breaks inside one are kept. */
    words: string;
}

export interface HumanReplyDeps extends CaseFileDeps {
    mode?: 'dry_run' | 'live';
    sender?: SenderDeps;
}

/** What went, for the board to show back: not a desk turn, so it carries no guards and no route. */
export interface HumanSend {
    runId: string;
    approver: Approver;
    channel: ReplyChannel;
    bubbles: RenderedBubble[];
    turnId: string;
}

export type HumanReplyOutcome =
    | { ok: true; result: HumanSend; release: HoldRelease | null }
    /** Nothing sent, nothing recorded; the reason is the board's to show. */
    | { ok: false; reason: string };

/** The newest inbound turn: what the customer last said, which Ben's reply answers. */
function lastCustomerTurn(file: CaseFile, partyId: string): Turn | null {
    for (let i = file.turns.length - 1; i >= 0; i--) {
        const t = file.turns[i];
        if (t.partyId === partyId && t.direction === 'inbound') return t;
    }
    return null;
}

/**
 * Ben's reply to the customer, through the one sender. Refuses: no words; a rule-based approver;
 * a slot that is not the one this file answers to, its hold's approver when one stands and
 * `approverFor`'s slot otherwise; no customer turn to answer; a render the sender refuses (over the
 * bubble ceiling, or a channel the desk cannot render); a shut window (a shut window never
 * produces freeform text, Contract 5); and whatever the sender itself refuses.
 */
export async function humanReply(input: HumanReplyInput, deps: HumanReplyDeps = {}): Promise<HumanReplyOutcome> {
    const now = deps.now ?? (() => new Date());
    const runId = `run_${randomUUID()}`;
    const { file, approver } = input;
    const words = input.words.replace(/\r\n/g, '\n').trim();
    const party: Party = file.parties.find((p) => p.role !== 'internal') ?? file.parties[0];
    const refuse = (reason: string): HumanReplyOutcome => ({ ok: false, reason });

    if (approver.kind !== 'human') return refuse('only a person answers from the board; a rule-based approver has no words');
    if (!words) return refuse('a reply needs words');
    const owner = file.hold?.approver ?? approverFor(file, null);
    if (!sameApprover(owner, approver)) return refuse(`only ${approverLabel(owner)} may answer this file`);
    const turn = lastCustomerTurn(file, party.personId);
    if (!turn) return refuse('no customer turn to answer');
    const approverName = humanApprover(input.person);

    // Channel, render, window: as the sender renders a composed reply, with nothing reflowed or rewritten.
    const choice = chooseChannel(party, turn.channel);
    if (!choice.ok) return refuse(choice.reason);
    const rendered = render(choice.channel, words, { asTyped: true });
    if (!rendered.ok) {
        const why = rendered.reason === 'ceiling' ? `the reply renders to ${rendered.bubbles.length} bubbles, over the ceiling of ${BUBBLE_CEILING}; shorten it or use fewer blank lines` : rendered.reason === 'channel' ? `no render for ${choice.channel}: the desk replies on WhatsApp only` : 'the reply rendered to nothing';
        return refuse(why);
    }
    const window = windowOf(party, choice.channel, now());
    if (window.state === 'shut') return refuse(`the ${choice.channel} window is shut (${window.reason}); a shut window never carries freeform words, so this reply cannot go until the customer writes again`);

    // The one sender, with Ben as approver and a fresh run id. No guards: a person's own words are his (answer 43).
    const sent = await send({ file, partyId: party.personId, channel: choice.channel, window, bubbles: rendered.bubbles, template: null, runId, approver: approverName, guards: null, factIds: [], kbIds: [], fixedLines: [], calls: [], mode: deps.mode ?? 'dry_run' }, { ...deps.sender, now, newId: deps.newId });
    if (!sent.ok) return refuse(`send refused: ${sent.reason}`);

    // What the business has now said: the ledger and callOffered, from the same detectors the desk runs over its own reply.
    const fileDeps: CaseFileDeps = { now, newId: deps.newId };
    for (const subject of ['media', 'postcode', 'access'] as const) if (textAsks(words, subject)) ledgerAsk(file, subject, fileDeps);
    if (offersCall(words)) party.callOffered = true;

    // The hold clears with Ben's words as the release; with no hold there is nothing to clear. Either way the thread is automation's again.
    let release: HoldRelease | null = null;
    if (file.hold) {
        const rel = releaseHold(file, approver, words, fileDeps);
        if (rel.ok) release = rel.value;
    }

    return { ok: true, result: { runId, approver: approverName, channel: choice.channel, bubbles: rendered.bubbles, turnId: sent.record.turnId }, release };
}
