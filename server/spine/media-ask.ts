/**
 * Ask for a photo once (T20, 8 Sep 2026). Pure: no model, no database, no clock.
 *
 * The captain's rule, verbatim: "We would ask for a photo but if hesitation its not a must as we
 * would rather proceed and if needed ben can then ask for one." A model judging "hesitation" is
 * what sent a second photo ask to a customer who had described the job twice
 * (run_b2836d5b…), so the rule is read off the thread's own history instead:
 *
 *   asked        the newest outbound on the thread that asks for a photo or video — whoever sent
 *                it (the first-contact ack's folded sentence, the rules layer's ask_media, the
 *                Scoper's ask_gap, Ben by hand): all four are outbound bodies on the thread
 *   repliedSince the customer has written after it
 *   mediaSince   something with media arrived after it
 *   outstanding  asked AND repliedSince AND NOT mediaSince — they answered without a photo. That
 *                is the hesitation: nobody asks again; the thread proceeds and the fact travels
 *                to the clerk and onto Ben's price screen, where he can ask himself.
 *
 * Three readers share the one function through small adapters: the Scoper's tool boundary and
 * rendered case file (server/spine/agents/scoper.ts), the send-precondition belt
 * (server/spine/send-preconditions.ts), the clerk's thread (server/agents/quote-prep.ts) and the
 * price payload (server/spine/price-screen.ts). None of them invents a second notion of "missing".
 */
import type { CaseFile } from './types';

/** One turn of a conversation, the least any thread shape needs to say. */
export interface MediaAskTurn {
    /** ISO timestamp. */
    at: string;
    /** True for anything we sent (agent, rules layer, Ben); false for the customer. */
    ours: boolean;
    body: string | null | undefined;
    hasMedia: boolean;
}

export interface MediaAskState {
    asked: boolean;
    askedAt: string | null;
    askedBody: string | null;
    repliedSince: boolean;
    mediaSince: boolean;
    /** We asked, they replied, no media came: do not ask again. */
    outstanding: boolean;
}

const MEDIA_NOUN = '(?:photo|photos|picture|pictures|pic|pics|video|videos|clip|clips|snap|snaps|image|images|footage)';
/** "send/take/attach … a photo": an asking verb within a short reach of a media noun. */
const ASK_VERB_THEN_NOUN = new RegExp(`\\b(?:send|share|attach|take|snap|grab|forward|pop|ping|upload|whatsapp|text|get)\\b[^.?!\\n]{0,40}\\b${MEDIA_NOUN}\\b`, 'i');
/** "a photo of X would help / helps us": the soft ask with no verb. */
const NOUN_THEN_HELPS = new RegExp(`\\b${MEDIA_NOUN}\\b[^.?!\\n]{0,60}\\b(?:helps?|would help|would be (?:great|handy|useful|ideal)|is (?:handy|useful|ideal))\\b`, 'i');
/** A question with a media noun in it ("any chance of a photo?"). */
const NOUN_IN_QUESTION = new RegExp(`\\b${MEDIA_NOUN}\\b[^.?!\\n]{0,80}\\?`, 'i');
/** "no need for a photo", "without a photo": not an ask. */
const NEGATED = new RegExp(`\\b(?:no need|don'?t need|do not need|needn'?t|not necessary|no ${MEDIA_NOUN} (?:needed|required|necessary)|without (?:a |any )?${MEDIA_NOUN})\\b`, 'i');

/** Pure: does this outbound body ask the customer for a photo or video? */
export function asksForMedia(text: string | null | undefined): boolean {
    const t = (text ?? '').replace(/\s+/g, ' ').trim();
    if (!t) return false;
    if (NEGATED.test(t)) return false;
    return ASK_VERB_THEN_NOUN.test(t) || NOUN_THEN_HELPS.test(t) || NOUN_IN_QUESTION.test(t);
}

function ms(at: string): number {
    const n = new Date(at).getTime();
    return Number.isFinite(n) ? n : 0;
}

/** Pure: the ask-once state of a thread. Order of `turns` does not matter. */
export function mediaAskState(turns: readonly MediaAskTurn[]): MediaAskState {
    // Stable sort: two turns in the same millisecond keep the order they were given in.
    const sorted = [...turns].sort((a, b) => ms(a.at) - ms(b.at));
    let askIdx = -1;
    sorted.forEach((t, i) => { if (t.ours && asksForMedia(t.body)) askIdx = i; }); // the newest ask wins
    if (askIdx < 0) return { asked: false, askedAt: null, askedBody: null, repliedSince: false, mediaSince: false, outstanding: false };
    const ask = sorted[askIdx];
    const after = sorted.slice(askIdx + 1).filter((t) => !t.ours);
    const repliedSince = after.length > 0;
    const mediaSince = after.some((t) => t.hasMedia);
    return { asked: true, askedAt: ask.at, askedBody: ask.body ?? null, repliedSince, mediaSince, outstanding: repliedSince && !mediaSince };
}

/** The case file's timeline as turns: messages only (a call transcript is not an ask body). */
export function turnsFromCaseFile(cf: Pick<CaseFile, 'timeline'>): MediaAskTurn[] {
    const out: MediaAskTurn[] = [];
    for (const t of cf.timeline) {
        if (t.kind !== 'message_in' && t.kind !== 'message_out') continue;
        out.push({ at: t.at, ours: t.kind === 'message_out', body: t.body, hasMedia: !!t.mediaIds?.length });
    }
    return out;
}

/** The price screen's embedded thread (price-brief ThreadMessage) as turns. */
export function turnsFromThreadMessages(messages: readonly { at: string; direction: 'in' | 'out'; body: string | null; media: unknown | null }[]): MediaAskTurn[] {
    return messages.map((m) => ({ at: m.at, ours: m.direction === 'out', body: m.body, hasMedia: !!m.media }));
}

/** Raw `messages` rows (the clerk's get_thread, the sandbox) as turns. */
export function turnsFromMessageRows(rows: readonly { createdAt: Date | string | null | undefined; direction: string | null | undefined; content: string | null | undefined; mediaUrl: string | null | undefined }[]): MediaAskTurn[] {
    return rows.map((r) => ({
        at: r.createdAt ? new Date(r.createdAt).toISOString() : '',
        ours: r.direction !== 'inbound',
        body: r.content,
        hasMedia: !!r.mediaUrl,
    }));
}

// ---------------------------------------------------------------- thank once (captain, 7 Sep, Priya 495577b5)
//
// 18:09 sent "got the photo, that is really helpful"; 18:10 composed "Thanks for the photo, that
// is helpful" for the same single image, and only the DRAFT tier stopped it. Nothing on the desk
// tracked that a media item had been acknowledged. Same idea as the ask: the thread itself says
// whether we have already thanked them for what they sent since, and a body that thanks again
// for the same media is refused at the tool and belted at the send.

/** "got the photo", "thanks for the video", "the pictures came through": an acknowledgement of media. */
const ACK_THEN_NOUN = new RegExp(`\\b(?:thanks?|thank you|cheers|ta|got|received|seen|appreciate|love|nice|great|perfect|lovely)\\b[^.?!\\n]{0,30}\\b${MEDIA_NOUN}\\b`, 'i');
const NOUN_THEN_ACK = new RegExp(`\\b${MEDIA_NOUN}\\b[^.?!\\n]{0,20}\\b(?:received|came through|landed|got here|arrived|helps?|is (?:really )?(?:helpful|useful|clear|great))\\b`, 'i');

/** Pure: does this body thank the customer for, or acknowledge receipt of, media? An ask is not an acknowledgement. */
export function acknowledgesMedia(text: string | null | undefined): boolean {
    const t = (text ?? '').replace(/\s+/g, ' ').trim();
    if (!t) return false;
    return (ACK_THEN_NOUN.test(t) || NOUN_THEN_ACK.test(t)) && !asksForMedia(t);
}

export interface MediaAckState {
    /** The newest inbound media item's timestamp, if any. */
    newestMediaAt: string | null;
    /** The first item of the newest BATCH — where the thank-you is looked for from. */
    batchStartedAt: string | null;
    /** How many media items are in that batch. */
    batchSize: number;
    /** Our acknowledgement of that batch, if one went out after it started. */
    acknowledgedAt: string | null;
    /** We have already thanked them for the newest batch: do not thank again. */
    alreadyThanked: boolean;
}

/**
 * T28: two photos a minute apart are ONE batch, and one batch gets one thank-you. A batch is a run
 * of inbound media items close together in time; what ends it is the customer moving the
 * conversation on (an inbound message with no media) or a long gap. Our own outbound in the middle
 * does NOT end it: the racing case — photo, "got the photo thanks", second photo a minute later —
 * is exactly the repeat the captain does not want.
 */
export const MEDIA_BATCH_GAP_MS = 10 * 60_000;

/** Pure: has the newest media BATCH on the thread already been acknowledged by us? */
export function mediaAckState(turns: readonly MediaAskTurn[]): MediaAckState {
    const sorted = [...turns].sort((a, b) => ms(a.at) - ms(b.at));
    let mediaIdx = -1;
    sorted.forEach((t, i) => { if (!t.ours && t.hasMedia) mediaIdx = i; });
    if (mediaIdx < 0) return { newestMediaAt: null, batchStartedAt: null, batchSize: 0, acknowledgedAt: null, alreadyThanked: false };
    // Walk back from the newest media item to the start of its batch.
    let startIdx = mediaIdx;
    let batchSize = 1;
    for (let i = mediaIdx - 1; i >= 0; i--) {
        const t = sorted[i];
        if (t.ours) continue;                                       // our reply does not break a batch
        if (!t.hasMedia) break;                                     // they moved the conversation on
        if (ms(sorted[startIdx].at) - ms(t.at) > MEDIA_BATCH_GAP_MS) break;
        startIdx = i;
        batchSize++;
    }
    const ack = sorted.slice(startIdx + 1).find((t) => t.ours && acknowledgesMedia(t.body)) ?? null;
    return {
        newestMediaAt: sorted[mediaIdx].at, batchStartedAt: sorted[startIdx].at, batchSize,
        acknowledgedAt: ack?.at ?? null, alreadyThanked: !!ack,
    };
}

/** The tool boundary's refusal for a second thank-you. */
export function mediaAckRefusal(state: MediaAckState): string {
    return `we already thanked them for the photo or video (at ${when(state.acknowledgedAt)}) and nothing new has arrived since. Do not thank them for it again: start with the substance.`;
}

function when(at: string | null): string {
    return at ? new Date(at).toISOString() : 'earlier';
}

/**
 * The one line the Scoper's rendered case file carries while the ask is outstanding. It states
 * the rule and what to do instead; it adds no words to what the Scoper may say to the customer.
 */
export function mediaAskLine(state: MediaAskState): string | null {
    if (!state.outstanding) return null;
    return `MEDIA ASKED ONCE: we asked for a photo or video at ${when(state.askedAt)} and they have replied without one. Do not ask for media again. Scope from their words; when the job is clear enough, propose confirm_received or clarify_scope with tag needs_quote so the clerk prices it with printed assumptions. The missing photo is shown to Ben on the price screen and he can ask from there.`;
}

/** The tool boundary's refusal, in the same voice as the Scoper's other refusals. */
export function mediaAskRefusal(state: MediaAskState): string {
    return `we already asked for a photo or video (at ${when(state.askedAt)}) and they replied without sending one. Do not ask for media again. Carry on from their words: propose confirm_received or clarify_scope, with tag needs_quote if the job is clear enough. Ben sees "no photo" on the price screen and can ask from there.`;
}
