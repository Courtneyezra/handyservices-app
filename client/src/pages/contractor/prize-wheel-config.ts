/**
 * Prize-wheel slices, per customer segment.
 *
 * Compliance note: every customer WINS a slice — the wheel rewards *completing
 * the job*, never leaving a review. The review ask is a separate, unconditional
 * step afterwards. So all slices must be margin-safe (we give one away every
 * time) and none is contingent on a review.
 *
 * Wedges render equal-sized for looks; the winner is chosen by `weight` (a
 * one-time spin, so weighting selection independently is the standard trick).
 */

export interface PrizeSlice {
  id: string;
  label: string;      // short, fits on the wedge
  color: string;      // wedge fill
  weight: number;     // relative odds of landing here
  golden?: boolean;   // the rare "big win" slice
  reveal: { title: string; message: string };
  terms?: string;     // the specific cap/condition for THIS prize (shown on reveal + email)
}

// Standard terms on every reward (shown on the /rewards-terms page + prize email).
// UK ASA/CAP compliance: "free"/promo claims must be clear and bounded.
export const STANDARD_TERMS: string[] = [
  'One reward per customer.',
  'Valid for 60 days from the date won — the code shows your expiry.',
  'Applies to labour only unless stated; materials are charged separately.',
  "Can't be combined with any other offer, reward or discount.",
  'Subject to availability and our normal booking terms.',
  'Handy Services may withdraw or void a reward in the event of misuse.',
];

// Homeowner (owner-occupier) — rebooking + genuine value; every offer is capped.
const HOMEOWNER: PrizeSlice[] = [
  // UK homeowner, retention-focused: unlock "the list" + genuine returns.
  // Acquisition is handled by the review ask + SEO; referral lives in a separate
  // shareable link, not the wheel. Every slice is simple to honour.
  { id: 'bundle', label: 'CLEAR YOUR\nLIST', color: '#f59e0b', weight: 30,
    reveal: { title: 'Book 3+ jobs — smallest one free', message: 'Got a list? Book three or more jobs in one visit and the smallest is on us — labour up to £75.' },
    terms: 'On 3 or more jobs booked in one visit. Free job = labour only, up to £75; materials extra.' },
  { id: 'minijob', label: 'FREE\nMINI JOB', color: '#10b981', weight: 24,
    reveal: { title: 'A free 15-min job next visit', message: "Next time we're round, one quick job's on us — a shelf, a handle, a hook." },
    terms: 'One task up to 15 minutes, labour only, on your next booked visit.' },
  { id: 'seasonal', label: 'FREE\nCHECK', color: '#14b8a6', weight: 18,
    reveal: { title: 'A free home check next visit', message: "Gutters, smoke alarms or draughts — whatever the season needs, we'll check it free." },
    terms: 'One visual home check on your next booked visit. Any repairs are quoted separately.' },
  { id: 'off15', label: '£15 OFF', color: '#f43f5e', weight: 15,
    reveal: { title: '£15 off your next job', message: "We'll take £15 off your next booking." },
    terms: '£15 off labour on your next booked job (minimum job value £50).' },
  { id: 'priority', label: 'SKIP THE\nQUEUE', color: '#8b5cf6', weight: 10,
    reveal: { title: 'Front of the queue', message: 'Your next booking jumps the line — first available slot, held for you.' },
    terms: 'Priority scheduling on your next booking, subject to availability.' },
  { id: 'golden', label: 'GOLDEN\n25% OFF', color: '#fbbf24', weight: 3, golden: true,
    reveal: { title: '🌟 Golden — 25% off your next job', message: 'The rare one. 25% off your next job, up to £50.' },
    terms: '25% off labour on your next booked job, up to £50.' },
];

// Landlord / property manager — key handling + portfolio referral.
const LANDLORD: PrizeSlice[] = [
  { id: 'off15', label: '£15 OFF', color: '#f59e0b', weight: 28,
    reveal: { title: '£15 off your next job', message: "We'll take £15 off your next booking." } },
  { id: 'keys', label: 'FREE KEY\nPICKUP', color: '#10b981', weight: 24,
    reveal: { title: 'Free key collection next visit', message: "We'll collect keys for your next job — normally £30, on us." } },
  { id: 'priority', label: 'SKIP THE\nQUEUE', color: '#0ea5e9', weight: 18,
    reveal: { title: 'Priority booking', message: 'Your next job jumps the queue — first available slot.' } },
  { id: 'refer', label: 'REFER\n& EARN', color: '#8b5cf6', weight: 14,
    reveal: { title: '£30 for you, £30 for a landlord you refer', message: 'Know another landlord? You both get £30 off.' } },
  { id: 'photos', label: 'PHOTO\nREPORT', color: '#14b8a6', weight: 10,
    reveal: { title: 'Free property photo report', message: "Next visit we'll send a full photo condition report — free." } },
  { id: 'off40', label: '£40 OFF', color: '#f43f5e', weight: 4,
    reveal: { title: '£40 off your next job', message: 'A bigger one — £40 off your next booking.' } },
  { id: 'golden15', label: '15% OFF', color: '#fbbf24', weight: 2, golden: true,
    reveal: { title: '🌟 The golden slice — 15% off!', message: 'The rare one. 15% off your next job.' } },
];

// Small business — minimal downtime + business referral.
const BUSINESS: PrizeSlice[] = [
  { id: 'off15', label: '£15 OFF', color: '#f59e0b', weight: 28,
    reveal: { title: '£15 off your next job', message: "We'll take £15 off your next booking." } },
  { id: 'task30', label: 'FREE\n30-MIN', color: '#10b981', weight: 24,
    reveal: { title: 'A free 30-min task next visit', message: "Next time we're in, half an hour of work is on us." } },
  { id: 'nextday', label: 'NEXT-DAY\nSLOT', color: '#0ea5e9', weight: 18,
    reveal: { title: 'Priority next-day slot', message: 'Your next job gets a priority next-day slot — minimal downtime.' } },
  { id: 'refer', label: 'REFER\n& EARN', color: '#8b5cf6', weight: 14,
    reveal: { title: '£25 for you, £25 for a business you refer', message: 'Refer another business — you both get £25 off.' } },
  { id: 'safety', label: 'SAFETY\nCHECK', color: '#14b8a6', weight: 10,
    reveal: { title: 'A free premises safety check', message: "Next visit we'll run a quick premises safety check — free." } },
  { id: 'off50', label: '£50 OFF', color: '#f43f5e', weight: 4,
    reveal: { title: '£50 off your next job', message: 'A bigger one — £50 off your next booking.' } },
  { id: 'golden15', label: '15% OFF', color: '#fbbf24', weight: 2, golden: true,
    reveal: { title: '🌟 The golden slice — 15% off!', message: 'The rare one. 15% off your next job.' } },
];

/** The three editable slice groups, keyed for admin config + weight overrides. */
export type WheelGroup = 'homeowner' | 'landlord' | 'business';
export const WHEEL_GROUPS: Record<WheelGroup, PrizeSlice[]> = {
  homeowner: HOMEOWNER,
  landlord: LANDLORD,
  business: BUSINESS,
};
export const WHEEL_GROUP_LABELS: Record<WheelGroup, string> = {
  homeowner: 'Homeowner',
  landlord: 'Landlord / Property manager',
  business: 'Business',
};

/** Admin-editable odds overrides: { group: { sliceId: weight } }. */
export type WheelWeightOverrides = Partial<Record<WheelGroup, Record<string, number>>>;

export function groupForCustomerType(customerType?: string | null): WheelGroup {
  switch ((customerType || '').toLowerCase()) {
    case 'landlord':
    case 'property_manager':
    case 'letting_agent':
      return 'landlord';
    case 'business':
      return 'business';
    default:
      return 'homeowner';
  }
}

export function groupForSegment(segment?: string | null): WheelGroup {
  switch ((segment || '').toUpperCase()) {
    case 'LANDLORD':
    case 'PROP_MGR':
      return 'landlord';
    case 'SMALL_BIZ':
      return 'business';
    default:
      return 'homeowner';
  }
}

/** Apply admin weight overrides to a group's slices (missing ids keep their default weight). */
export function applyWeightOverrides(group: WheelGroup, overrides?: WheelWeightOverrides): PrizeSlice[] {
  const forGroup = overrides?.[group];
  const slices = WHEEL_GROUPS[group];
  if (!forGroup) return slices;
  return slices.map((s) => {
    const w = forGroup[s.id];
    return typeof w === 'number' && w >= 0 ? { ...s, weight: w } : s;
  });
}

/** Customer types that should NOT get the wheel by default (B2B / portfolio). */
export const NON_WHEEL_CUSTOMER_TYPES = ['landlord', 'property_manager', 'letting_agent', 'business'];

/** Whether the wheel shows by default for a customer_type (homeowner-family = yes). */
export function wheelDefaultForCustomerType(customerType?: string | null): boolean {
  return !NON_WHEEL_CUSTOMER_TYPES.includes((customerType || '').toLowerCase());
}

/** Pick the slice set for a quote's customer_type. Defaults to the homeowner set. */
export function slicesForCustomerType(customerType?: string | null): PrizeSlice[] {
  switch ((customerType || '').toLowerCase()) {
    case 'landlord':
    case 'property_manager':
    case 'letting_agent':
      return LANDLORD;
    case 'business':
      return BUSINESS;
    default:
      return HOMEOWNER; // homeowner, oap_homeowner, tenant, null
  }
}

/** Pick the slice set for a quote segment. Defaults to the homeowner set. */
export function slicesForSegment(segment?: string | null): PrizeSlice[] {
  switch ((segment || '').toUpperCase()) {
    case 'LANDLORD':
    case 'PROP_MGR':
      return LANDLORD;
    case 'SMALL_BIZ':
      return BUSINESS;
    default:
      return HOMEOWNER; // BUSY_PRO, TRUST_SEEKER, DIY_DEFERRER, RENTER, BUDGET, DEFAULT, …
  }
}

/** Weighted-random winning slice. */
export function pickWinner(slices: PrizeSlice[]): number {
  const total = slices.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (let i = 0; i < slices.length; i++) {
    r -= slices[i].weight;
    if (r <= 0) return i;
  }
  return slices.length - 1;
}
