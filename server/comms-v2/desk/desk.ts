/**
 * The desk: one pipeline, one exit, for one customer turn.
 *
 *   route (Haiku) -> gather (the Scoping specialist and its tool server) -> compose (Fable 5.1)
 *   -> guards -> render -> window and template -> the one sender -> the send recorded on the file.
 *
 * Exceptions (Contract 3): money, callbacks and date changes hold for Ben and the reply still
 * answers the rest, saying Ben will come back on that. Complaints, refunds, trust doubts and gas:
 * one fixed line in Ben's words, no composer, and while the hold stands no specialist either:
 * each later turn gets the short acknowledgement that Ben will come back. A guard failure goes back to
 * the composer once, then holds with the fixed acknowledgement. A composer refusal or failure
 * takes the fixed acknowledgement, never a silent empty reply; so does a reply the sender refuses,
 * which live includes one of Ben's four fixed lines he has not yet reviewed. Never silent
 * otherwise; a clock pass never sends ("no chasing", "one acknowledgement, then quiet").
 */
import { randomUUID } from 'node:crypto';
import { ask as ledgerAsk, answered as ledgerAnswered, thanked as ledgerThanked, hold as setHold, release as releaseHold, noteOnHold, partyOf, setStage, isReady, type CaseFile, type ModelCallRecord, type Turn, type CaseFileDeps, type RenderedBubble } from './case-file';
import { schedule } from '../scheduling/scheduling-specialist';
import { dateChangeMatch, dateQuestionMatch, type SchedulingDeps } from '../scheduling/scheduling-tools';
import { compose, type ComposeInput } from './composer';
import type { DeskLike, DeskResult, Proposal, SpecialistReturn } from './desk-types';
import { fixedLine, knowledgeBaseFixedLines, type FixedLine, type FixedLineKind, type FixedLineSource } from './fixed-lines';
import { approverFor, noReplyToCheck, runGuards, type GuardOutcome, type KbRow } from './guards';
import { offersCall, scopingQuestionCount, textAsks } from './lexicon';
import { AnthropicModelClient, type ModelClient } from './models';
import type { Exception, Route } from './router';
import { route as routeTurn } from './router';
import { scope, type ScopingDeps } from './scoping-specialist';
import { BUBBLE_CEILING, DESK_APPROVER, chooseChannel, liveTemplateStatus, pickTemplate, render, send, shortenBriefFor, windowOf, type SenderDeps, type TemplateSend, type TemplateStatusSource, type WindowState } from './sender';
import { reviewedKb, type KbReader } from './scoping-tools';
import { channelFixedLines, MOVE_TO_WHATSAPP_SUBJECT } from '../channels/channel-lines';
import { templateChoiceFor } from '../channels/templates';
import { quote as quoteGather, quoteStateOf, quotingClock, quotingOwnsThread, quotingSummary, type QuotingSpecialistDeps } from '../quoting/quoting-specialist';
import { liveFigureQuotes } from '../quoting/quoting-tools';

export interface DeskDeps extends CaseFileDeps {
    client?: ModelClient;
    fixedLines?: FixedLineSource;
    templates?: TemplateStatusSource;
    kb?: KbReader;
    scoping?: ScopingDeps;
    scheduling?: SchedulingDeps;
    quoting?: QuotingSpecialistDeps;
    sender?: SenderDeps;
    mode?: 'dry_run' | 'live';
    log?: (line: string) => void;
}

const FIXED_LINE_ONLY: ReadonlySet<Exception> = new Set<Exception>(['complaint', 'refund', 'trust_doubt', 'regulated']);

/** The opening of the hold reason the desk writes when the clerk could not build the quote, and the one it reads back to answer that hold once a quote exists. */
const DRAFT_FAILED_HOLD = 'the quote draft failed';

/**
 * What the desk calls a note about its own run - a shut window, no approved template, a reply the
 * guards refused. It opens no card of its own, so it never restates one; saying it marks the note
 * as the same automatic step speaking rather than a customer's question added to Ben's card, which
 * is what decides whether the card is still the desk's to clear (`case-file.ts` noteOnHold).
 */
const DESK_RUN_NOTE = 'the desk could not finish this run';

export class Desk implements DeskLike {
    private readonly client: ModelClient;
    private readonly deps: DeskDeps;
    private readonly now: () => Date;

    constructor(deps: DeskDeps = {}) {
        this.deps = deps;
        this.client = deps.client ?? new AnthropicModelClient();
        this.now = deps.now ?? (() => new Date());
    }

    private fileDeps(): CaseFileDeps { return { now: this.now, newId: this.deps.newId }; }
    private quotingDeps(): QuotingSpecialistDeps { return { ...this.deps.quoting, now: this.now, newId: this.deps.newId }; }

    /** A clock pass with no new message: the desk never chases the customer, so nothing goes; an unpriced draft is chased for Ben (4.5). */
    async clockPass(file: CaseFile): Promise<DeskResult> {
        const party = file.parties[0];
        const chased = await quotingClock(file, this.quotingDeps());
        return this.nothing(file, party.personId, `run_${randomUUID()}`, [], `clock pass: no customer turn, nothing to reply to; the desk never chases the customer; ${chased.note}`);
    }

    private nothing(file: CaseFile, partyId: string, runId: string, calls: ModelCallRecord[], note: string, decision: 'none' | 'hold' = 'none'): DeskResult {
        const party = partyOf(file, partyId)!;
        const window = windowOf(party, 'whatsapp', this.now());
        return { runId, decision, partyId, channel: null, windowState: window.state, templateId: null, bubbles: [], factIds: [], kbIds: [], guards: noReplyToCheck(), approver: null, hold: file.hold, delivered: false, stageAfter: file.stage, calls, note, summary: null, error: null, landedTurnId: null, composerCalls: 0 };
    }

    async handleTurn(file: CaseFile, turn: Turn): Promise<DeskResult> {
        const runId = `run_${randomUUID()}`;
        const calls: ModelCallRecord[] = [];
        const party = partyOf(file, turn.partyId);
        if (!party) return this.nothing(file, file.parties[0].personId, runId, calls, 'the turn\'s party is not on the file');
        if (turn.direction !== 'inbound') return this.nothing(file, party.personId, runId, calls, 'not a customer turn');
        const log = this.deps.log ?? (() => undefined);

        // 0. A thread held on a fixed line stays with Ben: no specialist, one acknowledgement per turn.
        if (file.hold?.exception && FIXED_LINE_ONLY.has(file.hold.exception)) {
            return this.heldAck(file, party.personId, turn, runId, calls, `held for Ben on ${file.hold.exception}: the desk does not scope this thread until he releases it`, null, 0, []);
        }

        // 1. Route. The quotes a figure may be read from now are read once for the turn: the
        // router's money exemption (5.3 replaces 2.7) stands only while the file's quote is one of
        // them, and the figure guard resolves a cited line against the same set.
        const liveQuoteRefs = await liveFigureQuotes(file, this.quotingDeps()).catch((e: any) => {
            log(`quoting: the quote could not be read (${e?.message ?? e})`);
            return new Set<string>() as ReadonlySet<string>;
        });
        const route: Route = await routeTurn(file, turn, this.client, liveQuoteRefs);
        calls.push(route.call);
        if (route.error) log(`router: ${route.error} (fallback route used)`);
        if (file.stage === 'first_contact') setStage(file, 'scoping', 'first customer turn routed', this.fileDeps());

        // 2. Exceptions that the Scoper does not scope: one fixed line, a hold, no composer.
        const fixedLines: FixedLine[] = [];
        const kbIds: string[] = [];
        const exception = route.exception;
        let composerCalls = 0;
        let reply: string | null = null;
        let factIds: string[] = [];
        const specialists: SpecialistReturn[] = [];
        let scoping: SpecialistReturn | null = null;

        if (exception && FIXED_LINE_ONLY.has(exception)) {
            const kind: FixedLineKind = exception === 'regulated' ? 'gas' : exception === 'trust_doubt' ? 'trust' : exception === 'refund' ? 'refund' : 'complaint';
            const line = await fixedLine(kind, this.deps.fixedLines ?? knowledgeBaseFixedLines);
            fixedLines.push(line);
            if (line.kbId) kbIds.push(line.kbId);
            this.holdFor(file, exception, `${exception}: ${route.belts.regulated ?? turn.body.slice(0, 80)}`);
            reply = line.text;
        } else {
            // 3. Gather: Scoping until the quote is sent; Quoting once the job and the location are known (Goal 4).
            scoping = quotingOwnsThread(file) ? null : await scope(file, turn, party, this.client, { ...this.deps.scoping, now: this.now });
            if (scoping) { calls.push(...scoping.calls); specialists.push(scoping); if (scoping.error) log(`scoping: ${scoping.error}`); }
            if (scoping?.proposal.hold) {
                const line = await fixedLine('gas', this.deps.fixedLines ?? knowledgeBaseFixedLines);
                fixedLines.push(line);
                if (line.kbId) kbIds.push(line.kbId);
                this.holdFor(file, 'regulated', `regulated: ${scoping.proposal.hold.match}`);
                reply = line.text;
            } else {
                const quoting = await quoteGather(file, turn, party, route, this.client, this.quotingDeps());
                if (quoting) { calls.push(...quoting.calls); specialists.push(quoting); if (quoting.error) log(`quoting: ${quoting.error}`); }
                // A quote the desk failed to draft earlier exists now, so the hold that told Ben to
                // build it himself is answered: the desk releases it in its own words and the card
                // points at the price screen, rather than leaving him to make a second quote by hand.
                if (file.hold?.reason.startsWith(DRAFT_FAILED_HOLD) && !file.hold.notedOn && file.job.quoteRef) {
                    const priceScreen = quoteStateOf(file)?.priceScreen;
                    releaseHold(file, file.hold.approver, `the desk drafted quote ${file.job.quoteRef} on a later turn and Ben has been notified${priceScreen ? `: ${priceScreen}` : ''}`, this.fileDeps());
                }
                if (exception === 'money') {
                    const line = await fixedLine('money_to_ben', this.deps.fixedLines ?? knowledgeBaseFixedLines);
                    fixedLines.push(line);
                    this.holdFor(file, exception, `${exception}: ${route.belts.money ?? turn.body.slice(0, 80)}`);
                } else if (quoting?.proposal.hold?.reason === 'money') {
                    fixedLines.push(await fixedLine('money_to_ben', this.deps.fixedLines ?? knowledgeBaseFixedLines));
                    this.holdFor(file, 'money', `money beyond a quote line: ${quoting.proposal.hold.match}`);
                } else if (quoting?.proposal.hold?.reason === 'stale_quote') {
                    this.holdFor(file, null, `the quote is no longer live (${quoting.proposal.hold.match}): no figure may be read from it and the customer has been told Ben will come back to them on it`);
                } else if (quoting?.proposal.hold?.reason === 'draft_failed') {
                    fixedLines.push(await fixedLine('held_ack', this.deps.fixedLines ?? knowledgeBaseFixedLines));
                    this.holdFor(file, null, `${DRAFT_FAILED_HOLD} (${quoting.proposal.hold.match}): no quote exists for this job and Ben has had no notification, so the quote is his to build`, null, DRAFT_FAILED_HOLD);
                    if (scoping) { scoping.proposal.nextQuestion = null; scoping.proposal.mentionPhotos = false; scoping.proposal.ready = false; }
                }
                if (quoting?.proposal.hold?.acceptedInChat) {
                    this.holdFor(file, null, `acceptance in chat: the customer said yes to the quote (${quoting.proposal.hold.match}); acceptance stays on the quote page and with Ben`);
                }
                // Goal 5: dates and lead time are the Scheduling specialist's, read from the diary; a date change holds for Ben and the reply still answers the rest.
                // The router's date_change exception is passed in and stands in for a booking the desk cannot see: until a real booking reaches the case file, a request to move one must still reach Ben (checklist 5.5).
                const couldBeBooked = !!(file.job.bookingRef || file.job.quoteRef || file.stage === 'booked');
                if (route.subjects.includes('scheduling') || exception === 'date_change' || dateQuestionMatch(turn.body) || (couldBeBooked && dateChangeMatch(turn.body))) {
                    const sched = await schedule(file, turn, party, this.client, { ...this.deps.scheduling, now: this.now }, { dateChange: exception === 'date_change', scheduling: route.subjects.includes('scheduling') });
                    calls.push(...sched.calls);
                    specialists.push(sched);
                    if (sched.error) log(`scheduling: ${sched.error}`);
                    for (const kind of sched.scheduling.fixedLines) fixedLines.push(await fixedLine(kind, this.deps.fixedLines ?? knowledgeBaseFixedLines));
                    if (sched.proposal.hold) this.holdFor(file, sched.proposal.hold.reason === 'date_change' ? 'date_change' : null, `${sched.proposal.hold.reason}: ${sched.proposal.hold.match}`);
                }
                fixedLines.push(...(await channelFixedLines(file, party, turn, this.deps.fixedLines ?? knowledgeBaseFixedLines, this.now())));
                // Pauses, promises and a not-ready customer get an acknowledgement and no question.
                if (scoping && (route.turnKind === 'short_pause' || route.turnKind === 'promise_of_more' || route.turnKind === 'not_ready')) {
                    scoping.proposal.nextQuestion = null;
                    scoping.proposal.mentionPhotos = false;
                    if (route.turnKind === 'not_ready') scoping.proposal.offerCall = false;
                }
                // 4. Compose, once; a guard failure sends it back once; the ceiling sends it back once.
                const input: ComposeInput = { file, party, turn, route, specialists, fixedLines, now: this.now() };
                const first = await compose(input, this.client);
                calls.push(first.record);
                composerCalls++;
                if (first.output) { reply = first.output.reply; factIds = first.output.factIds; kbIds.push(...first.output.kbIds); }
                else {
                    log(`composer: ${first.refused ? 'refused' : first.error}`);
                    return this.heldAck(file, party.personId, turn, runId, calls, `composer ${first.refused ? 'declined' : 'failed'}: ${first.error}`, null, composerCalls, specialists, undefined, summarise(route, specialists));
                }
            }
        }

        const summary = summarise(route, specialists);
        // 5. Guards, with one retry to the composer.
        const kbRows = await this.kbRows(kbIds);
        const proposedSubject = scoping?.proposal.nextQuestion?.subject ?? null;
        const lookedUp = specialists.flatMap((s) => s.factIds);
        const guardInput = (text: string, ids: string[]) => ({ file, party, turn, reply: text, factIds: ids, kbIds, kbRows, fixedLines, lookedUp, proposedSubject, liveQuoteRefs });
        // One thing at a time (checklist 2.3) is checked with the guards, so the one retry covers it too.
        const withOneThing = (g: GuardOutcome, text: string): GuardOutcome => {
            const n = scopingQuestionCount(text);
            return n > 1 ? { ok: false, guards: g.guards, failures: [...g.failures, `one thing at a time: ${n} questions about the job in one reply; ask one, with one question mark`] } : g;
        };
        let guards: GuardOutcome = withOneThing(runGuards(guardInput(reply!, factIds)), reply!);
        if (!guards.ok && !(exception && FIXED_LINE_ONLY.has(exception)) && !scoping?.proposal.hold) {
            const again = await compose({ file, party, turn, route, specialists, fixedLines, failures: guards.failures, now: this.now() }, this.client);
            calls.push(again.record);
            composerCalls++;
            if (again.output) {
                const g2 = withOneThing(runGuards(guardInput(again.output.reply, again.output.factIds)), again.output.reply);
                if (g2.ok) { reply = again.output.reply; factIds = again.output.factIds; kbIds.push(...again.output.kbIds); guards = g2; }
                else return this.heldAck(file, party.personId, turn, runId, calls, `guards failed twice: ${g2.failures.join('; ')}`, again.output.reply, composerCalls, specialists, g2, summary);
            } else return this.heldAck(file, party.personId, turn, runId, calls, `guards failed and the composer ${again.refused ? 'declined' : 'failed'} the retry`, reply, composerCalls, specialists, guards, summary);
        }
        if (!guards.ok) {
            // A fixed line that fails a guard is a contract failure in the line itself: hold with it named, send the acknowledgement.
            return this.heldAck(file, party.personId, turn, runId, calls, `the fixed line failed the guards: ${guards.failures.join('; ')}`, reply, composerCalls, specialists, guards, summary);
        }

        // 6. Channel, window, render, template.
        const choice = chooseChannel(party, turn.channel, this.now());
        if (!choice.ok) return { ...this.nothing(file, party.personId, runId, calls, choice.reason, 'hold'), summary };
        let rendered = render(choice.channel, reply!, { name: party.name });
        if (!rendered.ok && rendered.reason === 'ceiling' && !(exception && FIXED_LINE_ONLY.has(exception))) {
            const shorter = await compose({ file, party, turn, route, specialists, fixedLines, shorten: shortenBriefFor(choice.channel, reply!, rendered.bubbles), now: this.now() }, this.client);
            calls.push(shorter.record);
            composerCalls++;
            if (shorter.output) {
                const g3 = runGuards(guardInput(shorter.output.reply, shorter.output.factIds));
                const r3 = render(choice.channel, shorter.output.reply, { name: party.name });
                if (g3.ok && r3.ok) { reply = shorter.output.reply; factIds = shorter.output.factIds; guards = g3; rendered = r3; }
            }
        }
        if (!rendered.ok) return this.heldAck(file, party.personId, turn, runId, calls, rendered.reason === 'ceiling' ? (choice.channel === 'sms' ? 'the reply stayed over two SMS segments after one shorten' : `the reply stayed over the ceiling of ${BUBBLE_CEILING} bubbles after one shorten`) : 'the reply rendered to nothing', reply, composerCalls, specialists, guards, summary);
        const window = windowOf(party, choice.channel, this.now());
        let template: TemplateSend | null = null;
        let templateWording: string | null = null;
        if (window.state === 'shut') {
            // A portal action is not a question a template answers. The customer has accepted and paid
            // a deposit, and the only approved wording of this purpose asks them to write again, which
            // the registry itself says must never stand as the reply (server/window-templates.ts). It
            // holds for Ben instead, with the word he owes them named; his push has already gone.
            if (turn.kind === 'portal_action') {
                const why = `the customer accepted the quote and the ${choice.channel} window is shut, so the desk cannot acknowledge it: a word from Ben is what they are waiting on`;
                this.holdFor(file, exception, why, reply, DESK_RUN_NOTE);
                return { ...this.nothing(file, party.personId, runId, calls, why, 'hold'), factIds, kbIds, guards: guards.guards, composerCalls, windowState: 'shut', channel: choice.channel, summary };
            }
            const tmpl = templateChoiceFor(file, turn);
            const pick = await pickTemplate(tmpl.purpose, { name: party.name, topic: tmpl.topic, at: this.now() }, this.deps.templates ?? liveTemplateStatus);
            if (!pick.ok) {
                this.holdFor(file, exception, `window shut and ${pick.reason}`, reply, DESK_RUN_NOTE);
                return { ...this.nothing(file, party.personId, runId, calls, pick.reason, 'hold'), factIds, kbIds, guards: guards.guards, composerCalls, windowState: 'shut', channel: choice.channel, summary };
            }
            template = pick.template;
            templateWording = pick.wording;
            rendered = { ok: true, bubbles: [{ text: pick.body, gapMs: 0 }] };
        }

        // 7. The one sender.
        const sent = await send({ file, partyId: party.personId, channel: choice.channel, window, bubbles: rendered.bubbles, template, runId, approver: DESK_APPROVER, guards, factIds, kbIds: Array.from(new Set(kbIds)), fixedLines, calls, mode: this.deps.mode ?? 'dry_run' }, { ...this.deps.sender, now: this.now, newId: this.deps.newId });
        if (!sent.ok) return this.heldAck(file, party.personId, turn, runId, calls, `send refused: ${sent.reason}`, reply, composerCalls, specialists, undefined, summary);

        // 8. The ledger and the stage, from what the business itself said.
        this.afterSend(file, party.personId, templateWording ?? reply!, templateWording ? null : (specialists.find((s) => s.specialist === 'scoping')?.proposal ?? null), templateWording ? [] : fixedLines);
        return {
            runId, decision: 'send', partyId: party.personId, channel: choice.channel, windowState: window.state, templateId: template?.name ?? null, bubbles: rendered.bubbles,
            factIds, kbIds: Array.from(new Set(kbIds)), guards: guards.guards, approver: DESK_APPROVER, hold: file.hold, delivered: true, stageAfter: file.stage,
            calls, note: null, summary, error: null, landedTurnId: sent.record.turnId, composerCalls,
        };
    }

    private holdFor(file: CaseFile, exception: Exception | null, reason: string, draft: string | null = null, ownCard?: string): void {
        // One turn can raise two: a price and a date change in one message. Ben answers what his card names, so the second is added to it rather than dropped.
        if (file.hold) { noteOnHold(file, { reason, draft, ownCard }); return; }
        setHold(file, { approver: approverFor(file, exception), reason, exception, draft }, this.fileDeps());
    }

    /** Contract 4's second failure and the composer's fallback route: hold with the draft, and the customer still hears the fixed acknowledgement. */
    private async heldAck(file: CaseFile, partyId: string, turn: Turn, runId: string, calls: ModelCallRecord[], why: string, draft: string | null, composerCalls: number, specialists: SpecialistReturn[], failed?: GuardOutcome, summary: string | null = null): Promise<DeskResult> {
        const party = partyOf(file, partyId)!;
        const held = { reason: why, draft, failures: failed?.failures ?? [] };
        if (file.hold) noteOnHold(file, { ...held, ownCard: DESK_RUN_NOTE });
        else setHold(file, { approver: approverFor(file, null), ...held }, this.fileDeps());
        const line = await fixedLine('held_ack', this.deps.fixedLines ?? knowledgeBaseFixedLines);
        const guards = runGuards({ file, party, turn, reply: line.text, factIds: [], kbIds: [], kbRows: [], fixedLines: [line], proposedSubject: null, liveQuoteRefs: new Set() });
        const choice = chooseChannel(party, turn.channel, this.now());
        const window = choice.ok ? windowOf(party, choice.channel, this.now()) : null;
        const rendered = choice.ok ? render(choice.channel, line.text, { name: party.name }) : null;
        const base = { ...this.nothing(file, partyId, runId, calls, why, 'hold'), summary };
        if (!choice.ok || !window || !rendered?.ok || !guards.ok || window.state === 'shut') return { ...base, guards: guards.guards, composerCalls, note: `${why}; acknowledgement not sent: ${!choice.ok ? choice.reason : !rendered?.ok ? `no render for ${choice.channel}` : !guards.ok ? guards.failures.join('; ') : 'window shut'}` };
        const bubbles: RenderedBubble[] = rendered.bubbles;
        const sent = await send({ file, partyId, channel: choice.channel, window, bubbles, template: null, runId, approver: DESK_APPROVER, guards, factIds: [], kbIds: [], fixedLines: [line], calls, mode: this.deps.mode ?? 'dry_run' }, { ...this.deps.sender, now: this.now, newId: this.deps.newId });
        if (!sent.ok) return { ...base, guards: guards.guards, composerCalls, note: `${why}; acknowledgement refused: ${sent.reason}` };
        this.afterSend(file, partyId, line.text, null, [line]);
        return { ...base, decision: 'hold', channel: choice.channel, windowState: window.state, bubbles, guards: guards.guards, approver: DESK_APPROVER, hold: file.hold, delivered: true, stageAfter: file.stage, landedTurnId: sent.record.turnId, composerCalls, note: why };
    }

    /**
     * The ledger records what the reply asked and thanked for, written from what the business
     * itself said: an approved template's own wording with its placeholders unfilled, because a
     * filled body quotes the customer's enquiry back and those are their words, not ours; or the
     * composed reply, not the greeting and sign-off the renderer wraps it in. A template's words
     * are nobody's proposal, so for those only the words themselves speak.
     *
     * A fixed line that went is recorded by its kind, not by its wording: the composer is asked to
     * weave it in naturally, so the invitation to move to WhatsApp is spent here, on this send,
     * rather than looked for in the text of a later one (channels/channel-lines.ts).
     *
     * The proposal is the composed reply's own: the held acknowledgement passes none, because the
     * words that went are Ben's fixed line and it names no photo, so the thanks the proposal asked
     * for is still owed and a later reply may still carry it.
     */
    private afterSend(file: CaseFile, partyId: string, said: string, proposal: Proposal | null, lines: FixedLine[]): void {
        const deps = this.fileDeps();
        const party = partyOf(file, partyId)!;
        for (const subject of ['media', 'postcode', 'access'] as const) if (textAsks(said, subject)) ledgerAsk(file, subject, deps);
        if (proposal?.nextQuestion && said.includes('?')) ledgerAsk(file, proposal.nextQuestion.subject, deps);
        if (proposal?.mentionPhotos && /\b(?:photo|photos|picture|pictures|pic|pics|video|snap|image)s?\b/i.test(said)) ledgerAsk(file, 'media', deps);
        // The thanks is spent only where the words that went carried one: a thanks the ledger
        // records but the reply never made leaves the photo unacknowledged for good, which is the
        // worse end of 1.7 than thanking for it twice. Any wording of gratitude counts, not one
        // that names the photo, so "Thanks for sending that over" is read as the thanks it is.
        if (proposal?.thankForMedia && /\b(?:thanks?|thank you|cheers|ta)\b/i.test(said)) { ledgerAnswered(file, 'media', deps); ledgerThanked(file, 'media', deps); }
        if (offersCall(said)) party.callOffered = true;
        if (lines.some((l) => l.kind === 'move_to_whatsapp')) ledgerAsk(file, MOVE_TO_WHATSAPP_SUBJECT, deps);
        if (isReady(file) && file.stage === 'scoping') setStage(file, 'ready', 'job type and location both on the file', deps);
    }

    private async kbRows(ids: string[]): Promise<KbRow[]> {
        if (!ids.length) return [];
        const rows = await (this.deps.kb ?? reviewedKb).list();
        return rows.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id, approvedWords: r.approvedWords, reviewed: true }));
    }
}

/** One line of evidence: the route and the proposal behind a reply. */
function summarise(route: Route, specialists: SpecialistReturn[]): string {
    const p = specialists.find((s) => s.specialist === 'scoping')?.proposal;
    const bits = [`turn ${route.turnKind}`, `subjects ${route.subjects.join('+')}`, `exception ${route.exception ?? 'none'}`];
    if (p) bits.push(`ask ${p.nextQuestion ? `${p.nextQuestion.subject}${p.nextQuestion.unknowns.length ? ' (' + p.nextQuestion.unknowns.join(', ') + ')' : ''}` : 'none'}`, `call ${p.offerCall ? 'yes' : 'no'}`, `photos ${p.mentionPhotos ? 'mention' : p.thankForMedia ? 'thank' : 'no'}`, `ready ${p.ready ? 'yes' : 'no'}`);
    const q = quotingSummary(specialists.find((s) => s.specialist === 'quoting'));
    if (q) bits.push(q);
    for (const s of specialists) if (s.specialist !== 'scoping' && s.specialist !== 'quoting') bits.push(`${s.specialist}: ${s.brief?.length ? s.brief.join(' | ') : 'nothing to add'}`);
    for (const s of specialists) if (s.error) bits.push(`${s.specialist} error: ${s.error}`);
    if (route.error) bits.push(`router error: ${route.error}`);
    return bits.join('; ');
}
