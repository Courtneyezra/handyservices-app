/**
 * /api/spine — the spine's admin-facing HTTP surface (Phase 4 / B). Mounted behind requireAdmin.
 *
 *   GET  /quote-intake/:conversationId              latest Quote clerk artifact + thread media (404 { available:false })
 *   POST /quote-intake/:conversationId/save-draft   UNSENT draft quote from the card (never prices)
 *   POST /ask/:conversationId { kind }              rules-layer ask (postcode / media / name), approved by the signed-in human
 *
 * Ships dark: the writes refuse while the spine switch is 'off' (server/spine/switch.ts), and the
 * read only ever finds an artifact if the spine's clerk ran, which it cannot while off.
 */
import { Router } from 'express';
import { loadQuoteIntakeCard, saveDraftQuote } from './quote-intake';
import { spineMode } from './switch';

export const spineRouter = Router();

function sessionUser(req: any): { id?: string | null; email?: string | null; name?: string | null } {
    const u = req?.user ?? {};
    return { id: u.id ?? null, email: u.email ?? null, name: u.name ?? u.firstName ?? null };
}

spineRouter.get('/quote-intake/:conversationId', async (req, res) => {
    try {
        const card = await loadQuoteIntakeCard(req.params.conversationId);
        if (!card.available) return res.status(404).json(card);
        res.json(card);
    } catch (error: any) {
        console.error('[Spine] quote-intake read failed:', error?.message ?? error);
        res.status(500).json({ available: false, error: error?.message ?? 'Could not read the intake' });
    }
});

spineRouter.post('/quote-intake/:conversationId/save-draft', async (req, res) => {
    try {
        if ((await spineMode()) === 'off') return res.status(409).json({ ok: false, errors: ['The spine is switched off; the quote card is dark.'] });
        const r = await saveDraftQuote(req.params.conversationId, req.body, sessionUser(req));
        if (!r.ok) return res.status(r.status).json({ ok: false, errors: r.errors });
        res.json(r);
    } catch (error: any) {
        console.error('[Spine] save-draft failed:', error?.message ?? error);
        res.status(500).json({ ok: false, errors: [error?.message ?? 'Could not save the draft'] });
    }
});

const ASK_KINDS = ['ask_postcode', 'ask_media', 'ask_name'] as const;

spineRouter.post('/ask/:conversationId', async (req, res) => {
    try {
        if ((await spineMode()) === 'off') return res.status(409).json({ sent: false, reason: 'SPINE_OFF' });
        const kind = String(req.body?.kind ?? '');
        if (!(ASK_KINDS as readonly string[]).includes(kind)) return res.status(400).json({ sent: false, reason: `kind must be one of ${ASK_KINDS.join(', ')}` });
        const { sendAsk } = await import('../rules-layer');
        const { newRunId, humanApprover } = await import('../approver');
        const u = sessionUser(req);
        const result = await sendAsk(req.params.conversationId, kind as any, newRunId('ask'), { approver: humanApprover(u.email ?? u.id ?? 'admin') });
        res.status(result.sent ? 200 : 202).json(result);
    } catch (error: any) {
        console.error('[Spine] ask failed:', error?.message ?? error);
        res.status(500).json({ sent: false, reason: 'ERROR', detail: error?.message });
    }
});
