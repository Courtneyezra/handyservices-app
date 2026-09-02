/**
 * /api/spine — the spine's admin-facing HTTP surface (Phase 4 / B). Mounted behind requireAdmin.
 *
 *   GET  /quote-intake/:conversationId              latest Quote clerk artifact + thread media (404 { available:false })
 *   POST /quote-intake/:conversationId/save-draft   UNSENT draft quote from the card (never prices)
 *   POST /ask/:conversationId { kind }              rules-layer ask (postcode / media / name), approved by the signed-in human
 *   POST /tiers { packId, intent, tier, reason }    P6: a person promotes / demotes one intent on the ladder
 *                                                   (pack_intent_tiers + pack_tier_events, changed_by human:<id>);
 *                                                   refuses SEND for intents outside the pack or any money/date name
 *
 * Ships dark: the writes refuse while the spine switch is 'off' (server/spine/switch.ts), and the
 * read only ever finds an artifact if the spine's clerk ran, which it cannot while off. The tier
 * write is config, not a send: it is allowed in every mode (a demotion must work while off), and a
 * tier only has an effect once the spine is live.
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

// P6: a person moves one intent on the ladder. Validation (pack, intent in pack, tier vocabulary,
// never SEND on a money/date name, reason required) is validateHumanTierRequest; the write is
// setTierByHuman — same tables and event log as the 07:30 job, changed_by = human:<id>.
spineRouter.post('/tiers', async (req, res) => {
    try {
        const { validateHumanTierRequest, setTierByHuman } = await import('./autonomy');
        const v = validateHumanTierRequest(req.body ?? {});
        if (!v.ok) return res.status(400).json({ ok: false, errors: v.errors });
        const { humanApprover } = await import('../approver');
        const u = sessionUser(req);
        const change = await setTierByHuman(v.request, { by: humanApprover(u.email ?? u.id ?? 'admin') });
        res.json({ ok: true, change });
    } catch (error: any) {
        console.error('[Spine] tier change failed:', error?.message ?? error);
        res.status(500).json({ ok: false, errors: [error?.message ?? 'Could not change the tier'] });
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
