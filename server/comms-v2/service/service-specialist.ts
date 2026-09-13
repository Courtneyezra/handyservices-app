/**
 * The Service specialist, on Sonnet 5 at medium effort: the specialist for facts and aftercare.
 * Factual questions about the business, changes of details, invoice and receipt queries,
 * post-job follow-up. It answers only from a reviewed knowledge-base row, cited by id and
 * verbatim, or the customer's own record; it holds on complaints, refunds and trust doubts, on a
 * question it has no source for, on a change of details, and on scoping that is not converging
 * (which a thread with no job on it that nobody is scoping never is). The model sees the customer's
 * name and phone; an email or address on the record is shown only as held, never its value, so a
 * customer asking what we hold for either is Ben's to answer. A requested change to either reaches
 * the file and the composer as the field alone; the new value goes only to Ben's card.
 * Returns facts with their source and a proposal; never a sentence for the customer.
 *
 * Two halves, the Scoping pattern. The tool server first: convergence (deterministic, every turn),
 * then, when the router sent the turn here, kb_lookup by the customer's question and the customer
 * record. The model then reads the thread and the candidate rows and returns only selections: which
 * row answers which question, by id; which record field; a requested change; a hold reason. The
 * tool server checks every selection against what it looked up (an id it did not return is no
 * source), records each answer as a fact whose value is the row's body verbatim, and writes the
 * composer's brief. The specialist never sees the customer and holds no send tool.
 */
import { z } from 'zod/v4';
import { recordFact, type CaseFile, type ModelCallRecord, type Party, type Turn } from '../desk/case-file';
import type { Proposal, SpecialistReturn } from '../desk/desk-types';
import { SPECIALIST_MODEL, type ModelClient } from '../desk/models';
import { reviewedKb, type KbReader } from '../desk/scoping-tools';
import type { ServiceHold } from './hold-reasons';
import { BY, changeOfDetails, convergence, customerRecord, kbLookup, MASKED_FIELDS, RECORD_FIELDS, type KbRowVerbatim, type RecordEntry } from './service-tools';

/** What the model may return: selections and labels only. No field can carry a reply. */
export const serviceOutputSchema = z.object({
    answers: z.array(z.object({
        /** What they asked, as a short label (e.g. "insured?", "areas covered", "receipt for last job"). */
        asked: z.string().min(1).max(60),
        /** kb: a candidate row answers it, by id. record: their own record answers it, by field. none: no source. */
        source: z.enum(['kb', 'record', 'none']),
        /** The knowledge-base row id, or the record field, or null. */
        id: z.string().max(80).nullable(),
    }).strict()).max(6),
    /** A change of details they asked for, or null. */
    changeOfDetails: z.object({ field: z.enum(RECORD_FIELDS), value: z.string().min(1).max(120) }).nullable(),
    /** A complaint, a refund request or a trust doubt in this turn, or null. */
    holdReason: z.enum(['complaint', 'refund', 'trust_doubt']).nullable(),
}).strict();
export type ServiceOutput = z.infer<typeof serviceOutputSchema>;

const SYSTEM = [
    'You are the Service specialist for a small handyman business\'s desk. You never write to the customer. You read the thread and the candidate knowledge-base rows and return selections only, no prose.',
    'answers: one entry per thing the customer asked in the newest turn that is about the business, their own details, an invoice or receipt, or a finished job. source kb with the row id when a candidate row plainly answers it (the row must answer that question, not merely mention the topic); source record with the field (name, phone, email, address) when they ask what we have on file for them, including an email or address shown only as held; source none with id null when nothing given answers it. Never answer from your own knowledge of the business. Scoping questions about the job itself are not yours: leave them out.',
    'changeOfDetails: when they ask to change their name, phone, email or address, the field and the new value exactly as they gave it; otherwise null.',
    'holdReason: complaint when they are unhappy with us or our work, refund when they want money back, trust_doubt when they doubt we are legitimate or a scam worry; otherwise null. "Are you insured" on its own is a factual question, not a trust doubt.',
    'Reply with the JSON object only.',
].join('\n');

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const UK_POSTCODE = '[A-Za-z]{1,2}\\d[A-Za-z\\d]?\\s?\\d[A-Za-z]{2}';
const STREET_SUFFIXES = ['road', 'street', 'avenue', 'lane', 'close', 'drive', 'way', 'court', 'place', 'crescent', 'gardens', 'grove', 'terrace'];
const ADDRESS_RE = new RegExp(`\\d+[^,\\n]{0,40}?\\b(?:${STREET_SUFFIXES.join('|')})\\b(?:,?\\s*${UK_POSTCODE})?`, 'gi');
const POSTCODE_RE = new RegExp(`\\b${UK_POSTCODE}\\b`, 'gi');

/** The captain's masked-record ruling: an email address or a postal address never reaches the model, even freshly typed in a change-of-details ask. */
function withheldFromModel(text: string): string {
    return text.replace(EMAIL_RE, '[email withheld]').replace(ADDRESS_RE, '[address withheld]').replace(POSTCODE_RE, '[address withheld]');
}

/** The real value for a masked-field change of details: read from the customer's own words, never from what the model (which never saw it) echoes back. */
function rawValueFor(field: string, turn: Turn): string | null {
    if (field === 'email') return turn.body.match(EMAIL_RE)?.[0] ?? null;
    if (field === 'address') return turn.body.match(new RegExp(ADDRESS_RE.source, 'i'))?.[0] ?? turn.body.match(new RegExp(POSTCODE_RE.source, 'i'))?.[0] ?? null;
    return null;
}

function threadFor(file: CaseFile, turn: Turn): string {
    return file.turns.slice(-12).map((t) => `${t.id === turn.id ? '>> ' : ''}${t.direction === 'inbound' ? 'customer' : 'desk'}: ${withheldFromModel(t.body)}`).join('\n');
}

export interface ServiceSpecialistDeps {
    kb?: KbReader;
    now?: () => Date;
    newId?: (prefix: string) => string;
}

export interface ServeOptions {
    /** The router sent the turn to Service: the model runs. Otherwise only the deterministic tools do. */
    routed: boolean;
    /** Scoping ran on this turn too, so the brief leaves the question to it and the thread counts as one being scoped. */
    scopingRan: boolean;
}

const emptyProposal = (file: CaseFile, hold: ServiceHold | null): Proposal => ({ nextQuestion: null, offerCall: false, mentionPhotos: false, thankForMedia: false, ready: !!(file.job.type && file.job.location), hold });

export async function serve(file: CaseFile, turn: Turn, party: Party, client: ModelClient, deps: ServiceSpecialistDeps = {}, opts: ServeOptions): Promise<SpecialistReturn> {
    const calls: ModelCallRecord[] = [];
    const factIds: string[] = [];
    const brief: string[] = [];
    const notes: string[] = [];
    const fileDeps = { now: deps.now, newId: deps.newId };

    // The tool server first: convergence, every turn, no model.
    const conv = convergence(file, opts.scopingRan);
    if (!conv.converging) {
        return { specialist: 'service', factIds, proposal: emptyProposal(file, { reason: 'not_converging', match: conv.why! }), calls, error: null, brief, note: `service: not converging (${conv.why})` };
    }
    if (!opts.routed || !turn.body.trim()) return { specialist: 'service', factIds, proposal: emptyProposal(file, null), calls, error: null, brief, note: null };

    const rows: KbRowVerbatim[] = await kbLookup(turn.body, deps.kb ?? reviewedKb);
    const record: RecordEntry[] = customerRecord(file, party);

    // The model reads the thread and the candidates and returns selections.
    const user = [
        'Thread, oldest first (the newest turn is marked >>):',
        threadFor(file, turn),
        '',
        'Candidate knowledge-base rows (reviewed; the body is what may be sent, verbatim):',
        rows.length ? rows.map((r) => `- id ${r.id}: topic "${r.topic}"; body "${r.body}"`).join('\n') : '(none matched)',
        '',
        'The customer\'s own record (fields we hold):',
        record.length ? record.map((e) => MASKED_FIELDS.has(e.field) ? `- ${e.field}: held on file (not shown)` : `- ${e.field}: ${e.value}`).join('\n') : '(nothing on file)',
    ].join('\n');
    const res = await client.structured({ role: 'specialist', model: SPECIALIST_MODEL, effort: 'medium', system: SYSTEM, user, schema: serviceOutputSchema, maxTokens: 600 });
    calls.push(res.record);
    if (!res.output) {
        // A failed or declined model call is no source: Ben gets the question rather than the customer getting silence.
        return { specialist: 'service', factIds, proposal: emptyProposal(file, { reason: 'no_source', match: turn.body.slice(0, 80) }), calls, error: res.error, brief: ['For what they asked we have no source: say Ben will come back to them on it; do not answer it yourself.'], note: `service: model ${res.refused ? 'declined' : 'failed'}, no source` };
    }

    let hold: ServiceHold | null = res.output.holdReason ? { reason: res.output.holdReason, match: turn.body.slice(0, 80) } : null;
    if (!opts.scopingRan) brief.push('This turn: answer what they asked from the lines below. Ask nothing about the job.');
    for (const a of res.output.answers) {
        if (a.source === 'kb') {
            // Only a row the lookup returned counts: an id the model made up is no source.
            const row = rows.find((r) => r.id === a.id);
            if (row) {
                const fact = recordFact(file, { key: `kb:${row.id}`, value: row.body, source: { kind: 'knowledge_base', entryId: row.id }, by: BY }, fileDeps);
                if (fact.ok) {
                    factIds.push(fact.value.id);
                    brief.push(`They asked "${a.asked}": answer with these exact words, verbatim and unparaphrased, and cite knowledge-base id ${row.id} in kbIds (fact ${fact.value.id}): "${row.body}"`);
                    notes.push(`kb ${row.id} for "${a.asked}"`);
                    continue;
                }
            }
        } else if (a.source === 'record') {
            const entry = record.find((e) => e.field === a.id);
            if (entry && MASKED_FIELDS.has(entry.field)) {
                // A masked field is never read back by the desk: the customer hears we hold one, and Ben confirms it.
                brief.push(`They asked "${a.asked}": we hold their ${entry.field} on file, but only Ben can read it back. Say we have it on file and Ben will confirm it; do not state or guess it.`);
                notes.push(`record ${entry.field} masked for "${a.asked}"`);
                if (!hold) hold = { reason: 'no_source', match: `their ${entry.field} on file is masked from the desk; Ben to read it back` };
                continue;
            }
            if (entry) {
                const fact = recordFact(file, { key: entry.field, value: entry.value, source: entry.source, by: BY }, fileDeps);
                if (fact.ok) {
                    factIds.push(fact.value.id);
                    brief.push(`They asked "${a.asked}": their ${entry.field} on our record is exactly "${entry.value}" (fact ${fact.value.id}); read it back as it is.`);
                    notes.push(`record ${entry.field} for "${a.asked}"`);
                    continue;
                }
            }
        }
        // No source (or a selection that did not check out): Ben, and the customer hears that.
        brief.push(`They asked "${a.asked}": we have no source for it. Say Ben will come back to them on it; do not answer it yourself.`);
        notes.push(`no source for "${a.asked}"`);
        if (!hold) hold = { reason: 'no_source', match: a.asked };
    }
    if (res.output.changeOfDetails) {
        const field = res.output.changeOfDetails.field;
        const value = MASKED_FIELDS.has(field) ? rawValueFor(field, turn) : res.output.changeOfDetails.value;
        if (!value) {
            notes.push(`change of details refused: no ${field} found in the customer's own words`);
        } else {
            const change = changeOfDetails(file, party, { field, value, turnId: turn.id }, fileDeps);
            if (change.ok) {
                factIds.push(change.fact.id);
                brief.push(MASKED_FIELDS.has(field)
                    ? `They asked to change their ${field} (fact ${change.fact.id}): say it has been passed to Ben to update; do not state or repeat the new ${field}, and do not say it is done.`
                    : `They asked to change their ${field} to "${value}" (fact ${change.fact.id}): say it has been passed to Ben to update; do not say it is done.`);
                notes.push(`change of details ${MASKED_FIELDS.has(field) ? field : change.hold.match}`);
                if (!hold) hold = change.hold;
            } else notes.push(`change of details refused: ${change.reason}`);
        }
    }
    return { specialist: 'service', factIds, proposal: emptyProposal(file, hold), calls, error: null, brief, note: notes.length ? `service: ${notes.join('; ')}` : 'service: nothing to answer' };
}
