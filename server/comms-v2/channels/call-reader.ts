/**
 * The call reader: Sonnet 5 reads a transcript and returns facts, never prose. What the job is,
 * where, what Ben (or whoever answered) asked the customer to send, whether a callback was agreed.
 * The facts land on the case file with the call turn as their source, so the Scoping tool
 * server's readiness, next_question and ask ledger read them (checklist 1.5, 3.2 to 3.4): after
 * Ben asks for photos on a call the desk never asks again, and the follow-up knows what he asked
 * for.
 *
 * The schema has no field a sentence for the customer could travel in; that is the no-prose
 * invariant (Contract 3, gather) and call-reader.test.ts asserts it.
 */
import { z } from 'zod/v4';
import { answered, ask, askedUnanswered, factFor, recordFact, type CaseFile, type CaseFileDeps, type ModelCallRecord, type Turn } from '../desk/case-file';
import { SPECIALIST_MODEL, type ModelClient } from '../desk/models';
import { confirmLocation, mediaReceived } from '../desk/scoping-tools';
import { transcriptOf } from './call-adapter';

export const ASKED_SUBJECTS = ['media', 'postcode', 'access', 'measurements', 'other'] as const;
export type AskedSubject = (typeof ASKED_SUBJECTS)[number];

export const callReadSchema = z.object({
    /** A short noun phrase for the job, as a person would say it: "the kitchen door". Null when the call never said. */
    jobPhrase: z.string().min(1).max(80).nullable(),
    /** What the job is, in a few words, for the file. */
    jobType: z.string().min(1).max(120).nullable(),
    /** A postcode, an outward code or a named area, exactly as said. */
    location: z.string().min(1).max(60).nullable(),
    /** What our side asked the customer to send or tell us, one entry each. */
    benAskedFor: z.array(z.object({ subject: z.enum(ASKED_SUBJECTS), detail: z.string().min(1).max(80) })).max(6),
    /** Our side said we would ring them again. */
    callbackAgreed: z.boolean(),
    customerName: z.string().min(1).max(60).nullable(),
    /** They said text only, or that they cannot take calls. */
    prefersText: z.boolean(),
});
export type CallRead = z.infer<typeof callReadSchema>;

const SYSTEM = [
    'You read the transcript of a phone call between a small handyman business (Ben, or whoever answered for him) and a customer. You never write to the customer. Return facts only, as the JSON object, no prose.',
    'jobPhrase: a short noun phrase for the job as a person would say it in a text ("the bathroom extractor fan", "two fence panels"). jobType: what the job is, in a few words. location: a postcode, an outward code or a named area, exactly as said, or null.',
    'benAskedFor: each thing our side asked the customer to send or tell us after the call: media (photos or a video), postcode (their location or address), access (parking, keys, someone in), measurements, other. One entry per thing, with a short detail in the caller\'s words ("photos of the fan and the switch"). Empty when nothing was asked for.',
    'callbackAgreed: true only when our side said we would ring them again. prefersText: true when the customer said text only or that calls are difficult. customerName: if they gave it.',
    'Only what the transcript supports. Never invent. Never a figure of money.',
].join('\n');

export interface CallReadOutcome { output: CallRead | null; record: ModelCallRecord; error: string | null }

export async function readCall(file: CaseFile, turn: Turn, client: ModelClient): Promise<CallReadOutcome> {
    const transcript = transcriptOf(turn);
    const user = [
        `Known so far: job type ${file.job.type ?? 'unknown'}; location ${file.job.location ?? 'unknown'}.`,
        'Transcript:',
        transcript || '(no transcript)',
    ].join('\n');
    const res = await client.structured({ role: 'specialist', model: SPECIALIST_MODEL, effort: 'medium', system: SYSTEM, user, schema: callReadSchema, maxTokens: 800 });
    return { output: res.output, record: res.record, error: res.error };
}

export const CALL_READER = 'call_reader';

/** Records the reader's facts on the file with the call turn as their source; returns the fact ids. */
export function recordCallFacts(file: CaseFile, turn: Turn, out: CallRead, deps: CaseFileDeps = {}): string[] {
    const ids: string[] = [];
    const source = { kind: 'thread' as const, turnId: turn.id };
    const put = (key: string, value: string | null | undefined) => {
        const v = (value ?? '').trim();
        if (!v) return;
        const r = recordFact(file, { key, value: v, source, by: CALL_READER }, deps);
        if (r.ok) ids.push(r.value.id);
    };
    if (out.jobType && !(file.job.type && file.job.type.toLowerCase() === out.jobType.toLowerCase())) put(file.job.type ? 'job_detail' : 'job_type', out.jobType);
    put('job_phrase', out.jobPhrase);
    if (out.location) {
        const loc = confirmLocation(out.location);
        put('location', loc.postcode ?? (loc.outward ? loc.outward + (loc.text ? ` (${loc.text})` : '') : (/[a-z]/i.test(out.location) ? out.location : null)));
    }
    if (out.benAskedFor.length) put('ben_asked_for', out.benAskedFor.map((a) => a.detail).join('; ').slice(0, 200));
    if (out.callbackAgreed) put('callback_agreed', 'true');
    if (out.prefersText) put('prefers_text', 'true');
    const named = (out.customerName ?? '').trim();
    if (named && !file.parties[0]?.name) {
        put('customer_name', named);
        if (file.parties[0]) file.parties[0].name = named;
    }
    return ids;
}

/** The ledger subjects Ben's asks map to, for what is not already on the file. */
export function benAskedSubjects(file: CaseFile, out: CallRead): Array<'media' | 'postcode' | 'access'> {
    const subjects = new Set<'media' | 'postcode' | 'access'>();
    for (const a of out.benAskedFor) {
        if (a.subject === 'media' && !mediaReceived(file)) subjects.add('media');
        if (a.subject === 'postcode' && !file.job.location) subjects.add('postcode');
        if (a.subject === 'access' && !factFor(file, 'access')) subjects.add('access');
    }
    return Array.from(subjects);
}

/**
 * As soon as the call has been read: Ben's asks go on the ledger as asked, so the desk never asks
 * for them again (the old ledger "did not hear calls"). He asked by saying it on the phone, so this
 * does not wait on a follow-up text going out (channel-desk.ts). A subject already asked and
 * unanswered is marked answered first: Ben asked again himself and the customer agreed on the
 * phone, so his ask is the one now standing. `handoff` is answered: the call happened.
 */
export function ledgerAfterCall(file: CaseFile, subjects: ReadonlyArray<'media' | 'postcode' | 'access'>, deps: CaseFileDeps = {}): void {
    for (const s of subjects) {
        if (askedUnanswered(file, s)) answered(file, s, deps);
        ask(file, s, deps);
    }
    if (askedUnanswered(file, 'handoff')) answered(file, 'handoff', deps);
}
