/**
 * Handy Desk - one person's full record, read only (ask-agent specification N4, answer 115 "Read-only
 * full record").
 *
 * `clientRecord` reads a settled person (people.ts) and builds the client card: name, company, the
 * last three digits of the phone, whether an email address and a postal address are on file (never
 * the values: answers 46 and 47), their properties by outward postcode, the open case file on the
 * board, and the record `getCustomerDossier` (server/customer-dossier.ts) gathers by phone: leads,
 * quotes, jobs, invoices and calls. The same view is the tool's result and the card's data, so the
 * model sees nothing the card does not.
 *
 * Figures are shown and never changed (answer A8, "Show, read-only"): a quote's price, an invoice's
 * total and balance, what is owed. No tool here writes; every change is a proposal (actions.ts).
 */
import type {
    CaseStage, ClientRecordCall, ClientRecordInvoice, ClientRecordJob, ClientRecordLead, ClientRecordQuote, ClientSurface,
} from '@shared/ops-types';
import type { CustomerDossier } from '../../customer-dossier';
import type { CaseFile } from '../desk/case-file';
import { customerOf } from './surface';
import {
    fileOfPerson, outwardPostcode, parsePersonRef, phoneOfFile, type PeopleDirectory, type PersonKind, type PropertyBrief,
} from './people';

/** Rows of each kind the card lists; the counts say how many there are in all. */
export const RECORD_LIST_CAP = 5;

export type DossierReader = (phone: string) => Promise<CustomerDossier>;

export const databaseDossier: DossierReader = async (phone) => (await import('../../customer-dossier')).getCustomerDossier(phone);

export interface ClientRecordDeps {
    people: PeopleDirectory;
    dossier: DossierReader;
    files: CaseFile[];
    now: Date;
}

export type ClientRecordResult = { ok: true; card: ClientSurface } | { ok: false; reason: string };

const tailOf = (phone: string | null): string | null => {
    const d = (phone ?? '').replace(/\D/g, '');
    return d.length >= 3 ? d.slice(-3) : null;
};

/** The London calendar day, YYYY-MM-DD. */
const londonDay = (at: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

const GONE_JOB = new Set(['cancelled', 'declined', 'completed']);
const GONE_DAY = new Set(['completed', 'cancelled_day_of']);

/** The earliest job still to happen, on or after today. */
export function nextBookingOf(jobs: ClientRecordJob[], now: Date): ClientRecordJob | null {
    const today = londonDay(now);
    return jobs
        .filter((j) => !!j.scheduledDate && j.scheduledDate.slice(0, 10) >= today && !GONE_JOB.has(j.status) && !GONE_DAY.has(j.dayOfStatus ?? ''))
        .sort((a, b) => a.scheduledDate!.localeCompare(b.scheduledDate!))[0] ?? null;
}

interface Basics {
    kind: PersonKind;
    name: string | null;
    phone: string | null;
    clientId: string | null;
    company: string | null;
    emailOnFile: boolean;
    addressOnFile: boolean;
    file: CaseFile | null;
    properties: PropertyBrief[];
    /** The ref the record is under, when it is not the one asked for. */
    ref?: string;
}

async function basicsOf(ref: string, deps: ClientRecordDeps): Promise<Basics | null> {
    const parsed = parsePersonRef(ref);
    if (!parsed) return null;
    if (parsed.kind === 'case_file') {
        const file = deps.files.find((f) => f.id === parsed.id);
        const party = file ? customerOf(file) : null;
        if (!file || !party) return null;
        // A turn that proved the customer's CRM client (answer 126) makes the record that client's.
        const clientId = file.turns.find((t) => t.customerId)?.customerId ?? null;
        const row = clientId ? await deps.people.get('client', clientId) : null;
        if (row) {
            return {
                kind: 'client', name: row.name, phone: row.phone, clientId: row.clientId, company: row.company,
                emailOnFile: row.emailOnFile, addressOnFile: row.addressOnFile, file,
                properties: await deps.people.properties('client', row.id), ref: `client:${row.id}`,
            };
        }
        const area = outwardPostcode(file.job.location);
        return {
            kind: 'case_file', name: party.name, phone: phoneOfFile(file), clientId: null, company: null,
            emailOnFile: party.channels.some((c) => c.kind === 'email'), addressOnFile: false, file,
            properties: area ? [{ id: `case_file:${file.id}`, source: 'service', role: 'client', outwardPostcode: area, active: true }] : [],
        };
    }
    const row = await deps.people.get(parsed.kind, parsed.id);
    if (!row) return null;
    return {
        kind: row.kind, name: row.name, phone: row.phone, clientId: row.clientId, company: row.company,
        emailOnFile: row.emailOnFile, addressOnFile: row.addressOnFile,
        file: fileOfPerson(deps.files, row),
        properties: await deps.people.properties(row.kind, row.id),
    };
}

/** The client card for a person ref: the full record, read only, with email and address only "on file". */
export async function clientRecord(ref: string, deps: ClientRecordDeps): Promise<ClientRecordResult> {
    const b = await basicsOf(ref, deps);
    if (!b) return { ok: false, reason: 'no such person' };
    const d = b.phone ? await deps.dossier(b.phone) : null;

    const quotes: ClientRecordQuote[] = (d?.quotes ?? []).map((q) => ({
        id: q.id, slug: q.shortSlug, status: q.status, pricePence: q.pricePence, summary: q.job, createdAt: q.createdAt, viewedAt: q.viewedAt,
    }));
    const jobs: ClientRecordJob[] = (d?.jobs ?? []).map((j) => ({
        id: j.id, quoteId: j.quoteId, status: j.status, dayOfStatus: j.dayOfStatus, scheduledDate: j.scheduledDate, completedAt: j.completedAt, summary: j.description,
    }));
    const invoices: ClientRecordInvoice[] = (d?.invoices ?? []).map((i) => ({
        id: i.id, number: i.invoiceNumber, status: i.status, totalPence: i.totalPence, balanceDuePence: i.balanceDuePence, dueDate: i.dueDate, paidAt: i.paidAt,
    }));
    const calls: ClientRecordCall[] = (d?.calls ?? []).map((c) => ({
        id: c.id, direction: c.direction, outcome: c.outcome, startTime: c.startTime, summary: c.jobSummary,
    }));
    const leads: ClientRecordLead[] = (d?.leads ?? []).map((l) => ({
        id: l.id, status: l.status, stage: l.stage, summary: l.job, createdAt: l.createdAt,
    }));

    const card: ClientSurface = {
        type: 'client',
        id: b.ref ?? ref,
        kind: b.kind,
        name: b.name ?? d?.name ?? null,
        company: b.company,
        phoneTail: tailOf(b.phone),
        emailOnFile: b.emailOnFile,
        addressOnFile: b.addressOnFile,
        properties: b.properties.map((p) => ({ id: p.id, outwardPostcode: p.outwardPostcode, role: p.role, active: p.active })),
        caseFile: b.file ? { id: b.file.id, stage: b.file.stage as CaseStage, held: !!b.file.hold } : null,
        lastQuote: quotes[0] ?? null,
        nextBooking: nextBookingOf(jobs, deps.now),
        owedPence: d?.summary.openBalancePence ?? 0,
        liveQuotes: d?.summary.liveQuotes ?? 0,
        counts: {
            leads: d?.summary.counts.leads ?? 0,
            quotes: d?.summary.counts.quotes ?? 0,
            jobs: d?.summary.counts.jobs ?? 0,
            invoices: d?.summary.counts.invoices ?? 0,
            calls: d?.summary.counts.calls ?? 0,
        },
        quotes: quotes.slice(0, RECORD_LIST_CAP),
        jobs: jobs.slice(0, RECORD_LIST_CAP),
        invoices: invoices.slice(0, RECORD_LIST_CAP),
        calls: calls.slice(0, RECORD_LIST_CAP),
        leads: leads.slice(0, RECORD_LIST_CAP),
        ...(b.phone ? {} : { note: 'No phone number is on file, so quotes, jobs, invoices and calls could not be read.' }),
    };
    return { ok: true, card };
}
