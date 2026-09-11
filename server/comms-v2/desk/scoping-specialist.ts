/**
 * The Scoping specialist, on Sonnet 5 at medium effort. Subject: what the job is and where,
 * access, photos, whether a call would help. Opens every new thread and asks the first scoping
 * question. Returns facts with their source and a proposal; never a sentence for the customer.
 *
 * Two halves. The model reads the thread and the descriptions its tool server produced and
 * returns facts (job type, location, access, prefers text, a declined photo) with the turn they
 * came from, plus short labels of what is still unknown about the job. The tool server then
 * decides the proposal deterministically: readiness, the next question in the fixed order,
 * whether to offer a call, whether to thank for media, a hold on regulated work. The specialist
 * never sees the customer and holds no send tool.
 */
import { z } from 'zod/v4';
import { answered, everAsked, recordFact, type CaseFile, type ModelCallRecord, type Party, type Turn } from './case-file';
import type { Proposal, SpecialistReturn } from './desk-types';
import { SPECIALIST_MODEL, type ModelClient } from './models';
import { confirmLocation, describeMedia, mediaDeclined, mediaReceived, nextQuestion, offerCall, readiness, regulated, type DescribeDeps } from './scoping-tools';

export const FACT_KEYS = ['job_type', 'job_detail', 'location', 'access', 'prefers_text', 'already_rung', 'media_declined', 'customer_name', 'promise_of_more'] as const;

export const specialistOutputSchema = z.object({
    facts: z.array(z.object({
        key: z.enum(FACT_KEYS),
        /** Short, in the customer's words where possible. Never a figure. */
        value: z.string().min(1).max(200),
    })).max(12),
    /** Short labels of what is still unknown about the job (e.g. "which tap", "size", "material"). Empty when enough is known to price. */
    jobUnknowns: z.array(z.string().min(1).max(40)).max(4),
    /** Subjects the customer answered in this turn: postcode, access, media (a photo arrived or was declined), job. */
    answeredSubjects: z.array(z.enum(['job', 'postcode', 'access', 'media'])).max(4),
});
export type SpecialistOutput = z.infer<typeof specialistOutputSchema>;

const SYSTEM = [
    'You are the Scoping specialist for a small handyman business\'s desk. You never write to the customer. You read the thread and return facts about the job with no prose.',
    'Facts, each with a short value: job_type (what the job is, e.g. "leaking kitchen tap", "replace one fence panel"; when there are several jobs, list them in one value), job_detail (a detail that matters for pricing, one per fact), location (a postcode, an outward code like NG9, or a named area, exactly as they gave it), access (parking, keys, someone home), prefers_text ("true" when they say text only or cannot take calls), already_rung ("true" when they say they already called us), media_declined ("true" when they decline to send photos), customer_name (if they give it), promise_of_more ("true" when they promise to send something later).',
    'Only what the thread supports. Never invent. Never a figure of money.',
    'jobUnknowns: up to four short labels of what a handyman would still check before pricing this job (e.g. "which of the three jobs first", "tap type", "panel size", "wall or ceiling", "how many"). Most jobs have at least one until the customer has described it properly; empty only when the job is clear enough to price.',
    'answeredSubjects: which of job, postcode, access, media the customer dealt with in the newest turn. A turn that answers the pending question, or engages with it (asks which one we mean, asks for clarification, gives a partial answer), counts as answering it. A photo arriving or being declined counts as media.',
    'Reply with the JSON object only.',
].join('\n');

function threadFor(file: CaseFile, turn: Turn): string {
    return file.turns.slice(-16).map((t) => {
        const media = t.media.length ? ` [${t.media.map((m) => m.description ? `${m.kind}: ${m.description.description}` : `${m.kind} (not described)`).join('; ')}]` : '';
        return `${t.id === turn.id ? '>> ' : ''}${t.direction === 'inbound' ? 'customer' : 'desk'}: ${t.body}${media}`;
    }).join('\n');
}

export interface ScopingDeps extends DescribeDeps {
    now?: () => Date;
}

export async function scope(file: CaseFile, turn: Turn, party: Party, client: ModelClient, deps: ScopingDeps = {}): Promise<SpecialistReturn> {
    const calls: ModelCallRecord[] = [];
    const factIds: string[] = [];
    let error: string | null = null;
    const by = 'scoping';

    // The tool server first: describe what arrived, once.
    const described = await describeMedia(turn, deps);
    calls.push(...described.calls);
    for (const d of described.described) {
        const f = recordFact(file, { key: `media_${d.kind}`, value: d.description.slice(0, 300), source: { kind: 'media_description', turnId: turn.id, mediaId: d.mediaId }, by }, deps);
        if (f.ok) factIds.push(f.value.id);
    }
    const reg = regulated(turn);

    // The model reads the thread and returns facts.
    const user = [
        `Known so far: job type ${file.job.type ?? 'unknown'}; location ${file.job.location ?? 'unknown'}; access ${file.facts.find((f) => f.key === 'access')?.value ?? 'unknown'}.`,
        'Thread, oldest first (the newest turn is marked >>):',
        threadFor(file, turn),
    ].join('\n');
    let jobUnknowns: string[] = [];
    if (turn.body.trim() || turn.media.length) {
        const res = await client.structured({ role: 'specialist', model: SPECIALIST_MODEL, effort: 'medium', system: SYSTEM, user, schema: specialistOutputSchema, maxTokens: 800 });
        calls.push(res.record);
        if (res.output) {
            for (const f of res.output.facts) {
                let value = f.value.trim();
                if (f.key === 'location') {
                    const loc = confirmLocation(value);
                    if (loc.postcode) value = loc.postcode;
                    else if (loc.outward) value = loc.outward + (loc.text ? ` (${loc.text})` : '');
                    else if (loc.confidence === 'low' && !loc.text && !/[a-z]/i.test(value)) continue;
                }
                if (f.key === 'job_type' && file.job.type && file.job.type.toLowerCase() === value.toLowerCase()) continue;
                const rec = recordFact(file, { key: f.key, value, source: { kind: 'thread', turnId: turn.id }, by }, deps);
                if (rec.ok) factIds.push(rec.value.id);
            }
            for (const s of res.output.answeredSubjects) answered(file, s, deps);
            jobUnknowns = res.output.jobUnknowns;
        } else error = res.error;
    }
    if (turn.media.length) answered(file, 'media', deps);

    // The proposal, from the tools.
    const ready = readiness(file).ready;
    const proposal: Proposal = {
        nextQuestion: reg.regulated ? null : nextQuestion(file, jobUnknowns),
        offerCall: !reg.regulated && offerCall(party),
        mentionPhotos: false,
        thankForMedia: turn.media.length > 0 && !file.ledger.find((l) => l.subject === 'media')?.thankedAt,
        ready,
        hold: reg.regulated ? { reason: 'regulated', match: reg.match! } : null,
    };
    // Photos are mentioned once, on the first reply of a job that arrived without any ("ask for a
    // photo, but if there is hesitation do not insist"), so the ask is on the ledger from the start
    // and next_question never returns it again.
    const firstReply = !file.turns.some((t) => t.direction === 'outbound');
    if (firstReply && !reg.regulated && !mediaReceived(file) && !mediaDeclined(file) && !everAsked(file, 'media')) {
        proposal.mentionPhotos = true;
        if (proposal.nextQuestion?.subject === 'media') proposal.nextQuestion = null;
    }
    return { specialist: 'scoping', factIds, proposal, calls, error };
}
