import { sql } from 'drizzle-orm';
import * as crypto from 'crypto';

// ============================================================================
// SERVICE PROPERTY identity + resolve-or-create.
//
// A "property" is the physical location where work happens — Jobber's Property,
// sitting between the (derived) client and the job spine. There is no Google
// place_id in our data (all null), so identity is derived from the best
// available address signal. THIS function is the single source of truth for the
// dedupe key — both the historical backfill and the live write paths call it,
// so a quote, its job and its invoice all resolve to the same property row.
//
// Key priority (most stable first):
//   1. place:<id>        — Google Place ID, if we ever populate it
//   2. addr:<norm>       — normalized address text (usually contains postcode)
//   3. geo:<lat,lng>     — coordinates rounded to 4dp (~11m) when no address
//   4. pc:<postcode>     — postcode alone (coarse, last resort)
// Returns null when there's no usable signal (caller leaves property_id null).
// ============================================================================

export interface PropertyIdentityInput {
    placeId?: string | null;
    address?: string | null;
    coordinates?: any; // { lat, lng } | jsonb string | null
    postcode?: string | null;
}

function normStr(s?: string | null): string {
    if (!s) return '';
    return s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,;]+$/g, '');
}

// The DB postcode column is varchar(10). Real UK postcodes are <= 8 chars, but
// source data sometimes dumps a full address (or junk) into the postcode field.
// Extract a clean postcode if one is present, else null — never overflow the col.
function cleanPostcode(s?: string | null): string | null {
    if (!s) return null;
    const up = s.toUpperCase().replace(/\s+/g, ' ').trim();
    const m = up.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/);
    if (m) return m[0].replace(/\s+/g, ' ').slice(0, 10);
    return up.length <= 10 ? up : null;
}

function parseCoords(c: any): { lat: number; lng: number } | null {
    if (!c) return null;
    let obj = c;
    if (typeof c === 'string') {
        try { obj = JSON.parse(c); } catch { return null; }
    }
    const lat = Number(obj?.lat);
    const lng = Number(obj?.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    return null;
}

export function propertyDedupeKey(input: PropertyIdentityInput): string | null {
    const placeId = (input.placeId || '').trim();
    if (placeId) return `place:${placeId}`;
    const addr = normStr(input.address);
    if (addr) return `addr:${addr}`;
    const coords = parseCoords(input.coordinates);
    if (coords) return `geo:${coords.lat.toFixed(4)},${coords.lng.toFixed(4)}`;
    const pc = normStr(input.postcode);
    if (pc) return `pc:${pc}`;
    return null;
}

// --- client key (mirrors server/client-aggregation.ts) ---
export function normPhone(raw?: string | null): string | null {
    if (!raw) return null;
    const digits = raw.replace(/\D/g, '');
    return digits.length > 0 ? digits : null;
}
export function normEmail(raw?: string | null): string | null {
    if (!raw) return null;
    const e = raw.trim().toLowerCase();
    return e.length > 0 ? e : null;
}
export function clientKeyFor(phone?: string | null, email?: string | null): string | null {
    const p = normPhone(phone);
    if (p) return `phone:${p}`;
    const e = normEmail(email);
    if (e) return `email:${e}`;
    return null;
}

export interface ResolvePropertyInput extends PropertyIdentityInput {
    clientKey?: string | null;
    phone?: string | null;
    email?: string | null;
    nickname?: string | null;
}

// Executor is anything with `.execute(sqlChunk)` — the db handle OR a tx.
type Executor = { execute: (q: any) => Promise<any> };

// Resolve an existing property by dedupe key, or create one. Idempotent and
// concurrency-safe (ON CONFLICT on the unique dedupe_key). Enriches a sparse
// existing row with any newly-available address/coords/client. Returns the
// property id, or null when there's no usable address signal.
export async function resolveOrCreateProperty(
    exec: Executor,
    input: ResolvePropertyInput,
): Promise<string | null> {
    const dedupeKey = propertyDedupeKey(input);
    if (!dedupeKey) return null;

    const clientKey = input.clientKey ?? clientKeyFor(input.phone, input.email);
    const id = crypto.randomUUID();
    const coordsJson = input.coordinates
        ? (typeof input.coordinates === 'string' ? input.coordinates : JSON.stringify(input.coordinates))
        : null;

    const res = await exec.execute(sql`
        INSERT INTO service_properties (id, client_key, place_id, dedupe_key, address, postcode, coordinates, nickname)
        VALUES (
            ${id}, ${clientKey ?? null}, ${input.placeId ?? null}, ${dedupeKey},
            ${input.address ?? null}, ${cleanPostcode(input.postcode)},
            ${coordsJson}::jsonb, ${input.nickname ?? null}
        )
        ON CONFLICT (dedupe_key) DO UPDATE SET
            address      = COALESCE(service_properties.address, EXCLUDED.address),
            postcode     = COALESCE(service_properties.postcode, EXCLUDED.postcode),
            coordinates  = COALESCE(service_properties.coordinates, EXCLUDED.coordinates),
            client_key   = COALESCE(service_properties.client_key, EXCLUDED.client_key),
            place_id     = COALESCE(service_properties.place_id, EXCLUDED.place_id),
            updated_at   = now()
        RETURNING id`);

    const rows = (res as any).rows ?? res;
    return rows?.[0]?.id ?? null;
}
