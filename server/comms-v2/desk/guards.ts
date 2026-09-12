/**
 * Contract 4 - Guards and the approver slot. Deterministic code, no model. Every composed reply
 * passes here before the sender. Only a composed reply: words a person typed on Ben's board go
 * straight to the sender under their own human approver (behaviour.md answer 43, human-reply.ts),
 * because these guards exist to stop the composer inventing what Ben himself is the source of.
 *
 * Eight guards, each checked against the file: figure, date/time/duration, commitment and fault,
 * business claim, disclosure, one reply, ask ledger, regulated. Pass goes to the sender with the
 * fact ids attached; a first failure goes back to the composer once with the failures named; a
 * second failure holds for the approver with the draft and the failures, and the customer still
 * gets the fixed acknowledgement (the desk does that, desk.ts).
 *
 * The approver slot is one function so the landlord service can attach without touching the
 * guards: Ben for a homeowner; for a tenant issue, later, the landlord's rules, then the landlord,
 * then Ben. A rule-based approver is a legal value from day one and has no rules yet.
 */
import { askedUnanswered, customerWroteSinceLastReply, everAsked, ledgerEntry, release as releaseHold, sameApprover, type ApproverSlot, type CaseFile, type Fact, type Outcome, type Party, type Turn } from './case-file';
import type { GuardName, GuardVerdict } from './desk-types';
import type { FixedLine } from './fixed-lines';
import { RE_BUSINESS_CLAIM, RE_COMMITMENT_OR_FAULT, RE_DATE_TIME_DURATION, RE_DISCLOSURE, RE_FIGURE, RE_THANKS_MEDIA, regulatedMatch, sentencesOf, textAsks } from './lexicon';

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
    /** The subject the specialist proposed asking this turn; the ledger records it after the send. */
    proposedSubject: string | null;
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
    const allowed = new Set(citedFacts(input).filter((f) => f.source.kind === 'quote_line' || f.source.kind === 'customer_record').map((f) => normaliseFigure(f.value)));
    const bad = matches.filter((m) => !allowed.has(normaliseFigure(m)));
    return bad.length ? fail(`a figure appears that is not a cited quote line or customer record: ${bad.join(', ')}`) : pass();
}

export function checkDate(input: GuardInput): GuardVerdict {
    const matches = Array.from(input.reply.matchAll(new RegExp(RE_DATE_TIME_DURATION.source, 'gi'))).map((m) => m[0]);
    if (!matches.length) return pass();
    const diary = citedFacts(input).filter((f) => f.source.kind === 'diary').map((f) => f.value.toLowerCase());
    const bad = matches.filter((m) => !diary.some((v) => v.includes(m.toLowerCase())));
    return bad.length ? fail(`a date, time or duration appears that is not a diary fact: ${bad.map((b) => `"${b}"`).join(', ')}`) : pass();
}

export function checkCommitment(input: GuardInput): GuardVerdict {
    const m = RE_COMMITMENT_OR_FAULT.exec(input.reply);
    return m ? fail(`a commitment or an admission of fault appears: "${m[0]}"`) : pass();
}

export function checkBusinessClaim(input: GuardInput): GuardVerdict {
    const fixed = input.fixedLines.map((f) => f.text.toLowerCase());
    for (const s of sentencesOf(input.reply)) {
        const m = RE_BUSINESS_CLAIM.exec(s);
        if (!m) continue;
        if (fixed.some((f) => f.includes(s.toLowerCase()) || s.toLowerCase().includes(f))) continue;
        const supported = input.kbRows.some((row) => row.reviewed && input.kbIds.includes(row.id) && (row.approvedWords.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(row.approvedWords.toLowerCase())));
        if (!supported) return fail(`a claim about the business with no reviewed knowledge-base citation supporting it: "${s}"`);
    }
    return pass();
}

export function checkDisclosure(input: GuardInput): GuardVerdict {
    const m = RE_DISCLOSURE.exec(input.reply);
    return m ? fail(`a line describes the sender as automated or an assistant: "${m[0]}"`) : pass();
}

export function checkOneReply(input: GuardInput): GuardVerdict {
    return customerWroteSinceLastReply(input.file, input.party.personId) ? pass() : fail('a second reply to the same party with no customer turn in between');
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
    const match = regulatedMatch(input.turn.body);
    if (!match) return pass();
    const line = input.fixedLines.find((f) => f.kind === 'gas');
    if (line && input.reply.toLowerCase().includes(line.text.toLowerCase().slice(0, 40))) return pass();
    return fail(`the turn mentions regulated work ("${match}") and the reply does not carry the fixed line`);
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
