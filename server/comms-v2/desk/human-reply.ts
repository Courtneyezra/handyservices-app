/**
 * A person's reply from Ben's board, through the desk's one sender (Contract 5, behaviour.md
 * answer 29): Ben writes to the customer in his own words, the desk never rewrites them, the
 * guards run over them exactly as over a composed reply, and on pass the reply goes out as a
 * human-authored send with Ben as approver and a fresh run id. The send lands on the file as
 * Ben's turn (an outbound turn carrying approver `human:ben`), any hold clears with Ben's words as
 * the release, and the thread is back with automation (checklist 7.4: a thread comes back to
 * automation when any human replies): the next customer turn is the desk's again.
 *
 * On a guard failure nothing is sent and nothing is recorded; the failures come back for the
 * board to show Ben, never a silent hold. There is no bypass of the content guards for a person:
 * a figure Ben types passes only when it equals a line of the live quote he cites (answer 23), so
 * the board lets him pick the quote line; a date needs a diary fact; a claim about the business
 * needs its reviewed row; a regulated turn still wants the fixed line.
 *
 * One rule of this path's own, on the one-reply guard: that guard paces the desk (one composed
 * reply per customer turn). When the desk has already replied to the customer's last turn - the
 * money reply that says Ben will come back on the price, or the fixed acknowledgement that Ben
 * will come back - Ben's reply is the promised follow-up, not a second desk reply, so that guard's
 * failure is recorded as passed with a note saying so. When the last outbound turn is already a
 * person's, the guard stands: one human reply per customer turn, as for the desk.
 */
import { randomUUID } from 'node:crypto';
import { release as releaseHold, sameApprover, approverLabel, type ApproverSlot, type CaseFile, type CaseFileDeps, type HoldRelease, type Party, type Turn } from './case-file';
import type { DeskResult, GuardName, GuardVerdict } from './desk-types';
import { fixedLine, knowledgeBaseFixedLines, type FixedLine, type FixedLineSource } from './fixed-lines';
import { runGuards, type GuardOutcome } from './guards';
import { regulatedMatch } from './lexicon';
import { BUBBLE_CEILING, chooseChannel, render, send, windowOf, type SenderDeps } from './sender';
import type { Approver } from '../../approver';

export interface HumanReplyInput {
    file: CaseFile;
    /** The slot the signed-in session occupies (server/comms-v2/api/approvers.ts). A person, never a rule. */
    approver: ApproverSlot;
    /** Ben's words, sent as typed. A blank line is a bubble break, as for the composer. */
    words: string;
    /** Facts on the file the reply cites: the quote lines behind any figure it carries. */
    factIds?: string[];
}

export interface HumanReplyDeps extends CaseFileDeps {
    mode?: 'dry_run' | 'live';
    sender?: SenderDeps;
    fixedLines?: FixedLineSource;
}

export type HumanReplyOutcome =
    | { ok: true; result: DeskResult; release: HoldRelease | null; failures: [] }
    /** Nothing sent, nothing recorded. `failures` names every guard that failed; `result` carries the verdicts for the planned send. */
    | { ok: false; reason: string; failures: string[]; result: DeskResult; release: null };

/** The approver name a person's send carries, in the exit's own enum (server/approver.ts). */
export function humanApproverName(slot: ApproverSlot): Approver {
    return `human:${slot.id}`;
}

export function isHumanApproverName(approver: string | null | undefined): boolean {
    return typeof approver === 'string' && approver.startsWith('human:');
}

/** The newest inbound turn: what the customer last said, which Ben's reply answers. */
function lastCustomerTurn(file: CaseFile, partyId: string): Turn | null {
    for (let i = file.turns.length - 1; i >= 0; i--) {
        const t = file.turns[i];
        if (t.partyId === partyId && t.direction === 'inbound') return t;
    }
    return null;
}

/** The newest outbound turn to the party, if any. */
function lastReplyTo(file: CaseFile, partyId: string): Turn | null {
    for (let i = file.turns.length - 1; i >= 0; i--) {
        const t = file.turns[i];
        if (t.partyId === partyId && t.direction === 'outbound') return t;
    }
    return null;
}

function passGuards(): Record<GuardName, GuardVerdict> {
    const v = (): GuardVerdict => ({ result: 'pass', note: null });
    return { figure: v(), date_time_duration: v(), commitment_fault: v(), business_claim: v(), disclosure: v(), one_reply: v(), ask_ledger: v(), regulated: v() };
}

function nothing(file: CaseFile, party: Party, runId: string, approver: string, note: string, now: Date, guards: Record<GuardName, GuardVerdict> = passGuards(), factIds: string[] = []): DeskResult {
    const window = windowOf(party, 'whatsapp', now);
    return { runId, decision: 'none', partyId: party.personId, channel: null, windowState: window.state, templateId: null, bubbles: [], factIds, kbIds: [], guards, approver, hold: file.hold, delivered: false, stageAfter: file.stage, calls: [], note, summary: 'human reply from the board', error: null, landedTurnId: null, composerCalls: 0 };
}

/**
 * Ben's reply to the customer, through the one sender. Refuses: no words; a rule-based approver;
 * a hold named for someone else; no customer turn to answer; a guard failure; a render the sender
 * refuses (over the bubble ceiling, or a channel the desk cannot render); a shut window (a shut
 * window never produces freeform text, Contract 5); and whatever the sender itself refuses.
 */
export async function humanReply(input: HumanReplyInput, deps: HumanReplyDeps = {}): Promise<HumanReplyOutcome> {
    const now = deps.now ?? (() => new Date());
    const runId = `run_${randomUUID()}`;
    const { file, approver } = input;
    const words = input.words.replace(/\r\n/g, '\n').trim();
    const factIds = Array.from(new Set((input.factIds ?? []).filter((id) => typeof id === 'string' && id.trim())));
    const party: Party = file.parties.find((p) => p.role !== 'internal') ?? file.parties[0];
    const refuse = (reason: string, failures: string[] = [], guards?: Record<GuardName, GuardVerdict>): HumanReplyOutcome => ({ ok: false, reason, failures, result: nothing(file, party, runId, approver.kind === 'human' ? humanApproverName(approver) : approverLabel(approver), reason, now(), guards, factIds), release: null });

    if (approver.kind !== 'human') return refuse('only a person answers from the board; a rule-based approver has no words');
    if (!words) return refuse('a reply needs words');
    if (file.hold && !sameApprover(file.hold.approver, approver)) return refuse(`only ${approverLabel(file.hold.approver)} may answer while this hold stands`);
    const turn = lastCustomerTurn(file, party.personId);
    if (!turn) return refuse('no customer turn to answer');
    const known = new Set(file.facts.map((f) => f.id));
    const unknown = factIds.filter((id) => !known.has(id));
    if (unknown.length) return refuse(`facts cited that are not on the file: ${unknown.join(', ')}`);
    const approverName = humanApproverName(approver);

    // The guards, unchanged. A regulated turn wants the fixed line, so it is on the shelf for the reply to carry.
    const fixedLines: FixedLine[] = regulatedMatch(turn.body) ? [await fixedLine('gas', deps.fixedLines ?? knowledgeBaseFixedLines)] : [];
    const raw = runGuards({ file, party, turn, reply: words, factIds, kbIds: [], kbRows: [], fixedLines, proposedSubject: null });
    const guards: GuardOutcome = promisedFollowUp(file, party, raw);
    if (!guards.ok) return refuse(`the reply failed ${guards.failures.length === 1 ? 'a guard' : `${guards.failures.length} guards`}: ${guards.failures.join('; ')}`, guards.failures, guards.guards);

    // Channel, render, window: as the sender renders a composed reply, with nothing rewritten.
    const choice = chooseChannel(party, turn.channel);
    if (!choice.ok) return refuse(choice.reason, [], guards.guards);
    const rendered = render(choice.channel, words);
    if (!rendered.ok) {
        const why = rendered.reason === 'ceiling' ? `the reply renders to ${rendered.bubbles.length} bubbles, over the ceiling of ${BUBBLE_CEILING}; shorten it or use fewer blank lines` : rendered.reason === 'channel' ? `no render for ${choice.channel}: the desk replies on WhatsApp only` : 'the reply rendered to nothing';
        return refuse(why, [], guards.guards);
    }
    const window = windowOf(party, choice.channel, now());
    if (window.state === 'shut') return refuse(`the ${choice.channel} window is shut (${window.reason}); a shut window never carries freeform words, so this reply cannot go until the customer writes again`, [], guards.guards);

    // The one sender, with Ben as approver and a fresh run id.
    const sent = await send({ file, partyId: party.personId, channel: choice.channel, window, bubbles: rendered.bubbles, template: null, runId, approver: approverName, guards, factIds, kbIds: [], fixedLines, calls: [], mode: deps.mode ?? 'dry_run' }, { ...deps.sender, now, newId: deps.newId });
    if (!sent.ok) return refuse(`send refused: ${sent.reason}`, [], guards.guards);

    // The hold clears with Ben's words as the release; with no hold there is nothing to clear. Either way the thread is automation's again.
    let release: HoldRelease | null = null;
    if (file.hold) {
        const rel = releaseHold(file, approver, words, { now, newId: deps.newId });
        if (rel.ok) release = rel.value;
    }

    const result: DeskResult = {
        runId, decision: 'send', partyId: party.personId, channel: choice.channel, windowState: window.state, templateId: null, bubbles: rendered.bubbles,
        factIds, kbIds: [], guards: guards.guards, approver: approverName, hold: file.hold, delivered: true, stageAfter: file.stage,
        calls: [], note: null, summary: `human reply from the board by ${approverName}${release ? `; hold released (${release.reason})` : ''}`, error: null, landedTurnId: sent.record.turnId, composerCalls: 0,
    };
    return { ok: true, result, release, failures: [] };
}

/**
 * The one-reply guard, read for a person: the desk's own reply to the customer's last turn does
 * not make Ben's the second one, because the desk said he would come back. A second reply from a
 * person with no customer turn in between stays refused.
 */
function promisedFollowUp(file: CaseFile, party: Party, raw: GuardOutcome): GuardOutcome {
    if (raw.guards.one_reply.result !== 'fail') return raw;
    const last = lastReplyTo(file, party.personId);
    if (!last || isHumanApproverName(last.approver)) {
        return { ...raw, guards: { ...raw.guards, one_reply: { result: 'fail', note: 'you have already replied to this message; wait for the customer to write back' } }, failures: raw.failures.map((f) => (f.startsWith('one_reply:') ? 'one_reply: you have already replied to this message; wait for the customer to write back' : f)) };
    }
    const guards = { ...raw.guards, one_reply: { result: 'pass' as const, note: 'the desk replied that Ben would come back; this is that reply' } };
    const failures = raw.failures.filter((f) => !f.startsWith('one_reply:'));
    return { ok: failures.length === 0, guards, failures };
}
