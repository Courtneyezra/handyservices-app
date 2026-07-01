import { db } from './db';
import { eq, inArray } from 'drizzle-orm';
import { leads, personalizedQuotes, conversations } from '../shared/schema';
import { normalizePhoneNumber } from './phone-utils';

// Placeholder names that carry no real identity — treat as "unknown".
const BAD_NAMES = new Set([
    '', 'unknown', 'unknown caller', 'website visitor', 'new lead', 'a customer', 'test caller',
    'voice caller', 'caller', 'sms', 'sms sender', 'whatsapp', 'whatsapp user',
]);

function clean(name?: string | null): string | null {
    const n = name?.trim();
    if (!n || BAD_NAMES.has(n.toLowerCase())) return null;
    return n;
}

/** Convert a phone to UK national form (0…). Self-contained (no WIP deps). */
function toNationalUk(phone?: string | null): string | null {
    if (!phone) return null;
    let d = phone.replace(/\D/g, '');
    if (!d) return null;
    if (d.startsWith('44')) d = d.slice(2);
    else if (d.startsWith('0')) d = d.slice(1);
    // d is now the national significant number (e.g. 7700900123)
    return d.length >= 9 ? `0${d}` : null;
}

/**
 * Look up a caller's saved name by inbound phone number, across leads,
 * conversations, and quotes — in priority order. Phones are stored in different
 * formats per table, so we normalise the inbound number several ways and match
 * against each. Returns null if the number isn't tied to a known record.
 * Never throws — a lookup failure just yields null.
 *
 * Note: the serviceClients spine is intentionally not queried here because it's
 * not yet in the deployed schema; add it once the client-spine work ships.
 */
export async function resolveCallerName(inboundPhone?: string | null): Promise<string | null> {
    if (!inboundPhone) return null;
    try {
        const e164 = normalizePhoneNumber(inboundPhone);   // +44…
        const national = toNationalUk(inboundPhone);        // 0…
        if (!e164 && !national) return null;

        // 1) leads — indexed, most recent inbound contact (E.164)
        if (e164) {
            const [l] = await db.select({ n: leads.customerName })
                .from(leads).where(eq(leads.phone, e164)).limit(1);
            const name = clean(l?.n);
            if (name) return name;
        }

        // 2) conversations — WhatsApp/SMS threads (format varies; try known forms)
        const forms = Array.from(new Set([e164, national, inboundPhone].filter(Boolean))) as string[];
        if (forms.length) {
            const [cv] = await db.select({ n: conversations.contactName })
                .from(conversations).where(inArray(conversations.phoneNumber, forms)).limit(1);
            const name = clean(cv?.n);
            if (name) return name;
        }

        // 3) personalizedQuotes — historical quote activity (E.164)
        if (e164) {
            const [q] = await db.select({ n: personalizedQuotes.customerName })
                .from(personalizedQuotes).where(eq(personalizedQuotes.phone, e164)).limit(1);
            const name = clean(q?.n);
            if (name) return name;
        }

        return null;
    } catch (e) {
        console.warn('[CallerLookup] resolveCallerName failed:', e);
        return null;
    }
}
