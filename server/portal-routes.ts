/**
 * Portal routes — the unified mobile task inbox (/admin/portal, T5, 29 Aug 2026; P8 / C, 3 Sep).
 *
 * The portal is deliberately thin on the server: its inbox reads GET /api/inbox/board and its
 * review view reads GET /api/inbox/conversations/:id/thread + GET /api/spine/quote-intake/:id
 * (the same card the comms thread shows). The ONE thing the existing surface could not do is let
 * Ben (or a VA) overrule the intake clerk's lane — "this says needs_info but I know the job, it
 * needs a visit" — so that lives here.
 *
 * P8: one vocabulary (shared/intake-readiness.ts) and one source (server/intake.ts). An override
 * is a `quote_intake_override` record on the thread's metadata that getIntake applies on top of
 * the spine artifact it was made against; it never rewrites the clerk's own verdict, and a fresh
 * clerk run supersedes it (the record survives so the history stays honest). `decline` is a lane
 * now: overriding to it queues the fixed polite-no as a DRAFT (intent `closing`, source `spine`)
 * for Ben to confirm — nothing in this file sends a message to anyone.
 */
import { Router } from 'express';
import { isOverridableReadiness, OVERRIDABLE_READINESS, type OverridableReadiness } from '@shared/intake-readiness';
import { setIntakeOverride } from './intake';

export const portalRouter = Router();

/** The lanes a person may set. `quote_pending` is system-only (an estimate in flight). */
export const LANES = OVERRIDABLE_READINESS;
export type Lane = OverridableReadiness;

/** A generic polite no when the clerk left no reason code and the person gave none. */
export const GENERIC_DECLINE_BODY =
    'Thanks for sending that over. That one is outside what we can take on, so it\'s not something we can help with — but for any handyman jobs in future we\'d love to help.';

// POST /api/portal/conversations/:id/lane — human override of the clerk's verdict.
//
// Body: { lane: 'quote_ready' | 'needs_info' | 'visit_first' | 'decline', reason?: string, declineReason?: string }
//
// Writes metadata.quote_intake_override (who, from, to, when, why, against which intake run).
// Refuses when the clerk has never run — there is no verdict to override, and synthesising a fake
// intake would feed downstream consumers a shape the clerk never produced.
//
// quote_pending is a valid "from" state (an estimate was running), but not a valid "to".
// decline queues the polite-no DRAFT (dedupe: one unsent spine draft per number).
portalRouter.post('/conversations/:id/lane', async (req, res) => {
    try {
        const lane = String(req.body?.lane ?? '');
        if (!isOverridableReadiness(lane)) {
            return res.status(400).json({ error: `Invalid lane '${lane}'`, valid: LANES });
        }
        const reason = String(req.body?.reason ?? '').trim().slice(0, 300) || null;
        const user = (req as any).user as { email?: string; username?: string } | undefined;
        const by = user?.email ?? user?.username ?? 'admin';

        const r = await setIntakeOverride(req.params.id, { readiness: lane, by, reason });
        if (!r.ok) return res.status(r.status).json({ error: r.error, message: r.message });
        if (r.unchanged) return res.json({ ok: true, unchanged: true, lane });

        let draftId: string | null = null;
        if (lane === 'decline') {
            draftId = await queueDeclineDraft(req.params.id, {
                by,
                declineReason: String(req.body?.declineReason ?? '') || r.record.intake.declineReason,
            });
        }
        console.log(`[Portal] Lane override ${req.params.id}: ${r.previous} → ${lane} by ${by}${draftId ? ` (decline draft ${draftId})` : ''}`);
        res.json({ ok: true, lane, previous: r.previous, source: r.record.source, runId: r.record.runId, ...(lane === 'decline' ? { draftId } : {}) });
    } catch (error: any) {
        console.error('[Portal] Lane override failed:', error);
        res.status(500).json({ error: error?.message || 'Failed to override lane' });
    }
});

/**
 * The polite no as a DRAFT in Ben's queue: fixed template per reason code (never composed per
 * thread), source 'spine', intent closing in the reason string. Ben's approve is the send.
 */
async function queueDeclineDraft(conversationId: string, opts: { by: string; declineReason: string | null }): Promise<string | null> {
    const { db } = await import('./db');
    const { conversations } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    const [conv] = await db.select({ phoneNumber: conversations.phoneNumber }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    if (!conv) return null;
    const digits = conv.phoneNumber.replace('@c.us', '').replace(/\D/g, '');
    if (!digits) return null;
    const { declineProposalBody } = await import('./spine/agents/quote-clerk');
    const body = declineProposalBody(opts.declineReason) ?? GENERIC_DECLINE_BODY;
    const { queueDraft } = await import('./message-drafts');
    return queueDraft({
        phone: `+${digits}`,
        body,
        source: 'spine',
        reason: `[closing] [spine:quote_clerk] decline lane set by ${opts.by} in the portal${opts.declineReason ? ` (${opts.declineReason})` : ''} — polite no for Ben to confirm`,
        dedupe: true,
    });
}
