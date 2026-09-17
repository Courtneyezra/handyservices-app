/**
 * Contract 4 - Guards and the approver slot. Deterministic code, no model. Every composed reply
 * passes here before the sender. Only a composed reply: words a person typed on Ben's board go
 * straight to the sender under their own human approver (behaviour.md answer 43, human-reply.ts),
 * because these guards exist to stop the composer inventing what Ben himself is the source of.
 * A message the desk wrote is a composed reply whoever licensed it, so Ben's priced quote is
 * composed here and checked here like any other (quoting/quoting-door.ts).
 *
 * Eight guards, each checked against the file: figure, date/time/duration, commitment and fault,
 * business claim, disclosure, one reply, ask ledger, regulated. The business-claim guard carries
 * two rules: the verbatim rail, which every cited knowledge-base row passes through whatever it is
 * about, and the claim lexicon under it. Pass goes to the sender with the
 * fact ids attached; a first failure goes back to the composer once with the failures named; a
 * second failure holds for the approver with the draft and the failures, and the customer still
 * gets the fixed acknowledgement (the desk does that, desk.ts).
 *
 * The approver slot is one function so the landlord service can attach without touching the
 * guards: Ben for a homeowner; for a tenant issue, later, the landlord's rules, then the landlord,
 * then Ben. A rule-based approver is a legal value from day one and has no rules yet.
 */
import { askedUnanswered, customerTurnUnanswered, everAsked, isReadThisRunOnly, isSupersededFigure, ledgerEntry, release as releaseHold, sameApprover, type ApproverSlot, type CaseFile, type Fact, type Outcome, type Party, type Turn } from './case-file';
import type { GuardName, GuardVerdict } from './desk-types';
import type { FixedLine } from './fixed-lines';
import { withoutDashPunctuation } from './dashes';
import { RE_BEN_COMES_BACK, RE_BUSINESS_CLAIM, RE_COMMITMENT_OR_FAULT, RE_DATE_TIME_DURATION, RE_DISCLOSURE, RE_FIGURE, RE_THANKS_MEDIA, ordinalDays, regulatedMatch, sentencesOf, textAsks } from './lexicon';
import { dateChangeMatch } from '../scheduling/scheduling-tools';

export const GUARD_NAMES: readonly GuardName[] = ['figure', 'date_time_duration', 'commitment_fault', 'business_claim', 'disclosure', 'one_reply', 'ask_ledger', 'regulated'];

export interface KbRow { id: string; approvedWords: string; reviewed: boolean }

export interface GuardInput {
    file: CaseFile;
    party: Party;
    turn: Turn;
    reply: string;
    factIds: string[];
    kbIds: string[];
    /** Reviewed knowledge-base rows the composer cited, resolved by id (unknown ids are absent). */
    kbRows: KbRow[];
    fixedLines: FixedLine[];
    /** The ids of the facts the specialists looked up on this run. A date is only ever one of these: a fact from an earlier turn was true when it was written, and the diary may have moved since. Absent means none, so nothing dated passes. */
    lookedUp?: string[];
    /** The subject the specialist proposed asking this turn; the ledger records it after the send. */
    proposedSubject: string | null;
    /**
     * What licensed this send. `customer_turn`, the default, is the desk answering a turn, and the
     * one-reply guard holds it to one reply per turn. `human_action` is a person acting on the
     * thread - Ben pressing send on the price screen - which is a fresh licence to speak, not the
     * desk speaking twice off one message. The words are still composed, so the other seven run
     * over them unchanged.
     */
    prompted?: 'customer_turn' | 'human_action';
    /**
     * The quotes a figure may be read from right now (quoting/quoting-tools.ts liveFigureQuotes).
     * A cited quote line whose quote is not in here is refused: facts are append-only, so a revoked,
     * superseded or expired quote's figures stay on the file and must not be repeated.
     */
    liveQuoteRefs: ReadonlySet<string>;
}

export interface GuardOutcome {
    ok: boolean;
    guards: Record<GuardName, GuardVerdict>;
    /** The failures, named, for the composer's second attempt and for the hold. */
    failures: string[];
}

const pass = (): GuardVerdict => ({ result: 'pass', note: null });
const fail = (note: string): GuardVerdict => ({ result: 'fail', note });

function normaliseFigure(s: string): string {
    return s.replace(/[£,\s]/g, '').replace(/(?:pounds?|quid|gbp)$/i, '').replace(/p$/i, '');
}

function citedFacts(input: GuardInput): Fact[] {
    const ids = new Set(input.factIds);
    return input.file.facts.filter((f) => ids.has(f.id));
}

export function checkFigure(input: GuardInput): GuardVerdict {
    const matches = Array.from(input.reply.matchAll(new RegExp(RE_FIGURE.source, 'gi'))).map((m) => m[0]);
    if (!matches.length) return pass();
    // A quote figure counts only while its quote is live and it is that line's current amount: the
    // price before a reissue is still on the file, and must not be repeated.
    // A figure read from the customer's CRM record (an invoice) counts only as this run read it.
    const looked = new Set(input.lookedUp ?? []);
    const live = citedFacts(input).filter((f) => (f.source.kind === 'quote_line' ? input.liveQuoteRefs.has(f.source.quoteRef) && !isSupersededFigure(input.file, f) : f.source.kind === 'customer_record' && (!isReadThisRunOnly(f) || looked.has(f.id))));
    const allowed = new Set(live.map((f) => normaliseFigure(f.value)));
    const bad = matches.filter((m) => !allowed.has(normaliseFigure(m)));
    return bad.length ? fail(`a figure appears that is not a line of the live quote or a customer record: ${bad.join(', ')}`) : pass();
}

/**
 * Whole words only: "the 5 September" must not ride in on a cited "25 September 2026", so the
 * match has to sit in the diary value with a non-word character, or nothing, on either side.
 */
function saysWhole(value: string, match: string): boolean {
    for (let i = value.indexOf(match); i !== -1; i = value.indexOf(match, i + 1)) {
        const before = value[i - 1];
        const after = value[i + match.length];
        if (!/\w/.test(before ?? '') && !/\w/.test(after ?? '')) return true;
    }
    return false;
}

function allOf(re: RegExp, text: string): string[] {
    return Array.from(text.matchAll(new RegExp(re.source, 'gi'))).map((m) => m[0]);
}

export function checkDate(input: GuardInput): GuardVerdict {
    const looked = new Set(input.lookedUp ?? []);
    // The diary, or the customer's CRM record (an invoice's dates, a visit day), as this run read it.
    // A person's cited instruction on the Handy Desk counts the same way (answer A2): it is this run's.
    const diary = citedFacts(input).filter((f) => isReadThisRunOnly(f) && looked.has(f.id)).map((f) => f.value.toLowerCase());
    // A bare ordinal is read as a day on its own words (lexicon.ts ordinalDays), not on whether the
    // reply gives a date elsewhere: "the 1st floor" beside a looked-up date is a floor, and "the 2nd"
    // with no date looked up is still a day the diary did not give. A day has to be a looked-up value.
    const matches = [...allOf(RE_DATE_TIME_DURATION, input.reply), ...ordinalDays(input.reply)];
    if (!matches.length) return pass();
    const bad = matches.filter((m) => !diary.some((v) => saysWhole(v, m.toLowerCase())));
    return bad.length ? fail(`a date, time or duration appears that this turn did not look up in the diary or the customer's record, and no instruction of Ben's gives: ${bad.map((b) => `"${b}"`).join(', ')}`) : pass();
}

/**
 * The instruction facts this run cited (case-file.ts `FactSource` kind `instruction`, answer A2):
 * a person's own words on the Handy Desk, which license the one message they were given for.
 */
function citedInstructions(input: GuardInput): Fact[] {
    const looked = new Set(input.lookedUp ?? []);
    return citedFacts(input).filter((f) => f.source.kind === 'instruction' && looked.has(f.id));
}

/** Contractions spelled out and spacing collapsed, so "we'll call" and "we will call" read the same. */
function instructionKey(s: string): string {
    return s.toLowerCase().replace(/[\u2018\u2019\u02bc`]/g, "'")
        .replace(/\b(i|we|you|he|she|they|ben)'ll\b/g, '$1 will')
        .replace(/\b(i|we|you|they)'ve\b/g, '$1 have')
        .replace(/\s+/g, ' ').trim();
}

/** Whether a cited instruction says this claim, whole words, as the person gave it. */
function instructedClaim(input: GuardInput, claim: string): boolean {
    const want = instructionKey(claim);
    return citedInstructions(input).some((f) => saysWhole(instructionKey(f.value), want));
}

/**
 * The dates, times and commitments in a reply that pass only because a cited instruction says them,
 * for the preview to name ("'this afternoon' is from your instruction"). Empty when none does.
 */
export function instructedClaims(input: GuardInput): string[] {
    if (!citedInstructions(input).length) return [];
    const claims = [...allOf(RE_DATE_TIME_DURATION, input.reply), ...ordinalDays(input.reply), ...allOf(RE_COMMITMENT_OR_FAULT, input.reply)];
    const out: string[] = [];
    for (const c of claims) if (instructedClaim(input, c) && !out.includes(c)) out.push(c);
    return out;
}

export function checkCommitment(input: GuardInput): GuardVerdict {
    // A commitment passes only when a person's cited instruction gives it word for word; an admission
    // of fault is a commitment like any other here, so it too must be his words.
    const m = allOf(RE_COMMITMENT_OR_FAULT, input.reply).find((c) => !instructedClaim(input, c));
    if (m) return fail(`a commitment or an admission of fault appears: "${m}"`);
    // A request to move a date that nothing holds for Ben is not his to come back on: the gate only holds
    // a change to a booked job (checklist 5.5), so a promise that he will is one nobody keeps. The desk
    // raises every hold before the guards run, so the file's hold is this turn's, or a standing one.
    const promise = !input.file.hold && dateChangeMatch(input.turn.body) ? RE_BEN_COMES_BACK.exec(input.reply) : null;
    return promise ? fail(`a promise that Ben will come back on a date change, with no hold reaching Ben: "${promise[0]}"`) : pass();
}

/**
 * Whitespace, the quote marks a composer substitutes and a dash used as punctuation (which the
 * desk always sends as a comma, dashes.ts) normalised, so a row's words match however they were
 * typed. The words themselves are still the row's: nothing else is relaxed.
 */
function verbatimKey(s: string): string {
    return withoutDashPunctuation(s).toLowerCase().replace(/[\u2018\u2019\u02bc`]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
}

/**
 * The verbatim rail. Every knowledge-base row the reply cites, by id or through a fact, must be a
 * reviewed row whose body the reply actually carries, word for word.
 *
 * This is the rail that replaced the old desk's prohibition on any reply path importing the
 * knowledge base, and it holds on its own: no word list decides whether it runs. Without it the
 * desk could tell a customer something the cited row says nothing of, pass every guard because the
 * business-claim lexicon does not reach payment terms, invoicing or aftercare, and record the row
 * id and its body on the send as though those words went out. A record that is not true is worse
 * than a refusal (checklist cross-cutting 4).
 */
function checkVerbatim(input: GuardInput): GuardVerdict {
    const reply = verbatimKey(input.reply);
    const cited = new Map<string, string>();
    for (const id of input.kbIds) {
        const row = input.kbRows.find((r) => r.id === id);
        if (!row || !row.reviewed) return fail(`the reply cites knowledge-base id ${id}, which is not a reviewed row`);
        cited.set(id, row.approvedWords);
    }
    // A fact whose source is the knowledge base carries the row's body as its value: the send records
    // it as the words that went, so the reply must carry them whether or not the id was also cited.
    for (const f of citedFacts(input)) if (f.source.kind === 'knowledge_base') cited.set(f.source.entryId, f.value);
    for (const [id, body] of Array.from(cited)) {
        if (!body.trim()) return fail(`the reply cites knowledge-base id ${id}, which has no reviewed words`);
        if (!reply.includes(verbatimKey(body))) return fail(`the reply cites knowledge-base id ${id} without carrying its words verbatim; send them as they are: "${body}"`);
    }
    return pass();
}

export function checkBusinessClaim(input: GuardInput): GuardVerdict {
    const verbatim = checkVerbatim(input);
    if (verbatim.result === 'fail') return verbatim;
    const fixed = input.fixedLines.map((f) => f.text.toLowerCase());
    for (const s of sentencesOf(input.reply)) {
        const m = RE_BUSINESS_CLAIM.exec(s);
        if (!m) continue;
        if (fixed.some((f) => f.includes(s.toLowerCase()) || s.toLowerCase().includes(f))) continue;
        const supported = input.kbRows.some((row) => {
            // The row's words as the desk sends them: any dash in them went out as a comma.
            const words = withoutDashPunctuation(row.approvedWords).toLowerCase();
            return row.reviewed && input.kbIds.includes(row.id) && (words.includes(s.toLowerCase()) || s.toLowerCase().includes(words));
        });
        if (!supported) return fail(`a claim about the business with no reviewed knowledge-base citation supporting it: "${s}"`);
    }
    return pass();
}

export function checkDisclosure(input: GuardInput): GuardVerdict {
    const m = RE_DISCLOSURE.exec(input.reply);
    return m ? fail(`a line describes the sender as automated or an assistant: "${m[0]}"`) : pass();
}

export function checkOneReply(input: GuardInput): GuardVerdict {
    if (input.prompted === 'human_action') return { result: 'pass', note: 'a person acted on the thread, which licenses this send; the guard counts the desk\'s own replies to one customer turn' };
    return customerTurnUnanswered(input.file, input.party.personId) ? pass() : fail('a second reply to the same party with no customer turn in between');
}

export function checkAskLedger(input: GuardInput): GuardVerdict {
    const subjects = ['media', 'postcode', 'access', 'job'];
    for (const subject of subjects) {
        if (!textAsks(input.reply, subject)) continue;
        if (subject === 'media' && everAsked(input.file, 'media')) return fail('the reply asks for a photo again; photos are asked for once');
        if (askedUnanswered(input.file, subject) && subject !== input.proposedSubject) return fail(`the reply asks about ${subject}, already asked and unanswered`);
    }
    if (RE_THANKS_MEDIA.test(input.reply) && ledgerEntry(input.file, 'media')?.thankedAt) return fail('the reply thanks for a photo already thanked for');
    return pass();
}

export function checkRegulated(input: GuardInput): GuardVerdict {
    // Which words this reads turns on what licensed the send. Answering a customer turn, it is that
    // turn: what they raised is what the fixed line is owed about. Licensed by a person instead, the
    // send answers no turn at all - Ben's quote delivery says nothing about their last message - so
    // it is read against its own words, and a delivery that raises regulated work itself still owes
    // the line. The hold that turn put on the thread is a person's and stands either way.
    const subject = input.prompted === 'human_action' ? input.reply : input.turn.body;
    const match = regulatedMatch(subject);
    if (!match) return pass();
    const line = input.fixedLines.find((f) => f.kind === 'gas');
    if (line && input.reply.toLowerCase().includes(line.text.toLowerCase().slice(0, 40))) return pass();
    return fail(`the ${input.prompted === 'human_action' ? 'reply' : 'turn'} mentions regulated work ("${match}") and the reply does not carry the fixed line`);
}

/**
 * The eight with nothing to say, for a result that carries no composed reply at all: a clock pass,
 * or a quote held before the composer ran. The record is always all eight, so a reader never has to
 * work out whether a missing guard means it failed.
 */
export function noReplyToCheck(): Record<GuardName, GuardVerdict> {
    const v = (): GuardVerdict => ({ result: 'pass', note: 'no reply was composed, so there was nothing to check' });
    return { figure: v(), date_time_duration: v(), commitment_fault: v(), business_claim: v(), disclosure: v(), one_reply: v(), ask_ledger: v(), regulated: v() };
}

/** Every guard, always all eight, so the planned send records each result. */
export function runGuards(input: GuardInput): GuardOutcome {
    const guards: Record<GuardName, GuardVerdict> = {
        figure: checkFigure(input),
        date_time_duration: checkDate(input),
        commitment_fault: checkCommitment(input),
        business_claim: checkBusinessClaim(input),
        disclosure: checkDisclosure(input),
        one_reply: checkOneReply(input),
        ask_ledger: checkAskLedger(input),
        regulated: checkRegulated(input),
    };
    const failures = GUARD_NAMES.filter((g) => guards[g].result === 'fail').map((g) => `${g}: ${guards[g].note}`);
    return { ok: failures.length === 0, guards, failures };
}

// ---------------------------------------------------------------- the approver slot

export const BEN: ApproverSlot = { kind: 'human', id: 'ben' };

/** Who may release a held job. Ben for a homeowner; for a tenant issue the landlord's rules, then the landlord, then Ben (no rules yet). */
export function approverFor(file: CaseFile, _exception: string | null): ApproverSlot {
    const tenant = file.parties.find((p) => p.role === 'tenant');
    const landlord = file.parties.find((p) => p.role === 'landlord');
    if (tenant && landlord) return { kind: 'rules', id: landlord.personId, then: { kind: 'human', id: landlord.personId } };
    return BEN;
}

/** Clears the hold only from the named approver and only with words recorded. */
export function release(file: CaseFile, approver: ApproverSlot, words: string): Outcome<unknown> {
    if (file.hold && !sameApprover(file.hold.approver, approver)) return { ok: false, reason: 'only the named approver may release' };
    return releaseHold(file, approver, words);
}
