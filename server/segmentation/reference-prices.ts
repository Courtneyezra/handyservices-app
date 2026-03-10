/**
 * EVE (Economic Value Estimation) Reference Prices
 *
 * Step 1 of the EVE framework: "What would the customer pay elsewhere?"
 *
 * These are Nottingham market benchmarks — the price a customer expects
 * to pay for a generic handyman. Our price = reference + differentiator value.
 *
 * Sources: TaskRabbit, Checkatrade, Handyman Headquarters, Lady Bay Handyman, Airtasker
 * Data collected: March 2026
 */

// ============================================================================
// HOURLY REFERENCE RATES (Nottingham market)
// ============================================================================

export interface ReferenceRate {
  /** Low end of market (budget operators, Airtasker) */
  lowPence: number;
  /** Market average (Checkatrade, established operators) */
  midPence: number;
  /** High end of market (TaskRabbit, premium operators) */
  highPence: number;
  /** Our chosen reference anchor — typically the mid-market rate */
  referencePence: number;
  source: string;
}

/**
 * Hourly reference rates for Nottingham handyman market.
 *
 * Market range: £24-£50/hr
 * - TaskRabbit: £47+/hr
 * - Handyman HQ: £48/hr (£24/30min)
 * - Checkatrade avg: £30/hr
 * - Lady Bay Handyman: £30/hr
 * - Specialist (electrics/plumbing): £57/hr (£456/8hr day)
 */
export const HOURLY_REFERENCE: ReferenceRate = {
  lowPence: 3000,       // £30/hr — Checkatrade / Lady Bay
  midPence: 4000,       // £40/hr — mid-market
  highPence: 4800,      // £48/hr — Handyman HQ / TaskRabbit
  referencePence: 3500, // £35/hr — our reference anchor (slightly above low)
  source: 'Nottingham market March 2026: Checkatrade, TaskRabbit, Handyman HQ, Lady Bay',
};

/**
 * Daily rate references (8-hour day).
 */
export const DAILY_REFERENCE: ReferenceRate = {
  lowPence: 24000,      // £240/day (£30/hr × 8)
  midPence: 36000,      // £360/day — Handyman HQ general rate
  highPence: 45600,     // £456/day — Handyman HQ specialist rate
  referencePence: 36000, // £360/day
  source: 'Handyman Headquarters Nottingham daily rates',
};

// ============================================================================
// NOTE: Job-specific reference prices were removed.
// EVE pricing now uses hourly reference × time estimate per SKU.
// See server/eve-pricing-engine.ts for the active pricing engine.
// ============================================================================

// ============================================================================
// EVE STEP 2-3: DIFFERENTIATOR VALUES
// ============================================================================

/**
 * What our differentiators are WORTH to the customer (in pence).
 * This is the "value gap" between us and a generic handyman.
 *
 * EVE formula: Our Price = Reference Price + Sum(Differentiator Values)
 *
 * These values vary by SEGMENT because different customers value
 * different things. A BUSY_PRO values speed; a LANDLORD values photo proof.
 */

export interface DifferentiatorValue {
  id: string;
  name: string;
  description: string;
  /** Value in pence — what this is worth to the customer */
  valuePence: number;
}

export type SegmentDifferentiators = Record<string, DifferentiatorValue[]>;

/**
 * Differentiator values by segment.
 *
 * These answer: "How much MORE would this customer pay for this feature
 * vs. going with a generic handyman who doesn't offer it?"
 */
export const SEGMENT_DIFFERENTIATOR_VALUES: Record<string, DifferentiatorValue[]> = {
  BUSY_PRO: [
    { id: 'same-week', name: 'Same-week scheduling', description: 'Don\'t wait 2-3 weeks', valuePence: 2000 },
    { id: 'photo-updates', name: 'Photo updates during job', description: 'Stay informed remotely', valuePence: 1000 },
    { id: 'cleanup', name: 'Professional cleanup', description: 'Leave it spotless', valuePence: 500 },
    { id: 'guarantee-90', name: '90-day guarantee', description: 'vs. typical 0-14 days', valuePence: 1000 },
    { id: 'direct-line', name: 'Direct contact line', description: 'Skip the queue', valuePence: 500 },
    // Total differentiator value: £50 on top of reference
  ],
  PROP_MGR: [
    { id: 'fast-turnaround', name: '48-72hr scheduling', description: 'SLA commitment', valuePence: 1500 },
    { id: 'photo-report', name: 'Photo report on completion', description: 'Evidence for records', valuePence: 1000 },
    { id: 'tenant-coord', name: 'Tenant coordination', description: 'We arrange access', valuePence: 1500 },
    { id: 'same-day-invoice', name: 'Same-day invoice', description: 'No chasing', valuePence: 500 },
    // Total differentiator value: £45 on top of reference
  ],
  LANDLORD: [
    { id: 'fast-turnaround', name: '48-72hr scheduling', description: 'Quick response', valuePence: 1500 },
    { id: 'photo-report', name: 'Photo proof of work', description: 'See it without being there', valuePence: 1500 },
    { id: 'tenant-coord', name: 'Tenant coordination', description: 'Don\'t need to arrange access', valuePence: 1000 },
    { id: 'tax-invoice', name: 'Tax-ready invoice', description: 'Proper docs for HMRC', valuePence: 500 },
    // Total differentiator value: £45 on top of reference
  ],
  SMALL_BIZ: [
    { id: 'after-hours', name: 'After-hours availability', description: 'Zero business disruption', valuePence: 3000 },
    { id: 'same-day', name: 'Same-day emergency', description: 'Urgent commercial fix', valuePence: 4000 },
    { id: 'invoicing', name: 'Proper business invoicing', description: 'VAT receipt, accounts-ready', valuePence: 500 },
    { id: 'cleanup', name: 'Customer-ready cleanup', description: 'No trace we were there', valuePence: 1000 },
    // Total differentiator value: £85 for after-hours, £50 for standard
  ],
  DIY_DEFERRER: [
    { id: 'batch-efficiency', name: 'Single-visit batch', description: 'One trip for everything', valuePence: 1000 },
    { id: 'cleanup', name: 'Full cleanup', description: 'No DIY mess', valuePence: 500 },
    { id: 'guarantee', name: '30-day guarantee', description: 'Done right first time', valuePence: 500 },
    // Total differentiator value: £20 on top of reference
    // Low total because this segment is price-sensitive — value is in batching
  ],
  BUDGET: [
    // Minimal differentiators — compete near reference price
    { id: 'reliability', name: 'Vetted professional', description: 'vs. random Gumtree ad', valuePence: 500 },
    { id: 'cleanup', name: 'Cleanup included', description: 'Left tidy', valuePence: 0 },
    // Total: £5 above reference — compete on trust, not features
  ],
  UNKNOWN: [
    { id: 'quality', name: 'Professional workmanship', description: 'Vetted and reliable', valuePence: 500 },
    { id: 'cleanup', name: 'Cleanup included', description: 'Left tidy', valuePence: 500 },
    { id: 'guarantee', name: '30-day guarantee', description: 'Peace of mind', valuePence: 500 },
    // Total: £15 above reference
  ],
};

// ============================================================================
// NOTE: calculateEconomicValue(), getReferencePriceForJob(), and getMarketRange()
// were removed. EVE pricing is now handled by server/eve-pricing-engine.ts.
// ============================================================================
