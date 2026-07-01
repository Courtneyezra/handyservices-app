import { sql } from 'drizzle-orm';
import * as crypto from 'crypto';

// ============================================================================
// SERVICE CLIENT identity + resolve-or-create.
//
// A "client" is WHO pays / is billed (Jobber's Client) — the owner of one or
// more service_properties. There is no reliable account id in our data, so
// identity is derived from the best contact signal, phone preferred.
//
// THIS function is the single source of truth for the client dedupe key — the
// historical backfill AND the live write paths call it, so a lead, its quote,
// its job and its invoice all resolve to the same client row.
//
// UK PHONE CANONICALIZATION is the important bit. The old read-time heuristic
// keyed on raw digits, so "07766 223994", "7766223994" (leading 0 stripped by a
// source) and "+44 7766 223994" became THREE different clients. We canonicalize
// every UK number to the national "0XXXXXXXXXX" form before keying, collapsing
// those back into one client.
//   1. phone:<canonical>   — preferred
//   2. email:<lower>       — fallback
// Returns null when there's no usable contact signal.
// ============================================================================

// Canonicalize a UK phone number to national format: 11 digits starting "07"
// for mobiles (or "0" + area for landlines). Handles +44 / 0044 / missing-zero.
export function canonicalUkPhone(raw?: string | null): string | null {
    if (!raw) return null;
    let d = raw.replace(/\D/g, '');
    if (!d) return null;
    // International prefixes → national
    if (d.startsWith('0044')) d = d.slice(4);
    else if (d.startsWith('44') && d.length >= 11) d = d.slice(2);
    // A UK national number without its leading 0 (e.g. "7766223994") → add it.
    if (d.length === 10 && d.startsWith('7')) d = '0' + d;
    // Already national with leading 0 — keep as-is.
    // Anything else (short codes, foreign) — return the digits we have.
    return d.length > 0 ? d : null;
}

export function normEmail(raw?: string | null): string | null {
    if (!raw) return null;
    const e = raw.trim().toLowerCase();
    return e.length > 0 ? e : null;
}

export interface ClientIdentityInput {
    phone?: string | null;
    email?: string | null;
}

export function clientDedupeKey(input: ClientIdentityInput): string | null {
    const p = canonicalUkPhone(input.phone);
    if (p) return `phone:${p}`;
    const e = normEmail(input.email);
    if (e) return `email:${e}`;
    return null;
}

export interface ResolveClientInput extends ClientIdentityInput {
    displayName?: string | null;
    billingAddress?: string | null;
}

type Executor = { execute: (q: any) => Promise<any> };

// Resolve an existing client by dedupe key, or create one. Idempotent and
// concurrency-safe (ON CONFLICT on the unique dedupe_key). Enriches a sparse
// existing row with any newly-available name/phone/email. Returns the client
// id, or null when there's no usable contact signal.
export async function resolveOrCreateClient(
    exec: Executor,
    input: ResolveClientInput,
): Promise<string | null> {
    const dedupeKey = clientDedupeKey(input);
    if (!dedupeKey) return null;

    const id = crypto.randomUUID();
    const canonPhone = canonicalUkPhone(input.phone);
    const email = normEmail(input.email);
    const name = input.displayName?.trim() || null;
    const phonesJson = canonPhone ? JSON.stringify([canonPhone]) : null;
    const emailsJson = email ? JSON.stringify([email]) : null;

    const res = await exec.execute(sql`
        INSERT INTO service_clients (id, dedupe_key, display_name, primary_phone, primary_email, phones, emails, billing_address)
        VALUES (
            ${id}, ${dedupeKey}, ${name}, ${canonPhone}, ${email},
            ${phonesJson}::jsonb, ${emailsJson}::jsonb, ${input.billingAddress ?? null}
        )
        ON CONFLICT (dedupe_key) DO UPDATE SET
            display_name    = COALESCE(service_clients.display_name, EXCLUDED.display_name),
            primary_phone   = COALESCE(service_clients.primary_phone, EXCLUDED.primary_phone),
            primary_email   = COALESCE(service_clients.primary_email, EXCLUDED.primary_email),
            billing_address = COALESCE(service_clients.billing_address, EXCLUDED.billing_address),
            updated_at      = now()
        RETURNING id`);

    const rows = (res as any).rows ?? res;
    return rows?.[0]?.id ?? null;
}
