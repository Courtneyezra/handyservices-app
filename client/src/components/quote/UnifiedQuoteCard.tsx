import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check, Calendar, CalendarCheck, CalendarRange, Clock, Tag, Shield, Zap,
  ChevronRight, ChevronDown, Percent, Sparkles, Star, Plus,
  Phone, Camera, Timer, Lock, CreditCard, Loader2, AlertCircle, MessageCircle, User,
  PencilRuler, MapPin, Receipt, UserCheck, BadgeCheck, Share2
} from 'lucide-react';
import { CardBrandStrip } from './CardBrandLogos';
import { SkuIcon } from '@/lib/sku-icons';
import { QuoteAddressInput } from '@/components/quote/QuoteAddressInput';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { format, addDays, isWeekend } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { CardNumberElement, CardExpiryElement, CardCvcElement, ExpressCheckoutElement, useStripe, useElements } from '@stripe/react-stripe-js';
import type { StripeExpressCheckoutElementConfirmEvent } from '@stripe/stripe-js';
import { isStripeConfigured } from '@/lib/stripe';
import { getHassleComparisons } from '@shared/hassle-comparisons';
import type { PriceBuckets } from '@shared/contextual-pricing-types';
import { trackBookingModeInteraction } from '@/lib/quote-analytics';
import {
  BASE_SCHEDULING_RULES,
  BASE_TIME_SLOTS,
  getSchedulingConfig,
  getTimeSlotsForSegment,
  type TimeSlotOption,
  type AddOnOption,
} from './SchedulingConfig';
import {
  useAvailability,
  useQuoteAvailability,
  countAvailableDatesThisWeek,
  formatDateStr,
  reserveSlot,
  releaseSlotLock,
  type SlotReservation,
} from '@/hooks/useAvailability';
import { StickyTimerProgress } from './QuoteTimerContext';

/** Which booking options to show on the card */
export type QuoteBookingMode = 'standard_date' | 'flexible_discount' | 'urgent_premium' | 'deposit_split';

/** A single pricing line item from the contextual pricing engine */
export interface PricingLineItem {
  lineId: string;
  description: string;
  category: string;
  /** Internal capacity-scheduling field — never rendered to the customer */
  timeEstimateMinutes: number;
  guardedPricePence: number;
  /** Material cost with margin (what customer pays). 0 if no materials. */
  materialsWithMarginPence?: number;
  /**
   * Decomposed pricing — this line's allocated share of the job-whole structural
   * buckets (call-out + travel + collection), folded into the displayed price so
   * the customer sees one blended figure per line (no separate call-out row).
   * 0/absent on legacy/flag-off quotes ⇒ unchanged.
   */
  structuralSharePence?: number;
  // ── Phase 25 SKU-aware fields (spread by the engine when source === 'sku') ──
  // All optional + read defensively so legacy lines without these still render.
  /** 'sku' or 'custom'. Legacy lines may be undefined → treat as 'custom'. */
  source?: 'sku' | 'custom';
  /** Customer-facing SKU title (Agent 25a authored). */
  skuName?: string;
  /** Outcome-framed plain-English description (no hours, Agent 25a authored). */
  skuCustomerDescription?: string;
  /** Plain-English detail shown when a custom line is expanded. */
  customerDescription?: string;
  /** Per-unit SKUs ("× 3 doors") — `× ${unitCount} ${unitLabel}`. */
  unitCount?: number;
  /** Unit label (e.g. "door", "shelf"). */
  skuUnitLabel?: string;
  /** Tiered SKUs — selected tier label, e.g. "Medium". */
  selectedTier?: string;
  /** Per-line Saturday surcharge in pence (catalog row, 0 when not eligible). */
  offPeakWeekendPremiumPence?: number;
  /** When true, this line can be moved to a flex day. Falsy → not flex-eligible. */
  flexEligible?: boolean;
  /** SKU shape — drives the "Fixed price" vs per-unit/tier presentation. */
  skuShape?: 'fixed' | 'per_unit' | 'tiered';
  /** Per-SKU Lucide icon name (Phase 28/29). Null → resolved from category. */
  skuIcon?: string | null;
  /** Catalog code, e.g. TAP-KIT-01. */
  skuCode?: string;
}

/** Multi-job batch discount details */
export interface QuoteBatchDiscount {
  applied: boolean;
  discountPercent: number;
  savingsPence: number;
}

/**
 * One line on the customer quote. On typical quotes (≤4 lines) the row is
 * STATIC — badge, labour/materials split, and scope description are simply
 * shown, because the description is the price justification and no customer
 * gains from hiding it (or bothers to). On long quotes (5+ lines, collapsible
 * prop) the row falls back to the tap-to-expand accordion so the page stays
 * scannable. SKU lines read as solid product tiles (green icon), custom lines
 * as a "made-to-order" neutral icon.
 */
function QuoteLineRow({ item, isDarkTheme, displayPricePence, collapsible = false }: { item: PricingLineItem; isDarkTheme: boolean; displayPricePence?: number; collapsible?: boolean }) {
  const anyItem = item as any;
  const isSku = anyItem.source === 'sku';
  const title = anyItem.skuName || item.description;
  const customerDesc: string | null = anyItem.skuCustomerDescription || anyItem.customerDescription || anyItem.details || null;
  // Structured scope steps beat the prose paragraph: each step is a scannable
  // "that's included" hit. Paragraph remains the fallback for older quotes.
  const scopeSteps: string[] | null =
    Array.isArray(anyItem.scopeSteps) && anyItem.scopeSteps.length > 0 ? anyItem.scopeSteps : null;
  const [expanded, setExpanded] = useState(false);
  const open = collapsible ? expanded : true;
  const hasMaterials = (item.materialsWithMarginPence || 0) > 0;
  const lineTotal = item.guardedPricePence + (item.materialsWithMarginPence || 0);
  // Labour/materials split shown in the expanded row. Labour is derived from the
  // DISPLAYED total (which may include structural share) minus the customer
  // materials price, so the two figures always sum to the price on the row.
  const materialsDisplayPence = item.materialsWithMarginPence || 0;
  const labourDisplayPence = (displayPricePence ?? lineTotal) - materialsDisplayPence;

  let qualifier: string | null = null;
  let unitEach: string | null = null;
  if (isSku) {
    if (anyItem.unitCount && anyItem.unitCount > 0) {
      const unit = anyItem.skuUnitLabel || anyItem.unitLabel || '';
      qualifier = `× ${anyItem.unitCount}${unit ? ` ${unit}` : ''}`;
      if (anyItem.unitCount > 1 && item.guardedPricePence > 0) {
        unitEach = `£${Math.round(item.guardedPricePence / anyItem.unitCount / 100)} each`;
      }
    } else if (anyItem.selectedTier) {
      qualifier = String(anyItem.selectedTier);
    }
  }

  // Yellow line-item rows: a translucent yellow TINT (not a solid fill — solid
  // read as too loud next to the green CTAs) marks these as itemised content and
  // sets them apart from the amber premiums. Mirrors the original tinted-row
  // treatment, swapping the green accent for brand-adjacent yellow; the tinted
  // icon tile + yellow price (and the expanded badge) still distinguish SKU vs
  // tailored rows. Light text on the dark card, dark text on the light one.
  const cardClass = isDarkTheme
    ? 'bg-[#FACC15]/[0.16]'
    : 'bg-[#FACC15]/[0.14]';

  // Static rows with nothing beyond the badge to show (no description, no
  // materials split) skip the content block entirely — a lone badge under a
  // bare title is chrome, not information.
  const hasContent = Boolean(customerDesc) || Boolean(scopeSteps) || (hasMaterials && labourDisplayPence > 0);
  const HeaderTag = (collapsible ? 'button' : 'div') as 'button';

  return (
    <div className={`rounded-lg overflow-hidden ${cardClass}`}>
      <HeaderTag
        {...(collapsible
          ? { type: 'button' as const, onClick: () => setExpanded((o) => !o), 'aria-expanded': open }
          : {})}
        className={`w-full flex items-center gap-2.5 px-2.5 py-2 text-left ${collapsible ? 'active:scale-[0.995] transition-transform' : ''}`}
      >
        {isSku ? (
          <div className={`shrink-0 w-8 h-8 rounded-md flex items-center justify-center ${isDarkTheme ? 'bg-[#FACC15]/20 ring-1 ring-[#FACC15]/25' : 'bg-[#FACC15]/15 ring-1 ring-[#FACC15]/25'}`}>
            <SkuIcon
              name={anyItem.skuIcon}
              sku={{ icon: anyItem.skuIcon, category: item.category }}
              className={`w-4 h-4 ${isDarkTheme ? 'text-[#a3d65f]' : 'text-[#5b8a08]'}`}
            />
          </div>
        ) : (
          // Custom (made-to-order) line: no SKU, but the pricing engine still tags
          // every line with a JobCategory, so resolve the icon from that category
          // via the shared registry (same path SKU lines use). Kept neutral slate so
          // SKU (yellow icon) vs tailored (neutral) still read apart.
          <div className={`shrink-0 w-8 h-8 rounded-md flex items-center justify-center ${isDarkTheme ? 'bg-[#FACC15]/15 ring-1 ring-[#FACC15]/25' : 'bg-[#FACC15]/12 ring-1 ring-[#FACC15]/20'}`}>
            <SkuIcon
              sku={{ icon: null, category: item.category }}
              className={`w-4 h-4 ${isDarkTheme ? 'text-slate-300' : 'text-slate-500'}`}
            />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className={`text-[13px] font-semibold ${open ? 'break-words' : 'line-clamp-2'} ${isDarkTheme ? 'text-slate-100' : 'text-slate-900'}`}>{title}</span>
            {qualifier && (
              <span className={`shrink-0 text-[10.5px] font-semibold ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>{qualifier}</span>
            )}
          </div>
        </div>

        <span className={`shrink-0 text-[14px] font-bold tabular-nums ${isDarkTheme ? 'text-[#a3d65f]' : 'text-[#5b8a08]'}`}>£{Math.round((displayPricePence ?? lineTotal) / 100)}</span>
        {collapsible && (
          <ChevronDown className={`shrink-0 w-4 h-4 transition-transform duration-300 ${open ? 'rotate-180' : ''} ${isDarkTheme ? 'text-slate-500' : 'text-slate-400'}`} />
        )}
      </HeaderTag>

      {(collapsible || hasContent) && (
      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className="px-2.5 pb-2.5 flex flex-col gap-1.5">
            {/* Badge row — "Tailored to your job" was dropped: it added chrome
                without information. SKU lines keep the Fixed price trust badge. */}
            {(isSku || unitEach || anyItem.propertyTag) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {isSku && (
                <span className={`inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${isDarkTheme ? 'bg-[#7DB00E]/15 text-[#a3d65f]' : 'bg-[#7DB00E]/12 text-[#4d7a09]'}`}>
                  <Tag className="w-2.5 h-2.5" /> Fixed price
                </span>
              )}
              {unitEach && <span className={`text-[10px] ${isDarkTheme ? 'text-slate-500' : 'text-slate-400'}`}>{unitEach}</span>}
              {anyItem.propertyTag && (
                <span className={`text-[10px] font-medium rounded-full px-1.5 py-0.5 ${isDarkTheme ? 'bg-white/5 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>{anyItem.propertyTag}</span>
              )}
            </div>
            )}
            {hasMaterials && labourDisplayPence > 0 && (
              <p className={`text-[11px] font-medium tabular-nums ${isDarkTheme ? 'text-slate-300' : 'text-slate-600'}`}>
                Labour £{Math.round(labourDisplayPence / 100)} · Materials £{Math.round(materialsDisplayPence / 100)}
              </p>
            )}
            {scopeSteps ? (
              <ul className="flex flex-col gap-1.5 mt-0.5">
                {scopeSteps.map((step, i) => {
                  // "Head — detail" format: bold value-word lead, muted expansion.
                  // Steps without an em-dash render whole at head weight.
                  const dashIdx = step.indexOf(' — ');
                  const head = dashIdx > 0 ? step.slice(0, dashIdx) : step;
                  const detail = dashIdx > 0 ? step.slice(dashIdx + 3) : null;
                  // The final step is the OUTCOME (what the customer is left
                  // with) — solid green disc + brand-green head make it the
                  // visual payoff of the checklist, not just another tick.
                  const isOutcome = i === scopeSteps.length - 1 && scopeSteps.length > 1;
                  return (
                    <li key={i} className="flex items-start gap-2 text-[12.5px] leading-snug">
                      <span className={`shrink-0 mt-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center ${isOutcome ? 'bg-[#7DB00E]' : isDarkTheme ? 'bg-[#7DB00E]/25' : 'bg-[#7DB00E]/15'}`}>
                        <Check className={`w-2.5 h-2.5 ${isOutcome ? 'text-white' : isDarkTheme ? 'text-[#a3d65f]' : 'text-[#5b8a08]'}`} strokeWidth={3.5} />
                      </span>
                      <span>
                        <span className={`font-semibold ${isOutcome ? (isDarkTheme ? 'text-[#a3d65f]' : 'text-[#5b8a08]') : isDarkTheme ? 'text-slate-100' : 'text-slate-900'}`}>{head}</span>
                        {detail && <span className={isDarkTheme ? 'text-slate-400' : 'text-slate-500'}> — {detail}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : customerDesc ? (
              <p className={`text-[12.5px] leading-relaxed border-l-2 border-[#FACC15]/50 pl-2.5 ${isDarkTheme ? 'text-slate-200' : 'text-slate-700'}`}>
                {customerDesc}
              </p>
            ) : null}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

/** The canonical customer types (mirrors contextSignals.customerType). oap_homeowner
 *  is a homeowner variant that adds a cash-on-the-day payment option. */
type CustomerType = 'homeowner' | 'oap_homeowner' | 'landlord' | 'property_manager' | 'tenant' | 'business' | 'letting_agent';

interface UnifiedQuoteCardProps {
  segment: string;
  basePrice: number; // in pence
  customerName: string;
  customerEmail?: string;
  quoteId?: string;
  jobDescription?: string;
  location?: string; // e.g., "Fulham" - used for social proof labels
  postcode?: string; // full postcode (e.g. "NG1 1AA") shown for trust + address bias
  optionalExtras?: { label: string; description?: string; priceInPence: number; badge?: string }[] | null;
  onBook: (config: {
    selectedDate: Date | null;
    selectedDates?: Date[]; // 3-date buffer model: customer picks up to 3 preferred dates
    dateTimePreferences?: { date: Date; timeSlot: 'am' | 'pm' | 'flexible' | 'full_day' }[];
    timeSlot: string | null;
    addOns: string[];
    totalPrice: number;
    chargeNowPence: number; // Amount to charge today (deposit or full discounted price)
    balanceOnCompletionPence: number; // Remaining balance due on job completion
    paymentMode: 'deposit' | 'full' | 'cash';
    usedDownsell: boolean;
    /** Phase 30 — address captured at the quote so dispatch has it (no later chase). */
    address?: { line: string; postcode?: string; lat?: number; lng?: number };
    flexiblePeriodDays?: number; // When using downsell, how many days flexibility
    /**
     * Phase 25 — flex booking window (days). Set when the customer chose
     * "I'm flexible" and accepted that we pick a weekday within N days. Mirrors
     * the personalized_quotes.flexBookingWithinDays column. Server-side wiring is
     * owned by Agent 25e.
     */
    flexBookingWithinDays?: number;
    /**
     * Phase 37 — the pricing lane the customer is in ('flex' = the default
     * base-price lane, 'date_time' = firm date+slot premium lane, 'liaise' =
     * landlord tenant-liaison concierge +£25). Forwarded to /track-booking so the
     * SERVER re-derives the lane-adjusted price from quote.basePrice. Omitted for
     * businesses (no price lever), firm-date landlords, and legacy/downsell flows.
     */
    pricingLane?: 'flex' | 'date_time' | 'liaise';
    /**
     * Landlord liaise-with-tenant booking. When the customer is a landlord and
     * chooses "Liaise dates with my tenant" instead of picking a date, we capture
     * the tenant's contact so ops can arrange access directly. Persisted into
     * personalized_quotes.contextSignals via /track-booking.
     */
    liaiseWithTenant?: boolean;
    tenantName?: string;
    tenantMobile?: string;
  }) => void;
  onPaymentSuccess?: (paymentIntentId: string) => Promise<void>;
  /** Called when user clicks the "Book it in" gate for flex/inline payments.
   *  Call proceed() to reveal the address + Stripe form. If omitted, reveals immediately. */
  onBeforeBooking?: (proceed: () => void) => void;
  isBooking?: boolean;
  /** Which booking modes to display. When omitted, all default options are shown. */
  bookingModes?: QuoteBookingMode[];
  /** Contextual pricing line item breakdown. When provided, shown above the total. */
  pricingLineItems?: PricingLineItem[];
  /**
   * Decomposed-pricing structural cost buckets (attendance/travel/collection).
   * Present ONLY when `decomposedPricingEnabled` is on AND the quote was priced
   * with it; `basePrice` already includes `totalBucketsPence`. When omitted the
   * card renders exactly as before — the buckets are an additive, off-by-default
   * layer. We surface the positive buckets as neutral rows so the itemised lines
   * reconcile with the (bucket-inclusive) total. bracketCeiling* is ops-only.
   */
  priceBuckets?: PriceBuckets;
  /** Multi-job batch discount. When applied, shown as a discount line. */
  batchDiscount?: QuoteBatchDiscount;
  /** Override the default segment-driven feature bullets with contextual value bullets. */
  contextualBullets?: string[];
  /** Deposit percentage (0-100). Default 30. */
  depositPercent?: number;
  /** Pay-in-full discount percentage (0-100). Default 3. */
  payInFullDiscountPercent?: number;
  /** Flexible timing downsell discount percentage (0-100). Default from SchedulingConfig. */
  flexibleDiscountPercent?: number;
  /** Quote short slug for WhatsApp deep-link. */
  shortSlug?: string;
  /** VA-specified available dates (YYYY-MM-DD strings). When set, only these dates are shown in the calendar. */
  allowedDates?: string[] | null;
  /** Assigned contractor info for trust strip inside price card */
  contractor?: {
    name: string;
    profilePhotoUrl?: string | null;
    availabilityStatus?: string | null;
    bio?: string | null;
    trustBadges?: string[] | null;
  } | null;
  /**
   * Landlord mode. Detected upstream from the VA context signal
   * (`/\blandlord\b/i.test(contextSignals.vaContext)`), NOT from ownershipContext
   * which is never populated with 'landlord'. When true the booking card swaps the
   * "Included as standard" grid + the flexible/set-date toggle for landlord-specific
   * variants (tenant liaison, tax-ready invoice, liaise-with-tenant scheduling).
   */
  isLandlord?: boolean;
  /**
   * Nonce bumped by the page's landlord promo CTA. Each increment scrolls the
   * liaise toggle into view and pulses it once — a "look here" nudge that lives
   * with the toggle (which this card owns) rather than reaching across the DOM.
   * 0/undefined = no nudge yet.
   */
  highlightLiaiseSignal?: number;
  /**
   * Structured customer type, read from the persisted contextSignals.customerType
   * (one of the 6 canonical builder values) with a legacy free-text fallback.
   * Drives per-type booking defaults: homeowners default to the "I'm flexible"
   * window. Distinct from isLandlord, which gates the whole landlord booking flow.
   */
  customerType?: CustomerType;
  /**
   * Explicit initial flex-booking state from the ?v=offer interstitial. When set,
   * it seeds `useFlexBooking` AND suppresses the per-type auto-default so the
   * customer's offer choice wins: true (accepted) = flexible lane / base price,
   * false (declined) = firm date & time. Undefined = legacy behaviour (auto-default).
   */
  initialUseFlexBooking?: boolean;
}

/**
 * Personal/brand identity for CONTEXTUAL quotes. `lead` is kept consistent with
 * the quote page's hero "Prepared by Ben from HandyServices" so the WhatsApp
 * prompt reads as one trusted local person, not a faceless platform. Only
 * applied to CONTEXTUAL (see the `isContextual` copy swaps below); other
 * segments keep the platform voice. If the hero preparer name changes, update
 * `lead` here too.
 */
const BRAND = {
  lead: 'Ben',
  homesBadge: '100s of homes',
} as const;

/** One differentiator chip: a brand-green icon + a short, single-line label. */
interface DifferentiatorChip {
  icon: React.ReactNode;
  label: string;
  /** Marks the "rich" homeowner set. That set renders as a one-line trust strip
   *  directly under the price (using `short`); other sets render as the compact
   *  below-total chip grid. (The text itself isn't shown in the strip.) */
  sub?: string;
  /** Short label for the one-line trust strip, where the full label is too long. */
  short?: string;
}

/**
 * Per-customer-type differentiator chips, shown on the quote *before* payment.
 *
 * Strategy (anti-handyman): each type gets the basics a normal handyman fails at,
 * tuned to that type's #1 fear. These sit in a small-card grid that forbids
 * wrapping, so every label stays short and single-line (≤ ~13 chars). The fuller
 * risk-reversal promise ("…or we make it right") lives in the guarantee card
 * below — not here.
 *
 * Rule: every chip must be genuinely included free. Paid add-ons (tenant liaison
 * +£25, after-hours access) are deliberately excluded so a chip never undercuts a
 * charge.
 */
const DIFFERENTIATOR_CHIPS: Record<CustomerType, DifferentiatorChip[]> = {
  homeowner: [
    // Reframed from table-stakes ("On time", "Spotless") to benefits a homeowner
    // weighs when letting a stranger into their home. Every claim is one we already
    // make elsewhere on the page (insured / DBS / fix-it-free / tidy-up) — nothing
    // invented. No guarantee duration asserted; "we come back free" is the promise.
    { icon: <Shield className="w-4 h-4" />, label: '£2M insured', short: '£2M insured', sub: "covered if anything's damaged" },
    { icon: <UserCheck className="w-4 h-4" />, label: 'Vetted & DBS-checked', short: 'DBS-checked', sub: 'a safe pro in your home' },
    { icon: <BadgeCheck className="w-4 h-4" />, label: 'Guaranteed', short: 'Guaranteed', sub: 'not right? we come back free' },
    // "We tidy up" intentionally dropped from the homeowner strip — 3 items keep
    // the trust strip on one line on mobile at a readable size (4 forced a wrap).
  ],
  // OAP homeowner: a faithful duplicate of homeowner (same reassurance set). It
  // differs only in payment options (cash on the day), handled in the toggle below.
  oap_homeowner: [
    { icon: <Shield className="w-4 h-4" />, label: '£2M insured', short: '£2M insured', sub: "covered if anything's damaged" },
    { icon: <UserCheck className="w-4 h-4" />, label: 'Vetted & DBS-checked', short: 'DBS-checked', sub: 'a safe pro in your home' },
    { icon: <BadgeCheck className="w-4 h-4" />, label: 'Guaranteed', short: 'Guaranteed', sub: 'not right? we come back free' },
  ],
  landlord: [
    // Tenant liaison is a paid +£25 add-on → NOT claimed here as standard.
    { icon: <Tag className="w-4 h-4" />, label: 'Fixed price' },
    { icon: <Camera className="w-4 h-4" />, label: 'Photo proof' },
    { icon: <Receipt className="w-4 h-4" />, label: 'Tax invoice' },
    { icon: <Shield className="w-4 h-4" />, label: 'Guaranteed' },
  ],
  property_manager: [
    { icon: <Clock className="w-4 h-4" />, label: '48-72hr' },
    { icon: <Camera className="w-4 h-4" />, label: 'Photo report' },
    { icon: <Receipt className="w-4 h-4" />, label: 'One invoice' },
    { icon: <Tag className="w-4 h-4" />, label: 'Fixed price' },
  ],
  business: [
    // After-hours access is a premium, not standard → excluded from the chips.
    { icon: <CalendarCheck className="w-4 h-4" />, label: 'By deadline' },
    { icon: <Tag className="w-4 h-4" />, label: 'Fixed price' },
    { icon: <Sparkles className="w-4 h-4" />, label: 'Clean finish' },
    { icon: <Shield className="w-4 h-4" />, label: 'Guaranteed' },
  ],
  letting_agent: [
    { icon: <Phone className="w-4 h-4" />, label: 'One contact' },
    { icon: <Camera className="w-4 h-4" />, label: 'Photo proof' },
    { icon: <Clock className="w-4 h-4" />, label: '48-72hr' },
    { icon: <Tag className="w-4 h-4" />, label: 'Fixed price' },
  ],
  tenant: [
    { icon: <Zap className="w-4 h-4" />, label: 'Fast reply' },
    { icon: <Clock className="w-4 h-4" />, label: 'On time' },
    { icon: <Sparkles className="w-4 h-4" />, label: 'Left tidy' },
    { icon: <Shield className="w-4 h-4" />, label: 'Guaranteed' },
  ],
};

export function UnifiedQuoteCard({
  segment,
  basePrice,
  customerName,
  customerEmail,
  quoteId,
  jobDescription,
  location,
  postcode,
  optionalExtras,
  onBook,
  onPaymentSuccess,
  onBeforeBooking,
  isBooking = false,
  bookingModes,
  pricingLineItems,
  batchDiscount,
  contextualBullets,
  depositPercent: depositPercentProp,
  payInFullDiscountPercent: payInFullDiscountPercentProp,
  flexibleDiscountPercent: flexibleDiscountPercentProp,
  shortSlug,
  allowedDates,
  contractor,
  isLandlord = false,
  highlightLiaiseSignal = 0,
  customerType = 'homeowner',
  initialUseFlexBooking,
}: UnifiedQuoteCardProps) {
  // Booking mode flags — when bookingModes is provided, only show those options
  const showStandardDate = !bookingModes || bookingModes.includes('standard_date');
  const showFlexibleDiscount = !bookingModes || bookingModes.includes('flexible_discount');
  const showUrgentPremium = !bookingModes || bookingModes.includes('urgent_premium');
  const showDepositSplit = !bookingModes || bookingModes.includes('deposit_split');

  // CONTEXTUAL gets a personal, single-trusted-local voice (every other segment
  // keeps the platform voice). Mirrors PersonalizedQuotePage's contextual
  // detection: explicit segment OR presence of contextual value bullets.
  // Voice/copy only — pricing model is unchanged.
  const isContextual = segment === 'CONTEXTUAL' || !!contextualBullets;

  // Business quotes reuse the homeowner two-lane flow (flexible default ON → hands
  // dispatch the movable window), but the flexible lane is dressed as a deadline
  // guarantee, NOT a price discount: a business values a kept date over a few %
  // off, and discount-framing on a commercial job invites procurement scrutiny.
  // So `isBusiness` keeps the same `useFlexBooking` plumbing but suppresses the
  // flex discount and swaps the badge/copy (see the discount memo + flex card).
  const isBusiness = customerType === 'business';

  // Which differentiator-chip set to show. Prefer the canonical customerType; fall
  // back to the legacy isLandlord gate when customerType wasn't supplied (older
  // quotes default it to 'homeowner').
  const chipType: CustomerType = customerType !== 'homeowner'
    ? customerType
    : (isLandlord ? 'landlord' : 'homeowner');

  // Stripe hooks (will be null if not wrapped in Elements provider)
  const stripe = useStripe();
  const elements = useElements();
  // Get segment-specific config, with optional flexible discount override
  const rawConfig = getSchedulingConfig(segment);
  const config = useMemo(() => {
    if (flexibleDiscountPercentProp != null && rawConfig.downsell) {
      return {
        ...rawConfig,
        downsell: { ...rawConfig.downsell, discountPercent: flexibleDiscountPercentProp },
      };
    }
    return rawConfig;
  }, [rawConfig, flexibleDiscountPercentProp]);
  const timeSlots = getTimeSlotsForSegment(segment);

  // State
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  // 3-date buffer: two-tap flow (tap date → pick AM/PM → confirmed)
  type TimePref = 'am' | 'pm' | 'full_day';
  interface ConfirmedDate { date: Date; timePref: TimePref; }
  const [confirmedDates, setConfirmedDates] = useState<ConfirmedDate[]>([]);
  const [pendingDate, setPendingDate] = useState<Date | null>(null); // awaiting AM/PM
  const MAX_BUFFER_DATES = 3;
  // Derived for backward compat
  const selectedDates = confirmedDates.map(cd => cd.date);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string | null>(null);
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [useDownsell, setUseDownsell] = useState(false);
  const [showAllDates, setShowAllDates] = useState(false);
  const queryClient = useQueryClient();
  const [payFull, setPayFull] = useState(false);
  // Share affordance — big-ticket buyers almost always need to show someone else
  // (spouse, landlord). Native share sheet on mobile; clipboard fallback on desktop.
  const [shareCopied, setShareCopied] = useState(false);
  const handleShareQuote = async () => {
    const url = window.location.href;
    const firstName = customerName.split(' ')[0];
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: `Handy Services quote for ${firstName}`, url });
        return;
      } catch {
        // User dismissed the sheet or share failed — fall through to copy.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      // Clipboard unavailable — nothing sensible to do.
    }
  };
  // Cash-on-the-day, offered only to OAP homeowners. When chosen no online payment
  // is taken: the job books and the contractor collects cash on the day. Gated on
  // cashEligible so it can never activate for any other customer type.
  const cashEligible = customerType === 'oap_homeowner';
  const [payCash, setPayCash] = useState(false);
  const isCash = payCash && cashEligible;

  // Smart slot selection state (AM/PM/FULL_DAY for quote-specific availability)
  type SlotChoice = 'am' | 'pm' | 'full_day';
  const lineItemCount = pricingLineItems?.length || 1;
  // isLargeJob defined after totalEstimatedMinutes (below)
  const [selectedSlotChoice, setSelectedSlotChoice] = useState<SlotChoice>('am');

  // Slot reservation state
  const [reservation, setReservation] = useState<SlotReservation | null>(null);
  const [isReserving, setIsReserving] = useState(false);
  const [reserveError, setReserveError] = useState<string | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState<number>(0);
  // The customer-facing "secure your slot" window: 5 minutes of urgency to push
  // them into payment. Capped at the server hold. The deadline is pinned ONCE in a
  // ref when the slot is first reserved, so re-renders / detailsConfirmed flips don't
  // restart the clock.
  const RESERVE_WINDOW_SECONDS = 5 * 60;
  const paymentDeadlineRef = useRef<number | null>(null);

  // Deposit / Pay-in-full config (configurable via admin pricing settings)
  const DEPOSIT_PERCENT = (depositPercentProp ?? 30) / 100;
  const PAY_FULL_DISCOUNT = (payInFullDiscountPercentProp ?? 3) / 100;

  // ── Phase 25 flex booking ──────────────────────────────────────────────
  // Customer-facing knob: "I'm flexible" (the DEFAULT lane). When on, the date
  // picker collapses and `flexBookingWithinDays` is sent through onBook so the
  // server can route this booking to a thin day within the window. The flexible
  // lane is priced at the FULL base price — there is no rebate. The only price
  // lever is the set-date premium below (a firm date & slot costs extra).
  const FLEX_WINDOW_DAYS = 7;
  // ── "I want a date & time" premium — the ONLY price lever ───────────────
  // Flexible is the base price; committing a specific date AND arrival slot is a
  // real surcharge, anchored to the cost of taking time off work to wait in (a
  // half-day off ≈ £65). The flat WTP sits just under that so it's an obvious
  // trade; the % keeps it scaling with bigger jobs while reading as a small slice.
  const SET_DATE_WTP_PENCE = 3000;   // £30 flat WTP anchor (≈ just under a half-day off work)
  const SET_DATE_PCT = 0.06;         // + 6% of the quote price
  // Flat premium for the landlord tenant-liaison concierge (pence). The flexible
  // lane saves us effort (thin-day routing) at no extra charge; liaise COSTS us
  // effort (chasing the tenant, arranging access), so it carries a charge.
  const LIAISE_PREMIUM_PENCE = 2500;
  const [useFlexBooking, setUseFlexBooking] = useState(initialUseFlexBooking ?? false);
  // Landlord promo nudge: the page's "Add tenant liaison" CTA bumps
  // highlightLiaiseSignal; we scroll the toggle into view and pulse a ring once.
  const liaiseToggleRef = useRef<HTMLButtonElement>(null);
  const [liaisePulse, setLiaisePulse] = useState(false);
  useEffect(() => {
    if (!highlightLiaiseSignal) return;
    const el = liaiseToggleRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setLiaisePulse(true);
    const t = setTimeout(() => setLiaisePulse(false), 1700);
    return () => clearTimeout(t);
  }, [highlightLiaiseSignal]);

  // ── Landlord liaise-with-tenant ───────────────────────────────────────
  // For landlord quotes the date grid is always shown (the master view) with an
  // opt-in premium toggle on top: "Can't be there? We'll liaise with your tenant
  // (+£25)". Liaise reuses `useFlexBooking` (no fixed date, inline payment, ops
  // arranges access) but instead of the flex discount it adds the flat liaison
  // premium — it's a paid concierge, not a thin-day yield play. Tapping a date on
  // the grid flips `useFlexBooking` off → a firm booking at the standard rate, so
  // liaise and pick-a-date are naturally mutually exclusive. We capture the
  // tenant's contact so ops can arrange access without chasing.
  const [tenantName, setTenantName] = useState('');
  const [tenantMobile, setTenantMobile] = useState('');
  const tenantNameValid = tenantName.trim().length >= 2;
  const tenantMobileValid = /^\+?\d{10,15}$/.test(tenantMobile.replace(/[^\d+]/g, ''));
  // In landlord liaise mode (isLandlord + useFlexBooking) booking is gated on a
  // usable tenant contact. Every other mode is unaffected.
  const tenantContactOk = !isLandlord || !useFlexBooking || (tenantNameValid && tenantMobileValid);
  // Tenant contact fragment spread into every onBook payload — only in landlord
  // liaise mode, so normal/flex/empty-property bookings are untouched. There are
  // three onBook call sites (handleBook + the two inline Stripe handlers); this
  // keeps them in sync.
  const landlordTenantPayload = isLandlord && useFlexBooking
    ? { liaiseWithTenant: true, tenantName: tenantName.trim(), tenantMobile: tenantMobile.trim() }
    : {};

  // Per-line off-peak premium total (drives the chip next to Saturday dates).
  // Sum across all SKU lines that carry `offPeakWeekendPremiumPence`. Custom
  // lines + legacy lines (which don't have the field) contribute 0, so this
  // stays correct across mixed quotes.
  const totalSaturdayPremiumPence = useMemo(() => {
    if (!pricingLineItems) return 0;
    return pricingLineItems.reduce((sum, li) => sum + ((li as any).offPeakWeekendPremiumPence || 0), 0);
  }, [pricingLineItems]);

  // Flex eligibility: any SKU line marked flex_eligible. When no SKU lines or
  // none are flex-eligible we hide the checkbox so legacy free-text quotes
  // don't see an option that can't be honoured.
  const isQuoteFlexEligible = useMemo(() => {
    if (!pricingLineItems || pricingLineItems.length === 0) return false;
    const skuLines = pricingLineItems.filter(li => (li as any).source === 'sku');
    if (skuLines.length === 0) return false;
    // If ANY SKU line is explicitly flex_eligible, we offer it. Lines without
    // the field default to NOT flex-eligible (safer than the other way).
    return skuLines.some(li => (li as any).flexEligible === true);
  }, [pricingLineItems]);

  // Phase 29 — flexible booking is the DEFAULT (it lets us route to thin days).
  // Tick it once on load; the ref guard means a customer who unticks it (or picks
  // a specific date) is never silently re-defaulted.
  // NB: the flex toggle is now OFFERED to every non-landlord quote (see the
  // render gate below). This effect only controls whether it auto-defaults ON:
  //   - Homeowners ALWAYS default ON — the flexible lane is just the base price,
  //     so it's safe to apply to any homeowner quote, including custom/free-text.
  //   - Businesses ALWAYS default ON too: the flexible lane is framed as a
  //     deadline guarantee, so it's safe to default on for any business quote.
  //   - Other non-landlord types default ON only when the quote is flex-eligible
  //     (has a flex_eligible SKU line); otherwise they open on a firm date but
  //     can still opt in.
  // Landlords do NOT auto-default into liaise: it's now a paid premium (+£25), so
  // it must be an explicit opt-in (no surprise fee). They open on the firm-date
  // grid with the liaison toggle offered above it.
  // When the ?v=offer interstitial passed an explicit choice, treat the default
  // as already applied so this effect never overrides it — critical for DECLINE
  // (false), where the per-type auto-default would otherwise flip a homeowner
  // back to flex and silently undo the customer's "I need a specific day".
  const flexDefaultedRef = useRef(initialUseFlexBooking !== undefined);
  useEffect(() => {
    if (!isLandlord && (customerType === 'homeowner' || customerType === 'oap_homeowner' || customerType === 'business' || isQuoteFlexEligible) && !flexDefaultedRef.current) {
      flexDefaultedRef.current = true;
      setUseFlexBooking(true);
    }
  }, [isQuoteFlexEligible, isLandlord, customerType]);

  // Payment state (for inline payment when using downsell)
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [isLoadingPaymentIntent, setIsLoadingPaymentIntent] = useState(false);
  const [inlineEmail, setInlineEmail] = useState(customerEmail || '');
  const [emailConfirmed, setEmailConfirmed] = useState(false);

  // Phase 30 — address captured at the quote (Places autocomplete) so the
  // booking arrives complete and dispatch never has to chase the address.
  const [addressLine, setAddressLine] = useState('');
  const [addressDetails, setAddressDetails] = useState<{ formattedAddress: string; postcode?: string; lat?: number; lng?: number } | null>(null);
  const [detailsConfirmed, setDetailsConfirmed] = useState(false);
  // Reveal-on-commit: once a slot is chosen we show a single "Book my slot" CTA
  // and keep address/email/payment hidden until the customer commits. Showing the
  // whole "Complete your booking" form inline up-front depressed bookings.
  const [bookingStarted, setBookingStarted] = useState(false);
  // UK postcode pattern (e.g. "NG35TF", "NG3 5TF", "SW1A 1AA") — catch the case
  // where the customer types only their postcode instead of a full address.
  const looksLikePostcodeOnly = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(addressLine.trim());
  const addressOk = addressLine.trim().length >= 6 && !looksLikePostcodeOnly;
  // Phase 30 — package the captured door address so onBook → /track-booking can
  // persist it on personalized_quotes (address + coordinates). Built whenever the
  // customer has typed something usable; Places fills postcode/lat/lng, manual
  // typing still persists the line. This is what removes the later address chase.
  const bookingAddress = addressLine.trim().length >= 3
    ? {
        line: addressLine.trim(),
        postcode: addressDetails?.postcode,
        lat: addressDetails?.lat,
        lng: addressDetails?.lng,
      }
    : undefined;
  const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(v);
  const effectiveEmail = customerEmail || (emailConfirmed && isValidEmail(inlineEmail) ? inlineEmail : undefined);

  // Refs for scroll behavior
  const timeSectionRef = useRef<HTMLDivElement>(null);
  const addOnsSectionRef = useRef<HTMLDivElement>(null);
  const bookSectionRef = useRef<HTMLDivElement>(null);
  const priceCardRef = useRef<HTMLDivElement>(null);
  const dateSectionRef = useRef<HTMLDivElement>(null);

  // Sticky CTA: show once the price card has been scrolled past. In the
  // flexible default no date is ever picked, so it stays until booking; the
  // button itself adapts ("Book now" vs "Choose your date") based on mode.
  const [stickyCTAActivated, setStickyCTAActivated] = useState(false);
  const showStickyCTA = stickyCTAActivated && selectedDates.length === 0;

  useEffect(() => {
    const checkPriceCardPosition = () => {
      const priceEl = priceCardRef.current;
      if (!priceEl) return;
      const rect = priceEl.getBoundingClientRect();
      if (rect.top < 0) {
        setStickyCTAActivated(true);
      }
    };

    window.addEventListener('scroll', checkPriceCardPosition, { passive: true });
    // Also check on mount in case page loaded scrolled down
    checkPriceCardPosition();

    return () => window.removeEventListener('scroll', checkPriceCardPosition);
  }, []);

  // Extract unique job categories from line items for contractor-filtered availability (fallback)
  const jobCategories = useMemo(() => {
    if (!pricingLineItems || pricingLineItems.length === 0) return undefined;
    const cats = Array.from(new Set(pricingLineItems.map(li => li.category).filter(Boolean)));
    return cats.length > 0 ? cats : undefined;
  }, [pricingLineItems]);

  // Estimate total time for full-day detection (>240min = require full day slot)
  const totalEstimatedMinutes = useMemo(() => {
    if (!pricingLineItems) return undefined;
    return pricingLineItems.reduce((sum, li) => sum + (li.timeEstimateMinutes || 0), 0);
  }, [pricingLineItems]);

  // A "large job" skips AM/PM selection — strictly based on estimated hours (≥4hrs)
  const isLargeJob = totalEstimatedMinutes != null && totalEstimatedMinutes >= 240;

  // Auto-set slot choice to full_day for large jobs on first render
  useEffect(() => {
    if (isLargeJob) {
      setSelectedSlotChoice('full_day');
    }
  }, [isLargeJob]);

  // Quote-specific availability: uses candidate contractor pool from quote
  // Falls back to generic availability if quoteId is not provided
  const { data: quoteAvailabilityData, isLoading: isLoadingQuoteAvailability, dataUpdatedAt: quoteAvailabilityUpdatedAt } = useQuoteAvailability({
    quoteId,
    slot: selectedSlotChoice,
    enabled: !!quoteId,
  });

  // Minimal-premium freshness label (Airbnb/Google pattern): "updated just now / N min ago".
  // Recomputed each render so it stays honest; refetchOnWindowFocus refreshes the
  // underlying timestamp whenever the customer returns to the tab.
  const availabilityUpdatedLabel = (() => {
    if (!quoteAvailabilityUpdatedAt) return 'just now';
    const mins = Math.floor((Date.now() - quoteAvailabilityUpdatedAt) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs} hr${hrs > 1 ? 's' : ''} ago`;
  })();

  // Honest scarcity: count genuinely-bookable dates in the next 7 days from the live
  // availability data (shared helper — the top scarcity banner uses the exact same one
  // so the figures can't disagree). Drives the "Only N dates left this week" cue.
  const datesLeftThisWeek = countAvailableDatesThisWeek(quoteAvailabilityData);
  const scarcityLabel = datesLeftThisWeek == null
    ? null
    : datesLeftThisWeek <= 0
      ? 'Limited availability, filling up fast'
      : `Only ${datesLeftThisWeek} date${datesLeftThisWeek === 1 ? '' : 's'} left this week`;

  // Phase 24d — multi-day jobs. The server tags each entry with durationDays
  // when the quote needs more than one consecutive day. Customer page surfaces
  // this so the date being picked is understood as a START date.
  const jobDurationDays = useMemo(() => {
    if (!quoteAvailabilityData) return 1;
    for (const d of quoteAvailabilityData) {
      if ((d as any).durationDays && (d as any).durationDays > 1) return (d as any).durationDays as number;
    }
    return 1;
  }, [quoteAvailabilityData]);

  // Fallback: generic availability for quotes without an ID
  const { data: fallbackAvailabilityData } = useAvailability({
    categories: jobCategories,
    timeEstimateMinutes: totalEstimatedMinutes,
    days: config.maxDaysOut + 1,
    enabled: !quoteId,
  });

  // Build set of available dates from quote-specific endpoint
  // The quote endpoint returns only available dates (unlike generic which returns all)
  const quoteAvailableDateSet = useMemo(() => {
    if (!quoteAvailabilityData) return null;
    const set = new Set<string>();
    for (const d of quoteAvailabilityData) {
      set.add(d.date);
    }
    return set;
  }, [quoteAvailabilityData]);

  // Build set of unavailable dates for quick lookup (fallback mode only)
  const unavailableDates = useMemo(() => {
    const set = new Set<string>();
    if (!quoteId && fallbackAvailabilityData?.dates) {
      for (const d of fallbackAvailabilityData.dates) {
        if (!d.isAvailable) {
          set.add(d.date);
        }
      }
    }
    return set;
  }, [quoteId, fallbackAvailabilityData]);

  // Countdown timer for slot reservation — a 5-minute "secure your slot" window that
  // pushes the customer to start payment. Once they proceed (detailsConfirmed →
  // create-payment-intent extends the server lock to 1h), we FREEZE it rather than
  // release, so the urgency clock can never kill an in-flight payment.
  useEffect(() => {
    if (!reservation) {
      setCountdownSeconds(0);
      paymentDeadlineRef.current = null;
      return;
    }
    // Payment started — the server lock is extended; stop the urgency countdown.
    if (detailsConfirmed) return;

    // Pin the 5-min deadline once, when the slot is first reserved (capped at the
    // server hold so we never display longer than the slot is actually held).
    if (paymentDeadlineRef.current === null) {
      const serverExpiry = new Date(reservation.expiresAt).getTime();
      paymentDeadlineRef.current = Math.min(Date.now() + RESERVE_WINDOW_SECONDS * 1000, serverExpiry);
    }
    const deadline = paymentDeadlineRef.current;

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setCountdownSeconds(remaining);

      if (remaining <= 0) {
        // Window elapsed without payment — release the slot back to availability.
        releaseSlotLock(reservation.lockId).catch(() => {});
        setReservation(null);
        setReserveError('Your held slot expired. Please pick a date and time again.');
        setClientSecret(null);
        setPaymentIntentId(null);
      }
    };

    tick(); // Initial tick
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [reservation, detailsConfirmed]);

  // Release reservation on unmount (e.g. user navigates away)
  const reservationRef = useRef(reservation);
  reservationRef.current = reservation;
  useEffect(() => {
    return () => {
      if (reservationRef.current) {
        releaseSlotLock(reservationRef.current.lockId).catch(() => {});
      }
    };
  }, []);

  // When slot choice changes, release any existing reservation (new slot = new lock needed)
  // but keep selectedDate — the new flow is: pick date → pick time slot
  useEffect(() => {
    // Release any existing reservation when slot changes
    if (reservation) {
      releaseSlotLock(reservation.lockId).catch(() => {});
      setReservation(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSlotChoice]);

  // Generate dates including blocked ones (shown as "Fully Booked" for scarcity)
  // All date calculations anchored to UK time (Europe/London) so dates
  // and next-day / weekend fees are correct regardless of viewer timezone.
  const availableDates = useMemo(() => {
    const ukNow = toZonedTime(new Date(), 'Europe/London');

    // Default window is config.maxDaysOut (typically 28 days). The admin's
    // "Dates tab" pool was expanded to 180 days, so a manually picked date may
    // fall outside that window — extend the loop so baseFilteredDates doesn't
    // silently drop it.
    let maxDaysOut = config.maxDaysOut;
    if (allowedDates && allowedDates.length > 0) {
      const furthestAllowed = allowedDates.reduce((max, d) => (d > max ? d : max), '');
      let probe = maxDaysOut;
      while (probe < 365 && formatDateStr(addDays(ukNow, probe)) < furthestAllowed) {
        probe++;
      }
      maxDaysOut = probe;
    }

    const dates: { date: Date; label: string; isWeekend: boolean; isNextDay: boolean; fee: number; isBlocked: boolean }[] = [];
    for (let i = BASE_SCHEDULING_RULES.minDaysOut; i <= maxDaysOut; i++) {
      const date = addDays(ukNow, i);
      if (BASE_SCHEDULING_RULES.sundaysClosed && date.getDay() === 0) continue; // Skip Sundays

      const dateStr = formatDateStr(date);
      // When using quote-specific availability, a date is blocked if it's NOT in the available set
      // When using fallback, a date is blocked if it IS in the unavailable set
      const isBlocked = quoteAvailableDateSet
        ? !quoteAvailableDateSet.has(dateStr)
        : unavailableDates.has(dateStr);

      const isSaturday = date.getDay() === 6;
      const isNextDay = i === 1; // Tomorrow (UK time)

      // Calculate fee: next-day and Saturday fees can stack.
      // Phase 25 — when ANY line on the quote carries a non-zero SKU off-peak
      // weekend premium, use that real catalog value rather than the flat
      // weekend fee. Legacy quotes (totalSaturdayPremiumPence === 0) keep the
      // flat fee — only shown when the segment config opts in.
      let fee = 0;
      if (isNextDay) fee += BASE_SCHEDULING_RULES.nextDayFee;
      if (isSaturday) {
        if (totalSaturdayPremiumPence > 0) {
          fee += totalSaturdayPremiumPence;
        } else if (config.showWeekendFee) {
          fee += BASE_SCHEDULING_RULES.weekendFee;
        }
      }

      dates.push({
        date,
        label: format(date, 'EEE d MMM'),
        isWeekend: isSaturday,
        isNextDay,
        fee,
        isBlocked,
      });
    }
    return dates;
  }, [config, unavailableDates, quoteAvailableDateSet, allowedDates, totalSaturdayPremiumPence]);

  // When urgent_premium mode is disabled, filter out next-day priority dates
  // When allowedDates is set, restrict calendar to only those VA-specified dates
  const allowedDateSet = useMemo(() =>
    allowedDates && allowedDates.length > 0 ? new Set(allowedDates) : null,
  [allowedDates]);

  const baseFilteredDates = availableDates.filter(d => {
    // LIVE POOL: once live quote availability has loaded, it is the single source of
    // truth for bookability (applied via d.isBlocked above). Show the full upcoming
    // window and let the live set decide — do NOT additionally constrain the grid to
    // the admin's pre-picked dates, so any genuinely-available date appears even if it
    // wasn't in the original pick list.
    if (quoteAvailableDateSet) {
      return true;
    }
    // Fallback (no live data — e.g. admin preview without a quoteId): admin-whitelisted
    // dates win unconditionally, including next-day picks even when urgent_premium is
    // off. They deliberately chose the date, so we don't gate it behind urgent rules.
    if (allowedDateSet) {
      const dateStr = formatDateStr(d.date);
      return allowedDateSet.has(dateStr);
    }
    if (!showUrgentPremium && d.isNextDay) return false;
    return true;
  });

  // Deterministic scarcity: mark ~30% of dates as Fully Booked (consistent per quote
  // across viewers and reloads). Skips the first available date so a soonest slot
  // always remains. Disabled when no quoteId (admin previews) or when the result
  // would leave fewer than 3 available dates.
  const filteredDates = useMemo(() => {
    if (!quoteId) return baseFilteredDates;
    // LIVE POOL: with real availability loaded, never fake "Fully Booked" — the grid
    // must reflect reality. Deterministic scarcity only applies to the legacy non-live
    // path (quotes without quote-specific availability data).
    if (quoteAvailableDateSet) return baseFilteredDates;
    const hash = (str: string) => {
      let h = 0;
      for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
      return Math.abs(h);
    };
    const candidate = baseFilteredDates.map((d, idx) => {
      if (d.isBlocked || idx === 0) return d;
      const dateStr = formatDateStr(d.date);
      const isArtificiallyBooked = hash(`${quoteId}|${dateStr}`) % 10 < 3;
      return isArtificiallyBooked ? { ...d, isBlocked: true } : d;
    });
    const remainingAvailable = candidate.filter(d => !d.isBlocked).length;
    return remainingAvailable >= 3 ? candidate : baseFilteredDates;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseFilteredDates, quoteId, quoteAvailableDateSet]);

  const visibleDates = showAllDates ? filteredDates : filteredDates.slice(0, 8);

  // Combine config add-ons with any quote-specific extras
  const allAddOns: AddOnOption[] = useMemo(() => {
    const configAddOns = config.addOns || [];
    const quoteExtras = (optionalExtras || []).map((extra, idx) => ({
      id: `extra_${idx}`,
      name: extra.label,
      description: extra.description || '',
      price: extra.priceInPence,
    }));
    return [...configAddOns, ...quoteExtras];
  }, [config.addOns, optionalExtras]);

  // ── "Date & time" premium (the single price lever) ─────────────────────
  // The flexible lane is just basePrice — no rebate. The ONLY adjustment is the
  // surcharge for the FIRM "date & time" lane: a flat WTP anchor + % of the quote
  // (see constants above). Businesses (deadline-guarantee framing) and landlords
  // (liaise flow) carry no premium — it resolves to 0.
  const setDatePremium = (!isLandlord && !isBusiness)
    ? Math.round((SET_DATE_WTP_PENCE + Math.round(basePrice * SET_DATE_PCT)) / 100) * 100
    : 0;

  // The pricing lane we report to the SERVER so it can re-derive the charged price
  // from quote.basePrice (server-authoritative; the client never sends the amount).
  // Mirrors the breakdown memo's price levers exactly:
  //   • homeowner/eligible: 'flex' (rebate) when flexible, else 'date_time' (premium)
  //   • landlord + flexible booking: 'liaise' (the +£25 tenant-liaison concierge)
  //   • landlord on a firm date, and businesses: no lever → undefined (flat base)
  const pricingLane: 'flex' | 'date_time' | 'liaise' | undefined =
    isLandlord
      ? (useFlexBooking ? 'liaise' : undefined)
      : isBusiness
        ? undefined
        : (useFlexBooking ? 'flex' : 'date_time');

  // Calculate total price
  const { total, breakdown, depositAmount, balanceOnCompletion, payFullTotal, payFullSaving, saturdayPremiumApplied, liaisePremiumApplied, totalMaterialsPence } = useMemo(() => {
    let amount = basePrice;
    const items: { label: string; amount: number }[] = [
      { label: config.priceLabel, amount: basePrice },
    ];

    // Downsell discount (legacy segment-driven path — separate from flex below)
    if (useDownsell && config.downsell) {
      const discount = Math.round(basePrice * (config.downsell.discountPercent / 100));
      amount -= discount;
      items.push({ label: config.downsell.label, amount: -discount });
    }

    // ── Date & time premium (the only flex/firm price lever) ────────────
    // Flexible is just basePrice. Committing a specific date & arrival slot is a
    // real surcharge added on top — see the WTP-anchored constants above.
    // Landlords (liaise flow) and businesses (deadline-guarantee framing) carry
    // no premium, so setDatePremium is already 0 for them.
    if (!useFlexBooking && setDatePremium > 0) {
      amount += setDatePremium;
      items.push({ label: 'Date & time', amount: setDatePremium });
    }

    // ── Landlord tenant-liaison premium ─────────────────────────────────
    // Liaise mode (isLandlord + useFlexBooking) is a paid concierge: we chase the
    // tenant, arrange access, and confirm the time back to the landlord. It's the
    // inverse of the flex discount — we do the legwork — so it carries a flat +£25
    // rather than a saving. No date is tied yet, so date-driven fees never apply.
    let liaisePremiumApplied = 0;
    if (isLandlord && useFlexBooking) {
      liaisePremiumApplied = LIAISE_PREMIUM_PENCE;
      amount += liaisePremiumApplied;
      items.push({ label: 'Tenant liaison', amount: liaisePremiumApplied });
    }

    // Date fees (next-day and/or weekend).
    // Flex bookings have no fixed date yet, so date-driven fees DON'T apply.
    const dateInfo = !useFlexBooking
      ? availableDates.find(d =>
          selectedDate && d.date.toDateString() === selectedDate.toDateString()
        )
      : undefined;
    if (dateInfo?.isNextDay) {
      amount += BASE_SCHEDULING_RULES.nextDayFee;
      items.push({ label: 'Priority (next day)', amount: BASE_SCHEDULING_RULES.nextDayFee });
    }
    // ── Phase 25 Saturday off-peak premium ──────────────────────────────
    // Sum of per-line SKU `offPeakWeekendPremiumPence` (typically +£40 across
    // the quote). Replaces the legacy flat-rate weekend fee for SKU-priced
    // quotes; legacy quotes (totalSaturdayPremiumPence === 0) still hit the
    // old flat-rate path. Honest line shown to customer either way.
    let saturdayPremiumApplied = 0;
    if (dateInfo?.isWeekend) {
      if (totalSaturdayPremiumPence > 0) {
        saturdayPremiumApplied = totalSaturdayPremiumPence;
        amount += saturdayPremiumApplied;
        items.push({ label: isContextual ? 'Saturday visit' : 'Saturday surcharge — peak demand', amount: saturdayPremiumApplied });
      } else if (config.showWeekendFee) {
        amount += BASE_SCHEDULING_RULES.weekendFee;
        items.push({ label: 'Weekend', amount: BASE_SCHEDULING_RULES.weekendFee });
        saturdayPremiumApplied = BASE_SCHEDULING_RULES.weekendFee;
      }
    }

    // Time slot fee
    const timeInfo = BASE_TIME_SLOTS.find(t => t.id === selectedTimeSlot);
    if (timeInfo?.fee) {
      amount += timeInfo.fee;
      items.push({ label: timeInfo.label, amount: timeInfo.fee });
    }

    // Add-ons
    selectedAddOns.forEach(addOnId => {
      const addOn = allAddOns.find(a => a.id === addOnId);
      if (addOn && addOn.price > 0) {
        amount += addOn.price;
        items.push({ label: addOn.name, amount: addOn.price });
      }
    });

    // Prices are already whole pounds from the engine — no client-side adjustment needed
    const adjustedAmount = amount;

    // Deposit model: 100% of materials upfront + 30% of labour
    const totalMaterialsPence = pricingLineItems
      ? pricingLineItems.reduce((sum, li) => sum + (li.materialsWithMarginPence || 0), 0)
      : 0;
    const labourPortion = adjustedAmount - totalMaterialsPence;
    const depositAmount = totalMaterialsPence > 0
      ? Math.round((totalMaterialsPence + Math.round(labourPortion * DEPOSIT_PERCENT)) / 100) * 100
      : Math.round(Math.round(adjustedAmount * DEPOSIT_PERCENT) / 100) * 100;
    const balanceOnCompletion = adjustedAmount - depositAmount;

    // Pay-in-full discount: small incentive for guaranteed cash flow, rounded to whole £
    const payFullTotal = Math.round(Math.round(adjustedAmount * (1 - PAY_FULL_DISCOUNT)) / 100) * 100;
    const payFullSaving = adjustedAmount - payFullTotal;

    return { total: adjustedAmount, breakdown: items, depositAmount, balanceOnCompletion, payFullTotal, payFullSaving, saturdayPremiumApplied, liaisePremiumApplied, totalMaterialsPence };
  }, [basePrice, selectedDate, selectedTimeSlot, selectedAddOns, useDownsell, useFlexBooking, isLandlord, isBusiness, availableDates, allAddOns, config, batchDiscount, pricingLineItems, totalSaturdayPremiumPence, setDatePremium]);

  // Customer-facing line items show their true totals: pure labour + materials +
  // this line's allocated share of the job-whole structural buckets (call-out ×
  // visits + travel + collection). The share is 0 on flag-off quotes, so legacy
  // lines are unchanged; when decomposed pricing is on, the folded shares sum
  // exactly to the buckets total, so the lines still reconcile to basePrice with
  // no separate fee section. (Deposit/total math uses the same raw lineTotal.)
  const displayLineItems = useMemo(() => {
    const lines = pricingLineItems || [];
    const raw = (li: PricingLineItem) =>
      li.guardedPricePence + (li.materialsWithMarginPence || 0) + (li.structuralSharePence || 0);
    return lines.map((item) => ({ item, displayPence: raw(item) }));
  }, [pricingLineItems]);

  // All 3 buffer dates must be selected before payment unlocks
  const allDatesSelected = confirmedDates.length >= MAX_BUFFER_DATES;

  // Auto-scroll to payment/email section once all preferred dates are confirmed
  useEffect(() => {
    if (allDatesSelected) {
      setTimeout(() => {
        bookSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  }, [allDatesSelected]);

  // Auto-scroll to the booking section once a single exact-date slot is held.
  // Mirrors the 3-date-buffer scroll above: after the customer picks a date + AM/PM
  // and the slot reserves, hand them straight down to "Complete your booking"
  // instead of leaving them up at the calendar. Keyed on `reservation` so it fires
  // AFTER the reserve resolves (the section is mounted by then), not on the click.
  useEffect(() => {
    const singleDateReserved =
      !!reservation && !!selectedDate && !!selectedTimeSlot &&
      !useDownsell && !useFlexBooking && confirmedDates.length === 0;
    if (!singleDateReserved) return;
    const t = setTimeout(() => {
      bookSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 400);
    return () => clearTimeout(t);
  }, [reservation, selectedDate, selectedTimeSlot, useDownsell, useFlexBooking, confirmedDates.length]);

  // Determine if we should show inline payment
  // Show inline Stripe card entry when: downsell, flex booking, single-date with reservation, or all 3 buffer dates picked
  const showInlinePayment = useDownsell || useFlexBooking || (selectedDate && selectedTimeSlot && reservation) || allDatesSelected;

  // Reveal-on-commit: if the customer clears their slot (the section collapses),
  // drop the commit so re-picking shows the "Book my slot" gate again rather than
  // jumping straight back into the address/payment form.
  useEffect(() => {
    if (!showInlinePayment) setBookingStarted(false);
  }, [showInlinePayment]);

  // Scroll the booking section into view when the Stripe card form reveals
  // (detailsConfirmed → true). On mobile the address/email form and keyboard
  // hold the viewport in a different position, so users don't see the card
  // input appear without an explicit scroll.
  useEffect(() => {
    if (!detailsConfirmed) return;
    const t = setTimeout(() => {
      bookSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 350); // slight delay lets the motion.div animation start first
    return () => clearTimeout(t);
  }, [detailsConfirmed]);

  // Create payment intent when inline payment should be shown
  useEffect(() => {
    if (!showInlinePayment || isCash || !quoteId || !stripe || !effectiveEmail || !detailsConfirmed) {
      setClientSecret(null);
      setPaymentIntentId(null);
      return;
    }

    const abortController = new AbortController();
    let isCurrentRequest = true;

    const createPaymentIntent = async () => {
      setIsLoadingPaymentIntent(true);
      setPaymentError(null);

      try {
        const response = await fetch('/api/create-payment-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerName,
            customerEmail: effectiveEmail,
            quoteId,
            selectedTier: 'standard', // Legacy field — single price model
            selectedExtras: selectedAddOns,
            paymentType: payFull ? 'full' : 'deposit',
            chargeAmountPence: payFull ? payFullTotal : depositAmount,
            flexibleTiming: useDownsell,
            flexiblePeriodDays: useDownsell ? config.downsell?.periodDays : undefined,
            // Phase 25 flex (DISTINCT from the downsell above): carry the chosen flex
            // window in the PI body so it lands in PI metadata → the Stripe webhook
            // persists flexBookingWithinDays race-free, instead of relying solely on
            // the fire-and-forget /track-booking PUT. Mirrors what onBook passes.
            flexBookingWithinDays: useFlexBooking ? FLEX_WINDOW_DAYS : undefined,
            // Scheduling tier the customer chose at booking — carried into PI metadata
            // so the Stripe webhook persists personalized_quotes.scheduling_tier race-free
            // (it was previously only stamped at quote creation, so it never landed on
            // real bookings). Flex/liaise booking → 'flexible'; a firm dated booking →
            // 'standard' (the date&time surcharge is still a standard-tier booking; this
            // component has no express/priority signal).
            schedulingTier: useFlexBooking ? 'flexible' : 'standard',
            // Pricing lane → server re-derives the charged £ from quote.basePrice.
            pricingLane,
            lockId: reservation?.lockId || undefined,
            contractorId: reservation?.contractorId || undefined,
            // Phase 30 — door address in the PI body so the webhook can snapshot it
            // race-free (via PI metadata) onto the quote + invoice, instead of racing
            // the fire-and-forget /track-booking write.
            address: bookingAddress?.line,
            addressLat: bookingAddress?.lat,
            addressLng: bookingAddress?.lng,
          }),
          signal: abortController.signal,
        });

        if (!isCurrentRequest) return;

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || `Server error: ${response.status}`);
        }

        const data = await response.json();

        if (!data.clientSecret) {
          throw new Error('Failed to create payment intent');
        }

        setClientSecret(data.clientSecret);
        setPaymentIntentId(data.paymentIntentId);
      } catch (err: any) {
        if (err.name === 'AbortError' || !isCurrentRequest) return;
        setPaymentError(err.message || 'Failed to initialize payment');
      } finally {
        if (isCurrentRequest) {
          setIsLoadingPaymentIntent(false);
        }
      }
    };

    createPaymentIntent();

    return () => {
      isCurrentRequest = false;
      abortController.abort();
    };
  }, [showInlinePayment, useDownsell, useFlexBooking, pricingLane, quoteId, customerName, effectiveEmail, detailsConfirmed, total, selectedAddOns, segment, config.downsell?.periodDays, stripe, payFull, payFullTotal, depositAmount, reservation]);

  // Handle inline payment submission
  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements || !clientSecret || !paymentIntentId) return;

    setIsProcessingPayment(true);
    setPaymentError(null);

    try {
      const cardElement = elements.getElement(CardNumberElement);
      if (!cardElement) throw new Error('Card element not found');

      const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(
        clientSecret,
        {
          payment_method: {
            card: cardElement,
            billing_details: {
              name: customerName,
              email: effectiveEmail,
            },
          },
        }
      );

      if (stripeError) throw new Error(stripeError.message);

      if (paymentIntent?.status === 'succeeded') {
        const chargeNow = payFull ? payFullTotal : depositAmount;
        const balance = payFull ? 0 : balanceOnCompletion;
        const mode = payFull ? 'full' as const : 'deposit' as const;

        // Build per-date time preferences for multi-date buffer
        const dateTimePreferences = confirmedDates.map(cd => ({
          date: cd.date,
          timeSlot: cd.timePref,
        }));
        const primaryTimePref = confirmedDates[0]?.timePref;
        const backcompatSlot = primaryTimePref === 'pm' ? 'afternoon' : 'morning';

        // First call onBook to set booking details in parent state
        onBook({
          selectedDate: useFlexBooking || useDownsell ? null : (confirmedDates[0]?.date || selectedDate),
          selectedDates: useFlexBooking ? [] : confirmedDates.map(cd => cd.date),
          dateTimePreferences: !useFlexBooking && dateTimePreferences.length > 0 ? dateTimePreferences : undefined,
          timeSlot: useFlexBooking || useDownsell ? null : backcompatSlot,
          addOns: selectedAddOns,
          totalPrice: total,
          chargeNowPence: chargeNow,
          balanceOnCompletionPence: balance,
          paymentMode: mode,
          usedDownsell: useDownsell,
          address: bookingAddress,
          flexiblePeriodDays: useDownsell ? config.downsell?.periodDays : undefined,
          flexBookingWithinDays: useFlexBooking ? FLEX_WINDOW_DAYS : undefined,
          // Pricing lane → server re-derives selectedTierPricePence from basePrice.
          pricingLane,
          ...landlordTenantPayload,
        });

        // Then call onPaymentSuccess to complete the booking
        if (onPaymentSuccess) {
          await onPaymentSuccess(paymentIntentId);
        }
      } else {
        throw new Error('Payment failed');
      }
    } catch (err: any) {
      setPaymentError(err.message || 'Payment failed. Please try again.');
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const handleExpressCheckoutConfirm = async (_event: StripeExpressCheckoutElementConfirmEvent) => {
    if (!stripe || !elements || !clientSecret || !paymentIntentId) return;

    setIsProcessingPayment(true);
    setPaymentError(null);

    try {
      const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
        elements,
        clientSecret,
        confirmParams: {
          // Redirect-based payment methods land back on the quote link itself —
          // the /q/:slug route resolves UUIDs too, and ?paid=1 tells the page to
          // render the post-payment job hub while the Stripe webhook catches up.
          return_url: `${window.location.origin}/q/${quoteId}?paid=1`,
        },
        redirect: 'if_required',
      });

      if (stripeError) throw new Error(stripeError.message);

      if (paymentIntent?.status === 'succeeded') {
        const chargeNow = payFull ? payFullTotal : depositAmount;
        const balance = payFull ? 0 : balanceOnCompletion;
        const mode = payFull ? 'full' as const : 'deposit' as const;
        const dateTimePreferences = confirmedDates.map(cd => ({
          date: cd.date,
          timeSlot: cd.timePref,
        }));
        const primaryTimePref = confirmedDates[0]?.timePref;
        const backcompatSlot = primaryTimePref === 'pm' ? 'afternoon' : 'morning';

        onBook({
          selectedDate: useFlexBooking || useDownsell ? null : (confirmedDates[0]?.date || selectedDate),
          selectedDates: useFlexBooking ? [] : confirmedDates.map(cd => cd.date),
          dateTimePreferences: !useFlexBooking && dateTimePreferences.length > 0 ? dateTimePreferences : undefined,
          timeSlot: useFlexBooking || useDownsell ? null : backcompatSlot,
          addOns: selectedAddOns,
          totalPrice: total,
          chargeNowPence: chargeNow,
          balanceOnCompletionPence: balance,
          paymentMode: mode,
          usedDownsell: useDownsell,
          address: bookingAddress,
          flexiblePeriodDays: useDownsell ? config.downsell?.periodDays : undefined,
          flexBookingWithinDays: useFlexBooking ? FLEX_WINDOW_DAYS : undefined,
          // Pricing lane → server re-derives selectedTierPricePence from basePrice.
          pricingLane,
          ...landlordTenantPayload,
        });

        if (onPaymentSuccess) {
          await onPaymentSuccess(paymentIntentId);
        }
      } else {
        throw new Error('Payment failed');
      }
    } catch (err: any) {
      setPaymentError(err.message || 'Payment failed. Please try again.');
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const showExpressCheckout = !isLoadingPaymentIntent && isStripeConfigured && !!clientSecret;

  const toggleAddOn = (id: string) => {
    setSelectedAddOns(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // Can book if: downsell selected (flexible timing) OR flex booking OR both date and time selected
  // Large jobs: just need dates (auto full day). Small jobs: dates selected is enough (each defaults to 'flexible')
  // Can book when: downsell, flex booking, or at least 1 confirmed date (with AM/PM chosen).
  // Landlord liaise mode additionally requires a usable tenant contact.
  const canBook = (useDownsell || useFlexBooking || allDatesSelected) && tenantContactOk;

  // Reserve a slot before showing payment — called when date + time are selected
  const handleReserveSlot = async () => {
    if (!quoteId || !selectedDate || !selectedTimeSlot) return;

    setIsReserving(true);
    setReserveError(null);

    try {
      // Map the selectedTimeSlot (morning/afternoon/first) to the server's slot
      // format. Large jobs are full-day commits whose selectedTimeSlot is set to
      // 'morning' only to satisfy the "date + time chosen" gate — do NOT downgrade
      // them to a 4h am/pm slot, or reserveSlot can't fit the job, returns "no
      // contractors", and the date silently clears (looks like nothing happens).
      let slotForServer: 'am' | 'pm' | 'full_day' = selectedSlotChoice;
      if (!isLargeJob) {
        if (selectedTimeSlot === 'morning' || selectedTimeSlot === 'first') {
          slotForServer = 'am';
        } else if (selectedTimeSlot === 'afternoon') {
          slotForServer = 'pm';
        }
      }

      const result = await reserveSlot({
        quoteId,
        // Send the CALENDAR date shown on screen (UK-local, via formatDateStr), not
        // selectedDate.toISOString() — the latter is UTC and lands on the previous day
        // for far-from-UTC viewers (e.g. Asia in UK morning), so the engine checked the
        // wrong day and returned "no contractors". A YYYY-MM-DD string is timezone-safe
        // (server parses it as UTC midnight, matching how availability is keyed).
        scheduledDate: formatDateStr(selectedDate),
        scheduledSlot: slotForServer,
      });

      setReservation(result);
    } catch (err: any) {
      const msg = err.message || 'Failed to reserve slot';
      // A 409 / "no contractors" almost always means the slot was taken between the
      // (cached) availability view and this reserve. Treat it as "just taken": clear the
      // selection, refresh availability so the now-gone date drops off the grid, and show
      // a friendly message instead of a dead-end error.
      if (msg.includes('slot_taken') || msg.includes('just taken') || /no contractors/i.test(msg)) {
        setReserveError('That time was just taken — please pick another date or time.');
        setSelectedDate(null);
        setSelectedTimeSlot(null);
        setPendingDate(null);
        if (quoteId) queryClient.invalidateQueries({ queryKey: ['quoteAvailability', quoteId] });
      } else {
        setReserveError(msg);
      }
    } finally {
      setIsReserving(false);
    }
  };

  // Auto-reserve when date and time are both selected (and not already reserved)
  // Skip for buffer mode — all 3 dates required, contractor assigned later via dispatch
  // Skip for flex booking — there is no specific date to reserve
  useEffect(() => {
    if (selectedDate && selectedTimeSlot && quoteId && !reservation && !isReserving && !useDownsell && !useFlexBooking && confirmedDates.length === 0) {
      // Only auto-reserve for non-buffer single-date flow (no confirmed buffer dates)
      handleReserveSlot();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, selectedTimeSlot, quoteId, confirmedDates.length, useFlexBooking]);

  const handleBook = () => {
    const chargeNow = isCash ? 0 : payFull ? payFullTotal : depositAmount;
    const balance = isCash ? total : payFull ? 0 : balanceOnCompletion;
    const mode = isCash ? 'cash' as const : payFull ? 'full' as const : 'deposit' as const;

    // If using Phase 25 flex booking, no date/time — dispatcher picks within window.
    // Landlord liaise mode rides the same branch but carries the tenant contact so
    // ops arranges access with the tenant rather than auto-routing to a thin day.
    if (useFlexBooking) {
      onBook({
        selectedDate: null,
        timeSlot: null,
        addOns: selectedAddOns,
        totalPrice: total,
        chargeNowPence: chargeNow,
        balanceOnCompletionPence: balance,
        paymentMode: mode,
        usedDownsell: false,
        address: bookingAddress,
        flexBookingWithinDays: FLEX_WINDOW_DAYS,
        // Pricing lane → server re-derives selectedTierPricePence from basePrice.
        pricingLane,
        ...landlordTenantPayload,
      });
      return;
    }

    // If using downsell, date/time are flexible (we pick)
    if (useDownsell) {
      onBook({
        selectedDate: null,
        timeSlot: null,
        addOns: selectedAddOns,
        totalPrice: total,
        chargeNowPence: chargeNow,
        balanceOnCompletionPence: balance,
        paymentMode: mode,
        usedDownsell: true,
        address: bookingAddress,
        flexiblePeriodDays: config.downsell?.periodDays,
      });
      return;
    }

    if (confirmedDates.length === 0) return;
    // Each confirmed date has its own AM/PM/full_day pref
    const dateTimePreferences = confirmedDates.map(cd => ({
      date: cd.date,
      timeSlot: cd.timePref,
    }));
    // Primary time slot for backward compat: use first date's pref
    const primaryTimePref = confirmedDates[0].timePref;
    const backcompatTimeSlot = primaryTimePref === 'pm' ? 'afternoon' : 'morning';

    onBook({
      selectedDate: confirmedDates[0].date,
      selectedDates: confirmedDates.map(cd => cd.date),
      dateTimePreferences,
      timeSlot: backcompatTimeSlot,
      addOns: selectedAddOns,
      totalPrice: total,
      chargeNowPence: chargeNow,
      balanceOnCompletionPence: balance,
      paymentMode: mode,
      usedDownsell: false,
      address: bookingAddress,
      // Firm date & time lane (no flex/downsell) → server applies the set-date premium.
      pricingLane,
    });
  };

  // Theme based on config - useCardWrapper determines if we show in a dark card
  const useCardWrapper = config.useCardWrapper !== false; // defaults to true if not specified
  const isDarkTheme = useCardWrapper; // dark theme only when in card wrapper

  return (
    <div className={`${isDarkTheme ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-3xl overflow-hidden shadow-2xl' : ''}`}>
      {/* Header Badge removed — replaced by QuoteTimer pill */}

      <div className={`${isDarkTheme ? 'p-6' : ''} space-y-6 md:space-y-0 md:grid md:grid-cols-5 md:gap-8 md:items-start`}>
        {/* Price Display — left column on desktop, sticky so it follows the booking flow */}
        <div ref={priceCardRef} className={`text-center md:col-span-2 md:sticky md:top-6 md:self-start ${!isDarkTheme ? 'bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-[#7DB00E] rounded-2xl p-6' : ''}`}>
          <div className={`${isDarkTheme ? 'text-slate-400' : 'text-slate-600'} text-sm mb-1`}>
            {customerName.split(' ')[0]}, your quote
          </div>

          <div className="mb-1">
            <AnimatePresence mode="wait">
              {isCash ? (
                <motion.div
                  key="cash"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="inline-block"
                >
                  <span className={`text-5xl font-black ${isDarkTheme ? 'text-white' : 'text-[#7DB00E]'}`}>
                    £{Math.round(total / 100)}
                  </span>
                  <div className="text-xs mt-1 leading-snug">
                    <span className={`font-bold ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>All-in fixed price.</span>{' '}
                    <span className="text-[#7DB00E]">Pay cash on the day. Nothing now.</span>
                  </div>
                </motion.div>
              ) : payFull ? (
                <motion.div
                  key="full"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="inline-block"
                >
                  <div className="flex items-baseline justify-center gap-1.5">
                    <span className="text-slate-400 line-through text-xl mr-1">
                      £{Math.round(total / 100)}
                    </span>
                    <span className={`text-5xl font-black ${isDarkTheme ? 'text-white' : 'text-[#7DB00E]'}`}>
                      £{Math.round(payFullTotal / 100)}
                    </span>
                  </div>
                  <div className={`text-xs mt-1 ${isDarkTheme ? 'text-slate-500' : 'text-slate-500'}`}>
                    Save {Math.round(PAY_FULL_DISCOUNT * 100)}% · pay today, nothing on the day
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="deposit"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="inline-block"
                >
                  <span className={`text-5xl font-black ${isDarkTheme ? 'text-white' : 'text-[#7DB00E]'}`}>
                    £{Math.round(total / 100)}
                  </span>
                  <div className="text-xs mt-1 leading-snug">
                    <span className={`font-bold ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>All-in fixed price.</span>{' '}
                    <span className="text-[#7DB00E]">Just £{Math.round(depositAmount / 100)} to reserve today.</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Trust strip — a thin one-line band of the included-as-standard benefits
              directly under the price, so value lands at the same moment as the
              number without pushing the price down. Homeowner set only (the one
              carrying sub-lines); short labels keep it to a single line. */}
          {(() => {
            const chips = DIFFERENTIATOR_CHIPS[chipType] ?? DIFFERENTIATOR_CHIPS.homeowner;
            if (!chips.some((c) => c.sub)) return null;
            return (
              <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[10.5px] font-medium">
                {chips.map((item, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1 whitespace-nowrap [&>svg]:w-3.5 [&>svg]:h-3.5 [&>svg]:text-[#7DB00E] ${isDarkTheme ? 'text-slate-200' : 'text-slate-700'}`}
                  >
                    {item.icon}
                    {item.short ?? item.label}
                  </span>
                ))}
              </div>
            );
          })()}

          {/* Payment mode toggle — radio cards matching the Flexible / Pick-date selector.
              Stacks to one column through the cramped 2-col-card range (768–1279px) so the
              label and price subtext each stay on a single line; side-by-side on mobile
              (full-width card) and wide desktop (≥1280px, buttons wide enough). */}
          <div className="mt-4 grid grid-cols-2 md:grid-cols-1 xl:grid-cols-2 gap-2 text-left">
            <button
              type="button"
              onClick={() => { setPayFull(false); setPayCash(false); }}
              className={`rounded-xl p-3 transition-colors active:scale-[0.99] ${
                !payFull && !isCash
                  ? 'bg-[#7DB00E]/10 border-2 border-[#7DB00E]'
                  : isDarkTheme ? 'bg-white/[0.04] border-2 border-white/10' : 'bg-slate-50 border-2 border-slate-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${!payFull && !isCash ? 'bg-[#7DB00E] border-[#7DB00E]' : isDarkTheme ? 'border-white/40' : 'border-slate-400'}`}>
                  {!payFull && !isCash && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                </span>
                <span className={`text-[13px] font-bold ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>I'll reserve it</span>
              </div>
              <p className={`text-[10.5px] leading-snug mt-1 ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
                £{Math.round(depositAmount / 100)} now · £{Math.round(balanceOnCompletion / 100)} later
              </p>
            </button>

            <button
              type="button"
              onClick={() => { setPayFull(true); setPayCash(false); }}
              className={`rounded-xl p-3 transition-colors active:scale-[0.99] ${
                payFull && !isCash
                  ? 'bg-[#7DB00E]/10 border-2 border-[#7DB00E]'
                  : isDarkTheme ? 'bg-white/[0.04] border-2 border-white/10' : 'bg-slate-50 border-2 border-slate-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${payFull && !isCash ? 'bg-[#7DB00E] border-[#7DB00E]' : isDarkTheme ? 'border-white/40' : 'border-slate-400'}`}>
                  {payFull && !isCash && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                </span>
                <span className={`text-[13px] font-bold ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>I'll pay in full</span>
              </div>
              <p className={`text-[10.5px] leading-snug mt-1 ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
                £{Math.round(payFullTotal / 100)} now · <span className="text-[#7DB00E] font-bold">save {Math.round(PAY_FULL_DISCOUNT * 100)}%</span>
              </p>
            </button>
          </div>

          {/* Payment framing — one centred line for BOTH the deposit and pay-in-full
              options so the card height never changes when the customer toggles
              between them. Deposit: on materials-heavy jobs the deposit can exceed
              half the total (100% materials + 30% labour), so say what it buys.
              Pay-in-full: reassure nothing is left on the day (+ the saving). */}
          {!isCash && totalMaterialsPence > 0 && (
            <p className={`mt-2 text-[11px] text-center leading-snug ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
              {payFull
                ? "Paid in full today — nothing more to pay when the job's done."
                : 'Your deposit covers your materials in full, plus 30% of labour.'}
            </p>
          )}

          {/* Cash on the day — OAP homeowners only. Full-width below the card
              options; selecting it takes no online payment (the contractor
              collects cash when the job is done). */}
          {cashEligible && (
            <button
              type="button"
              onClick={() => setPayCash(true)}
              className={`mt-2 w-full rounded-xl p-3 text-left transition-colors active:scale-[0.99] ${
                isCash
                  ? 'bg-[#7DB00E]/10 border-2 border-[#7DB00E]'
                  : isDarkTheme ? 'bg-white/[0.04] border-2 border-white/10' : 'bg-slate-50 border-2 border-slate-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${isCash ? 'bg-[#7DB00E] border-[#7DB00E]' : isDarkTheme ? 'border-white/40' : 'border-slate-400'}`}>
                  {isCash && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                </span>
                <span className={`text-[13px] font-bold ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>I'll pay cash on the day</span>
              </div>
              <p className={`text-[10.5px] leading-snug mt-1 ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
                Nothing to pay now · £{Math.round(total / 100)} cash when the job's done
              </p>
            </button>
          )}

          {/* Inline Price Breakdown (always visible) */}
          {pricingLineItems && pricingLineItems.length > 0 && (
            <div className={`mt-3 pt-3 border-t text-left ${isDarkTheme ? 'border-white/10' : 'border-[#7DB00E]/20'}`}>
              <div className="space-y-1.5">
                {displayLineItems.map(({ item, displayPence }) => (
                  <QuoteLineRow
                    key={item.lineId}
                    item={item}
                    isDarkTheme={isDarkTheme}
                    displayPricePence={displayPence}
                    collapsible={displayLineItems.length >= 5}
                  />
                ))}
              </div>
              {/* Decomposed structural costs (call-out × visits / travel /
                  collection) are FOLDED into each line's displayed price via the
                  per-line structuralSharePence (allocated in the engine, summing
                  exactly to the buckets total). No separate fee rows — the
                  customer sees clean blended per-job prices that reconcile to the
                  total. No-op on legacy/flag-off quotes (share = 0). */}
              {/* Optional extras (ticked add-ons below line items) */}
              {(optionalExtras?.length ?? 0) > 0 && (
                <div className={`mt-3 pt-3 border-t space-y-2 ${isDarkTheme ? 'border-white/10' : 'border-slate-100'}`}>
                  <p className={`text-[11px] font-semibold uppercase tracking-wide ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
                    Optional extras
                  </p>
                  {optionalExtras!.map((extra, idx) => {
                    const id = `extra_${idx}`;
                    const isSelected = selectedAddOns.includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => toggleAddOn(id)}
                        className={`w-full text-left text-[13px] leading-snug rounded-md px-2 py-2 transition-colors ${
                          isSelected
                            ? (isDarkTheme ? 'bg-[#7DB00E]/10' : 'bg-[#7DB00E]/10')
                            : (isDarkTheme ? 'hover:bg-white/5' : 'hover:bg-slate-50')
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <span className={`shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center mt-0.5 ${
                            isSelected
                              ? 'bg-[#7DB00E] border-[#7DB00E]'
                              : (isDarkTheme ? 'border-slate-500' : 'border-slate-300')
                          }`}>
                            {isSelected && <Check className="w-3 h-3 text-slate-900" strokeWidth={3} />}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`font-medium ${isDarkTheme ? 'text-slate-200' : 'text-slate-800'}`}>
                                {extra.label}
                              </span>
                              {extra.badge && (
                                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-[#7DB00E]/20 text-[#7DB00E] font-medium inline-flex items-center gap-1">
                                  <Sparkles className="w-2.5 h-2.5" />
                                  {extra.badge}
                                </span>
                              )}
                            </div>
                            {extra.description && (
                              <p className={`text-[11px] leading-relaxed mt-0.5 ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
                                {extra.description}
                              </p>
                            )}
                          </div>
                          <span className={`shrink-0 font-semibold tabular-nums ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>
                            +£{Math.round(extra.priceInPence / 100)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {/* Discounts & surcharges (honest, line-by-line) */}
              {(batchDiscount?.applied || (payFull && payFullSaving > 0) || saturdayPremiumApplied > 0 || (!useFlexBooking && setDatePremium > 0) || liaisePremiumApplied > 0) && (
                <div className={`mt-2 pt-2 border-t space-y-1.5 ${isDarkTheme ? 'border-white/5' : 'border-slate-100'}`}>
                  {/* Savings zone — grouped + highlighted so they read as offers, not ledger lines */}
                  {(batchDiscount?.applied || (payFull && payFullSaving > 0)) && (
                    <div className="rounded-lg bg-[#7DB00E]/10 px-3 py-2 space-y-1.5">
                      {batchDiscount?.applied && (
                        <div className="flex justify-between items-center text-[13px]">
                          <span className="flex items-center gap-1.5 text-[#7DB00E] font-medium">
                            <Tag className="w-3.5 h-3.5 shrink-0" />
                            {/* Cash amount only — no "(X%)". The discount is a % of
                                labour, but labour is hidden, so a bare "10%" reads as
                                10% of the visible line total and won't match the £.
                                The cash figure always reconciles (lines − saving = total). */}
                            Multi-job saving
                          </span>
                          <span className="text-[#7DB00E] font-bold tabular-nums">−£{Math.round(batchDiscount.savingsPence / 100)}</span>
                        </div>
                      )}
                      {payFull && payFullSaving > 0 && (
                        <div className="flex justify-between items-center text-[13px]">
                          <span className="flex items-center gap-1.5 text-[#7DB00E] font-medium">
                            <Percent className="w-3.5 h-3.5 shrink-0" />
                            Pay in full ({Math.round(PAY_FULL_DISCOUNT * 100)}% off)
                          </span>
                          <span className="text-[#7DB00E] font-bold tabular-nums">−£{Math.round(payFullSaving / 100)}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {/* Date & time premium — neutral addition (premium frame), not an offer */}
                  {!useFlexBooking && setDatePremium > 0 && (
                    <div className="flex justify-between items-center text-[13px]">
                      <span className={`flex items-center gap-1.5 font-medium ${isDarkTheme ? 'text-amber-300' : 'text-amber-700'}`}>
                        <CalendarCheck className="w-3.5 h-3.5 shrink-0" />
                        Date &amp; time
                      </span>
                      <span className={`font-semibold tabular-nums ${isDarkTheme ? 'text-amber-300' : 'text-amber-700'}`}>
                        +£{Math.round(setDatePremium / 100)}
                      </span>
                    </div>
                  )}
                  {/* Surcharge stays neutral and outside the savings zone — it isn't an offer */}
                  {saturdayPremiumApplied > 0 && (
                    <div className="flex justify-between text-[13px]">
                      <span className={`font-medium ${isDarkTheme ? 'text-amber-300' : 'text-amber-700'}`}>
                        {isContextual ? 'Saturday visit' : 'Saturday surcharge — peak demand'}
                      </span>
                      <span className={`font-semibold tabular-nums ${isDarkTheme ? 'text-amber-300' : 'text-amber-700'}`}>
                        +£{Math.round(saturdayPremiumApplied / 100)}
                      </span>
                    </div>
                  )}
                  {/* Tenant-liaison premium — neutral addition, not an offer */}
                  {liaisePremiumApplied > 0 && (
                    <div className="flex justify-between items-center text-[13px]">
                      <span className={`flex items-center gap-1.5 font-medium ${isDarkTheme ? 'text-slate-300' : 'text-slate-600'}`}>
                        <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                        Tenant liaison
                      </span>
                      <span className={`font-semibold tabular-nums ${isDarkTheme ? 'text-slate-200' : 'text-slate-700'}`}>
                        +£{Math.round(liaisePremiumApplied / 100)}
                      </span>
                    </div>
                  )}
                </div>
              )}
              {/* Total */}
              <div className={`mt-2 pt-2 border-t flex justify-between items-center font-bold ${isDarkTheme ? 'border-white/10' : 'border-slate-200'}`}>
                <span className={isDarkTheme ? 'text-white' : 'text-slate-900'}>Total</span>
                <span className="text-[#7DB00E] text-lg tabular-nums">£{Math.round((payFull ? payFullTotal : total) / 100)}</span>
              </div>
              {/* Other customer types keep their compact "included as standard"
                  chips here, below the total. The homeowner set (which carries
                  sub-lines) is lifted above the price hero instead — see the top
                  of the price column. */}
              {(() => {
                const chips = DIFFERENTIATOR_CHIPS[chipType] ?? DIFFERENTIATOR_CHIPS.homeowner;
                if (chips.some((c) => c.sub)) return null; // rich set renders above the price
                return (
                  <div className={`mt-3 pt-3 border-t ${isDarkTheme ? 'border-white/10' : 'border-slate-200'}`}>
                    <p className={`text-[11px] font-semibold uppercase tracking-wide mb-2 ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
                      Included as standard
                    </p>
                    <div className="grid grid-cols-4 gap-2">
                      {chips.map((item, i) => (
                        <div
                          key={i}
                          className={`flex flex-col items-center justify-center rounded-lg py-2.5 px-1 text-center ${
                            isDarkTheme
                              ? 'bg-white/5 border border-white/10'
                              : 'bg-slate-50 border border-slate-200'
                          }`}
                        >
                          <div className="text-[#7DB00E] mb-1">{item.icon}</div>
                          <span className={`text-[10px] font-medium leading-tight ${isDarkTheme ? 'text-slate-300' : 'text-slate-600'}`}>
                            {item.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Share — big-ticket decisions rarely happen alone; let the customer
              forward the quote to whoever signs it off (spouse, landlord) without
              Ben needing an email on file. Quiet text button so it never competes
              with the booking CTA. */}
          <button
            type="button"
            onClick={handleShareQuote}
            className={`mt-3 mx-auto flex items-center gap-1.5 text-[12px] font-medium transition-colors ${isDarkTheme ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <Share2 className="w-3.5 h-3.5" />
            {shareCopied ? 'Link copied' : 'Share this quote'}
          </button>

          {/* Contact card — chat or call Ben directly (reduces decision anxiety).
              Uses the same translucent dark fill as the "included as standard" tiles
              (bg-white/5 + border-white/10) so it blends into the dark card instead of
              floating as a solid white panel; text is light for contrast on the dark
              fill. Header + subtitle are left-aligned (override the inherited
              text-center) and forced onto a single line each (whitespace-nowrap); the
              buttons are sized down to free room for the subtitle to fit. */}
          <div className="mt-4 rounded-2xl bg-white/5 border border-white/10 p-3.5 flex items-center justify-between gap-2">
            <div className="min-w-0 text-left">
              <p className="text-[14px] font-bold text-white leading-tight whitespace-nowrap">Still have questions?</p>
              <p className="text-[11px] text-slate-400 leading-snug mt-0.5 whitespace-nowrap">Connect with {BRAND.lead} for answers.</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <a
                href={`https://wa.me/447508744402?text=${encodeURIComponent(`Hi, I have a question about my quote${shortSlug ? ` (${shortSlug})` : ''}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Message ${BRAND.lead} on WhatsApp`}
                className="w-9 h-9 rounded-full bg-[#7DB00E] text-white flex items-center justify-center shadow-sm transition-colors hover:bg-[#6a9a0c]"
              >
                <MessageCircle className="w-4 h-4" />
              </a>
              <a
                href="https://call.whatsapp.com/voice/2yJRisb6ailWZArVFCDqVm"
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Call ${BRAND.lead} on WhatsApp`}
                className="w-9 h-9 rounded-full bg-white/10 text-[#a3d65f] flex items-center justify-center transition-colors hover:bg-white/20"
              >
                <Phone className="w-4 h-4" />
              </a>
            </div>
          </div>

        </div>

        {/* Right column on desktop: booking flow (scheduling, add-ons, trust, payment) */}
        <div className="space-y-6 md:col-span-3">

        {/* Downsell Option (if available and flexible_discount mode enabled).
            Phase 26 / Anomaly #3 — when ANY SKU line on the quote is
            flex_eligible, the newer Phase 25 "Flexible booking" checkbox
            renders instead, so we hide this legacy downsell to avoid
            showing two visually-different flex options for the same
            concept. Legacy quotes without SKU lines (showFlexBookingCheckbox
            === false) still see this downsell exactly as before. */}
        {config.downsell && showFlexibleDiscount && !showFlexBookingCheckbox && (
          <div className={`rounded-xl p-4 ${useDownsell
            ? 'bg-[#7DB00E]/20 border-2 border-[#7DB00E]'
            : isDarkTheme ? 'bg-white/10 border-2 border-white/10' : 'bg-slate-100 border-2 border-transparent'
          }`}>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={useDownsell}
                onChange={() => {
                  const newValue = !useDownsell;
                  setUseDownsell(newValue);
                  trackBookingModeInteraction({ quoteId: quoteId || '', shortSlug: shortSlug || '', mode: 'downsell', action: newValue ? 'selected' : 'abandoned', totalPricePence: total, segment });
                  // Clear date/time selection when toggling downsell
                  if (newValue) {
                    setSelectedDate(null);
                    setSelectedTimeSlot(null);
                    // Scroll to add-ons or book section
                    setTimeout(() => {
                      if (allAddOns.length > 0) {
                        addOnsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      } else {
                        bookSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }
                    }, 150);
                  }
                }}
                className={`w-5 h-5 rounded text-[#7DB00E] focus:ring-[#7DB00E] ${isDarkTheme ? 'border-white/30 bg-white/10' : 'border-slate-300'}`}
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`font-bold ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>{config.downsell.label}</span>
                  <span className="text-xs bg-[#7DB00E] text-white px-2 py-0.5 rounded-full font-bold">
                    -{config.downsell.discountPercent}%
                  </span>
                </div>
                <p className={`text-sm ${isDarkTheme ? 'text-slate-400' : 'text-slate-600'}`}>{config.downsell.description}</p>
              </div>
            </label>

            {/* Show confirmation when selected */}
            {useDownsell && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mt-4 pt-4 border-t border-[#7DB00E]/30"
              >
                <div className={`flex items-center gap-3 ${isDarkTheme ? 'text-slate-200' : 'text-slate-700'}`}>
                  <div className="w-10 h-10 rounded-full bg-[#7DB00E] flex items-center justify-center flex-shrink-0">
                    <Check className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold">We'll schedule you {config.downsell.periodLabel}</p>
                    <p className={`text-sm ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>Best available slot on our route - you save {config.downsell.discountPercent}%</p>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        )}

        {/* Phase 25 — Flex booking checkbox (yield mechanism).
            Hidden when no SKU line on this quote is flex-eligible so legacy
            quotes don't see an option that can't be honoured. When checked
            the date picker hides, a 10% discount applies, and the booking
            ships `flexBookingWithinDays: 7` to the server. */}
        {/* Flex toggle now lives inside the scheduling block, centred directly
            above the date grid (Phase 29 — see below). */}

        {/* Step 1: 3-Date Buffer — split-button flow: tap date → button splits into AM/PM → tap half to confirm */}
        {!useDownsell && showStandardDate && (
        <div ref={dateSectionRef} className="scroll-mt-24">
          <h4 className={`text-3xl font-extrabold tracking-tight mb-3 flex items-center justify-center gap-2.5 text-center ${isDarkTheme ? 'text-white' : 'text-slate-800'}`}>
            <Calendar className="w-7 h-7 text-[#7DB00E]" />
            {isContextual ? 'When suits you?' : 'Secure your slot'}
            {isLoadingQuoteAvailability && (
              <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
            )}
          </h4>

          {/* Landlord scheduling — a single opt-in premium toggle ("Can't be there?
              We'll liaise with your tenant · +£25") above the always-visible date
              grid. ON reuses useFlexBooking (no fixed date, inline payment) and
              captures the tenant's contact so ops arranges access; tapping a grid
              date flips it off into a firm, standard-rate booking. Shown for
              landlords regardless of SKU flex-eligibility; the non-landlord
              flex/set-date toggle below is hidden for them. */}
          {isLandlord && (
            <div className="mb-4">
              <div className="space-y-2">
                {/* Tenant-liaison premium — opt-in concierge toggle. ON ⇒ no fixed
                    date, +£25, tenant capture. The date grid stays visible below;
                    tapping a date there flips this off (firm booking, standard rate). */}
                <button
                  ref={liaiseToggleRef}
                  id="liaise-toggle"
                  type="button"
                  onClick={() => {
                    if (useFlexBooking) {
                      // Re-tap toggles the premium back off — the grid below is the
                      // firm-date fallback, already on screen.
                      setUseFlexBooking(false);
                      trackBookingModeInteraction({ quoteId: quoteId || '', shortSlug: shortSlug || '', mode: 'liaise', action: 'abandoned', totalPricePence: total, segment });
                      return;
                    }
                    setUseFlexBooking(true);
                    trackBookingModeInteraction({ quoteId: quoteId || '', shortSlug: shortSlug || '', mode: 'liaise', action: 'selected', totalPricePence: total, segment });
                    setSelectedDate(null);
                    setSelectedTimeSlot(null);
                    setPendingDate(null);
                    setConfirmedDates([]);
                    if (reservation) {
                      releaseSlotLock(reservation.lockId).catch(() => {});
                      setReservation(null);
                    }
                    if (useDownsell) setUseDownsell(false);
                  }}
                  className={`w-full rounded-xl p-3 text-left transition-[background-color,border-color,box-shadow,color] duration-300 ease-out active:scale-[0.99] ${
                    useFlexBooking
                      ? 'bg-handy-yellow/15 border-2 border-handy-yellow'
                      : isDarkTheme ? 'bg-white/[0.04] border-2 border-white/10' : 'bg-slate-50 border-2 border-slate-200'
                  } ${liaisePulse ? `ring-2 ring-[#7DB00E] ring-offset-2 ${isDarkTheme ? 'ring-offset-[#1D2D3D]' : 'ring-offset-white'}` : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center ${useFlexBooking ? 'bg-handy-yellow border-handy-yellow' : isDarkTheme ? 'border-white/40' : 'border-slate-400'}`}>
                      {useFlexBooking && <Check className="w-3 h-3 text-handy-navy" strokeWidth={3} />}
                    </span>
                    <span className={`text-[13px] font-bold ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>We'll liaise with your tenant</span>
                    <span className="ml-auto shrink-0 text-[10px] bg-handy-yellow text-handy-navy px-1.5 py-0.5 rounded-full font-bold">+£{LIAISE_PREMIUM_PENCE / 100}</span>
                  </div>
                  <p className={`text-[10.5px] leading-snug mt-1 ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
                    We arrange access so you don't need to be there.
                  </p>
                </button>

                {/* Tenant contact — revealed only in liaise mode */}
                <AnimatePresence initial={false}>
                  {useFlexBooking && (
                    <motion.div
                      key="tenant-capture"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
                      className="overflow-hidden"
                    >
                      <div className={`rounded-xl p-3 space-y-2.5 ${isDarkTheme ? 'bg-white/[0.04] border border-white/10' : 'bg-white border border-slate-200'}`}>
                        <p className={`text-[11px] font-semibold uppercase tracking-wide ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
                          Your tenant's details
                        </p>
                        <div className="space-y-2">
                          <div className="relative">
                            <User className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none ${isDarkTheme ? 'text-slate-500' : 'text-slate-400'}`} />
                            <input
                              type="text"
                              value={tenantName}
                              onChange={e => setTenantName(e.target.value)}
                              placeholder="Tenant's name"
                              className={`w-full border rounded-lg pl-9 pr-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-[#7DB00E]/40 ${
                                isDarkTheme ? 'border-white/20 bg-slate-800 text-white placeholder:text-slate-500' : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400'
                              }`}
                            />
                          </div>
                          <div className="relative">
                            <Phone className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none ${isDarkTheme ? 'text-slate-500' : 'text-slate-400'}`} />
                            <input
                              type="tel"
                              inputMode="tel"
                              value={tenantMobile}
                              onChange={e => setTenantMobile(e.target.value)}
                              placeholder="Tenant's mobile"
                              className={`w-full border rounded-lg pl-9 pr-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-[#7DB00E]/40 ${
                                isDarkTheme ? 'border-white/20 bg-slate-800 text-white placeholder:text-slate-500' : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400'
                              }`}
                            />
                          </div>
                        </div>
                        <p className={`text-[10.5px] leading-snug ${isDarkTheme ? 'text-slate-500' : 'text-slate-400'}`}>
                          We'll text them to agree a time, then confirm it with you.
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

              </div>
            </div>
          )}

          {/* Phase 29 — Flexible vs Pick-exact-date (two equal boxes). Flexible
              is the default and is priced at the base price; choosing "Pick exact
              date" drops the date grid below and adds the set-date premium.
              Non-flex-eligible quotes skip this and just show the grid. Hidden for
              landlords (they get the liaise toggle above). */}
          {/* "I'm flexible" / "I want a date & time" toggle — offered to EVERY
              non-landlord quote (it's the homeowner counterpart to the landlord
              liaise toggle), no longer gated on per-line SKU flex-eligibility.
              The flexible lane is just the base price, so it's valid on any quote.
              `isQuoteFlexEligible` now only decides whether flex auto-defaults ON
              (see effect above); the option itself is always shown. Landlords get
              the liaise toggle instead. */}
          {!isLandlord && (
            <div className="mb-4">
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    if (useFlexBooking) return;
                    setUseFlexBooking(true);
                    trackBookingModeInteraction({ quoteId: quoteId || '', shortSlug: shortSlug || '', mode: 'flex', action: 'selected', totalPricePence: total, segment });
                    setSelectedDate(null);
                    setSelectedTimeSlot(null);
                    setPendingDate(null);
                    setConfirmedDates([]);
                    if (reservation) {
                      releaseSlotLock(reservation.lockId).catch(() => {});
                      setReservation(null);
                    }
                    if (useDownsell) setUseDownsell(false);
                  }}
                  className={`w-full rounded-xl p-3 text-left transition-colors active:scale-[0.99] ${
                    useFlexBooking
                      ? 'bg-handy-yellow/15 border-2 border-handy-yellow'
                      : isDarkTheme ? 'bg-white/[0.04] border-2 border-white/10' : 'bg-slate-50 border-2 border-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${useFlexBooking ? 'bg-handy-yellow border-handy-yellow' : isDarkTheme ? 'border-white/40' : 'border-slate-400'}`}>
                      {useFlexBooking && <Check className="w-3 h-3 text-handy-navy" strokeWidth={3} />}
                    </span>
                    <span className={`text-[13px] font-bold ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>I'm flexible</span>
                    {isBusiness && (
                      <span className="ml-auto text-[10px] bg-handy-yellow text-handy-navy px-1.5 py-0.5 rounded-full font-bold">Guaranteed</span>
                    )}
                  </div>
                  <p className={`text-[10.5px] leading-snug mt-1 ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
                    {isBusiness
                      ? `Done within ${FLEX_WINDOW_DAYS} days — backup engineer booked, so your date never slips`
                      : `We pick the best weekday within ${FLEX_WINDOW_DAYS} days`}
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!useFlexBooking) return;
                    setUseFlexBooking(false);
                    trackBookingModeInteraction({ quoteId: quoteId || '', shortSlug: shortSlug || '', mode: 'set_date', action: 'selected', totalPricePence: total, segment });
                    setTimeout(() => {
                      dateSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 120);
                  }}
                  className={`w-full rounded-xl p-3 text-left transition-colors active:scale-[0.99] ${
                    !useFlexBooking
                      ? 'bg-[#7DB00E]/10 border-2 border-[#7DB00E]'
                      : isDarkTheme ? 'bg-white/[0.04] border-2 border-white/10' : 'bg-slate-50 border-2 border-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${!useFlexBooking ? 'bg-[#7DB00E] border-[#7DB00E]' : isDarkTheme ? 'border-white/40' : 'border-slate-400'}`}>
                      {!useFlexBooking && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                    </span>
                    <span className={`text-[13px] font-bold ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>I want a date &amp; time</span>
                    {!isBusiness && setDatePremium > 0 ? (
                      <span className="ml-auto text-[10px] bg-amber-400 text-amber-950 px-1.5 py-0.5 rounded-full font-bold">+£{Math.round(setDatePremium / 100)}</span>
                    ) : (
                      <CalendarCheck className="ml-auto w-4 h-4 text-slate-400" />
                    )}
                  </div>
                  <p className={`text-[10.5px] leading-snug mt-1 ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
                    {isBusiness ? 'Choose a specific day yourself' : 'Your exact day & time slot — no day off to wait in'}
                  </p>
                </button>
              </div>
            </div>
          )}

          {/* Date grid — shown whenever flex/liaise is OFF. Landlords: hidden in
              liaise mode (no fixed date yet), back when liaise is off. Everyone
              else: hidden under "I'm flexible", drops down on "I want a date & time". */}
          <AnimatePresence initial={false}>
          {!useFlexBooking && (
          <motion.div
            key="date-grid-drop"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            // overflow-hidden is needed for the height drop animation, but it also
            // clips the selected date tile's ring-offset on the edge columns. The
            // -mx-1.5/px-1.5 pair pushes the clip boundary 6px outward while keeping
            // the grid content aligned, so the ring has room to breathe.
            className="overflow-hidden -mx-1.5 px-1.5"
          >
          {/* Minimal-premium, scarcity-forward cue (Airbnb/Google pattern): a live dot +
              an HONEST "Only N dates left this week" (counted from real availability), with
              a freshness fallback; plus a gentle "tap a date" nudge that disappears once
              the customer engages. Centered + enlarged for prominence. */}
          {quoteId && quoteAvailabilityData && (
            <div className="mb-4 space-y-2 text-center">
              {/* Phase 24d — multi-day job header. Surfaces "3-day job — pick
                  a start date" when the quote spans more than one working
                  day so customers understand the date is a starting point. */}
              {jobDurationDays > 1 && (() => {
                // Phase 24d — when a date is picked, show the actual span so
                // the customer sees "we'll be there Wed → Fri" not just "Wed".
                const pickedDate = selectedDate || pendingDate || confirmedDates[0]?.date || null;
                let spanReadout: string | null = null;
                if (pickedDate) {
                  const end = new Date(pickedDate);
                  end.setDate(pickedDate.getDate() + (jobDurationDays - 1));
                  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
                  spanReadout = `${fmt(pickedDate)} → ${fmt(end)}`;
                }
                return (
                  <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-[#7DB00E] shadow-sm shadow-[#7DB00E]/20">
                    <CalendarRange className="w-5 h-5 shrink-0 text-[#1D2D3D]" strokeWidth={2.25} />
                    <div className="flex flex-col min-w-0 text-left">
                      <span className="text-sm font-extrabold uppercase tracking-wide leading-tight text-[#1D2D3D]">
                        {jobDurationDays}-day job
                      </span>
                      {spanReadout ? (
                        <span className="text-xs leading-snug font-semibold text-[#1D2D3D]/85">
                          We'll be here{' '}
                          <span className="font-extrabold tabular-nums text-[#1D2D3D]">{spanReadout}</span>
                        </span>
                      ) : (
                        <span className="text-xs leading-snug font-semibold text-[#1D2D3D]/85">
                          Pick a start date — we'll be here for {jobDurationDays} consecutive days
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}
              <div className={`flex items-center justify-center gap-2 text-base font-bold ${isDarkTheme ? 'text-gray-100' : 'text-slate-800'}`}>
                {isContextual && !scarcityLabel ? (
                  <Calendar className="w-4 h-4 text-[#7DB00E] flex-shrink-0" />
                ) : (
                  <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#7DB00E] opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#7DB00E]" />
                  </span>
                )}
                {scarcityLabel
                  ? <span>{scarcityLabel}</span>
                  : <span className="font-medium">{isContextual ? "Here's where I can fit you in" : `Real-time availability · updated ${availabilityUpdatedLabel}`}</span>}
              </div>
              {confirmedDates.length === 0 && !pendingDate && (
                <div className={`flex items-center justify-center gap-1 text-sm ${isDarkTheme ? 'text-gray-400' : 'text-slate-500'}`}>
                  <ChevronDown className="w-5 h-5 text-[#7DB00E]" />
                  {isContextual ? 'Pick whatever day works' : 'Tap a date below'}
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-4 gap-2">
            {visibleDates.map((d) => {
              const isSelected = !!selectedDate && selectedDate.toDateString() === d.date.toDateString();
              const isPending = pendingDate?.toDateString() === d.date.toDateString();

              // Single-date commit: set the chosen date + slot (confirmedDates stays empty),
              // which activates the reserve → countdown → pay path below.
              const confirmDate = (timePref: TimePref) => {
                setSelectedDate(d.date);
                setPendingDate(null);
                setSelectedTimeSlot(timePref === 'pm' ? 'afternoon' : 'morning');
                setSelectedSlotChoice(timePref === 'pm' ? 'pm' : timePref === 'full_day' ? 'full_day' : 'am');
              };

              // SPLIT BUTTON: when pending, show AM/PM halves instead of normal date
              if (isPending && !isLargeJob) {
                return (
                  <div key={d.date.toISOString()} className="flex flex-col gap-0.5">
                    {/* Date label on top */}
                    <div className={`text-[10px] font-semibold text-center py-0.5 rounded-t-xl ${isDarkTheme ? 'bg-amber-500/30 text-amber-300' : 'bg-amber-100 text-amber-700'}`}>
                      {format(d.date, 'EEE d')}
                    </div>
                    {/* AM half */}
                    <button
                      type="button"
                      onClick={() => confirmDate('am')}
                      className={`py-2 rounded-none text-center transition-all ${
                        isDarkTheme
                          ? 'bg-white/10 text-white hover:bg-[#7DB00E] hover:text-slate-900'
                          : 'bg-white text-slate-700 hover:bg-[#7DB00E] hover:text-white border-x border-t border-slate-200 hover:border-[#7DB00E]'
                      }`}
                    >
                      <div className="font-bold text-xs">AM</div>
                      <div className="text-[9px] opacity-60">8am–1pm</div>
                    </button>
                    {/* PM half */}
                    <button
                      type="button"
                      onClick={() => confirmDate('pm')}
                      className={`py-2 rounded-b-xl text-center transition-all ${
                        isDarkTheme
                          ? 'bg-white/10 text-white hover:bg-[#7DB00E] hover:text-slate-900'
                          : 'bg-white text-slate-700 hover:bg-[#7DB00E] hover:text-white border-x border-b border-slate-200 hover:border-[#7DB00E]'
                      }`}
                    >
                      <div className="font-bold text-xs">PM</div>
                      <div className="text-[9px] opacity-60">1pm–6pm</div>
                    </button>
                  </div>
                );
              }

              return (
              <button
                key={d.date.toISOString()}
                onClick={() => {
                  if (d.isBlocked) return;
                  if (reservation) {
                    releaseSlotLock(reservation.lockId).catch(() => {});
                    setReservation(null);
                  }

                  if (isSelected) {
                    // Tap the selected date → deselect
                    setSelectedDate(null);
                    setSelectedTimeSlot(null);
                    setPendingDate(null);
                    return;
                  }

                  // Phase 29 — picking a specific date opts out of the default
                  // flexible discount (you pay the standard, non-discounted rate).
                  if (useFlexBooking) {
                    setUseFlexBooking(false);
                    trackBookingModeInteraction({ quoteId: quoteId || '', shortSlug: shortSlug || '', mode: 'set_date', action: 'selected', totalPricePence: total, segment });
                  }

                  if (isLargeJob) {
                    // Large jobs: single full-day commit
                    setSelectedDate(d.date);
                    setSelectedSlotChoice('full_day');
                    setSelectedTimeSlot('morning');
                  } else {
                    // Small jobs: tap → split into AM/PM
                    setPendingDate(d.date);
                  }
                }}
                disabled={d.isBlocked}
                className={`p-3 rounded-xl text-center transition-all relative min-h-[97px] flex flex-col items-center justify-center ${
                  d.isBlocked
                    ? 'opacity-50 cursor-not-allowed' + (isDarkTheme ? ' bg-white/5 text-slate-500' : ' bg-slate-100 text-slate-400 border border-slate-200')
                    : isSelected
                    ? 'bg-[#7DB00E] text-slate-900 ring-2 ring-[#7DB00E] ring-offset-2' + (isDarkTheme ? ' ring-offset-slate-900' : '')
                    : d.isNextDay
                      ? 'date-card-shimmer ' + (isDarkTheme
                        ? 'bg-amber-500/20 text-white hover:bg-amber-500/30 border border-amber-500/50'
                        : 'bg-amber-50 text-slate-700 hover:bg-amber-100 border border-amber-300')
                      : 'date-card-shimmer ' + (isDarkTheme
                        ? 'bg-white/10 backdrop-blur-md border border-white/10 text-white hover:bg-white/20'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
                }`}
                title={d.isWeekend && d.fee > 0 ? (isContextual ? 'Saturday visit' : 'Saturday surcharge — peak demand') : undefined}
              >
                {d.isNextDay && !d.isBlocked && !isSelected && (
                  <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 text-[8px] font-bold bg-amber-500 text-white px-1.5 py-0.5 rounded">
                    PRIORITY
                  </div>
                )}
                {/* Phase 25 — Saturday badge so the surcharge isn't surprising.
                    Hidden on the selected/blocked variants to avoid clutter. */}
                {d.isWeekend && !d.isBlocked && !isSelected && !d.isNextDay && d.fee > 0 && (
                  <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 text-[8px] font-bold bg-handy-yellow text-handy-navy px-1.5 py-0.5 rounded">
                    SAT
                  </div>
                )}
                <div className="text-xs font-medium">{format(d.date, 'EEE')}</div>
                <div className="text-lg font-bold leading-tight">{format(d.date, 'd')}</div>
                {/* Month — dates roll across the month boundary (e.g. late June into
                    July), so without it "1" vs "30" is ambiguous. Muted so the day
                    number stays the hero. */}
                <div className="text-[10px] font-medium opacity-75">{format(d.date, 'MMM')}</div>
                {d.isBlocked ? (
                  // Unavailable, not an error — recede in muted neutral so the one
                  // available (green) date is the clear hero, instead of a wall of red.
                  <div className={`text-[9px] font-medium mt-0.5 ${isDarkTheme ? 'text-slate-500' : 'text-slate-400'}`}>Fully booked</div>
                ) : isSelected && !isLargeJob ? (
                  <div className="text-[9px] font-bold mt-0.5 text-slate-900">
                    {selectedSlotChoice === 'pm' ? 'Afternoon' : 'Morning'}
                  </div>
                ) : d.fee > 0 ? (
                  <div className={`text-[10px] mt-0.5 ${d.isWeekend ? 'text-handy-yellow font-semibold' : 'text-amber-400'}`}>
                    +£{d.fee / 100}
                  </div>
                ) : null}
              </button>
              );
            })}
          </div>

          {/* Phase 25 — Honest Saturday caption. Only renders when a Saturday
              date is actually selected and we're charging a surcharge. */}
          {saturdayPremiumApplied > 0 && (
            <p className={`mt-2 text-[11px] text-center ${isDarkTheme ? 'text-amber-300' : 'text-amber-700'}`}>
              <span className="font-semibold">+£{Math.round(saturdayPremiumApplied / 100)}</span>{' '}
              {isContextual ? 'for a Saturday visit' : 'Saturday surcharge — peak demand'}
            </p>
          )}

          {!showAllDates && filteredDates.length > 8 && (
            <button
              onClick={() => setShowAllDates(true)}
              className={`w-full mt-2 text-sm text-[#7DB00E] font-medium rounded-xl py-2.5 transition-colors ${isDarkTheme ? 'bg-white/5 backdrop-blur-md border border-white/10 hover:bg-white/10' : 'bg-slate-50 border border-slate-200 hover:bg-slate-100'}`}
            >
              Show more dates...
            </button>
          )}
          </motion.div>
          )}
          </AnimatePresence>
        </div>
        )}

        {/* Step 2: Reservation status + contractor info — only for single-date bookings, NOT 3-date buffer */}
        <AnimatePresence>
          {!useDownsell && selectedDate && confirmedDates.length === 0 && (
            <motion.div
              ref={timeSectionRef}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-3"
            >
              {/* Reserving — a prominent "holding your slot" card sized like the
                  reserved card, with a spinning ring that mirrors (and visually
                  morphs into) the countdown ring once the slot is held. Gives the
                  customer a clear "we're securing it, hang on" beat to wait through. */}
              {isReserving && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className={`p-4 rounded-xl border space-y-3 ${isDarkTheme ? 'bg-[#7DB00E]/10 border-[#7DB00E]/30' : 'bg-green-50 border-green-200'}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 flex-shrink-0 flex items-center justify-center">
                      <svg className="w-11 h-11 animate-spin" viewBox="0 0 44 44">
                        <circle cx="22" cy="22" r="18" fill="none" strokeWidth="3" className="stroke-[#7DB00E]/15" />
                        <circle cx="22" cy="22" r="18" fill="none" strokeWidth="3" strokeLinecap="round"
                          className="stroke-[#7DB00E]"
                          strokeDasharray={2 * Math.PI * 18} strokeDashoffset={2 * Math.PI * 18 * 0.7} />
                      </svg>
                    </div>
                    <div>
                      <div className={`text-sm font-bold ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>
                        {isContextual ? 'Pencilling you in…' : 'Holding your slot…'}
                      </div>
                      <div className={`text-xs ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
                        {selectedDate
                          ? `${format(selectedDate, 'EEE d MMM')}${isLargeJob ? '' : ` · ${selectedSlotChoice === 'pm' ? 'Afternoon' : 'Morning'}`} · just a moment`
                          : 'Just a moment'}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Reservation error */}
              {reserveError && (
                <Alert variant="destructive" className="bg-red-50 border-red-200">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{reserveError}</AlertDescription>
                </Alert>
              )}

              {/* Reservation success: a live 5-minute countdown that pushes the
                  customer to pay before the slot is released. Once they proceed
                  (detailsConfirmed → server lock extended), it switches to a calm
                  "secured" state so it can't pressure an in-flight payment. */}
              {reservation && (() => {
                const secsLeft = countdownSeconds;
                const m = Math.floor(secsLeft / 60);
                const s = secsLeft % 60;
                const mmss = `${m}:${String(s).padStart(2, '0')}`;
                const frac = Math.max(0, Math.min(1, secsLeft / RESERVE_WINDOW_SECONDS));
                const urgent = !detailsConfirmed && secsLeft <= 90;
                const C = 2 * Math.PI * 18; // ring circumference (r=18)
                const dateLine = selectedDate
                  ? `${format(selectedDate, 'EEE d MMM')}${isLargeJob ? '' : ` · ${selectedSlotChoice === 'pm' ? 'Afternoon' : 'Morning'}`}`
                  : '';
                return (
                  <div className={`p-4 rounded-xl border space-y-3 transition-colors ${
                    detailsConfirmed
                      ? (isDarkTheme ? 'bg-[#7DB00E]/10 border-[#7DB00E]/30' : 'bg-green-50 border-green-200')
                      : urgent
                        ? (isDarkTheme ? 'bg-amber-500/10 border-amber-500/40' : 'bg-amber-50 border-amber-300')
                        : (isDarkTheme ? 'bg-[#7DB00E]/10 border-[#7DB00E]/30' : 'bg-green-50 border-green-200')
                  }`}>
                    <div className="flex items-center gap-3">
                      {detailsConfirmed ? (
                        <div className="w-11 h-11 rounded-full bg-[#7DB00E]/20 flex items-center justify-center flex-shrink-0">
                          <Check className="w-5 h-5 text-[#7DB00E]" />
                        </div>
                      ) : (
                        <div className="relative w-11 h-11 flex-shrink-0">
                          <svg className="w-11 h-11 -rotate-90" viewBox="0 0 44 44">
                            <circle cx="22" cy="22" r="18" fill="none" strokeWidth="3"
                              className={urgent ? 'stroke-amber-500/20' : 'stroke-[#7DB00E]/20'} />
                            <circle cx="22" cy="22" r="18" fill="none" strokeWidth="3" strokeLinecap="round"
                              className={urgent ? 'stroke-amber-400' : 'stroke-[#7DB00E]'}
                              strokeDasharray={C} strokeDashoffset={C * (1 - frac)}
                              style={{ transition: 'stroke-dashoffset 1s linear' }} />
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className={`text-[11px] font-bold tabular-nums ${
                              urgent ? (isDarkTheme ? 'text-amber-300' : 'text-amber-600') : (isDarkTheme ? 'text-white' : 'text-slate-900')
                            }`}>{mmss}</span>
                          </div>
                        </div>
                      )}
                      <div>
                        <div className={`text-sm font-bold ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>
                          {detailsConfirmed ? (isContextual ? "You're all set" : 'Slot secured') : (isContextual ? `Holding it for you · ${mmss}` : `Slot held — ${mmss} left`)}
                        </div>
                        <div className={`text-xs ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
                          {dateLine}
                        </div>
                      </div>
                    </div>

                    <div className={`flex items-center gap-2 text-xs ${
                      urgent ? (isDarkTheme ? 'text-amber-300' : 'text-amber-700') : (isDarkTheme ? 'text-slate-400' : 'text-slate-500')
                    }`}>
                      <Lock className={`w-3.5 h-3.5 ${urgent ? 'text-amber-400' : 'text-[#7DB00E]'}`} />
                      <span>{detailsConfirmed ? (isContextual ? "Add your details and you're booked" : 'Finish payment to confirm your booking') : (isContextual ? "No rush — I'll hold it while you decide" : 'Secure it now before the slot is released')}</span>
                    </div>
                  </div>
                );
              })()}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Step 3: Add-ons (after time OR when using downsell) */}
        <AnimatePresence>
          {(useDownsell || useFlexBooking || selectedTimeSlot) && allAddOns.length > 0 && (
            <motion.div
              ref={addOnsSectionRef}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <h4 className={`text-sm font-bold ${config.addOnsLabel ? '' : 'uppercase'} tracking-wide mb-3 flex items-center gap-2 ${isDarkTheme ? 'text-white' : 'text-slate-700'}`}>
                <Tag className="w-4 h-4 text-[#7DB00E]" />
                {config.addOnsLabel
                  ? config.addOnsLabel.replace('{location}', location ? location.toUpperCase() : 'local')
                  : 'Add extras (optional)'}
              </h4>
              <div className="space-y-2">
                {allAddOns.map((addOn) => {
                  const isSelected = selectedAddOns.includes(addOn.id);
                  return (
                    <button
                      key={addOn.id}
                      onClick={() => toggleAddOn(addOn.id)}
                      className={`w-full p-4 rounded-xl flex items-center gap-4 transition-all ${
                        isSelected
                          ? 'bg-[#7DB00E]/20 border-2 border-[#7DB00E]'
                          : isDarkTheme
                            ? 'bg-white/5 border-2 border-transparent hover:bg-white/10'
                            : 'bg-slate-50 border-2 border-transparent hover:bg-slate-100'
                      }`}
                    >
                      <div className={`p-2 rounded-lg ${isSelected ? 'bg-[#7DB00E] text-slate-900' : isDarkTheme ? 'bg-white/10 text-slate-400' : 'bg-slate-200 text-slate-500'}`}>
                        {addOn.id.includes('task') || addOn.id.includes('extra') ? <Zap className="w-5 h-5" /> :
                         addOn.id.includes('photo') ? <Camera className="w-5 h-5" /> :
                         addOn.id.includes('warranty') ? <Shield className="w-5 h-5" /> :
                         <Plus className="w-5 h-5" />}
                      </div>
                      <div className="flex-1 text-left">
                        <div className="flex items-center gap-2">
                          <span className={`font-medium ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>{addOn.name}</span>
                          {addOn.popular && (
                            <span className="text-[10px] bg-amber-500/20 text-amber-500 px-2 py-0.5 rounded-full font-medium">
                              POPULAR
                            </span>
                          )}
                        </div>
                        <div className={`text-sm ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>{addOn.description}</div>
                      </div>
                      <div className="text-right">
                        <div className={`font-bold ${addOn.price === 0 ? 'text-[#7DB00E]' : isDarkTheme ? 'text-white' : 'text-slate-900'}`}>
                          {addOn.price === 0 ? 'FREE' : `+£${addOn.price / 100}`}
                        </div>
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center ${isSelected ? 'bg-[#7DB00E]' : isDarkTheme ? 'bg-white/10' : 'bg-slate-200'}`}>
                          {isSelected ? (
                            <Check className="w-4 h-4 text-slate-900" />
                          ) : (
                            <Plus className="w-4 h-4 text-slate-500" />
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Phase 30 — the duplicate price-recap box was removed here; the total
            is reaffirmed as a slim line right above the pay CTA instead. */}

        {/* Trust strip — near payment for maximum conversion impact. Contextual
            shows the accepted-card brands (payment reassurance right above the
            commit CTA); other segments keep the trust pills. */}
        {isContextual ? (
          <CardBrandStrip className="opacity-95" />
        ) : (
          <div className="flex flex-nowrap items-center justify-center gap-1.5">
            {['DBS Checked', '£2M Insured', '4.9★ Google'].map((label) => (
              <span
                key={label}
                className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                  isDarkTheme
                    ? 'bg-[#7DB00E]/10 text-[#7DB00E] border border-[#7DB00E]/20'
                    : 'bg-[#7DB00E]/10 text-[#5a8a00] border border-[#7DB00E]/20'
                }`}
              >
                {label}
              </span>
            ))}
          </div>
        )}

        {/* Payment/Book Section */}
        {/* scroll-mt clears the sticky top header (~57px) so when the sticky
            "Book now" scrolls here with block:'start', the "Book it in" CTA lands
            fully visible below the header instead of tucked behind it. */}
        <div ref={bookSectionRef} className="scroll-mt-24">
        {showInlinePayment && stripe ? (
          !bookingStarted ? (
            /* Reveal-on-commit gate — the customer commits to their slot here.
               Address/email/payment only appear after this CTA; keeping that whole
               form on the quote up-front depressed bookings. */
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="space-y-3"
            >
              <Button
                onClick={() => {
                  const reveal = () => {
                    setBookingStarted(true);
                    setTimeout(() => {
                      // Contextual: send them up to "When suits you?" to pick a slot
                      // first. The payment form stays revealed below and self-gates
                      // ("Select date & time to book") until a date+time is chosen, so
                      // booking can't dead-end. Other variants jump to the form.
                      const target = isContextual ? dateSectionRef : bookSectionRef;
                      target.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 350);
                  };
                  if (onBeforeBooking) {
                    onBeforeBooking(reveal);
                  } else {
                    reveal();
                  }
                }}
                className="w-full h-14 rounded-2xl font-bold text-lg bg-[#7DB00E] hover:bg-[#6da000] text-slate-900 transition-all"
              >
                <span className="flex items-center gap-2">
                  {isCash ? 'Book — pay cash on the day' : isContextual ? 'Approve and pay' : 'Book my slot'}
                  <ChevronRight className="w-5 h-5" />
                </span>
              </Button>
              <p className={`text-xs text-center ${isDarkTheme ? 'text-slate-500' : 'text-slate-400'}`}>
                {isCash
                  ? `Nothing to pay now · £${Math.round(total / 100)} cash when it's done`
                  : payFull
                  ? `£${Math.round(payFullTotal / 100)} · secure payment by Stripe`
                  : `Just £${Math.round(depositAmount / 100)} to secure it · £${Math.round(balanceOnCompletion / 100)} on completion${totalMaterialsPence > 0 ? ' · covers your materials in full, plus 30% of labour' : ''}`}
              </p>
            </motion.div>
          ) : (
          /* Inline Stripe card entry — reveals once the slot is committed */
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            <h4 className={`text-sm font-bold uppercase tracking-wide flex items-center gap-2 ${isDarkTheme ? 'text-white' : 'text-slate-700'}`}>
              <CreditCard className="w-4 h-4 text-[#7DB00E]" />
              2. Complete your booking
            </h4>
            <div className={`rounded-xl p-4 ${isDarkTheme ? 'bg-white/5' : 'bg-slate-50'}`}>
              {!detailsConfirmed ? (
                <div className="space-y-3">
                  {/* Postcode — we already have it; shown locked for trust. */}
                  {postcode && (
                    <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${isDarkTheme ? 'bg-white/5 border border-white/10' : 'bg-white border border-slate-200'}`}>
                      <MapPin className="w-4 h-4 text-[#7DB00E] shrink-0" />
                      <span className={`font-semibold ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>{postcode.toUpperCase()}</span>
                      <span className={`text-[11px] whitespace-nowrap ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>— already on file</span>
                    </div>
                  )}
                  {/* Address — Google Places autocomplete (single line). */}
                  <div className="space-y-1.5">
                    <label className={`text-sm font-medium ${isDarkTheme ? 'text-slate-300' : 'text-slate-600'}`}>Property address</label>
                    <QuoteAddressInput
                      value={addressLine}
                      onChange={(val, details) => { setAddressLine(val); setAddressDetails(details ?? null); }}
                      isDarkTheme={isDarkTheme}
                      placeholder="Start typing your address…"
                    />
                    {looksLikePostcodeOnly && (
                      <p className={`text-xs ${isDarkTheme ? 'text-amber-400' : 'text-amber-600'}`}>
                        Please enter your full address (e.g. 12 High Street, Nottingham) so we know exactly where to come.
                      </p>
                    )}
                  </div>
                  {/* Email (only if we don't already have it). */}
                  {!customerEmail && (
                    <div className="space-y-1.5">
                      <label className={`text-sm font-medium ${isDarkTheme ? 'text-slate-300' : 'text-slate-600'}`}>Email for receipt</label>
                      <input
                        type="email"
                        value={inlineEmail}
                        onChange={e => { setInlineEmail(e.target.value); setEmailConfirmed(false); }}
                        placeholder="your@email.com"
                        className={`w-full border rounded-lg p-3 text-base outline-none focus:ring-2 focus:ring-[#7DB00E]/40 ${
                          isDarkTheme ? 'border-white/20 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-900'
                        }`}
                      />
                    </div>
                  )}
                  {/* Landlord liaise — the tenant contact lives under the scheduling
                      toggle above; block payment until it's filled and say why. */}
                  {isLandlord && useFlexBooking && !(tenantNameValid && tenantMobileValid) && (
                    <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-[12px] leading-snug ${isDarkTheme ? 'bg-amber-400/10 text-amber-300' : 'bg-amber-50 text-amber-700'}`}>
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>Add your tenant's name and mobile above so we can arrange access.</span>
                    </div>
                  )}
                  {/* Continue → reveals secure payment. Requires address + email
                      (+ tenant contact for landlords in liaise mode). */}
                  <button
                    type="button"
                    onClick={() => {
                      if (!addressOk || !tenantContactOk) return;
                      if (!customerEmail) {
                        if (!isValidEmail(inlineEmail)) return;
                        setEmailConfirmed(true);
                      }
                      setDetailsConfirmed(true);
                    }}
                    disabled={!addressOk || (!customerEmail && !isValidEmail(inlineEmail)) || !tenantContactOk}
                    className={`w-full px-4 py-3 rounded-lg font-bold text-sm transition-all ${
                      addressOk && (customerEmail || isValidEmail(inlineEmail)) && tenantContactOk
                        ? 'bg-[#7DB00E] text-white hover:bg-[#6a9a0c]'
                        : isDarkTheme ? 'bg-white/5 text-slate-600 cursor-not-allowed' : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    {isCash ? 'Continue' : 'Continue to payment'}
                  </button>
                </div>
              ) : isLoadingPaymentIntent ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-6 h-6 animate-spin text-[#7DB00E]" />
                  <span className={`ml-2 text-sm ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>
                    Setting up secure payment...
                  </span>
                </div>
              ) : isCash ? (
                /* Cash on the day (OAP): no card form — the address is captured
                   above, then this confirms. handleBook fires onBook with
                   paymentMode 'cash', £0 now and the full balance due in cash. */
                <div className="space-y-3">
                  <div className={`flex items-center justify-between gap-2 pt-1 ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>
                    <div>
                      <p className={`text-xs uppercase tracking-wide ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>Total</p>
                      <p className="text-lg font-bold">£{Math.round(total / 100)}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-base font-bold ${isDarkTheme ? 'text-[#7DB00E]' : 'text-[#5a8a0a]'}`}>£0 now</p>
                      <p className={`text-[11px] ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>£{Math.round(total / 100)} cash on the day</p>
                    </div>
                  </div>
                  <Button
                    onClick={handleBook}
                    disabled={isBooking}
                    className="w-full h-14 rounded-2xl font-bold text-lg bg-[#7DB00E] hover:bg-[#6da000] text-slate-900 transition-all"
                  >
                    {isBooking ? (
                      <span className="flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Booking…</span>
                    ) : (
                      <span className="flex items-center gap-2">Confirm booking <ChevronRight className="w-5 h-5" /></span>
                    )}
                  </Button>
                  <p className={`text-xs text-center ${isDarkTheme ? 'text-slate-500' : 'text-slate-400'}`}>
                    No payment now. Pay £{Math.round(total / 100)} in cash when the job's done.
                  </p>
                </div>
              ) : paymentError && !clientSecret ? (
                <Alert variant="destructive" className="bg-red-50 border-red-200">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{paymentError}</AlertDescription>
                </Alert>
              ) : (
                <>
                  {showExpressCheckout && (
                    <>
                      <ExpressCheckoutElement
                        onConfirm={handleExpressCheckoutConfirm}
                        options={{
                          paymentMethods: {
                            applePay: 'auto',
                            googlePay: 'auto',
                            link: 'never',
                            amazonPay: 'never',
                            paypal: 'never',
                            klarna: 'never',
                          },
                        }}
                      />
                      <div className={`flex items-center gap-3 my-2`}>
                        <div className={`flex-1 h-px ${isDarkTheme ? 'bg-gray-600' : 'bg-slate-200'}`} />
                        <span className={`text-xs ${isDarkTheme ? 'text-gray-400' : 'text-slate-400'}`}>Or pay by card</span>
                        <div className={`flex-1 h-px ${isDarkTheme ? 'bg-gray-600' : 'bg-slate-200'}`} />
                      </div>
                    </>
                  )}
                <form onSubmit={handlePayment}>
                  {/* Split card fields — explicit layout so CVC is always visible on mobile */}
                  <div className="space-y-2 mb-4">
                    {(() => {
                      const stripeStyle = {
                        base: {
                          fontSize: '16px',
                          fontFamily: 'system-ui, -apple-system, sans-serif',
                          color: isDarkTheme ? '#ffffff' : '#1e293b',
                          backgroundColor: 'transparent',
                          iconColor: '#7DB00E',
                          '::placeholder': { color: isDarkTheme ? '#64748b' : '#94a3b8' },
                        },
                        invalid: { color: '#ef4444', iconColor: '#ef4444' },
                        complete: { color: '#22c55e', iconColor: '#22c55e' },
                      };
                      const fieldCls = `border rounded-lg px-3 py-3 ${isDarkTheme ? 'border-white/20 bg-slate-800' : 'border-slate-200 bg-white'}`;
                      return (
                        <>
                          <div>
                            <label className={`text-[11px] font-medium uppercase tracking-wide mb-1 block ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>Card number</label>
                            <div className={fieldCls}>
                              <CardNumberElement options={{ style: stripeStyle, showIcon: true }} />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className={`text-[11px] font-medium uppercase tracking-wide mb-1 block ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>Expiry</label>
                              <div className={fieldCls}>
                                <CardExpiryElement options={{ style: stripeStyle }} />
                              </div>
                            </div>
                            <div>
                              <label className={`text-[11px] font-medium uppercase tracking-wide mb-1 block ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>CVC</label>
                              <div className={fieldCls}>
                                <CardCvcElement options={{ style: stripeStyle }} />
                              </div>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {paymentError && (
                    <Alert variant="destructive" className="mb-4 bg-red-50 border-red-200">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{paymentError}</AlertDescription>
                    </Alert>
                  )}

                  {/* Phase 30 — reaffirm the amount right before paying. */}
                  <div className={`flex items-center justify-between gap-2 mb-3 pt-3 border-t ${isDarkTheme ? 'border-white/10' : 'border-slate-200'}`}>
                    <div>
                      <p className={`text-xs uppercase tracking-wide ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>Total</p>
                      <p className={`text-lg font-bold ${isDarkTheme ? 'text-white' : 'text-slate-900'}`}>£{Math.round(total / 100)}</p>
                    </div>
                    {payFull ? (
                      <div className="text-right">
                        <p className={`text-base font-bold ${isDarkTheme ? 'text-[#7DB00E]' : 'text-[#5a8a0a]'}`}>£{Math.round(payFullTotal / 100)} now</p>
                        <p className={`text-[11px] ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>full payment · save 3%</p>
                      </div>
                    ) : (
                      <div className="text-right">
                        <p className={`text-base font-bold ${isDarkTheme ? 'text-[#7DB00E]' : 'text-[#5a8a0a]'}`}>£{Math.round(depositAmount / 100)} today</p>
                        <p className={`text-[11px] ${isDarkTheme ? 'text-slate-400' : 'text-slate-500'}`}>£{Math.round(balanceOnCompletion / 100)} on completion</p>
                        {totalMaterialsPence > 0 && (
                          <p className={`text-[10px] ${isDarkTheme ? 'text-slate-500' : 'text-slate-400'}`}>covers materials in full + 30% labour</p>
                        )}
                      </div>
                    )}
                  </div>

                  <Button
                    type="submit"
                    disabled={!clientSecret || isProcessingPayment || !isStripeConfigured}
                    className="w-full h-14 rounded-2xl font-bold text-lg bg-[#7DB00E] hover:bg-[#6da000] text-slate-900 transition-all"
                  >
                    {isProcessingPayment ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Processing...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        {payFull
                          ? `Pay £${Math.round(payFullTotal / 100)} now`
                          : `Pay £${Math.round(depositAmount / 100)} deposit`
                        }
                        <ChevronRight className="w-5 h-5" />
                      </span>
                    )}
                  </Button>
                </form>
                </>
              )}

              <p className={`text-xs text-center mt-3 ${isDarkTheme ? 'text-slate-500' : 'text-slate-400'}`}>
                {isCash
                  ? null
                  : payFull
                  ? 'Secure payment powered by Stripe'
                  : `£${Math.round(balanceOnCompletion / 100)} remaining on completion · Secure payment by Stripe`
                }
              </p>
            </div>
          </motion.div>
          )
        ) : (
          /* Regular Book Button - only show when canBook (date+time selected) */
          canBook && (
            <Button
              onClick={handleBook}
              disabled={!canBook || isBooking}
              className={`w-full h-14 rounded-2xl font-bold text-lg transition-all ${
                canBook
                  ? 'bg-[#7DB00E] hover:bg-[#6da000] text-slate-900'
                  : isDarkTheme
                    ? 'bg-white/10 text-slate-500 cursor-not-allowed'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
            >
              {isBooking ? (
                <span className="flex items-center gap-2">
                  <Timer className="w-5 h-5 animate-spin" />
                  Booking...
                </span>
              ) : canBook ? (
                <span className="flex items-center gap-2">
                  {payFull
                    ? `Pay £${Math.round(payFullTotal / 100)} now`
                    : `Reserve — pay £${Math.round(depositAmount / 100)} deposit`
                  }
                  <ChevronRight className="w-5 h-5" />
                </span>
              ) : (
                'Select date & time to book'
              )}
            </Button>
          )
        )}
        </div>

        </div>

      </div>

      {/* Sticky bottom CTA — portaled to body to avoid transform containment breaking fixed positioning */}
      {createPortal(
        <AnimatePresence>
          {showStickyCTA && (
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed bottom-0 left-0 right-0 z-50 safe-area-bottom"
            >
              {/* Timer progress bar on top edge */}
              <StickyTimerProgress />
              <div className="bg-white border-t border-slate-200 shadow-[0_-4px_20px_rgba(0,0,0,0.12)] px-4 py-3">
                <div className="max-w-lg mx-auto flex items-center justify-between gap-3">
                  <div className="flex-shrink-0">
                    <p className="text-xs text-slate-500">{payFull ? 'Pay today' : 'Reserve from'}</p>
                    <p className="text-2xl font-black text-[#7DB00E] leading-tight">
                      £{payFull ? Math.round(payFullTotal / 100) : Math.round(depositAmount / 100)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      // Flexible is the default: the customer doesn't pick a date,
                      // so drive them to the booking/payment step. Only the
                      // "Pick exact date" path needs the date grid.
                      const target = useFlexBooking ? bookSectionRef : dateSectionRef;
                      target.current?.scrollIntoView({
                        behavior: 'smooth',
                        block: useFlexBooking ? 'start' : 'center',
                      });
                    }}
                    className="flex-1 max-w-[220px] bg-[#7DB00E] hover:bg-[#6a9a0c] active:scale-[0.98] text-white font-bold py-3 px-5 rounded-xl text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#7DB00E]/25"
                  >
                    {isContextual ? (
                      <>
                        <CreditCard className="w-4 h-4" />
                        Approve and pay
                      </>
                    ) : useFlexBooking ? (
                      <>
                        <CreditCard className="w-4 h-4" />
                        Book now
                      </>
                    ) : (
                      <>
                        <Calendar className="w-4 h-4" />
                        Choose your date
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
