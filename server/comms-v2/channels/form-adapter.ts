/**
 * The web form adapter. Name, phone, email, the job, sometimes photos. It creates the case file
 * and has no reply path of its own, so the first reply opens a real channel: WhatsApp if the
 * number is on it, else SMS, else email (Contract 5, choose_channel).
 *
 * The form is Identity's join: it is the one channel that gives a phone and an email together,
 * so both go on the envelope as hints and the gateway links them as one person. The postcode is
 * recorded as a fact at intake with the form turn as its source; the job type is the Scoping
 * specialist's to establish from the words. Photos arrive as bytes and are written where the
 * WhatsApp adapter writes inbound media, so describe_media reads them the same way.
 */
import { e164FromWhatsApp } from '../desk/whatsapp-adapter';
import { canonical } from '../desk/identity';
import { parseLocation } from '../desk/lexicon';
import type { InboundEnvelope, IntakeFact } from './envelope';
import { isRefused, writeInboundMedia, type MediaWriteDeps } from './media';

export interface WebFormLead {
    customerName?: string | null;
    phone?: string | null;
    email?: string | null;
    jobDescription?: string | null;
    postcode?: string | null;
    address?: string | null;
    source?: string | null;
    photos?: Array<{ contentBase64?: string | null; mime?: string | null }>;
    at?: string | null;
    leadId?: string | null;
}

export interface FormAdapterDeps extends MediaWriteDeps { now?: () => Date }

/** One envelope from a form submission. Refuses a form with neither a phone nor an email: nothing could ever reply. */
export async function fromWebForm(lead: WebFormLead, deps: FormAdapterDeps = {}): Promise<InboundEnvelope> {
    const now = deps.now ?? (() => new Date());
    const phone = e164FromWhatsApp(lead.phone);
    const emailKey = canonical(lead.email);
    const email = emailKey?.startsWith('email:') ? emailKey.slice('email:'.length) : null;
    if (!phone && !email) throw new Error('web form without a phone or an email; nothing could carry a reply');
    const job = (lead.jobDescription ?? '').trim();
    const facts: IntakeFact[] = [];
    const name = (lead.customerName ?? '').trim() || null;
    if (name) facts.push({ key: 'customer_name', value: name });
    const loc = parseLocation(`${lead.postcode ?? ''} ${lead.address ?? ''}`.trim());
    if (loc.postcode) facts.push({ key: 'location', value: loc.postcode });
    else if (loc.outward) facts.push({ key: 'location', value: loc.outward });
    else if ((lead.postcode ?? '').trim()) facts.push({ key: 'location', value: (lead.postcode ?? '').trim().slice(0, 60) });
    if ((lead.source ?? '').trim()) facts.push({ key: 'form_source', value: (lead.source ?? '').trim().slice(0, 60) });
    const reach: InboundEnvelope['reach'] = [];
    if (phone) reach.push({ kind: 'sms', address: phone });
    if (email) reach.push({ kind: 'email', address: email });
    const turn: InboundEnvelope = {
        channel: 'form', address: phone ?? email!, name, text: job || 'No description provided', media: [], at: lead.at ?? now().toISOString(),
        providerMessageId: lead.leadId ?? null, via: 'webform', mediaFailures: [], kind: 'form', hints: { email, phone, postcode: lead.postcode ?? null }, reach, facts,
    };
    for (const p of lead.photos ?? []) {
        const bytes = p.contentBase64 ? Buffer.from(p.contentBase64, 'base64') : null;
        if (!bytes) { turn.mediaFailures.push({ ref: '(photo)', reason: 'photo with no content' }); continue; }
        const m = writeInboundMedia(bytes, p.mime || 'image/jpeg', deps);
        if (isRefused(m)) turn.mediaFailures.push({ ref: '(photo)', reason: m.refused });
        else turn.media.push(m);
    }
    return turn;
}

export interface DoorForm { name?: string | null; phone?: string | null; email?: string | null; job: string; postcode?: string | null; at?: string; media?: Array<{ bytes: Buffer; mime: string }> }

/** The sandbox door's form: the same envelope, the bytes handed over directly. */
export async function fromDoorForm(input: DoorForm, deps: FormAdapterDeps = {}): Promise<InboundEnvelope> {
    const env = await fromWebForm({ customerName: input.name, phone: input.phone, email: input.email, jobDescription: input.job, postcode: input.postcode, source: 'sandbox', at: input.at }, deps);
    env.via = 'door';
    for (const m of input.media ?? []) {
        const w = writeInboundMedia(m.bytes, m.mime, deps);
        if (isRefused(w)) env.mediaFailures.push({ ref: m.mime, reason: w.refused });
        else env.media.push(w);
    }
    return env;
}
