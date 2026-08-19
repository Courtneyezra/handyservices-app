/**
 * "Is this number a customer, or one of ours?"
 *
 * Ben's phone does not only ring customers. From the same Groundwire handset he rings suppliers,
 * merchants, contractors, his own team and the office. Every one of those is a legitimate call and
 * none of them is a customer relationship, so none of them belongs on the comms board — a board the
 * owner is currently cutting from 1,228 cards down to a working set.
 *
 * This module answers only the narrow question the outbound-call gate needs: is there a POSITIVE
 * reason to believe this number is not a customer? Silence (null) means "no reason found", never
 * "confirmed customer". The caller decides what to do with that.
 *
 * Two kinds of evidence, deliberately kept apart:
 *
 *   SHAPE      — decidable from the digits alone, no database, no failure mode. UK non-geographic
 *                service ranges (0800/0808 freephone, 03xx, 084x/087x, 09xx premium) cannot be a
 *                residential customer's line; they are companies by definition. Plus our own
 *                numbers, which we must never open a card about.
 *   DIRECTORY  — who we have on file as staff or contractor. Needs the DB and may be incomplete.
 *
 * ⚠️ The directory half is currently near-empty, and that is a finding rather than a bug in this
 * file. Measured 19 Aug 2026: `users.phone` holds ONE row (a disabled test contractor on an Ofcom
 * number), `handyman_profiles.whatsapp_number` holds none, and `contractor_job_links` holds the
 * only eight real contractor numbers in the system. Zero of the 148 calls Ben made from Groundwire
 * in the preceding 110 days went to any of them — consistent with contractors being handled from
 * his personal phone and through the contractor app. So this check is a FORWARD GUARD: it costs
 * nothing today and starts earning the moment contractor numbers get filled in. Do not delete it
 * because it matches nothing yet, and do not assume it is protecting you.
 */
import { db } from './db';
import { users, handymanProfiles, contractorJobLinks } from '@shared/schema';
import { isNotNull, ne, and, inArray } from 'drizzle-orm';
import { commsPhoneKey, normalizePhoneNumber } from './phone-utils';

export type NonCustomerReason = {
    /** Machine-readable, ends up in the ingest audit trail. */
    code: 'OWN_NUMBER' | 'SERVICE_NUMBER' | 'INTERNAL_STAFF' | 'INTERNAL_CONTRACTOR';
    /** Human-readable, for the log line that explains a missing card. */
    detail: string;
};

/**
 * Numbers that belong to the business itself.
 *
 * The two literals are the WhatsApp/voice sender (+447449501762) and the second Twilio line
 * (+447700100917 — note this is NOT in the Ofcom 07700 900xxx test range, so nothing else catches
 * it). The env vars cover whatever else is configured on the account without needing a code change.
 */
function ownNumberKeys(): Set<string> {
    const raw = [
        '+447449501762',
        '+447700100917',
        process.env.TWILIO_PHONE_NUMBER,
        process.env.TWILIO_SMS_NUMBER,
        process.env.TWILIO_WHATSAPP_NUMBER,
    ];
    const keys = new Set<string>();
    for (const n of raw) {
        const k = commsPhoneKey((n ?? '').replace(/^whatsapp:/, ''));
        if (k) keys.add(k);
    }
    return keys;
}

/**
 * UK ranges that no customer can be reached on.
 *
 * Keyed on the national form (leading 0 stripped by commsPhoneKey), so 0800 1937191 reads as
 * "8001937191". Only ranges that are non-geographic BY ALLOCATION are listed:
 *
 *   0800 / 0808  freephone           — an organisation pays for the call; individuals cannot hold one
 *   03xx         non-geographic      — businesses, charities, public bodies
 *   084x / 087x  revenue share       — service lines
 *   09xx         premium rate        — service lines
 *
 * Deliberately NOT here: geographic landlines. Ben rings a Nottingham 0115 supplier and a
 * Nottingham 0115 customer, and nothing in the digits tells them apart. And NOT 05x (corporate/VoIP)
 * or 070 (personal numbering), which are ambiguous enough that a wrong exclusion would lose a real
 * customer silently, which is the worse error here.
 */
const SERVICE_RANGES: { re: RegExp; label: string }[] = [
    { re: /^80[08]/, label: 'freephone (0800/0808)' },
    { re: /^3\d\d/, label: 'non-geographic (03xx)' },
    { re: /^8[47]\d/, label: 'revenue-share (084x/087x)' },
    { re: /^9\d\d/, label: 'premium rate (09xx)' },
];

/**
 * The half of the check that needs nothing but the digits.
 *
 * Separate from the DB half so the outbound gate still refuses our own numbers and obvious service
 * lines even if the database is unreachable, and so it can be unit-tested without a connection.
 */
export function nonCustomerByShape(phone: string | null | undefined): NonCustomerReason | null {
    const key = commsPhoneKey(phone);
    if (!key) return null;

    if (ownNumberKeys().has(key)) {
        return { code: 'OWN_NUMBER', detail: 'one of the business\'s own numbers' };
    }

    // Range rules are UK allocations, so they only mean anything for a UK number.
    const e164 = normalizePhoneNumber(phone);
    if (e164?.startsWith('+44')) {
        for (const r of SERVICE_RANGES) {
            if (r.re.test(key)) return { code: 'SERVICE_NUMBER', detail: r.label };
        }
    }
    return null;
}

/** Roles that are us, not a customer. 'handyman' is the legacy spelling of 'contractor'. */
const INTERNAL_ROLES = ['contractor', 'va', 'admin', 'handyman'];

/**
 * Every number we hold for someone on our own side, as comms keys.
 *
 * Three sources because the truth is spread across three: `users.phone` for staff and logins,
 * `handyman_profiles.whatsapp_number` for the profile override, and
 * `contractor_job_links.contractor_phone` — which is the only one with real data in it, because
 * that is the table the dispatch links are minted against.
 *
 * Read fresh on every call rather than cached. Outbound calls run at roughly 1.4 a day, the three
 * tables are tens of rows, and a stale cache that lets a contractor's call open a customer card is
 * a worse trade than three small selects.
 */
async function internalDirectory(): Promise<Map<string, NonCustomerReason>> {
    const out = new Map<string, NonCustomerReason>();

    const staff = await db.select({ phone: users.phone, role: users.role, first: users.firstName, last: users.lastName })
        .from(users)
        .where(and(inArray(users.role, INTERNAL_ROLES), isNotNull(users.phone), ne(users.phone, '')));
    for (const s of staff) {
        const k = commsPhoneKey(s.phone);
        if (!k) continue;
        const name = [s.first, s.last].filter(Boolean).join(' ').trim();
        out.set(k, {
            code: s.role === 'contractor' || s.role === 'handyman' ? 'INTERNAL_CONTRACTOR' : 'INTERNAL_STAFF',
            detail: `users.${s.role}${name ? ` (${name})` : ''}`,
        });
    }

    const profiles = await db.select({ phone: handymanProfiles.whatsappNumber, id: handymanProfiles.id })
        .from(handymanProfiles)
        .where(and(isNotNull(handymanProfiles.whatsappNumber), ne(handymanProfiles.whatsappNumber, '')));
    for (const p of profiles) {
        const k = commsPhoneKey(p.phone);
        if (k && !out.has(k)) out.set(k, { code: 'INTERNAL_CONTRACTOR', detail: 'handyman_profiles.whatsapp_number' });
    }

    const links = await db.selectDistinct({ phone: contractorJobLinks.contractorPhone })
        .from(contractorJobLinks)
        .where(and(isNotNull(contractorJobLinks.contractorPhone), ne(contractorJobLinks.contractorPhone, '')));
    for (const l of links) {
        const k = commsPhoneKey(l.phone);
        if (k && !out.has(k)) out.set(k, { code: 'INTERNAL_CONTRACTOR', detail: 'contractor_job_links.contractor_phone' });
    }

    return out;
}

/**
 * Full check: shape first (free, never fails), then the directory.
 *
 * Never throws. A database wobble must not be able to break call ingest, and the honest answer when
 * we cannot read the directory is "no positive reason found" — the same answer as for a genuine
 * customer. That fails towards creating a card, which is recoverable by hand; failing the other way
 * would lose the record of a real conversation, which is not.
 */
export async function classifyNonCustomerNumber(phone: string | null | undefined): Promise<NonCustomerReason | null> {
    const byShape = nonCustomerByShape(phone);
    if (byShape) return byShape;

    const key = commsPhoneKey(phone);
    if (!key) return null;

    try {
        return (await internalDirectory()).get(key) ?? null;
    } catch (error: any) {
        console.warn('[InternalNumbers] Directory lookup failed, treating as unknown:', error?.message ?? error);
        return null;
    }
}
