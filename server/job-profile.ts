// server/job-profile.ts
//
// Compute the canonical JobProfile shape from a tagged personalized_quote.
// Per Module 02 §5: derived, not stored — recomputed on demand from the
// persisted columns on personalized_quotes. Source of truth stays in the
// quote row; no stale-cache class of bugs.
//
// Consumers: Module 05 (routing engine), Module 06 (day-pack solver),
// Module 08 (control tower). Future fields (customer_at_home, pet_present)
// land here first, then in JobTagPanel.
//
// Refs:
// - docs/architecture/modules/02-job-tagging.md §5
// - docs/architecture/adrs/adr-005-real-vs-pricing-time.md (real vs pricing time)

import { db } from './db';
import { personalizedQuotes } from '@shared/schema';
import { eq } from 'drizzle-orm';

// Note on customer_flexibility:
//
// Module 02 §5 says JobProfile.customer_flexibility reads "from flex_tier
// (Module 01)". flex_tier values are 'fast' | 'flexible' | 'relaxed'. To keep
// the JobProfile contract stable for routing consumers (Module 05+) we map
// flex_tier into the same 3-step scale used by the admin-side tag — see
// resolveFlexibility() below.
export type CustomerFlexibility = 'rigid' | 'flexible' | 'very_flexible';

export interface JobProfile {
    quoteId: string;

    // ---- Core tags (from personalized_quotes columns) ----
    crew_size: number;
    skills: string[];
    certs: string[];
    duration_minutes: number;       // pricing time (for EVE)
    real_work_minutes: number;      // ops time per ADR-005
    complexity_flags: string[];
    heavy_lifting: boolean;
    customer_flexibility: CustomerFlexibility;

    // ---- Derived rules ----
    requires_team: boolean;          // crew_size > 1 OR heavy_lifting
    requires_specialist: boolean;    // any cert present
    multi_day_capable: boolean;      // real_work_minutes > a single-day threshold

    // ---- Context for routing ----
    postcode: string | null;
}

// A single working day for one unit/crew, in minutes.
// Used to flag jobs that span more than a day for the day-pack solver.
const SINGLE_DAY_REAL_WORK_MINUTES = 7 * 60;  // 7h on-site execution

const VALID_FLEXIBILITY: CustomerFlexibility[] = ['rigid', 'flexible', 'very_flexible'];

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((x): x is string => typeof x === 'string');
}

function asFlexibility(value: unknown): CustomerFlexibility {
    if (typeof value === 'string' && (VALID_FLEXIBILITY as string[]).includes(value)) {
        return value as CustomerFlexibility;
    }
    // Default: 'flexible' — the neutral middle. Module 01 owns flex_tier on the
    // customer side, separate from this admin-captured field. When tagging
    // hasn't happened, downstream routing falls back to category defaults
    // anyway (per Module 02 §11).
    return 'flexible';
}

/**
 * Compute the JobProfile for a given personalized quote ID.
 *
 * Throws if the quote does not exist. Otherwise resolves derived rules from
 * the persisted tag columns. Sane defaults applied where columns are NULL
 * (legacy quotes pre-Module-02, or quotes saved without tagging).
 */
export async function computeJobProfile(quoteId: string): Promise<JobProfile> {
    const rows = await db
        .select()
        .from(personalizedQuotes)
        .where(eq(personalizedQuotes.id, quoteId))
        .limit(1);

    const quote = rows[0];
    if (!quote) {
        throw new Error(`Quote not found: ${quoteId}`);
    }

    return computeJobProfileFromRow(quote as PersonalizedQuoteRow);
}

// Narrow row shape — only the columns this module reads. Lets us compose with
// callers that already have the row in hand (avoids a redundant SELECT).
export interface PersonalizedQuoteRow {
    id: string;
    crewSizeRequired: number | null;
    skillsRequired: unknown;
    certRequired: unknown;
    durationEstimateMinutes: number | null;
    realWorkMinutes: number | null;
    complexityFlags: unknown;
    heavyLifting: boolean | null;
    flexTier?: string | null;
    postcode?: string | null;
    // The admin-captured customer_flexibility lives in complexity_flags or a
    // dedicated column once data-model lands it. Until then, we read it from
    // a JSON marker; see resolveFlexibility() below.
    [key: string]: unknown;
}

/**
 * Synchronous variant for callers that already have the row.
 * Keeps the derivation rules in one place.
 */
export function computeJobProfileFromRow(row: PersonalizedQuoteRow): JobProfile {
    const crewSize = row.crewSizeRequired ?? 1;
    const skills = asStringArray(row.skillsRequired);
    const certs = asStringArray(row.certRequired);
    const complexityFlags = asStringArray(row.complexityFlags);
    const heavyLifting = Boolean(row.heavyLifting);
    const durationMinutes = row.durationEstimateMinutes ?? 0;
    // Fall back to the customer-facing duration estimate when ops hasn't tagged
    // a `real_work_minutes` value yet. Without this, the day-pack solver
    // collapses every untagged stop to ~0 minutes of work and the 110% pack-value
    // cap becomes the only bound — packs assemble that no contractor can run.
    // ADR-005's spec preference is the (lower) `real_work_minutes`; until ops
    // tagging is universal, the customer estimate is a safer floor than zero.
    const realWorkMinutes = row.realWorkMinutes ?? row.durationEstimateMinutes ?? 0;
    const customerFlexibility = resolveFlexibility(row);

    return {
        quoteId: row.id,
        crew_size: crewSize,
        skills,
        certs,
        duration_minutes: durationMinutes,
        real_work_minutes: realWorkMinutes,
        complexity_flags: complexityFlags,
        heavy_lifting: heavyLifting,
        customer_flexibility: customerFlexibility,

        // Derived
        requires_team: crewSize > 1 || heavyLifting,
        requires_specialist: certs.length > 0,
        multi_day_capable: realWorkMinutes > SINGLE_DAY_REAL_WORK_MINUTES,

        postcode: typeof row.postcode === 'string' ? row.postcode : null,
    };
}

/**
 * Resolve customer flexibility:
 *
 *   1. Prefer flex_tier (Module 01) if set — it's the customer-facing source
 *      of truth, mapped fast→rigid, flexible→flexible, relaxed→very_flexible.
 *   2. Else admin may have stamped a sentinel into complexity_flags.
 *   3. Else default to 'flexible' (the neutral middle).
 */
function resolveFlexibility(row: PersonalizedQuoteRow): CustomerFlexibility {
    if (typeof row.flexTier === 'string') {
        switch (row.flexTier) {
            case 'fast':     return 'rigid';
            case 'flexible': return 'flexible';
            case 'relaxed':  return 'very_flexible';
        }
    }
    const flagsArr = asStringArray(row.complexityFlags);
    for (const tok of flagsArr) {
        if ((VALID_FLEXIBILITY as string[]).includes(tok)) {
            return tok as CustomerFlexibility;
        }
    }
    const direct = (row as Record<string, unknown>).customer_flexibility
        ?? (row as Record<string, unknown>).customerFlexibility;
    return asFlexibility(direct);
}
