/**
 * Invoice Upsells — Contextual post-job recommendations
 *
 * Derives upsell suggestions from the quote/invoice context (job description,
 * customer info, notes) rather than segments. The invoice page is the highest-
 * intent touchpoint for recurring revenue conversion.
 */

export interface InvoiceUpsell {
  id: string;
  title: string;
  description: string;
  ctaLabel: string;
  ctaAction: 'whatsapp' | 'quote_link' | 'external_link';
  ctaValue: string; // phone number, URL, or quote link path
  icon: 'repeat' | 'sparkles' | 'message' | 'calendar' | 'users' | 'home';
  priority: number; // lower = higher priority
}

// Property manager signals in job description or customer name
const PROPERTY_MANAGER_SIGNALS = [
  /panda/i,
  /property\s*manag/i,
  /letting\s*agent/i,
  /portfolio/i,
  /landlord/i,
  /tenant/i,
  /rental\s*property/i,
  /buy\s*to\s*let/i,
  /btl/i,
  /hmo/i,
  /multiple\s*propert/i,
];

// Job category detection (reuses logic from cross-sell-recommendations.ts)
function detectJobCategory(text: string): string {
  const lower = text.toLowerCase();
  if (/plumb|tap|toilet|sink|leak|drain|pipe|boiler|shower|bath/i.test(lower)) return 'plumbing';
  if (/electr|socket|switch|light|wire|fuse|outlet/i.test(lower)) return 'electrical';
  if (/paint|decorat|wall|ceiling|emulsion/i.test(lower)) return 'painting';
  if (/mount|tv|screen|bracket|hang/i.test(lower)) return 'mounting';
  if (/shelf|door|hinge|lock|curtain|blind|assemble|flat.?pack/i.test(lower)) return 'carpentry';
  if (/clean|cleaning|end.?of.?tenan|deep\s*clean/i.test(lower)) return 'cleaning';
  return 'general';
}

function isPropertyManager(context: { customerName: string; jobDescription: string; notes?: string }): boolean {
  const searchText = `${context.customerName} ${context.jobDescription} ${context.notes || ''}`;
  return PROPERTY_MANAGER_SIGNALS.some(pattern => pattern.test(searchText));
}

// Job-category cross-sells (complementary services)
const CATEGORY_UPSELLS: Record<string, InvoiceUpsell[]> = {
  plumbing: [
    {
      id: 'boiler-service',
      title: 'Annual Boiler Service',
      description: 'Keep your boiler running efficiently — avoid costly breakdowns',
      ctaLabel: 'Get a Quote',
      ctaAction: 'whatsapp',
      ctaValue: 'Hi, I\'d like to book an annual boiler service please',
      icon: 'calendar',
      priority: 2,
    },
  ],
  electrical: [
    {
      id: 'smart-switches',
      title: 'Smart Home Upgrade',
      description: 'Add smart switches and USB sockets while we know your wiring',
      ctaLabel: 'Get a Quote',
      ctaAction: 'whatsapp',
      ctaValue: 'Hi, I\'m interested in smart switch/USB socket installation',
      icon: 'sparkles',
      priority: 2,
    },
  ],
  painting: [
    {
      id: 'full-room-refresh',
      title: 'Full Room Refresh',
      description: 'Love the results? Let us do the whole room — skirting, ceiling, the lot',
      ctaLabel: 'Get a Quote',
      ctaAction: 'whatsapp',
      ctaValue: 'Hi, I\'d like a quote for a full room painting refresh',
      icon: 'sparkles',
      priority: 2,
    },
  ],
  general: [],
};

// Property manager upsells (Panda and similar)
const PROPERTY_MANAGER_UPSELLS: InvoiceUpsell[] = [
  {
    id: 'recurring-maintenance',
    title: 'Monthly Property Checks',
    description: 'Set up regular maintenance visits — catch issues before they become expensive. Photo reports included.',
    ctaLabel: 'Set Up Monthly Visits',
    ctaAction: 'whatsapp',
    ctaValue: 'Hi, I\'d like to discuss setting up regular monthly property maintenance checks',
    icon: 'repeat',
    priority: 1,
  },
  {
    id: 'cleaning-service',
    title: 'End-of-Repair Cleaning',
    description: 'Add a professional clean after repair work — tenant-ready, every time',
    ctaLabel: 'Add Cleaning',
    ctaAction: 'whatsapp',
    ctaValue: 'Hi, I\'d like to add cleaning services after repair work',
    icon: 'sparkles',
    priority: 2,
  },
  {
    id: 'whatsapp-updates',
    title: 'WhatsApp Job Updates',
    description: 'Get real-time photos and updates for every property job — no need to be on-site',
    ctaLabel: 'Enable Updates',
    ctaAction: 'whatsapp',
    ctaValue: 'Hi, I\'d like to set up WhatsApp updates for my property jobs',
    icon: 'message',
    priority: 3,
  },
];

// Universal upsells (shown to everyone)
const UNIVERSAL_UPSELLS: InvoiceUpsell[] = [
  {
    id: 'book-next-job',
    title: 'Book Your Next Job',
    description: 'Got more jobs on the list? Book now and skip the queue',
    ctaLabel: 'Book Now',
    ctaAction: 'whatsapp',
    ctaValue: 'Hi, I\'d like to book another job please',
    icon: 'calendar',
    priority: 5,
  },
  {
    id: 'refer-friend',
    title: 'Refer a Friend',
    description: 'Know someone who needs a handyman? Share our number — they\'ll thank you',
    ctaLabel: 'Share Our Number',
    ctaAction: 'whatsapp',
    ctaValue: 'Hi, a friend recommended you — I need some work done',
    icon: 'users',
    priority: 6,
  },
];

export interface InvoiceContext {
  customerName: string;
  jobDescription: string;
  notes?: string;
  lineItems?: Array<{ description: string }>;
}

/**
 * Get contextual upsells for an invoice based on job context.
 * Returns 2-3 most relevant upsells.
 */
export function getInvoiceUpsells(context: InvoiceContext, limit: number = 3): InvoiceUpsell[] {
  const allUpsells: InvoiceUpsell[] = [];

  // 1. Property manager upsells (highest priority if detected)
  if (isPropertyManager(context)) {
    allUpsells.push(...PROPERTY_MANAGER_UPSELLS);
  }

  // 2. Job-category cross-sells
  const searchText = [
    context.jobDescription,
    ...(context.lineItems?.map(li => li.description) || []),
  ].join(' ');

  const category = detectJobCategory(searchText);
  const categoryUpsells = CATEGORY_UPSELLS[category] || [];
  allUpsells.push(...categoryUpsells);

  // 3. Universal upsells (always available as backfill)
  allUpsells.push(...UNIVERSAL_UPSELLS);

  // Deduplicate by id, sort by priority, take limit
  const seen = new Set<string>();
  const unique = allUpsells.filter(u => {
    if (seen.has(u.id)) return false;
    seen.add(u.id);
    return true;
  });

  unique.sort((a, b) => a.priority - b.priority);
  return unique.slice(0, limit);
}

/**
 * Get the WhatsApp number for CTAs
 */
export function getWhatsAppNumber(): string {
  return process.env.WHATSAPP_BUSINESS_NUMBER || '447123456789';
}
