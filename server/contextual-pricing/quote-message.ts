/**
 * Builds the WhatsApp message that carries a contextual-quote link to the customer.
 *
 * Two things this adds over the old hardcoded assembly:
 *  1. A PRICE RANGE up front — pre-anchors the customer to a band BEFORE they open the link,
 *     so the exact price on the page confirms rather than shocks (the quote is photo-based, so a
 *     range is honest). The actual quote sits in the lower-middle of the range, so the on-page
 *     reveal usually feels fair or a touch below.
 *  2. STYLE — tone/framing varies by who the customer is (homeowner vs landlord vs business vs
 *     tenant), defaulted from customerType but overridable at generation. Plus a 'delay' style
 *     that opens with a brief apology when the quote went out late.
 *
 * The LLM-written `contextualMessage` (job-specific, personalised) stays as the middle of every
 * style — styles only wrap it with greeting / price-range+link-intro / closing.
 */

export type MessageStyleId = 'friendly' | 'professional' | 'efficient' | 'reassuring' | 'delay';

/** The set offered in the generator dropdown (label + one-line hint). */
export const MESSAGE_STYLES: { id: MessageStyleId; label: string; hint: string }[] = [
  { id: 'friendly', label: 'Friendly', hint: 'Warm & casual — homeowners' },
  { id: 'professional', label: 'Professional', hint: 'Concise & businesslike — businesses' },
  { id: 'efficient', label: 'Hands-off', hint: 'End-to-end, no hassle — landlords/agents' },
  { id: 'reassuring', label: 'Reassuring', hint: 'Extra warmth, no surprises — tenants/cautious' },
  { id: 'delay', label: 'Apology for delay', hint: 'Opens with a brief sorry-for-the-wait' },
];

/** Default style from the structured customerType (overridable at generation). */
export function defaultStyleForCustomerType(ct?: string | null): MessageStyleId {
  switch (ct) {
    case 'business':
      return 'professional';
    case 'landlord':
    case 'property_manager':
    case 'letting_agent':
      return 'efficient';
    case 'tenant':
      return 'reassuring';
    case 'homeowner':
    default:
      return 'friendly';
  }
}

/**
 * Pre-anchor band: ~−10%/+12% around the quote, rounded to clean numbers (£5 under £100, £10
 * over), so the actual price lands in the lower-middle of the stated range. Returns '' for a
 * zero/invalid price so callers can fall back to a no-range line.
 */
export function priceRangeText(finalPricePence: number): string {
  const p = Math.max(0, finalPricePence || 0) / 100;
  if (p <= 0) return '';
  const step = p < 100 ? 5 : 10;
  const low = Math.max(step, Math.floor((p * 0.9) / step) * step);
  const high = Math.ceil((p * 1.12) / step) * step;
  return `£${low}–£${high}`; // £low–£high (en dash)
}

interface BuildQuoteMessageCtx {
  styleId: MessageStyleId;
  firstName: string;
  contextualMessage: string; // LLM personalised body (kept in every style)
  whatsappClosing: string; // LLM closing (used unless a style overrides it)
  quoteUrl: string;
  finalPricePence: number;
  batchNudge?: string; // single-job "anything else while we're there?"
  delayReason?: string; // optional, surfaced by the 'delay' style
}

/** Assemble the final WhatsApp message string for the chosen style. */
export function buildQuoteMessage(ctx: BuildQuoteMessageCtx): string {
  const { firstName, contextualMessage, whatsappClosing, quoteUrl, finalPricePence, batchNudge = '', delayReason } = ctx;
  const range = priceRangeText(finalPricePence);
  const reason = (delayReason || '').trim();

  // Each style → { greeting, linkIntro (carries the price range + the link cue), closing }.
  const styles: Record<MessageStyleId, { greeting: string; linkIntro: string; closing: string }> = {
    friendly: {
      greeting: `Hey ${firstName},`,
      linkIntro: range
        ? `Likely around ${range} all-in — here's the full breakdown so you can see exactly what's included, and pick a slot:`
        : `Here's the full breakdown so you can see what's included, and pick a slot:`,
      closing: whatsappClosing,
    },
    professional: {
      greeting: `Hi ${firstName},`,
      linkIntro: range
        ? `Estimated ${range} for the work. Full itemised quote and booking here:`
        : `Your itemised quote and booking are here:`,
      closing: whatsappClosing || 'Any questions, just reply here. Thanks.',
    },
    efficient: {
      greeting: `Hi ${firstName},`,
      linkIntro: range
        ? `Around ${range} — and we handle it end to end (access, photos, invoice), so it's hands-off for you. Quote + booking:`
        : `We handle it end to end (access, photos, invoice) — quote + booking here:`,
      closing: whatsappClosing,
    },
    reassuring: {
      greeting: `Hi ${firstName},`,
      linkIntro: range
        ? `It'll be in the region of ${range}. Everything's laid out here with no surprises — have a look and choose a time that suits:`
        : `Everything's laid out here with no surprises — have a look and choose a time that suits:`,
      closing: whatsappClosing,
    },
    delay: {
      greeting: reason
        ? `Hi ${firstName}, really sorry for the wait getting this over to you — ${reason}.`
        : `Hi ${firstName}, sorry for the wait getting this over to you.`,
      linkIntro: range
        ? `Here's your quote — around ${range} all-in. Full breakdown + book here:`
        : `Here's your quote — full breakdown + book here:`,
      closing: whatsappClosing || 'Thanks for your patience — any questions, just shout.',
    },
  };

  const s = styles[ctx.styleId] || styles.friendly;

  const lines: string[] = [s.greeting];
  if (contextualMessage?.trim()) lines.push('', contextualMessage.trim());
  lines.push('', s.linkIntro, quoteUrl);
  if (s.closing?.trim()) lines.push('', s.closing.trim());

  return lines.join('\n') + (batchNudge || '');
}
