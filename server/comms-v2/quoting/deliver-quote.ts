/**
 * Delivering a quote Ben has priced: the one path both the sandbox door's `POST /price` (dry run)
 * and Ben's live price screen (server/spine/routes.ts, through price-screen-send.ts) take, so a quote
 * the new desk drafted goes out through the new desk's one sender either way.
 *
 * The delivery is written by the desk's own composer from the file, with the quote link, and
 * Contract 4 checks it. On a shut WhatsApp window no freeform text can go, so the delivery is the
 * approved `quote_ready_link` template, whose second variable is the quote link: the business's own
 * approved wording, never composed, sent under the person who licensed it. With that template not
 * approved (or its body with nowhere to put the link) the delivery holds for Ben instead.
 *
 * The quote is never marked sent unless the text that went IS the quote: a shut window with no
 * approved template, a guard failure or a refused send each hold for Ben and leave the quote a draft
 * he can price again.
 *
 * A thread held because the customer asked us to stop (desk/desk.ts `optOutHeld`) is read before
 * anything is written: the words here are the desk's own composer's, not the words of whoever
 * pressed send, so nothing is composed and nothing goes. The quote stays a draft and the reason
 * joins the card, which is what the price screen shows back to them.
 */
import { hold as setHold, noteOnHold, release as releaseHold, type CaseFile, type ModelCallRecord, type Party, type RenderedBubble, type ReplyChannel, type Turn } from '../desk/case-file';
import { compose } from '../desk/composer';
import { fixedLine, knowledgeBaseFixedLines } from '../desk/fixed-lines';
import { optOutHeld, type DeskDeps } from '../desk/desk';
import type { DeskResult, GuardName, GuardVerdict } from '../desk/desk-types';
import { AnthropicModelClient } from '../desk/models';
import { BEN, noReplyToCheck, runGuards, type GuardOutcome } from '../desk/guards';
import { chooseChannel, liveTemplateStatus, pickTemplate, render, send, windowOf } from '../desk/sender';
import { acknowledgesEnquiry } from '../channels/composer-lines';
import type { Approver } from '../../approver';
import type { QuoteRecord } from './quote-record';
import { humanRunId, markQuoteSent, type QuotingDeps } from './quoting-tools';

/** The opening of every hold reason the delivery writes, and the one it reads back when Ben's next send lands. */
export const priceHold = (slug: string) => `quote ${slug} priced;`;

/**
 * The newest thing the customer said: the channel the quote goes out on, the thread context the
 * composer writes against, and the turn the regulated guard reads. The desk's own last reply is not
 * it, and neither is a channel named here: a thread the customer wrote on by SMS is answered there.
 */
function newestCustomerTurn(file: CaseFile, party: Party): Turn {
    return [...file.turns].reverse().find((t) => t.direction === 'inbound' && t.partyId === party.personId) ?? file.turns[file.turns.length - 1];
}

/**
 * Whether the quote going out clears the hold on the thread. Exactly one hold it clears: the one
 * this delivery put there itself when an earlier attempt did not send, which this attempt has now
 * done, and only while that card still says nothing but what the delivery wrote on it. A hold is one
 * card carrying every reason it has been raised for, so a customer's question added to it since
 * ("do you charge a call-out fee?") would be cleared with it, and the delivery carries the link
 * and nothing else, so nobody has answered that question. No other card is this send's to clear
 * either: not the acknowledgement a web-form enquiry was owed, not a complaint, refund, trust or
 * regulated hold, and not acceptance, which stays human. Read only where the send landed: a
 * delivery that held cleared nothing at all.
 */
function answeredByThisQuote(file: CaseFile, slug: string): boolean {
    return !!file.hold && !file.hold.notedOn && file.hold.reason.startsWith(priceHold(slug));
}

type QuoteSentOutcome =
    | { ok: true; reply: string; verdicts: GuardOutcome; calls: ModelCallRecord[]; composerCalls: number }
    | { ok: false; failures: string[]; draft: string | null; verdicts: GuardOutcome; calls: ModelCallRecord[]; composerCalls: number };

/**
 * The delivery message for a quote Ben has just priced, written by the desk's own composer and
 * checked by Contract 4. The words are the desk's, not Ben's: the price route carries no message
 * body, so there is nobody to read a borrowed draft before it goes, and answer 43's exemption is
 * for words a person typed.
 *
 * The composer is told the channel the delivery actually goes out on rather than working it out
 * for itself, because the delivery may have skipped the channel `choose_channel` would have picked
 * and a reply shaped for WhatsApp bubbles is one the SMS render then refuses for length.
 *
 * The composer is given the quote link to copy and nothing else about the quote: the figures are
 * not facts on the file yet (`record_quote_facts` records them only once the quote is sent), which
 * is exactly why the delivery may not quote one. The one-reply guard is told a person licensed
 * this send, because Ben pressing send is a fresh licence to speak rather than the desk replying
 * twice to one customer turn; the other seven run unchanged. One retry with the failures named,
 * the same one retry the desk gives a composed reply.
 */
async function composeQuoteSent(file: CaseFile, party: Party, quoteUrl: string, channel: ReplyChannel, ack: string | null, now: Date, deps: DeskDeps): Promise<QuoteSentOutcome> {
    const client = deps.client ?? new AnthropicModelClient();
    const turn = newestCustomerTurn(file, party);
    const calls: ModelCallRecord[] = [];
    const brief = [
        'quoting: Ben has priced the quote and is sending it now',
        `this is the delivery, not a reply: say the quote is ready and give the link exactly as written here, ${quoteUrl}`,
        'no figure at all: the prices are on the quote, not in the message',
        'no date, no time, no lead time; say to reply here with any questions',
    ];
    const input = {
        file, party, turn, channel,
        reserved: ack ? ack.length + 2 : 0,
        route: { turnKind: 'other' as const, subjects: ['quoting' as const], exceptions: [] },
        specialists: [{ specialist: 'quoting' as const, factIds: [], proposal: { nextQuestion: null, offerCall: false, mentionPhotos: false, thankForMedia: false, ready: true, hold: null }, brief, calls: [], error: null }],
        fixedLines: [],
        now,
    };
    // What goes is the acknowledgement and the composer's words together, so that is what the
    // guards read and what the send records: nothing reaches the customer unchecked.
    const words = (reply: string) => (ack ? `${ack}\n\n${reply}` : reply);
    const guardsFor = (reply: string) => runGuards({ file, party, turn, reply: words(reply), factIds: [], kbIds: [], kbRows: [], fixedLines: [], proposedSubject: null, prompted: 'human_action', liveQuoteRefs: new Set<string>() });
    let draft: string | null = null;
    let outcome = guardsFor('');
    for (const failures of [undefined, 'retry'] as const) {
        const res = await compose(failures ? { ...input, failures: outcome.failures } : input, client);
        calls.push(res.record);
        if (!res.output) { outcome = { ok: false, guards: noReplyToCheck(), failures: [res.error ?? 'the composer returned nothing'] }; continue; }
        draft = res.output.reply;
        outcome = guardsFor(draft);
        if (outcome.ok) return { ok: true, reply: words(draft), verdicts: outcome, calls, composerCalls: calls.length };
    }
    return { ok: false, failures: outcome.failures, draft, verdicts: outcome, calls, composerCalls: calls.length };
}

export interface PricedQuote {
    record: QuoteRecord;
    quoteUrl: string;
    totals: { totalPence: number; depositPence: number };
    factIds: string[];
}

export interface DeliverQuoteInput {
    file: CaseFile;
    priced: PricedQuote;
    /** The person who licensed the send: `human:ben` on the sandbox door, `human:<their email or id>` on the live price screen. */
    approver: Approver;
    mode: 'dry_run' | 'live';
    now: () => Date;
    /** The desk's dependencies: the composer's client, the fixed lines, the template status, the sender and the quote store. */
    deps: DeskDeps;
}

/** `sent` false is a hold for Ben, with the reason on the result's note. A refusal before anything is decided is `ok: false`. */
export type DeliverQuoteOutcome =
    | { ok: true; sent: boolean; record: QuoteRecord; result: DeskResult }
    | { ok: false; status: number; reason: string };

export async function deliverPricedQuote(input: DeliverQuoteInput): Promise<DeliverQuoteOutcome> {
    const { file, priced, approver, mode, now, deps } = input;
    const fileDeps = { now, newId: deps.newId };
    const quotingDeps: QuotingDeps = { ...deps.quoting, now, newId: deps.newId };
    const senderDeps = { ...deps.sender, now, newId: deps.newId };
    const party = file.parties[0];
    const slug = priced.record.slug;
    const runId = humanRunId();
    const turn = newestCustomerTurn(file, party);
    // Read before the delivery lands, because the send itself appends an outbound turn:
    // after it, nothing can tell that this send was the first thing they ever received.
    const ack = acknowledgesEnquiry(file, turn) ? (await fixedLine('first_contact_ack', deps.fixedLines ?? knowledgeBaseFixedLines)).text : null;
    const choice = chooseChannel(party, turn?.channel ?? null, now(), { noTemplate: true });
    if (!choice.ok) return { ok: false, status: 409, reason: choice.reason };
    const window = windowOf(party, choice.channel, now());

    const held = (why: string, draft: string | null, failures: string[], guards: Record<GuardName, GuardVerdict> = noReplyToCheck(), calls: ModelCallRecord[] = []): DeliverQuoteOutcome => {
        if (file.hold) noteOnHold(file, { reason: why, draft, failures, ownCard: priceHold(slug) });
        else setHold(file, { approver: BEN, reason: why, draft: draft ?? undefined, failures }, fileDeps);
        const result: DeskResult = { runId, decision: 'hold', partyId: party.personId, channel: choice.channel, windowState: window.state, templateId: null, bubbles: [], factIds: priced.factIds, kbIds: [], guards, approver: null, hold: file.hold, delivered: false, stageAfter: file.stage, calls, note: why, summary: `ben priced ${slug}; not sent`, error: null, landedTurnId: null, composerCalls: calls.length };
        return { ok: true, sent: false, record: priced.record, result };
    };

    // The send landed: only now does the quote leave draft and its figures reach the file. The card
    // this delivery raised when an earlier attempt did not send is done, so it clears in the desk's
    // own words naming what happened: nobody read the delivery before it went, so recording the
    // letter as the release would read as Ben's own answer to whatever the card asked. Every other
    // hold is a person's to answer and stands.
    const landed = async (bubbles: RenderedBubble[], templateId: string | null, guards: Record<GuardName, GuardVerdict>, calls: ModelCallRecord[], turnId: string | null, composerCalls: number): Promise<DeliverQuoteOutcome> => {
        if (answeredByThisQuote(file, slug)) releaseHold(file, file.hold!.approver, `the desk sent quote ${slug} on this attempt, so the card raised when the earlier one did not send is done`, fileDeps);
        const staged = await markQuoteSent(file, quotingDeps);
        const record = staged.ok ? staged.record : priced.record;
        const result: DeskResult = {
            runId, decision: 'send', partyId: party.personId, channel: choice.channel, windowState: window.state, templateId, bubbles,
            factIds: priced.factIds, kbIds: [], guards, approver, hold: file.hold, delivered: true, stageAfter: file.stage, calls,
            note: staged.ok ? null : `sent, but the quote did not leave draft: ${staged.reason}`, summary: `ben priced ${record.slug} at ${(priced.totals.totalPence / 100).toFixed(2)} and the desk sent the link${templateId ? ` by the ${templateId} template` : ''}`, error: null, landedTurnId: turnId, composerCalls,
        };
        return { ok: true, sent: true, record, result };
    };

    // Someone who asked us to stop is not written to, whatever the opt-out ledger says yet: the
    // delivery is the desk's own composed words, so it stops here, before the composer and before
    // any template send.
    if (optOutHeld(file)) return held(`${priceHold(slug)} the customer asked us to stop and the thread is held for Ben on it, so the quote is not sent and stays a draft`, null, []);

    if (window.state === 'shut') {
        // No freeform text on a shut window. The one approved wording that carries a quote link is
        // `quote_ready_link` (server/window-templates.ts, trigger quote_ready), its link the second
        // variable; approval is the live sync's, by name. Its words are the business's own approved
        // template rather than a composed reply, so no guard runs over them, and the person who
        // licensed the send is the approver. Not approved, or with nowhere to put the link, it holds.
        const pick = await pickTemplate('quote_ready', { name: party.name, topic: priced.quoteUrl, link: priced.quoteUrl, at: now() }, deps.templates ?? liveTemplateStatus);
        if (!pick.ok || !pick.body.includes(priced.quoteUrl)) return held(`${priceHold(slug)} the WhatsApp window is shut (${window.reason}) and no approved template carries a quote link, so the quote is not sent and stays a draft`, null, []);
        const bubbles: RenderedBubble[] = [{ text: pick.body, gapMs: 0 }];
        const sent = await send({ file, partyId: party.personId, channel: choice.channel, window, bubbles, template: pick.template, runId, approver, guards: null, factIds: priced.factIds, kbIds: [], fixedLines: [], calls: [], mode }, senderDeps);
        if (!sent.ok) return held(`${priceHold(slug)} the ${pick.template.name} template send was refused (${sent.reason}), so the quote stays a draft`, pick.body, []);
        return landed(bubbles, pick.template.name, noReplyToCheck(), [], sent.record.turnId, 0);
    }

    // Ben licenses this send; the words are the desk's own. The price route carries no message
    // body, so nobody reads a borrowed draft before it goes: the composer writes the delivery from
    // the file, with the quote link, and Contract 4 checks it like any other composed reply
    // (behaviour.md answer 43 is about who WROTE the words).
    const written = await composeQuoteSent(file, party, priced.quoteUrl, choice.channel, ack, now(), deps);
    if (!written.ok) return held(`${priceHold(slug)} the delivery message did not pass the guards (${written.failures.join('; ')})`, written.draft, written.failures, written.verdicts.guards, written.calls);
    // Told the bubble shape, the composer keeps to it; a delivery that still runs over goes with the
    // wider limits rather than holding the quote Ben has just priced for its length.
    let rendered = render(choice.channel, written.reply, { name: party.name });
    if (!rendered.ok && rendered.reason === 'ceiling' && choice.channel === 'whatsapp') rendered = render(choice.channel, written.reply, { name: party.name, wideBubbles: true });
    if (!rendered.ok) return held(`${priceHold(slug)} the delivery message could not be rendered (${rendered.reason})`, written.reply, [], written.verdicts.guards, written.calls);
    const sent = await send({ file, partyId: party.personId, channel: choice.channel, window, bubbles: rendered.bubbles, template: null, runId, approver, guards: written.verdicts, factIds: priced.factIds, kbIds: [], fixedLines: [], calls: written.calls, mode }, senderDeps);
    if (!sent.ok) return held(`${priceHold(slug)} the send was refused (${sent.reason})`, written.reply, [], written.verdicts.guards, written.calls);
    return landed(rendered.bubbles, null, written.verdicts.guards, written.calls, sent.record.turnId, written.composerCalls);
}
