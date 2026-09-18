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
 * records the gravest, so a price question that also asks for a call gets both lines. A reply that
 * puts a question off on a turn Service's model did not read holds as no source too (6b).
 * Complaints, refunds, trust doubts, gas and scoping that is not converging: one fixed line in
 * Ben's words, no composer, and while the hold stands no specialist either: each later turn gets
 * the short acknowledgement that Ben will come back. The vocabulary is server/comms-v2/service/
 * hold-reasons.ts. A thread held because the customer asked us to stop gets not even that
 * acknowledgement: no specialist, no composer and nothing sent on any later turn while the hold
 * stands (`optOutHeld`), because someone who asked us to stop is not written to again whatever the
 * opt-out ledger says yet. A router that fails to read the turn holds for Ben with the fixed acknowledgement,
 * since nothing then rules out a complaint or a refund. The acknowledgement names a photo or video the turn
 * carried. A photo or video that arrived well before the turn and is still unthanked is thanked for in
 * a line that says so, after the reply to what the customer has just said. A guard failure goes back to the composer once, then holds with the fixed
 * acknowledgement. A composer refusal or failure takes the fixed acknowledgement, never a silent
 * empty reply; so does a reply the sender refuses, which live includes one of Ben's four fixed
 * lines he has not yet reviewed. Never silent otherwise; a clock pass never messages a customer
 * ("no chasing", "one acknowledgement, then quiet"); it is where Ben is chased instead (7.5).
 *
 * An expired quote is reissued automatically (quoting/reissue.ts) when the customer writes back and
 * nothing else on the turn or the thread is Ben's: the desk claims the reissue once every other hold
 * is known, and the one reply opens with the fixed sentence saying the old quote expired, the new
 * price and the link, followed by the composer's answer to anything else they asked. Anything that
 * stops the reissue leaves the thread held for Ben exactly as an expired quote always was; a reissue
 * the customer was not told about holds for Ben with that said.
 */
import { randomUUID } from 'node:crypto';
import { ask as ledgerAsk, answered as ledgerAnswered, thanked as ledgerThanked, hold as setHold, release as releaseHold, noteOnHold, supersede as supersedeHold, partyOf, setStage, isReady, isTurnOf, messagesOf, type CaseFile, type ModelCallRecord, type Turn, type TurnMedia, type CaseFileDeps, type RenderedBubble } from './case-file';
import { schedule } from '../scheduling/scheduling-specialist';
import { dateChangeMatch, dateQuestionMatch, partyBookings, type PartyBookings, type SchedulingDeps } from '../scheduling/scheduling-tools';
import { compose, type ComposeInput } from './composer';
import type { DeskLike, DeskResult, Proposal, SpecialistReturn } from './desk-types';
import { fixedLine, heldAckLine, knowledgeBaseFixedLines, lateMediaAckLine, LATE_MEDIA_MS, type FixedLine, type FixedLineSource } from './fixed-lines';
import { approverFor, noReplyToCheck, runGuards, type GuardOutcome, type KbRow } from './guards';
import { asksForCall, asksProposed, deferralMatch, offersCall, RE_THANKS_MEDIA, regulatedMatch, scopingQuestionCount, textAsks } from './lexicon';
import { AnthropicModelClient, type ModelClient } from './models';
import { TurnModelWatch, type TurnReport } from './model-health';
import type { Exception, HoldException, Route } from './router';
import { matchFor, route as routeTurn } from './router';
import { scope, type ScopingDeps } from './scoping-specialist';
import { chaseIfDue, clearChaseRecord, type ChaseState } from '../service/chase';
import { ANSWER_THE_REST, FIXED_LINE_FOR, FIXED_LINE_ONLY, regulatedWithoutLine } from '../service/hold-reasons';
import { serve, type ServiceSpecialistDeps } from '../service/service-specialist';
import { asksAboutOurArea, asksToChangeDetails } from '../service/service-tools';
import { asksAboutInvoice } from '../service/customer-record';
import { BUBBLE_CEILING, BUBBLE_MAX_CHARS, BUBBLE_SOFT_MAX_CHARS, DESK_APPROVER, chooseChannel, liveTemplateStatus, pickTemplate, render, send, shortenBriefFor, windowOf, type SenderDeps, type TemplateSend, type TemplateStatusSource, type WindowState } from './sender';
import { reviewedKb, type KbReader } from './scoping-tools';
import { channelFixedLines, MOVE_TO_WHATSAPP_SUBJECT } from '../channels/channel-lines';
import { templateChoiceFor } from '../channels/templates';
import { STALE_HOLD, afterReissue, quote as quoteGather, quoteStateOf, quotingClock, quotingOwnsThread, quotingSummary, type QuotingReturn, type QuotingSpecialistDeps, type ReissueCandidate } from '../quoting/quoting-specialist';
import { quotesOnFile, recordReissue, reissueExpiredQuote, resolveQuotingDeps } from '../quoting/quoting-tools';
import { reissueLine, type ReissueIssue } from '../quoting/reissue';
import { pounds } from '../quoting/quote-record';
import { refreshBenToRequest } from '../quoting/ben-to-request';
import { draftToRecover, markDraftFailed, type BackgroundDraftHooks } from '../quoting/background-draft';
import { repeatedSentences, saidSinceLastQuestion, withoutSentences } from './repeat';
import { detectOptOut } from '../../opt-out-detect';
import { transcriptOf } from '../channels/call-adapter';
import { withoutEmailSubject } from '../channels/email-adapter';

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
    /** Told what each customer turn said about the desk's models (model-health.ts recordTurnModelHealth); the live intake passes it. */
    modelHealth?: (report: TurnReport) => Promise<unknown>;
    /**
     * Puts a file in the store the gateway reads. Given, the quote is drafted off the reply path
     * (quoting/background-draft.ts) and the file is put again when the draft finishes; the live
     * intake passes it. Unset, the draft is awaited inside the pass.
     */
    persist?: (file: CaseFile) => void | Promise<void>;
}

/**
 * The channels whose opt-out the old inbound path records (server/agents/comms-lanes.ts gate 0,
 * server/opt-out.ts): SMS and WhatsApp. Every other turn, a call, an email, a web form or a channel
 * added later, is not known to be recorded.
 */
const OPT_OUT_RECORDED_ON: ReadonlySet<Turn['channel']> = new Set<Turn['channel']>(['sms', 'whatsapp']);

/** The opening of the hold the desk raises for an opt-out the old inbound path does not record, and the words `optOutHeld` reads back. */
const OPT_OUT_HOLD = 'customer may have asked to stop';

function optOutPlace(channel: Turn['channel']): string {
    switch (channel) {
        case 'call': return 'on a call';
        case 'email': return 'by email';
        case 'form': return 'on a web form';
        default: return `on ${channel}`;
    }
}

/** A speaker label in a transcript ("Customer:", "Agent:", "Speaker 1:"), and the ones that are our side of the call. */
const RE_SPEAKER = /\b((?:agent|ben|va|customer|caller|speaker\s*\d+)):/i;
const RE_OUR_SPEAKER = /^(?:agent|ben|va)$/i;

/**
 * A call transcript as the short messages the opt-out check reads: each sentence the caller said, on
 * its own, so "please stop contacting me" inside a long call is read as the terse instruction it is.
 * Speech runs on, so a sentence is also cut at commas and at "so", "but", "and": "...sorted it at the
 * weekend so please stop contacting me about it" reads its last clause on its own.
 * Our side of the call, where it is labelled, is left out.
 */
function transcriptSentences(body: string): string[] {
    const parts = transcriptOf({ body } as Turn).split(RE_SPEAKER);
    const said: string[] = [parts[0]];
    for (let i = 1; i + 1 < parts.length; i += 2) if (!RE_OUR_SPEAKER.test(parts[i])) said.push(parts[i + 1]);
    return said.flatMap((s) => s.split(/[.?!\n,;:]+|\b(?:so|but|and)\b/i)).map((s) => s.trim()).filter(Boolean);
}

/**
 * An email as the opt-out check reads it: the turn's body, and the message on its own without the
 * subject line the adapter puts in front of it (channels/email-adapter.ts). An opt-out is a terse
 * instruction and the detector is deliberately conservative about long messages, so an email whose
 * whole message is "STOP" must be read as that message and not as the thread's subject plus a word.
 */
function emailTexts(body: string): string[] {
    const message = withoutEmailSubject(body);
    return message === body ? [body] : [body, message];
}

/** An opt-out in any one message the turn carries, each read on its own as the old inbound path reads it; a call transcript sentence by sentence, an email without its subject line as well. */
function optOutIn(file: CaseFile, turn: Turn): ReturnType<typeof detectOptOut> {
    for (const id of messagesOf(turn)) {
        const body = file.turns.find((t) => t.id === id)?.body ?? (id === turn.id ? turn.body : null);
        const texts = !body ? [body]
            : turn.kind === 'call_transcript' ? transcriptSentences(body)
            : turn.channel === 'email' ? emailTexts(body)
            : [body];
        for (const text of texts) {
            const match = detectOptOut(text);
            if (match) return match;
        }
    }
    return null;
}

/**
 * A customer who has just asked us to stop, in any message of the turn, hears nothing back, not even an
 * acknowledgement, and no model reads the turn. On SMS and WhatsApp (`OPT_OUT_RECORDED_ON`) the old inbound
 * path writes the ledger, so `holdReason` is null; anywhere else (a call too, which the channel desk
 * checks before reading the transcript) the thread holds for Ben to check and record it.
 */
export function optOutOnTurn(file: CaseFile, turn: Turn): { note: string; holdReason: string | null } | null {
    const optOut = optOutIn(file, turn);
    if (!optOut) return null;
    const asked = `the customer asked us to stop ("${optOut.keyword}", ${optOut.scope})`;
    if (OPT_OUT_RECORDED_ON.has(turn.channel)) return { note: `${asked}: no reply, no model call`, holdReason: null };
    const where = optOutPlace(turn.channel);
    return { note: `${asked} ${where}: no reply, no model call, held for Ben to record the opt-out`, holdReason: `${OPT_OUT_HOLD} ${where}; check and record the opt-out: ${asked}` };
}

/**
 * Whether the thread is held because the customer asked us to stop. The hold's reason is the one
 * record of what a thread is held on (case-file.ts `hold`, `noteOnHold`), so the opt-out is read
 * back from it: the reason the hold was raised for, or one added to a card Ben already had, which
 * is written after it and never over it.
 */
export function optOutHeld(file: CaseFile): boolean {
    return !!file.hold && file.hold.reason.includes(OPT_OUT_HOLD);
}

/**
 * The opt-out hold onto the file a person's next message opens. A file closes when the job is
 * booked or done (file-close.ts) and the person's next message then opens a new one (store.ts
 * `newestOpenFor`), so without this the silence would end with the close rather than with Ben.
 * Their newest file alone is read, so the hold Ben has released is not raised again by an older
 * file that still carries it.
 *
 * What travels is the fact that this person asked us to stop, and nothing else. A hold is one card
 * carrying every reason it was raised for, so the earlier card's own words - a complaint, and
 * whatever the customer said in it - belong to that thread and are never copied onto a fresh file
 * about another job: the new card is written here, naming the file the opt-out is recorded on, and
 * answers to the slot this file's own opt-out would (`approverFor`).
 */
export function carryOptOutHold(file: CaseFile, files: Iterable<CaseFile>, personId: string, deps: CaseFileDeps = {}): boolean {
    if (file.hold) return false;
    const previous = Array.from(files)
        .filter((f) => f.id !== file.id && f.parties.some((p) => p.personId === personId))
        .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt))[0];
    if (!previous || !optOutHeld(previous)) return false;
    const reason = `${OPT_OUT_HOLD}, on case file ${previous.id} (held since ${previous.hold!.since}), which closed while that hold stood; check and record the opt-out, which stands here until it is released`;
    return setHold(file, { approver: approverFor(file, null), reason, exception: null }, deps).ok;
}

/**
 * What the desk records on Ben's card, and returns as the run's note, for each later turn it
 * answers with nothing while the opt-out hold stands. Written once: the same words are already on
 * the card by the second follow-up (case-file.ts `noteOnHold`).
 */
const OPT_OUT_HELD = 'the opt-out hold stands: no specialist read this turn, no reply was composed and nothing was sent, until Ben releases it';

/** The opening of the hold reason the desk writes when the clerk could not build the quote, and the one it reads back to answer that hold once a quote exists. */
const DRAFT_FAILED_HOLD = 'the quote draft failed';

/**
 * What the desk calls a note about its own run - a shut window, no approved template, a reply the
 * guards refused. It opens no card of its own, so it never restates one; saying it marks the note
 * as the same automatic step speaking rather than a customer's question added to Ben's card, which
 * is what decides whether the card is still the desk's to clear (`case-file.ts` noteOnHold).
 */
const DESK_RUN_NOTE = 'the desk could not finish this run';

/** The opening of the card the desk raises when it reissued a quote and the customer was not told. */
const REISSUE_NOT_TOLD = 'the desk reissued the expired quote';

/** A reissue this run claimed: what the reply must carry, and what the file records once the run is over. */
interface ClaimedReissue {
    slug: string;
    issue: ReissueIssue;
    previousTotalPence: number;
    link: string;
    /** The sentence the reply opens with (reissue.ts `reissueLine`). */
    line: string;
    /** The Total fact the sentence's figure is. */
    totalFactId: string;
}

/** What one run carries beside the file: the reissue it claimed, if any. */
interface RunContext { reissue: ClaimedReissue | null }

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
    private quotingDeps(): QuotingSpecialistDeps { return { ...this.deps.quoting, now: this.now, newId: this.deps.newId, ...(this.background ? { background: this.background } : {}) }; }

    /** The background draft's hooks, when the desk has a store to put a finished draft in. */
    private get background(): BackgroundDraftHooks | null {
        const persist = this.deps.persist;
        if (!persist) return null;
        return {
            persist,
            log: this.deps.log,
            // The same hold the inline failure raises; the reply that turn has already gone, so no line is added to it.
            onDrafted: (file) => this.releaseDraftFailedHold(file),
            onFailed: (file, reason) => this.holdFor(file, null, `${DRAFT_FAILED_HOLD} (${reason}): no quote exists for this job and Ben has had no notification, so the quote is his to build`, null, DRAFT_FAILED_HOLD),
        };
    }

    /**
     * A quote the desk failed to draft earlier exists now, so the hold that told Ben to build it
     * himself is answered: the desk releases it in its own words and the card points at the price
     * screen, rather than leaving him to make a second quote by hand.
     */
    private releaseDraftFailedHold(file: CaseFile): void {
        if (!file.hold?.reason.startsWith(DRAFT_FAILED_HOLD) || file.hold.notedOn || !file.job.quoteRef) return;
        const priceScreen = quoteStateOf(file)?.priceScreen;
        releaseHold(file, file.hold.approver, `the desk drafted quote ${file.job.quoteRef} on a later turn and Ben has been notified${priceScreen ? `: ${priceScreen}` : ''}`, this.fileDeps());
    }

    /**
     * A background draft a restart lost (quoting/background-draft.ts): started again from the turn it
     * was started on, off the reply path, or held for Ben once it has been started as often as it
     * may be. Never a customer send.
     */
    private async recoverDraft(file: CaseFile): Promise<string | null> {
        if (!this.background) return null;
        const lost = draftToRecover(file);
        if (!lost) return null;
        const turn = (lost.turnId ? file.turns.find((t) => t.id === lost.turnId) : null) ?? [...file.turns].reverse().find((t) => t.direction === 'inbound') ?? null;
        const party = turn ? partyOf(file, turn.partyId) : null;
        if (!turn || !party) return 'a lost quote draft has no customer turn to start from';
        if (lost.exhausted) {
            const reason = 'the draft was started and never finished, twice';
            markDraftFailed(file, turn.id, reason, this.fileDeps());
            this.background.onFailed(file, reason);
            return `quote draft held for Ben: ${reason}`;
        }
        const route: Route = { subjects: ['quoting'], proposedStage: file.stage, party: 'customer', turnKind: 'other', exceptions: [], belts: { regulated: null, money: null }, moneyToQuoting: false, error: null,
            call: { role: 'router', model: 'none', effort: null, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costPence: 0, durationMs: 0 } };
        const r = await quoteGather(file, turn, party, route, this.client, { ...this.quotingDeps(), recoverSince: lost.since });
        if (r?.error && r.proposal.hold?.reason === 'draft_failed') {
            markDraftFailed(file, turn.id, r.error, this.fileDeps());
            this.background.onFailed(file, r.error);
            return `quote draft held for Ben: ${r.error}`;
        }
        return 'a quote draft lost to a restart was started again';
    }

    /** A clock pass with no new message: the desk never chases the customer, so nothing goes to them; an unpriced draft is chased for Ben (4.5) and a held thread chases Ben, then the owner (7.5). */
    async clockPass(file: CaseFile): Promise<DeskResult> {
        const party = file.parties[0];
        const recovered = await this.recoverDraft(file).catch((e: any) => `recovering a lost quote draft failed: ${e?.message ?? e}`);
        const chased = await quotingClock(file, this.quotingDeps());
        // The gateway (gateway.ts) answers a customer turn once it is due, and recovers one a restart
        // left behind before this pass runs; a tick can still land here while one is waiting out its
        // quiet window or being answered (the file's `waits`), so the note says that rather than
        // claiming there is nothing to reply to.
        const waitingNote = (file.waits ?? []).some((w) => w.partyId === party.personId)
            ? 'a customer turn is waiting out its quiet window; the desk never chases, so it answers once quiet'
            : 'no customer turn, nothing to reply to; the desk never chases the customer';
        const base = this.nothing(file, party.personId, `run_${randomUUID()}`, [], `clock pass: ${waitingNote}; ${chased.note}${recovered ? `; ${recovered}` : ''}`);
        const chase = this.deps.service?.chase;
        if (!chase) return { ...base, chase: null };
        // A release from any surface, the board included, leaves the old record behind: clear it here,
        // the one pass that runs whether or not the file is held.
        if (!file.hold) { clearChaseRecord(file); return { ...base, chase: null }; }
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
        const watch = new TurnModelWatch(this.client);
        const ctx: RunContext = { reissue: null };
        const result = this.settleReissue(file, ctx, await this.runTurn(file, turn, watch, ctx));
        const report = this.deps.modelHealth;
        if (report && turn.direction === 'inbound') {
            try {
                await report({ outcome: watch.outcome(), at: this.now(), runId: result.runId, caseId: file.id, decision: result.decision });
            } catch (error: any) {
                (this.deps.log ?? console.error)(`model health: could not record the turn (${error?.message ?? error})`);
            }
        }
        return result;
    }

    /**
     * What became of a reissue this run claimed, recorded on the file for Ben's card: sent, when the
     * reply that landed carried the sentence and its link; otherwise not sent, and the thread held
     * for Ben with the new price named, because the customer now holds a link whose price moved.
     * The desk never sends it again: the claim was this run's alone.
     */
    private settleReissue(file: CaseFile, ctx: RunContext, result: DeskResult): DeskResult {
        const r = ctx.reissue;
        if (!r) return result;
        const told = result.decision === 'send' && result.delivered && !result.templateId && result.bubbles.map((b) => b.text).join('\n').includes(r.link);
        const sentAt = told ? (file.turns.find((t) => t.id === result.landedTurnId)?.at ?? this.now().toISOString()) : null;
        const notSent = told ? null : (result.note ?? 'the reply carrying it did not go');
        recordReissue(file, { slug: r.slug, issue: r.issue, previousTotalPence: r.previousTotalPence, sentAt, notSent }, this.quotingDeps());
        if (!told) this.holdFor(file, null, `${REISSUE_NOT_TOLD} ${r.slug} at ${pounds(r.issue.totalPence)} (was ${pounds(r.previousTotalPence)}), but the message telling the customer did not go (${notSent}): tell them the new price and the link ${r.link}`);
        return told ? result : { ...result, hold: file.hold };
    }

    /**
     * Whether this turn may reissue the file's expired quote, and if so the claim. Every refusal
     * names why, for Ben's card, and leaves the quote as it was:
     *   - anything the Quoting reading found for Ben (money beyond a line, acceptance, a failed read);
     *   - any exception the router raised, and any hold on the thread other than the desk's own
     *     card for this stale quote with nobody else's words on it;
     *   - a reply channel whose window is shut, because no approved template carries this sentence;
     *   - a standing opt-out on any of the customer's numbers, or an opt-out ledger that cannot say;
     *   - the store refusing (the price cannot be taken from the original with certainty) or another
     *     run or a person moving the row first.
     */
    private async claimReissue(file: CaseFile, turn: Turn, runId: string, candidate: ReissueCandidate, exceptions: Exception[]): Promise<{ ok: true; claimed: ClaimedReissue; specialist: QuotingReturn } | { ok: false; why: string; claimedButLost?: { issue: ReissueIssue; previousTotalPence: number } }> {
        if (candidate.blockers.length) return { ok: false, why: candidate.blockers.join('; ') };
        if (exceptions.length) return { ok: false, why: `the turn also raised ${exceptions.join(', ')}` };
        if (file.hold && !(file.hold.reason.startsWith(STALE_HOLD) && !file.hold.notedOn)) return { ok: false, why: 'the thread is held for Ben on something else' };
        const party = partyOf(file, turn.partyId)!;
        const choice = chooseChannel(party, turn.channel, this.now());
        if (!choice.ok) return { ok: false, why: choice.reason };
        if (windowOf(party, choice.channel, this.now()).state === 'shut') return { ok: false, why: `the ${choice.channel} window is shut and no approved template carries the new price` };
        const store = resolveQuotingDeps(this.quotingDeps()).store;
        if (!store.optedOut) return { ok: false, why: 'the opt-out ledger cannot be read here' };
        try {
            for (const c of party.channels.filter((x) => x.kind === 'whatsapp' || x.kind === 'sms')) {
                const scope = await store.optedOut(c.address);
                if (scope) return { ok: false, why: `the customer has opted out (${scope})` };
            }
        } catch (e: any) {
            return { ok: false, why: `the opt-out ledger could not be read (${e?.message ?? e})` };
        }
        const r = await reissueExpiredQuote(file, runId, this.quotingDeps()).catch((e: any) => ({ ok: false as const, reason: `the reissue failed (${e?.message ?? e})`, raced: false, claimed: false }));
        if (!r.ok) {
            const lost = 'claimed' in r && r.claimed && 'issue' in r && r.issue ? { issue: r.issue, previousTotalPence: r.previousTotalPence ?? 0 } : undefined;
            return { ok: false, why: r.reason, ...(lost ? { claimedButLost: lost } : {}) };
        }
        const claimed: ClaimedReissue = { slug: r.record.slug, issue: r.issue, previousTotalPence: r.previousTotalPence, link: r.link, line: reissueLine(r.issue.totalPence, r.link), totalFactId: r.totalFactId };
        return { ok: true, claimed, specialist: afterReissue(file, r.record, candidate, { totalFactId: r.totalFactId, link: r.link, factIds: r.factIds }, this.quotingDeps()) };
    }

    private async runTurn(file: CaseFile, turn: Turn, client: ModelClient, ctx: RunContext): Promise<DeskResult> {
        const runId = `run_${randomUUID()}`;
        const calls: ModelCallRecord[] = [];
        const party = partyOf(file, turn.partyId);
        if (!party) return this.nothing(file, file.parties[0].personId, runId, calls, 'the turn\'s party is not on the file');
        if (turn.direction !== 'inbound') return this.nothing(file, party.personId, runId, calls, 'not a customer turn');
        // An opt-out: no reply and no model call; held for Ben where the old inbound path does not record it.
        const optOut = optOutOnTurn(file, turn);
        if (optOut) {
            if (!optOut.holdReason) return this.nothing(file, party.personId, runId, calls, optOut.note);
            this.holdFor(file, null, optOut.holdReason);
            return this.nothing(file, party.personId, runId, calls, optOut.note, 'hold');
        }
        const log = this.deps.log ?? (() => undefined);
        // Ben's note of what the draft is missing, true as of this turn: a photo that has just landed is no longer his to request.
        refreshBenToRequest(file, this.fileDeps());

        // 0. A thread held on a fixed line stays with Ben: no specialist, one acknowledgement per
        // turn - and where it is held because the customer asked us to stop, not even that: they
        // hear nothing while the hold stands, exactly as on the turn they asked (`optOutOnTurn`),
        // whatever the opt-out ledger says yet. Read first, because that silence is graver than any
        // exception's acknowledgement.
        if (optOutHeld(file)) {
            this.holdFor(file, null, OPT_OUT_HELD, null, DESK_RUN_NOTE);
            return this.nothing(file, party.personId, runId, calls, OPT_OUT_HELD, 'hold');
        }
        if (file.hold?.exception && FIXED_LINE_ONLY.has(file.hold.exception)) {
            return this.heldAck(file, party.personId, turn, runId, calls, `held for Ben on ${file.hold.exception}: the desk does not scope this thread until he releases it`, null, 0, []);
        }

        // 1. Route. The quotes a figure may be read from now are read once for the turn: the
        // router's money exemption (5.3 replaces 2.7) stands only while the file's quote is one of
        // them, and the figure guard resolves a cited line against the same set.
        const quoteRefs = await quotesOnFile(file, this.quotingDeps()).catch((e: any) => {
            log(`quoting: the quote could not be read (${e?.message ?? e})`);
            return { live: new Set<string>() as ReadonlySet<string>, expired: new Set<string>() as ReadonlySet<string> };
        });
        let liveQuoteRefs = quoteRefs.live;
        const route: Route = await routeTurn(file, turn, client, liveQuoteRefs, quoteRefs.expired);
        calls.push(route.call);
        if (file.stage === 'first_contact') setStage(file, 'scoping', 'first customer turn routed', this.fileDeps());
        // A reading that failed (out of schema, refused, unreachable) cannot rule out a complaint or a refund: fail closed to Ben.
        if (route.error) {
            log(`router: ${route.error} (held for Ben)`);
            return this.heldAck(file, party.personId, turn, runId, calls, 'router_failed: the router could not read this turn, so a complaint or refund cannot be ruled out', null, 0, []);
        }

        // Whether Service's model read this turn: it raises no_source itself when it did.
        let serviceRead = false;
        // Whether this turn raised or noted a hold, so a question the reply puts off is held only where the turn put nothing on Ben's card (6b).
        let heldThisTurn = false;
        const holdFor = (exception: HoldException | null, reason: string, draft: string | null = null, ownCard?: string) => {
            heldThisTurn = true;
            this.holdFor(file, exception, reason, draft, ownCard);
        };

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
        // Thanks owed for media that came in well before this turn: a line after the composed reply, never the composer's own words.
        let lateAck: FixedLine | null = null;
        const withLateAck = (composed: string) => lateAck ? `${composed}\n\n${lateAck.text}` : composed;
        const sentLines = () => lateAck ? [...fixedLines, lateAck] : fixedLines;
        let composed: string | null = null;
        // What goes ahead of the composer's words, and the facts it is written from: the reissue sentence, when this run reissued the quote.
        let prefix: string | null = null;
        let prefixFactIds: string[] = [];
        const words = (text: string): string => (prefix ? `${prefix}\n\n${text}` : text);

        // A fixed-line hold, whoever raised it: one line in Ben's words, the hold, no composer. Regulated
        // work that is not gas has no line: the hold says why, and the turn sends nothing (returned).
        const fixedLineHold = async (reason: HoldException, match: string): Promise<string | null> => {
            const noLine = regulatedWithoutLine(reason, turn.body);
            if (noLine) { holdFor(reason, `${reason}: ${match}; ${noLine}`); return noLine; }
            const line = await fixedLine(FIXED_LINE_FOR[reason], this.deps.fixedLines ?? knowledgeBaseFixedLines);
            fixedLines.push(line);
            if (line.kbId) fixedLineKbIds.push(line.kbId);
            holdFor(reason, `${reason}: ${match}`);
            reply = line.text;
            return null;
        };
        // Gravest first: a fixed-line-only exception on the turn takes the thread off the composer, whatever else it raised.
        const fixedOnlyException = exceptions.find((e) => FIXED_LINE_ONLY.has(e)) ?? null;
        let fixedLineOnly = !!fixedOnlyException;
        if (fixedOnlyException) {
            const noLine = await fixedLineHold(fixedOnlyException, matchFor(route, fixedOnlyException, turn.body));
            if (noLine) return this.nothing(file, party.personId, runId, calls, noLine, 'hold');
        } else {
            // 3. Gather: every routed specialist that exists. Scoping runs until the quote is sent (Goal 4)
            // and unless the turn is service only; Service runs its deterministic tools every turn and its
            // model when routed here, or when the customer asks to change a detail on their record or asks
            // whether we cover their area, whatever the router read, so that change is recorded and held for
            // Ben and the areas-covered answer is read (the area match raises no hold and leaves Scoping to
            // the job half); Quoting gathers below once the job and the location are known.
            const scopingRan = !quotingOwnsThread(file) && !(route.subjects.length === 1 && route.subjects[0] === 'service');
            scoping = scopingRan ? await scope(file, turn, party, client, { ...this.deps.scoping, now: this.now }) : null;
            if (scoping) { calls.push(...scoping.calls); specialists.push(scoping); if (scoping.error) log(`scoping: ${scoping.error}`); }
            // An invoice or receipt question from a customer the CRM knows is Service's whatever the router read, and money the router handed it is its to answer or hold.
            const invoiceQuestion = !!turn.customerId && asksAboutInvoice(turn.body);
            const service = await serve(file, turn, party, client, { kb: this.deps.kb, ...this.deps.service, now: this.now, newId: this.deps.newId }, { routed: route.subjects.includes('service') || asksToChangeDetails(turn.body) || asksAboutOurArea(turn.body) || invoiceQuestion || !!route.moneyToService, scopingRan, invoiceMoney: !!route.moneyToService });
            calls.push(...service.calls);
            serviceRead = service.calls.length > 0;
            specialists.push(service);
            if (service.error) log(`service: ${service.error}`);
            // Scoping's and Service's holds, in the one vocabulary a fixed line answers; Quoting raises its own below.
            const holds = specialists.flatMap((s) => (s.proposal.hold && isHoldException(s.proposal.hold.reason) ? [{ reason: s.proposal.hold.reason, match: s.proposal.hold.match }] : []));
            const fixedOnly = holds.find((h) => FIXED_LINE_ONLY.has(h.reason));
            if (fixedOnly) {
                fixedLineOnly = true;
                const noLine = await fixedLineHold(fixedOnly.reason, fixedOnly.match);
                if (noLine) return this.nothing(file, party.personId, runId, calls, noLine, 'hold');
            } else {
                const quoting = await quoteGather(file, turn, party, route, client, this.quotingDeps());
                if (quoting) { calls.push(...quoting.calls); specialists.push(quoting); if (quoting.error) log(`quoting: ${quoting.error}`); }
                let staleQuote: string | null = null;
                this.releaseDraftFailedHold(file);
                // Every exception the turn raised carries its own fixed line; the hold records the gravest.
                for (const e of exceptions.filter((x) => ANSWER_THE_REST.has(x))) {
                    fixedLines.push(await fixedLine(FIXED_LINE_FOR[e], this.deps.fixedLines ?? knowledgeBaseFixedLines));
                    holdFor(e, `${e}: ${matchFor(route, e, turn.body)}`);
                }
                for (const h of holds.filter((x) => ANSWER_THE_REST.has(x.reason))) {
                    fixedLines.push(await fixedLine(FIXED_LINE_FOR[h.reason], this.deps.fixedLines ?? knowledgeBaseFixedLines));
                    holdFor(h.reason, `${h.reason}: ${h.match}`);
                }
                // Quoting's own holds. A money exception still on the route is Ben's and carried its line
                // above; money the router handed to Quoting (5.3) that its reading did not answer is held here.
                if (!exceptions.includes('money')) {
                    if (quoting?.proposal.hold?.reason === 'money') {
                        fixedLines.push(await fixedLine('money_to_ben', this.deps.fixedLines ?? knowledgeBaseFixedLines));
                        holdFor('money', `money beyond a quote line: ${quoting.proposal.hold.match}`);
                    } else if (quoting?.proposal.hold?.reason === 'stale_quote') {
                        // Decided once every other hold on the turn is known (below): an expired quote may be reissued instead.
                        staleQuote = quoting.proposal.hold.match;
                    } else if (quoting?.proposal.hold?.reason === 'draft_failed') {
                        fixedLines.push(await fixedLine('held_ack', this.deps.fixedLines ?? knowledgeBaseFixedLines));
                        holdFor(null, `${DRAFT_FAILED_HOLD} (${quoting.proposal.hold.match}): no quote exists for this job and Ben has had no notification, so the quote is his to build`, null, DRAFT_FAILED_HOLD);
                        if (scoping) { scoping.proposal.nextQuestion = null; scoping.proposal.mentionPhotos = false; scoping.proposal.ready = false; }
                    }
                }
                if (quoting?.unannounced) holdFor(null, quoting.unannounced);
                if (quoting?.proposal.hold?.acceptedInChat) {
                    holdFor(null, `acceptance in chat: the customer said yes to the quote (${quoting.proposal.hold.match}); acceptance stays on the quote page and with Ben`);
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
                    const sched = await schedule(file, turn, party, client, schedulingDeps, { dateChange: exceptions.includes('date_change'), scheduling: route.subjects.includes('scheduling') }, partyLookup);
                    calls.push(...sched.calls);
                    specialists.push(sched);
                    if (sched.error) log(`scheduling: ${sched.error}`);
                    for (const kind of sched.scheduling.fixedLines) fixedLines.push(await fixedLine(kind, this.deps.fixedLines ?? knowledgeBaseFixedLines));
                    if (sched.proposal.hold) holdFor(sched.proposal.hold.reason === 'date_change' ? 'date_change' : null, `${sched.proposal.hold.reason}: ${sched.proposal.hold.match}`);
                }
                if (staleQuote && quoting) {
                    const claim = quoting.reissue ? await this.claimReissue(file, turn, runId, quoting.reissue, exceptions) : null;
                    if (claim?.ok) {
                        ctx.reissue = claim.claimed;
                        prefix = claim.claimed.line;
                        prefixFactIds = [claim.claimed.totalFactId];
                        liveQuoteRefs = new Set([...Array.from(liveQuoteRefs), claim.claimed.slug]);
                        specialists[specialists.indexOf(quoting)] = claim.specialist;
                        // The desk's own card for this quote (an earlier turn's) is answered by the reissue.
                        if (file.hold?.reason.startsWith(STALE_HOLD) && !file.hold.notedOn) releaseHold(file, file.hold.approver, `the desk reissued quote ${claim.claimed.slug} at ${pounds(claim.claimed.issue.totalPence)} and told the customer in the reply to their next message`, this.fileDeps());
                    } else {
                        if (claim && !claim.ok && claim.claimedButLost) {
                            recordReissue(file, { slug: quoting.reissue!.slug, issue: claim.claimedButLost.issue, previousTotalPence: claim.claimedButLost.previousTotalPence, sentAt: null, notSent: claim.why }, this.quotingDeps());
                        }
                        if (route.moneyToQuoting) {
                            fixedLines.push(await fixedLine('money_to_ben', this.deps.fixedLines ?? knowledgeBaseFixedLines));
                            holdFor('money', `money on an expired quote: ${matchFor(route, 'money', turn.body)}`);
                        }
                        const blockers = quoting.reissue?.blockers.length ? quoting.reissue.blockers.join('; ') : null;
                        const why = claim && !claim.ok && !blockers ? `; not reissued automatically: ${claim.why}` : '';
                        // Restated on the desk's own card for this quote; on any other card it is a promise to keep, noted as ever.
                        const ownCard = file.hold?.reason.startsWith(STALE_HOLD) && !file.hold.notedOn ? STALE_HOLD : undefined;
                        holdFor(null, `${STALE_HOLD} (${staleQuote}): no figure may be read from it and the customer has been told Ben will come back to them on it${why}`, null, ownCard);
                        // What the customer asked Ben is noted as theirs, so the card is no longer the desk's to restate, clear or reissue over.
                        if (blockers) noteOnHold(file, { reason: `not reissued automatically: ${blockers}` });
                    }
                }
                fixedLines.push(...(await channelFixedLines(file, party, turn, this.deps.fixedLines ?? knowledgeBaseFixedLines, this.now())));
                // Ben's note of what the draft is missing, again now that Scoping has read this turn: access
                // given in it is no longer his to request (the note was refreshed only before, on the turn before's facts).
                refreshBenToRequest(file, this.fileDeps());
                // Pauses, promises and a not-ready customer get an acknowledgement and no question.
                if (scoping && exceptions.includes('callback')) scoping.proposal.offerCall = false;
                if (scoping && (route.turnKind === 'short_pause' || route.turnKind === 'promise_of_more' || route.turnKind === 'not_ready')) {
                    scoping.proposal.nextQuestion = null;
                    scoping.proposal.mentionPhotos = false;
                    if (route.turnKind === 'not_ready') scoping.proposal.offerCall = false;
                }
                // Media that came in well before this turn is thanked for as late, after the reply to what the
                // customer has just said, rather than read as though it had just arrived (fixed-lines.ts lateMediaAckLine).
                // Media a message has already followed is not thanked for at all.
                const owed = scoping?.proposal.thankForMedia ? mediaThanksOf(file, turn, this.now()) : 'on_time';
                if (scoping && owed !== 'on_time') {
                    scoping.proposal.thankForMedia = false;
                    if (owed !== 'followed') lateAck = lateMediaAckLine(owed.media, owed.at, this.now());
                }
                // 4. Compose, once; a guard failure sends it back once; the ceiling sends it back once.
                const input: ComposeInput = { file, party, turn, route, specialists, fixedLines, lateAck, now: this.now(), reserved: prefix ? prefix.length + 2 : 0 };
                const first = await compose(input, client);
                calls.push(first.record);
                composerCalls++;
                if (first.output) { composed = first.output.reply; reply = withLateAck(composed); factIds = first.output.factIds; citedKbIds = first.output.kbIds; }
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
        // The reissue sentence goes with every attempt, so the guards read exactly the words that would go.
        const guardAttempt = async (text: string, ids: string[], cited: string[]): Promise<{ guards: GuardOutcome; kbIds: string[] }> => {
            const merged = Array.from(new Set([...fixedLineKbIds, ...cited]));
            const kbRows = await this.kbRows(merged, fixedLines);
            return { guards: runGuards({ file, party, turn, reply: words(text), factIds: Array.from(new Set([...prefixFactIds, ...ids])), kbIds: merged, kbRows, fixedLines: sentLines(), lookedUp, proposedSubject, liveQuoteRefs }), kbIds: merged };
        };
        // One thing at a time (checklist 2.3) is checked with the guards, so the one retry covers it too;
        // so is a composed reply that thanks for media the late line already thanks for, and one that offers
        // a call to a party who prefers text or has already rung (1.5): the brief says not to, and nothing
        // else holds the composer to it. A call the customer asks for in this turn may be answered. A promise of
        // more or a not-ready customer gets one acknowledgement and then quiet (2.5, 6.2, answers 8 and 19), so a
        // question in that reply is checked the same way: it would ask them for something they have just put off.
        // A short pause ("one sec, let me check") gets the same acknowledgement-only brief (2.4): they are away finding something.
        const quietTurn = route.turnKind === 'promise_of_more' || route.turnKind === 'not_ready' || route.turnKind === 'short_pause';
        const quietWhy = route.turnKind === 'not_ready' ? 'said they are not ready yet' : route.turnKind === 'short_pause' ? 'asked for a moment and will be straight back' : 'promised to send more';
        const noCallOffer = exceptions.includes('callback') || asksForCall(turn.body) ? null
            : party.prefersText ? 'they prefer text' : party.alreadyRung ? 'they have already rung us' : null;
        const withOneThing = (g: GuardOutcome, text: string): GuardOutcome => {
            const n = scopingQuestionCount(text);
            const failures = [...g.failures];
            const own = fixedLines.reduce((t, f) => t.split(f.text).join(' '), text);
            if (quietTurn && scopingQuestionCount(own) > 0) failures.push(`an acknowledgement only, no question: they have ${quietWhy}, so ask them nothing and use no question mark`);
            else if (n > 1) failures.push(`one thing at a time: ${n} questions about the job in one reply; ask one, with one question mark`);
            const offer = noCallOffer ? offersCall(own) : null;
            if (offer) failures.push(`do not offer or mention a call ("${offer}"): ${noCallOffer}`);
            if (lateAck && RE_THANKS_MEDIA.test(text)) failures.push('the photo or video came in earlier and a line after your reply thanks for it: do not thank for it yourself');
            return failures.length > g.failures.length ? { ok: false, guards: g.guards, failures } : g;
        };
        const attempt = await guardAttempt(reply!, factIds, citedKbIds);
        let kbIds: string[] = attempt.kbIds;
        let guards: GuardOutcome = withOneThing(attempt.guards, composed ?? reply!);
        if (!guards.ok && !fixedLineOnly) {
            const again = await compose({ file, party, turn, route, specialists, fixedLines, lateAck, failures: guards.failures, now: this.now(), reserved: prefix ? prefix.length + 2 : 0 }, client);
            calls.push(again.record);
            composerCalls++;
            if (again.output) {
                const retry = await guardAttempt(withLateAck(again.output.reply), again.output.factIds, again.output.kbIds);
                const g2 = withOneThing(retry.guards, again.output.reply);
                if (g2.ok) { composed = again.output.reply; reply = withLateAck(composed); factIds = again.output.factIds; kbIds = retry.kbIds; guards = g2; }
                else return this.heldAck(file, party.personId, turn, runId, calls, `guards failed twice: ${g2.failures.join('; ')}`, again.output.reply, composerCalls, specialists, g2, summary);
            } else return this.heldAck(file, party.personId, turn, runId, calls, `guards failed and the composer ${again.refused ? 'declined' : 'failed'} the retry`, reply, composerCalls, specialists, guards, summary);
        }
        if (!guards.ok) {
            // A fixed line that fails a guard is a contract failure in the line itself: hold with it named, send the acknowledgement.
            return this.heldAck(file, party.personId, turn, runId, calls, `the fixed line failed the guards: ${guards.failures.join('; ')}`, reply, composerCalls, specialists, guards, summary);
        }

        // 5b. Never a repeat of the previous message (behaviour.md answer 90). A reply that wraps up again when
        // the business already wrapped up since it last asked this party anything (repeat.ts) goes back to the composer once with the sentences
        // named; what it still repeats is taken out, and a reply left with nothing sends nothing. A
        // fixed line is Ben's and is never taken out.
        // A customer who asks about the quote is answered, even when the answer is the one they had.
        const previous = fixedLineOnly || route.turnKind === 'question' ? [] : saidSinceLastQuestion(file, party.personId).map((t) => t.body);
        const repeatsOf = (text: string): string[] => repeatedSentences(text, previous).filter((r) => !fixedLines.some((f) => f.text.includes(r)));
        let repeated = repeatsOf(reply!);
        if (repeated.length) {
            const said = `said again: you have already said ${repeated.map((r) => `"${r}"`).join(' and ')}. Do not say that again in any words. If nothing new needs saying, write one short, warm acknowledgement of a few words and nothing else`;
            const again = await compose({ file, party, turn, route, specialists, fixedLines, lateAck, failures: [said], now: this.now() }, client);
            calls.push(again.record);
            composerCalls++;
            if (again.output) {
                const retry = await guardAttempt(withLateAck(again.output.reply), again.output.factIds, again.output.kbIds);
                const g = withOneThing(retry.guards, again.output.reply);
                const still = repeatsOf(again.output.reply);
                if (g.ok && !still.length) { composed = again.output.reply; reply = withLateAck(composed); factIds = again.output.factIds; kbIds = retry.kbIds; guards = g; repeated = []; }
            }
            if (repeated.length) {
                const trimmed = withoutSentences(composed ?? reply!, repeated);
                const kept = trimmed.trim() ? withOneThing((await guardAttempt(withLateAck(trimmed), factIds, kbIds)).guards, trimmed) : null;
                const note = `the reply only wrapped up again, as already said (${repeated.join(' | ')}); nothing sent`;
                if (!kept || !kept.ok) return { ...this.nothing(file, party.personId, runId, calls, kept ? `${note}; what was left failed the guards: ${kept.failures.join('; ')}` : note), factIds: [], kbIds: [], guards: guards.guards, composerCalls, summary };
                log(`repeat: dropped ${repeated.length} sentence(s) the last message already said`);
                composed = trimmed;
                reply = withLateAck(trimmed);
                guards = kept;
            }
        }

        // 6. Channel, window, render, template.
        const choice = chooseChannel(party, turn.channel, this.now());
        if (!choice.ok) return { ...this.nothing(file, party.personId, runId, calls, choice.reason, 'hold'), summary };
        let rendered = render(choice.channel, words(reply!), { name: party.name, wideBubbles: fixedLineOnly });
        let overflow = 'the reply';
        if (!rendered.ok && rendered.reason === 'ceiling' && !fixedLineOnly) {
            // Measured on the composer's own words: the reissue sentence ahead of them is not its to shorten, only the room it leaves.
            const own = render(choice.channel, reply!, { name: party.name });
            const brief = shortenBriefFor(choice.channel, reply!, own.bubbles);
            const room = prefix ? render(choice.channel, prefix, { name: party.name }).bubbles.length : 0;
            const shorten = !prefix ? brief : brief.channel === 'sms' ? { ...brief, charBudget: Math.max(0, brief.charBudget - prefix.length - 2) } : { ...brief, measured: brief.measured + room, ceiling: BUBBLE_CEILING - room };
            const shorter = await compose({ file, party, turn, route, specialists, fixedLines, lateAck, shorten, now: this.now(), reserved: prefix ? prefix.length + 2 : 0 }, client);
            calls.push(shorter.record);
            composerCalls++;
            if (shorter.output) {
                const shortReply = withLateAck(shorter.output.reply);
                const short = await guardAttempt(shortReply, shorter.output.factIds, shorter.output.kbIds);
                const shortGuards = withOneThing(short.guards, shorter.output.reply);
                let r3 = render(choice.channel, words(shortReply), { name: party.name });
                if (shortGuards.ok && !r3.ok && r3.reason === 'ceiling' && choice.channel === 'whatsapp') {
                    r3 = render(choice.channel, words(shortReply), { name: party.name, softWidth: true });
                    if (r3.ok) log(`render: the shortened reply still ran over ${BUBBLE_CEILING} bubbles at ${BUBBLE_MAX_CHARS} characters and went at ${BUBBLE_SOFT_MAX_CHARS}`);
                }
                if (shortGuards.ok && r3.ok) { composed = shorter.output.reply; reply = shortReply; factIds = shorter.output.factIds; kbIds = short.kbIds; guards = shortGuards; rendered = r3; }
                else overflow = shortGuards.ok ? 'the shortened reply' : `the shortened reply failed the guards (${shortGuards.failures.join('; ')}) and the reply`;
            } else overflow = `the composer ${shorter.refused ? 'declined' : 'failed'} the shorten and the reply`;
            // A shorten that did not give a reply to send falls back to the reply that already passed the guards, split at 200, before any hold.
            if (!rendered.ok && choice.channel === 'whatsapp') {
                const r4 = render(choice.channel, words(reply!), { name: party.name, softWidth: true });
                if (r4.ok) { rendered = r4; log(`render: the shorten gave no reply to send (${overflow}) and the reply went at ${BUBBLE_SOFT_MAX_CHARS}`); }
            }
        }
        if (!rendered.ok) return this.heldAck(file, party.personId, turn, runId, calls, rendered.reason === 'ceiling' ? (choice.channel === 'sms' ? 'the reply stayed over two SMS segments after one shorten' : `${overflow} stayed over the ceiling of ${BUBBLE_CEILING} bubbles after one shorten, even at ${BUBBLE_SOFT_MAX_CHARS} characters`) : 'the reply rendered to nothing', reply, composerCalls, specialists, guards, summary);
        const window = windowOf(party, choice.channel, this.now());
        let template: TemplateSend | null = null;
        let templateWording: string | null = null;
        if (window.state === 'shut' && ctx.reissue) {
            // Checked before the reissue was claimed; a window that has shut since carries no template with this sentence.
            const why = `the ${choice.channel} window is shut, so the reissued price cannot be sent`;
            this.holdFor(file, null, why, words(reply!), DESK_RUN_NOTE);
            return { ...this.nothing(file, party.personId, runId, calls, why, 'hold'), factIds, kbIds, guards: guards.guards, composerCalls, windowState: 'shut', channel: choice.channel, summary };
        }
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

        // 6b. A question the customer asked and the composed reply puts off reaches Ben. Service holds on no_source
        // itself when its model read the turn; when it did not (the router sent the turn elsewhere), the reply's
        // "I'll check and come back to you on that" is the only record of the question, so it holds here, unless
        // this turn raised or noted a hold (a money or date line says the same words about its own hold). Read
        // from the words going out, not a model: the composer is told to say it will come back on anything it
        // has no fact for, and those words are the promise Ben has to keep. A template send carries none of them.
        const deferred = !template && !serviceRead && !heldThisTurn && composed !== null ? deferralMatch(composed, turn.body) : null;
        if (deferred) holdFor('no_source', `no_source: the reply said "${deferred}" and Service did not read the turn: ${turn.body.slice(0, 80)}`);

        // 7. The one sender.
        if (!template) factIds = Array.from(new Set([...prefixFactIds, ...factIds]));
        const sent = await send({ file, partyId: party.personId, channel: choice.channel, window, bubbles: rendered.bubbles, template, runId, approver: DESK_APPROVER, guards, factIds, kbIds: Array.from(new Set(kbIds)), fixedLines: sentLines(), calls, mode: this.deps.mode ?? 'dry_run', answers: messagesOf(turn) }, { ...this.deps.sender, now: this.now, newId: this.deps.newId });
        if (!sent.ok) return this.heldAck(file, party.personId, turn, runId, calls, `send refused: ${sent.reason}`, words(reply!), composerCalls, specialists, undefined, summary);

        // 8. The ledger and the stage, from what the business itself said.
        this.afterSend(file, party.personId, templateWording ?? words(reply!), templateWording ? null : scopingProposal(specialists), templateWording ? [] : sentLines());
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

    /** Contract 4's second failure and the composer's fallback route: hold with the draft, and the customer still hears the fixed acknowledgement, naming any photo or video the turn brought. */
    private async heldAck(file: CaseFile, partyId: string, turn: Turn, runId: string, calls: ModelCallRecord[], why: string, draft: string | null, composerCalls: number, specialists: SpecialistReturn[], failed?: GuardOutcome, summary: string | null = null): Promise<DeskResult> {
        const party = partyOf(file, partyId)!;
        // A regulated turn that is not positively gas: the gas line would be untrue, and no other line is approved for it, so nothing goes.
        const regulatedTurn = !!regulatedMatch(turn.body);
        const noLine = regulatedTurn ? regulatedWithoutLine('regulated', turn.body) : null;
        const held = { reason: noLine ? `${why}; ${noLine}` : why, draft, failures: failed?.failures ?? [] };
        if (file.hold) noteOnHold(file, { ...held, ownCard: DESK_RUN_NOTE });
        else setHold(file, { approver: approverFor(file, null), ...held }, this.fileDeps());
        if (noLine) return { ...this.nothing(file, partyId, runId, calls, held.reason, 'hold'), summary, composerCalls };
        const line = regulatedTurn ? await fixedLine('gas', this.deps.fixedLines ?? knowledgeBaseFixedLines) : heldAckLine(turn, file);
        const kbIds = line.kbId ? [line.kbId] : [];
        const guards = runGuards({ file, party, turn, reply: line.text, factIds: [], kbIds, kbRows: await this.kbRows(kbIds, [line]), fixedLines: [line], proposedSubject: null, liveQuoteRefs: new Set() });
        const choice = chooseChannel(party, turn.channel, this.now());
        const window = choice.ok ? windowOf(party, choice.channel, this.now()) : null;
        const rendered = choice.ok ? render(choice.channel, line.text, { name: party.name, wideBubbles: true }) : null;
        const base = { ...this.nothing(file, partyId, runId, calls, why, 'hold'), summary };
        if (!choice.ok || !window || !rendered?.ok || !guards.ok || window.state === 'shut') return { ...base, guards: guards.guards, composerCalls, note: `${why}; acknowledgement not sent: ${!choice.ok ? choice.reason : !rendered?.ok ? `no render for ${choice.channel}` : !guards.ok ? guards.failures.join('; ') : 'window shut'}` };
        const bubbles: RenderedBubble[] = rendered.bubbles;
        const sent = await send({ file, partyId, channel: choice.channel, window, bubbles, template: null, runId, approver: DESK_APPROVER, guards, factIds: [], kbIds, fixedLines: [line], calls, mode: this.deps.mode ?? 'dry_run', answers: messagesOf(turn) }, { ...this.deps.sender, now: this.now, newId: this.deps.newId });
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
     * The proposal is the composed reply's own: the held acknowledgement passes none. A fixed line
     * that thanks for a photo or video (the held acknowledgement naming what the turn brought, the
     * late thanks after a reply) spends the thanks itself; one that names none leaves it owed, so a
     * later reply may still carry it.
     */
    private afterSend(file: CaseFile, partyId: string, said: string, proposal: Proposal | null, lines: FixedLine[]): void {
        const deps = this.fileDeps();
        const party = partyOf(file, partyId)!;
        for (const subject of ['media', 'postcode', 'access'] as const) if (textAsks(said, subject)) ledgerAsk(file, subject, deps);
        if (proposal?.nextQuestion && asksProposed(said, proposal.nextQuestion.subject)) ledgerAsk(file, proposal.nextQuestion.subject, deps);
        if (proposal?.mentionPhotos && /\b(?:photo|photos|picture|pictures|pic|pics|video|snap|image)s?\b/i.test(said)) ledgerAsk(file, 'media', deps);
        // The thanks is spent only where the words that went carried one: a thanks the ledger
        // records but the reply never made leaves the photo unacknowledged for good, which is the
        // worse end of 1.7 than thanking for it twice. Any wording of gratitude counts, not one
        // that names the photo, so "Thanks for sending that over" is read as the thanks it is.
        if ((proposal?.thankForMedia && /\b(?:thanks?|thank you|cheers|ta)\b/i.test(said)) || lines.some((l) => RE_THANKS_MEDIA.test(l.text))) { ledgerAnswered(file, 'media', deps); ledgerThanked(file, 'media', deps); }
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

/**
 * How a thanks owed now stands against the newest photo or video from this party. `on_time` when the
 * turn itself brought media (that thanks covers the rest) or the media came in within LATE_MEDIA_MS,
 * so a customer who says a video is coming and sends it still gets one reply covering both.
 * `followed` when any message, a person's from the board included, has already gone to the party
 * since it came in: a thanks now would read as fresh for something already replied after. Otherwise
 * the media and when it came, for a thanks that says it is late.
 */
function mediaThanksOf(file: CaseFile, turn: Turn, now: Date): 'on_time' | 'followed' | { media: TurnMedia[]; at: Date } {
    if (turn.media.length) return 'on_time';
    const i = file.turns.findLastIndex((t) => t.direction === 'inbound' && t.partyId === turn.partyId && t.media.length > 0);
    const last = file.turns[i];
    if (!last || isTurnOf(last, turn)) return 'on_time';
    if (file.turns.slice(i + 1).some((t) => t.direction === 'outbound' && t.partyId === turn.partyId)) return 'followed';
    const at = new Date(last.at);
    return now.getTime() - at.getTime() > LATE_MEDIA_MS ? { media: last.media, at } : 'on_time';
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
