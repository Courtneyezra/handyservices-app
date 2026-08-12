/**
 * Shadow offer classifier — the LLM challenger from the playbook (§5).
 * Runs AFTER the rules router, asynchronously, and writes its opinion onto the
 * SAME decision row (shadow_* columns). It is NEVER served to a customer.
 * Promotion path: monthly disagreement review (Ben flags, owner approves) —
 * council decision 12 Aug 2026.
 *
 * Runs on Claude (claude-opus-5) — switched from gpt-4o-mini 12 Aug 2026 when
 * the OpenAI account ran out of credits. Cost is negligible at quote volume
 * (~£0.01/quote) and the classification quality question resolves in Claude's
 * favour anyway.
 */
import { db } from './db';
import { quoteOfferDecisions } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { getAnthropic } from './anthropic';
import { OFFER_PLAYS, type OfferDecisionInputs, type OfferPlay } from './offer-router';

export interface ShadowContext {
    decisionId: string;
    inputs: OfferDecisionInputs;
    vaContext?: string | null;
    jobDescription?: string | null;
    lines: Array<{ category?: string | null; description?: string | null }>;
}

const SYSTEM_PROMPT = `You are the offer-selection shadow classifier for a handyman quoting system.
Given a quote's context, decide which ONE conversion play fits this customer, and rate the job's emotional stakes.

Plays (choose exactly one):
- welcome_gift: free small task for a first-time customer. Fits: first-timer, £200-1000, low anxiety.
- bundle_up: add-more-jobs menu. Fits: small jobs or repeat customers — raise the visit value.
- risk_removal: guarantee/proof/assumptions emphasis. Fits: anxious customers, water/electrical/structural/roofing risk.
- visit_first: push a site visit or phone call instead of web checkout. Fits: £1000+ or hard-to-scope jobs.
- quote_split: let them book part of the quote now. Fits: big quotes stalling on total price.
- partner: account relationship framing. Fits: property managers and letting agents.
- forward_pack: help a tenant get landlord approval. Fits: tenant is not the payer.
- loyalty: priority/credit for returning customers.
- terms_compliance: invoiced terms + compliance docs. Fits: business customers.
- none: no offer — straight to price. Choose when any offer would feel gimmicky or mismatched.

Stakes: how bad it FEELS for the customer if this job goes wrong. high = water/electrics/structure/roof or visible anxiety. low = cosmetic, trivial. med = between.

Reply with ONLY a JSON object, no other text: {"stakes":"low|med|high","play":"<one id>","rationale":"<one sentence, plain words>"}`;

/**
 * Fire-and-forget: classify and backfill the decision row. Swallows every
 * error — the shadow must never affect a live code path.
 */
export function runShadowClassifier(ctx: ShadowContext): void {
    void (async () => {
        try {
            const model = 'claude-opus-5';
            const lineSummary = ctx.lines
                .map((l) => `- ${l.category || 'general'}: ${String(l.description || '').slice(0, 140)}`)
                .join('\n');
            const user = [
                `Customer type: ${ctx.inputs.customerType || 'unknown'}`,
                `First-time customer: ${ctx.inputs.firstTime}`,
                `Quote total: £${(ctx.inputs.totalPence / 100).toFixed(0)} (band ${ctx.inputs.priceBand})`,
                `Survey required: ${ctx.inputs.surveyRequired}`,
                `Job lines:\n${lineSummary || '- (none)'}`,
                ctx.jobDescription ? `Job description: ${String(ctx.jobDescription).slice(0, 400)}` : '',
                ctx.vaContext ? `Operator notes (verbatim): ${String(ctx.vaContext).slice(0, 600)}` : '',
            ].filter(Boolean).join('\n');

            const response = await getAnthropic().messages.create({
                model,
                max_tokens: 2048,
                system: SYSTEM_PROMPT,
                messages: [{ role: 'user', content: user }],
            });
            if (response.stop_reason === 'refusal') return;
            const textBlock = response.content.find((b) => b.type === 'text');
            if (!textBlock || textBlock.type !== 'text') return;
            // The model replies with bare JSON; tolerate accidental fencing.
            const raw = textBlock.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
            const parsed = JSON.parse(raw);
            const play: string = String(parsed.play || '');
            const stakes: string = String(parsed.stakes || '');
            if (!(OFFER_PLAYS as readonly string[]).includes(play)) return;
            if (!['low', 'med', 'high'].includes(stakes)) return;

            await db.update(quoteOfferDecisions)
                .set({
                    shadowPlay: play as OfferPlay,
                    shadowStakes: stakes,
                    shadowRationale: String(parsed.rationale || '').slice(0, 500) || null,
                    shadowModel: model,
                })
                .where(eq(quoteOfferDecisions.id, ctx.decisionId));
        } catch (err) {
            console.warn('[OfferShadow] classify failed (non-blocking):',
                err instanceof Error ? err.message : err);
        }
    })();
}
