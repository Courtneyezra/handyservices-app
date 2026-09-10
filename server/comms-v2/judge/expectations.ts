/**
 * Contract 7, piece three: the expectation evaluator.
 *
 * Deterministic assertions over the planned send and the file. Every kind in scenario.ts is
 * evaluated here, with no model: the one model verdict (own_words, line 2.3) is recorded by the
 * runner BESIDE the deterministic result this module returns, never in its place.
 *
 * An expectation that needs a field the current desk cannot supply evaluates to `fail` with the
 * reason "unavailable from current desk", not `error`: the judge ran, the desk did not answer.
 * A seed the door could not honour fails the expectations that depend on it the same way
 * ("window seed unsupported by current desk"). So does a door that could not put the desk's
 * earlier planned reply on the thread: on the turns after it, the kinds that only hold when the
 * desk has seen its own reply (reply_not_sent, not_asks_subject, asked_at_most_once) fail with
 * "artefact: dry-run reply not landed on thread". That verdict judges the door, not the desk.
 *
 * The lexicons below are the judge's own. They are deliberately not imported from the old desk's
 * guards or ask ledger: the old desk is being replaced, and the judge must outlive it.
 */
import { UNAVAILABLE, type PlannedSend } from './planned-send';
import type { AskSubject, Expectation, Seed } from './scenario';

export const UNAVAILABLE_REASON = 'unavailable from current desk';
export const WINDOW_SEED_REASON = 'window seed unsupported by current desk';
export const ARTEFACT_REASON = 'artefact: dry-run reply not landed on thread';

/** Kinds that only hold when the thread carries the desk's earlier reply, so the desk knows it has already spoken. */
export const POST_SEND_DEPENDENT: ReadonlySet<Expectation['kind']> = new Set<Expectation['kind']>(['reply_not_sent', 'not_asks_subject', 'asked_at_most_once']);

export type ExpectationStatus = 'pass' | 'fail' | 'error';

export interface ExpectationResult {
    line: string;
    kind: Expectation['kind'];
    status: ExpectationStatus;
    reason: string;
    /** What the assertion looked at, so a reader can check the verdict without re-running. */
    observed?: unknown;
}

/** Which seed features the door could not honour, by name (door.ts seedPlan says which). */
export type SeedFeature = 'customer' | 'prefersText' | 'alreadyRung' | 'window' | 'facts' | 'ledger';

export interface EvalContext {
    plannedSend: PlannedSend;
    /** Planned sends from the scenario's earlier turns, oldest first. */
    history: readonly PlannedSend[];
    seed: Seed;
    /** Seed features the door could not honour on this run. */
    seedUnsupported: readonly SeedFeature[];
    /** True once an earlier turn's planned reply was never put on the thread by the door. */
    priorSendNotLanded: boolean;
}

// ---------------------------------------------------------------- lexicons

/** A figure of money: pounds sign, or a number with a money word. */
export const RE_FIGURE = /(?:£\s*\d[\d,]*(?:\.\d+)?)|(?:\b\d[\d,]*(?:\.\d+)?\s*(?:pounds?|quid|gbp)\b)|(?:\b\d+p\b)/i;

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const WEEKDAY = '(?:mon|tues|wednes|thurs|fri|satur|sun)day';
/** An abbreviated weekday reads as a day only beside a time-context word: "sat" on its own is a verb. */
const WEEKDAY_ABBR = '(?:mon|tues?|weds?|thur?s?|fri|sat|sun)';
const TIME_CONTEXT_BEFORE = '(?:on|this|next|by|for|from|until|till|every|coming)';
const TIME_CONTEXT_AFTER = '(?:morning|afternoon|evening|night|week|\\d{1,2}(?:st|nd|rd|th)?)';
/** A date, a time, a lead time or a duration. */
export const RE_DATE_TIME_DURATION = new RegExp([
    `\\b${WEEKDAY}\\b`,
    `\\b${TIME_CONTEXT_BEFORE}\\s+${WEEKDAY_ABBR}\\b`,
    `\\b${WEEKDAY_ABBR}\\s+${TIME_CONTEXT_AFTER}\\b`,
    `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b`,
    `\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`,
    `\\b\\d{1,2}[/.-]\\d{1,2}(?:[/.-]\\d{2,4})?\\b`,
    `\\b(?:tomorrow|tonight|this (?:morning|afternoon|evening|week|weekend)|next (?:week|month|day)|end of (?:the )?(?:week|month)|first thing)\\b`,
    `\\b(?:at|by|from|around|about)\\s+\\d{1,2}(?::\\d{2}\\b|(?::\\d{2})?\\s*(?:am|pm|o'?clock)\\b)`,
    `\\b\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)\\b`,
    `\\b(?:\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|half a|couple of|few)\\s+(?:working\\s+)?(?:mins?|minutes?|hours?|hrs?|days?|weeks?|months?)\\b`,
    `\\b(?:within|in)\\s+(?:\\d+|a|an|one|two|three|four|five|six|seven|a couple of|a few)\\s+(?:working\\s+)?(?:days?|weeks?|hours?)\\b`,
    `\\blead[- ]time\\b`,
].join('|'), 'i');

/** A promise to do, fix or guarantee something, or an admission of fault. Fails closed: broad on purpose. */
export const RE_COMMITMENT_OR_FAULT = new RegExp([
    `\\b(?:we|i)(?:'ll| will| can| shall)\\s+(?:definitely\\s+|certainly\\s+)?(?:fix|sort|repair|replace|do|finish|complete|have (?:it|this|that) (?:done|sorted|fixed)|be (?:there|round|out)|come (?:out|round)|get (?:it|this|that) (?:done|sorted|fixed))\\b`,
    `\\b(?:guarantee[ds]?|promise[ds]?|warranty|no problem at all, consider it done)\\b`,
    `\\b(?:our (?:fault|mistake|error)|my (?:fault|mistake)|we (?:messed|screwed) up|we (?:got|had) (?:it|that|this) wrong|we let you down)\\b`,
    `\\bfree of charge\\b`,
].join('|'), 'i');

/** An offer of a call, in the ways a handyman business phrases it. */
export const RE_CALL_OFFER = new RegExp([
    `\\bgive you a (?:quick |short |wee )?(?:call|ring|bell|buzz)\\b`,
    `\\b(?:call|ring|phone|bell) you\\b`,
    `\\ba (?:quick |short |wee )?(?:call|phone call|chat on the phone|chat over the phone)\\b`,
    `\\b(?:jump|hop) on a (?:quick )?call\\b`,
    `\\bhappy to (?:call|ring|phone|have a (?:quick )?(?:call|chat))\\b`,
    `\\b(?:can|could|shall|should|may) (?:we|i|ben) (?:call|ring|phone)\\b`,
    `\\b(?:ok|okay|alright|fine) (?:if|for) (?:we|us|i|me|ben) (?:to )?(?:call|ring|phone)\\b`,
    `\\b(?:over|on) the phone\\b`,
    `\\bcall (?:would|might) (?:help|be (?:easier|quicker|best))\\b`,
    `\\b(?:best|easiest|quickest) (?:to|if we) (?:have a )?(?:call|chat|ring)\\b`,
].join('|'), 'i');

/** A negation before a call phrase in the same clause: "we won't call you" declines a call, it does not offer one. */
const RE_CALL_NEGATION = /\b(?:won'?t|will not|wont|no need to|not going to|rather than|instead of|never)\b/i;

/** A template placeholder, which a reply "in its own words" never carries. */
const RE_PLACEHOLDER = /\{\{\s*\d+\s*\}\}/;

const SUBJECT_WORDS: Record<AskSubject, RegExp> = {
    media: /\b(?:photo|photos|picture|pictures|pic|pics|video|videos|snap|snaps|image|images|footage)\b/i,
    postcode: /\b(?:postcode|post code|post-code|whereabouts|where are you|where is (?:it|the|that)|where about|address|which (?:area|part|town|road|street)|what area|location|located)\b/i,
    access: /\b(?:access|parking|park|key safe|keysafe|keys?|gate code|door code|someone (?:be )?(?:in|home|there|about|around)|anyone (?:be )?(?:in|home|there)|get in|let us in|be home|be in)\b/i,
    handoff: /\b(?:ben|he|she|someone|one of (?:us|the team)|the team)\b[^.?!\n]{0,40}\b(?:will|'ll|can|is going to)\b[^.?!\n]{0,40}\b(?:be in touch|call|ring|phone|come back|get back|pick (?:this|it) up|look at|confirm|price)\b/i,
};

/** Asking phrasing: a question mark, or an imperative or request to send something. */
const RE_ASKING = /\?|\b(?:send|share|pop|drop|attach|ping|forward|could you|can you|would you|if you (?:can|could)|do you have|have you got|let (?:me|us) know|what(?:'s| is)|where|which|when|how|is there|are there|any chance)\b/i;

// ---------------------------------------------------------------- readers over the planned send

export function bubblesText(ps: PlannedSend): string {
    return ps.bubbles.join('\n');
}

/** Sentences across all bubbles, so a subject word and a question mark are checked in the same breath. */
export function sentencesOf(ps: PlannedSend): string[] {
    return ps.bubbles.flatMap((b) => b.split(/(?<=[.?!])\s+|\n+/)).map((s) => s.trim()).filter(Boolean);
}

/** A clause that waves the subject away, so its mention there is not an ask of it. */
const RE_DISMISSIVE = /\b(?:no worries about|don'?t worry about|do not worry about|no need for|(?<!\b(?:don'?t|do not|never|won'?t)\s)forget the)\b/i;

function clausesOf(sentence: string): string[] {
    return sentence.split(/[,;:]|\s+[-–—]\s+/).map((c) => c.trim()).filter(Boolean);
}

/**
 * A sentence asks for a subject when it carries the subject word and an asking phrase anywhere in
 * it ("Photos would really help, any chance you could send one?"), unless the subject word appears
 * only inside a dismissive clause ("No worries about photos, could you tell me the tile size?").
 */
function sentenceAsks(sentence: string, subject: AskSubject): boolean {
    const words = SUBJECT_WORDS[subject];
    if (!words.test(sentence) || !RE_ASKING.test(sentence)) return false;
    return clausesOf(sentence).filter((c) => words.test(c)).some((c) => !RE_DISMISSIVE.test(c));
}

export function asksSubject(ps: PlannedSend, subject: AskSubject | 'any'): boolean {
    if (!ps.delivered) return false;
    const sentences = sentencesOf(ps);
    if (subject === 'any') return sentences.some((s) => s.includes('?'));
    if (subject === 'handoff') return sentences.some((s) => SUBJECT_WORDS.handoff.test(s));
    return sentences.some((s) => sentenceAsks(s, subject));
}

export function questionCount(ps: PlannedSend): number {
    return sentencesOf(ps).filter((s) => s.includes('?')).length;
}

/** Questions about the job: every question except an offer of a call, which is not a scoping question. */
export function scopingQuestionCount(ps: PlannedSend): number {
    return sentencesOf(ps).filter((s) => s.includes('?') && callOfferIn(s) === null).length;
}

/** The call phrase a sentence offers with, or null when it has none or every one is negated in its clause. */
function callOfferIn(sentence: string): string | null {
    for (const clause of clausesOf(sentence)) {
        const m = RE_CALL_OFFER.exec(clause);
        if (m && !RE_CALL_NEGATION.test(clause.slice(0, m.index))) return m[0];
    }
    return null;
}

export function callOfferMatch(ps: PlannedSend): string | null {
    if (!ps.delivered) return null;
    for (const s of sentencesOf(ps)) {
        const m = callOfferIn(s);
        if (m) return m;
    }
    return null;
}

export function offersCall(ps: PlannedSend): boolean {
    return callOfferMatch(ps) !== null;
}

// ---------------------------------------------------------------- the evaluator

function result(e: Expectation, status: ExpectationStatus, reason: string, observed?: unknown): ExpectationResult {
    return { line: e.line, kind: e.kind, status, reason, observed };
}

function unavailable(e: Expectation, field: string): ExpectationResult {
    return result(e, 'fail', UNAVAILABLE_REASON, { field });
}

/** Which seed feature this expectation kind needs, when the seed asks for something the door must honour. */
export function seedDependency(kind: Expectation['kind'], seed: Seed): SeedFeature | null {
    if ((kind === 'template_used' || kind === 'freeform' || kind === 'window_state') && seed.window === 'shut') return 'window';
    return null;
}

/** Evaluate one expectation. Never throws for a well-formed expectation; the runner still guards it. */
export function evaluate(e: Expectation, ctx: EvalContext): ExpectationResult {
    const ps = ctx.plannedSend;
    const dep = seedDependency(e.kind, ctx.seed);
    if (dep && ctx.seedUnsupported.includes(dep)) return result(e, 'fail', dep === 'window' ? WINDOW_SEED_REASON : `${dep} seed unsupported by current desk`, { seed: dep });
    if (ctx.priorSendNotLanded && POST_SEND_DEPENDENT.has(e.kind)) return result(e, 'fail', ARTEFACT_REASON, { bubbles: ps.bubbles });

    const text = bubblesText(ps);
    switch (e.kind) {
        case 'reply_sent':
            return ps.delivered
                ? result(e, 'pass', `a reply would go (${ps.bubbles.length} bubble${ps.bubbles.length === 1 ? '' : 's'}, ${ps.origin})`, { bubbles: ps.bubbles })
                : result(e, 'fail', `no reply would go: decision ${ps.evidence.decision ?? 'none'}${ps.hold ? ' (held for ' + (ps.hold === UNAVAILABLE ? 'unknown' : ps.hold.approver) + ')' : ''}`, { decision: ps.evidence.decision, intent: ps.evidence.intent });
        case 'reply_not_sent':
            return ps.delivered
                ? result(e, 'fail', `a reply would go (${ps.origin}): ${ps.bubbles[0]?.slice(0, 80) ?? ''}`, { bubbles: ps.bubbles })
                : result(e, 'pass', `nothing goes: decision ${ps.evidence.decision ?? 'none'}`, { decision: ps.evidence.decision });
        case 'asks_subject': {
            const asks = asksSubject(ps, e.subject);
            return asks ? result(e, 'pass', `the reply asks about ${e.subject}`, { bubbles: ps.bubbles })
                : result(e, 'fail', ps.delivered ? `the reply does not ask about ${e.subject}` : 'no reply would go', { bubbles: ps.bubbles });
        }
        case 'not_asks_subject': {
            const asks = asksSubject(ps, e.subject);
            return asks ? result(e, 'fail', `the reply asks about ${e.subject}`, { bubbles: ps.bubbles })
                : result(e, 'pass', `the reply does not ask about ${e.subject}`, { bubbles: ps.bubbles });
        }
        case 'asked_at_most_once': {
            const times = [...ctx.history, ps].filter((p) => asksSubject(p, e.subject)).length;
            return times <= 1 ? result(e, 'pass', `${e.subject} asked ${times} time${times === 1 ? '' : 's'} so far`, { times })
                : result(e, 'fail', `${e.subject} asked ${times} times across the scenario`, { times });
        }
        case 'no_figure': {
            const m = RE_FIGURE.exec(text);
            return m ? result(e, 'fail', `a figure appears: "${m[0]}"`, { match: m[0] }) : result(e, 'pass', 'no figure in the reply');
        }
        case 'no_date': {
            const m = RE_DATE_TIME_DURATION.exec(text);
            return m ? result(e, 'fail', `a date, time or duration appears: "${m[0]}"`, { match: m[0] }) : result(e, 'pass', 'no date, time or duration in the reply');
        }
        case 'no_commitment': {
            const m = RE_COMMITMENT_OR_FAULT.exec(text);
            return m ? result(e, 'fail', `a commitment or admission appears: "${m[0]}"`, { match: m[0] }) : result(e, 'pass', 'no commitment or admission in the reply');
        }
        case 'hold_for_approver': {
            if (ps.hold === UNAVAILABLE) return unavailable(e, 'hold');
            if (!ps.hold) return result(e, 'fail', `no hold was raised (decision ${ps.evidence.decision ?? 'none'})`, { decision: ps.evidence.decision });
            return ps.hold.approver.toLowerCase() === e.approver.toLowerCase()
                ? result(e, 'pass', `held for ${ps.hold.approver}: ${ps.hold.reason}`, { hold: ps.hold })
                : result(e, 'fail', `held for ${ps.hold.approver}, not ${e.approver}`, { hold: ps.hold });
        }
        case 'template_used': {
            if (ps.templateId === UNAVAILABLE) return unavailable(e, 'templateId');
            if (ps.templateId === null) return result(e, 'fail', 'the reply is freeform, no template', { templateId: null });
            if (e.templateId && e.templateId !== ps.templateId) return result(e, 'fail', `template ${ps.templateId}, expected ${e.templateId}`, { templateId: ps.templateId });
            return result(e, 'pass', `template ${ps.templateId}`, { templateId: ps.templateId });
        }
        case 'freeform': {
            if (ps.templateId === UNAVAILABLE) return unavailable(e, 'templateId');
            if (!ps.delivered) return result(e, 'fail', 'no reply would go');
            return ps.templateId === null ? result(e, 'pass', 'freeform, no template') : result(e, 'fail', `a template carries it: ${ps.templateId}`, { templateId: ps.templateId });
        }
        case 'window_state': {
            if (ps.windowState === UNAVAILABLE) return unavailable(e, 'windowState');
            return ps.windowState === e.state ? result(e, 'pass', `window ${ps.windowState}`) : result(e, 'fail', `window ${ps.windowState}, expected ${e.state}`);
        }
        case 'stage_after': {
            const stage = ps.evidence.stageAfter;
            if (stage == null) return unavailable(e, 'stage');
            return stage === e.stage ? result(e, 'pass', `stage ${stage}`) : result(e, 'fail', `stage ${stage}, expected ${e.stage}`, { stage });
        }
        case 'bubble_count_within': {
            const n = ps.bubbles.length;
            if (!ps.delivered) return result(e, 'fail', 'no reply would go');
            return n <= e.max ? result(e, 'pass', `${n} bubble${n === 1 ? '' : 's'}, ceiling ${e.max}`, { count: n }) : result(e, 'fail', `${n} bubbles, over the ceiling of ${e.max}`, { count: n });
        }
        case 'fixed_line':
            return text.includes(e.text) ? result(e, 'pass', 'the fixed line appears verbatim') : result(e, 'fail', `the fixed line does not appear: "${e.text}"`, { bubbles: ps.bubbles });
        case 'text_matches': {
            const re = new RegExp(e.pattern, e.flags ?? 'i');
            const m = re.exec(text);
            if (!ps.delivered) return result(e, 'fail', 'no reply would go');
            return m ? result(e, 'pass', `matches /${e.pattern}/: "${m[0]}"`, { match: m[0] }) : result(e, 'fail', `no match for /${e.pattern}/`, { bubbles: ps.bubbles });
        }
        case 'offers_call': {
            const m = callOfferMatch(ps);
            return m !== null ? result(e, 'pass', 'the reply offers a call', { match: m })
                : result(e, 'fail', ps.delivered ? 'the reply does not offer a call' : 'no reply would go', { bubbles: ps.bubbles });
        }
        case 'not_offers_call': {
            const m = callOfferMatch(ps);
            return m !== null ? result(e, 'fail', `the reply offers a call: "${m}"`, { bubbles: ps.bubbles })
                : result(e, 'pass', 'the reply does not offer a call');
        }
        case 'own_words': {
            // The deterministic half: one thing at a time (exactly one question about the job, a
            // call offer not counted) and no template placeholder. The model verdict sits beside it.
            if (!ps.delivered) return result(e, 'fail', 'no reply would go');
            const q = scopingQuestionCount(ps);
            if (RE_PLACEHOLDER.test(text)) return result(e, 'fail', 'a template placeholder appears in the reply', { bubbles: ps.bubbles });
            if (q !== 1) return result(e, 'fail', `${q} scoping questions in one reply, expected exactly one (one thing at a time)`, { questions: q, bubbles: ps.bubbles });
            return result(e, 'pass', 'one scoping question, no placeholder (deterministic half; the model verdict is recorded beside this)', { questions: q, bubbles: ps.bubbles });
        }
    }
}
