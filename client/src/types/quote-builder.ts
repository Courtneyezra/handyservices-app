// Types for the QuoteBuilder component used in both create and edit modes

export type Segment = 'BUSY_PRO' | 'PROP_MGR' | 'LANDLORD' | 'SMALL_BIZ' | 'DIY_DEFERRER' | 'BUDGET' | 'OLDER_WOMAN' | 'UNKNOWN';

export interface TaskItem {
  id: string;
  description: string;
  quantity: number;
  hours: number;
  materialCost: number;
  complexity: 'low' | 'medium' | 'high';
}

export interface AnalyzedJobData {
  tasks: TaskItem[];
  summary: string;
  totalEstimatedHours: number;
  basePricePounds: number;
}

export interface QuoteBuilderData {
  // Customer details
  customerName: string;
  phone: string;
  email?: string;
  address: string;
  postcode: string;

  // Job details
  jobDescription: string;
  segment: Segment;

  // Tasks and analysis
  tasks: TaskItem[];
  analyzedJob: {
    summary: string;
    tasks: TaskItem[];
    totalHours: number;
    basePricePounds: number;
  } | null;

  // Pricing
  priceOverride: string;
  effectivePrice: number;

  // WhatsApp context (optional - for create mode)
  conversationContext?: string;
}

export type QuoteBuilderMode = 'create' | 'edit';

// Segment descriptions for selection dropdown
export const SEGMENT_OPTIONS: { value: Segment; label: string; description: string }[] = [
  { value: 'BUSY_PRO', label: 'Busy Professional', description: 'Time-poor, values speed & convenience' },
  { value: 'OLDER_WOMAN', label: 'Older Customer', description: 'Values trust, safety & reliability' },
  { value: 'PROP_MGR', label: 'Property Manager', description: 'Manages multiple properties, needs fast response' },
  { value: 'LANDLORD', label: 'Landlord', description: '1-3 properties, needs photo proof & hassle-free service' },
  { value: 'SMALL_BIZ', label: 'Small Business', description: 'Needs after-hours, minimal disruption' },
  { value: 'DIY_DEFERRER', label: 'DIY Deferrer', description: 'Has a list of jobs, price-conscious' },
  { value: 'BUDGET', label: 'Budget Customer', description: 'Most price-sensitive, single tier only' },
];

// Quote mode types
export type QuoteMode = 'simple' | 'hhh' | 'pick_and_mix' | 'consultation';

// Existing quote data structure (for edit mode)
export interface ExistingQuoteData {
  id: string;
  shortSlug: string;
  customerName: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  postcode?: string | null;
  jobDescription: string;
  segment?: Segment | null;
  quoteMode: QuoteMode;

  // Pricing
  essentialPrice?: number | null;
  enhancedPrice?: number | null;
  elitePrice?: number | null;
  basePrice?: number | null;
  baseJobPricePence?: number | null;

  // Jobs/tasks data
  jobs?: AnalyzedJobData[] | null;

  // Status
  depositPaidAt?: string | null;
  bookedAt?: string | null;
  installmentStatus?: string | null;

  // Materials
  materialsCostWithMarkupPence?: number | null;
}
