// Contractor Academy routes — module list + progress, and quiz submission.
// Mounted at /api/contractor/academy (see server/index.ts).
import { Router, Request, Response } from "express";
import { db } from "./db";
import { contractorTrainingProgress, handymanProfiles } from "../shared/schema";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { requireContractorAuth } from "./contractor-auth";
import { ACADEMY_MODULES, getModule, publicModule, gradeQuiz } from "./academy-content";

const router = Router();

async function getProfileId(userId: string): Promise<string | null> {
    const profile = await db.query.handymanProfiles.findFirst({
        where: eq(handymanProfiles.userId, userId),
        columns: { id: true },
    });
    return profile?.id ?? null;
}

function isCurrent(row: { status: string; expiresAt: Date | null } | undefined): boolean {
    if (!row || row.status !== 'passed') return false;
    if (row.expiresAt && row.expiresAt < new Date()) return false;
    return true;
}

// GET /api/contractor/academy — modules (without answers) + this contractor's progress
router.get('/', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const contractor = (req as any).contractor;
        const profileId = await getProfileId(contractor.id);
        if (!profileId) return res.status(404).json({ error: 'Contractor profile not found' });

        const rows = await db.select()
            .from(contractorTrainingProgress)
            .where(eq(contractorTrainingProgress.handymanId, profileId));
        const byModule = new Map(rows.map((r) => [r.moduleId, r]));

        const modules = ACADEMY_MODULES.map((m) => {
            const p = byModule.get(m.id);
            return {
                ...publicModule(m),
                progress: {
                    status: p?.status ?? 'not_started',
                    score: p?.score ?? null,
                    bestScore: p?.bestScore ?? null,
                    attempts: p?.attempts ?? 0,
                    passedAt: p?.passedAt ?? null,
                    expiresAt: p?.expiresAt ?? null,
                    current: isCurrent(p),
                },
            };
        });

        // "certs current" = all required modules passed and unexpired
        const certsCurrent = ACADEMY_MODULES
            .filter((m) => m.required)
            .every((m) => isCurrent(byModule.get(m.id)));

        // Any required module with a hard gate not yet current → dashboard should block
        const hardGateActive = ACADEMY_MODULES.some(
            (m) => m.required && m.gate === 'hard' && !isCurrent(byModule.get(m.id))
        );

        res.json({ modules, certsCurrent, hardGateActive });
    } catch (err) {
        console.error('[academy] GET / failed', err);
        res.status(500).json({ error: 'Failed to load academy' });
    }
});

const submitSchema = z.object({
    answers: z.array(z.number().int().nullable()),
});

// POST /api/contractor/academy/:moduleId/submit-quiz
router.post('/:moduleId/submit-quiz', requireContractorAuth, async (req: Request, res: Response) => {
    try {
        const contractor = (req as any).contractor;
        const profileId = await getProfileId(contractor.id);
        if (!profileId) return res.status(404).json({ error: 'Contractor profile not found' });

        const mod = getModule(req.params.moduleId);
        if (!mod) return res.status(404).json({ error: 'Module not found' });

        const parsed = submitSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Invalid answers' });
        const answers = parsed.data.answers.map((a) => (a == null ? -1 : a));
        if (answers.length !== mod.questions.length) {
            return res.status(400).json({ error: 'Answer count mismatch' });
        }

        const result = gradeQuiz(mod, answers);
        const now = new Date();

        const existing = await db.query.contractorTrainingProgress.findFirst({
            where: and(
                eq(contractorTrainingProgress.handymanId, profileId),
                eq(contractorTrainingProgress.moduleId, mod.id),
            ),
        });

        const passedAt = result.passed ? now : (existing?.passedAt ?? null);
        const expiresAt = result.passed && mod.expiryMonths
            ? new Date(now.getTime() + mod.expiryMonths * 30 * 24 * 60 * 60 * 1000)
            : (result.passed ? null : (existing?.expiresAt ?? null));
        const bestScore = Math.max(result.score, existing?.bestScore ?? 0);
        // Once passed, stay passed even if a later attempt scores lower.
        const status = result.passed || existing?.status === 'passed' ? 'passed' : 'failed';

        if (existing) {
            await db.update(contractorTrainingProgress)
                .set({
                    status,
                    score: result.score,
                    bestScore,
                    attempts: (existing.attempts ?? 0) + 1,
                    passedAt: status === 'passed' ? (existing.passedAt ?? passedAt) : null,
                    expiresAt: status === 'passed' ? (existing.expiresAt ?? expiresAt) : null,
                    updatedAt: now,
                })
                .where(eq(contractorTrainingProgress.id, existing.id));
        } else {
            await db.insert(contractorTrainingProgress).values({
                id: nanoid(),
                handymanId: profileId,
                moduleId: mod.id,
                status,
                score: result.score,
                bestScore,
                attempts: 1,
                passedAt,
                expiresAt,
                updatedAt: now,
            });
        }

        res.json({ ...result, moduleId: mod.id });
    } catch (err) {
        console.error('[academy] submit-quiz failed', err);
        res.status(500).json({ error: 'Failed to submit quiz' });
    }
});

export default router;
