/**
 * The desk: one pipeline, one exit, for one customer turn.
 *
 *   route (Haiku) -> gather (the routed specialists and their tool servers: Scoping, Quoting, Scheduling, Service)
 *   -> compose (Fable 5.1) -> guards -> render -> window and template -> the one sender -> the
 *   send recorded on the file.
 *
 * Exceptions (Contract 3): money, callbacks, date changes, a question with no source and a change
 * of details hold for Ben and the reply still answers the rest, saying Ben will come back on that.
 * A turn can raise more than one: each carries its own fixed line into the reply and the hold
 * records the gravest, so a price question that also asks for a call gets both lines.
 * Complaints, refunds, trust doubts, gas and scoping that is not converging: one fixed line in
 * Ben's words, no composer, and while the hold stands no specialist either: each later turn gets
 * the short acknowledgement that Ben will come back. The vocabulary is server/comms-v2/service/
 * hold-reasons.ts. A router that fails to read the turn holds for Ben with the fixed acknowledgement,
 * since nothing then rules out a complaint or a refund. A guard failure goes back to the composer once, then holds with the fixed
 * acknowledgement. A composer refusal or failure takes the fixed acknowledgement, never a silent
 * empty reply; so does a reply the sender refuses, which live includes one of Ben's four fixed
 * lines he has not yet reviewed. Never silent otherwise; a clock pass never messages a customer
 * ("no chasing", "one acknowledgement, then quiet"); it is where Ben is chased instead (7.5).
 */
import { randomUUID } from 'node:crypto';
import { ask as ledgerAsk, answered as ledgerAnswered, thanked as ledgerThanked, hold as setHold, release as releaseHold, noteOnHold, supersede as supersedeHold, partyOf, setStage, isReady, type CaseFile, type ModelCallRecord, type Turn, type CaseFileDeps, type RenderedBubble } from './case-file';
import { schedule } from '../scheduling/scheduling-specialist';
import { dateChangeMatch, dateQuestionMatch, partyBookings, type PartyBookings, type SchedulingDeps } from '../scheduling/scheduling-tools';
import { compose, type ComposeInput } from './composer';
import type { DeskLike, DeskResult, Proposal, SpecialistReturn } from './desk-types';
import { fixedLine, knowledgeBaseFixedLines, type FixedLine, type FixedLineSource } from './fixed-lines';
import { approverFor, noReplyToCheck, runGuards, type GuardOutcome, type KbRow } from './guards';
import { offersCall, regulatedMatch, scopingQuestionCount, textAsks } from './lexicon';
import { AnthropicModelClient, type ModelClient } from './models';
import type { Exception, HoldException, Route } from './router';
import { matchFor, route as routeTurn } from './router';
import { scope, type ScopingDeps } from './scoping-specialist';
import { chaseIfDue, type ChaseState } from '../service/chase';
import { ANSWER_THE_REST, FIXED_LINE_FOR, FIXED_LINE_ONLY } from '../service/hold-reasons';
import { serve, type ServiceSpecialistDeps } from '../service/service-specialist';
import { asksToChangeDetails } from '../service/service-tools';
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
    service?: ServiceSpecialistDeps & { chase?: ChaseState };
    sender?: SenderDeps;
    mode?: 'dry_run' | 'live';
    log?: (line: string) => void;
}

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

    /** A clock pass with no new message: the desk never chases the customer, so nothing goes to them; an unpriced draft is chased for Ben (4.5) and a held thread chases Ben, then the owner (7.5). */
    async clockPass(file: CaseFile): Promise<DeskResult> {
        const party = file.parties[0];
        const chased = await quotingClock(file, this.quotingDeps());
        const base = this.nothing(file, party.personId, `run_${randomUUID()}`, [], `clock pass: no customer turn, nothing to reply to; the desk never chases the customer; ${chased.note}`);
        const chase = this.deps.service?.chase;
        if (!chase) return { ...base, chase: null };
        // A release from any surface, the board included, leaves the old record behind: clear it here,
        // the one pass that runs whether or not the file is held.
        if (!file.hold) { chase.ledger.clear(file.id); return { ...base, chase: null }; }
        const outcome = await chaseIfDue(file, chase, { templates: this.deps.templates, sender: { ...this.deps.sender, now: this.now, newId: this.deps.newId }, mode: this.deps.mode ?? 'dry_run', now: this.now });
        const note = outcome.action === 'none' ? `chase: ${outcome.reason}` : outcome.action === 'refused' ? `chase ${outcome.purpose} refused: ${outcome.reason}` : `${outcome.action === 'chased' ? 'Ben chased' : 'escalated to the owner'} by template ${outcome.send.templateId} (${outcome.send.runId})`;
        return { ...base, note: `${base.note}; ${note}`, chase: outcome };
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
        if (file.stage === 'first_contact') setStage(file, 'scoping', 'first customer turn routed', this.fileDeps());
        // A reading that failed (out of schema, refused, unreachable) cannot rule out a complaint or a refund: fail closed to Ben.
        if (route.error) {
            log(`router: ${route.error} (held for Ben)`);
            return this.heldAck(file, party.personId, turn, runId, calls, 'router_failed: the router could not read this turn, so a complaint or refund cannot be ruled out', null, 0, []);
        }

        // 2. Exceptions that the Scoper does not scope: one fixed line, a hold, no composer.
        const fixedLines: FixedLine[] = [];
        const fixedLineKbIds: string[] = [];
        const exceptions: Exception[] = route.exceptions;
        let composerCalls = 0;
        let reply: string | null = null;
        let factIds: string[] = [];
        let citedKbIds: string[] = [];
        const specialists: SpecialistReturn[] = [];
        let scoping: SpecialistReturn | null = null;

        // A fixed-line hold, whoever raised it: one line in Ben's words, the hold, no composer.
        const fixedLineHold = async (reason: HoldException, match: string) => {
            const line = await fixedLine(FIXED_LINE_FOR[reason], this.deps.fixedLines ?? knowledgeBaseFixedLines);
            fixedLines.push(line);
            if (line.kbId) fixedLineKbIds.push(line.kbId);
            this.holdFor(file, reason, `${reason}: ${match}`);
            reply = line.text;
        };
        // Gravest first: a fixed-line-only exception on the turn takes the thread off the composer, whatever else it raised.
        const fixedOnlyException = exceptions.find((e) => FIXED_LINE_ONLY.has(e)) ?? null;
        let fixedLineOnly = !!fixedOnlyException;
        if (fixedOnlyException) {
            await fixedLineHold(fixedOnlyException, matchFor(route, fixedOnlyException, turn.body));
        } else {
            // 3. Gather: every routed specialist that exists. Scoping runs until the quote is sent (Goal 4)
            // and unless the turn is service only; Service runs its deterministic tools every turn and its
            // model when routed here, or when the customer asks to change a detail on their record, whatever
            // the router read, so that change is recorded and held for Ben; Quoting gathers below once the
            // job and the location are known.
            const scopingRan = !quotingOwnsThread(file) && !(route.subjects.length === 1 && route.subjects[0] === 'service');
            scoping = scopingRan ? await scope(file, turn, party, this.client, { ...this.deps.scoping, now: this.now }) : null;
            if (scoping) { calls.push(...scoping.calls); specialists.push(scoping); if (scoping.error) log(`scoping: ${scoping.error}`); }
            const service = await serve(file, turn, party, this.client, { kb: this.deps.kb, ...this.deps.service, now: this.now, newId: this.deps.newId }, { routed: route.subjects.includes('service') || asksToChangeDetails(turn.body), scopingRan });
            calls.push(...service.calls);
            specialists.push(service);
            if (service.error) log(`service: ${service.error}`);
            // Scoping's and Service's holds, in the one vocabulary a fixed line answers; Quoting raises its own below.
            const holds = specialists.flatMap((s) => (s.proposal.hold && isHoldException(s.proposal.hold.reason) ? [{ reason: s.proposal.hold.reason, match: s.proposal.hold.match }] : []));
            const fixedOnly = holds.find((h) => FIXED_LINE_ONLY.has(h.reason));
            if (fixedOnly) {
                fixedLineOnly = true;
                await fixedLineHold(fixedOnly.reason, fixedOnly.match);
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
                // Every exception the turn raised carries its own fixed line; the hold records the gravest.
                for (const e of exceptions.filter((x) => ANSWER_THE_REST.has(x))) {
                    fixedLines.push(await fixedLine(FIXED_LINE_FOR[e], this.deps.fixedLines ?? knowledgeBaseFixedLines));
                    this.holdFor(file, e, `${e}: ${matchFor(route, e, turn.body)}`);
                }
                for (const h of holds.filter((x) => ANSWER_THE_REST.has(x.reason))) {
                    fixedLines.push(await fixedLine(FIXED_LINE_FOR[h.reason], this.deps.fixedLines ?? knowledgeBaseFixedLines));
                    this.holdFor(file, h.reason, `${h.reason}: ${h.match}`);
                }
                // Quoting's own holds. A money exception still on the route is Ben's and carried its line
                // above; money the router handed to Quoting (5.3) that its reading did not answer is held here.
                if (!exceptions.includes('money')) {
                    if (quoting?.proposal.hold?.reason === 'money') {
                        fixedLines.push(await fixedLine('money_to_ben', this.deps.fixedLines ?? knowledgeBaseFixedLines));
                        this.holdFor(file, 'money', `money beyond a quote line: ${quoting.proposal.hold.match}`);
                    } else if (quoting?.proposal.hold?.reason === 'stale_quote') {
                        this.holdFor(file, null, `the quote is no longer live (${quoting.proposal.hold.match}): no figure may be read from it and the customer has been told Ben will come back to them on it`);
                    } else if (quoting?.proposal.hold?.reason === 'draft_failed') {
                        fixedLines.push(await fixedLine('held_ack', this.deps.fixedLines ?? knowledgeBaseFixedLines));
                        this.holdFor(file, null, `${DRAFT_FAILED_HOLD} (${quoting.proposal.hold.match}): no quote exists for this job and Ben has had no notification, so the quote is his to build`, null, DRAFT_FAILED_HOLD);
                        if (scoping) { scoping.proposal.nextQuestion = null; scoping.proposal.mentionPhotos = false; scoping.proposal.ready = false; }
                    }
                }
                if (quoting?.proposal.hold?.acceptedInChat) {
                    this.holdFor(file, null, `acceptance in chat: the customer said yes to the quote (${quoting.proposal.hold.match}); acceptance stays on the quote page and with Ben`);
                }
                // Goal 5: dates and lead time are the Scheduling specialist's, read from the diary; a date change holds for Ben and the reply still answers the rest.
                // The router's date_change exception is passed in, and holds where the diary shows the customer a booking or could not say (checklist 5.5). A move the router
                // missed reaches the specialist when the file names a booking or a quote, or the diary holds a booking under the customer's own phone or email.
                const schedulingDeps = { ...this.deps.scheduling, now: this.now };
                const routedToScheduling = route.subjects.includes('scheduling') || exceptions.includes('date_change') || !!dateQuestionMatch(turn.body);
                // The party-booking lookup itself only ever runs for a date-change-shaped turn (scheduling-specialist.ts),
                // so this gate's own belt match is the one place worth checking it early: a plain scheduling or date
                // question never needs it, since routedToScheduling already answers those. Its result is carried into
                // schedule() so the one lookup is never repeated.
                let partyLookup: PartyBookings | undefined;
                let moveOfABooking = false;
                if (!routedToScheduling && dateChangeMatch(turn.body)) {
                    if (file.job.bookingRef || file.job.quoteRef || file.stage === 'booked') moveOfABooking = true;
                    else {
                        partyLookup = await partyBookings(file, schedulingDeps);
                        moveOfABooking = partyLookup.state === 'found';
                    }
                }
                if (routedToScheduling || moveOfABooking) {
                    const sched = await schedule(file, turn, party, this.client, schedulingDeps, { dateChange: exceptions.includes('date_change'), scheduling: route.subjects.includes('scheduling') }, partyLookup);
                    calls.push(...sched.calls);
                    specialists.push(sched);
                    if (sched.error) log(`scheduling: ${sched.error}`);
                    for (const kind of sched.scheduling.fixedLines) fixedLines.push(await fixedLine(kind, this.deps.fixedLines ?? knowledgeBaseFixedLines));
                    if (sched.proposal.hold) this.holdFor(file, sched.proposal.hold.reason === 'date_change' ? 'date_change' : null, `${sched.proposal.hold.reason}: ${sched.proposal.hold.match}`);
                }
                fixedLines.push(...(await channelFixedLines(file, party, turn, this.deps.fixedLines ?? knowledgeBaseFixedLines, this.now())));
                // Pauses, promises and a not-ready customer get an acknowledgement and no question.
                if (scoping && exceptions.includes('callback')) scoping.proposal.offerCall = false;
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
                if (first.output) { reply = first.output.reply; factIds = first.output.factIds; citedKbIds = first.output.kbIds; }
                else {
                    log(`composer: ${first.refused ? 'refused' : first.error}`);
                    return this.heldAck(file, party.personId, turn, runId, calls, `composer ${first.refused ? 'declined' : 'failed'}: ${first.error}`, null, composerCalls, specialists, undefined, summarise(route, specialists));
                }
            }
        }

        const summary = summarise(route, specialists);
        // 5. Guards, with one retry to the composer.
        const proposedSubject = scopingProposal(specialists)?.nextQuestion?.subject ?? null;
        const lookedUp = specialists.flatMap((s) => s.factIds);
        // An attempt is guarded against its own citations: the rows are resolved from the ids that attempt returned, and the fixed lines' own rows, which every attempt carries.
        const guardAttempt = async (text: string, ids: string[], cited: string[]): Promise<{ guards: GuardOutcome; kbIds: string[] }> => {
            const merged = Array.from(new Set([...fixedLineKbIds, ...cited]));
            const kbRows = await this.kbRows(merged, fixedLines);
            return { guards: runGuards({ file, party, turn, reply: text, factIds: ids, kbIds: merged, kbRows, fixedLines, lookedUp, proposedSubject, liveQuoteRefs }), kbIds: merged };
        };
        // One thing at a time (checklist 2.3) is checked with the guards, so the one retry covers it too.
        const withOneThing = (g: GuardOutcome, text: string): GuardOutcome => {
            const n = scopingQuestionCount(text);
            return n > 1 ? { ok: false, guards: g.guards, failures: [...g.failures, `one thing at a time: ${n} questions about the job in one reply; ask one, with one question mark`] } : g;
        };
        const attempt = await guardAttempt(reply!, factIds, citedKbIds);
        let kbIds: string[] = attempt.kbIds;
        let guards: GuardOutcome = withOneThing(attempt.guards, reply!);
        if (!guards.ok && !fixedLineOnly) {
            const again = await compose({ file, party, turn, route, specialists, fixedLines, failures: guards.failures, now: this.now() }, this.client);
            calls.push(again.record);
            composerCalls++;
            if (again.output) {
                const retry = await guardAttempt(again.output.reply, again.output.factIds, again.output.kbIds);
                const g2 = withOneThing(retry.guards, again.output.reply);
                if (g2.ok) { reply = again.output.reply; factIds = again.output.factIds; kbIds = retry.kbIds; guards = g2; }
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
        if (!rendered.ok && rendered.reason === 'ceiling' && !fixedLineOnly) {
            const shorter = await compose({ file, party, turn, route, specialists, fixedLines, shorten: shortenBriefFor(choice.channel, reply!, rendered.bubbles), now: this.now() }, this.client);
            calls.push(shorter.record);
            composerCalls++;
            if (shorter.output) {
                const short = await guardAttempt(shorter.output.reply, shorter.output.factIds, shorter.output.kbIds);
                const r3 = render(choice.channel, shorter.output.reply, { name: party.name });
                if (short.guards.ok && r3.ok) { reply = shorter.output.reply; factIds = shorter.output.factIds; kbIds = short.kbIds; guards = short.guards; rendered = r3; }
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
                this.holdFor(file, exceptions[0] ?? null, why, reply, DESK_RUN_NOTE);
                return { ...this.nothing(file, party.personId, runId, calls, why, 'hold'), factIds, kbIds, guards: guards.guards, composerCalls, windowState: 'shut', channel: choice.channel, summary };
            }
            const tmpl = templateChoiceFor(file, turn);
            const pick = await pickTemplate(tmpl.purpose, { name: party.name, topic: tmpl.topic, at: this.now() }, this.deps.templates ?? liveTemplateStatus);
            if (!pick.ok) {
                this.holdFor(file, exceptions[0] ?? null, `window shut and ${pick.reason}`, reply, DESK_RUN_NOTE);
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
        this.afterSend(file, party.personId, templateWording ?? reply!, templateWording ? null : scopingProposal(specialists), templateWording ? [] : fixedLines);
        return {
            runId, decision: 'send', partyId: party.personId, channel: choice.channel, windowState: window.state, templateId: template?.name ?? null, bubbles: rendered.bubbles,
            factIds, kbIds: Array.from(new Set(kbIds)), guards: guards.guards, approver: DESK_APPROVER, hold: file.hold, delivered: true, stageAfter: file.stage,
            calls, note: null, summary, error: null, landedTurnId: sent.record.turnId, composerCalls,
        };
    }

    /**
     * One record of what a thread is held on. A first hold is raised; a fixed-line-only reason
     * takes over a standing hold that answers the rest, so the graver reason is the one Ben's card
     * shows and the one step 0 reads. A second reason of the same weight, a price and a call
     * request in one message, is added to the card rather than dropped, with `ownCard` marking a
     * note that is the desk's own run speaking rather than a new question for Ben (case-file.ts noteOnHold).
     */
    private holdFor(file: CaseFile, exception: HoldException | null, reason: string, draft: string | null = null, ownCard?: string): void {
        if (!file.hold) { setHold(file, { approver: approverFor(file, exception), reason, exception, draft }, this.fileDeps()); return; }
        const standing = file.hold.exception;
        if (exception && FIXED_LINE_ONLY.has(exception) && !(standing && FIXED_LINE_ONLY.has(standing))) {
            supersedeHold(file, { approver: approverFor(file, exception), reason, exception }, this.fileDeps());
            return;
        }
        noteOnHold(file, { reason, draft, ownCard });
    }

    /** Contract 4's second failure and the composer's fallback route: hold with the draft, and the customer still hears the fixed acknowledgement. */
    private async heldAck(file: CaseFile, partyId: string, turn: Turn, runId: string, calls: ModelCallRecord[], why: string, draft: string | null, composerCalls: number, specialists: SpecialistReturn[], failed?: GuardOutcome, summary: string | null = null): Promise<DeskResult> {
        const party = partyOf(file, partyId)!;
        const held = { reason: why, draft, failures: failed?.failures ?? [] };
        if (file.hold) noteOnHold(file, { ...held, ownCard: DESK_RUN_NOTE });
        else setHold(file, { approver: approverFor(file, null), ...held }, this.fileDeps());
        const line = await fixedLine(regulatedMatch(turn.body) ? 'gas' : 'held_ack', this.deps.fixedLines ?? knowledgeBaseFixedLines);
        const kbIds = line.kbId ? [line.kbId] : [];
        const guards = runGuards({ file, party, turn, reply: line.text, factIds: [], kbIds, kbRows: await this.kbRows(kbIds, [line]), fixedLines: [line], proposedSubject: null, liveQuoteRefs: new Set() });
        const choice = chooseChannel(party, turn.channel, this.now());
        const window = choice.ok ? windowOf(party, choice.channel, this.now()) : null;
        const rendered = choice.ok ? render(choice.channel, line.text, { name: party.name }) : null;
        const base = { ...this.nothing(file, partyId, runId, calls, why, 'hold'), summary };
        if (!choice.ok || !window || !rendered?.ok || !guards.ok || window.state === 'shut') return { ...base, guards: guards.guards, composerCalls, note: `${why}; acknowledgement not sent: ${!choice.ok ? choice.reason : !rendered?.ok ? `no render for ${choice.channel}` : !guards.ok ? guards.failures.join('; ') : 'window shut'}` };
        const bubbles: RenderedBubble[] = rendered.bubbles;
        const sent = await send({ file, partyId, channel: choice.channel, window, bubbles, template: null, runId, approver: DESK_APPROVER, guards, factIds: [], kbIds, fixedLines: [line], calls, mode: this.deps.mode ?? 'dry_run' }, { ...this.deps.sender, now: this.now, newId: this.deps.newId });
        if (!sent.ok) return { ...base, guards: guards.guards, composerCalls, note: `${why}; acknowledgement refused: ${sent.reason}` };
        this.afterSend(file, partyId, line.text, null, [line]);
        return { ...base, decision: 'hold', channel: choice.channel, windowState: window.state, bubbles, kbIds, guards: guards.guards, approver: DESK_APPROVER, hold: file.hold, delivered: true, stageAfter: file.stage, landedTurnId: sent.record.turnId, composerCalls, note: why };
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

    /**
     * The reviewed rows behind the cited ids. A fixed line resolves from itself: its words came
     * from the reviewed row `fixedLine` read (fixed-lines.ts), which is a different reader from the
     * knowledge base's own list, and the guards' verbatim rail must see the same words either way.
     */
    private async kbRows(ids: string[], fixedLines: FixedLine[] = []): Promise<KbRow[]> {
        if (!ids.length) return [];
        const own = fixedLines.filter((f) => f.kbId && ids.includes(f.kbId)).map((f) => ({ id: f.kbId!, approvedWords: f.text, reviewed: true }));
        const rest = ids.filter((id) => !own.some((r) => r.id === id));
        if (!rest.length) return own;
        const rows = await (this.deps.kb ?? reviewedKb).list();
        return [...own, ...rows.filter((r) => rest.includes(r.id)).map((r) => ({ id: r.id, approvedWords: r.approvedWords, reviewed: true }))];
    }
}

/** The Scoping proposal, the one a reply's ledger and summary are written from; null when Scoping did not run on this turn. */
function scopingProposal(specialists: SpecialistReturn[]): Proposal | null {
    return specialists.find((s) => s.specialist === 'scoping')?.proposal ?? null;
}

/** A hold reason a fixed line answers (service/hold-reasons.ts). Quoting's own reasons are not in that vocabulary; the desk raises them on their own. */
function isHoldException(reason: string): reason is HoldException {
    return Object.prototype.hasOwnProperty.call(FIXED_LINE_FOR, reason);
}

/** One line of evidence: the route and the proposal behind a reply. */
function summarise(route: Route, specialists: SpecialistReturn[]): string {
    const p = scopingProposal(specialists);
    const bits = [`turn ${route.turnKind}`, `subjects ${route.subjects.join('+')}`, `exception ${route.exceptions.join('+') || 'none'}`];
    if (p) bits.push(`ask ${p.nextQuestion ? `${p.nextQuestion.subject}${p.nextQuestion.unknowns.length ? ' (' + p.nextQuestion.unknowns.join(', ') + ')' : ''}` : 'none'}`, `call ${p.offerCall ? 'yes' : 'no'}`, `photos ${p.mentionPhotos ? 'mention' : p.thankForMedia ? 'thank' : 'no'}`, `ready ${p.ready ? 'yes' : 'no'}`);
    const q = quotingSummary(specialists.find((s) => s.specialist === 'quoting'));
    if (q) bits.push(q);
    for (const s of specialists) {
        if (s.specialist === 'scoping') { if (s.error) bits.push(`specialist error: ${s.error}`); continue; }
        // Quoting's line is its summary above; a specialist with a note of its own says it in one line; the rest are summarised by their brief.
        if (s.specialist !== 'quoting') bits.push(s.note ?? `${s.specialist}: ${s.brief?.length ? s.brief.join(' | ') : 'nothing to add'}`);
        if (s.error) bits.push(`${s.specialist} error: ${s.error}`);
    }
    if (route.error) bits.push(`router error: ${route.error}`);
    return bits.join('; ');
}
