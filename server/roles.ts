/**
 * Who is this number? The single role resolver for inbound traffic.
 *
 * One person, two roles, one number is the namespace risk of number-first threading — so every
 * consumer (WhatsApp ingest, the comms ledger, eventually the relay) asks HERE rather than
 * keeping its own list. Contractor numbers come from users.role='contractor', which the
 * /admin/contractors onboarding form maintains: registering a contractor's phone is what flips
 * their inbound from "auto-created customer lead" to the contractor lane.
 *
 * Cached for a minute because ingest runs on hot webhook paths; invalidated explicitly when
 * contractor onboarding writes a phone.
 */
import { db } from './db';
import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';

export type RoleProfile = 'customer' | 'contractor' | 'supplier' | 'internal';

/** Numbers that are "us". */
const INTERNAL_DIGITS = new Set([
    '447449501762', // business WhatsApp sender
    '447508744402', // Ben's personal number
]);

export function digitsOf(phone: string | null | undefined): string {
    const d = (phone ?? '').replace('@c.us', '').replace(/\D/g, '');
    // Normalise UK local format to international: the onboarding form saves "07700...",
    // WhatsApp webhooks deliver "447700..." — they must compare equal.
    if (d.length === 11 && d.startsWith('0')) return `44${d.slice(1)}`;
    return d;
}

let contractorCache: { digits: Set<string>; loadedAt: number } | null = null;
const CACHE_MS = 60_000;

async function loadContractorDigits(): Promise<Set<string>> {
    if (contractorCache && Date.now() - contractorCache.loadedAt < CACHE_MS) return contractorCache.digits;
    const rows = await db.select({ phone: users.phone }).from(users).where(eq(users.role, 'contractor'));
    const digits = new Set(rows.map((r) => digitsOf(r.phone)).filter(Boolean));
    contractorCache = { digits, loadedAt: Date.now() };
    return digits;
}

/** Call after contractor onboarding writes/changes a phone, so the next inbound sees it. */
export function invalidateRoleCache(): void {
    contractorCache = null;
}

export async function resolveRole(phone: string | null | undefined): Promise<RoleProfile> {
    const d = digitsOf(phone);
    if (!d) return 'customer';
    if (INTERNAL_DIGITS.has(d)) return 'internal';
    try {
        if ((await loadContractorDigits()).has(d)) return 'contractor';
    } catch (error: any) {
        // A resolver outage must never break ingest — default to customer, loudly.
        console.error('[Roles] contractor lookup failed, defaulting to customer:', error?.message);
    }
    return 'customer';
}
