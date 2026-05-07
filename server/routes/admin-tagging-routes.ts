// server/routes/admin-tagging-routes.ts
//
// Module 02 (Job Tagging at Quote Creation) admin routes:
//   PUT  /api/admin/quotes/:id/tags     — persist routing-decisive tags
//   GET  /api/admin/quotes/:id/profile  — return computed JobProfile
//
// Both routes are gated by FF_JOB_TAGGING. When the flag is OFF, both return
// 503 service_unavailable (per Module 02 §11 + §6: feature dormant on flip).
// Auth: admin via the existing requireAdmin middleware.
//
// Refs:
// - docs/architecture/modules/02-job-tagging.md §6, §8
// - docs/architecture/api-surface.md §2.2
// - docs/architecture/feature-flags.md (FF_JOB_TAGGING)
// - docs/architecture/adrs/adr-005-real-vs-pricing-time.md (real ≤ pricing)

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { personalizedQuotes } from '@shared/schema';
import { requireAdmin } from '../auth';
import { FLAGS } from '../feature-flags';
import {
    computeJobProfileFromRow,
    type PersonalizedQuoteRow,
} from '../job-profile';

export const adminTaggingRouter = Router();

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// Per Module 02 §8. Skill slugs are validated as non-empty strings here; the
// authoritative whitelist lives in productized_services.category and is
// enforced by Module 05 routing — keeping this loose lets admins tag with new
// SKU categories the moment they're added without a code redeploy.
const certEnum = z.enum(['gas_safe', 'part_p', 'structural', 'asbestos']);
const COMPLEXITY_FLAG_VALUES = [
    'heavy_lifting',
    'awkward_access',
    'parking_difficult',
    'older_property',
    'unknowns',
    'hazardous',
    'stairs',
    'external',
    'permits',
    'old_property',          // alias kept for existing module wording
    'weather_dependent',
] as const;
const complexityFlagEnum = z.enum(COMPLEXITY_FLAG_VALUES);
const flexibilityEnum = z.enum(['rigid', 'flexible', 'very_flexible']);
const FLEX_TOKENS_AS_FLAGS = new Set<string>(['rigid', 'flexible', 'very_flexible']);

// Strip any flexibility sentinels from complexity_flags before validating —
// they piggy-back on the same JSON column server-side but are conceptually
// separate. Keeps the round-trip (GET → edit → PUT) idempotent.
const complexityFlagsField = z
    .array(z.string())
    .default([])
    .transform((arr) => arr.filter((f) => !FLEX_TOKENS_AS_FLAGS.has(f)))
    .pipe(z.array(complexityFlagEnum));

const tagsSchema = z
    .object({
        crew_size_required: z.number().int().min(1).max(4),
        skills_required: z.array(z.string().min(1)).default([]),
        cert_required: z.array(certEnum).default([]),
        duration_estimate_minutes: z.number().int().positive(),
        real_work_minutes: z.number().int().positive(),
        complexity_flags: complexityFlagsField,
        heavy_lifting: z.boolean().default(false),
        customer_flexibility: flexibilityEnum.default('flexible'),
    })
    .strict()
    .refine(
        (v) => v.real_work_minutes <= v.duration_estimate_minutes,
        {
            message:
                'real_work_minutes must be <= duration_estimate_minutes (ADR-005). Real > pricing means the line is under-priced — fix the quote, do not auto-correct.',
            path: ['real_work_minutes'],
        },
    );

// ---------------------------------------------------------------------------
// Flag guard
// ---------------------------------------------------------------------------

function guardFlag(_req: Request, res: Response): boolean {
    if (!FLAGS.JOB_TAGGING) {
        res.status(503).json({
            error: 'job tagging disabled',
            code: 'service_unavailable',
        });
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// PUT /api/admin/quotes/:id/tags
// ---------------------------------------------------------------------------

adminTaggingRouter.put(
    '/api/admin/quotes/:id/tags',
    requireAdmin,
    async (req, res) => {
        if (!guardFlag(req, res)) return;

        const { id } = req.params;
        const parsed = tagsSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(422).json({
                error: 'validation_failed',
                code: 'validation_failed',
                details: parsed.error.format(),
            });
        }

        const tags = parsed.data;

        // Keep heavy_lifting top-level boolean in sync with the chip in
        // complexity_flags (per Module 02 §2 footnote: panel writes both).
        const complexityFlags = Array.from(new Set(tags.complexity_flags));
        const heavyLifting =
            tags.heavy_lifting || complexityFlags.includes('heavy_lifting');
        if (heavyLifting && !complexityFlags.includes('heavy_lifting')) {
            complexityFlags.push('heavy_lifting');
        }

        // Stamp customer_flexibility into complexity_flags as a sentinel until
        // data-model lands a dedicated column. computeJobProfileFromRow knows
        // how to read this back. Stripping any prior sentinel first keeps the
        // array idempotent on retry.
        const flagsWithFlex = mergeFlexibilityToken(
            complexityFlags,
            tags.customer_flexibility,
        );

        const existing = await db
            .select()
            .from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, id))
            .limit(1);
        if (!existing[0]) {
            return res.status(404).json({
                error: 'quote not found',
                code: 'not_found',
            });
        }

        await db
            .update(personalizedQuotes)
            .set({
                crewSizeRequired: tags.crew_size_required,
                skillsRequired: tags.skills_required,
                certRequired: tags.cert_required,
                durationEstimateMinutes: tags.duration_estimate_minutes,
                realWorkMinutes: tags.real_work_minutes,
                complexityFlags: flagsWithFlex,
                heavyLifting,
            })
            .where(eq(personalizedQuotes.id, id));

        // Re-read so the JobProfile reflects the actual stored state.
        const refreshed = await db
            .select()
            .from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, id))
            .limit(1);

        const profile = computeJobProfileFromRow(
            refreshed[0] as unknown as PersonalizedQuoteRow,
        );

        return res.json({ ok: true, profile });
    },
);

// ---------------------------------------------------------------------------
// GET /api/admin/quotes/:id/profile
// ---------------------------------------------------------------------------

adminTaggingRouter.get(
    '/api/admin/quotes/:id/profile',
    requireAdmin,
    async (req, res) => {
        if (!guardFlag(req, res)) return;

        const { id } = req.params;
        const rows = await db
            .select()
            .from(personalizedQuotes)
            .where(eq(personalizedQuotes.id, id))
            .limit(1);

        if (!rows[0]) {
            return res.status(404).json({
                error: 'quote not found',
                code: 'not_found',
            });
        }

        const profile = computeJobProfileFromRow(
            rows[0] as unknown as PersonalizedQuoteRow,
        );
        return res.json({ profile });
    },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FLEXIBILITY_TOKENS = ['rigid', 'flexible', 'very_flexible'] as const;

function mergeFlexibilityToken(
    flags: string[],
    flexibility: 'rigid' | 'flexible' | 'very_flexible',
): string[] {
    const stripped = flags.filter(
        (f) => !(FLEXIBILITY_TOKENS as readonly string[]).includes(f),
    );
    stripped.push(flexibility);
    return stripped;
}
