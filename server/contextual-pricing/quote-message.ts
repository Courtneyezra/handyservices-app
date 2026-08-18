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
    case 'oap_homeowner':
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
  /** In-chat card only: one short line acknowledging what the customer sent
   *  (photos, video, their description) — sits right after the greeting so the
   *  message reads like the same person who was just talking to them. */
  threadContextLine?: string;
  /** In-chat card only: swap the closing for one that says the service is
   *  complete on the link (full details + price) AND that they can ask any
   *  questions right here in this chat — the thread stays the support channel. */
  chatClose?: boolean;
}

/** Assemble the final WhatsApp message string for the chosen style. */
export function buildQuoteMessage(ctx: BuildQuoteMessageCtx): string {
  const { firstName, contextualMessage, quoteUrl, finalPricePence, batchNudge = '', delayReason } = ctx;
  const range = priceRangeText(finalPricePence);
  const reason = (delayReason || '').trim();

  // Each style → { greeting, linkIntro (carries the price range + the link cue), closing }.
  //
  // CLOSINGS ARE DETERMINISTIC AND BOOKING-FORWARD (12 Aug 2026). The LLM
  // closing used to end the message ("Happy to get that sorted. Just let me
  // know when suits.") — which reads as "reply to arrange", so customers
  // bounced into a WhatsApp back-and-forth instead of tapping the link where
  // date-picking, extras and payment are all self-serve. Every closing now
  // points INTO the link as the way to book; "reply here" is only offered for
  // questions. `whatsappClosing` still exists on the quote for on-page use.
  const styles: Record<MessageStyleId, { greeting: string; linkIntro: string; closing: string }> = {
    friendly: {
      greeting: `Hey ${firstName},`,
      linkIntro: range
        ? `Likely around ${range} all-in — here's the full breakdown so you can see exactly what's included, and pick a slot:`
        : `Here's the full breakdown so you can see what's included, and pick a slot:`,
      closing: `Pick whichever day suits you in the link — takes about a minute and you're booked in. Any questions, just message me here.`,
    },
    professional: {
      greeting: `Hi ${firstName},`,
      linkIntro: range
        ? `Estimated ${range} for the work. Full itemised quote and booking here:`
        : `Your itemised quote and booking are here:`,
      closing: `Booking is self-serve in the link — choose a date and it's confirmed straight away. Any questions, reply here.`,
    },
    efficient: {
      greeting: `Hi ${firstName},`,
      linkIntro: range
        ? `Around ${range} — and we handle it end to end (access, photos, invoice), so it's hands-off for you. Quote + booking:`
        : `We handle it end to end (access, photos, invoice) — quote + booking here:`,
      closing: `Pick a date in the link and it's locked in — we take it from there. Any questions, just reply.`,
    },
    reassuring: {
      greeting: `Hi ${firstName},`,
      linkIntro: range
        ? `It'll be in the region of ${range}. Everything's laid out here with no surprises — have a look and choose a time that suits:`
        : `Everything's laid out here with no surprises — have a look and choose a time that suits:`,
      closing: `When you're ready, choose a day in the link and you're booked — nothing else to do. I'm here if anything's unclear.`,
    },
    delay: {
      greeting: reason
        ? `Hi ${firstName}, really sorry for the wait getting this over to you — ${reason}.`
        : `Hi ${firstName}, sorry for the wait getting this over to you.`,
      linkIntro: range
        ? `Here's your quote — around ${range} all-in. Full breakdown + book here:`
        : `Here's your quote — full breakdown + book here:`,
      closing: `Thanks for your patience — pick a day in the link when you're ready and you're booked in.`,
    },
  };

  // In-chat variant closings (chatClose): same booking-forward beat, but woven with
  // "everything's complete on the link" + "ask any questions right here in this chat".
  // Written dash-free on purpose — this path goes straight into a customer chat where
  // the voice hard rule is no em dashes (feedback-customer-comms-style).
  const chatClosings: Record<MessageStyleId, string> = {
    friendly: `Everything's on the link, the full breakdown, the price and picking a day, takes about a minute and you're booked in. Any questions at all, just ask me here.`,
    professional: `The link has everything, itemised pricing and self serve booking, choose a date and it's confirmed straight away. Happy to answer any questions here.`,
    efficient: `It's all on the link, price, details and booking, pick a date and it's locked in, we take it from there. Any questions, just reply here.`,
    reassuring: `Everything is laid out on the link with no surprises, the full price and details, and when you're ready you can choose a day right there. If anything's unclear just ask me here and I'll talk you through it.`,
    delay: `Thanks for your patience. Everything's on the link, full details and price, pick a day there when you're ready. Any questions, just ask me here.`,
  };

  const s = styles[ctx.styleId] || styles.friendly;
  const closing = ctx.chatClose ? chatClosings[ctx.styleId] || chatClosings.friendly : s.closing;

  const lines: string[] = [s.greeting];
  if (ctx.threadContextLine?.trim()) lines.push('', ctx.threadContextLine.trim());
  if (contextualMessage?.trim()) lines.push('', contextualMessage.trim());
  lines.push('', s.linkIntro, quoteUrl);
  if (closing?.trim()) lines.push('', closing.trim());

  return lines.join('\n') + (batchNudge || '');
}
