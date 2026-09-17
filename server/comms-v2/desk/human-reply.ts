/**
 * A person's reply from Ben's board, through the desk's one sender (Contract 5, behaviour.md
 * answers 29 and 43): Ben writes to the customer in his own words, the desk never rewrites them,
 * and they go out as a human-authored send with Ben as approver and a fresh run id (or the ask confirm's own). The approver is
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
 * one place the never-ask-twice rule lives, so the desk does not ask the customer for a photo Ben
 * has just asked for or offer a call he has just promised. His prose is read more tightly than a
 * composed reply (`clauseAsks`, not `textAsks`): the subject and the asking phrase must fall in one
 * clause, because the cost of missing an ask he made is one repeated question, while the cost of
 * reading one into "I will be in touch later today, what is the best number for you?" is a job
 * where nobody ever asks about access.
 *
 * What else holds is everything the sender owns: the window rule, so a shut window never carries
 * freeform words; an approver and a run id on every send; the party being on the file; and one run
 * id sending once. A refusal sends nothing and records nothing, and comes back with its reason for
 * the board to show Ben, never a silent hold.
 */
import { randomUUID } from 'node:crypto';
import { ask as ledgerAsk, release as releaseHold, sameApprover, approverLabel, type ApproverSlot, type CaseFile, type CaseFileDeps, type HoldRelease, type Party, type RenderedBubble, type ReplyChannel, type Turn } from './case-file';
import { approverFor } from './guards';
import { clauseAsks, offersCall } from './lexicon';
import { isHeldAckText } from './fixed-lines';
import { chooseChannel, DESK_APPROVER, liveTemplateStatus, pickTemplate, render, send, shortenBriefFor, windowOf, type TemplateSend, type TemplateStatusSource, type WindowState } from './sender';
import { humanApprover, type Approver } from '../../approver';
import { HELD_DRAFT_CHANGED } from '@shared/ops-types';

export interface HumanReplyInput {
    file: CaseFile;
    /** The slot the signed-in session occupies (server/comms-v2/api/approvers.ts). A person, never a rule. */
    approver: ApproverSlot;
    /** Who that session is: their email or user id, the identity the send and the turn record. */
    person: string;
    /** Ben's words, sent as typed: a blank line is a bubble break, and his line breaks inside one are kept. */
    words: string;
    /** Dry run lands the words on the thread; live delivers them through the one outbound send. The board passes the mode of the store it reads (api/store.ts). */
    mode?: 'dry_run' | 'live';
    /**
     * The words are the desk's own held draft, not typed by the person: rendered as the desk renders
     * its own replies (bubbles of about 160 characters, answer 93; the email greeting and sign-off;
     * SMS punctuation), and only as typed words are when that is all that fits.
     */
    deskDraft?: boolean;
    /** The run id the send goes out under; a fresh one when absent. The ask agent's confirm passes its own, so the action and the send carry one id and one run id sends once. */
    runId?: string;
}

/** What went, for the board to show back: not a desk turn, so it carries no guards and no route. */
export interface HumanSend {
    runId: string;
    approver: Approver;
    channel: ReplyChannel;
    bubbles: RenderedBubble[];
    /** The outbound turn the send landed on the thread, as the send record carries it. */
    turnId: string | null;
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
 * Where a person's reply on this file would go: the customer, the turn it answers, the channel the
 * sender would choose and that channel's window. The one routing read behind `humanReply`,
 * `sendWindowTemplate` and the board's detail (api/board.ts `detailOf`), so the thread's header can
 * never name a channel or a window the send would not use. Refuses with the send's own words.
 */
export type ReplyRoute =
    | { ok: true; party: Party; turn: Turn; channel: ReplyChannel; window: WindowState }
    | { ok: false; reason: string };

export function replyRouteOf(file: CaseFile, now: Date): ReplyRoute {
    const party: Party = file.parties.find((p) => p.role !== 'internal') ?? file.parties[0];
    const turn = party ? lastCustomerTurn(file, party.personId) : null;
    if (!turn) return { ok: false, reason: 'no customer turn to answer' };
    const choice = chooseChannel(party, turn.channel, now);
    if (!choice.ok) return { ok: false, reason: choice.reason };
    return { ok: true, party, turn, channel: choice.channel, window: windowOf(party, choice.channel, now) };
}

/** The refusal a freeform reply meets on this channel's window, or null while it is open. */
export function shutWindowRefusal(channel: ReplyChannel, window: WindowState): string | null {
    if (window.state !== 'shut') return null;
    return `the ${channel} window is shut (${window.reason}); a shut window never carries freeform words, so this reply cannot go until the customer writes again`;
}

/**
 * Ben's reply to the customer, through the one sender. Refuses: no words; a rule-based approver;
 * a slot that is not the one this file answers to, its hold's approver when one stands and
 * `approverFor`'s slot otherwise; no customer turn to answer; a render the sender refuses (over the
 * bubble ceiling, or a channel the desk cannot render); a shut window (a shut window never
 * produces freeform text, Contract 5); and whatever the sender itself refuses.
 */
export async function humanReply(input: HumanReplyInput, deps: CaseFileDeps = {}): Promise<HumanReplyOutcome> {
    const now = deps.now ?? (() => new Date());
    const runId = input.runId?.trim() || `run_${randomUUID()}`;
    const { file, approver } = input;
    const words = input.words.replace(/\r\n/g, '\n').trim();
    const fileDeps: CaseFileDeps = { now, newId: deps.newId };
    const refuse = (reason: string): HumanReplyOutcome => ({ ok: false, reason });

    if (approver.kind !== 'human') return refuse('only a person answers from the board; a rule-based approver has no words');
    if (!words) return refuse('a reply needs words');
    const owner = file.hold?.approver ?? approverFor(file, null);
    if (!sameApprover(owner, approver)) return refuse(`only ${approverLabel(owner)} may answer this file`);
    // Channel, render, window: as the sender renders a composed reply, with nothing reflowed or rewritten.
    const route = replyRouteOf(file, now());
    if (!route.ok) return refuse(route.reason);
    const { party, channel, window } = route;
    const approverName = humanApprover(input.person);

    let rendered = render(channel, words, input.deskDraft ? { name: party.name } : { asTyped: true });
    if (input.deskDraft && !rendered.ok && rendered.reason === 'ceiling') rendered = render(channel, words, { name: party.name, softWidth: true });
    if (input.deskDraft && !rendered.ok && rendered.reason === 'ceiling') rendered = render(channel, words, { asTyped: true });
    if (!rendered.ok) {
        if (rendered.reason === 'empty') return refuse('the reply rendered to nothing');
        const over = shortenBriefFor(channel, words, rendered.bubbles);
        return refuse(over.channel === 'sms'
            ? `the reply comes to ${over.measured} segments, over the ${over.ceiling} one text message may use; about ${over.charBudget} characters fit, and one curly quote or dash halves that, so plain punctuation buys room`
            : `the reply renders to ${over.measured} bubbles, over the ceiling of ${over.ceiling}; shorten it or use fewer blank lines`);
    }
    const shut = shutWindowRefusal(channel, window);
    if (shut) return refuse(shut);

    // The one sender, with Ben as approver and the run id above. No guards: a person's own words are his (answer 43).
    const sent = await send({ file, partyId: party.personId, channel: channel, window, bubbles: rendered.bubbles, template: null, runId, approver: approverName, guards: null, factIds: [], kbIds: [], fixedLines: [], calls: [], mode: input.mode ?? 'dry_run' }, fileDeps);
    if (!sent.ok) return refuse(`send refused: ${sent.reason}`);

    // What the business has now said: the ledger and callOffered, read tightly because these are his words, not a composed reply.
    for (const subject of ['media', 'postcode', 'access'] as const) if (clauseAsks(words, subject)) ledgerAsk(file, subject, fileDeps);
    if (offersCall(words)) party.callOffered = true;

    // The hold clears with Ben's words as the release; with no hold there is nothing to clear. Either way the thread is automation's again.
    let release: HoldRelease | null = null;
    if (file.hold) {
        const rel = releaseHold(file, approver, words, fileDeps);
        if (rel.ok) release = rel.value;
    }

    return { ok: true, result: { runId, approver: approverName, channel: channel, bubbles: rendered.bubbles, turnId: sent.record.turnId }, release };
}

/**
 * One tap send of the reply the desk held back, exactly as it stands. Firstmate decision
 * hsa-comms-v2-board-conversation-view: this is the same pipeline as Ben typing the words himself
 * (`humanReply` above), because a person choosing to release the desk's own draft carries the same
 * authority as a person typing his own — no separate window or approver check is invented for it.
 * The words are the desk's, so they render as the desk's own replies do (`deskDraft`): split into
 * bubbles, with the desk's punctuation rules, and otherwise unchanged. Refuses first when there is
 * no draft to send, then with `HELD_DRAFT_CHANGED` when the caller's `expectedDraft` is not the
 * draft now held, then everything `humanReply` refuses.
 */
export async function sendHeldDraft(input: Omit<HumanReplyInput, 'words'> & { expectedDraft?: string }, deps: CaseFileDeps = {}): Promise<HumanReplyOutcome> {
    const { expectedDraft, ...rest } = input;
    const draft = rest.file.hold?.draft;
    if (!draft) return { ok: false, reason: 'there is no held draft to send' };
    if (expectedDraft !== undefined && expectedDraft !== draft) return { ok: false, reason: HELD_DRAFT_CHANGED };
    return humanReply({ ...rest, words: draft, deskDraft: true }, deps);
}

export interface SendWindowTemplateInput {
    file: CaseFile;
    /** The slot the signed-in session occupies, exactly as `HumanReplyInput.approver`. */
    approver: ApproverSlot;
    person: string;
    mode?: 'dry_run' | 'live';
}

/**
 * The exact quote link the customer was already sent on this thread, read off the file's own send
 * records — never re-derived from the quote store and never re-guessed, because a link this
 * function invented could be stale or belong to a different quote. Null when no send on the file
 * ever carried the current job's quote link, which is also true of a quote that is still only a
 * draft: nothing has gone out for it yet.
 */
function sentQuoteLink(file: CaseFile): string | null {
    const slug = file.job.quoteRef;
    if (!slug) return null;
    const re = new RegExp(`https?://\\S+/quote/${slug}\\b`);
    for (let i = file.sends.length - 1; i >= 0; i--) {
        for (const b of file.sends[i].bubbles) {
            const m = re.exec(b.text);
            if (m) return m[0];
        }
    }
    return null;
}

/**
 * The customer's own last word, unanswered: nothing outbound since answers it, and it actually
 * reads as a question, not merely a sentence that happens to contain an
 * asking word (RE_ASKING alone matches plain vocabulary like "how" or "where" in a statement, e.g.
 * "I don't know how you found us"). A literal question mark is the one unambiguous signal that the
 * customer asked something, which is what this template's wording ("you asked us about...") claims.
 *
 * The desk's held acknowledgement ("Thanks, leave it with me and I'll come back to you.", or its
 * variant naming a photo or video) is not an answer: it only says one is coming (captain's answer
 * of 17 Sep 2026, "Yes, offer it"). The file records no fixed-line kind, so it is known by its
 * sender (the desk) and its exact wording (`isHeldAckText`). Any other outbound turn, a composed
 * reply, a person's own words, a template or a quote link, still answers the question.
 */
function unansweredQuestion(file: CaseFile, turn: Turn): boolean {
    const idx = file.turns.findIndex((t) => t.id === turn.id);
    if (idx === -1) return false;
    if (file.turns.slice(idx + 1).some((t) => t.direction === 'outbound' && !(t.approver === DESK_APPROVER && isHeldAckText(t.body)))) return false;
    return turn.body.includes('?');
}

/** The shut-window template a board send would carry, with its filled wording; or the send's exact refusal. */
export type WindowTemplatePlan =
    | { ok: true; party: Party; channel: ReplyChannel; window: WindowState; approver: Approver; template: TemplateSend; body: string }
    | { ok: false; reason: string };

/**
 * Every eligibility check and the template pick of `sendWindowTemplate`, with nothing sent and
 * nothing recorded. The send runs this and then delivers; the board's preview
 * (`previewWindowTemplate`, GET /case-files/:id/template-offer) runs it and stops, so the wording a
 * person is shown before pressing send is the wording that send would carry, and a refusal is the
 * same words.
 */
export async function planWindowTemplate(input: SendWindowTemplateInput, now: Date, templates: TemplateStatusSource = liveTemplateStatus): Promise<WindowTemplatePlan> {
    const { file, approver } = input;
    const refuse = (reason: string): WindowTemplatePlan => ({ ok: false, reason });

    if (approver.kind !== 'human') return refuse('only a person answers from the board; a rule-based approver has no words');
    const owner = file.hold?.approver ?? approverFor(file, null);
    if (!sameApprover(owner, approver)) return refuse(`only ${approverLabel(owner)} may answer this file`);
    const route = replyRouteOf(file, now);
    if (!route.ok) return refuse(route.reason);
    const { party, turn, channel, window } = route;
    if (window.state !== 'shut') return refuse(`the ${channel} window is open; send a freeform reply instead of a template`);

    const link = sentQuoteLink(file);
    let pick: Awaited<ReturnType<typeof pickTemplate>>;
    if (link) {
        pick = await pickTemplate('quote_ready', { name: party.name, topic: link, link, at: now }, templates);
    } else if (heldOnQuestion(file) && unansweredQuestion(file, turn)) {
        pick = await pickTemplate('service_reply', { name: party.name, topic: file.job.type ?? 'your enquiry', at: now }, templates);
    } else {
        return refuse('no template is true for this thread: the customer needs to write again before a reply can go');
    }
    if (!pick.ok) return refuse(`window shut and ${pick.reason}`);
    return { ok: true, party, channel, window, approver: humanApprover(input.person), template: pick.template, body: pick.body };
}

/** What the board's template card shows before a send: the template's name and its filled wording, or why none can go. */
export type WindowTemplateOffer =
    | { ok: true; template: string; language: string; channel: ReplyChannel; body: string }
    | { ok: false; reason: string };

/**
 * A dry run of `sendWindowTemplate`: the same plan, and nothing sent, recorded or released. It does
 * not run the sender's own gate (`send` in sender.ts: the opt-out ledger, the sender switch, the
 * party on the file), whose refusal the send still returns as `send refused: <reason>`.
 */
export async function previewWindowTemplate(input: SendWindowTemplateInput, deps: CaseFileDeps = {}, templates: TemplateStatusSource = liveTemplateStatus): Promise<WindowTemplateOffer> {
    const now = deps.now ?? (() => new Date());
    const plan = await planWindowTemplate(input, now(), templates);
    if (!plan.ok) return plan;
    return { ok: true, template: plan.template.name, language: plan.template.language, channel: plan.channel, body: plan.body };
}

/**
 * The standing hold, if any, is for a question: raised with no exception (the composer or a guard
 * held the reply) or on `no_source` (a question nothing on file answers). A complaint, a refund, a
 * money line or any other exception hold is Ben's own call, so a nudge never reaches it and never
 * clears it. Read from the recorded exception, never the reason's words.
 */
function heldOnQuestion(file: CaseFile): boolean {
    return !file.hold || file.hold.exception === null || file.hold.exception === 'no_source';
}

/**
 * A template send on a shut window, from the board. Captain's ruling (Firstmate decision
 * hsa-comms-v2-board-conversation-view, superseding the earlier "always answer_ready_reopen_v1"
 * call): offer a template only when its wording is true for this thread, read off the case file
 * itself —
 *   - `quote_ready_link`, with the exact link the file already shows was sent, once a quote has
 *     gone out on the thread (`sentQuoteLink`);
 *   - `answer_ready_reopen_v1` only when the customer's latest message is a question nothing has
 *     answered since (`unansweredQuestion`; the desk's held acknowledgement alone is not an
 *     answer), and only when any standing hold is for a question (`heldOnQuestion`) — its wording ("you asked us about... and we have an
 *     answer") is false on any other thread;
 *   - otherwise no template applies: refuses rather than sending or offering a word that is not
 *     true, and the board shows this as "the customer needs to write again" rather than a retry.
 * `quote_accepted_ack_v1` and `enquiry_followup_optin_v1` are never reached here (behaviour.md
 * answer 54: unused), and neither is any marketing-category row — only the two `service_reply`
 * purposes above are ever picked.
 *
 * Refuses on everything `humanReply` refuses (no owner match, no customer turn to answer), plus: the
 * window is open (a freeform reply is what applies there, not a template), no template true for the
 * thread, and no approved rung for the template that is true (the customer stays held for Ben, same
 * as the desk's own composed path).
 */
export async function sendWindowTemplate(input: SendWindowTemplateInput, deps: CaseFileDeps = {}, templates: TemplateStatusSource = liveTemplateStatus): Promise<HumanReplyOutcome> {
    const now = deps.now ?? (() => new Date());
    const runId = `run_${randomUUID()}`;
    const { file, approver } = input;
    const fileDeps: CaseFileDeps = { now, newId: deps.newId };

    const plan = await planWindowTemplate(input, now(), templates);
    if (!plan.ok) return plan;
    const { party, channel, window, template } = plan;
    const bubbles: RenderedBubble[] = [{ text: plan.body, gapMs: 0 }];

    const sent = await send({ file, partyId: party.personId, channel, window, bubbles, template, runId, approver: plan.approver, guards: null, factIds: [], kbIds: [], fixedLines: [], calls: [], mode: input.mode ?? 'dry_run' }, fileDeps);
    if (!sent.ok) return { ok: false, reason: `send refused: ${sent.reason}` };

    let release: HoldRelease | null = null;
    if (file.hold) {
        const rel = releaseHold(file, approver, `sent the ${template.name} template`, fileDeps);
        if (rel.ok) release = rel.value;
    }

    return { ok: true, result: { runId, approver: plan.approver, channel, bubbles, turnId: sent.record.turnId }, release };
}
