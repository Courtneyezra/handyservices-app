/**
 * Portal routes — the unified mobile task inbox (/admin/portal, T5, 29 Aug 2026).
 *
 * The portal is deliberately thin on the server: its inbox reads GET /api/inbox/board and its
 * review view reads GET /api/inbox/conversations/:id/thread + GET /api/agents/quote-prep/:id/intake,
 * all of which already exist. The ONE thing the existing surface could not do is let Ben (or a VA)
 * overrule the intake clerk's lane — "this says needs_info but I know the job, it needs a visit" —
 * so that lives here.
 *
 * Nothing in this file sends a message to anyone. A lane override is a metadata write, full stop.
 */
import { Router } from 'express';
import { db } from './db';
import { conversations } from '@shared/schema';
import { eq } from 'drizzle-orm';

export const portalRouter = Router();

const LANES = ['quote_ready', 'needs_info', 'visit_first'] as const;
type Lane = (typeof LANES)[number];

// POST /api/portal/conversations/:id/lane — human override of the quote-prep clerk's verdict.
//
// Body: { lane: 'quote_ready' | 'needs_info' | 'visit_first', reason?: string }
//
// Writes metadata.quotePrepIntake.readiness (the single scalar the board and the panel read) and
// records the override under metadata.quotePrepLaneOverride so it is always attributable: who
// moved it, from what, to what, when, and why. Refuses when the clerk has never run — there is no
// verdict to override, and synthesising a fake intake would feed downstream consumers a shape the
// clerk never produced.
//
// The clerk may lawfully re-run when new information arrives on the thread (maybeAutoQuotePrep)
// and replace the readiness again; the override record survives so the history stays honest.
portalRouter.post('/conversations/:id/lane', async (req, res) => {
    try {
        const lane = String(req.body?.lane ?? '') as Lane;
        if (!LANES.includes(lane)) {
            return res.status(400).json({ error: `Invalid lane '${lane}'`, valid: LANES });
        }
        const reason = String(req.body?.reason ?? '').trim().slice(0, 300) || null;

        const [conv] = await db.select().from(conversations)
            .where(eq(conversations.id, req.params.id));
        if (!conv) return res.status(404).json({ error: 'Conversation not found' });

        const meta = (conv.metadata ?? {}) as Record<string, any>;
        const intake = meta.quotePrepIntake;
        if (!intake || typeof intake !== 'object') {
            return res.status(409).json({
                error: 'NO_INTAKE',
                message: 'The quote-prep clerk has not run on this thread yet, so there is no lane to override. Run "Prep quote" first.',
            });
        }

        const from = intake.readiness ?? null;
        if (from === lane) return res.json({ ok: true, unchanged: true, lane });

        const user = (req as any).user as { email?: string; username?: string } | undefined;
        const by = user?.email ?? user?.username ?? 'admin';

        const updatedMeta = {
            ...meta,
            quotePrepIntake: { ...intake, readiness: lane },
            quotePrepLaneOverride: { from, to: lane, by, at: new Date().toISOString(), reason },
        };

        await db.update(conversations)
            .set({ metadata: updatedMeta, updatedAt: new Date() })
            .where(eq(conversations.id, conv.id));

        res.json({ ok: true, lane, previous: from });
    } catch (error: any) {
        console.error('[Portal] Lane override failed:', error);
        res.status(500).json({ error: error?.message || 'Failed to override lane' });
    }
});
