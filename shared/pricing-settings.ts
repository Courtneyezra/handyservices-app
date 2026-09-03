/** One distance→fee band for the travel cost bucket. First band whose
 *  `maxMiles` covers the job distance wins. The top band should use a large
 *  `maxMiles` (e.g. 9999) since JSON can't store Infinity. */
export interface TravelBand {
  /** Inclusive upper bound of this band, in miles */
  maxMiles: number;
  /** Flat travel fee in pence for jobs that fall in this band */
  feePence: number;
}

// ── "Irresistible offer" interstitial (Admiral-style 3-step quote flow) ──────
// A configurable, single-question offer screen shown BETWEEN the branded waiting
// screen and the quote (gated by the ?v=offer test variant). The set of offers
// lives in settings so they can be edited / swapped / A-B tested without a deploy.
//
// flex_date is the launch offer: it reuses the server-authoritative pricing-lane
// maths (server/lane-pricing.ts). The "saving" is the firm-date premium a
// lane-eligible customer avoids by staying flexible — NOT a new rebate — so the
// price the customer sees always matches what the server charges. The screen is
// only shown for offers that have a real lever for the quote (flex_date requires
// a lane-eligible quote: a non-landlord, non-business customer).
// welcome_gift (Aug 2026): the theatre became a WELCOME GIFT — a first-time
// customer with a big-enough quote picks ONE small job from the addon menu
// free ("give, not upsell"). Paid add-ons moved onto the quote card itself.
export type QuoteOfferType = 'flex_date' | 'add_task' | 'membership' | 'welcome_gift';

// The visual layout an offer renders with. Each is a distinct, full-screen
// design in client/src/components/quote/offer-templates/. Copy is shared across
// templates (same QuoteOffer fields); the template only changes the chrome, so
// any offer can be shown in any layout and A/B-tested on design alone.
//   - dark_hero: bold dark navy hero band + savings pill (the launch design)
//   - split:     two-panel — value/price rail beside the offer + benefits
//   - minimal:   light, editorial, centered; whitespace-led, no dark band
//   - at_home:   warm cream editorial; hand-underlined saving + trust strip
//                (built for the homeowner flex-save offer)
export type QuoteOfferTemplate = 'dark_hero' | 'split' | 'minimal' | 'at_home';

export const QUOTE_OFFER_TEMPLATES: { id: QuoteOfferTemplate; label: string; blurb: string }[] = [
  { id: 'dark_hero', label: 'Dark hero', blurb: 'Bold dark navy hero band with a green savings pill.' },
  { id: 'split', label: 'Split panel', blurb: 'Two-panel: price/value rail beside the offer & benefits.' },
  { id: 'minimal', label: 'Minimal', blurb: 'Light, editorial, whitespace-led. No dark band.' },
  { id: 'at_home', label: 'At home', blurb: 'Warm cream editorial; hand-underlined saving + brand trust strip.' },
];

// The customer type an offer group is scoped to. These mirror the six canonical
// values the contextual quote already carries (contextSignals.customerType), so
// offers can be configured + A/B-tested independently per customer type. Each
// type can run a different offer (e.g. flex_date only has a £ lever for
// lane-eligible homeowners/tenants; a landlord or business needs another offer).
export type QuoteOfferCustomerType =
  | 'homeowner' | 'oap_homeowner' | 'landlord' | 'property_manager' | 'tenant' | 'business' | 'letting_agent';

export const QUOTE_OFFER_CUSTOMER_TYPES: { id: QuoteOfferCustomerType; label: string }[] = [
  { id: 'homeowner', label: 'Homeowner' },
  { id: 'oap_homeowner', label: 'OAP Homeowner' },
  { id: 'landlord', label: 'Landlord' },
  { id: 'property_manager', label: 'Property Manager' },
  { id: 'tenant', label: 'Tenant' },
  { id: 'business', label: 'Business' },
  { id: 'letting_agent', label: 'Letting Agent' },
];

export interface QuoteOfferBenefit {
  /** Icon key the interstitial maps to a lucide icon (calendar | shield | wallet | clock | star | check). */
  icon: string;
  /** Benefit line. Supports {savings} {days} {base} {firm} tokens. */
  text: string;
}

export interface QuoteOffer {
  id: string;
  type: QuoteOfferType;
  enabled: boolean;
  /** Which full-screen layout this offer renders in. Defaults to 'dark_hero'. */
  template?: QuoteOfferTemplate;
  /** Human label for the admin list (e.g. "Stay flexible — dark"). Falls back to id. */
  name?: string;
  /** Relative weight for 'weighted' A/B selection. Ignored in 'first'/'manual' mode. */
  weight: number;
  /** Small eyebrow label above the headline. */
  eyebrow?: string;
  /** Headline. Supports {savings} {days} {base} {firm} tokens. */
  headline: string;
  /** Sub-headline under the headline. Same tokens. */
  subhead?: string;
  /** Benefit rows shown with brand-green circular icons (typically 3). */
  benefits: QuoteOfferBenefit[];
  /** Primary CTA (accept) label. Same tokens. */
  acceptLabel: string;
  /** Secondary CTA (decline) label. */
  declineLabel: string;
  /** Fine print under the buttons. Same tokens. */
  finePrint?: string;
  /** flex_date: how many days the flexible window spans (default 7). */
  flexWithinDays?: number;
}

/** A self-contained set of offers + how one is chosen from it. The top-level
 *  config is the default group; each customer type can optionally override it
 *  with its own group (see `perCustomerType`). */
export interface QuoteOfferGroup {
  /**
   * How the active offer is chosen for a given quote:
   *   - 'manual'   = always show the single offer named by `activeOfferId`
   *                  (everyone sees the same one). Falls back to the first
   *                  enabled offer if the id is missing/disabled.
   *   - 'weighted' = deterministic A/B by quote slug across all enabled offers.
   *   - 'first'    = legacy alias; behaves like the first enabled offer.
   */
  selectionMode: 'manual' | 'weighted' | 'first';
  /** The chosen offer id when selectionMode === 'manual'. */
  activeOfferId?: string;
  items: QuoteOffer[];
  /**
   * Per-customer-type gate (ignored on the default group). When explicitly
   * `false`, this customer type shows NO offer (skips straight to the price) —
   * an intentional opt-out with no fallback. When absent/true, the group's
   * offers apply. A customer type with no group at all inherits the default.
   */
  enabled?: boolean;
}

export interface QuoteOffersConfig extends QuoteOfferGroup {
  /** Master gate. When false, the ?v=offer interstitial is skipped entirely. */
  enabled: boolean;
  /**
   * Optional per-customer-type overrides. A type present here uses its own
   * group (its own offers + selection mode); a type absent inherits the
   * default group (the top-level selectionMode/activeOfferId/items). This is
   * how the same flow runs a different offer per customer type, each one
   * independently manual (single offer) now → weighted (A/B) later.
   */
  perCustomerType?: Partial<Record<QuoteOfferCustomerType, QuoteOfferGroup>>;
}

// ── Add-on task menu (the 'add_task' offer) ─────────────────────────────────
// A pre-priced menu of small extra jobs shown on the offer interstitial:
// "Craig's already coming — add another job, ~25% off". Prices/minutes are
// server-stored so payment stays server-authoritative (the client never sends
// pence), and `scheduleMinutes` is added to the availability fetch's
// timeEstimateMinutes so the calendar stays capacity-true.
export interface AddonMenuItem {
  /** Stable id the client sends back when the customer taps an item. */
  id: string;
  /** Customer-facing label ("Re-seal your bath or shower"). */
  label: string;
  /** The add-on price in pence — already ~25% below the observed median. */
  pricePence: number;
  /** Realistic on-site minutes; feeds timeEstimateMinutes for availability. */
  scheduleMinutes: number;
  /** Category slug matching pricing_line_items.category (e.g. plumbing_minor). */
  category: string;
}

export interface PricingSettings {
  // Margins & Deposits
  materialsMarginPercent: number;      // default 27
  /**
   * P8 Route A (4 Sep 2026): the fixed paid-survey fee the spine offers when the clerk says
   * `visit_first` (server/spine/survey-offer.ts). Credited to the job. A setting, never a
   * hardcode: the survey-offer draft cites `price_source=settings` for the money guard.
   */
  surveyFeePence: number;              // default 4900 (£49)
  depositPercent: number;              // default 30
  payInFullDiscountPercent: number;    // default 3

  // EVE reference contingency — a uniform % uplift baked into the per-category
  // reference rate (hourly + minimum charge + calculated reference). It builds an
  // invisible buffer into every quote so a small extra task or minor overrun is
  // absorbed without re-quoting or bumping the headline price. EVE-consistent:
  // the buffer lives INSIDE the reference anchor (Price = Reference + Differentiators),
  // NOT in padded time — so `estimatedMinutes` stays an honest dispatch metric.
  // 0 = exact no-op (default); live prices are unchanged until this is set.
  referenceContingencyPercent: number; // default 0 (suggested 8–12 once reviewed)

  // Booking Rules
  flexibleDiscountPercent: number;     // default 10
  urgentPremiumPercent: number;        // default 25
  depositSplitThresholdPence: number;  // default 15000 (£150)
  maxBatchDiscountPercent: number;     // default 15
  minMarginPencePerHour: number;       // default 6000 (£60/hr)

  // ── Decomposed pricing (two-part tariff + structural cost buckets) ────────
  // OFF by default. When `decomposedPricingEnabled` is false the engine
  // ignores every field in this block and prices EXACTLY as before — a perfect
  // no-op. These restore the fixed/structural costs the EVE labour layer omits
  // (the gap that forced operators to inflate TIME to lift price): a per-visit
  // attendance / call-out charge, a flat travel band, and a one-off
  // materials-collection trip charge. They are ADDED on top of per-line labour
  // (+ materials), then the total is governed by a market-bracket ceiling.
  // Flip the flag ON only after reviewing the backtest fit.
  decomposedPricingEnabled: boolean;   // default false — master gate
  // The per-visit call-out / first-hour fixed charge. This is the fixed half of
  // the two-part tariff; the existing per-category hourly rates serve as the
  // marginal half, so no separate marginal-rate dial is needed.
  attendanceFeePence: number;
  materialCollectionFeePence: number;  // once per quote when any line needs a collection trip
  travelBands: TravelBand[];           // distance→fee bands; first match wins; [] = no travel charge
  // Soft governor: FLAG (don't clamp) when the total exceeds
  // `multiplier × Σ(category high × hours)` across lines (top of the customer's
  // mental handyman bracket). Backtest: a HARD cap here would clamp 76% of
  // historically-accepted quotes — accepting customers routinely pay well above
  // the generic-handyman bracket — so this is review-only. 0 = governor off.
  bracketCeilingMultiplier: number;

  // Social Proof
  googleRating: string;               // default "4.9"
  reviewCount: number;                 // default 127
  propertiesServed: string;            // default "230+"
  jobsCompleted: string;              // default "500+"

  // Irresistible-offer interstitial (?v=offer test flow). See QuoteOffersConfig.
  quoteOffers: QuoteOffersConfig;

  // Pre-priced small-job menu for the 'add_task' offer. See AddonMenuItem.
  addonMenu: AddonMenuItem[];

  // ── Welcome gift (the 'welcome_gift' offer) ────────────────────────────────
  // Eligibility floor: the quote's basePrice must be at least this for the
  // free-task gift to show (the gift is a thank-you on a real job, not a way
  // to get a £39 task done free on a £60 quote).
  welcomeGiftMinQuotePence: number;    // default 20000 (£200)
  // Gift pool cap: only addonMenu items at or under this many on-site minutes
  // qualify as a pickable gift ("one SMALL job, on us").
  welcomeGiftMaxMinutes: number;       // default 45
}

export const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  materialsMarginPercent: 27,
  surveyFeePence: 4900,
  depositPercent: 30,
  payInFullDiscountPercent: 3,
  referenceContingencyPercent: 0,      // OFF — set to ~10 to bake a contingency buffer into every quote
  flexibleDiscountPercent: 10,
  urgentPremiumPercent: 25,
  depositSplitThresholdPence: 15000,
  maxBatchDiscountPercent: 15,
  minMarginPencePerHour: 6000,

  // Decomposed pricing — OFF by default. Fee defaults are the backtest-fitted
  // values (n=90 accepted quotes, MAE ~£69 / 20% on a £340 mean total) and only
  // take effect once `decomposedPricingEnabled` is flipped true.
  decomposedPricingEnabled: false,
  attendanceFeePence: 2500,            // £25/visit (fitted; loosely identified £25–£35)
  materialCollectionFeePence: 2000,    // £20 (assumption — flag unused on 0/90 historical quotes)
  travelBands: [
    { maxMiles: 8, feePence: 0 },      // free inside 8 miles
    { maxMiles: 14, feePence: 2000 },  // £20 per 6-mile band beyond
    { maxMiles: 20, feePence: 4000 },
    { maxMiles: 9999, feePence: 6000 },
  ],
  bracketCeilingMultiplier: 0,         // soft governor off (hard cap would clamp 76% of accepted quotes)

  googleRating: "4.9",
  reviewCount: 127,
  propertiesServed: "230+",
  jobsCompleted: "500+",

  quoteOffers: {
    enabled: true,
    selectionMode: "manual",
    activeOfferId: "welcome_gift_v1",
    items: [
      // ── ACTIVE: the welcome-gift theatre offer ─────────────────────────
      // Owner decision (Aug 2026): the theatre GIVES instead of upselling. A
      // first-time customer whose quote clears welcomeGiftMinQuotePence picks
      // ONE small job (addonMenu items ≤ welcomeGiftMaxMinutes) done free on
      // the same visit. Eligibility is server-computed (welcomeGiftEligible on
      // the quote payload) and re-validated server-side at payment. Paid
      // add-ons now live on the quote card itself, after the price.
      {
        id: "welcome_gift_v1",
        type: "welcome_gift",
        enabled: true,
        template: "dark_hero",
        name: "Welcome gift — free small task",
        weight: 1,
        eyebrow: "A little welcome from us",
        headline: "While he's there, pick one small job — *on us*",
        subhead: "Your welcome gift, done on the same visit. Choose one:",
        benefits: [
          { icon: "star", text: "Completely free — our welcome to you" },
          { icon: "clock", text: "Done on the same visit as your quoted job" },
          { icon: "shield", text: "Same workmanship guarantee as the paid work" },
        ],
        acceptLabel: "Claim my free task",
        declineLabel: "No thanks, just my quote",
        finePrint: "One free task per new customer, done alongside your booked job. You'll see it on your quote as a £0 line.",
      },
      // ── RETIRED: the add-task theatre offer (kept for reference/rollback).
      // Paid add-ons moved onto the quote card ("Craig's already coming — add
      // a small job, ~25% off" section under the price), so the interstitial
      // no longer pitches them.
      {
        id: "add_task_v1",
        type: "add_task",
        enabled: false,
        template: "dark_hero",
        name: "Add a small job — dark hero",
        weight: 1,
        eyebrow: "One quick thing before your price",
        headline: "Craig's already coming — add a small job, save ~25%",
        subhead: "He's on site anyway, so these extras are cheaper than booking them alone. Tap any that need doing.",
        benefits: [
          { icon: "wallet", text: "Around 25% less than booking it separately" },
          { icon: "clock", text: "Done on the same visit — no second call-out" },
          { icon: "shield", text: "Same fixed price and workmanship guarantee" },
        ],
        acceptLabel: "Add these to my visit",
        declineLabel: "No thanks, just the quoted job",
        finePrint: "Anything you add appears as its own line on your quote — you'll see the full fixed price next.",
      },
      {
        id: "flex_date_v1",
        type: "flex_date",
        enabled: false,
        template: "dark_hero",
        name: "Stay flexible — dark hero",
        weight: 1,
        eyebrow: "One quick choice before your price",
        headline: "Stay flexible",
        subhead: "Pick any available day — same fixed price.",
        benefits: [
          { icon: "calendar", text: "Choose any available day on the calendar" },
          { icon: "shield", text: "Same fixed price and workmanship guarantee" },
          { icon: "wallet", text: "Skip the {savings} firm date & time fee" },
        ],
        acceptLabel: "Save {savings} — I'm flexible",
        declineLabel: "No thanks, I need a specific day",
        finePrint:
          "Prefer a guaranteed date and arrival slot? Pick your exact day on the next screen for {firm}.",
        flexWithinDays: 7,
      },
      {
        id: "flex_date_minimal",
        type: "flex_date",
        enabled: false,
        template: "minimal",
        name: "Stay flexible — minimal",
        weight: 1,
        eyebrow: "One quick choice",
        headline: "Save {savings} — stay flexible",
        subhead:
          "Pick any available day. Same fixed price, same guarantee.",
        benefits: [
          { icon: "calendar", text: "You choose the day from live availability" },
          { icon: "wallet", text: "Skip the {savings} firm date & time fee" },
          { icon: "shield", text: "Same fixed price + 12-month workmanship guarantee" },
        ],
        acceptLabel: "Save {savings} — I'm flexible",
        declineLabel: "I need a specific day",
        finePrint: "Want a guaranteed day & arrival window? Choose it next for {firm}.",
        flexWithinDays: 7,
      },
    ],
    // Per-customer-type overrides. The homeowner group now runs the
    // welcome_gift offer (add_task moved onto the quote card; the retired
    // flex_save_homeowner item below is kept disabled for reference/rollback).
    // Other types inherit the default group above until they get one.
    perCustomerType: {
      homeowner: {
        selectionMode: "manual",
        activeOfferId: "welcome_gift_v1",
        items: [
          {
            id: "welcome_gift_v1",
            type: "welcome_gift",
            enabled: true,
            template: "dark_hero",
            name: "Welcome gift — homeowner",
            weight: 1,
            eyebrow: "A little welcome from us",
            headline: "While he's there, pick one small job — *on us*",
            subhead: "Your welcome gift, done on the same visit. Choose one:",
            benefits: [
              { icon: "star", text: "Completely free — our welcome to you" },
              { icon: "clock", text: "Done on the same visit as your quoted job" },
              { icon: "shield", text: "Same workmanship guarantee as the paid work" },
            ],
            acceptLabel: "Claim my free task",
            declineLabel: "No thanks, just my quote",
            finePrint: "One free task per new customer, done alongside your booked job. You'll see it on your quote as a £0 line.",
          },
          {
            id: "add_task_v1",
            type: "add_task",
            enabled: false,
            template: "dark_hero",
            name: "Add a small job — homeowner (retired — add-ons live on the quote card now)",
            weight: 1,
            eyebrow: "One quick thing before your price",
            headline: "Craig's already coming — add a small job, save ~25%",
            subhead: "He's on site anyway, so these extras are cheaper than booking them alone. Tap any that need doing.",
            benefits: [
              { icon: "wallet", text: "Around 25% less than booking it separately" },
              { icon: "clock", text: "Done on the same visit — no second call-out" },
              { icon: "shield", text: "Same fixed price and workmanship guarantee" },
            ],
            acceptLabel: "Add these to my visit",
            declineLabel: "No thanks, just the quoted job",
            finePrint: "Anything you add appears as its own line on your quote — you'll see the full fixed price next.",
          },
          {
            id: "flex_save_homeowner",
            type: "flex_date",
            enabled: false,
            template: "at_home",
            name: "Flex-save — at home (homeowner)",
            weight: 1,
            // Anchor-free copy (at_home template): only the {savings} amount is
            // shown — never the base/firm TOTALS — so the offer quantifies the
            // saving without anchoring the price. The headline *star* span gets
            // the hand-drawn underline. The full fixed price lands on the quote.
            eyebrow: "one quick choice",
            // "busy" earns its place: it primes the packed-route story the map
            // below acts out — his day is full, and that's why the saving exists.
            headline: "Slot into Craig's busy diary? *You save {savings}*.",
            // Subhead removed — the first benefit ("We slot you into Craig's diary")
            // carries the mechanism, and dropping it keeps the offer to one mobile
            // viewport with no scroll.
            // Punchy all-gain trio (23 Jul): one line each, parallel rhythm —
            // speed guaranteed, control kept, money saved. The REASON-WHY now
            // lives in the headline ("busy diary") + the route map acting it
            // out, so the bullets can just be the no-brainer. Long clauses
            // (2-days-ahead text promise) surface later in the day picker.
            benefits: [
              { icon: "calendar", text: "Pick any available day — you choose" },
              { icon: "check", text: "Same job, same guarantee" },
              { icon: "wallet", text: "{savings} off the firm date & time price" },
            ],
            acceptLabel: "Slot me in — save {savings}",
            declineLabel: "I need a specific day",
            // Reversibility stated in the FINE PRINT deliberately: it lowers
            // accept-anxiety (the #1 decline driver on a "one quick choice"
            // framing) without cheapening the accept moment up in the headline.
            finePrint: "You'll see your full fixed price next — and you can still switch to an exact day there.",
            flexWithinDays: 14,
          },
        ],
      },
    },
  },

  // Add-on task menu — derived from quote history (Aug 2026): the 8 most
  // frequent small line items (≤90 min, ≤£90) across the last 12 months of
  // real personalized_quotes.pricing_line_items (test quotes scrubbed), each
  // priced ~25% below its observed median and rounded to a friendly ending.
  // Median £ / minutes noted per item for future re-calibration.
  addonMenu: [
    { id: "addon_reseal_silicone", label: "Re-seal bath or shower silicone", pricePence: 3900, scheduleMinutes: 45, category: "silicone_sealant" },     // n=31, med £55 / 45min
    { id: "addon_patch_paint", label: "Patch & repaint a wall spot", pricePence: 4900, scheduleMinutes: 45, category: "painting" },                     // n=35, med £65 / 45min
    { id: "addon_blind_curtain", label: "Hang a blind or curtain pole", pricePence: 3900, scheduleMinutes: 45, category: "curtain_blinds" },            // n=23, med £55 / 45min
    { id: "addon_door_adjust", label: "Fix a sticking door or hinge", pricePence: 4900, scheduleMinutes: 45, category: "door_fitting" },                // n=19, med £65 / 45min
    { id: "addon_door_handle", label: "Replace a door handle or latch", pricePence: 5500, scheduleMinutes: 45, category: "door_fitting" },              // n=16, med £71.50 / 45min
    { id: "addon_tv_mount", label: "Mount a TV on the wall", pricePence: 5500, scheduleMinutes: 75, category: "tv_mounting" },                          // n=12, med £73 / 75min
    { id: "addon_leaking_tap", label: "Fix a leaking or dripping tap", pricePence: 5900, scheduleMinutes: 45, category: "plumbing_minor" },             // n=11, med £84 / 45min
    { id: "addon_hang_mirror", label: "Hang a mirror or pictures", pricePence: 3900, scheduleMinutes: 60, category: "general_fixing" },                 // n=11, med £55 / 60min
  ],

  // Welcome gift — see the welcome_gift offer above. Server-enforced.
  welcomeGiftMinQuotePence: 20000,     // gift only on quotes ≥ £200
  welcomeGiftMaxMinutes: 45,           // gift pool = addonMenu items ≤ 45 min
};

/**
 * P16 — THE deposit rule. One definition, used by Ben's price screen, the confirm line, the quote
 * row the chain writes, the customer's quote page and Stripe.
 *
 * 100 % of materials (at margin, what the customer pays for them) plus `depositPercent` of labour,
 * rounded to the pound. We buy the materials before anyone turns up, so the deposit covers them in
 * full and takes a share of the labour on top.
 *
 * This is the rule the business already runs on, confirmed against production on 3 Sep 2026: six of
 * the eight most recent paid quotes match it to the pound (ao502s1y £179, m44nd9z0 £756, 9weuajqj
 * £202, 59urxtlo £2,333, dles0479 £1,684, ml8cyy2z £135); the two that do not were small jobs paid
 * in full. `client/src/pages/PersonalizedQuotePage.tsx calculateDeposit` and
 * `server/stripe-routes.ts calculateDeposit` both compute it, so it is what the customer is shown
 * and what the card is charged.
 *
 * P16 first shipped this as `depositPercent` of the total, which is what the Route A chain had been
 * storing on the quote row. That was the outlier, not the rule: on Sarah's £2,100 quote it would
 * have shown Ben £630 while the card took £1,533. Ben's screen and the chain's quote row now agree
 * with the page and the card instead. Nothing a customer pays changed.
 */
export function depositFor(totalPence: number, materialsPence: number, depositPercent: number): number {
    if (!Number.isFinite(totalPence) || totalPence <= 0) return 0;
    const pct = Number.isFinite(depositPercent) ? depositPercent : DEFAULT_PRICING_SETTINGS.depositPercent;
    const mats = Number.isFinite(materialsPence) ? Math.max(0, Math.min(materialsPence, totalPence)) : 0;
    const labour = totalPence - mats;
    return Math.round((mats + Math.round(labour * (pct / 100))) / 100) * 100;
}
