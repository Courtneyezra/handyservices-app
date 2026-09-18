/**
 * The Service tool server (docs/comms-v2/contracts.md, the Service tool server). The specialist
 * for facts and aftercare has four tools and nothing else: three on its shelf (the knowledge base,
 * the customer's own record, and a change of details) and convergence, the deterministic check the
 * desk runs every turn before the model is called, never a tool the model reaches for. Every call is
 * read-only against the world and writes only to the case file through its calls.
 *
 *   kb_lookup          reviewed knowledge-base rows selected by question, by id, with the body
 *                      verbatim. Read through the one reviewed-only reader (scoping-tools.ts
 *                      reviewedKb wraps server/spine/knowledge-base.ts listReviewedEntries); an
 *                      unreviewed, retired or blank row is invisible here. May return nothing.
 *   customer_record    the customer's own details from the file's party record and the facts on
 *                      the file whose source is the customer record. Never another customer's. The
 *                      email and address are MASKED_FIELDS: the model is told only that one is held.
 *   change_of_details  records a requested change as a fact and raises a hold for Ben; it never
 *                      writes the customer record itself. For a masked field the fact names only
 *                      the field: the new value rides on the hold, which is Ben's card.
 *   convergence        whether scoping is converging: a thread being scoped that has asked about
 *                      the job the maximum number of times with no job type, or has replied many
 *                      times without becoming ready, goes to Ben (checklist 7.1). A thread with no
 *                      job on it that nobody is scoping has nothing to converge: it never holds.
 *
 * The hold reasons this server can raise are the vocabulary in hold-reasons.ts.
 */
import { everAsked, isReady, ledgerEntry, recordFact, type CaseFile, type CaseFileDeps, type Fact, type Party } from '../desk/case-file';
import { e164Of } from '../desk/identity';
import { RE_FIGURE } from '../desk/lexicon';
import { reviewedKb, type KbReader } from '../desk/scoping-tools';
import { JOB_ASKS_MAX } from '../desk/scoping-tools';
import type { ServiceHold } from './hold-reasons';

export const BY = 'service';

// ---------------------------------------------------------------- kb_lookup

export interface KbRowVerbatim { id: string; topic: string; body: string }

const STOP = new Set(['what', 'when', 'where', 'which', 'does', 'this', 'that', 'with', 'have', 'your', 'about', 'could', 'would', 'should', 'there', 'they', 'them', 'will', 'from', 'into', 'just', 'also', 'still', 'please', 'thanks', 'hello', 'need', 'want', 'know', 'like', 'some', 'much', 'many', 'been', 'were', 'than', 'then']);

/** The first five letters of every word over three letters, so "insured" finds "insurance" and "receipts" finds "receipt". A selection, not a search. */
export function stemsOf(text: string): string[] {
    return Array.from(new Set(text.toLowerCase().split(/[^a-z0-9']+/).map((w) => w.replace(/'s$/, '').replace(/'/g, '')).filter((w) => w.length > 3 && !STOP.has(w)).map((w) => w.slice(0, 5))));
}

/**
 * Reviewed rows whose topic or body shares words with the question, best match first, the body
 * verbatim. Read-only; may return nothing. A row is scored by how many of the question's stems
 * its topic carries (a topic hit counts twice: it is the question Ben wrote the answer for) and
 * its body carries.
 */
export async function kbLookup(question: string, reader: KbReader = reviewedKb, limit = 5): Promise<KbRowVerbatim[]> {
    const stems = stemsOf(question);
    if (!stems.length) return [];
    const rows = await reader.list();
    const scored = rows.map((r) => {
        const topic = r.topic.toLowerCase();
        const body = r.approvedWords.toLowerCase();
        const score = stems.reduce((n, s) => n + (topic.includes(s) ? 2 : 0) + (body.includes(s) ? 1 : 0), 0);
        return { row: r, score };
    }).filter((x) => x.score > 0 && x.row.approvedWords.trim());
    scored.sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id));
    return scored.slice(0, limit).map(({ row }) => ({ id: row.id, topic: row.topic, body: row.approvedWords }));
}

// ---------------------------------------------------------------- customer_record

export const RECORD_FIELDS = ['name', 'phone', 'email', 'address'] as const;
export type RecordField = (typeof RECORD_FIELDS)[number];
/** Fields the specialist's model may know are held but never sees: it cannot read them back, so asking what we hold is Ben's. */
export const MASKED_FIELDS: ReadonlySet<RecordField> = new Set<RecordField>(['email', 'address']);

export interface RecordEntry { field: RecordField; value: string; source: { kind: 'customer_record'; customerId: string; field: string } }

/**
 * The customer's own details: the party record on the file (name, the phone and email addresses
 * the desk can reach them on) and any fact on the file whose source is the customer record. Only
 * this party's; another party's record is never read here.
 */
export function customerRecord(file: CaseFile, party: Party): RecordEntry[] {
    const customerId = party.personId;
    const out: RecordEntry[] = [];
    const source = (field: string) => ({ kind: 'customer_record' as const, customerId, field });
    if (party.name) out.push({ field: 'name', value: party.name, source: source('name') });
    const phone = party.channels.find((c) => c.kind === 'whatsapp' || c.kind === 'sms' || c.kind === 'call')?.address ?? e164Of(party.canonical);
    if (phone) out.push({ field: 'phone', value: phone, source: source('phone') });
    const email = party.channels.find((c) => c.kind === 'email')?.address ?? (party.canonical.startsWith('email:') ? party.canonical.slice('email:'.length) : null);
    if (email) out.push({ field: 'email', value: email, source: source('email') });
    for (const f of file.facts) {
        if (f.source.kind !== 'customer_record' || f.source.customerId !== customerId) continue;
        const named = f.source.field || f.key;
        const field = (RECORD_FIELDS as readonly string[]).includes(named) ? (named as RecordField) : null;
        if (!field) continue;
        const i = out.findIndex((e) => e.field === field);
        const entry: RecordEntry = { field, value: f.value, source: source(field) };
        if (i >= 0) out[i] = entry; else out.push(entry);
    }
    return out;
}

// ---------------------------------------------------------------- change_of_details

export interface ChangeRequest { field: string; value: string; turnId: string }
export type ChangeOutcome = { ok: true; fact: Fact; hold: ServiceHold } | { ok: false; reason: string };

/**
 * Records a requested change as a fact with the turn it came from and raises a hold for Ben. The
 * customer record is never written here: Ben updates it, and the thread comes back when he replies.
 * Refuses a field that is not one of the record's, an empty value, a figure, and a value the
 * record already holds.
 */
export function changeOfDetails(file: CaseFile, party: Party, req: ChangeRequest, deps: CaseFileDeps = {}): ChangeOutcome {
    const field = req.field.trim().toLowerCase();
    if (!(RECORD_FIELDS as readonly string[]).includes(field)) return { ok: false, reason: `${req.field || '(blank)'} is not a field on the customer record (${RECORD_FIELDS.join(', ')})` };
    const value = req.value.trim();
    if (!value) return { ok: false, reason: 'a change of details needs the new value' };
    if (RE_FIGURE.test(value)) return { ok: false, reason: 'a figure is not a detail on the customer record' };
    const current = customerRecord(file, party).find((e) => e.field === field);
    if (current && current.value.replace(/\s+/g, '').toLowerCase() === value.replace(/\s+/g, '').toLowerCase()) return { ok: false, reason: `their ${field} is already ${current.value}` };
    const fact = recordFact(file, { key: 'change_of_details', value: MASKED_FIELDS.has(field as RecordField) ? field : `${field}: ${value}`, source: { kind: 'thread', turnId: req.turnId }, by: BY }, deps);
    if (!fact.ok) return { ok: false, reason: fact.reason };
    return { ok: true, fact: fact.value, hold: { reason: 'change_of_details', match: `${field} -> ${value}` } };
}

/**
 * A plain match for a customer asking to change a detail on their record: name, phone, email or
 * address. The desk runs the Service specialist on such a turn even when the router did not list
 * service, so a change of details is never answered by a path that cannot record it or hold it for Ben.
 */
export const RE_CHANGE_OF_DETAILS = /\b(?:change|update|amend|correct)\s+(?:my|our)\s+(?:(?:e-?mail|home|postal)\s+)?(?:address|e-?mail|(?:phone |mobile |contact )?number|name|details)\b|\bmy\s+new\s+(?:(?:e-?mail|home|postal)\s+)?(?:address|e-?mail|(?:phone |mobile )?number)\b|\b(?:i|we)(?:'ve| have)\s+moved\s+(?:house|home|address|to\s+\w)/i;

export function asksToChangeDetails(text: string): boolean {
    return RE_CHANGE_OF_DETAILS.test(text);
}

/**
 * A plain match for a customer asking whether we cover their area: "do you cover Nottingham",
 * "which areas do you cover", "how far do you travel". The desk runs the Service specialist on such
 * a turn even when the router did not list service, so the areas-covered answer in the knowledge
 * base is read; it raises no hold and does not stop Scoping running on the job half of a mixed turn.
 * It only adds to the router's reading. A carve-out in the router prompt (option A) can go on top
 * once the comms-v2 router has an eval to catch drift; it should not replace this.
 *
 * "cover" is a trap in this trade ("cover the hole", "does that cover the cost"), so a verb that
 * names a place is trusted only when a place follows it: a postcode, "my area", a capitalised word,
 * or a lone lowercase word that ends the question. Every new phrase wants a negative test beside it.
 */
const RE_AREA_PHRASE = /\b(?:which|what)\s+(?:areas?|parts?|towns?|places?|postcodes?)\s+(?:do|does|can|will)\s+(?:you|u|ya)\b|\bareas?\s+(?:do\s+)?(?:you|u)\s+(?:cover|serve|work)\b|\bareas?\s+covered\b|\b(?:in|within|inside|outside|out\s+of|part\s+of)\s+your\s+(?:local\s+|service\s+|coverage\s+|working\s+)?(?:area|patch|radius|range)\b(?!\s+of\b)|\bhow\s+far\s+(?:out\s+)?(?:do|will|would|can|could)\s+(?:you|u)\s+(?:(?:guys|lot)\s+)?(?:travel|go|come|cover)\b|\btoo\s+far\s+(?:out\s+)?(?:for|from)\s+(?:you|u)\b|\bwhere\s+(?:are\s+you|r\s+u)\s+based\b|\byour\s+(?:area|patch|coverage|radius)\s+(?:includes?|covers?|reach(?:es)?|stretch(?:es)?|extends?)\b|\b(?:somewhere|anywhere)\s+(?:you|u)\s+(?:(?:guys|lot)\s+)?(?:cover|serve)\b|\bare\s+(?:you|u)\s+(?:local\s+to|based\s+(?:in|near|around))\b|\b(?:you|u)\s+(?:(?:guys|lot)\s+)?(?:cover|serve|come|travel|go)\s+(?:out\s+)?(?:that|this)\s+far\b(?!\s+as\b)/i;
const RE_PLACE_VERB = /\b(?:(?:do|does|d'you)\s+(?:(?:you|u|ya)\s+(?:(?:guys|lot|still)\s+)?)?(?:cover|serve|service|work\s+(?:in|around|near)|operate\s+(?:in|around|near)|(?:go|come|travel)\s+(?:out\s+)?(?:to|as\s+far\s+as))|(?:are|r)\s+(?:you|u)\s+(?:(?:guys|lot|still)\s+)?(?:covering|anywhere\s+near)|(?:do|can|could|will|would)\s+(?:you|u)\s+(?:(?:guys|lot)\s+)?do\s+(?:jobs?|work)\s+(?:in|around|near)|(?:can|could|will|would)\s+(?:you|u)\s+(?:(?:guys|lot)\s+)?(?:be\s+able\s+to\s+)?(?:come|travel|go|get)\s+(?:out\s+)?(?:to|as\s+far\s+as)|are\s+(?:you|u)\s+able\s+to\s+(?:cover|(?:come|travel|go|get)\s+(?:out\s+)?(?:to|as\s+far\s+as)))\s+(?:all\s+of\s+|the\s+whole\s+of\s+|most\s+of\s+|out\s+towards?\s+|(?:north|south|east|west|central)\s+)?((?:the\s+)?[a-z][\w'-]*)([^\n]{0,12})/gi;
const RE_POSTCODE = /^[a-z]{1,2}\d[a-z\d]?$/i;
const RE_AREA_NOUN = /^(?:my|our|your|this|that|the)$/i;
const RE_AREA_NOUN_AFTER = /^\s+(?:local\s+)?(?:area|town|village|city|postcode|neighbourhood|part\s+of)\b/i;
// A lone lowercase word is a place only when the question ends on it ("do you cover beeston?", "do you cover beeston too?").
const RE_ENDS_QUESTION = /^\s*(?:[?.!,;]|$|(?:and|or|area|please|at\s+all)\b|(?:as\s+well|too|also)\s*(?:[?.!,;]|$))/i;
/** Words that follow "cover" or "come to" and are not places: money, pronouns, visits, days and months, and the jobs themselves. */
const NOT_A_PLACE = new Set([
    'a', 'an', 'it', 'its', 'these', 'those', 'them', 'me', 'us', 'mine', 'ours', 'yours', 'all', 'any', 'anything', 'everything', 'both', 'some', 'up', 'over', 'out', 'fix', 'do', 'see', 'look', 'have', 'quote', 'give',
    'assess', 'check', 'help', 'measure', 'price', 'estimate', 'inspect', 'survey', 'view', 'value', 'sort',
    'monday', 'mondays', 'tuesday', 'tuesdays', 'wednesday', 'wednesdays', 'thursday', 'thursdays', 'friday', 'fridays', 'saturday', 'saturdays', 'sunday', 'sundays',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'christmas', 'easter',
    'cost', 'costs', 'price', 'prices', 'parts', 'materials', 'labour', 'labor', 'fee', 'fees', 'charge', 'charges', 'callout', 'call-out', 'vat', 'insurance', 'damage', 'damages', 'expenses', 'travel',
    'finished', 'done', 'ready', 'bathrooms', 'kitchens', 'gardens', 'lofts', 'houses', 'flats', 'offices',
    'plumbing', 'electrics', 'electrical', 'leaks', 'leak', 'roofing', 'roofs', 'painting', 'decorating', 'tiling', 'carpentry', 'gardening', 'flooring', 'plastering', 'repairs', 'jobs', 'work', 'emergencies', 'emergency', 'weekends', 'evenings', 'nights', 'holidays', 'gas', 'boilers', 'asbestos',
]);

export function asksAboutOurArea(text: string): boolean {
    if (RE_AREA_PHRASE.test(text)) return true;
    for (const m of Array.from(text.matchAll(RE_PLACE_VERB))) {
        const after = m[2] ?? '';
        // "the NG7 area", "the Beeston area": a place only with the article in front of it.
        const withThe = /^the\s+/i.test(m[1]);
        const place = m[1].replace(/^the\s+/i, '');
        if (RE_POSTCODE.test(place)) return true;
        if (RE_AREA_NOUN.test(place)) { if (RE_AREA_NOUN_AFTER.test(after)) return true; continue; }
        if (NOT_A_PLACE.has(place.toLowerCase())) continue;
        if (withThe) { if (/^[A-Z]/.test(place) && RE_AREA_NOUN_AFTER.test(after)) return true; continue; }
        if (/^[A-Z]/.test(place) || RE_ENDS_QUESTION.test(after)) return true;
    }
    return false;
}

// ---------------------------------------------------------------- convergence

/** Replies that bought nothing the desk may send while scoping before the thread is handed to Ben as not converging. */
export const SCOPING_REPLIES_MAX = 6;

export interface Convergence { converging: boolean; why: string | null; replies: number; jobAsks: number }

/**
 * Scoping that is not converging goes to Ben (checklist 7.1): the desk has asked about the job
 * JOB_ASKS_MAX times and still has no job type, or has sent SCOPING_REPLIES_MAX replies while
 * scoping that the customer's answers put nothing new on the file for, and the file is still not
 * ready. A reply counts only when no customer turn since the reply before it gave the file a new fact
 * (a thread fact or a media description sourced from that turn, not one restating a value already on the file): a customer answering question
 * after question is converging however fast the replies go, and six of those inside a few minutes
 * is what tripped the old count on threads whose address arrived seconds later. A ready file, or
 * one past scoping, always converges, and so does a thread nothing is scoping. A thread is being scoped once a turn is routed to the
 * Scoper, the job has been asked, or the file holds a job detail; the first check that finds it so
 * records the turns then standing on the file (scopingFrom), and only the replies after that count,
 * so a facts-and-aftercare thread that later turns to a job starts its count at the job. Both the
 * asks and the replies are counted since the last release, not for all time, because a thread a
 * human has replied to comes back to automation (checklist 7.4) and must be able to make progress.
 * The ledger itself is untouched by a release, so a subject is still never asked twice.
 */
export function convergence(file: CaseFile, scopingRouted = false): Convergence {
    const beingScoped = scopingRouted || everAsked(file, 'job') || !!file.job.type || !!file.job.location;
    if (beingScoped && file.scopingFrom == null) file.scopingFrom = file.turns.length;
    const last = file.releases[file.releases.length - 1];
    const from = Math.max(last?.turnsBefore ?? 0, file.scopingFrom ?? file.turns.length);
    const replies = stalledReplies(file, from);
    const jobAsks = (ledgerEntry(file, 'job')?.askCount ?? 0) - (last?.asksBefore?.job ?? 0);
    if (isReady(file) || (file.stage !== 'first_contact' && file.stage !== 'scoping')) return { converging: true, why: null, replies, jobAsks };
    if (!file.job.type && jobAsks >= JOB_ASKS_MAX) return { converging: false, why: `asked about the job ${jobAsks} times with no job type on the file`, replies, jobAsks };
    if (beingScoped && replies >= SCOPING_REPLIES_MAX) return { converging: false, why: `${replies} replies while scoping with nothing new from the customer and the file is still not ready (${!file.job.type ? 'no job type' : 'no location'})`, replies, jobAsks };
    return { converging: true, why: null, replies, jobAsks };
}

/** The thread facts that move a job toward ready; a name, a preference or a promise is not scoping progress. */
const SCOPING_PROGRESS_KEYS: ReadonlySet<string> = new Set(['job_type', 'job_detail', 'location']);

/**
 * The desk's replies from turn `from` on that no customer turn since the reply before them gave the
 * file a new fact about the job (SCOPING_PROGRESS_KEYS, or a media description). A fact restating a
 * key and value already on the file is not progress, and nor is a customer's name (the Scoper
 * records it from nearly every turn, the first time often after the party already carries it).
 */
function stalledReplies(file: CaseFile, from: number): number {
    const factTurns = new Set<string>();
    const seen = new Set<string>();
    for (const f of file.facts) {
        const kv = `${f.key}\u0000${f.value.toLowerCase()}`;
        if (seen.has(kv)) continue;
        seen.add(kv);
        if (f.source.kind === 'media_description' || (f.source.kind === 'thread' && SCOPING_PROGRESS_KEYS.has(f.key))) factTurns.add(f.source.turnId);
    }
    let replies = 0;
    let progressed = false;
    for (const t of file.turns.slice(from)) {
        if (t.direction === 'inbound') { if (factTurns.has(t.id)) progressed = true; continue; }
        if (t.kind === 'system') continue;
        if (!progressed) replies++;
        progressed = false;
    }
    return replies;
}
