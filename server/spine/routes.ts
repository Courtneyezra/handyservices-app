/**
 * /api/spine — the spine's admin-facing HTTP surface (Phase 4 / B). Mounted behind requireAdmin.
 *
 *   GET  /quote-intake/:conversationId              latest Quote clerk artifact + thread media (404 { available:false })
 *   POST /quote-intake/:conversationId/save-draft   UNSENT draft quote from the card (never prices)
 *   POST /ask/:conversationId { kind }              rules-layer ask (postcode / media / name), approved by the signed-in human
 *   GET  /controls                                  P6: switches + legacy flags + who last changed each + viewer rights
 *   POST /config { mode?, agents?, asks?, autonomy?, sampler?, video?, confirm? }
 *                                                   P6: flip the spine (mode / autonomy owner-only; live needs confirm 'LIVE' + go-live check)
 *   GET  /golive-check?skipEvals=1                  P6: CUTOVER §0 preconditions as a GO / NO-GO table
 *   GET  /shadow-report?days=1|7                    P6: compareShadow() headline + last 10 pairs
 *   GET  /price/:slug                               P8: Ben's price-and-send screen payload (draft + suggestions + band)
 *   POST /price/:slug/send { version, lines }       P8: Ben's tap — writes his prices, records verdicts, sends via the existing path
 *   POST /price/:slug/{ask|call|visit}             P12: the exits that are not a send (hold the quote, ledger under Ben)
 *   GET  /price-stats?days=90                       P8: Route B graduation metrics per category (design §6), read-only
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

// ---------------------------------------------------------------- P6 / A2: switch controls

function viewer(req: any): { id?: string | null; email?: string | null; role?: string | null } {
    const u = req?.user ?? {};
    return { id: u.id ?? null, email: u.email ?? null, role: u.role ?? null };
}

/**
 * GET /controls — everything the switch strip needs in one read: the spine switches, the legacy
 * flags, who last changed each control and when (from config_change system events), whether the
 * viewer may flip the owner-only ones, and the mode captions.
 */
spineRouter.get('/controls', async (req, res) => {
    try {
        const { getSpineConfig } = await import('./config');
        const { spineModeFrom } = await import('./switch');
        const { lastChangeByField, isOwner, MODE_CAPTIONS, LIVE_CONFIRM_WORD } = await import('./controls');
        const { getCommsAgentConfig } = await import('../agents/comms');
        const { db } = await import('../db');
        const { systemEvents } = await import('@shared/schema');
        const { and, desc, eq, inArray } = await import('drizzle-orm');
        const [cfg, legacy, events] = await Promise.all([
            getSpineConfig(),
            getCommsAgentConfig().catch(() => null),
            db.select({ at: systemEvents.at, source: systemEvents.source, summary: systemEvents.summary, detail: systemEvents.detail })
                .from(systemEvents)
                .where(and(eq(systemEvents.kind, 'config_change'), inArray(systemEvents.source, ['spine', 'comms-config'])))
                .orderBy(desc(systemEvents.at)).limit(200)
                .catch(() => [] as any[]),
        ]);
        res.json({
            spine: {
                mode: spineModeFrom(cfg), enabled: cfg.enabled, shadow: cfg.shadow, explicitMode: cfg.mode ?? null,
                agents: cfg.agents, asks: cfg.asks, autonomy: cfg.autonomy, sampler: cfg.sampler, video: cfg.video,
                sweepLimit: cfg.sweepLimit, debounceMinutes: cfg.debounceMinutes, triageModel: cfg.triageModel, city: cfg.city,
            },
            legacy: legacy ? { enabled: legacy.enabled, onInbound: legacy.onInbound, autosend: legacy.autosend.enabled, firstContactAck: legacy.firstContactAutoAck.enabled, quotePrep: legacy.quotePrep.enabled } : null,
            lastChanges: lastChangeByField(events as any),
            viewer: { isOwner: isOwner(viewer(req)), email: viewer(req).email ?? null, role: viewer(req).role ?? null },
            captions: MODE_CAPTIONS,
            confirmWord: LIVE_CONFIRM_WORD,
        });
    } catch (error: any) {
        console.error('[Spine] controls read failed:', error?.message ?? error);
        res.status(500).json({ error: error?.message ?? 'Could not read the controls' });
    }
});

/**
 * POST /config — flip the spine's switches. Partial body { mode?, agents?, asks?, autonomy?,
 * sampler?, video?, confirm? }; unknown fields are refused (server/spine/controls.ts). Mode and
 * autonomy are owner-only; `mode: 'live'` needs confirm 'LIVE' AND a go-live check with no NO-GO.
 * setSpineConfig writes the row and logs the config_change event with `by`.
 */
spineRouter.post('/config', async (req, res) => {
    try {
        const { validateSpineConfigPatch, isOwner } = await import('./controls');
        const v = validateSpineConfigPatch(req.body ?? {});
        if (!v.ok) return res.status(400).json({ ok: false, errors: v.errors });
        const u = viewer(req);
        if (v.needs === 'owner' && !isOwner(u)) return res.status(403).json({ ok: false, errors: ['The spine mode and the autonomy job are owner-only (the owner account or role admin).'] });
        let golive: unknown = null;
        if (v.goesLive) {
            const { runGoLiveCheck } = await import('./golive-check');
            const report = await runGoLiveCheck({ skipEvals: true });
            golive = report;
            if (!report.ok) return res.status(409).json({ ok: false, errors: [`Go-live check has ${report.noGo} NO-GO item(s); fix them first.`], golive: report });
        }
        const { setSpineConfig } = await import('./config');
        const { spineModeFrom } = await import('./switch');
        const { humanApprover } = await import('../approver');
        const next = await setSpineConfig(v.patch, humanApprover(u.email ?? u.id ?? 'admin'));
        console.log(`[Spine] config: ${v.changes.join(', ')} by ${u.email ?? u.id ?? 'admin'}`);
        res.json({ ok: true, changes: v.changes, mode: spineModeFrom(next), spine: { enabled: next.enabled, shadow: next.shadow, mode: next.mode ?? null, agents: next.agents, asks: next.asks, autonomy: next.autonomy, sampler: next.sampler, video: next.video }, golive });
    } catch (error: any) {
        console.error('[Spine] config write failed:', error?.message ?? error);
        res.status(500).json({ ok: false, errors: [error?.message ?? 'Could not save the config'] });
    }
});

/** GET /golive-check?skipEvals=1 — CUTOVER §0 as a table (server/spine/golive-check.ts). Read-only. */
spineRouter.get('/golive-check', async (req, res) => {
    try {
        const { runGoLiveCheck } = await import('./golive-check');
        const skipEvals = String(req.query.skipEvals ?? '1') !== '0';
        res.json(await runGoLiveCheck({ skipEvals }));
    } catch (error: any) {
        console.error('[Spine] go-live check failed:', error?.message ?? error);
        res.status(500).json({ error: error?.message ?? 'Go-live check failed' });
    }
});

/** GET /shadow-report?days=1|7 — compareShadow() over the window (Phase 3), for the staff-page card. Read-only. */
spineRouter.get('/shadow-report', async (req, res) => {
    try {
        const days = Number(req.query.days) === 1 ? 1 : 7;
        const { compareShadow, loadLegacyRuns, loadShadowRuns } = await import('./shadow-report');
        const [spine, legacy] = await Promise.all([loadShadowRuns(days), loadLegacyRuns(days)]);
        const c = compareShadow(spine, legacy, days);
        // The page wants the headline and the last 10 pairs; the full pair list stays on the script.
        const recent = c.pairs.slice().sort((a, b) => {
            const at = (id: string) => spine.find((s) => s.runId === id)?.at.getTime() ?? 0;
            return at(b.spineRunId) - at(a.spineRunId);
        }).slice(0, 10).map((p) => ({ ...p, at: spine.find((s) => s.runId === p.spineRunId)?.at.toISOString() ?? null }));
        res.json({
            days: c.days, at: new Date().toISOString(),
            spineRuns: c.pairs.length, unpairedSpine: c.unpairedSpine, counts: c.counts, agreement: c.agreement, byDecision: c.byDecision,
            recent,
        });
    } catch (error: any) {
        console.error('[Spine] shadow report failed:', error?.message ?? error);
        res.status(500).json({ error: error?.message ?? 'Shadow report failed' });
    }
});

/**
 * POST /rerun/:conversationId — P7: Ben's "Re-draft" on a stale draft card. Rejects the thread's
 * pending agent drafts (system:stale_by_inbound) and asks for a fresh run: the spine when it is
 * enabled (shadow or live), else the legacy debounce set to now. Works in every mode — a person
 * asking for a fresh look is never refused.
 */
spineRouter.post('/rerun/:conversationId', async (req, res) => {
    try {
        const conversationId = String(req.params.conversationId ?? '').trim();
        if (!conversationId) return res.status(400).json({ ok: false, errors: ['conversationId required'] });
        const { supersedeStaleDrafts } = await import('../message-drafts');
        const { requestFreshRun, latestInboundFor } = await import('../draft-freshness');
        const u = viewer(req);
        const latest = await latestInboundFor(conversationId);
        const superseded = await supersedeStaleDrafts(conversationId, latest?.at ?? new Date(), { latestInboundId: latest?.id ?? null, why: `re-draft by ${u.email ?? u.id ?? 'admin'}` });
        const run = await requestFreshRun(conversationId, `re-draft by ${u.email ?? u.id ?? 'admin'}`);
        res.status(run.queued ? 200 : 202).json({ ok: true, superseded: superseded.rejected, run });
    } catch (error: any) {
        console.error('[Spine] rerun failed:', error?.message ?? error);
        res.status(500).json({ ok: false, errors: [error?.message ?? 'Could not request a fresh run'] });
    }
});

// ---------------------------------------------------------------- P8 Route A

// (P8 merge fix, 4 Sep 2026) The chain pane's GET /price/:slug handler that lived here returned the
// quote-intake module's shape ({ available, quote, … }) and, being registered first, shadowed the
// price-screen handler below — the page then threw reading settings.depositPercent. One route now.

/** GET /estimate/:conversationId — the thread's live estimate (status running | complete | failed) for the card. */
spineRouter.get('/estimate/:conversationId', async (req, res) => {
    try {
        const { latestEstimateForConversation } = await import('./estimate-store');
        const e = await latestEstimateForConversation(String(req.params.conversationId ?? '').trim());
        if (!e) return res.status(404).json({ available: false, reason: 'no live estimate for this thread' });
        res.json({ available: true, estimate: e });
    } catch (error: any) {
        console.error('[Spine] estimate read failed:', error?.message ?? error);
        res.status(500).json({ available: false, error: error?.message ?? 'Could not read the estimate' });
    }
});

/**
 * POST /estimate/:conversationId — ask the spine to (re)run the chain on this thread: a `manual`
 * run, which the estimator agent accepts when the freshest quote_ready intake has no live estimate.
 */
spineRouter.post('/estimate/:conversationId', async (req, res) => {
    try {
        const { requestRun } = await import('./request-run');
        const r = await requestRun(String(req.params.conversationId ?? '').trim(), 'manual', { delayMs: 0 });
        res.status(r.queued ? 202 : 409).json({ ok: r.queued, ...r });
    } catch (error: any) {
        console.error('[Spine] estimate request failed:', error?.message ?? error);
        res.status(500).json({ ok: false, errors: [error?.message ?? 'Could not request an estimate'] });
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

// ---------------------------------------------------------------- P8 / B: price and send

/**
 * GET /price/:slug — everything Ben's phone screen renders: the Route A draft, the chain's
 * per-line suggestion + band, minutes, materials at the live margin, photos, the supersede token.
 * 404 when there is no quote with that slug. Read-only: nothing here prices or writes.
 */
spineRouter.get('/price/:slug', async (req, res) => {
    try {
        const { loadPriceScreen } = await import('./price-screen');
        const p = await loadPriceScreen(String(req.params.slug || '').trim());
        if (!p.available) return res.status(p.status).json({ available: false, error: p.reason });
        res.json(p);
    } catch (error: any) {
        console.error('[Spine] price screen read failed:', error?.message ?? error);
        res.status(500).json({ available: false, error: error?.message ?? 'Could not load the price screen' });
    }
});

/**
 * POST /price/:slug/send { version, lines:[{ lineId, finalPence }], messageStyle? } — Ben's tap.
 * 1. confirmPrices: 409 if the draft was superseded / sent / revoked or the version differs (a new
 *    scope arrived), 400 on a bad price; otherwise writes the customer-visible prices onto the
 *    draft and one quote_price_verdicts row per line under human:<id>.
 * 2. draftQuoteSendMessage + deliverQuoteLink: the EXISTING quote-send path (the one the legacy
 *    card uses), approver human:<id>, one run id for the whole burst. The outcome (sent /
 *    template / queued for the window) is reported as it happened. Nothing sends without this tap.
 */
spineRouter.post('/price/:slug/send', async (req, res) => {
    try {
        const slug = String(req.params.slug || '').trim();
        const { confirmPrices } = await import('./price-screen');
        const u = sessionUser(req);
        const c = await confirmPrices(slug, req.body, { id: u.id ?? null, email: u.email ?? null });
        if (!c.ok) return res.status(c.status).json({ ok: false, errors: c.errors, status: c.payload?.status ?? null, version: c.payload?.version ?? null });
        const conversationId = c.payload.conversationId;
        if (!conversationId) {
            return res.status(422).json({ ok: false, priced: true, errors: ['Prices are saved on the quote, but no thread matches this customer, so the link could not be sent from here. Send it from the builder.'], quoteUrl: c.payload.quoteUrl });
        }
        const { draftQuoteSendMessage, deliverQuoteLink } = await import('../agent-staff');
        const { withQuoteLink } = await import('./price-brief');
        // P12: the message she reads is the desk's draft as Ben left it on the screen (the link goes
        // on as the last line). The older style-based drafter is the fallback when no message came.
        let body: string;
        if (c.message) {
            body = withQuoteLink(c.message, c.payload.quoteUrl);
        } else {
            const style = typeof req.body?.messageStyle === 'string' ? req.body.messageStyle : null;
            const drafted = await draftQuoteSendMessage(conversationId, slug, style);
            if (!drafted.ok) {
                return res.status(drafted.status === 404 ? 422 : drafted.status).json({ ok: false, priced: true, errors: [`Prices are saved on the quote, but the message could not be drafted: ${drafted.error}`], quoteUrl: c.payload.quoteUrl });
            }
            body = drafted.body;
        }
        const sent = await deliverQuoteLink({ conversationId, slug, body, approver: c.approver, runId: c.runId });
        const ok = sent.status >= 200 && sent.status < 300;
        const mode: 'sent' | 'queued' | 'template' = sent.json?.queued ? 'queued' : sent.json?.mode === 'template' ? 'template' : 'sent';
        res.status(sent.status).json({
            ok, priced: true, verdicts: c.verdicts, totals: c.totals, quoteUrl: c.payload.quoteUrl, conversationId, runId: c.runId,
            messageBody: body, ...sent.json,
            nextSteps: ok ? c.nextSteps(mode) : undefined,
            nextWaiting: c.payload.nextWaiting,
            errors: ok ? undefined : [sent.json.message ?? sent.json.error ?? 'Send failed'],
        });
    } catch (error: any) {
        console.error('[Spine] price send failed:', error?.message ?? error);
        res.status(500).json({ ok: false, errors: [error?.message ?? 'Could not send the quote'] });
    }
});

/**
 * P12: the three exits that are not a send. Each holds the quote (pricing_suggestions.hold, no
 * migration), lands in the ledger under human:<id>, and never leaves the screen.
 *   POST /price/:slug/ask   { question }  ONE question queued as a pending draft in Ben's queue
 *   POST /price/:slug/call  {}            the ledger records the call intent; the phone dials
 *   POST /price/:slug/visit { why? }      the survey offer (fee from settings) drafted instead of a price
 * A sent / superseded / revoked draft refuses with 409, like the send does.
 */
async function priceExitContext(slug: string, req: any) {
    const { loadPriceScreen } = await import('./price-screen');
    const p = await loadPriceScreen(slug);
    if (!p.available) return { error: { status: p.status, errors: [p.reason] } };
    if (p.status !== 'draft') return { error: { status: 409, errors: [p.status === 'sent' ? 'This quote has already been sent.' : p.status === 'revoked' ? 'This quote was revoked.' : 'A new scope arrived and this draft was superseded. Reload to price the new one.'] } };
    const u = sessionUser(req);
    return { ctx: { quoteId: p.quoteId, slug: p.slug, conversationId: p.conversationId, phone: p.customer.phone, firstName: p.customer.firstName, user: { id: u.id ?? null, email: u.email ?? null } } };
}

spineRouter.post('/price/:slug/ask', async (req, res) => {
    try {
        const c = await priceExitContext(String(req.params.slug || '').trim(), req);
        if (c.error) return res.status(c.error.status).json({ ok: false, errors: c.error.errors });
        const { askFirst } = await import('./price-brief');
        const r = await askFirst(c.ctx!, req.body?.question);
        if (!r.ok) return res.status(r.status).json({ ok: false, errors: r.errors });
        res.json({ ok: true, hold: r.hold, draftId: r.draftId, runId: r.runId });
    } catch (error: any) {
        console.error('[Spine] price ask failed:', error?.message ?? error);
        res.status(500).json({ ok: false, errors: [error?.message ?? 'Could not queue the question'] });
    }
});

spineRouter.post('/price/:slug/call', async (req, res) => {
    try {
        const c = await priceExitContext(String(req.params.slug || '').trim(), req);
        if (c.error) return res.status(c.error.status).json({ ok: false, errors: c.error.errors });
        const { callRequested } = await import('./price-brief');
        const r = await callRequested(c.ctx!);
        if (!r.ok) return res.status(r.status).json({ ok: false, errors: r.errors });
        res.json({ ok: true, hold: r.hold, tel: r.tel, runId: r.runId });
    } catch (error: any) {
        console.error('[Spine] price call failed:', error?.message ?? error);
        res.status(500).json({ ok: false, errors: [error?.message ?? 'Could not record the call'] });
    }
});

spineRouter.post('/price/:slug/visit', async (req, res) => {
    try {
        const c = await priceExitContext(String(req.params.slug || '').trim(), req);
        if (c.error) return res.status(c.error.status).json({ ok: false, errors: c.error.errors });
        const { needsVisit } = await import('./price-brief');
        const r = await needsVisit(c.ctx!, typeof req.body?.why === 'string' ? req.body.why : null);
        if (!r.ok) return res.status(r.status).json({ ok: false, errors: r.errors });
        res.json({ ok: true, hold: r.hold, draftId: r.draftId, runId: r.runId });
    } catch (error: any) {
        console.error('[Spine] price visit failed:', error?.message ?? error);
        res.status(500).json({ ok: false, errors: [error?.message ?? 'Could not draft the survey offer'] });
    }
});

/** GET /price-stats?days=90 — Route B graduation metrics per category (design §6), read-only. */
spineRouter.get('/price-stats', async (req, res) => {
    try {
        const { loadPriceStats, clampDays } = await import('./price-stats');
        res.json(await loadPriceStats(clampDays(req.query.days, 90)));
    } catch (error: any) {
        console.error('[Spine] price stats failed:', error?.message ?? error);
        res.status(500).json({ error: error?.message ?? 'Could not compute the price stats' });
    }
});
