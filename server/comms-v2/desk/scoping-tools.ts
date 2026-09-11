/**
 * Contract 6 - The Scoping tool server. The first specialist's shelf. Every call is read-only
 * against the world and writes only to the case file through its calls.
 *
 *   describe_media    Gemini, through the surviving description path (server/spine/tools/
 *                     describe-video.ts); persisted on the turn so it is described once.
 *   confirm_location  postcode, outward code or a named area, with confidence.
 *   readiness         job type and location both present; photos never required.
 *   next_question     the one subject to ask next, in the fixed order job, location, access,
 *                     photos; refuses a subject asked and unanswered, and photos asked once.
 *   offer_call        not when the party prefers text, has already rung, or has been offered one.
 *   regulated         gas or asbestos only.
 *   kb_lookup         reviewed knowledge-base rows by id, verbatim; read-only; may return nothing.
 */
import { askedUnanswered, everAsked, factFor, isReady, type CaseFile, type ModelCallRecord, type Party, type Turn } from './case-file';
import { parseLocation, regulatedMatch, type LocationParse } from './lexicon';
import { recordFromUsage } from './models';

// ---------------------------------------------------------------- describe_media

export interface DescribeDeps {
    describe?: (input: { path: string; kind: 'image' | 'video'; mimeType: string; mediaId: string; customerContext: string | null }) => Promise<{ ok: true; description: string; confidence: 'low' | 'medium' | 'high'; model: string; usage: { inputTokens: number; outputTokens: number } | null; durationMs: number } | { ok: false; reason: string }>;
    now?: () => Date;
}

/** The surviving Gemini path, loaded on first use. Never throws. */
async function describeWithGemini(input: { path: string; kind: 'image' | 'video'; mimeType: string; mediaId: string; customerContext: string | null }) {
    const { describeMediaDetailed, formatDescription } = await import('../../spine/tools/describe-video');
    const out = await describeMediaDetailed({ path: input.path, kind: input.kind, mimeType: input.mimeType, mediaId: input.mediaId, customerContext: input.customerContext });
    if (!out.ok) return { ok: false as const, reason: out.failure.reason };
    const r = out.result;
    return { ok: true as const, description: formatDescription(r.description), confidence: r.description.confidence, model: r.model, usage: r.usage ? { inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens } : null, durationMs: r.durationMs };
}

export interface DescribeOutcome {
    described: Array<{ mediaId: string; kind: 'image' | 'video'; description: string; confidence: string; model: string }>;
    failures: Array<{ mediaId: string; reason: string }>;
    calls: ModelCallRecord[];
}

/** Describes every photo or video on a turn once, persisting the description on the turn. Refuses media that has not been fetched. */
export async function describeMedia(turn: Turn, deps: DescribeDeps = {}): Promise<DescribeOutcome> {
    const now = deps.now ?? (() => new Date());
    const describe = deps.describe ?? describeWithGemini;
    const out: DescribeOutcome = { described: [], failures: [], calls: [] };
    for (const m of turn.media) {
        if (m.description) { out.described.push({ mediaId: m.id, kind: m.kind, description: m.description.description, confidence: m.description.confidence, model: m.description.model }); continue; }
        if (!m.path) { out.failures.push({ mediaId: m.id, reason: 'the media has not been fetched' }); continue; }
        const t0 = Date.now();
        const r = await describe({ path: m.path, kind: m.kind, mimeType: m.mime, mediaId: m.id, customerContext: turn.body || null });
        if (!r.ok) { out.failures.push({ mediaId: m.id, reason: r.reason }); continue; }
        m.description = { kind: m.kind, description: r.description, confidence: r.confidence, model: r.model, at: now().toISOString() };
        out.described.push({ mediaId: m.id, kind: m.kind, description: r.description, confidence: r.confidence, model: r.model });
        out.calls.push(recordFromUsage('vision', r.model, null, r.usage ? { input_tokens: r.usage.inputTokens, output_tokens: r.usage.outputTokens } : null, r.durationMs || Date.now() - t0));
    }
    return out;
}

// ---------------------------------------------------------------- confirm_location

/** Free text or a postcode from the turn: postcode, address where resolvable, confidence. Ambiguous returns nothing. */
export function confirmLocation(text: string): LocationParse {
    return parseLocation(text);
}

// ---------------------------------------------------------------- readiness

export function readiness(file: CaseFile): { ready: boolean; missing: string[] } {
    const missing: string[] = [];
    if (!file.job.type) missing.push('job type');
    if (!file.job.location) missing.push('location');
    return { ready: isReady(file) && missing.length === 0, missing };
}

// ---------------------------------------------------------------- next_question

export type QuestionSubject = 'job' | 'postcode' | 'access' | 'media';
export const QUESTION_ORDER: readonly QuestionSubject[] = ['job', 'postcode', 'access', 'media'];

export function mediaReceived(file: CaseFile): boolean {
    return file.turns.some((t) => t.direction === 'inbound' && t.media.length > 0);
}

export function mediaDeclined(file: CaseFile): boolean {
    return /^(true|yes)$/i.test(factFor(file, 'media_declined')?.value ?? '');
}

/**
 * The one subject to ask next, in the fixed order. A subject is skipped when it is established as
 * a fact, or already asked and unanswered; photos are skipped once asked, received or declined.
 */
export function nextQuestion(file: CaseFile, jobUnknowns: string[] = []): { subject: QuestionSubject; unknowns: string[] } | null {
    for (const subject of QUESTION_ORDER) {
        if (askedUnanswered(file, subject)) continue;
        if (subject === 'job') {
            if (!file.job.type) return { subject, unknowns: jobUnknowns };
            if (jobUnknowns.length && !everAsked(file, 'job')) return { subject, unknowns: jobUnknowns };
            continue;
        }
        if (subject === 'postcode') { if (!file.job.location) return { subject, unknowns: [] }; continue; }
        if (subject === 'access') { if (!factFor(file, 'access') && !everAsked(file, 'access')) return { subject, unknowns: [] }; continue; }
        if (subject === 'media') { if (!everAsked(file, 'media') && !mediaReceived(file) && !mediaDeclined(file)) return { subject, unknowns: [] }; continue; }
    }
    return null;
}

// ---------------------------------------------------------------- offer_call

export function offerCall(party: Party): boolean {
    return !party.prefersText && !party.alreadyRung && !party.callOffered;
}

// ---------------------------------------------------------------- regulated

export function regulated(turn: Turn): { regulated: boolean; match: string | null } {
    const m = regulatedMatch(turn.body);
    return { regulated: !!m, match: m };
}

// ---------------------------------------------------------------- kb_lookup

export interface KbReader { list(): Promise<Array<{ id: string; topic: string; approvedWords: string }>> }

/** The reviewed-only helper, loaded on first use: it opens the database. */
export const reviewedKb: KbReader = {
    async list() {
        try {
            const { listReviewedEntries } = await import('../../spine/knowledge-base');
            return (await listReviewedEntries()).map((e) => ({ id: e.id, topic: e.topic, approvedWords: e.approvedWords }));
        } catch {
            return [];
        }
    },
};

export const emptyKb: KbReader = { async list() { return []; } };

/** Reviewed rows whose topic shares words with the question, verbatim. Read-only; may return nothing. */
export async function kbLookup(question: string, reader: KbReader = reviewedKb): Promise<Array<{ id: string; topic: string; approvedWords: string }>> {
    const words = question.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    if (!words.length) return [];
    const rows = await reader.list();
    return rows.filter((r) => { const t = r.topic.toLowerCase(); return words.some((w) => t.includes(w)); }).slice(0, 5);
}
