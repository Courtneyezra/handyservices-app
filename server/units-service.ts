// server/units-service.ts
//
// CRUD service layer for the Unit Bench (Module 03).
//
// A "Unit" is the routing-language re-label of a `handyman_profiles` row,
// extended with the segment / geography / capability / economics fields
// added in Phase 0 (data-model.md §2). This module owns reads and writes
// on those new columns plus the segment-change guards from ADR-003.
//
// Public surface:
//   - listUnits()             — filterable list, used by admin UI
//   - getUnit()               — single row with skills/user joined
//   - createUnit()            — minimal create (delegates user creation)
//   - updateUnit()            — partial update with segment-change guards
//   - softDeleteUnit()        — sets availabilityStatus='inactive' (no
//                               deleted_at column exists yet — matches the
//                               existing admin-contractors-routes pattern)
//   - findEligibleUnits()     — basic skills/area/cert/min-job-value filter
//                               (full ranking ships with Module 05)
//   - backfillSegments()      — idempotent default of contractor_segment
//
// Re-segmentation guards (per Module 03 §6):
//   - Builder → Gap-Filler / Specialist:
//       blocked when the unit has any day_commitments row in
//       ('open','assembling','offered','accepted').
//   - Specialist → other:
//       blocked when the unit has any pending routing_offers row.
//   - Any → Specialist:
//       requires verificationStatus='verified' on the unit.
//
// All flag awareness lives at the route layer; this module is pure data.

import { db } from './db';
import {
    users,
    handymanProfiles,
    dayCommitments,
    routingOffers,
    routingDecisions,
} from '../shared/schema';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcrypt';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContractorSegment = 'builder' | 'gap_filler' | 'specialist';
export type UnitType = 'single' | 'team';

export interface UnitListFilters {
    segment?: ContractorSegment;
    area?: string;          // postcode prefix match against area_catchment OR home_postcode
    skill?: string;         // single skill slug
    search?: string;        // free text on name / business / email
    includeInactive?: boolean;
    limit?: number;
    offset?: number;
}

export interface UnitCreateInput {
    // user identity (required)
    firstName: string;
    lastName: string;
    email: string;
    phone?: string | null;
    password?: string | null;
    // profile
    businessName?: string | null;
    bio?: string | null;
    homePostcode?: string | null;
    profileImageUrl?: string | null;
    // unit-bench fields
    contractorSegment?: ContractorSegment | null;
    unitType?: UnitType;
    crewMax?: number;
    areaCatchment?: string[];
    skills?: string[];
    acceptsSkus?: string[] | null;
    certs?: string[];
    minJobValuePence?: number | null;
    dayRateTargetPence?: number | null;
}

export interface UnitUpdateInput {
    // user fields
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string | null;
    // profile
    businessName?: string | null;
    bio?: string | null;
    homePostcode?: string | null;
    profileImageUrl?: string | null;
    // unit-bench fields
    contractorSegment?: ContractorSegment;
    unitType?: UnitType;
    crewMax?: number;
    areaCatchment?: string[];
    skills?: string[];
    acceptsSkus?: string[] | null;
    certs?: string[];
    minJobValuePence?: number | null;
    dayRateTargetPence?: number | null;
}

export interface JobProfile {
    skillsRequired?: string[];           // any-match unless skuId provided
    skuId?: string | null;               // when set, accepts_skus allow-list checked
    certRequired?: string | null;        // 'gas_safe' | 'niceic' | 'part_p' | 'structural'
    crewSizeRequired?: number;
    minJobValuePence?: number;
}

// Errors raised by the service. Routes inspect `.code` to map to HTTP status.
export class UnitServiceError extends Error {
    code:
        | 'NOT_FOUND'
        | 'DUPLICATE'
        | 'INVALID_INPUT'
        | 'SEGMENT_LOCKED_BY_COMMITMENTS'
        | 'SEGMENT_LOCKED_BY_OFFERS'
        | 'SPECIALIST_REQUIRES_VERIFIED';
    details?: any;
    constructor(code: UnitServiceError['code'], message: string, details?: any) {
        super(message);
        this.code = code;
        this.details = details;
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_SEGMENTS: ContractorSegment[] = ['builder', 'gap_filler', 'specialist'];

function validateSegment(seg: any): asserts seg is ContractorSegment {
    if (!VALID_SEGMENTS.includes(seg)) {
        throw new UnitServiceError('INVALID_INPUT', `invalid contractor_segment: ${seg}`);
    }
}

function arr(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    return input.filter((x): x is string => typeof x === 'string');
}

// Shape DB → API. Centralised so list and get agree.
function shapeUnit(row: any) {
    return {
        id: row.id,
        userId: row.userId,
        firstName: row.firstName ?? null,
        lastName: row.lastName ?? null,
        email: row.email ?? null,
        phone: row.phone ?? null,
        businessName: row.businessName ?? null,
        bio: row.bio ?? null,
        profileImageUrl: row.profileImageUrl ?? null,
        homePostcode: row.homePostcode ?? null,
        // segment / capabilities
        contractorSegment: row.contractorSegment ?? null,
        unitType: row.unitType ?? 'single',
        crewMax: row.crewMax ?? 1,
        areaCatchment: arr(row.areaCatchment),
        skills: arr(row.skills),
        acceptsSkus: row.acceptsSkus == null ? null : arr(row.acceptsSkus),
        certs: arr(row.certs),
        minJobValuePence: row.minJobValuePence ?? null,
        dayRateTargetPence: row.dayRateTargetPence ?? null,
        // performance
        reliabilityScore: row.reliabilityScore == null ? null : Number(row.reliabilityScore),
        priorityRoutingScore: row.priorityRoutingScore == null ? null : Number(row.priorityRoutingScore),
        verificationStatus: row.verificationStatus ?? 'unverified',
        availabilityStatus: row.availabilityStatus ?? 'available',
        lastAssignedAt: row.lastAssignedAt ?? null,
        createdAt: row.createdAt ?? null,
        updatedAt: row.updatedAt ?? null,
    };
}

// ---------------------------------------------------------------------------
// listUnits
// ---------------------------------------------------------------------------

export async function listUnits(filters: UnitListFilters = {}) {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);

    const conditions: any[] = [];
    if (filters.segment) {
        validateSegment(filters.segment);
        conditions.push(eq(handymanProfiles.contractorSegment, filters.segment));
    }
    if (!filters.includeInactive) {
        // Soft-delete pattern: availabilityStatus='inactive' is hidden.
        conditions.push(sql`coalesce(${handymanProfiles.availabilityStatus}, 'available') <> 'inactive'`);
    }
    if (filters.area) {
        const areaUpper = filters.area.toUpperCase();
        // Match home_postcode prefix OR membership in area_catchment jsonb.
        conditions.push(or(
            sql`upper(${handymanProfiles.homePostcode}) LIKE ${areaUpper + '%'}`,
            sql`${handymanProfiles.areaCatchment} @> ${JSON.stringify([areaUpper])}::jsonb`,
        ));
    }
    if (filters.skill) {
        conditions.push(sql`${handymanProfiles.skills} @> ${JSON.stringify([filters.skill])}::jsonb`);
    }
    if (filters.search) {
        const q = `%${filters.search.toLowerCase()}%`;
        conditions.push(or(
            sql`lower(${users.firstName}) LIKE ${q}`,
            sql`lower(${users.lastName}) LIKE ${q}`,
            sql`lower(${users.email}) LIKE ${q}`,
            sql`lower(coalesce(${handymanProfiles.businessName}, '')) LIKE ${q}`,
        ));
    }

    const whereClause = conditions.length ? and(...conditions) : undefined;

    const rows = await db
        .select({
            id: handymanProfiles.id,
            userId: handymanProfiles.userId,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            phone: users.phone,
            businessName: handymanProfiles.businessName,
            bio: handymanProfiles.bio,
            profileImageUrl: handymanProfiles.profileImageUrl,
            homePostcode: handymanProfiles.homePostcode,
            contractorSegment: handymanProfiles.contractorSegment,
            unitType: handymanProfiles.unitType,
            crewMax: handymanProfiles.crewMax,
            areaCatchment: handymanProfiles.areaCatchment,
            skills: handymanProfiles.skills,
            acceptsSkus: handymanProfiles.acceptsSkus,
            certs: handymanProfiles.certs,
            minJobValuePence: handymanProfiles.minJobValuePence,
            dayRateTargetPence: handymanProfiles.dayRateTargetPence,
            reliabilityScore: handymanProfiles.reliabilityScore,
            priorityRoutingScore: handymanProfiles.priorityRoutingScore,
            verificationStatus: handymanProfiles.verificationStatus,
            availabilityStatus: handymanProfiles.availabilityStatus,
            lastAssignedAt: handymanProfiles.lastAssignedAt,
            createdAt: handymanProfiles.createdAt,
            updatedAt: handymanProfiles.updatedAt,
        })
        .from(handymanProfiles)
        .innerJoin(users, eq(handymanProfiles.userId, users.id))
        .where(whereClause)
        .orderBy(desc(sql`coalesce(${handymanProfiles.reliabilityScore}, 0)`), asc(handymanProfiles.id))
        .limit(limit)
        .offset(offset);

    return rows.map(shapeUnit);
}

// ---------------------------------------------------------------------------
// getUnit
// ---------------------------------------------------------------------------

export async function getUnit(id: string) {
    const rows = await db
        .select({
            id: handymanProfiles.id,
            userId: handymanProfiles.userId,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            phone: users.phone,
            businessName: handymanProfiles.businessName,
            bio: handymanProfiles.bio,
            profileImageUrl: handymanProfiles.profileImageUrl,
            homePostcode: handymanProfiles.homePostcode,
            contractorSegment: handymanProfiles.contractorSegment,
            unitType: handymanProfiles.unitType,
            crewMax: handymanProfiles.crewMax,
            areaCatchment: handymanProfiles.areaCatchment,
            skills: handymanProfiles.skills,
            acceptsSkus: handymanProfiles.acceptsSkus,
            certs: handymanProfiles.certs,
            minJobValuePence: handymanProfiles.minJobValuePence,
            dayRateTargetPence: handymanProfiles.dayRateTargetPence,
            reliabilityScore: handymanProfiles.reliabilityScore,
            priorityRoutingScore: handymanProfiles.priorityRoutingScore,
            verificationStatus: handymanProfiles.verificationStatus,
            availabilityStatus: handymanProfiles.availabilityStatus,
            lastAssignedAt: handymanProfiles.lastAssignedAt,
            createdAt: handymanProfiles.createdAt,
            updatedAt: handymanProfiles.updatedAt,
        })
        .from(handymanProfiles)
        .innerJoin(users, eq(handymanProfiles.userId, users.id))
        .where(eq(handymanProfiles.id, id))
        .limit(1);

    if (rows.length === 0) {
        throw new UnitServiceError('NOT_FOUND', `unit ${id} not found`);
    }
    return shapeUnit(rows[0]);
}

// ---------------------------------------------------------------------------
// createUnit
// ---------------------------------------------------------------------------

export async function createUnit(input: UnitCreateInput) {
    if (!input.firstName || !input.lastName || !input.email) {
        throw new UnitServiceError('INVALID_INPUT', 'firstName, lastName, email are required');
    }
    if (input.contractorSegment != null) {
        validateSegment(input.contractorSegment);
    }
    if (input.minJobValuePence != null && input.minJobValuePence < 0) {
        throw new UnitServiceError('INVALID_INPUT', 'minJobValuePence must be >= 0');
    }
    if (input.dayRateTargetPence != null && input.dayRateTargetPence < 0) {
        throw new UnitServiceError('INVALID_INPUT', 'dayRateTargetPence must be >= 0');
    }
    if (input.crewMax != null && input.crewMax < 1) {
        throw new UnitServiceError('INVALID_INPUT', 'crewMax must be >= 1');
    }

    // Specialist-on-create requires at least one cert listed (verification
    // status is 'unverified' at creation; admins must verify before the unit
    // is actually offered cert-gated work).
    if (input.contractorSegment === 'specialist' && (!input.certs || input.certs.length === 0)) {
        throw new UnitServiceError(
            'INVALID_INPUT',
            'specialist segment requires at least one cert; cert documents must then be verified',
        );
    }

    const userId = uuidv4();
    const profileId = uuidv4();
    const baseSlug = `${input.firstName}-${input.lastName}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const slug = `${baseSlug}-${uuidv4().slice(0, 6)}`;

    const rawPassword = input.password || uuidv4().slice(0, 12);
    const passwordHash = await bcrypt.hash(rawPassword, 10);

    try {
        await db.insert(users).values({
            id: userId,
            email: input.email,
            firstName: input.firstName,
            lastName: input.lastName,
            phone: input.phone ?? null,
            password: passwordHash,
            role: 'contractor',
            isActive: true,
        });

        await db.insert(handymanProfiles).values({
            id: profileId,
            userId,
            businessName: input.businessName ?? null,
            bio: input.bio ?? null,
            postcode: input.homePostcode ?? null,
            profileImageUrl: input.profileImageUrl ?? null,
            slug,
            publicProfileEnabled: true,
            availabilityStatus: 'available',
            verificationStatus: 'unverified',
            // Unit-bench fields
            contractorSegment: input.contractorSegment ?? null,
            unitType: input.unitType ?? 'single',
            crewMax: input.crewMax ?? (input.unitType === 'team' ? 2 : 1),
            homePostcode: input.homePostcode ?? null,
            areaCatchment: input.areaCatchment ?? [],
            skills: input.skills ?? [],
            acceptsSkus: input.acceptsSkus ?? null,
            certs: input.certs ?? [],
            minJobValuePence: input.minJobValuePence ?? null,
            dayRateTargetPence: input.dayRateTargetPence ?? null,
            reliabilityScore: '1.00',
        });
    } catch (err: any) {
        if (err?.code === '23505') {
            throw new UnitServiceError('DUPLICATE', 'a unit with that email or slug already exists');
        }
        throw err;
    }

    return getUnit(profileId);
}

// ---------------------------------------------------------------------------
// updateUnit — handles segment-change guards
// ---------------------------------------------------------------------------

export async function updateUnit(id: string, input: UnitUpdateInput) {
    const current = await getUnit(id); // throws NOT_FOUND if missing

    // Validate inputs
    if (input.contractorSegment != null) validateSegment(input.contractorSegment);
    if (input.minJobValuePence != null && input.minJobValuePence < 0) {
        throw new UnitServiceError('INVALID_INPUT', 'minJobValuePence must be >= 0');
    }
    if (input.dayRateTargetPence != null && input.dayRateTargetPence < 0) {
        throw new UnitServiceError('INVALID_INPUT', 'dayRateTargetPence must be >= 0');
    }
    if (input.crewMax != null && input.crewMax < 1) {
        throw new UnitServiceError('INVALID_INPUT', 'crewMax must be >= 1');
    }

    // Segment change?  Run guards (ADR-003 + Module 03 §6).
    const segmentChange =
        input.contractorSegment != null &&
        input.contractorSegment !== current.contractorSegment;
    let auditPayload: any = null;

    if (segmentChange) {
        const prev = current.contractorSegment;
        const next = input.contractorSegment!;

        // Builder → other: block when active day_commitments exist.
        if (prev === 'builder' && next !== 'builder') {
            const blocking = await db
                .select({ id: dayCommitments.id })
                .from(dayCommitments)
                .where(and(
                    eq(dayCommitments.unitId, id),
                    inArray(dayCommitments.status, ['open', 'assembling', 'offered', 'accepted']),
                ))
                .limit(1);
            if (blocking.length > 0) {
                throw new UnitServiceError(
                    'SEGMENT_LOCKED_BY_COMMITMENTS',
                    'cannot change segment while active day commitments exist; release them first (Module 06)',
                );
            }
        }

        // Specialist → other: block when pending routing offers exist.
        if (prev === 'specialist' && next !== 'specialist') {
            const blocking = await db
                .select({ id: routingOffers.id })
                .from(routingOffers)
                .where(and(
                    eq(routingOffers.unitId, id),
                    eq(routingOffers.status, 'pending'),
                ))
                .limit(1);
            if (blocking.length > 0) {
                throw new UnitServiceError(
                    'SEGMENT_LOCKED_BY_OFFERS',
                    'cannot change segment while pending routing offers exist; resolve them first',
                );
            }
        }

        // Any → Specialist: must have verificationStatus='verified'.
        if (next === 'specialist' && current.verificationStatus !== 'verified') {
            throw new UnitServiceError(
                'SPECIALIST_REQUIRES_VERIFIED',
                'unit must be verified (cert documents) before becoming a Specialist',
            );
        }

        auditPayload = {
            previous: prev,
            next,
            trigger: 'admin_override',
        };
    }

    // Build user-side updates
    const userUpdates: Record<string, any> = {};
    if (input.firstName !== undefined) userUpdates.firstName = input.firstName;
    if (input.lastName !== undefined) userUpdates.lastName = input.lastName;
    if (input.email !== undefined) userUpdates.email = input.email;
    if (input.phone !== undefined) userUpdates.phone = input.phone;
    if (Object.keys(userUpdates).length > 0) {
        userUpdates.updatedAt = new Date();
        try {
            await db.update(users).set(userUpdates).where(eq(users.id, current.userId));
        } catch (err: any) {
            if (err?.code === '23505') {
                throw new UnitServiceError('DUPLICATE', 'email already in use');
            }
            throw err;
        }
    }

    // Build profile-side updates. Allow setting a field to null where the
    // input model permits it (homePostcode, dayRateTargetPence, etc).
    const profileUpdates: Record<string, any> = {};
    if (input.businessName !== undefined) profileUpdates.businessName = input.businessName;
    if (input.bio !== undefined) profileUpdates.bio = input.bio;
    if (input.profileImageUrl !== undefined) profileUpdates.profileImageUrl = input.profileImageUrl;
    if (input.homePostcode !== undefined) {
        profileUpdates.homePostcode = input.homePostcode;
        // Keep the legacy `postcode` column in sync to avoid breaking other code paths.
        profileUpdates.postcode = input.homePostcode;
    }
    if (input.contractorSegment !== undefined) profileUpdates.contractorSegment = input.contractorSegment;
    if (input.unitType !== undefined) profileUpdates.unitType = input.unitType;
    if (input.crewMax !== undefined) profileUpdates.crewMax = input.crewMax;
    if (input.areaCatchment !== undefined) profileUpdates.areaCatchment = input.areaCatchment;
    if (input.skills !== undefined) profileUpdates.skills = input.skills;
    if (input.acceptsSkus !== undefined) profileUpdates.acceptsSkus = input.acceptsSkus;
    if (input.certs !== undefined) profileUpdates.certs = input.certs;
    if (input.minJobValuePence !== undefined) profileUpdates.minJobValuePence = input.minJobValuePence;
    if (input.dayRateTargetPence !== undefined) profileUpdates.dayRateTargetPence = input.dayRateTargetPence;

    if (Object.keys(profileUpdates).length > 0) {
        profileUpdates.updatedAt = new Date();
        await db.update(handymanProfiles).set(profileUpdates).where(eq(handymanProfiles.id, id));
    }

    // Audit row for segment changes (Module 03 §6).
    if (auditPayload) {
        try {
            await db.insert(routingDecisions).values({
                bookingId: id,                          // we use unit id as the bookingId on segment-change rows
                decisionType: 'segment_change',
                inputs: { unitId: id, ...auditPayload },
                outputs: { applied: true },
                decidedBy: 'admin',
            });
        } catch (auditErr) {
            // Audit failure should not fail the update; log only.
            console.warn('[units-service] failed to write segment_change audit row:', auditErr);
        }
    }

    return getUnit(id);
}

// ---------------------------------------------------------------------------
// softDeleteUnit
// ---------------------------------------------------------------------------

export async function softDeleteUnit(id: string) {
    const current = await getUnit(id); // throws NOT_FOUND
    await db
        .update(handymanProfiles)
        .set({ availabilityStatus: 'inactive', updatedAt: new Date() })
        .where(eq(handymanProfiles.id, id));
    await db
        .update(users)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(users.id, current.userId));
    return { success: true, id };
}

// ---------------------------------------------------------------------------
// findEligibleUnits — basic filter for the Phase-4 routing engine.
// Ranking weights (reliability × recency × distance × day-rate proximity)
// land with Module 05; this version just returns the candidate set.
// ---------------------------------------------------------------------------

export async function findEligibleUnits(jobProfile: JobProfile, postcode?: string | null) {
    const conditions: any[] = [
        sql`coalesce(${handymanProfiles.availabilityStatus}, 'available') <> 'inactive'`,
    ];

    // Skill / SKU eligibility — `accepts_skus` (when set) takes precedence.
    if (jobProfile.skuId) {
        conditions.push(or(
            // accepts_skus is null → fall back to skills array match below
            sql`${handymanProfiles.acceptsSkus} IS NULL`,
            sql`${handymanProfiles.acceptsSkus} @> ${JSON.stringify([jobProfile.skuId])}::jsonb`,
        ));
    }
    if (jobProfile.skillsRequired && jobProfile.skillsRequired.length > 0) {
        // Require at least one match from skills_required.
        const skillOrs = jobProfile.skillsRequired.map(
            (s) => sql`${handymanProfiles.skills} @> ${JSON.stringify([s])}::jsonb`,
        );
        conditions.push(or(...skillOrs));
    }

    if (jobProfile.certRequired) {
        conditions.push(sql`${handymanProfiles.certs} @> ${JSON.stringify([jobProfile.certRequired])}::jsonb`);
        // Cert-required jobs only go to verified Specialists.
        conditions.push(eq(handymanProfiles.contractorSegment, 'specialist'));
        conditions.push(eq(handymanProfiles.verificationStatus, 'verified'));
    }

    if (jobProfile.crewSizeRequired && jobProfile.crewSizeRequired > 1) {
        conditions.push(sql`coalesce(${handymanProfiles.crewMax}, 1) >= ${jobProfile.crewSizeRequired}`);
    }

    if (jobProfile.minJobValuePence != null) {
        // Unit declines if its floor is above this job's value.
        conditions.push(or(
            isNull(handymanProfiles.minJobValuePence),
            sql`${handymanProfiles.minJobValuePence} <= ${jobProfile.minJobValuePence}`,
        ));
    }

    if (postcode) {
        const pc = postcode.toUpperCase();
        // Take first 1-4 chars as the area prefix (NG7, NG12, etc).
        const prefix = pc.split(' ')[0] ?? pc.slice(0, 4);
        conditions.push(or(
            sql`upper(${handymanProfiles.homePostcode}) LIKE ${prefix + '%'}`,
            sql`${handymanProfiles.areaCatchment} @> ${JSON.stringify([prefix])}::jsonb`,
        ));
    }

    const rows = await db
        .select()
        .from(handymanProfiles)
        .where(and(...conditions))
        .orderBy(desc(sql`coalesce(${handymanProfiles.reliabilityScore}, 0)`));

    return rows.map((r) => ({
        id: r.id,
        contractorSegment: r.contractorSegment,
        skills: arr(r.skills),
        certs: arr(r.certs),
        homePostcode: r.homePostcode,
        reliabilityScore: r.reliabilityScore == null ? null : Number(r.reliabilityScore),
    }));
}

// ---------------------------------------------------------------------------
// backfillSegments — idempotent default for existing rows.
// Sets contractor_segment='gap_filler' WHERE contractor_segment IS NULL.
// Mirrors scripts/seed-segments.ts §8 of Module 03 spec — the script
// is not yet authored; this server-side helper covers the same step.
// ---------------------------------------------------------------------------

export async function backfillSegments() {
    const result = await db
        .update(handymanProfiles)
        .set({ contractorSegment: 'gap_filler' })
        .where(isNull(handymanProfiles.contractorSegment))
        .returning({ id: handymanProfiles.id });

    return { updated: result.length };
}
