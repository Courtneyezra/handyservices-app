/**
 * The ask ledger (T28, 8 Sep 2026): what we have already ASKED this thread for, and what we have
 * already SAID to it. Pure: no model, no database, no clock.
 *
 * The captain's cross-cutting rule 7, verbatim: "We never ask twice for the same thing, and never
 * thank twice for the same photo." T20 shipped that for photos and videos
 * (server/spine/media-ask.ts). This generalises it across turns and across every kind of ask, and
 * leaves the slot for the hand-off line ("Ben will come back to you on the price") that item 1.4
 * introduces, which would otherwise repeat on every turn of a held thread.
 *
 * Four subjects, each read off the thread's own outbound history and nothing else, so a replay of
 * a persisted case file gives the same answer as the run that built it:
 *
 *   media      the T20 rule, unchanged, still owned by media-ask.ts
 *   postcode   the postcode / address ask (the rules layer's ask_postcode, the Scoper's ask_gap,
 *              Ben by hand) — answered when a UK postcode arrives
 *   access     "will someone be in", "how do we get in", "is there parking", the keys — nothing on
 *              the thread can prove such an ask was answered, so it is never answered by machine:
 *              they replied, we do not insist. That is the captain's rule, not a limitation.
 *   handoff    "Ben will come back to you on the price" — not an ask but a statement, so its
 *              invalidation is not an answer: it is said ONCE PER OPEN FLAG (s28 finding E).
 *
 * The shape of every subject is the media belt's, exactly:
 *
 *   asked         the newest outbound on the thread that asks for it, whoever sent it
 *   repliedSince  the customer has written after it
 *   answeredSince the thing itself arrived after it (media; a postcode). Never for `access`.
 *   outstanding   asked AND repliedSince AND NOT answeredSince — they answered without giving it.
 *                 Nobody asks again; the thread proceeds and the fact travels to Ben.
 *
 * An answer that is later invalidated re-opens the ask exactly as T20 has it: a photo that arrived
 * is an answer, so asking for the ONE specific missing shot is allowed again.
 *
 * Three readers share it: the Scoper's tool boundary and rendered case file
 * (server/spine/agents/scoper.ts), the send-precondition belt (server/spine/send-preconditions.ts),
 * and the case file itself, which stores the ledger it derived (server/spine/case-file.ts).
 */
import { UK_POSTCODE_RE } from './asks';
import {
    acknowledgesMedia, asksForMedia, mediaAckState, mediaAskLine, mediaAskState,
    turnsFromCaseFile, type MediaAckState, type MediaAskState, type MediaAskTurn,
} from './media-ask';
import type { CaseFile, TimelineItem } from './types';

/** The kinds of thing the desk asks for, plus the hand-off line's own class. Closed. */
export type AskSubject = 'media' | 'postcode' | 'access' | 'handoff';

export const ASK_SUBJECTS: readonly AskSubject[] = ['media', 'postcode', 'access', 'handoff'];

/**
 * C (T28): the named slot for the hand-off line. Item 1.4 introduces the line itself ("Ben will
 * come back to you on the price"); it has nothing to build here, only this subject to use.
 */
export const HANDOFF_SUBJECT: AskSubject = 'handoff';

export interface AskSubjectState {
    subject: AskSubject;
    asked: boolean;
    askedAt: string | null;
    askedBody: string | null;
    repliedSince: boolean;
    /** The thing itself arrived after the ask (media, a postcode). Never true for `access`. */
    answeredSince: boolean;
    /** We asked, they replied, it never came: do not ask again. */
    outstanding: boolean;
}

export interface AskLedger {
    subjects: Record<AskSubject, AskSubjectState>;
    /** Thank once: the newest media BATCH and whether we have already acknowledged it. */
    mediaAck: MediaAckState;
}

// ---------------------------------------------------------------- the detectors

/** "no need for the postcode", "we already have your address": not an ask. */
const NEGATED_ASK = /\b(?:no need|don'?t need|do not need|needn'?t|not necessary|already (?:have|got)|we have)\b/i;

const LOCATION_NOUN = '(?:postcode|post code|postal code|address)';
const ASK_MARK = "(?:(?:could|can|may|would|shall|will)\\s+(?:you|we|i)|do you mind|mind|what(?:'|’)?s|what is|whats|which|send|share|drop|pop|confirm|let me know|need|take)";
/** "could you send us your postcode", "what's the address" — an asking phrase reaching a location noun. */
const RE_POSTCODE_ASK = new RegExp(`\\b${ASK_MARK}\\b[^.?!\\n]{0,50}\\b${LOCATION_NOUN}\\b`, 'i');
/** "postcode for the quote?" — a question with a location noun in it. */
const RE_POSTCODE_QUESTION = new RegExp(`\\b${LOCATION_NOUN}\\b[^.?!\\n]{0,60}\\?`, 'i');
/** "whereabouts are you", "where is the property" — the same ask without the noun. */
const RE_WHEREABOUTS = /\bwhere\s*(?:abouts)?\s+(?:are|is)\s+(?:you|the (?:property|house|flat|job|place))\b/i;

/** Pure: does this outbound body ask the customer where the job is? */
export function asksForPostcode(text: string | null | undefined): boolean {
    const t = clean(text);
    if (!t) return false;
    if (NEGATED_ASK.test(t)) return false;
    return RE_POSTCODE_ASK.test(t) || RE_POSTCODE_QUESTION.test(t) || RE_WHEREABOUTS.test(t);
}

/** "will someone be in", "will you be there on the day". */
const RE_ACCESS_SOMEONE_IN = /\b(?:will|would|is|are)\s+(?:someone|somebody|anyone|you|the tenant)\b[^.?!\n]{0,30}\b(?:be (?:in|there|home|around)|there|in)\b/i;
/** "how do we get in", "who lets us in". */
const RE_ACCESS_GET_IN = /\b(?:how|who)\b[^.?!\n]{0,30}\b(?:do we get in|will we get in|gets? us in|lets? us in|let us in)\b/i;
/** "is there access to the loft?", "access round the back?" */
const RE_ACCESS_QUESTION = /\baccess\b[^.?!\n]{0,60}\?/i;
const RE_ACCESS_THERE_IS = /\b(?:is there|do you have|have you got|will there be)\b[^.?!\n]{0,30}\b(?:access|parking|somewhere to park)\b/i;
/** "where can we park?" */
const RE_ACCESS_PARKING = /\b(?:where can we park|somewhere to park|parking)\b[^.?!\n]{0,40}\?/i;
/** "is there a key safe?", "how do we get the keys?" */
const RE_ACCESS_KEYS = /\b(?:key safe|keys?|gate code|door code|entry code|key box)\b[^.?!\n]{0,40}\?/i;

/** Pure: does this outbound body ask the customer how we get to or into the job? */
export function asksForAccess(text: string | null | undefined): boolean {
    const t = clean(text);
    if (!t) return false;
    if (NEGATED_ASK.test(t)) return false;
    return RE_ACCESS_SOMEONE_IN.test(t) || RE_ACCESS_GET_IN.test(t) || RE_ACCESS_QUESTION.test(t)
        || RE_ACCESS_THERE_IS.test(t) || RE_ACCESS_PARKING.test(t) || RE_ACCESS_KEYS.test(t);
}

/** "I'll come straight back to you", "let me check and come back to you on that". */
const RE_HANDOFF_BACK = /\b(?:will|’ll|'ll|shall|going to|let me|need to)\b[^.?!\n]{0,60}\b(?:com(?:e|ing)|get(?:ting)?|be)\s+(?:straight\s+|right\s+)?back\s+to\s+you\b/i;
/** "Ben will be in touch", "he'll call you back about the price". */
const RE_HANDOFF_BEN = /\b(?:ben|he|she|they)\b[^.?!\n]{0,40}\b(?:will|’ll|'ll)\b[^.?!\n]{0,40}\b(?:be in touch|call you|ring you|come back|get back|pick (?:this|it) up|look at (?:this|it|the price)|confirm the price)\b/i;

/**
 * Pure: is this outbound body the hand-off line — a promise that someone will come back to them
 * on the part we are not answering now? Item 1.4 writes the line; this recognises it.
 */
export function saysHandoffLine(text: string | null | undefined): boolean {
    const t = clean(text);
    if (!t) return false;
    return RE_HANDOFF_BACK.test(t) || RE_HANDOFF_BEN.test(t);
}

/** Pure: does this body ask for (or, for `handoff`, say) the given subject? */
export function bodyAsksFor(subject: AskSubject, text: string | null | undefined): boolean {
    switch (subject) {
        case 'media': return asksForMedia(text);
        case 'postcode': return asksForPostcode(text);
        case 'access': return asksForAccess(text);
        case 'handoff': return saysHandoffLine(text);
    }
}

/** Pure: does this inbound turn SUPPLY the subject? Nothing on the thread can prove access was given. */
function turnSupplies(subject: AskSubject, turn: MediaAskTurn): boolean {
    switch (subject) {
        case 'media': return turn.hasMedia;
        case 'postcode': return UK_POSTCODE_RE.test(turn.body ?? '');
        case 'access': return false;
        case 'handoff': return false;
    }
}

function clean(text: string | null | undefined): string {
    return (text ?? '').replace(/\s+/g, ' ').trim();
}

function ms(at: string): number {
    const n = new Date(at).getTime();
    return Number.isFinite(n) ? n : 0;
}

const NOTHING = (subject: AskSubject): AskSubjectState => ({
    subject, asked: false, askedAt: null, askedBody: null, repliedSince: false, answeredSince: false, outstanding: false,
});

/**
 * Pure: the ask-once state of one subject over a thread's turns. The media subject's answer is
 * mediaAskState's, verbatim (media-ask.ts owns that rule); the others share its shape exactly.
 */
export function askSubjectState(subject: AskSubject, turns: readonly MediaAskTurn[]): AskSubjectState {
    if (subject === 'media') {
        const m = mediaAskState(turns);
        return {
            subject, asked: m.asked, askedAt: m.askedAt, askedBody: m.askedBody,
            repliedSince: m.repliedSince, answeredSince: m.mediaSince, outstanding: m.outstanding,
        };
    }
    // Stable sort: two turns in the same millisecond keep the order they were given in.
    const sorted = [...turns].sort((a, b) => ms(a.at) - ms(b.at));
    let askIdx = -1;
    sorted.forEach((t, i) => { if (t.ours && bodyAsksFor(subject, t.body)) askIdx = i; }); // the newest ask wins
    if (askIdx < 0) return NOTHING(subject);
    const ask = sorted[askIdx];
    const after = sorted.slice(askIdx + 1).filter((t) => !t.ours);
    const repliedSince = after.length > 0;
    const answeredSince = after.some((t) => turnSupplies(subject, t));
    return {
        subject, asked: true, askedAt: ask.at, askedBody: ask.body ?? null,
        repliedSince, answeredSince, outstanding: repliedSince && !answeredSince,
    };
}

/**
 * The hand-off line is said ONCE PER OPEN FLAG (s28 finding E). It is not an ask, so the customer
 * cannot answer it; what re-opens it is a NEW flag. Said, and no flag opened since → do not say it
 * again. A flag raised after the line was said is a fresh hand-off and the line may be said once
 * more. With no flag on the file at all, a line already said is still not repeated.
 */
export function handoffState(cf: Pick<CaseFile, 'timeline'>, turns: readonly MediaAskTurn[]): AskSubjectState {
    const base = askSubjectState('handoff', turns);
    if (!base.asked || !base.askedAt) return base;
    const saidAt = ms(base.askedAt);
    const flagOpenedSince = cf.timeline.some((t: TimelineItem) => t.kind === 'flag' && ms(t.at) > saidAt);
    return { ...base, repliedSince: base.repliedSince, answeredSince: flagOpenedSince, outstanding: !flagOpenedSince };
}

// ---------------------------------------------------------------- the ledger

/** Pure: the whole ledger off a case file's own timeline. Order of the timeline does not matter. */
export function buildAskLedger(cf: Pick<CaseFile, 'timeline'>): AskLedger {
    const turns = turnsFromCaseFile(cf);
    return {
        subjects: {
            media: askSubjectState('media', turns),
            postcode: askSubjectState('postcode', turns),
            access: askSubjectState('access', turns),
            handoff: handoffState(cf, turns),
        },
        mediaAck: mediaAckState(turns),
    };
}

/**
 * The ledger for a case file: the one the file itself recorded when it was built, so a replay
 * reads exactly what the agent read; derived on the spot for any case file built before T28 or by
 * a fixture that does not carry one.
 */
export function askLedgerOf(cf: Pick<CaseFile, 'timeline'> & { asks?: AskLedger | null }): AskLedger {
    const stored = cf.asks;
    if (stored?.subjects && stored.mediaAck && ASK_SUBJECTS.every((s) => stored.subjects[s])) return stored;
    return buildAskLedger(cf);
}

/**
 * The media subject back in `mediaAskState`'s own shape, so media-ask.ts keeps ownership of the
 * media wording (`mediaAskLine`, `mediaAskRefusal`) and no caller rebuilds the object by hand.
 */
export function mediaAskStateOf(ledger: AskLedger): MediaAskState {
    const m = ledger.subjects.media;
    return {
        asked: m.asked, askedAt: m.askedAt, askedBody: m.askedBody,
        repliedSince: m.repliedSince, mediaSince: m.answeredSince, outstanding: m.outstanding,
    };
}

// ---------------------------------------------------------------- what the model is told, and the refusals

function when(at: string | null): string {
    return at ? new Date(at).toISOString() : 'earlier';
}

const SUBJECT_NOUN: Record<AskSubject, string> = {
    media: 'a photo or video',
    postcode: 'the postcode',
    access: 'how we get in',
    handoff: 'that someone will come back to them',
};

/** The line the rendered case file carries while an ask is outstanding. Media keeps T20's wording. */
export function askSubjectLine(state: AskSubjectState): string | null {
    if (!state.outstanding) return null;
    switch (state.subject) {
        case 'media':
            return mediaAskLine({ asked: state.asked, askedAt: state.askedAt, askedBody: state.askedBody, repliedSince: state.repliedSince, mediaSince: state.answeredSince, outstanding: state.outstanding });
        case 'postcode':
            return `POSTCODE ASKED ONCE: we asked where the job is at ${when(state.askedAt)} and they have replied without a postcode. Do not ask again. Scope from their words; Ben sees what is missing on the price screen and can ask from there.`;
        case 'access':
            return `ACCESS ASKED ONCE: we asked how we get in at ${when(state.askedAt)} and they have replied. Do not ask again. Access is settled at booking; carry on with the job itself.`;
        case 'handoff':
            return `HAND-OFF ALREADY SAID: we have already told them someone will come back to them (at ${when(state.askedAt)}) and no new flag has opened since. Do not say it again. Answer what you can, and leave the rest without repeating the promise.`;
    }
}

/** The tool boundary's refusal, in the same voice as the Scoper's other refusals. */
export function askSubjectRefusal(state: AskSubjectState): string {
    if (state.subject === 'handoff') {
        return `we have already told them someone will come back to them (at ${when(state.askedAt)}) and nothing new has been handed to Ben since. Do not promise it a second time: say what you can answer now, and stop.`;
    }
    return `we already asked them for ${SUBJECT_NOUN[state.subject]} (at ${when(state.askedAt)}) and they replied without giving it. Do not ask again. Carry on from their words; Ben sees what is missing on the price screen and can ask from there.`;
}

/** The T20 thank-once fact, stated for the model rather than left to be inferred from the thread. */
export function mediaThankedLine(ack: MediaAckState): string | null {
    if (!ack.alreadyThanked) return null;
    const batch = ack.batchSize > 1 ? `the ${ack.batchSize} items that arrived` : 'what arrived';
    return `MEDIA ALREADY THANKED: we thanked them for ${batch} at ${when(ack.acknowledgedAt)} and nothing new has come since. Do not thank them for it again: start with the substance.`;
}

/**
 * Every line the rendered case file should carry about what has been asked and said. Media first,
 * so T20's wording is where it has always been.
 */
export function askLedgerLines(ledger: AskLedger): string[] {
    const lines: string[] = [];
    for (const subject of ASK_SUBJECTS) {
        const line = askSubjectLine(ledger.subjects[subject]);
        if (line) lines.push(line);
    }
    const thanked = mediaThankedLine(ledger.mediaAck);
    if (thanked) lines.push(thanked);
    return lines;
}

export { acknowledgesMedia, asksForMedia };
