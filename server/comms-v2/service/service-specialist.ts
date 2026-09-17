/**
 * The Service specialist, on Sonnet 5 at medium effort: the specialist for facts and aftercare.
 * Factual questions about the business, changes of details, invoice and receipt queries,
 * post-job follow-up. It answers only from a reviewed knowledge-base row, cited by id and
 * verbatim, or the customer's own record (their details on the file, and, for a customer the CRM
 * knows, their leads, quotes, jobs with visit days, and invoices, read-only through
 * customer-record.ts); it holds on complaints, refunds and trust doubts, on a
 * question it has no source for, on a change of details, and on scoping that is not converging
 * (which a thread with no job on it that nobody is scoping never is). The model sees the customer's
 * name and phone; an email or address on the record is shown only as held, never its value, so a
 * customer asking what we hold for either is Ben's to answer. A requested change to either reaches
 * the file and the composer as the field alone, when the new value can be read from the customer's
 * own words; when it cannot, no fact is written and the hold alone tells Ben so. The new value, when
 * there is one, goes only to Ben's card.
 * An invoice or receipt question is answered from the invoice row: each figure and date is the
 * row's own, recorded as a fact whose source is the customer record, and the composer reads back
 * only those (answer 23: nothing added up). A money question the router handed here
 * (`invoiceMoney`) that no invoice answers holds for Ben as money. The CRM record never carries an
 * email, address or postcode, and its free text passes the same mask as the thread.
 * Returns facts with their source and a proposal; never a sentence for the customer: the model's
 * `asked` label is used only as far as `askedLabel` clips it, in the brief and on Ben's card.
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
import { recordFact, type CaseFile, type ModelCallRecord, type Party, type Turn, isTurnOf } from '../desk/case-file';
import type { Proposal, SpecialistReturn } from '../desk/desk-types';
import { SPECIALIST_MODEL, type ModelClient } from '../desk/models';
import { reviewedKb, type KbReader } from '../desk/scoping-tools';
import type { ServiceHold } from './hold-reasons';
import { asksAboutOurArea, BY, changeOfDetails, convergence, customerRecord, kbLookup, MASKED_FIELDS, RECORD_FIELDS, type KbRowVerbatim, type RecordEntry } from './service-tools';
import { recordFactKey, recordItems, recordSourceField, type CustomerRecordReader, type RecordItem } from './customer-record';
import { isoDayOf } from '../scheduling/diary';

/** What the model may return: selections and labels only. No field can carry a reply. */
export const serviceOutputSchema = z.object({
    answers: z.array(z.object({
        /**
         * What they asked, as a short label (e.g. "insured?", "areas covered", "receipt for last
         * job"). Only `ASKED_LABEL_MAX` characters of it are ever used, so no more prose can ride
         * in on it than the label it is meant to be; the schema's own ceiling is loose because a
         * string ceiling is not enforced as the answer is written, and a label a few words over it
         * threw the whole answer away (17 Sep 2026: a known customer's invoice question held for
         * Ben every time, the model having echoed the question here).
         */
        asked: z.string().min(1).max(200),
        /** kb: a candidate row answers it, by id. record: their own record answers it, by field. history: an item on their history answers it, by ref. job: it is about the customer's own job, Scoping's. none: no source. */
        source: z.enum(['kb', 'record', 'history', 'job', 'none']),
        /** The knowledge-base row id, or the record field, or the history ref, or null. */
        id: z.string().max(80).nullable(),
    }).strict()).max(6),
    /** A change of details they asked for, or null. */
    changeOfDetails: z.object({ field: z.enum(RECORD_FIELDS), value: z.string().min(1).max(120) }).nullable(),
    /** A complaint, a refund request or a trust doubt in this turn, or null. */
    holdReason: z.enum(['complaint', 'refund', 'trust_doubt']).nullable(),
}).strict();
export type ServiceOutput = z.infer<typeof serviceOutputSchema>;

/** How much of the model's `asked` label is used, in the brief and in the note on Ben's card. */
export const ASKED_LABEL_MAX = 60;

/** The label as it is used: the model's own words, clipped to a label's length. */
export function askedLabel(asked: string): string {
    const trimmed = asked.trim();
    return trimmed.length <= ASKED_LABEL_MAX ? trimmed : `${trimmed.slice(0, ASKED_LABEL_MAX - 1).trimEnd()}\u2026`;
}

const SYSTEM = [
    'You are the Service specialist for a small handyman business\'s desk. You never write to the customer. You read the thread and the candidate knowledge-base rows and return selections only, no prose.',
    'answers: one entry per thing the customer asked in the newest turn: about the business, their own details, an invoice or receipt, a finished job, or the job they want doing. source kb with the row id when a candidate row plainly answers it (the row must answer that question, not merely mention the topic); source record with the field (name, phone, email, address) when they ask what we have on file for them, including an email or address shown only as held; source history with the item\'s ref when an item on their history answers it: an invoice, a receipt, a payment or what they owe; a visit that is booked or done; a quote or an enquiry they made. A receipt or payment question is answered by the invoice it is about. source job with id null when it is about the job they want doing: whether we can do it (can you fix my leaking tap, could you put up these shelves), how, how long or what it involves. That is Scoping\'s, never a business question without a source, even when the same message also asks about the business. source none with id null when nothing given answers a question about the business. Never answer from your own knowledge of the business.',
    'Never add figures up or work one out: a figure is only ever an item\'s own.',
    'changeOfDetails: when they ask to change their name, phone, email or address, the field and the new value exactly as they gave it; otherwise null.',
    'holdReason: complaint when they are unhappy with us or our work, refund when they want money back, trust_doubt when they doubt we are legitimate or a scam worry; otherwise null. "Are you insured" on its own is a factual question, not a trust doubt.',
    'Reply with the JSON object only.',
].join('\n');

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const UK_POSTCODE = '[A-Za-z]{1,2}\\d[A-Za-z\\d]?\\s?\\d[A-Za-z]{2}';
const STREET_SUFFIXES = ['road', 'street', 'avenue', 'lane', 'close', 'drive', 'way', 'court', 'place', 'crescent', 'gardens', 'grove', 'terrace'];
// A house number is followed directly by a capitalised word (the street name) so an incidental
// number earlier in the message (a time, a count) never drags unrelated text into the postcode
// match: "9-5 near NG9 1AB" and "2 dogs ... postcode is NG9 1AB" keep their own words; only the
// bare postcode there falls to POSTCODE_RE below. Known limit, left as a best-effort text match
// rather than an address parser: an address with neither a recognised street suffix nor a postcode
// (e.g. "44 Foxglove Rise, Beeston" with an unlisted street word and no postcode) is not caught and
// reaches the model unmasked.
const ADDRESS_WITH_POSTCODE_RE = new RegExp(`\\d+[A-Za-z]?\\s+[A-Z][^\\n]{0,50}?${UK_POSTCODE}`, 'g');
const ADDRESS_STREET_RE = new RegExp(`\\d+[^,\\n]{0,40}?\\b(?:${STREET_SUFFIXES.join('|')})\\b`, 'gi');
const POSTCODE_RE = new RegExp(`\\b${UK_POSTCODE}\\b`, 'gi');

/** The captain's masked-record ruling: an email address or a postal address never reaches the model, even freshly typed in a change-of-details ask. */
export function withheldFromModel(text: string): string {
    return text.replace(EMAIL_RE, '[email withheld]').replace(ADDRESS_WITH_POSTCODE_RE, '[address withheld]').replace(ADDRESS_STREET_RE, '[address withheld]').replace(POSTCODE_RE, '[address withheld]');
}

/**
 * The real value for a masked-field change of details: read from the customer's own words, never
 * from what the model (which never saw it) echoes back. When they gave more than one email, the
 * last one is the new one, since the old value is stated first ("used to be X ... now Y"). An
 * address is read as the full clause: house number, street and town up to and including the
 * postcode, not just the postcode, whatever the street word; null when nothing readable is there.
 */
function rawValueFor(field: string, turn: Turn): string | null {
    if (field === 'email') {
        const matches = turn.body.match(EMAIL_RE);
        return matches?.length ? matches[matches.length - 1] : null;
    }
    if (field === 'address') {
        return turn.body.match(ADDRESS_WITH_POSTCODE_RE)?.[0]
            ?? turn.body.match(new RegExp(ADDRESS_STREET_RE.source, 'i'))?.[0]
            ?? turn.body.match(new RegExp(POSTCODE_RE.source, 'i'))?.[0]
            ?? null;
    }
    return null;
}

function threadFor(file: CaseFile, turn: Turn): string {
    return file.turns.slice(-12).map((t) => `${isTurnOf(t, turn) ? '>> ' : ''}${t.direction === 'inbound' ? 'customer' : 'desk'}: ${withheldFromModel(t.body)}`).join('\n');
}

export interface ServiceSpecialistDeps {
    kb?: KbReader;
    /** The customer's CRM record, read-only. Unset, only the details on the file are read. */
    records?: CustomerRecordReader;
    now?: () => Date;
    newId?: (prefix: string) => string;
}

export interface ServeOptions {
    /** The router sent the turn to Service: the model runs. Otherwise only the deterministic tools do. */
    routed: boolean;
    /** Scoping ran on this turn too, so the brief leaves the question to it and the thread counts as one being scoped. */
    scopingRan: boolean;
    /** The router handed this turn's money question to Service as one about an invoice (desk/router.ts): unanswered from an invoice row, it holds as money. */
    invoiceMoney?: boolean;
}

/** The customer's history for the model: each item by ref, its values masked like the thread. */
function historyFor(items: RecordItem[] | null, readError: string | null): string {
    if (readError) return '(their record could not be read just now)';
    if (!items) return '(no customer record)';
    if (!items.length) return '(nothing on their record)';
    // The free text (a job's description, an invoice line's) is masked piece by piece; a value is the row's own figure, date or status.
    return items.map((it) => `- ref ${it.ref}: ${[withheldFromModel(it.summary ?? it.kind), ...it.facts.map((f) => `${withheldFromModel(f.label)} ${f.value}`)].join('; ')}`).join('\n');
}

/** Added to the lookup on a coverage question, so the areas-covered row is a candidate whatever words the customer used. */
const AREA_QUERY = 'which areas do you cover';

const emptyProposal = (file: CaseFile, hold: ServiceHold | null): Proposal => ({ nextQuestion: null, offerCall: false, mentionPhotos: false, thankForMedia: false, ready: !!(file.job.type && file.job.location), hold });

export async function serve(file: CaseFile, turn: Turn, party: Party, client: ModelClient, deps: ServiceSpecialistDeps = {}, opts: ServeOptions): Promise<SpecialistReturn> {
    const calls: ModelCallRecord[] = [];
    const factIds: string[] = [];
    const brief: string[] = [];
    const notes: string[] = [];
    const fileDeps = { now: deps.now, newId: deps.newId };

    // The tool server first: convergence, every turn, no model. Not converging answers the rest
    // (hold-reasons.ts): a question routed here is still answered, and the hold stands behind any the answer raises.
    const conv = convergence(file, opts.scopingRan);
    const slow: ServiceHold | null = conv.converging ? null : { reason: 'not_converging', match: conv.why! };
    const slowNote = slow ? `not converging (${conv.why})` : null;
    if (!opts.routed || !turn.body.trim()) return { specialist: 'service', factIds, proposal: emptyProposal(file, slow), calls, error: null, brief, note: slowNote && `service: ${slowNote}` };
    if (slowNote) notes.push(slowNote);

    const rows: KbRowVerbatim[] = await kbLookup(asksAboutOurArea(turn.body) ? `${turn.body}\n${AREA_QUERY}` : turn.body, deps.kb ?? reviewedKb);
    const record: RecordEntry[] = customerRecord(file, party);
    // Their CRM record, read-only, only for a turn whose own address proved the client (answer 126). A read that fails is said to the model, never guessed at.
    const customerId = turn.customerId ?? null;
    let history: RecordItem[] | null = null;
    let historyError: string | null = null;
    if (customerId && deps.records) {
        try {
            const crm = await deps.records.record(customerId);
            history = crm ? recordItems(crm, isoDayOf((deps.now ?? (() => new Date()))())) : null;
        } catch (e: any) {
            historyError = e?.message ?? String(e);
            notes.push('the customer record could not be read');
        }
    }
    const moneyHold = (): ServiceHold => ({ reason: 'money', match: `an invoice money question no invoice on their record answered: ${turn.body.slice(0, 80)}` });

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
        '',
        'Their history on our records (read-only; pick an item by its ref):',
        historyFor(history, historyError),
    ].join('\n');
    const res = await client.structured({ role: 'specialist', model: SPECIALIST_MODEL, effort: 'medium', system: SYSTEM, user, schema: serviceOutputSchema, maxTokens: 600 });
    calls.push(res.record);
    if (!res.output) {
        // A failed or declined model call is no source: Ben gets the question rather than the customer getting silence.
        return { specialist: 'service', factIds, proposal: emptyProposal(file, opts.invoiceMoney ? moneyHold() : { reason: 'no_source', match: turn.body.slice(0, 80) }), calls, error: res.error, brief: ['For what they asked we have no source: say you will check on it and come back to them; do not answer it yourself.'], note: `service: model ${res.refused ? 'declined' : 'failed'}, no source` };
    }

    let hold: ServiceHold | null = res.output.holdReason ? { reason: res.output.holdReason, match: turn.body.slice(0, 80) } : null;
    let invoiceRead = false;
    if (!opts.scopingRan) brief.push('This turn: answer what they asked from the lines below. Ask nothing about the job.');
    for (const a of res.output.answers) {
        const asked = askedLabel(a.asked);
        // A question about their own job is Scoping's: when Scoping ran on this turn it is left to it,
        // never held as no source. When Scoping did not run, nobody else answers it, so it falls through to Ben.
        if (a.source === 'job' && opts.scopingRan) {
            notes.push(`"${asked}" left to scoping`);
            continue;
        }
        if (a.source === 'kb') {
            // Only a row the lookup returned counts: an id the model made up is no source.
            const row = rows.find((r) => r.id === a.id);
            if (row) {
                const fact = recordFact(file, { key: `kb:${row.id}`, value: row.body, source: { kind: 'knowledge_base', entryId: row.id }, by: BY }, fileDeps);
                if (fact.ok) {
                    factIds.push(fact.value.id);
                    brief.push(`They asked "${asked}": answer with these exact words, verbatim and unparaphrased, and cite knowledge-base id ${row.id} in kbIds (fact ${fact.value.id}): "${row.body}"`);
                    notes.push(`kb ${row.id} for "${asked}"`);
                    continue;
                }
            }
        } else if (a.source === 'history') {
            // Only an item the record read returned counts; each of its values is a fact from the customer record.
            const item = history?.find((it) => it.ref === a.id);
            if (item && customerId && item.facts.length) {
                const ids: string[] = [];
                const lines: string[] = [];
                for (const f of item.facts) {
                    const fact = recordFact(file, { key: recordFactKey(item, f), value: f.value, source: { kind: 'customer_record', customerId, field: recordSourceField(item, f) }, by: BY }, fileDeps);
                    if (!fact.ok) continue;
                    ids.push(fact.value.id);
                    lines.push(`${withheldFromModel(f.label)} "${f.value}" (fact ${fact.value.id})`);
                }
                if (ids.length) {
                    factIds.push(...ids);
                    brief.push(`They asked "${asked}": from their ${withheldFromModel(item.summary ?? item.kind)} on our records: ${lines.join('; ')}. Read back only what answers them, each exactly as written and citing its fact id; never add them up or work anything out.`);
                    notes.push(`record ${item.ref} for "${asked}"`);
                    if (item.kind === 'invoice') invoiceRead = true;
                    continue;
                }
            }
        } else if (a.source === 'record') {
            const entry = record.find((e) => e.field === a.id);
            if (entry && MASKED_FIELDS.has(entry.field)) {
                // A masked field is never read back by the desk: the customer hears we hold one, and Ben confirms it.
                brief.push(`They asked "${asked}": we hold their ${entry.field} on file, but it is not read back here. Say we have it on file and you will confirm it; do not state or guess it.`);
                notes.push(`record ${entry.field} masked for "${asked}"`);
                if (!hold) hold = { reason: 'no_source', match: `their ${entry.field} on file is masked from the desk; Ben to read it back` };
                continue;
            }
            if (entry) {
                const fact = recordFact(file, { key: entry.field, value: entry.value, source: entry.source, by: BY }, fileDeps);
                if (fact.ok) {
                    factIds.push(fact.value.id);
                    brief.push(`They asked "${asked}": their ${entry.field} on our record is exactly "${entry.value}" (fact ${fact.value.id}); read it back as it is.`);
                    notes.push(`record ${entry.field} for "${asked}"`);
                    continue;
                }
            }
        }
        // No source (or a selection that did not check out): Ben, and the customer hears that.
        brief.push(`They asked "${asked}": we have no source for it. Say you will check on it and come back to them; do not answer it yourself.`);
        notes.push(`no source for "${asked}"`);
        if (!hold) hold = { reason: 'no_source', match: asked };
    }
    if (res.output.changeOfDetails) {
        const field = res.output.changeOfDetails.field;
        const value = MASKED_FIELDS.has(field) ? rawValueFor(field, turn) : res.output.changeOfDetails.value;
        if (!value) {
            brief.push(`They asked to change their ${field}, but the new ${field} could not be read from their message: say you've noted it and will confirm it; do not say it is done.`);
            notes.push(`change of details ${field}: could not be read from the message`);
            if (!hold) hold = { reason: 'change_of_details', match: `the new ${field} could not be read from the message` };
        } else {
            const change = changeOfDetails(file, party, { field, value, turnId: turn.id }, fileDeps);
            if (change.ok) {
                factIds.push(change.fact.id);
                brief.push(MASKED_FIELDS.has(field)
                    ? `They asked to change their ${field} (fact ${change.fact.id}): say you've noted it and will update it; do not state or repeat the new ${field}, and do not say it is done.`
                    : `They asked to change their ${field} to "${value}" (fact ${change.fact.id}): say you've noted it and will update it; do not say it is done.`);
                notes.push(`change of details ${MASKED_FIELDS.has(field) ? field : change.hold.match}`);
                if (!hold) hold = change.hold;
            } else notes.push(`change of details refused: ${change.reason}`);
        }
    }
    // Money the router handed here is Ben's unless an invoice row answered it; it outranks a no-source or change hold, never a complaint, refund or trust doubt.
    if (opts.invoiceMoney && !invoiceRead && (!hold || hold.reason === 'no_source' || hold.reason === 'change_of_details')) {
        const also = hold?.reason === 'change_of_details' ? `; they also asked to change a detail (${hold.match})` : '';
        hold = { ...moneyHold(), match: `${moneyHold().match}${also}` };
        notes.push('invoice money question not answered from an invoice');
    }
    return { specialist: 'service', factIds, proposal: emptyProposal(file, hold ?? slow), calls, error: null, brief, note: notes.length ? `service: ${notes.join('; ')}` : 'service: nothing to answer' };
}
