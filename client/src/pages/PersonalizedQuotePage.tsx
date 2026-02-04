import { useState, useEffect, useRef, useCallback } from 'react';
import { useRoute, useLocation } from 'wouter';
import { useScroll, motion, AnimatePresence, useInView, useSpring, useTransform } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ChevronLeft, ChevronRight, Clock, Check, Loader2, Star, Shield, Crown, Camera, PhoneCall, UserCheck, X, Zap, Lock, ShieldCheck, Wrench, User, Phone, Mail, MapPin, ChevronDown, Calendar, Sun, Clipboard, Calculator, CreditCard, Gift, Play, Truck, Award, Sparkles, Package, Download } from 'lucide-react';
import { SiGoogle, SiVisa, SiMastercard, SiAmericanexpress, SiApplepay, SiStripe, SiKlarna } from 'react-icons/si';
import { FaWhatsapp, FaPaypal } from 'react-icons/fa';
import { useToast } from '@/hooks/use-toast';
import { PaymentForm } from '@/components/PaymentForm';
import { DateSelectionForm } from '@/components/DateSelectionForm';
import { QuoteSkeleton } from '@/components/QuoteSkeleton';
import { Elements } from '@stripe/react-stripe-js';
import { stripePromise } from '@/lib/stripe';
// import handymanPhoto from '@assets/Untitled design (27)_1762913661129.png';
import handyServicesLogo from '../assets/handy-logo.png';
import payIn3PromoImage from '../assets/pay-in-3-banner-original.jpg';
import mikeProfilePhoto from '../assets/mike-profile-photo.png';
import { NeonBadge } from '@/components/ui/neon-badge';
import { format } from 'date-fns';
import { CountdownTimer } from '@/components/CountdownTimer';
import { ExpertStickyNote } from '@/components/ExpertStickyNote';
import { ExpertSpecSheet } from '@/components/ExpertSpecSheet';
import { PaymentToggle } from '@/components/quote/PaymentToggle';
import { MobilePricingCard, KeyFeature } from '@/components/quote/MobilePricingCard';
import { getExpertNoteText } from "@/lib/quote-helpers";
import { generateQuotePDF } from "@/lib/quote-pdf-generator";
import { InstantActionQuote } from '@/components/InstantActionQuote';
import { ExpertAssessmentQuote } from '@/components/ExpertAssessmentQuote';
import { DatePricingCalendar, SchedulingTier } from '@/components/DatePricingCalendar';
import { TimeSlotSelector, TimeSlotType } from '@/components/TimeSlotSelector';

import { SectionWrapper } from '@/components/SectionWrapper';
import { StickyCTA } from '@/components/StickyCTA';
import { SingleProductQuote } from '@/components/quote/SingleProductQuote';
import { BudgetQuoteInline } from '@/components/quote/BudgetQuoteInline';
import { UnifiedQuoteCard } from '@/components/quote/UnifiedQuoteCard';

export type EEEPackageTier = 'essential' | 'enhanced' | 'elite';

export interface EEEPackage {
  tier: EEEPackageTier;
  name: string;
  price: number;
  warrantyMonths: number;
  description: string;
  isPopular?: boolean;
}

// Fixed value bullets per tier (hardcoded, not from database)
const HHH_FIXED_VALUE_BULLETS = {
  handyFix: [
    'Standard-quality materials',
    'Standard finish',
    'Basic communication updates',
    'Before/after photos (if needed)',
    'Standard job documentation',
    'Pay on completion (Deposit required)',
    '30-day workmanship guarantee',
  ],
  hassleFree: [
    'Any Time Arrival',
    'Photo updates on arrival + completion',
    'Better-quality materials where needed',
    'Cleaner, neater finish',
    // "15-Min Odd Job Time" is now a Neon Badge
    'Optional add-ons included',
    'Job documentation sent to client',
    'Pay on completion (optional deposit)',
    '6-Month workmanship guarantee',
  ],
  highStandard: [
    // "Guaranteed 8am" is now a Neon Badge
    // "Sparkle Clean" is now a Neon Badge
    "15-Min 'While I'm There' Task Buffer", // Keeping this as secondary list item? No, let's badge it or standardise.
    // Actually, Elite gets the 15m buffer in text? Or should I badge it too? 
    // Let's keep "Material Sourcing" as the top text item.
    'Material Sourcing & Concierge',
    'Detailed before/after photo report',
    'Assigned Senior Technician',
    'Priority aftercare support',
    'Split payment: Pay in 3 Interest-Free',
    '1-Year Ironclad Warranty',
  ],

} as const;

// Segment-specific overrides for tier bullets
// Based on Madhavan Ramanujam's Leaders/Killers/Fillers framework
const SEGMENT_TIER_CONFIG: Record<string, { handyFix: string[]; hassleFree: string[]; highStandard: string[] }> = {
  BUSY_PRO: {
    // STANDARD = Killers only (table stakes)
    handyFix: [
      'Quality workmanship',
      'Full cleanup included',
      'Scheduled within 2 weeks',
      '30-day guarantee',
    ],
    // PRIORITY = Killers + Leaders + Fillers (the draw)
    hassleFree: [
      '⚡ Same-week scheduling',
      '📸 Photo updates during job',
      '🛡️ 90-day guarantee',
      '📞 Direct contact line',
      '🔧 Free small fix while there',
    ],
    // ELITE = Premium extras for those who want the best
    highStandard: [
      '🚀 48-hour scheduling',
      '📞 Direct WhatsApp to your pro',
      '🛡️ 12-month guarantee',
      '📸 Video walkthrough on completion',
      '🔧 Unlimited small fixes while there',
    ]
  },
  PROP_MGR: {
    // Single product - job-focused features for PMs
    handyFix: [
      'Quality workmanship',
      'Scheduled within 5 working days',
      'Invoice on completion',
      'Full cleanup included',
    ],
    // This is the tier shown (enhanced = "Property Service")
    hassleFree: [
      '⚡ Scheduled within 48-72 hours',
      '📸 Photo report on completion',
      '🔑 Tenant coordination available',
      '📄 Invoice emailed same day',
      '✨ Full cleanup included',
    ],
    highStandard: [
      '🚀 Same-day emergency callout',
      '📸 Full photo documentation',
      '🔑 Tenant coordination included',
      '📄 Invoice emailed immediately',
      '✨ Full cleanup included',
    ]
  },
  SMALL_BIZ: {
    // STANDARD HOURS = Basic business service
    handyFix: [
      'Quality workmanship',
      'Cleanup included',
      'Business hours (M-F)',
      'Proper invoicing',
    ],
    // AFTER-HOURS = Zero disruption service
    hassleFree: [
      '🌙 Evening/weekend availability',
      '🏪 Zero business disruption',
      '✨ "Open to a finished job"',
      '📸 Photo documentation',
      '🧹 Thorough cleanup',
    ],
    // EMERGENCY = Same-day priority
    highStandard: [
      '⚡ Same-day response',
      '🚨 Priority over other jobs',
      '📞 Direct emergency line',
      '🛡️ Extended warranty',
      '📋 Full compliance docs',
    ]
  },
  DIY_DEFERRER: {
    // BASIC = Anchor tier (get it done properly)
    handyFix: [
      'Quality workmanship',
      'Cleanup included',
      'Scheduled within 2-3 weeks',
      'Gets it all done properly',
    ],
    // STANDARD = Faster scheduling + extras
    hassleFree: [
      '📅 Faster scheduling (1-2 weeks)',
      '🛡️ 30-day guarantee',
      '📸 Before/after photos',
      '🔧 Minor extras while there',
    ],
    // PRIORITY = Premium service
    highStandard: [
      '⚡ Priority scheduling',
      '🛡️ 90-day guarantee',
      '🔧 Free small fix while there',
      '📞 Direct contact line',
    ]
  },
  BUDGET: {
    // SINGLE PRICE = Only option shown
    handyFix: [
      'Quality workmanship',
      'Cleanup included',
      'Scheduled when available',
      'Gets the job done right',
    ],
    // Not shown for BUDGET segment
    hassleFree: [],
    // Not shown for BUDGET segment
    highStandard: [],
  },
  OLDER_WOMAN: {
    // STANDARD = Basic reliable service
    handyFix: [
      'Quality workmanship',
      'Full cleanup included',
      'Scheduled within 2 weeks',
      'Clear communication throughout',
    ],
    // PEACE OF MIND = Anchor tier (trust + safety)
    hassleFree: [
      '🛡️ Vetted & background-checked staff',
      '📞 Direct contact with your technician',
      '📸 Before/after photos sent to you',
      '🧹 Thorough cleanup guaranteed',
      '✅ 90-day workmanship guarantee',
    ],
    // VIP = Premium white-glove service
    highStandard: [
      '⭐ Senior technician assigned',
      '📅 Flexible scheduling (your choice)',
      '📞 Priority phone support',
      '🛡️ 12-month guarantee',
      '🔧 Free check-up in 30 days',
    ]
  }
};

// Segment display configuration: controls which tiers to show and how
// Based on Ramanujam principle: "Productize by segment, not tier one product"
const SEGMENT_DISPLAY_CONFIG: Record<string, {
  showTiers: ('essential' | 'enhanced' | 'elite')[];
  anchorTier: 'essential' | 'enhanced' | 'elite';
  showAlternatives: boolean;
  ctaText: string;
  alternativeLabel: string | null;
}> = {
  BUSY_PRO: {
    showTiers: ['enhanced', 'essential'], // Priority first, Standard as backup
    anchorTier: 'enhanced',
    showAlternatives: false,
    ctaText: 'Book Priority Service',
    alternativeLabel: 'Need more flexibility? Choose timing below',
  },
  PROP_MGR: {
    showTiers: ['enhanced'], // Partner Program only
    anchorTier: 'enhanced',
    showAlternatives: false,
    ctaText: 'Join Partner Program',
    alternativeLabel: null,
  },
  SMALL_BIZ: {
    showTiers: ['enhanced', 'essential', 'elite'], // After-Hours anchor, show options
    anchorTier: 'enhanced',
    showAlternatives: true,
    ctaText: 'Book After-Hours',
    alternativeLabel: 'Need standard hours or emergency?',
  },
  DIY_DEFERRER: {
    showTiers: ['essential', 'enhanced', 'elite'], // Basic anchor, show upgrades
    anchorTier: 'essential',
    showAlternatives: true,
    ctaText: 'Book Basic Service',
    alternativeLabel: 'Want faster scheduling?',
  },
  BUDGET: {
    showTiers: ['essential'], // Basic only
    anchorTier: 'essential',
    showAlternatives: false,
    ctaText: 'Book Now',
    alternativeLabel: null,
  },
  OLDER_WOMAN: {
    showTiers: ['enhanced', 'essential', 'elite'], // Peace of Mind anchor
    anchorTier: 'enhanced',
    showAlternatives: true,
    ctaText: 'Book Peace of Mind Service',
    alternativeLabel: 'See other options',
  },
  DEFAULT: {
    showTiers: ['essential', 'enhanced', 'elite'], // Show all
    anchorTier: 'enhanced',
    showAlternatives: true,
    ctaText: 'Select Package',
    alternativeLabel: null,
  },
};

// Segment-specific tier names mapping
const SEGMENT_TIER_NAMES: Record<string, { essential: string; enhanced: string; elite: string }> = {
  BUSY_PRO: {
    essential: 'Standard Service',
    enhanced: 'Priority Service',
    elite: 'Express Service',
  },
  PROP_MGR: {
    essential: 'Single Job',
    enhanced: 'Partner Program',
    elite: 'Premium Partner',
  },
  SMALL_BIZ: {
    essential: 'Standard Hours',
    enhanced: 'After-Hours Service',
    elite: 'Emergency Service',
  },
  DIY_DEFERRER: {
    essential: 'Basic Service',
    enhanced: 'Standard Service',
    elite: 'Priority Service',
  },
  BUDGET: {
    essential: 'Service',
    enhanced: '',
    elite: '',
  },
  OLDER_WOMAN: {
    essential: 'Standard Service',
    enhanced: 'Peace of Mind',
    elite: 'VIP Service',
  },
  DEFAULT: {
    essential: 'Essential',
    enhanced: 'Enhanced',
    elite: 'Elite',
  },
};

// Helper: Choose dynamic perks or fallback to static bullets
const getPerksForTier = (quote: PersonalizedQuote | undefined, tier: 'essential' | 'enhanced' | 'elite'): string[] => {
  if (!quote) return [];

  const tierKeyMap = {
    essential: 'handyFix',
    enhanced: 'hassleFree',
    elite: 'highStandard'
  } as const;

  // Check for segment-specific configuration first
  const segment = quote.segment || 'DEFAULT';
  if (segment && SEGMENT_TIER_CONFIG[segment]) {
    const segmentConfig = SEGMENT_TIER_CONFIG[segment];
    const key = tierKeyMap[tier] as keyof typeof segmentConfig;
    const features = segmentConfig[key];
    // Only use segment config if it has features for this tier
    if (features && features.length > 0) {
      return features as unknown as string[];
    }
  }

  // Use dynamic perks if available (value pricing quotes)
  if (quote.dynamicPerks) {
    const tierMap = {
      essential: quote.dynamicPerks.essential,
      enhanced: quote.dynamicPerks.hassleFree,
      elite: quote.dynamicPerks.highStandard,
    };
    return tierMap[tier]?.map(p => p.label) || [];
  }

  // Fallback to static bullets (legacy quotes / default)
  const staticMap = {
    essential: HHH_FIXED_VALUE_BULLETS.handyFix,
    enhanced: HHH_FIXED_VALUE_BULLETS.hassleFree,
    elite: HHH_FIXED_VALUE_BULLETS.highStandard,
  };
  return staticMap[tier] as unknown as string[];
};

/**
 * Get 2-3 killer features with Lucide icons for mobile card collapsed state.
 * These are the "information scent" that helps users decide if they should expand.
 */
const getKeyFeaturesForTier = (tier: 'essential' | 'enhanced' | 'elite'): KeyFeature[] => {
  const featureMap: Record<typeof tier, KeyFeature[]> = {
    essential: [
      { icon: UserCheck, label: 'Qualified' },
      { icon: ShieldCheck, label: 'Reliable' }
    ],
    enhanced: [
      { icon: Zap, label: 'Priority' },
      { icon: Shield, label: '90-day' }
    ],
    elite: [
      { icon: Sparkles, label: 'Express' },
      { icon: Camera, label: 'Photos' }
    ]
  };

  return featureMap[tier];
};

/**
 * Calculate next available date based on tier priority.
 * Enhanced = T+4, Elite = T+1, Essential = T+7
 */
const getNextAvailableDate = (tier: 'essential' | 'enhanced' | 'elite'): string => {
  const daysMap = { essential: 7, enhanced: 4, elite: 1 };
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + daysMap[tier]);

  // Format as "Thu 6 Feb"
  const formatter = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });

  return formatter.format(futureDate);
};

/**
 * Get start date for date picker based on tier.
 */
const getDateSelectionStartDate = (tier: 'essential' | 'enhanced' | 'elite'): Date => {
  const daysMap = { essential: 7, enhanced: 4, elite: 1 };
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + daysMap[tier]);
  return futureDate;
};









// Quote Expired Popup Component (no auto-regeneration)
function QuoteExpiredPopup() {
  const [, setLocation] = useLocation();

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-md">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md mx-4 p-8 space-y-6">
        <div className="text-center space-y-4">
          <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto">
            <Clock className="w-10 h-10 text-amber-600" />
          </div>

          <h2 className="text-3xl font-bold text-gray-900">Quote Expired</h2>

          <p className="text-gray-600 text-lg">
            This quote has expired. Please contact us for an updated quote.
          </p>
        </div>

        <a
          href={`https://wa.me/447508744402?text=${encodeURIComponent("My quote expired! I need a new one 😊")}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full bg-green-600 hover:bg-green-700 text-white font-bold text-lg h-14 rounded-lg shadow-lg transition-colors"
          data-testid="button-whatsapp-contact"
        >
          <FaWhatsapp className="w-6 h-6" />
          Message Us on WhatsApp
        </a>
      </div>
    </div>
  );
}



interface OptionalExtra {
  id?: string;
  label: string;
  description: string;
  priceInPence: number;
  materialsCostInPence?: number;
  complexity?: 'simple' | 'moderate' | 'complex';
  estimatedHours?: number;
  isRecommended?: boolean;
}

interface JobTask {
  id: string;
  description: string;
  deliverable?: string;
  serviceType: string;
  estimatedDuration: string;
  estimatedHours: number;
  complexity: string;
  materialsNeeded?: string[];
}

interface Job {
  tasks?: JobTask[];
  summary?: string;
  description?: string; // Added to fix lint error
  totalEstimatedHours?: number;
  mediaUrls?: string[]; // Added: Array of image/video URLs
}

interface Perk {
  id: string;
  label: string;
  description: string;
}

export interface PersonalizedQuote {
  id: string;
  shortSlug: string;
  customerName: string;
  phone: string;
  email?: string;
  postcode?: string;
  address?: string;
  coordinates?: { lat: number; lng: number };
  assessmentReason?: string;
  jobDescription: string;
  completionDate: string;
  quoteMode: 'simple' | 'hhh' | 'pick_and_mix';
  jobs?: Job[]; // Job data including tasks with deliverables
  // HHH mode fields
  essentialPrice?: number;
  enhancedPrice?: number;
  elitePrice?: number;
  // Value pricing fields
  valueMultiplier?: number;
  recommendedTier?: 'essential' | 'hassleFree' | 'highStandard';
  dynamicPerks?: {
    essential: Perk[];
    hassleFree: Perk[];
    highStandard: Perk[];
  };
  // Tier-specific deliverables (NEW)
  tierDeliverables?: {
    essential: string[];
    hassleFree: string[];
    highStandard: string[];
  };
  // Manual feature entry (NEW)
  coreDeliverables?: string[];
  desirables?: Array<{
    feature: string;
    enhancedPrice: number;
    elitePrice: number;
  }>;
  // Materials cost for deposit calculation
  materialsCostWithMarkupPence?: number;
  // @deprecated Use coreDeliverables and desirables instead
  personalizedFeatures?: {
    enhanced: string[];
    elite: string[];
  };
  // Simple mode fields
  basePrice?: number;
  optionalExtras?: OptionalExtra[];
  viewedAt?: Date;
  selectedPackage?: string;
  selectedExtras?: string[];
  selectedAt?: Date;
  bookedAt?: Date;
  leadId?: string;
  expiresAt?: Date | string;
  createdAt: Date;
  createdBy?: string;
  contractor?: {
    name: string;
    companyName: string;
    profilePhotoUrl?: string | null;
    coverPhotoUrl?: string | null;
    slug?: string | null;
  };
  availability?: {
    hasContractors: boolean;
    availableDates: string[];
    matchCount: number;
  };
  recommendedRoute?: 'instant' | 'tiers' | 'assessment' | null;
  proposalModeEnabled?: boolean;
  clientType?: 'residential' | 'commercial';
  segment?: 'BUSY_PRO' | 'PROP_MGR' | 'SMALL_BIZ' | 'DIY_DEFERRER' | 'BUDGET' | 'OLDER_WOMAN' | 'UNKNOWN';

  // Dynamic Tier Config (from Value Pricing Engine)
  essential?: { name: string; description: string };
  hassleFree?: { name: string; description: string };
  highStandard?: { name: string; description: string };

  // Phase 1 Segmentation Fields
  jobType?: 'SINGLE' | 'COMPLEX' | 'MULTIPLE';
  quotability?: 'INSTANT' | 'VIDEO' | 'VISIT';
}

// Client Type Skins Configuration
// Client Type Skins Configuration
const SKIN_CONFIG = {
  residential: {
    theme: 'jobber',
    primaryColor: 'text-[#7DB00E]',
    primaryBg: 'bg-[#7DB00E]',
    hoverBg: 'hover:bg-[#6da000]',
    secondaryBg: 'bg-slate-50', // Light Mode
    borderColor: 'border-[#7DB00E]/30',
    iconColor: 'text-[#7DB00E]',
    gradient: 'from-slate-50 via-white to-slate-100',
    tone: {
      heroTitle: 'Your Quote Is Ready',
      heroSubtitle: 'Serving homeowners in',
      socialProofTitle: 'Active in Your Area',
      guaranteeTitle: '100% Satisfaction Guarantee',
      guaranteeText: 'Our work is backed by a rock-solid Money Back Guarantee.'
    }
  },
  commercial: {
    theme: 'slate',
    primaryColor: 'text-indigo-400',
    primaryBg: 'bg-indigo-600',
    hoverBg: 'hover:bg-indigo-500',
    secondaryBg: 'bg-slate-900/50',
    borderColor: 'border-indigo-500/20',
    iconColor: 'text-indigo-400',
    gradient: 'from-slate-900/60 to-indigo-900/40',
    tone: {
      heroTitle: 'Professional Maintenance',
      heroSubtitle: 'Reliable service for properties in',
      socialProofTitle: 'Trusted by Agencies',
      guaranteeTitle: 'Business-Grade Service',
      guaranteeText: 'Efficient, compliant, and fully invoiced work.'
    }
  }
};

// Segment-Specific Content Overrides
// Warm Lead Flow - They've already engaged, sent photos, expecting their quote
const SEGMENT_CONTENT_MAP: Record<string, any> = {
  BUSY_PRO: {
    hero: {
      title: "Your Quote is Ready",
      subtitle: <>We've reviewed your request.<br />Priority scheduling is available for this week.</>,
      scrollText: "View your options"
    },
    // Quick Validation (Social Proof - Cialdini 1984)
    proof: {
      title: "YOU'RE IN GOOD HANDS",
      mainTitle: "Trusted by busy professionals.",
      testimonial: {
        text: "I sent photos Monday morning, had a quote by lunch, and they were done by Wednesday. No chasing, no hassle.",
        author: "Sarah T.",
        detail: "Marketing Director"
      },
      description: "Join thousands of busy professionals who trust us with their homes.",
      stats: [
        { value: "78%", label: "choose Priority", subtext: "of professionals" },
        { value: "4.9", label: "Google rating", subtext: "★★★★★" },
        { value: "92%", label: "rebook", subtext: "repeat rate" }
      ]
    },
    // Certainty Effect - Reduce Decision Anxiety (Kahneman & Tversky, 1979)
    guarantee: {
      title: "NO SURPRISES",
      mainTitle: <span className="font-bold block leading-tight">Zero hassle. <br className="md:hidden" /> Zero hidden fees.</span>,
      description: "You're busy. We respect that. The price is fixed, the time slot is yours, and the result is guaranteed.",
      boxText: "Zero hassle. Zero ambiguity. 100% Guaranteed.",
      guaranteeItems: [
        { icon: 'Lock', title: "Upfront Pricing", text: "The price you see is the price you pay. No last-minute add-ons." },
        { icon: 'Clock', title: "We Respect Your Calendar", text: "You pick the slot. We arrive on time, every time." },
        { icon: 'Shield', title: "Total Peace of Mind", text: "If it's not perfect, we return for free. 90-day warranty." }
      ],
      badges: [
        { label: 'Price', value: 'Fixed', icon: 'Lock' },
        { label: 'Arrival', value: 'On Time', icon: 'Clock' },
        { label: 'Warranty', value: '90 Days', icon: 'Shield' },
        { label: 'Quality', value: 'Guaranteed', icon: 'Star' }
      ]
    }
  },
  PROP_MGR: {
    hero: {
      title: "Your Maintenance Team",
      subtitle: "One text. Every property sorted.",
      scrollText: "See Partner Benefits"
    },
    proof: {
      title: "BUILT FOR PORTFOLIOS",
      mainTitle: "We handle the tenant headache.",
      description: "Direct tenant coordination, scheduled access, photo reports for your records. You forward the text, we handle the rest.",
      mapOverlayText: "Covering your portfolio",
      testimonial: {
        text: "I manage 34 units. They're the only trade I don't have to chase. Text in, invoice out, done.",
        author: "Sarah Jenkins",
        detail: "Portfolio Manager, 34 units"
      }
    },
    guarantee: {
      title: "PORTFOLIO PARTNER",
      mainTitle: "Your Maintenance Department",
      description: "Priority response, monthly invoicing, and photo documentation for every job. Built for scale.",
      boxText: "One vendor. Every property. Zero chasing.",
      badges: [
        { label: 'Response', value: '24-48hr SLA', icon: 'Clock' },
        { label: 'Billing', value: 'Monthly Net 30', icon: 'Lock' },
        { label: 'Reports', value: 'Photo Docs', icon: 'Camera' },
        { label: 'Scale', value: 'Multi-Property', icon: 'Shield' }
      ]
    }
  },
  SMALL_BIZ: {
    hero: {
      title: "After-Hours Service",
      subtitle: "Zero business disruption.",
      scrollText: "See Business Solutions"
    },
    proof: {
      title: "BUSINESS GRADE",
      mainTitle: "We work while you sleep.",
      description: "Invisible service. We arrive when you close, and you open to a finished job and a clean workspace.",
      mapOverlayText: "Discreet Arrival Available",
      testimonial: {
        text: "They came at 7pm, fixed the lighting, and cleaned up. No customers even knew they were there.",
        author: "Cafe Nero Mgr",
        detail: "Local Business"
      }
    },
    guarantee: {
      title: "BUSINESS COMPLIANCE",
      mainTitle: "Professional Compliance",
      description: "Full VAT invoicing, RAMS available upon request, and commercial-grade insurance.",
      boxText: "After-hours service at standard daytime rates for contract clients.",
      badges: [
        { label: 'Schedule', value: 'After-Hours', icon: 'Clock' },
        { label: 'Invoice', value: 'VAT Invoice', icon: 'Lock' },
        { label: 'Safety', value: 'RAMS Ready', icon: 'Shield' },
        { label: 'Quality', value: 'Commercial', icon: 'Star' }
      ]
    }
  },
  OLDER_WOMAN: {
    hero: {
      title: "Safe, Trusted & Recommended",
      subtitle: <>We've reviewed your request.<br />Our verified staff are ready to help.</>,
      scrollText: "View your quote"
    },
    // Trust & Safety Focus (Risk Reduction)
    proof: {
      title: "CUSTOMER TESTIMONIAL",
      mainTitle: "See what our customers say.",
      testimonial: {
        text: "Such a polite young man. He explained everything clearly, wore overshoes, and even fixed my gate latch while he was here.",
        author: "Mary P.",
        detail: "Retired Teacher"
      },
      description: "Watch a short video to hear directly from a customer about how happy she was with our service.",
      stats: [
        { value: "100%", label: "DBS Checked", subtext: "Safe & Verified" },
        { value: "50s+", label: "Discount", subtext: "Available" },
        { value: "4.9", label: "Rating", subtext: "Local Reviews" }
      ]
    },
    // Peace of Mind Guarantee
    guarantee: {
      title: "PEACE OF MIND",
      mainTitle: <span className="font-bold block leading-tight">Respect for you <br className="md:hidden" /> and your home.</span>,
      description: "We understand inviting someone into your home requires trust. We take that seriously.",
      image: "/assets/quote-images/older-person-door.jpg",
      boxText: "Polite. Clean. Safe.",
      guaranteeItems: [
        { icon: 'Shield', title: "Safety First", text: "All staff are ID-verified and background checked for your peace of mind." },
        { icon: 'Sparkles', title: "We Keep It Clean", text: "We wear overshoes and use dust sheets. We leave no mess behind." },
        { icon: 'MessageCircle', title: "Patient Explanations", text: "No jargon. We explain exactly what needs doing before we start." }
      ],
      badges: [
        { label: 'Safety', value: 'Verified', icon: 'Shield' },
        { label: 'Tidiness', value: 'Spotless', icon: 'Sparkles' },
        { label: 'Service', value: 'Polite', icon: 'Star' },
        { label: 'Payment', value: 'Easy', icon: 'Lock' }
      ]
    },
  },
  DIY_DEFERRER: {
    hero: {
      title: "Batch Service",
      subtitle: "Clear the list in one go.",
      scrollText: "See Batch Pricing"
    },
    proof: {
      title: "EFFICIENCY EXPERT",
      mainTitle: "Efficiency Expert.",
      description: "Why take 3 weekends? We get your entire to-do list done in a single morning. Professional speed.",
      mapOverlayText: "3 Jobs in 1 Visit",
      testimonial: {
        text: "I've been meaning to put those shelves up for a year. He did it in 20 minutes. Worth every penny.",
        author: "Mike R.",
        detail: "Homeowner"
      }
    },
    guarantee: {
      title: "BETTER THAN DIY",
      mainTitle: "30-Day Workmanship",
      description: "Done right, the first time. No leaks, no wonky shelves, no mess left behind.",
      boxText: "If you're not happy, we come back for free. Simple.",
      badges: [
        { label: 'Quality', value: 'Pro Finish', icon: 'Star' },
        { label: 'Speed', value: '1/3 The Time', icon: 'Zap' },
        { label: 'Clean', value: 'No Mess', icon: 'UserCheck' },
        { label: 'Warranty', value: '30 Days', icon: 'Shield' }
      ]
    }
  },
  BUDGET: {
    hero: {
      title: "Standard Service",
      subtitle: "Fair price. Quality work.",
      scrollText: "See Standard Price"
    },
    proof: {
      title: "LOCAL & VERIFIED",
      mainTitle: "Local & Verified.",
      description: "Don't risk a cowboy. We are local, vetted, and insured. Real layout, real people.",
      mapOverlayText: "Live in your area",
      testimonial: {
        text: "Good honest price. Turned up when they said they would.",
        author: "David K.",
        detail: "Local Resident"
      }
    },
    guarantee: {
      title: "STANDARD WARRANTY",
      mainTitle: "30-Day Workmanship",
      description: "Standard industry guarantee on all labor. We stand by our work.",
      boxText: "Basic 30-day guarantee on all labor.",
      badges: [
        { label: 'Quality', value: 'Standard', icon: 'Star' },
        { label: 'Vetted', value: 'Checked', icon: 'Shield' },
        { label: 'Local', value: 'Nearby', icon: 'UserCheck' },
        { label: 'Warranty', value: '30 Days', icon: 'Clock' }
      ]
    }
  },
  DEFAULT: {
    hero: {
      title: "Your Quote Is Ready",
      subtitle: "Expert tradesmen in your area.",
      scrollText: "See Your Options"
    },
    proof: {
      title: "TRUSTED LOCALLY",
      mainTitle: "We're Neighborly.",
      description: "We aren't a faceless app. We are local experts who know your area inside out.",
      mapOverlayText: "Live in your area",
      testimonial: {
        text: "Absolutely professional. They knew exactly how to handle the Victorian plumbing in our street.",
        author: "Neighbor",
        detail: "Verified Customer"
      }
    },
    guarantee: {
      title: "SATISFACTION GUARANTEE",
      mainTitle: "100% Satisfaction",
      description: "Our work is backed by a rock-solid Money Back Guarantee.",
      boxText: "If you're not happy, we make it right.",
      badges: [
        { label: 'Reliability', value: 'On-Time', icon: 'Clock' },
        { label: 'Quality', value: 'Guaranteed', icon: 'Star' },
        { label: 'Safety', value: 'Insured', icon: 'Shield' },
        { label: 'Trust', value: 'Vetted', icon: 'UserCheck' }
      ]
    }
  }
};

// Date Strip Component for HHH Cards
const DateStrip = ({ tier, availableDates }: { tier: 'essential' | 'enhanced' | 'elite', availableDates: string[] }) => {
  if (!availableDates || availableDates.length === 0) return null;

  // "Teaser" Logic: Show mix of locked (FOMO) and available (Actual) dates
  const today = new Date();

  const allDates = availableDates.map(dateStr => {
    const date = new Date(dateStr);
    const diffTime = date.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    let isLocked = false;
    if (tier === 'enhanced' && diffDays < 3) isLocked = true;
    if (tier === 'essential' && diffDays < 7) isLocked = true;
    return { dateStr, isLocked, diffDays };
  });

  let datesToShow;
  if (tier === 'elite') {
    // Elite sees everything linear
    datesToShow = allDates.slice(0, 5);
  } else {
    // Others see: First 2 dates (likely locked) + First 3 UNLOCKED dates
    const lockedDates = allDates.filter(d => d.isLocked);
    const unlockedDates = allDates.filter(d => !d.isLocked);

    // Take up to 2 locked dates to show "what you are missing"
    const teaserLocked = lockedDates.slice(0, 2);
    // Take remaining slots (up to 5 total) from unlocked dates
    const slotsRemaining = 5 - teaserLocked.length;
    const teaserUnlocked = unlockedDates.slice(0, slotsRemaining);

    datesToShow = [...teaserLocked, ...teaserUnlocked];
  }

  if (datesToShow.length === 0) return (
    <div className="text-xs text-muted-foreground mt-2 italic">Check calendar for dates</div>
  );

  return (
    <div className="flex flex-col mt-3 -mx-2 px-2 mask-fade-right">
      {tier === 'elite' && (
        <div className="flex items-center gap-1 mb-1.5 pl-1">
          <span className="text-[9px] font-bold text-[#7DB00E] bg-[#7DB00E]/20 px-1.5 py-0.5 rounded border border-[#7DB00E]/30 uppercase tracking-wider">
            Fast Track
          </span>
          <span className="text-[9px] text-gray-400">Next-Day Access</span>
        </div>
      )}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 px-1 scrollbar-hide">
        {datesToShow.map(({ dateStr, isLocked }, i) => {
          const date = new Date(dateStr);
          const label = format(date, 'EEE d');

          return (
            <div
              key={i}
              className={`flex-shrink-0 border rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap flex items-center gap-1.5 transition-all
                ${isLocked
                  ? 'bg-zinc-900 border-zinc-800 text-zinc-600 cursor-not-allowed'
                  : 'bg-white/10 border-white/20 text-white'
                }`}
            >
              {isLocked && <Lock className="w-3 h-3 text-zinc-700" />}
              {label}
            </div>
          );
        })}
      </div>
    </div>
  );
};



// --- NEW VERTICAL VALUE SECTIONS ---


// --- ANIMATION VARIANTS ---
const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.2
    }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } }
};

const drawVariants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: {
    pathLength: 1,
    opacity: 0.5,
    transition: {
      pathLength: { duration: 1.5, ease: "easeInOut" },
      opacity: { duration: 0.5 }
    }
  }
};

const chartPointVariants = {
  hidden: { scale: 0, opacity: 0 },
  visible: {
    scale: 1,
    opacity: 1,
    transition: { duration: 0.5, delay: 1.5, type: "spring" } // Delay to appear after curve
  }
};

const AnimatedStat = ({ value, delay }: { value: string, delay: number }) => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });
  const springValue = useSpring(0, { duration: 2000, bounce: 0 }); // 2s duration, no bounce for smooth count

  useEffect(() => {
    if (isInView) {
      const match = value.match(/^([\d.]+)(.*)$/);
      if (match) {
        const num = parseFloat(match[1]);
        springValue.set(num);
      }
    }
  }, [isInView, value, springValue]);

  const displayValue = useTransform(springValue, (latest) => {
    const match = value.match(/^([\d.]+)(.*)$/);
    if (!match) return value;
    const suffix = match[2];
    const isFloat = match[1].includes('.');
    // If it was valid float in string, keep 1 decimal if needed, else integer
    return isFloat ? latest.toFixed(1) + suffix : Math.round(latest) + suffix;
  });

  return <motion.span ref={ref} className="text-2xl md:text-3xl font-bold text-[#1D2D3D]">{displayValue}</motion.span>;
};

// Quick Social Proof for Warm Leads (Cialdini 1984)
const ValueSocialProof = ({ quote }: { quote: PersonalizedQuote }) => {
  console.log('ValueSocialProof: Mounting...');
  const segmentKey = quote.segment && SEGMENT_CONTENT_MAP[quote.segment] ? quote.segment : 'BUSY_PRO';
  const content = SEGMENT_CONTENT_MAP[segmentKey].proof;

  // Icon mapping for stats
  const statIcons = [Zap, Star, UserCheck];

  // Determine location from postcode
  // Determine location from postcode or address
  const postcode = quote.postcode?.toUpperCase() || '';
  const address = quote.address?.toLowerCase() || '';

  const locationName =
    postcode.startsWith('DE') || address.includes('derby') ? 'Derby' :
      postcode.startsWith('NG') || address.includes('nottingham') ? 'Nottingham' :
        'Local';

  // Inject Wistia scripts on mount
  useEffect(() => {
    // Check if script already exists
    if (!document.querySelector('script[src*="wistia.com/player.js"]')) {
      const script1 = document.createElement('script');
      script1.src = 'https://fast.wistia.com/player.js';
      script1.async = true;
      document.body.appendChild(script1);
    }

    if (!document.querySelector('script[src*="wistia.com/embed/z6vtl8u04e.js"]')) {
      const script2 = document.createElement('script');
      script2.src = 'https://fast.wistia.com/embed/z6vtl8u04e.js';
      script2.async = true;
      script2.type = 'module';
      document.body.appendChild(script2);
    }
  }, []);

  return (
    <SectionWrapper className="bg-white text-slate-900 py-16">
      <div
        className="max-w-2xl"
      >
        {/* Header to fill whitespace */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#7DB00E]/10 text-[#7DB00E] text-xs font-bold uppercase tracking-wider mb-4">
            <Star className="w-3 h-3 fill-current" />
            Proven Reliability
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-[#1D2D3D] mb-4">
            {content.mainTitle}
          </h2>
          <p className="text-slate-500 mb-8">
            {content.description}
          </p>

          {/* Social Proof Video - Trust Builder */}
          <div className="relative aspect-video rounded-2xl overflow-hidden bg-slate-900 shadow-xl mb-12 border-4 border-white/50 ring-1 ring-slate-900/10">
            {/* Wistia Script Injection handled in component body to ensure execution */}
            <style dangerouslySetInnerHTML={{ __html: `wistia-player[media-id='z6vtl8u04e']:not(:defined) { background: center / contain no-repeat url('https://fast.wistia.com/embed/medias/z6vtl8u04e/swatch'); display: block; filter: blur(5px); padding-top:75.0%; }` }} />
            {/* @ts-ignore */}
            <wistia-player media-id="z6vtl8u04e" aspect="1.3333333333333333"></wistia-player>
          </div>
        </div>

        {/* Stats Row with Icons */}
        {content.stats && content.stats.length > 0 && (
        <div className="flex justify-center gap-6 md:gap-12 mb-10">
          {content.stats.map((stat: any, i: number) => {
            const IconComponent = statIcons[i] || Star;
            return (
              <div
                key={i}
                className="text-center"
              >
                <div className="flex justify-center mb-2">
                  <div className="p-2 bg-[#7DB00E]/10 rounded-full">
                    <IconComponent className="w-5 h-5 text-[#7DB00E]" />
                  </div>
                </div>
                <div>
                  <AnimatedStat value={stat.value} delay={0.2 + i * 0.1} />
                </div>
                <div className="text-xs text-slate-500 mt-1">{stat.label}</div>
              </div>
            );
          })}
        </div>
        )}

        {/* Single Testimonial with Image Placeholder */}
        <div className="max-w-lg mx-auto">
          {(() => {
            const { data: reviewsData, isLoading } = useQuery({
              queryKey: ['google-reviews-social', quote.postcode], // Unique query key
              queryFn: async () => {
                const location = quote.postcode ? quote.postcode.split(' ')[0] : 'nottingham';
                const res = await fetch(`/api/google-reviews?location=${location}`);
                if (!res.ok) throw new Error('Failed to fetch reviews');
                return res.json();
              },
              staleTime: 1000 * 60 * 60,
            });

            const [activeIndex, setActiveIndex] = useState(0);

            useEffect(() => {
              if (!reviewsData?.reviews?.length) return;
              const interval = setInterval(() => {
                setActiveIndex((prev) => (prev + 1) % reviewsData.reviews.length);
              }, 6000); // Slightly slower cycle for variety
              return () => clearInterval(interval);
            }, [reviewsData]);

            const reviews = reviewsData?.reviews || [];
            const currentReview = reviews[activeIndex];

            if (isLoading || !currentReview) {
              return (
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-6 animate-pulse">
                  <div className="h-4 bg-slate-200 rounded w-3/4 mb-4"></div>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-200"></div>
                    <div className="h-3 bg-slate-200 rounded w-1/3"></div>
                  </div>
                </div>
              );
            }

            return (
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-6 transition-all duration-500">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex gap-1 text-[#F4B400]">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className={`w-3.5 h-3.5 ${i < currentReview.rating ? 'fill-current' : 'text-slate-300'}`} />
                    ))}
                  </div>
                  <SiGoogle className="w-4 h-4 text-slate-400" />
                </div>
                <p className="text-slate-600 text-sm leading-relaxed mb-4 italic">
                  "{currentReview.text.length > 140 ? currentReview.text.substring(0, 140) + '...' : currentReview.text}"
                </p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center overflow-hidden border border-white shadow-sm">
                    {currentReview.profile_photo_url ? (
                      <img src={currentReview.profile_photo_url} alt={currentReview.authorName} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-slate-500 font-bold">{currentReview.authorName.charAt(0)}</span>
                    )}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-[#1D2D3D]">{currentReview.authorName}</div>
                    <div className="text-xs text-slate-400">{currentReview.relativeTime}</div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </SectionWrapper>
  );
};

const ValueHero = ({ quote, config }: { quote: PersonalizedQuote, config: any }) => {
  // Get segment content
  const segmentKey = quote.segment && SEGMENT_CONTENT_MAP[quote.segment] ? quote.segment : 'DEFAULT';
  const content = SEGMENT_CONTENT_MAP[segmentKey].hero;
  const isBusyPro = quote.segment === 'BUSY_PRO';

  return (
    <SectionWrapper className={`relative border-b-4 border-[#7DB00E] overflow-hidden`}>
      {/* Background Image with Overlay */}
      <div className="absolute inset-0 z-0 select-none">
        <img
          src="/assets/quote-images/door-greeting.jpg"
          alt="Friendly Plumber"
          className="w-full h-full object-cover opacity-50 contrast-125"
        />
        <div className={`absolute inset-0 bg-slate-900/80 mix-blend-multiply`} />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent opacity-90" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        viewport={{ once: true }}
        className="max-w-2xl z-10 relative"
      >
        {/* BUSY_PRO: Simple confirmation - they've already engaged */}
        {isBusyPro && (
          <div className="flex justify-center mb-6">
            <div className="bg-[#7DB00E]/10 text-[#7DB00E] border border-[#7DB00E]/40 px-4 py-2 rounded-full flex items-center gap-2 backdrop-blur-md">
              <Check className="w-4 h-4" />
              <span className="text-white font-medium text-sm">Quote Ready</span>
            </div>
          </div>
        )}

        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 drop-shadow-sm text-white leading-tight">
          Hi {quote.customerName.split(' ')[0]},
        </h1>

        {/* BUSY_PRO: Simple, direct - they know why they're here */}
        {isBusyPro ? (
          <>
            <p className="text-xl md:text-2xl text-slate-200 font-light leading-relaxed mb-6 px-4 md:px-0 max-w-lg mx-auto">
              {content.subtitle}
            </p>

            {/* Job confirmation card with customer's submitted media */}
            {/* Job confirmation card with customer's submitted media */}
            <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl p-5 mb-6 max-w-md mx-auto text-left">
              <div className="flex items-start gap-4">
                {/* Image icon removed as requested */}

                <div className="flex-1">
                  <p className="text-[#7DB00E] text-xs font-bold uppercase tracking-widest mb-1">
                    Job Summary
                  </p>
                  <p className="text-white font-medium mb-1 leading-snug line-clamp-2 text-ellipsis overflow-hidden">
                    {(() => {
                      const aiSummary = quote.jobs?.[0]?.summary;
                      const isInvalidSummary = !aiSummary ||
                        aiSummary.toLowerCase().includes('unable to analyze') ||
                        aiSummary.toLowerCase().includes('failed to generate') ||
                        aiSummary.length < 5;

                      let displayText = "";
                      if (!isInvalidSummary && aiSummary) {
                        displayText = aiSummary.charAt(0).toUpperCase() + aiSummary.slice(1).replace(/\.$/, '');
                      } else {
                        displayText = quote.jobs?.[0]?.description || quote.jobDescription || "Your project";
                      }

                      return displayText;
                    })()}
                  </p>
                </div>
              </div>
            </div>
          </>
        ) : (
          <p className="text-lg md:text-xl text-slate-200 font-light leading-relaxed mb-6 px-4 md:px-0 max-w-lg mx-auto">
            {content.subtitle} <br />
            We've put together this plan for <span className="text-white font-bold border-b border-[#7DB00E] mx-1">
              {(() => {
                const aiSummary = quote.jobs?.[0]?.summary;
                const isInvalidSummary = !aiSummary ||
                  aiSummary.toLowerCase().includes('unable to analyze') ||
                  aiSummary.toLowerCase().includes('failed to generate') ||
                  aiSummary.length < 5;
                if (!isInvalidSummary && aiSummary) {
                  return aiSummary.toLowerCase().replace(/\.$/, '');
                }
                const desc = quote.jobs?.[0]?.description || quote.jobDescription || "your project";
                return desc.length > 40
                  ? desc.substring(0, 40).replace(/^(fixing|installing|repairing) /i, '').replace(/\.$/, '') + '...'
                  : desc.toLowerCase().replace(/^\w/, c => c.toLowerCase()).replace(/\.$/, '');
              })()}
            </span>
            in <span className="text-white font-bold bg-[#7DB00E]/20 px-2 py-0.5 rounded whitespace-nowrap">{quote.postcode?.split(' ')[0] || 'your area'}</span>.
          </p>
        )}

        {/* Quote Prepared By Mike */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-[#7DB00E] shadow-xl">
            <img
              src="/assets/quote-images/plumber-smile.jpg"
              alt="Mike"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="text-left">
            <div className="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-0.5">Prepared by</div>
            <div className="text-white font-bold text-lg leading-none">Mike <span className="text-[#7DB00E] text-sm font-normal">from HandyServices</span></div>
          </div>
        </div>


      </motion.div>
    </SectionWrapper>
  );
};






const ValueProof = ({ quote, config }: { quote: PersonalizedQuote, config: any }) => {
  // Get segment content
  const segmentKey = quote.segment && SEGMENT_CONTENT_MAP[quote.segment] ? quote.segment : 'DEFAULT';
  const content = SEGMENT_CONTENT_MAP[segmentKey].proof;

  return (
    <SectionWrapper className="bg-white text-slate-900 border-t border-slate-100">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        whileInView={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8 }}
        className="max-w-5xl w-full z-10"
      >
        <div className="grid md:grid-cols-2 gap-12 items-center">
          {/* Left: The Map Simulation (Radius View - Light Mode) */}
          <div className="relative h-64 md:h-80 bg-slate-200 rounded-2xl overflow-hidden border-2 border-white/50 shadow-2xl group">
            {/* Map Background: Real Google Static Map or Fallback Grid */}
            {quote?.coordinates && import.meta.env.VITE_GOOGLE_MAPS_API_KEY ? (
              <div className="absolute inset-0 z-0 bg-slate-200">
                <img
                  src={`https://maps.googleapis.com/maps/api/staticmap?center=${quote.coordinates.lat},${quote.coordinates.lng}&zoom=13&size=600x400&maptype=roadmap&key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&style=feature:poi|visibility:off`}
                  alt="Area Map"
                  loading="eager"
                  className="w-full h-full object-cover opacity-100 transition-opacity duration-300"
                  onError={(e) => {
                    console.error("Map load failed", e);
                    e.currentTarget.style.display = 'none';
                    e.currentTarget.parentElement?.classList.add('fallback-map-pattern');
                    if (e.currentTarget.parentElement) {
                      e.currentTarget.parentElement.style.backgroundImage = "linear-gradient(rgba(0,0,0,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.1) 1px, transparent 1px)";
                      e.currentTarget.parentElement.style.backgroundSize = "10px 10px";
                    }
                  }}
                />
              </div>
            ) : (
              /* Fallback Grid Pattern */
              <div className="absolute inset-0 opacity-20 bg-[linear-gradient(rgba(0,0,0,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.1)_1px,transparent_1px)] bg-[size:10px_10px]"></div>
            )}

            {/* Radius Circle (Radar Effect) */}
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 border border-[#7DB00E] rounded-full bg-[#7DB00E]/5 animate-pulse"></div>

            {/* User Location */}
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-20">
              <div className="w-3 h-3 rounded-full bg-blue-600 border-2 border-white shadow-lg relative">
                <div className="absolute -inset-2 bg-blue-500/20 rounded-full animate-ping"></div>
              </div>
              <div className="mt-1 bg-white/80 px-2 py-0.5 rounded text-[8px] font-bold text-slate-800 backdrop-blur shadow-sm">You</div>
            </div>

            {/* HandyServices Van Location (Stationary Nearby) */}
            <div className="absolute top-[40%] left-[60%] z-20">
              <div className="flex flex-col items-center transform -translate-x-1/2 -translate-y-1/2">
                <div className="text-[#7DB00E] drop-shadow-xl filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
                  <Truck className="w-6 h-6 fill-current" />
                </div>
                <div className="mt-1 bg-[#7DB00E] text-white px-2 py-0.5 rounded text-[10px] font-bold shadow-md whitespace-nowrap">HandyServices</div>
              </div>
            </div>

            {/* Overlay Stats */}
            <div className="absolute bottom-4 left-4 right-4 bg-white/90 backdrop-blur border border-slate-200 p-3 rounded-xl flex justify-between items-center shadow-lg">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                <span className="text-xs font-bold text-slate-700">{content.mapOverlayText}</span>
              </div>
              <span className="text-[10px] text-slate-400 uppercase tracking-widest">Realtime</span>
            </div>
          </div>

          {/* Right: The Text & Reviews */}
          <div className="text-left">
            <h2 className="text-[#7DB00E] text-xs font-bold uppercase tracking-widest mb-4">{content.title}</h2>
            <h3 className="text-3xl md:text-5xl font-light mb-8">{content.mainTitle}</h3>

            <p className="text-gray-400 mb-8 max-w-sm">
              {content.description}
            </p>

            <div className="space-y-4">
              {/* Dynamic Google Reviews Carousel */}
              {(() => {
                const { data: reviewsData, isLoading } = useQuery({
                  queryKey: ['google-reviews', quote.postcode],
                  queryFn: async () => {
                    // Default to Nottingham if no postcode, or extract town from postcode
                    const location = quote.postcode ? quote.postcode.split(' ')[0] : 'nottingham';
                    const res = await fetch(`/api/google-reviews?location=${location}`);
                    if (!res.ok) throw new Error('Failed to fetch reviews');
                    return res.json();
                  },
                  staleTime: 1000 * 60 * 60, // 1 hour
                });

                const [activeIndex, setActiveIndex] = useState(0);

                // Auto-cycle reviews
                useEffect(() => {
                  if (!reviewsData?.reviews?.length) return;
                  const interval = setInterval(() => {
                    setActiveIndex((prev) => (prev + 1) % reviewsData.reviews.length);
                  }, 5000);
                  return () => clearInterval(interval);
                }, [reviewsData]);

                const reviews = reviewsData?.reviews || [];
                const currentReview = reviews[activeIndex];

                if (isLoading || !currentReview) {
                  // Loading Skeleton or Fallback
                  return (
                    <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 relative shadow-sm animate-pulse">
                      <div className="h-4 bg-slate-200 rounded w-1/3 mb-4"></div>
                      <div className="space-y-2">
                        <div className="h-2 bg-slate-200 rounded w-full"></div>
                        <div className="h-2 bg-slate-200 rounded w-5/6"></div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 relative shadow-md transition-all duration-500">
                    <div className="absolute -top-3 -right-3 bg-white p-1.5 rounded-full shadow-sm border border-slate-100">
                      <SiGoogle className="w-6 h-6 text-[#4285F4]" />
                    </div>

                    <div className="flex gap-1 text-[#F4B400] mb-3">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} className={`w-3.5 h-3.5 ${i < currentReview.rating ? 'fill-current' : 'text-slate-300'}`} />
                      ))}
                    </div>

                    <div className="min-h-[80px]">
                      <p className="text-slate-700 text-sm italic mb-4 leading-relaxed">"{currentReview.text.length > 120 ? currentReview.text.substring(0, 120) + '...' : currentReview.text}"</p>
                    </div>

                    <div className="flex items-center gap-3 pt-2 border-t border-slate-200/50">
                      <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-500 overflow-hidden">
                        {currentReview.profile_photo_url ? (
                          <img src={currentReview.profile_photo_url} alt={currentReview.authorName} className="w-full h-full object-cover" />
                        ) : (
                          currentReview.authorName.charAt(0)
                        )}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-[#1D2D3D]">{currentReview.authorName}</div>
                        <div className="text-[9px] text-slate-400 font-medium">{currentReview.relativeTime}</div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </motion.div>
    </SectionWrapper>
  );
};

const ValueGuarantee = ({ quote, config }: { quote: PersonalizedQuote, config: any }) => {
  // Get segment content
  const segmentKey = quote.segment && SEGMENT_CONTENT_MAP[quote.segment] ? quote.segment : 'DEFAULT';
  const content = SEGMENT_CONTENT_MAP[segmentKey].guarantee;
  const isBusyPro = quote.segment === 'BUSY_PRO';

  // Icon mapping
  const iconMap: Record<string, any> = {
    'Wrench': Wrench,
    'Shield': Shield,
    'UserCheck': UserCheck,
    'Lock': Lock,
    'Clock': Clock,
    'Zap': Zap,
    'Star': Star
  };

  return (
    <SectionWrapper className={`bg-[#1D2D3D] text-white relative`}>
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 1 }}
        className="max-w-2xl"
      >
        {!isBusyPro && (
          <div className="flex justify-center mb-10">
            {content.image ? (
              // Rectangular 'Embed-style' Image for Older Woman / Custom Images
              <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-slate-900 shadow-xl border-4 border-white/10 ring-1 ring-slate-900/10 group">
                <div className="absolute inset-0 bg-gradient-to-t from-[#1D2D3D] via-transparent to-transparent opacity-60 z-10" />
                <img
                  src={content.image}
                  alt="Guarantee"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                />
                {/* Badge Overlay */}
                <div className="absolute bottom-4 right-4 z-20">
                  <div className="bg-[#7DB00E] text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg border border-white/20">
                    Verified Pro
                  </div>
                </div>
              </div>
            ) : (
              // Default Circular Badge
              <div className="relative">
                <div className="absolute inset-0 bg-[#7DB00E]/20 blur-3xl rounded-full" />
                <div className={`p-1.5 bg-[#1D2D3D] rounded-full border-2 border-[#7DB00E] relative overflow-hidden w-24 h-24 flex items-center justify-center group shadow-xl`}>
                  <img
                    src="/assets/quote-images/plumber-smile.jpg"
                    alt="Guarantee"
                    className="w-full h-full object-cover rounded-full group-hover:scale-110 transition-transform duration-500 opacity-90"
                  />
                </div>
                <div className="absolute -bottom-2 -right-2 bg-[#7DB00E] text-white text-[10px] font-bold px-2 py-0.5 rounded-full border border-[#1D2D3D]">
                  PRO
                </div>
              </div>
            )}
          </div>
        )}

        <h2 className="text-[#7DB00E] text-xs font-bold uppercase tracking-[0.2em] mb-4">{content.title}</h2>
        <h3 className="text-4xl md:text-5xl font-light mb-8 text-white">{content.mainTitle}</h3>

        <p className="text-slate-300 text-lg mb-6">{content.description}</p>

        {/* BUSY_PRO: Certainty Items (Kahneman & Tversky, 1979) */}
        {isBusyPro && content.guaranteeItems && (
          <div className="space-y-4 mb-10">
            {content.guaranteeItems.map((item: any, i: number) => {
              const IconComponent = iconMap[item.icon] || Shield;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  viewport={{ once: true }}
                  className="group flex items-center gap-5 bg-gradient-to-br from-white/10 to-transparent border border-white/10 hover:border-[#7DB00E]/50 transition-all duration-300 rounded-xl p-6"
                >
                  <div className="shrink-0 p-3.5 bg-gradient-to-br from-[#7DB00E] to-[#6da000] rounded-full shadow-lg shadow-[#7DB00E]/20 group-hover:scale-110 transition-transform duration-300">
                    <IconComponent className="w-6 h-6 text-[#1D2D3D]" />
                  </div>
                  <div>
                    <div className="text-white font-bold text-lg leading-tight mb-1">{item.title}</div>
                    <div className="text-slate-300 text-sm leading-relaxed">{item.text}</div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Specific Guarantee Statement */}
        <div className="bg-[#7DB00E]/10 border border-[#7DB00E]/30 rounded-xl p-4 mb-10 text-center">
          <p className="text-[#7DB00E] font-medium text-sm">
            {content.boxText}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 max-w-xl mx-auto">
          {content.badges.map((item: any, i: number) => {
            const IconComponent = iconMap[item.icon] || Shield;
            return (
              <div key={i} className="bg-white/5 p-4 rounded-xl border border-white/10 shadow-sm text-center hover:bg-white/10 transition-all">
                <div className={`flex justify-center mb-2 text-[#7DB00E]`}>
                  <IconComponent className="w-4 h-4" />
                </div>
                <div className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">{item.label}</div>
                <div className="text-sm font-bold text-white">{item.value}</div>
              </div>
            );
          })}
        </div>




      </motion.div>
    </SectionWrapper>
  );
};

export default function PersonalizedQuotePage() {
  const [, params] = useRoute('/quote-link/:slug');
  const [, setLocation] = useLocation();
  const { toast } = useToast();





  const [selectedEEEPackage, setSelectedEEEPackage] = useState<EEEPackageTier | null>(null);
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]); // Shared: tracks selected extras for both Simple and HHH modes
  // const [timeLeft, setTimeLeft] = useState(15 * 60); // REMOVED: Managed by CountdownTimer now
  const [hasBooked, setHasBooked] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  const [hasReserved, setHasReserved] = useState(false); // Track if user clicked "Book Now"

  // [RAMANUJAM] Productization choices for BUSY_PRO segment
  const [timingChoice, setTimingChoice] = useState<'this_week' | 'next_week'>('this_week'); // Default to this week (premium option)
  const [whileImThereBundle, setWhileImThereBundle] = useState<'none' | 'quick' | 'small' | 'half_hour'>('none'); // "While I'm There" task bundle
  const [hasApprovedProduct, setHasApprovedProduct] = useState(false); // Track if user has approved the base product (shows upsells after)

  // [CALENDAR] Calendar-based scheduling state (replaces timingChoice for BUSY_PRO)
  const [schedulingTier, setSchedulingTier] = useState<SchedulingTier | null>(null);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<Date | null>(null);
  const [isWeekendBooking, setIsWeekendBooking] = useState(false);
  const [dateFee, setDateFee] = useState(0); // in pence
  const [timeSlotType, setTimeSlotType] = useState<TimeSlotType | null>(null);
  const [exactTime, setExactTime] = useState<string | null>(null);
  const [timeFee, setTimeFee] = useState(0); // in pence

  const [showSocialProof, setShowSocialProof] = useState(false); // Social proof overlay disabled elsewhere
  const [expandedTiers, setExpandedTiers] = useState<Set<EEEPackageTier>>(new Set<EEEPackageTier>(['enhanced'])); // Track which tier's "What's included" is expanded
  const [bookedLeadId, setBookedLeadId] = useState<string | null>(null); // Store lead ID after booking
  const [datePreferencesSubmitted, setDatePreferencesSubmitted] = useState(false); // Track if date preferences are submitted
  const [showPriceIncreaseNotice, setShowPriceIncreaseNotice] = useState(false); // Show banner when prices increased
  const [isQuoteExpiredOnLoad, setIsQuoteExpiredOnLoad] = useState(false); // Track if quote was expired when loaded
  const [paymentMode, setPaymentMode] = useState<'full' | 'installments'>('full'); // Track payment mode selection - default to full
  const [expandedMobileCard, setExpandedMobileCard] = useState<EEEPackageTier | null>(null); // Track which mobile card is expanded (accordion) - all start collapsed
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined); // Track selected date from mobile dateselect
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<'AM' | 'PM' | undefined>(undefined); // Track selected time slot (AM/PM)
  const [isExpiredState, setIsExpiredState] = useState(false); // Track visual expiration state
  const [showPaymentForm, setShowPaymentForm] = useState(false); // Controls visibility of the payment section

  // Cinematic Intro State
  const [showCinematicIntro, setShowCinematicIntro] = useState(false);
  const [introDismissed, setIntroDismissed] = useState(false);

  // Phase 4: Scroll Phase Logic for Sticky CTA
  const [scrollPhase, setScrollPhase] = useState<'early' | 'mid' | 'late'>('early');
  const [hasViewedPackages, setHasViewedPackages] = useState(false);
  const { scrollY } = useScroll();

  useEffect(() => {
    return scrollY.onChange((latest) => {
      // Trigger when the user scrolls past the ENTIRE packages section
      // This ensures they see ALL options (including Elite) before the "Secure Slot" sticky appears
      // Critical for mobile where cards are stacked.
      const packagesSection = document.getElementById('packages-section');

      let triggerPoint = 2000; // Default fallback

      if (packagesSection) {
        // Formula: Section Top + Section Height - Window Height (bottom of section entering view)
        triggerPoint = packagesSection.offsetTop + packagesSection.offsetHeight - window.innerHeight;
        // Safety: Ensure triggerPoint is at least some distance down, or default to fallback if calculation is weird
        if (triggerPoint < 500) triggerPoint = 500;
      }

      // Latch visibility once passed trigger point (and ensure we have scrolled at least a bit)
      if (latest > triggerPoint && latest > 100 && !hasViewedPackages) {
        setHasViewedPackages(true);
      }

      if (latest < triggerPoint) setScrollPhase('early');
      else if (latest < triggerPoint + 600) setScrollPhase('mid');
      else setScrollPhase('late');
    });
  }, [scrollY, hasViewedPackages]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const dateSelectionRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to date selection form after booking
  useEffect(() => {
    if (hasBooked && !datePreferencesSubmitted && bookedLeadId && dateSelectionRef.current) {
      // Small delay to ensure the form is rendered
      setTimeout(() => {
        dateSelectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  }, [hasBooked, datePreferencesSubmitted, bookedLeadId]);

  // Fetch personalized quote data
  const { data: quote, isLoading, error } = useQuery<PersonalizedQuote>({
    queryKey: ['/api/personalized-quotes', params?.slug],
    queryFn: async () => {
      const response = await fetch(`/api/personalized-quotes/${params?.slug}`);

      // Handle expired quote (410 Gone)
      if (response.status === 410) {
        const errorData = await response.json();
        if (errorData.expired === true) {
          setIsQuoteExpiredOnLoad(true);
          throw new Error('QUOTE_EXPIRED');
        }
      }

      if (!response.ok) {
        throw new Error('Quote not found');
      }
      return response.json();
    },
    enabled: !!params?.slug,
    retry: (failureCount, error) => {
      // Don't retry if quote is expired
      if (error.message === 'QUOTE_EXPIRED') {
        return false;
      }
      return failureCount < 3;
    },
  });

  // Effect to check if cinematic intro should be shown
  useEffect(() => {
    if (quote?.proposalModeEnabled && !introDismissed) {
      setShowCinematicIntro(true);
    }
  }, [quote, introDismissed]);

  // Hydrate selectedExtras from quote.selectedExtras (for admin-preselected extras)
  useEffect(() => {
    if (quote?.selectedExtras && quote.selectedExtras.length > 0) {
      setSelectedExtras(quote.selectedExtras);
    }
  }, [quote?.id]); // Only run when quote ID changes (quote loaded)

  // Timer logic moved to CountdownTimer component to prevent re-renders

  // Auto-scroll to Enhanced package on mount - OPTIMIZED
  useEffect(() => {
    if (quote && scrollContainerRef.current) {
      // Use requestAnimationFrame to wait for layout paint
      requestAnimationFrame(() => {
        const enhancedCard = scrollContainerRef.current?.querySelector('[data-testid="package-enhanced"]');
        if (enhancedCard) {
          // Check if already visible to avoid unnecessary reflow
          const cardRect = enhancedCard.getBoundingClientRect();
          const containerRect = scrollContainerRef.current!.getBoundingClientRect();

          // Only scroll if significantly off-center (optional optimization, but good for stability)
          const containerCenter = containerRect.width / 2;
          const cardCenter = cardRect.width / 2;
          const scrollOffset = cardRect.left - containerRect.left - containerCenter + cardCenter;

          scrollContainerRef.current?.scrollBy({
            left: scrollOffset,
            behavior: 'smooth' // Smooth often looks better and can be less jarring than instant
          });
        }
      });
    }
  }, [quote]);

  // Sync hasReserved with showPaymentForm
  useEffect(() => {
    if (hasReserved) {
      setShowPaymentForm(true);
    }
  }, [hasReserved]);

  // Rehydrate booking state from sessionStorage (handle page refresh)
  useEffect(() => {
    if (!params?.slug) return;

    const prefix = `quote_${params.slug}`;
    const storedHasBooked = sessionStorage.getItem(`${prefix}_hasBooked`);
    const storedLeadId = sessionStorage.getItem(`${prefix}_bookedLeadId`);
    const storedDatePrefsSubmitted = sessionStorage.getItem(`${prefix}_datePreferencesSubmitted`);

    if (storedHasBooked === 'true') {
      setHasBooked(true);
    }
    if (storedLeadId) {
      setBookedLeadId(storedLeadId);
    }
    if (storedDatePrefsSubmitted === 'true') {
      setDatePreferencesSubmitted(true);
    }
  }, [params?.slug]);

  // Date preferences submission handler
  const handleDatePreferencesSubmit = async (preferences: Array<{ preferredDate: string; timeSlot: 'AM' | 'PM'; preferenceOrder: number }>) => {
    if (!bookedLeadId) {
      toast({
        title: 'Error',
        description: 'Booking information is missing. Please contact us.',
        variant: 'destructive',
      });
      throw new Error('Missing lead ID');
    }

    if (!params?.slug) {
      throw new Error('Missing quote slug');
    }

    try {
      // Preferences already include preferenceOrder, preferredDate, and timeSlot from DateSelectionForm
      // No transformation needed - pass directly to API
      const response = await fetch(`/api/leads/${bookedLeadId}/date-preferences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to save date preferences');
      }

      // Only mark success if API call succeeded
      const prefix = `quote_${params.slug}`;
      setDatePreferencesSubmitted(true);
      sessionStorage.setItem(`${prefix}_datePreferencesSubmitted`, 'true');

      toast({
        title: 'Dates Submitted',
        description: 'Your preferred dates have been saved successfully!',
      });
    } catch (error: any) {
      console.error('Error submitting date preferences:', error);
      toast({
        title: 'Submission Failed',
        description: error.message || 'Failed to save your date preferences. Please try again.',
        variant: 'destructive',
      });
      throw error; // Re-throw so DateSelectionForm can handle the error state
    }
  };

  // Map EEE tier to H/HH/HHH tier for DateSelectionForm
  const mapTierToHHH = (tier: EEEPackageTier): 'H' | 'HH' | 'HHH' => {
    const tierMap: Record<EEEPackageTier, 'H' | 'HH' | 'HHH'> = {
      essential: 'H',
      enhanced: 'HH',
      elite: 'HHH',
    };
    return tierMap[tier];
  };

  /* REMOVED: formatTime moved to CountdownTimer */

  const formatPrice = (priceInPence: number) => {
    return Math.round(priceInPence / 100);
  };

  const getCompletionDateDisplay = (completionDate: string) => {
    const labels: Record<string, string> = {
      'as-soon-as-possible': 'As soon as possible',
      'this-week': 'This week',
      'next-week': 'Next week',
      'after-hours-only': 'After-hours only (after 5pm)',
      'weekends-only': 'Weekends only',
      'no-rush': 'No rush / flexible',
    };

    // If it's a date in YYYY-MM-DD format
    if (completionDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return new Date(completionDate).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
    }

    return labels[completionDate] || completionDate;
  };

  const toggleTierExpansion = (tier: EEEPackageTier) => {
    setExpandedTiers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(tier)) {
        newSet.delete(tier);
      } else {
        newSet.add(tier);
      }
      return newSet;
    });
  };

  const handlePackageSelect = async (tier: EEEPackageTier) => {
    setSelectedEEEPackage(tier);

    // Track selection in backend
    if (quote?.id) {
      try {
        const response = await fetch(`/api/personalized-quotes/${quote.id}/track-selection`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selectedPackage: tier }),
        });

        if (!response.ok) {
          console.error('Failed to track selection:', response.status);
        }
      } catch (error) {
        console.error('Error tracking selection:', error);
      }
    }
  };

  const handleBooking = async (paymentIntentId: string) => {
    if (!quote) return;

    // Determine payment type based on current paymentMode and tier
    const isTier1 = selectedEEEPackage === 'essential';
    const effectivePaymentType = isTier1 ? 'full' : paymentMode;

    setIsBooking(true);
    try {
      // Create lead with quote data (no form required)
      const leadData = {
        customerName: quote.customerName,
        phone: quote.phone,
        email: quote.email || undefined,
        jobDescription: quote.jobDescription,
        outcome: 'phone_quote',
        eeePackage: (quote.quoteMode === 'simple' || quote.quoteMode === 'pick_and_mix') ? 'simple' : selectedEEEPackage,
        quoteAmount: (quote.quoteMode === 'simple' || quote.quoteMode === 'pick_and_mix') ? calculateSimpleTotal() : (quote[`${selectedEEEPackage}Price` as keyof PersonalizedQuote] as number),
        source: 'personalized_quote',
        stripePaymentId: paymentIntentId,
      };

      const leadResponse = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(leadData),
      });

      if (!leadResponse.ok) {
        throw new Error('Failed to create lead');
      }

      const lead: any = await leadResponse.json();

      // Store lead ID for date preferences (scoped by quote slug)
      const prefix = `quote_${params?.slug}`;
      setBookedLeadId(lead.id);
      sessionStorage.setItem(`${prefix}_bookedLeadId`, lead.id);
      sessionStorage.setItem(`${prefix}_hasBooked`, 'true');
      // Clear any existing date preferences from previous bookings
      sessionStorage.removeItem(`${prefix}_datePreferencesSubmitted`);
      setDatePreferencesSubmitted(false);

      // Track booking with mode-specific data including payment type
      if (quote?.id) {
        const bookingResponse = await fetch(`/api/personalized-quotes/${quote.id}/track-booking`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leadId: lead.id,
            selectedPackage: (quote.quoteMode === 'simple' || quote.quoteMode === 'pick_and_mix') ? undefined : selectedEEEPackage,
            selectedExtras: selectedExtras.length > 0 ? selectedExtras : undefined,
            paymentType: effectivePaymentType,
            // [RAMANUJAM] Include BUSY_PRO productization choices
            timingChoice: quote.segment === 'BUSY_PRO' ? timingChoice : undefined,
            whileImThereBundle: quote.segment === 'BUSY_PRO' ? whileImThereBundle : undefined,
          }),
        });

        if (!bookingResponse.ok) {
          console.error('Failed to track booking:', bookingResponse.status);
        }
      }

      setHasBooked(true);
      setIsBooking(false);
    } catch (error) {
      console.error('Error booking:', error);
      toast({
        title: 'Booking Failed',
        description: 'Something went wrong. Please try calling us directly.',
        variant: 'destructive',
      });
      setIsBooking(false);
    }
  };

  if (isLoading) {
    return <QuoteSkeleton />;
  }

  // If quote expired on load, show expired popup
  if (isQuoteExpiredOnLoad && params?.slug) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800">
        <QuoteExpiredPopup />
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 flex items-center justify-center p-4">
        <Card className="max-w-md bg-gray-800 border-gray-700">
          <CardContent className="p-8 text-center">
            <h2 className="text-2xl font-bold mb-4 text-white">Quote Not Found</h2>
            <p className="text-gray-300">This quote link is invalid or has expired.</p>
          </CardContent>
        </Card>
      </div>
    );
  }


  // Route to appropriate quote UI based on recommendedRoute
  const routeType = quote.recommendedRoute || 'tiers'; // Default to tiers for backward compatibility

  // Instant Action Route - Simple fixed-price UI for commodity tasks
  if (routeType === 'instant') {
    return <InstantActionQuote quote={quote} />;
  }

  // Expert Assessment Route - Diagnostic/consultation booking UI
  if (routeType === 'assessment') {
    return <ExpertAssessmentQuote quote={quote} />;
  }

  // Service Tiers Route - Existing HHH tiers UI (default)
  // Continue with existing PersonalizedQuotePage rendering below...

  // [DEBUG] Log all conditions for BUSY_PRO feature overrides
  console.log('[QUOTE DEBUG] =====================================');
  console.log('[QUOTE DEBUG] segment:', quote.segment);
  console.log('[QUOTE DEBUG] proposalModeEnabled:', quote.proposalModeEnabled);
  console.log('[QUOTE DEBUG] quoteMode:', quote.quoteMode);
  console.log('[QUOTE DEBUG] recommendedRoute:', quote.recommendedRoute);
  console.log('[QUOTE DEBUG] For BUSY_PRO overrides, need: segment=BUSY_PRO, proposalModeEnabled=true, quoteMode=hhh');
  console.log('[QUOTE DEBUG] =====================================');

  // Check if quote has expired (initial check only, mostly visual now via component)
  // const [isExpiredState, setIsExpiredState] = useState(false); // MOVED TO TOP
  // [STRATEGY] BUSY_PRO: Never expire. Treat as "Live Availability" to reduce friction.
  const isActuallyExpired = quote.segment !== 'BUSY_PRO' && (isQuoteExpiredOnLoad || isExpiredState || (quote?.expiresAt && new Date(quote.expiresAt) < new Date()));

  // Create packages array safely checking for existence of each tier
  const packages: EEEPackage[] = [];
  if (quote.quoteMode === 'hhh') {
    if (quote.essentialPrice !== null && quote.essentialPrice !== undefined) {
      packages.push({
        tier: 'essential',
        name: quote.essential?.name || 'Handy Fix',
        price: quote.essentialPrice,
        warrantyMonths: 1,
        description: quote.essential?.description || 'Good & Reliable',
      });
    }
    if (quote.enhancedPrice !== null && quote.enhancedPrice !== undefined) {
      packages.push({
        tier: 'enhanced',
        name: quote.hassleFree?.name || 'Hassle-Free',
        price: quote.enhancedPrice,
        warrantyMonths: 6,
        description: quote.hassleFree?.description || 'Priority & Convenience',
        isPopular: true,
      });
    }
    if (quote.elitePrice !== null && quote.elitePrice !== undefined) {
      packages.push({
        tier: 'elite',
        name: quote.highStandard?.name || 'High Speed',
        price: quote.elitePrice,
        warrantyMonths: 12,
        description: quote.highStandard?.description || 'Fastest & Most Premium',
      });
    }
  }

  // [RAMANUJAM PRINCIPLE] Productize BY segment, NOT tier ONE product
  // Each segment sees ONLY their product, not 3 arbitrary tiers to choose from
  const getProductsForSegment = (segment: string | undefined, allPackages: EEEPackage[]): EEEPackage[] => {
    if (!segment || allPackages.length === 0) return allPackages;

    switch (segment) {
      case 'BUSY_PRO':
        // ONLY show Priority Service (enhanced tier)
        return allPackages
          .filter(pkg => pkg.tier === 'enhanced')
          .map(pkg => ({
            ...pkg,
            name: "Priority Service",
            description: "For busy professionals who value speed and convenience",
            isPopular: true,
          }));

      case 'PROP_MGR':
        // Single product: Job price with PM-friendly service
        // Partner Program is a retention upsell AFTER first job, not on quote
        return allPackages
          .filter(pkg => pkg.tier === 'enhanced')
          .map(pkg => ({
            ...pkg,
            name: "Property Service",
            description: "Fast turnaround, tenant coordination available",
            isPopular: true,
          }));

      case 'SMALL_BIZ':
        // ONLY show After-Hours Service (enhanced tier)
        return allPackages
          .filter(pkg => pkg.tier === 'enhanced')
          .map(pkg => ({
            ...pkg,
            name: "After-Hours Service",
            description: "Zero disruption to your business",
            isPopular: true,
          }));

      case 'DIY_DEFERRER':
        // ONLY show Batch Service (essential tier with value framing)
        return allPackages
          .filter(pkg => pkg.tier === 'essential')
          .map(pkg => ({
            ...pkg,
            name: "Batch Service",
            description: "Get multiple jobs done efficiently",
            isPopular: true,
          }));

      case 'BUDGET':
        // ONLY show Standard Service (essential tier)
        return allPackages
          .filter(pkg => pkg.tier === 'essential')
          .map(pkg => ({
            ...pkg,
            name: "Standard Service",
            description: "Quality work at fair pricing",
            isPopular: true,
          }));

      case 'OLDER_WOMAN':
        // Show all 3 tiers with Peace of Mind (enhanced) as anchor
        // Trust & safety focused naming
        return allPackages.map(pkg => {
          if (pkg.tier === 'enhanced') {
            return {
              ...pkg,
              name: "Peace of Mind",
              description: "Trusted, vetted & reliable service",
              isPopular: true,
            };
          } else if (pkg.tier === 'essential') {
            return {
              ...pkg,
              name: "Standard Service",
              description: "Quality work at a fair price",
            };
          } else if (pkg.tier === 'elite') {
            return {
              ...pkg,
              name: "VIP Service",
              description: "Premium care with extra attention",
            };
          }
          return pkg;
        });

      default:
        // Fallback: show all tiers for unknown/legacy segments
        return allPackages;
    }
  };

  // Apply segment-based product filtering
  const packagesToShow = getProductsForSegment(quote.segment, packages);

  // [DEBUG] Log filtering results
  console.log('[PRODUCTIZATION] Segment:', quote.segment);
  console.log('[PRODUCTIZATION] All packages:', packages.length);
  console.log('[PRODUCTIZATION] Filtered packages to show:', packagesToShow.length);
  console.log('[PRODUCTIZATION] Package names:', packagesToShow.map(p => p.name));

  // Calculate total for simple mode (with Bundle & Save logic for Pick & Mix)
  const calculateSimpleTotal = () => {
    // For Pick & Mix, ignore basePrice (strict itemization)
    const base = quote.quoteMode === 'pick_and_mix' ? 0 : (quote.basePrice || 0);

    const extrasTotal = selectedExtras.reduce((sum, extraLabel) => {
      const extra = quote.optionalExtras?.find(e => e.label === extraLabel);
      return sum + (extra?.priceInPence || 0);
    }, 0);

    const subtotal = base + extrasTotal;

    // Apply Bundle & Save Discounts for Pick & Mix
    if (quote.quoteMode === 'pick_and_mix') {
      const itemCount = selectedExtras.length;
      let discountMultiplier = 1;

      if (itemCount >= 3) {
        discountMultiplier = 0.90; // 10% off
      } else if (itemCount === 2) {
        discountMultiplier = 0.95; // 5% off
      }

      return Math.round(subtotal * discountMultiplier);
    }

    return subtotal;
  };

  // Helper to get raw subtotal (before discount) for display
  const calculateSubtotal = () => {
    const base = quote.quoteMode === 'pick_and_mix' ? 0 : (quote.basePrice || 0);
    const extrasTotal = selectedExtras.reduce((sum, extraLabel) => {
      const extra = quote.optionalExtras?.find(e => e.label === extraLabel);
      return sum + (extra?.priceInPence || 0);
    }, 0);
    return base + extrasTotal;
  };

  // Helper to get discount amount
  const calculateDiscountAmount = () => {
    if (quote.quoteMode !== 'pick_and_mix') return 0;
    const subtotal = calculateSubtotal();
    const finalTotal = calculateSimpleTotal();
    return subtotal - finalTotal;
  };

  // [RAMANUJAM] Calculate BUSY_PRO productization adjustments
  const calculateBusyProAdjustments = () => {
    if (quote.segment !== 'BUSY_PRO') return { schedulingFee: 0, bundlePrice: 0 };

    // [CALENDAR] Use calendar-based scheduling fees (date + time combined)
    const schedulingFee = dateFee + timeFee;

    // "While I'm There" bundle pricing
    const bundlePrices = {
      none: 0,
      quick: 2000,      // £20
      small: 4500,      // £45
      half_hour: 7500   // £75
    };
    const bundlePrice = bundlePrices[whileImThereBundle] || 0;

    return { schedulingFee, bundlePrice };
  };

  // Shared helper: Calculate deposit amount (100% materials + 30% labour)
  const calculateDeposit = (baseTierPrice: number): number => {
    // Calculate extras pricing
    const extrasTotal = selectedExtras.reduce((sum, extraLabel) => {
      const extra = quote.optionalExtras?.find(e => e.label === extraLabel);
      return sum + (extra?.priceInPence || 0);
    }, 0);

    const extrasMaterials = selectedExtras.reduce((sum, extraLabel) => {
      const extra = quote.optionalExtras?.find(e => e.label === extraLabel);
      return sum + (extra?.materialsCostInPence || 0);
    }, 0);

    // Total job price = base tier + all extras
    const totalJobPrice = baseTierPrice + extrasTotal;

    // Total materials = base materials + extras materials
    const baseMaterials = quote.materialsCostWithMarkupPence || 0;
    const totalMaterials = baseMaterials + extrasMaterials;

    // Total labour = total job minus materials
    const totalLabour = totalJobPrice - totalMaterials;

    // Deposit = 100% materials + 30% of labour
    return Math.round(totalMaterials + (totalLabour * 0.30));
  };

  const toggleExtra = (label: string) => {
    setSelectedExtras(prev =>
      prev.includes(label)
        ? prev.filter(l => l !== label)
        : [...prev, label]
    );
  };

  // Get display name for package tier
  const getPackageDisplayName = (tier: EEEPackageTier): string => {
    const pkg = packages.find(p => p.tier === tier);
    return pkg?.name || tier;
  };

  // Generate job-specific top line from tasks array
  const getJobTopLine = (): string => {
    if (quote?.jobs && Array.isArray(quote.jobs) && quote.jobs.length > 0) {
      const tasks: string[] = [];
      quote.jobs.forEach((job) => {
        if (job.tasks && Array.isArray(job.tasks)) {
          job.tasks.forEach((task) => {
            const taskDesc = task.deliverable || task.description;
            if (taskDesc) {
              tasks.push(taskDesc);
            }
          });
        }
      });

      if (tasks.length === 1) {
        return tasks[0];
      } else if (tasks.length === 2) {
        return `${tasks[0]} and ${tasks[1]}`;
      } else if (tasks.length > 2) {
        return `${tasks.slice(0, -1).join(', ')}, and ${tasks[tasks.length - 1]}`;
      }
    }
    return quote?.jobDescription || 'Your handyman job';
  };

  // SKIN CONFIG based on clientType
  const clientType = quote?.clientType || 'residential';
  const config = SKIN_CONFIG[clientType as keyof typeof SKIN_CONFIG] || SKIN_CONFIG.residential;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#7DB00E] animate-spin" />
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-6 text-center">
        <h1 className="text-2xl font-bold text-white mb-4">Quote not found</h1>
        <p className="text-gray-400 mb-8">This quote may have expired or the link is incorrect.</p>
        <Button onClick={() => setLocation('/')}>Back to Home</Button>
      </div>
    );
  }


  // --- RENDER LOGIC ---

  // Weighted Scroll Layout (for proposalModeEnabled)
  if (quote.proposalModeEnabled) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans selection:bg-[#7DB00E] selection:text-white relative text-slate-900">
        {isActuallyExpired && <QuoteExpiredPopup />}

        {/* Value Sections Flow */}
        <ValueHero quote={quote} config={config} />

        {/* Unified Social Proof Section - Same for all segments */}
        <ValueSocialProof quote={quote} />

        <ValueGuarantee quote={quote} config={config} />


        {/* The Final Reveal: Quote Section */}
        <section id="packages-section" className="min-h-screen bg-slate-50 pt-20 pb-40 px-4 md:px-6 lg:px-8 relative overflow-visible">
          <div className="w-full max-w-full">
            <motion.div
              initial={{ opacity: 0, y: 50 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 1 }}
              viewport={{ once: true, margin: "-100px" }}
              className="space-y-12"
            >
              <div className="text-center space-y-4">

                {/* Pay in 3 Banner - Top Placement */}
                <div className="rounded-xl overflow-hidden shadow-sm border border-slate-200 mb-8 max-w-lg mx-auto transform -rotate-1 hover:rotate-0 transition-transform duration-300">
                  <img src={payIn3PromoImage} className="w-full h-auto object-cover" alt="Pay in 3 Interest Free" />
                </div>

                <div>
                  <h3 className="text-xl md:text-2xl font-bold text-slate-500 mb-2">We can't work with everyone,</h3>
                  <h2 className="text-4xl md:text-6xl font-extrabold tracking-tight text-[#1D2D3D]">Secure Your Slot?</h2>
                </div>
                <p className="text-slate-600 text-lg max-w-2xl mx-auto">Based on quality materials and insured labour, here's what proper workmanship costs:</p>

                {/* Price Confidence Statement */}
                <div className="max-w-lg mx-auto mt-6 bg-white border border-slate-200 p-5 rounded-xl shadow-sm">
                  <p className="text-slate-700 text-lg italic font-light leading-relaxed">
                    "We won't be the cheapest quote you get.
                    <br />
                    <span className="text-[#1D2D3D] font-medium">We will be the last one you need.</span>"
                  </p>
                </div>


              </div>

              {/* Expert Sticky Note integration */}
              {quote.quoteMode !== 'simple' && (
                <>
                  {/* PDF Download Button */}
                  <div className="flex justify-end mb-2 px-2 md:px-0">
                    <button
                      onClick={() => generateQuotePDF({
                        quoteId: quote.id,
                        customerName: quote.customerName || 'Customer',
                        address: quote.address,
                        postcode: quote.postcode,
                        jobDescription: getExpertNoteText(quote as any),
                        priceInPence: packagesToShow[0]?.price || 0,
                        segment: quote.segment || undefined,
                        validityHours: 48,
                        createdAt: quote.createdAt ? new Date(quote.createdAt) : new Date(),
                      })}
                      className="flex items-center gap-2 text-sm text-slate-500 hover:text-[#7DB00E] transition-colors px-3 py-1.5 rounded-lg hover:bg-slate-100"
                    >
                      <Download className="w-4 h-4" />
                      <span>Download PDF</span>
                    </button>
                  </div>

                  <ExpertSpecSheet
                    text={getExpertNoteText(quote as any)}
                    customerName={quote.customerName || ''}
                    address={quote.address || quote.postcode}
                    mikePhotoUrl={mikeProfilePhoto}
                    className="mt-6 md:mt-0 transition-transform duration-300"
                  >
                    {quote.quoteMode === 'hhh' && packagesToShow.length > 0 && (
                      <div className="space-y-8">
                        {/* [RAMANUJAM] Unified Quote Card for segments with single-product flow */}
                        {['BUSY_PRO', 'BUDGET', 'OLDER_WOMAN', 'DIY_DEFERRER', 'SMALL_BIZ', 'PROP_MGR'].includes(quote.segment || '') ? (
                          <Elements stripe={stripePromise}>
                            <UnifiedQuoteCard
                              segment={quote.segment || 'BUDGET'}
                              basePrice={packagesToShow[0]?.price || 0}
                              customerName={quote.customerName}
                              customerEmail={quote.email || undefined}
                              quoteId={quote.id}
                              jobDescription={quote.jobDescription}
                              location={quote.postcode?.split(' ')[0]}
                              optionalExtras={quote.optionalExtras}
                              isBooking={isBooking}
                              onBook={async (config) => {
                                setIsBooking(true);
                                setSelectedEEEPackage(quote.segment === 'BUDGET' ? 'essential' : 'enhanced');
                                setHasApprovedProduct(true);
                                if (config.selectedDate) {
                                  setSelectedCalendarDate(config.selectedDate);
                                }
                                if (config.timeSlot) {
                                  setTimeSlotType(config.timeSlot as TimeSlotType);
                                }

                                // Map add-ons to bundle type
                                if (config.addOns.includes('quick_task')) {
                                  setWhileImThereBundle('quick');
                                }

                                // Show payment form (for non-flexible timing)
                                if (!config.usedDownsell) {
                                  setShowPaymentForm(true);
                                  setTimeout(() => {
                                    document.getElementById('payment-section')?.scrollIntoView({
                                      behavior: 'smooth',
                                      block: 'start'
                                    });
                                  }, 100);
                                }
                                setIsBooking(false);
                              }}
                              onPaymentSuccess={async (paymentIntentId) => {
                                // Handle successful inline payment (flexible timing)
                                await handleBooking(paymentIntentId);
                              }}
                            />
                          </Elements>
                        ) : (
                          <>
                            {/* Original package cards for other segments */}
                            {/* Payment Mode Toggle */}
                            <div className="flex items-center justify-center mb-6">
                              <PaymentToggle
                                paymentMode={paymentMode}
                                setPaymentMode={setPaymentMode}
                                theme="light"
                                size="default"
                              />
                            </div>

                            {/* HHH Mode: Packages List - Responsive */}

                            {/* Mobile View: Accordion-style compact cards */}
                            <div className="md:hidden space-y-3">
                              {packagesToShow.map((pkg) => {
                                let rawFeatures = quote.tierDeliverables?.[pkg.tier === 'essential' ? 'essential' : pkg.tier === 'enhanced' ? 'hassleFree' : 'highStandard'] ||
                                  getPerksForTier(quote, pkg.tier as 'essential' | 'enhanced' | 'elite');

                                // Apply segment-specific feature overrides
                                // NOTE: With segment-based filtering, each segment only sees ONE package now
                                const getFutureDate = (days: number) => {
                                  const date = new Date();
                                  date.setDate(date.getDate() + days);
                                  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
                                };

                                // Customize features for BUSY_PRO (will only be 'enhanced' tier due to filtering)
                                if (quote.segment === 'BUSY_PRO') {
                                  rawFeatures = [
                                    `⚡ Guaranteed Slot: ${getFutureDate(4)}`,
                                    "⏱️ Precise 1-Hour Arrival Window",
                                    "🛡️ 90-day workmanship guarantee",
                                    "📞 Direct specialist contact number",
                                    "📅 Evening & Weekend slots available",
                                    "✨ Full cleanup & waste removal"
                                  ];
                                } else if (quote.segment === 'PROP_MGR') {
                                  // PROP_MGR: Single product - job-focused
                                  rawFeatures = [
                                    "⚡ Scheduled within 48-72 hours",
                                    "📸 Photo report on completion",
                                    "🔑 Tenant coordination available",
                                    "📄 Invoice emailed same day",
                                    "✨ Full cleanup included"
                                  ];
                                }

                                const features = Array.isArray(rawFeatures) ? rawFeatures : [];
                                const installmentAmount = pkg.tier === 'essential' ? null : Math.round(pkg.price / 3);
                                const showInstallments = paymentMode === 'installments' && installmentAmount;
                                const isTier1 = pkg.tier === 'essential';

                                return (
                                  <MobilePricingCard
                                    key={pkg.tier}
                                    tier={pkg.tier}
                                    name={pkg.name}
                                    price={pkg.price}
                                    tagline={pkg.description}
                                    features={features}
                                    keyFeatures={getKeyFeaturesForTier(pkg.tier)}
                                    nextAvailableDate={getNextAvailableDate(pkg.tier)}
                                    dateSelectionStartDate={getDateSelectionStartDate(pkg.tier)}
                                    isRecommended={pkg.tier === 'enhanced'}
                                    isPremium={pkg.tier === 'elite'}
                                    isExpanded={expandedMobileCard === pkg.tier}
                                    isSelected={selectedEEEPackage === pkg.tier}
                                    onToggleExpand={() => {
                                      setExpandedMobileCard(expandedMobileCard === pkg.tier ? null : pkg.tier);
                                      // Scroll card into view on expand
                                      if (expandedMobileCard !== pkg.tier) {
                                        setTimeout(() => {
                                          document.getElementById(`mobile-card-${pkg.tier}`)?.scrollIntoView({
                                            behavior: 'smooth',
                                            block: 'start'
                                          });
                                        }, 100);
                                      }
                                    }}
                                    onSelect={() => {
                                      if (!isTier1 || paymentMode !== 'installments') {
                                        setSelectedEEEPackage(pkg.tier);
                                      }
                                    }}
                                    onDateSelect={(date) => setSelectedDate(date)}
                                    selectedDate={selectedDate}
                                    paymentMode={paymentMode}
                                    installmentPrice={showInstallments ? installmentAmount : undefined}
                                  />
                                );
                              })}
                            </div>

                            {/* Desktop View: Existing grid cards */}
                            {/* Dynamic grid: centers when 1 package, spreads when multiple */}
                            <div className={`hidden md:grid md:gap-6 md:items-start ${packagesToShow.length === 1 ? 'md:grid-cols-1 max-w-md mx-auto' : packagesToShow.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
                              {packagesToShow.map((pkg) => {
                                let rawFeatures = quote.tierDeliverables?.[pkg.tier === 'essential' ? 'essential' : pkg.tier === 'enhanced' ? 'hassleFree' : 'highStandard'] ||
                                  getPerksForTier(quote, pkg.tier as 'essential' | 'enhanced' | 'elite');

                                // [STRATEGY] Productize BY Segment (Ramanujam)
                                // Each segment sees ONLY their product, not multiple tiers
                                // Feature customization per segment
                                const getFutureDate = (days: number) => {
                                  const date = new Date();
                                  date.setDate(date.getDate() + days);
                                  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
                                };

                                // BUSY_PRO: Only sees Priority Service (filtered to 'enhanced' tier)
                                if (quote.segment === 'BUSY_PRO') {
                                  rawFeatures = [
                                    `⚡ Guaranteed Slot: ${getFutureDate(4)}`,
                                    "⏱️ Precise 1-Hour Arrival Window",
                                    "🛡️ 90-day workmanship guarantee",
                                    "📞 Direct specialist contact number",
                                    "📅 Evening & Weekend slots available",
                                    "✨ Full cleanup & waste removal"
                                  ];
                                } else if (quote.segment === 'PROP_MGR') {
                                  // PROP_MGR: Single product - job-focused
                                  pkg.name = "Property Service";
                                  rawFeatures = [
                                    "⚡ Scheduled within 48-72 hours",
                                    "📸 Photo report on completion",
                                    "🔑 Tenant coordination available",
                                    "📄 Invoice emailed same day",
                                    "✨ Full cleanup included"
                                  ];
                                } else if (quote.segment === 'OLDER_WOMAN') {
                                  if (pkg.tier === 'enhanced') {
                                    // PRIORITY = Helpfulness + Safety
                                    pkg.name = "Peace of Mind";
                                    rawFeatures = [
                                      "⏱️ Exact Arrival Appointment (No waiting)",
                                      "🛋️ Assistance Moving Furniture",
                                      "💡 10-min 'Helpful Hand' (Lightbulbs etc)",
                                      "📄 Paper Invoice Provided",
                                      "✨ Full Cleanup & Waste Removal",
                                      "🛡️ 12-Month Warranty"
                                    ];
                                  } else if (pkg.tier === 'elite') {
                                    // ELITE = VIP
                                    pkg.name = "VIP Service";
                                    rawFeatures = [
                                      "🚀 Immediate Priority Booking",
                                      "💬 Dedicated Office Contact",
                                      "🛡️ Extended 2-Year Warranty",
                                      "📹 Video Confirmation for Family",
                                      "✨ Deep Clean of Work Area",
                                      "🎁 Seasonal Maintenance Check"
                                    ];
                                  } else if (pkg.tier === 'essential') {
                                    // STANDARD
                                    pkg.name = "Standard Service";
                                    rawFeatures = [
                                      `Available from ${getFutureDate(14)}`,
                                      "Standard Arrival Window",
                                      "Quality Workmanhip",
                                      "Cleanup Included",
                                      "Digital Invoice Only"
                                    ];
                                  }
                                }

                                // [STRATEGY] Emoji Stripper: Regex to remove emoji characters from features
                                // [STRATEGY] Emoji Stripper: Safer regex for broad compatibility
                                const stripEmojis = (str: string) => {
                                  try {
                                    // Simply remove everything that isn't ASCII text, numbers, punctuation, or common symbols
                                    // This is safer than targetting specific emoji ranges which varies by browser/engine
                                    return str.replace(/[^\x00-\x7F\u00A0-\u00FF]/g, '').trim().replace(/\s\s+/g, ' ');
                                  } catch (e) {
                                    return str;
                                  }
                                };

                                // Icon mapping for BUSY_PRO features (high quality Lucide icons)
                                const getFeatureIcon = (feature: string): React.ComponentType<{ className?: string }> => {
                                  const f = feature.toLowerCase();
                                  if (f.includes('arrival') || f.includes('window') || f.includes('time')) return Clock;
                                  if (f.includes('scheduling') || f.includes('week') || f.includes('slot')) return Calendar;
                                  if (f.includes('photo') || f.includes('video')) return Camera;
                                  if (f.includes('guarantee') || f.includes('warranty')) return Shield;
                                  if (f.includes('contact') || f.includes('whatsapp') || f.includes('phone')) return Phone;
                                  if (f.includes('small fix') || f.includes('fixes')) return Wrench;
                                  if (f.includes('cleanup') || f.includes('clean')) return Sparkles;
                                  if (f.includes('quality') || f.includes('workmanship')) return Award;
                                  if (f.includes('48-hour') || f.includes('asap') || f.includes('express')) return Zap;
                                  if (f.includes('materials')) return Package;
                                  return Check; // Default fallback
                                };

                                const features = Array.from(new Set((rawFeatures || []).map(f => typeof f === 'string' ? stripEmojis(f) : f)));
                                const isExpanded = expandedTiers.has(pkg.tier);
                                // Show all features for Enhanced (Priority) tier by default, otherwise limit to 4
                                const showAllByDefault = pkg.tier === 'enhanced';
                                const visibleFeatures = showAllByDefault || isExpanded ? features : features.slice(0, 4);
                                const hasMoreFeatures = !showAllByDefault && features.length > 4;

                                const isTier1 = pkg.tier === 'essential';
                                const isTier2or3 = pkg.tier === 'enhanced' || pkg.tier === 'elite';
                                const showInstallments = isTier2or3 && paymentMode === 'installments';

                                const extrasTotal = selectedExtras.reduce((sum, label) => {
                                  const extra = quote.optionalExtras?.find(e => e.label === label);
                                  return sum + (extra?.priceInPence || 0);
                                }, 0);

                                const baseJobPrice = pkg.price + extrasTotal;
                                const LENIENCY_FEE_RATE = 0.10;
                                const convenienceFee = showInstallments ? Math.round(baseJobPrice * LENIENCY_FEE_RATE) : 0;
                                const totalWithFee = baseJobPrice + convenienceFee;

                                const depositAmount = calculateDeposit(pkg.price);
                                const remainingBalance = Math.max(0, (showInstallments ? totalWithFee : baseJobPrice) - depositAmount);
                                const installmentAmount = Math.round(remainingBalance / 3);

                                const tierStyles = {
                                  essential: { bg: 'bg-gradient-to-br from-slate-50 via-white to-green-50/30 border-slate-200', badge: null, badgeColor: '', badgeText: '' },
                                  enhanced: { bg: 'bg-gradient-to-br from-green-100 via-emerald-50 to-white border-[#7DB00E]', badge: 'MOST POPULAR', badgeColor: 'bg-[#7DB00E]', badgeText: 'text-[#1D2D3D]' },
                                  elite: { bg: 'bg-gradient-to-br from-amber-50 via-white to-yellow-50/40 border-slate-200', badge: 'PREMIUM', badgeColor: 'bg-[#1D2D3D]', badgeText: 'text-white' }
                                };
                                const style = tierStyles[pkg.tier as keyof typeof tierStyles];
                                const isDisabled = isTier1 && paymentMode === 'installments';

                                return (
                                  <motion.div
                                    key={pkg.tier}
                                    id={`package-tier-card-${pkg.tier}`} // ID for scroll target
                                    initial={{ opacity: 0, x: -20 }}
                                    whileInView={{ opacity: 1, x: 0 }}
                                    transition={{ duration: 0.5 }}
                                    className={`relative transition-all duration-300 ${isDisabled ? 'opacity-50 pointer-events-none grayscale blur-[2px] scale-95' : ''}`}
                                  >
                                    <div id={`package-tier-card-${pkg.tier}`} className={`${style.bg} rounded-2xl overflow-hidden border ${pkg.tier === 'enhanced' ? 'border-2 shadow-2xl ring-4 ring-[#7DB00E]/20 scale-[1.05] z-10' : 'shadow-sm hover:shadow-md'} transition-all duration-300`}>
                                      {style.badge && (
                                        <div className={`${style.badgeColor} ${style.badgeText} text-center py-1.5 text-[10px] font-black tracking-wider uppercase flex justify-center items-center gap-2 whitespace-nowrap`}>
                                          {pkg.tier === 'enhanced' && <Star className="w-3 h-3 fill-current" />}
                                          {style.badge}
                                          {pkg.tier === 'enhanced' && <Star className="w-3 h-3 fill-current" />}
                                        </div>
                                      )}
                                      <div className="p-6 md:p-8">
                                        <div className="flex justify-between items-start mb-4">
                                          <div>
                                            <div className="flex items-center gap-2 mb-1">
                                              {pkg.tier === 'essential' && <Wrench className="w-4 h-4 text-slate-400" />}
                                              {pkg.tier === 'enhanced' && <Zap className="w-4 h-4 text-[#7DB00E]" />}
                                              {pkg.tier === 'elite' && <Crown className="w-4 h-4 text-amber-500" />}
                                              <h3 className="text-xl font-bold text-slate-900">{pkg.name}</h3>
                                            </div>
                                            <p className="text-slate-500 text-xs">{pkg.description}</p>
                                          </div>
                                          <div className="flex flex-col items-end gap-2">
                                            {pkg.tier === 'enhanced' && (
                                              <>
                                                <NeonBadge
                                                  text={
                                                    quote.segment === 'BUSY_PRO' ? 'Priority' :
                                                      quote.segment === 'PROP_MGR' ? 'Partner' :
                                                        quote.segment === 'SMALL_BIZ' ? 'Disruption-Free' :
                                                          'Best Value'
                                                  }
                                                  color="green"
                                                  icon={Zap}
                                                />
                                                {/* Social Proof (Decoy Effect - Cialdini 1984) */}
                                                {quote.segment === 'BUSY_PRO' ? (
                                                  <div className="flex items-center gap-1.5 bg-blue-500/20 text-blue-400 px-2 py-1 rounded-lg text-[10px] font-bold">
                                                    <User className="w-3 h-3" />
                                                    78% choose this
                                                  </div>
                                                ) : (
                                                  <div className="flex items-center gap-1.5 bg-amber-500/20 text-amber-400 px-2 py-1 rounded-lg text-[10px] font-bold">
                                                    <User className="w-3 h-3" />
                                                    Mike Recommends
                                                  </div>
                                                )}
                                              </>
                                            )}
                                            {pkg.tier === 'elite' && <NeonBadge text="Fast Track" color="amber" icon={Clock} />}
                                          </div>
                                        </div>

                                        {/* Date Slot Slider - Interactive Availability */}
                                        <div className="mb-6">
                                          <div className="flex justify-between items-baseline mb-3">
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                              {pkg.tier === 'elite' ? 'VIP Availability' : pkg.tier === 'enhanced' ? 'Priority Slots' : 'Estimated Start'}
                                            </p>
                                            {pkg.tier === 'elite' && (
                                              <span className="text-[9px] font-bold text-[#7DB00E] bg-[#7DB00E]/10 px-1.5 py-0.5 rounded-full animate-pulse">
                                                LIVE
                                              </span>
                                            )}
                                          </div>
                                          <div className="-mx-1 overflow-x-auto pb-4 pt-2 flex gap-2 no-scrollbar snap-x">
                                            {(() => {
                                              // Scarcity Logic & Extended Range
                                              const startOffset = pkg.tier === 'elite' ? 1 : pkg.tier === 'enhanced' ? 4 : 14;
                                              let currentDate = new Date();
                                              currentDate.setDate(currentDate.getDate() + startOffset);

                                              // Generate 12 days to show full scope
                                              const dates = [];
                                              let daysAdded = 0;
                                              while (daysAdded < 12) {
                                                // Handle "No Sundays" rule globally if needed, currently we skip them in loop if we want business days only
                                                // But for scarcity visuals, showing weekends as "Booked" is better for Standard tier
                                                const d = new Date(currentDate);
                                                dates.push(d);
                                                currentDate.setDate(currentDate.getDate() + 1);
                                                daysAdded++;
                                              }

                                              return dates.map((slotDate, idx) => {
                                                const isWeekend = slotDate.getDay() === 0 || slotDate.getDay() === 6;
                                                // Standard (essential) cannot book weekends
                                                const isRestrictedWeekend = pkg.tier === 'essential' && isWeekend;

                                                // Fake "Booked" status for scarcity (30% chance), but never the first slot
                                                const isFullyBooked = idx > 0 && (Math.random() < 0.3 || isRestrictedWeekend);

                                                const isAvailable = !isFullyBooked;
                                                const isSelected = idx === 0;

                                                return (
                                                  <div
                                                    key={idx}
                                                    className={`snap-start flex-shrink-0 border rounded-lg p-2 min-w-[90px] text-center relative overflow-hidden transition-all ${!isAvailable
                                                      ? 'border-slate-100 bg-slate-50 opacity-60 grayscale border-dashed'
                                                      : isSelected
                                                        ? 'border-[#7DB00E]/30 bg-[#7DB00E]/5'
                                                        : 'border-slate-100 bg-white/80'
                                                      }`}
                                                  >
                                                    <div className={`text-[10px] uppercase font-bold mb-0.5 ${!isAvailable ? 'text-slate-300' : isSelected ? 'text-[#7DB00E]' : 'text-slate-400'}`}>
                                                      {idx === 0 && pkg.tier === 'elite' ? 'Tomrw' : slotDate.toLocaleDateString('en-GB', { weekday: 'short' })}
                                                    </div>

                                                    <div className={`text-lg font-bold leading-none mb-1 ${!isAvailable ? 'text-slate-300' : isSelected ? 'text-slate-900' : 'text-slate-600'}`}>
                                                      {slotDate.getDate()}
                                                    </div>

                                                    <div className={`text-[9px] font-medium ${!isAvailable ? 'text-slate-300' : 'text-slate-400'}`}>
                                                      {!isAvailable
                                                        ? (isRestrictedWeekend ? 'Unavailable' : 'Fully Booked')
                                                        : slotDate.toLocaleDateString('en-GB', { month: 'short' })
                                                      }
                                                    </div>

                                                    {/* Strikethrough for booked dates */}
                                                    {!isAvailable && (
                                                      <div className="absolute inset-0 flex items-center justify-center">
                                                        <div className="w-full h-[1px] bg-slate-200 -rotate-12"></div>
                                                      </div>
                                                    )}
                                                  </div>
                                                );
                                              });
                                            })()}
                                          </div>
                                        </div>

                                        <div className="mb-6">
                                          <div className="flex items-baseline gap-2">
                                            <span className={`text-3xl font-bold text-slate-900`}>£{formatPrice(showInstallments ? depositAmount : pkg.price)}</span>
                                            <span className="text-slate-400 text-xs font-medium">{showInstallments ? 'deposit' : 'fixed price'}</span>
                                          </div>

                                          {/* Per-week breakdown - Only show if not installments */}
                                          {!showInstallments && (
                                            <div className="mt-1 text-slate-400/70 text-[10px]">
                                              Just £{(pkg.price / 100 / 52).toFixed(2)}/week over warranty period
                                            </div>
                                          )}

                                          {/* Warranty end date */}
                                          <div className="mt-2 flex items-center gap-1.5 text-slate-500 text-[10px]">
                                            <Shield className="w-3 h-3 text-[#7DB00E]" />
                                            <span>Covered until {format(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), 'MMMM yyyy')}</span>
                                          </div>

                                          {/* Money Back Guarantee Badge */}
                                          <div className="mt-2 flex items-center gap-1.5 text-[9px] uppercase font-bold text-[#7DB00E] bg-[#7DB00E]/10 px-2 py-1 rounded w-fit">
                                            <ShieldCheck className="w-3 h-3" />
                                            100% Money Back Guarantee
                                          </div>

                                          {/* Installments info */}
                                          {showInstallments && (
                                            <div className="mt-2 flex items-center gap-2 text-[#7DB00E] font-medium text-sm">
                                              <SiKlarna className="w-4 h-4" />
                                              <span>+ 3 payments of £{formatPrice(installmentAmount)}</span>
                                            </div>
                                          )}
                                        </div>

                                        <div className="space-y-3 mb-6">
                                          {visibleFeatures.map((f, i) => {
                                            const FeatureIcon = getFeatureIcon(f as string);
                                            return (
                                              <div key={i} className="flex gap-3 text-sm text-slate-600">
                                                <FeatureIcon className="w-4 h-4 text-[#7DB00E] mt-0.5 flex-shrink-0" />
                                                <span>{f}</span>
                                              </div>
                                            );
                                          })}
                                          {hasMoreFeatures && (
                                            <button
                                              onClick={() => setExpandedTiers(prev => {
                                                const n = new Set(prev);
                                                n.has(pkg.tier) ? n.delete(pkg.tier) : n.add(pkg.tier);
                                                return n;
                                              })}
                                              className="text-xs text-slate-400 hover:text-slate-500 underline underline-offset-4"
                                            >
                                              {isExpanded ? 'Show less' : `+${features.length - 4} more details`}
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </motion.div>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </ExpertSpecSheet>

                  {/* Status Quo Bias Trigger (Cost of Inaction) */}
                  <div className="max-w-lg mx-auto mt-0 bg-red-50 border border-red-100 p-4 rounded-lg flex items-start gap-3 text-left">
                    <div className="p-2 bg-red-100 rounded-full shrink-0">
                      <Clock className="w-4 h-4 text-red-600" />
                    </div>
                    <div>
                      <h4 className="text-red-700 font-bold text-sm uppercase mb-1">Why book now?</h4>
                      <p className="text-slate-700 text-sm leading-relaxed">
                        Only 3 slots remaining in <span className="text-slate-900 font-bold">{quote.postcode?.split(' ')[0]}</span> this week. Delaying often leads to worsening damage and higher repair costs.
                      </p>
                    </div>
                  </div>
                </>
              )}

              {/* Simple Mode: Quote Card */}
              {quote.quoteMode === 'simple' && quote.basePrice && (
                <div
                  className="bg-gradient-to-br from-[#1D2D3D] to-black rounded-3xl overflow-hidden border border-[#7DB00E]/30 shadow-2xl"
                >
                  <div className="p-8">
                    <div className="text-center mb-8">
                      <div className="inline-block bg-[#7DB00E]/20 text-[#7DB00E] border border-[#7DB00E]/30 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-4">
                        Your Quote
                      </div>
                      <div className="text-6xl font-bold text-white mb-2">
                        £{formatPrice(quote.basePrice)}
                      </div>
                      <p className="text-gray-400">All-inclusive price</p>

                      <div className="mt-3 flex justify-center">
                        <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-[#7DB00E] bg-[#7DB00E]/10 px-2 py-1 rounded w-fit">
                          <ShieldCheck className="w-3 h-3" />
                          100% Money Back Guarantee
                        </div>
                      </div>

                      {/* Toggle */}
                      <div className="flex items-center justify-center mt-4">
                        <PaymentToggle
                          paymentMode={paymentMode}
                          setPaymentMode={setPaymentMode}
                          theme="dark"
                          size="compact"
                          showTryBadge={false}
                        />
                      </div>
                    </div>

                    <div className="bg-gradient-to-br from-white/10 to-white/5 rounded-2xl p-6 mb-6 border border-white/10">
                      <h4 className="text-white font-bold mb-4 text-lg flex items-center gap-2">
                        <div className="w-1.5 h-6 bg-[#7DB00E] rounded-full"></div>
                        Scope of Works
                      </h4>
                      <div className="space-y-3">
                        {(() => {
                          const deliverables: string[] = [];
                          if (quote.jobs && Array.isArray(quote.jobs)) {
                            quote.jobs.forEach((job) => {
                              if (job.tasks && Array.isArray(job.tasks)) {
                                job.tasks.forEach((task) => {
                                  const deliverable = task.deliverable || task.description;
                                  if (deliverable) deliverables.push(deliverable);
                                });
                              }
                            });
                          }
                          const serviceGuarantees = ['Turn up on time guarantee', 'Fully insured handymen', 'Professional workmanship'];
                          const allItems = [...deliverables, ...serviceGuarantees];
                          return allItems.map((item, idx) => (
                            <div key={idx} className="flex items-start gap-3">
                              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-[#7DB00E] flex items-center justify-center mt-0.5">
                                <Check className="w-3.5 h-3.5 text-white" />
                              </div>
                              <span className="text-white text-base font-bold leading-relaxed">{item}</span>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>

                    <Button
                      onClick={() => {
                        setShowPaymentForm(true);
                        setTimeout(() => {
                          document.getElementById('confirm-button')?.scrollIntoView({ behavior: 'smooth' });
                        }, 100);
                      }}
                      className="w-full h-14 rounded-2xl font-bold text-lg bg-[#7DB00E] hover:bg-[#6da000]"
                    >
                      Accept Quote & Continue
                    </Button>
                  </div>
                </div>
              )}
            </motion.div>

            {/* [RAMANUJAM] Unified Payment Section */}
            {/* Shows after user books via UnifiedQuoteCard */}
            {['BUSY_PRO', 'BUDGET', 'OLDER_WOMAN', 'DIY_DEFERRER', 'SMALL_BIZ', 'PROP_MGR'].includes(quote.segment || '') && selectedEEEPackage && quote.quoteMode === 'hhh' && hasApprovedProduct && (
              <motion.div
                id="payment-section"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-12 space-y-8"
              >
                {/* Payment Section */}
                {showPaymentForm && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`mt-16 rounded-3xl p-8 border ${quote.clientType === 'commercial' ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200 shadow-xl'}`}
                    id="confirm-button"
                  >
                    <h3 className={`text-2xl font-bold mb-6 text-center ${quote.clientType === 'commercial' ? 'text-white' : 'text-slate-900'}`}>Complete Your Booking</h3>

                    {(() => {
                      // Theme Logic
                      const isDarkTheme = quote.clientType === 'commercial';
                      const styles = {
                        container: isDarkTheme ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200 shadow-xl',
                        label: isDarkTheme ? 'text-gray-400' : 'text-slate-500',
                        subLabel: isDarkTheme ? 'text-gray-300' : 'text-slate-600',
                        value: isDarkTheme ? 'text-white' : 'text-slate-900',
                        depositBox: 'bg-[#7DB00E]/10',
                        depositLabel: isDarkTheme ? 'text-white' : 'text-[#1D2D3D]',
                        depositValue: 'text-[#7DB00E]'
                      };

                      // For HHH mode, use selected package
                      const selectedPackage = quote.quoteMode === 'hhh' ? packages.find(p => p.tier === selectedEEEPackage) : null;

                      // For simple mode, use basePrice
                      const basePrice = quote.quoteMode === 'simple' ? (quote.basePrice || 0) : (selectedPackage?.price || 0);

                      if (quote.quoteMode === 'hhh' && !selectedPackage) return null;

                      const extrasTotal = selectedExtras.reduce((sum, label) => {
                        const extra = quote.optionalExtras?.find(e => e.label === label);
                        return sum + (extra?.priceInPence || 0);
                      }, 0);

                      // [RAMANUJAM] Add BUSY_PRO productization adjustments
                      const busyProAdjustments = calculateBusyProAdjustments();
                      const baseJobPrice = basePrice + extrasTotal + busyProAdjustments.schedulingFee + busyProAdjustments.bundlePrice;
                      const isTier1 = selectedPackage?.tier === 'essential';
                      const isInstallmentsMode = !isTier1 && paymentMode === 'installments';

                      const LENIENCY_FEE_RATE = 0.10;
                      const convenienceFee = isInstallmentsMode ? Math.round(baseJobPrice * LENIENCY_FEE_RATE) : 0;
                      const totalWithFee = baseJobPrice + convenienceFee;

                      const materialsCost = quote.materialsCostWithMarkupPence || 0;
                      const jobCostExcludingMaterials = Math.max(0, baseJobPrice - materialsCost);
                      const totalDeposit = materialsCost + Math.round(jobCostExcludingMaterials * 0.30);
                      const remainingBalance = Math.max(0, (isInstallmentsMode ? totalWithFee : baseJobPrice) - totalDeposit);
                      const monthlyInstallment = Math.round(remainingBalance / 3);

                      return (
                        <>
                          <div className={`mb-6 space-y-4 p-4 rounded-lg block ${styles.container} !p-0 !bg-transparent !border-0 !shadow-none`}>
                            {/* Note: The outer container styles are applied to the parent motion.div, we override here just in case but really we need to act on the PARENT of this h3 */}

                            {isInstallmentsMode ? (
                              <>
                                <div className="space-y-2 mb-3">
                                  <div className={`text-xs ${styles.label} mb-2`}>Deposit breakdown:</div>
                                  <div className="flex justify-between gap-4 text-sm">
                                    <span className={`${styles.subLabel}`}>Materials (100% upfront):</span>
                                    <span className={`${styles.value}`}>£{Math.round(materialsCost / 100)}</span>
                                  </div>
                                  <div className="flex justify-between gap-4 text-sm">
                                    <span className={`${styles.subLabel}`}>Labour booking fee (30%):</span>
                                    <span className={`${styles.value}`}>£{Math.round((jobCostExcludingMaterials * 0.30) / 100)}</span>
                                  </div>
                                  <div className={`flex justify-between gap-4 ${styles.depositBox} -mx-2 px-2 py-2 rounded mt-2`}>
                                    <span className={`font-bold ${styles.depositLabel}`}>Total deposit today:</span>
                                    <span className={`font-bold ${styles.depositValue} text-lg`}>£{Math.round(totalDeposit / 100)}</span>
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  <div className={`text-sm ${styles.label} mb-1`}>Then 3 monthly payments of:</div>
                                  <div className="flex justify-between gap-4 bg-gray-600/50 -mx-2 px-2 py-2 rounded">
                                    <span className="font-semibold text-white">Monthly payment:</span>
                                    <span className="font-semibold text-white text-lg">£{Math.round(monthlyInstallment / 100)}</span>
                                  </div>
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="space-y-2 mb-3">
                                  <div className={`text-xs ${styles.label} mb-2`}>Deposit breakdown:</div>
                                  <div className="flex justify-between gap-4 text-sm">
                                    <span className={`${styles.subLabel}`}>Materials (100% upfront):</span>
                                    <span className={`${styles.value}`}>£{Math.round(materialsCost / 100)}</span>
                                  </div>
                                  <div className="flex justify-between gap-4 text-sm">
                                    <span className={`${styles.subLabel}`}>Labour booking fee (30%):</span>
                                    <span className={`${styles.value}`}>£{Math.round((jobCostExcludingMaterials * 0.30) / 100)}</span>
                                  </div>
                                </div>
                                <div className={`flex justify-between gap-4 ${styles.depositBox} -mx-2 px-2 py-2 rounded`}>
                                  <span className={`font-bold ${styles.depositLabel}`}>Total deposit today:</span>
                                  <span className={`font-bold ${styles.depositValue} text-xl`}>£{Math.round(totalDeposit / 100)}</span>
                                </div>
                              </>
                            )}
                          </div>

                          {stripePromise ? (
                            <Elements
                              stripe={stripePromise}
                              key={`${selectedEEEPackage}-${isInstallmentsMode ? 'installments' : 'full'}-${selectedExtras.join(',')}`}
                            >
                              <PaymentForm
                                amount={totalDeposit}
                                customerName={quote.customerName || ''}
                                customerEmail={quote.email || ''}
                                quoteId={quote.id}
                                selectedTier={selectedEEEPackage || 'essential'}
                                selectedTierPrice={totalWithFee}
                                selectedExtras={selectedExtras}
                                paymentType={isInstallmentsMode ? 'installments' : 'full'}
                                onSuccess={handleBooking}
                                onError={(error) => {
                                  toast({
                                    title: 'Payment Failed',
                                    description: error,
                                    variant: 'destructive',
                                  });
                                }}
                              />
                            </Elements>
                          ) : (
                            <div className="text-center p-4 bg-red-900/20 border border-red-500 rounded-lg">
                              <p className="text-red-400">Payment system is not configured. Please contact support.</p>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </motion.div>
                )}
              </motion.div>
            )}
          </div>
        </section >

        {/* COMPACT TRUST FOOTER (Below Packages) */}
        < div className="bg-slate-100 py-12 px-6 border-t border-slate-200 relative" >
          <div className="max-w-4xl mx-auto">
            <div className="flex flex-col md:flex-row items-center justify-between gap-8">

              {/* Secure Payments */}
              <div className="flex flex-col items-center md:items-start gap-4">
                <p className="text-slate-500 text-sm">
                  Secure payments processed by Swipe via Stripe Connect.
                </p>
                <div className="flex gap-4 opacity-70 hover:opacity-100 transition-all">
                  <SiVisa className="w-8 h-8 text-[#1434CB]" />
                  <SiMastercard className="w-8 h-8 text-[#EB001B]" />
                  <SiAmericanexpress className="w-8 h-8 text-[#2E77BC]" />
                  <SiApplepay className="w-8 h-8 text-slate-900" />
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                <Lock className="w-3 h-3" />
                256-bit SSL Encrypted
              </div>
            </div>

          </div>

          <div className="mt-12 text-center text-gray-600 text-[10px]">
            &copy; 2024 HandyServices. All rights reserved.
          </div>
        </div >


        {/* Floating Social Proof Badge - Only show in early phase to avoid clutter/overlap */}
        {
          scrollPhase === 'early' && !showPaymentForm && (
            <div className="fixed bottom-4 right-4 z-50">
              <div className="bg-white border border-slate-200 text-slate-900 rounded-lg shadow-lg p-3 flex items-center gap-3 animate-in slide-in-from-bottom-5">
                <div className="flex flex-col">
                  <div className="flex gap-0.5 text-[#7DB00E]">
                    <Star className="w-3 h-3 fill-current" />
                    <Star className="w-3 h-3 fill-current" />
                    <Star className="w-3 h-3 fill-current" />
                    <Star className="w-3 h-3 fill-current" />
                    <Star className="w-3 h-3 fill-current" />
                  </div>
                  <span className="text-[10px] text-gray-400 font-bold uppercase mt-0.5">4.9/5 RATED</span>
                </div>
                <div className="h-6 w-px bg-white/10"></div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-[#7DB00E] animate-pulse"></div>
                  <span className="text-xs font-bold">Verified</span>
                </div>
              </div>
            </div>
          )
        }
      </div >
    );
  }

  // --- LEGACY/QUICK MODE LAYOUT ---
  return (
    <div className="h-screen bg-gradient-to-b from-gray-900 to-gray-800 flex flex-col relative">
      {/* Social Proof Overlay */}
      {showSocialProof && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg mx-4 p-8 space-y-6">
            <div className="text-center space-y-4">
              <div className="flex items-center justify-center gap-2 mb-2">
                <SiGoogle className="w-8 h-8 text-[#4285F4]" />
                <span className="text-2xl font-bold text-gray-900">Reviews</span>
              </div>
              <div className="flex items-center justify-center gap-2">
                <div className="flex gap-0.5">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-6 h-6 fill-yellow-400 text-yellow-400" />
                  ))}
                </div>
                <span className="text-xl font-bold text-gray-900">4.9</span>
              </div>
              <p className="text-gray-600 text-sm">Based on 347+ reviews</p>
              <div className="space-y-3 pt-4">
                <div className="bg-gray-50 rounded-lg p-3 text-left">
                  <div className="flex gap-0.5 mb-1">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                    ))}
                  </div>
                  <p className="text-sm text-gray-700 italic">"Turned up exactly on time, very professional work"</p>
                  <p className="text-xs text-gray-500 mt-1">- Sarah M.</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-left">
                  <div className="flex gap-0.5 mb-1">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                    ))}
                  </div>
                  <p className="text-sm text-gray-700 italic">"Great value, quality work at a fair price"</p>
                  <p className="text-xs text-gray-500 mt-1">- David T.</p>
                </div>
              </div>
            </div>
            <div className="border-t border-gray-200 pt-6 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                  <Check className="w-6 h-6 text-green-600" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-gray-900">2,500+ Jobs Completed</p>
                  <p className="text-xs text-gray-600">Trusted by local homeowners</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                  <Shield className="w-6 h-6 text-blue-600" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-gray-900">Fully Insured Handymen</p>
                  <p className="text-xs text-gray-600">£10M public liability coverage</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                  <Crown className="w-6 h-6 text-purple-600" />
                </div>
                <div className="text-left">
                  <p className="font-semibold text-gray-900">15 Years in Business</p>
                  <p className="text-xs text-gray-600">Established & reliable service</p>
                </div>
              </div>
            </div>
            <Button
              onClick={() => {
                setShowSocialProof(false);
                sessionStorage.setItem('socialProofSeen', 'true');
              }}
              className="w-full bg-[#e8b323] hover:bg-[#d1a01f] text-gray-900 font-bold text-lg h-14 text-base shadow-lg"
            >
              See My Quote
            </Button>
          </div>
        </div>
      )}

      {isActuallyExpired && <QuoteExpiredPopup />}

      {!quote.bookedAt && (
        <div className="sticky top-0 z-50 bg-gradient-to-r from-gray-950 via-gray-900 to-gray-950 border-b border-amber-500/30 px-3 py-2.5">
          <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <span className="text-xl flex-shrink-0 animate-pulse">✨</span>
              <p className="text-gray-100 text-xs sm:text-sm font-medium truncate">
                <span className="text-[#e8b323] font-bold">New Year Offer:</span> Pay in 3 Interest-Free available today.
              </p>
            </div>
            {
              quote.expiresAt && (
                <div className="flex items-center gap-2 bg-black/40 px-3 py-1.5 rounded-full border border-white/10 flex-shrink-0">
                  <Clock className="w-3.5 h-3.5 text-[#e8b323]" />
                  <CountdownTimer expiresAt={quote.expiresAt} className="text-[#7DB00E] text-sm font-bold" />
                </div>
              )
            }
          </div >
        </div >
      )
      }

      {
        showPriceIncreaseNotice && (
          <div className="sticky top-[60px] z-40 bg-orange-600/95 backdrop-blur border-b border-orange-700 px-4 py-3">
            <div className="max-w-2xl mx-auto flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="h-5 w-5 text-white flex-shrink-0" />
                  <h3 className="text-white font-bold">Prices Updated</h3>
                </div>
                <p className="text-white/90 text-sm">Your quote expired, so we've refreshed it.</p>
              </div>
              <button onClick={() => setShowPriceIncreaseNotice(false)} className="text-white/80"><X className="h-5 w-5" /></button>
            </div>
          </div>
        )
      }

      <div className="flex-1 px-4 py-3 pb-24 overflow-auto">
        <div className="max-w-2xl mx-auto">
          <div className="mb-6 rounded-xl overflow-hidden shadow-lg w-full h-auto relative">
            <img src={quote.contractor?.coverPhotoUrl || payIn3PromoImage} className="w-full h-auto" />
          </div>

          {quote.quoteMode !== 'simple' && (
            <div className="mb-10 px-4">
              <ExpertSpecSheet
                text={getExpertNoteText(quote as any)}
                customerName={quote.customerName || ''}
                address={quote.address || quote.postcode}
                mikePhotoUrl={mikeProfilePhoto}
                className="mt-8 transform max-w-xl mx-auto"
              />
            </div>
          )}

          {quote.quoteMode === 'hhh' && (
            <div className="mb-8 text-center text-white">
              <h3 className="text-3xl font-bold mb-3">Choose your service level</h3>
              <p className="text-gray-300">Pick the package that fits your needs.</p>
            </div>
          )}

          {quote.quoteMode !== 'simple' && (
            <Card className="bg-black/40 border-gray-700 mb-6 overflow-hidden">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <colgroup>
                      <col className="w-[45%] sm:w-[40%]" />
                      <col className="w-[18%] sm:w-[20%]" />
                      <col className="w-[18%] sm:w-[20%]" />
                      <col className="w-[19%] sm:w-[20%]" />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-gray-700">
                        <th className="text-left py-3 px-2 sm:py-4 sm:px-4 text-white font-bold text-sm sm:text-base">What you get</th>
                        <th className="text-center py-3 px-1 sm:py-4 sm:px-3">
                          <div className="flex flex-col items-center gap-1">
                            <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-blue-500/20 border border-blue-400 flex items-center justify-center">
                              <Shield className="h-3 w-3 sm:h-4 sm:w-4 text-blue-400" />
                            </div>
                            <div className="text-white font-bold text-xs sm:text-base leading-tight">Handy<br />Fix</div>
                          </div>
                        </th>
                        <th className="text-center py-3 px-1 sm:py-4 sm:px-3">
                          <div className="flex flex-col items-center gap-1">
                            <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-amber-500/20 border border-[#e8b323] flex items-center justify-center">
                              <Star className="h-3 w-3 sm:h-4 sm:w-4 text-[#e8b323]" />
                            </div>
                            <div className="text-white font-bold text-xs sm:text-base leading-tight">Hassle-<br />Free</div>
                          </div>
                        </th>
                        <th className="text-center py-3 px-1 sm:py-4 sm:px-3">
                          <div className="flex flex-col items-center gap-1">
                            <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-purple-500/20 border border-purple-400 flex items-center justify-center">
                              <Crown className="h-3 w-3 sm:h-4 sm:w-4 text-purple-400" />
                            </div>
                            <div className="text-white font-bold text-xs sm:text-base leading-tight">High<br />Speed</div>
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-gray-800">
                        <td className="py-3 px-2 sm:py-4 sm:px-4 text-white text-xs sm:text-sm break-words">Booking speed</td>
                        <td className="py-3 px-1 sm:py-4 sm:px-3 text-center">
                          <div className="text-gray-300 text-xs sm:text-sm font-medium">10–14 days</div>
                        </td>
                        <td className="py-3 px-1 sm:py-4 sm:px-3 text-center">
                          <div className="text-gray-300 text-xs sm:text-sm font-medium">3–7 days</div>
                        </td>
                        <td className="py-3 px-1 sm:py-4 sm:px-3 text-center">
                          <div className="text-gray-300 text-xs sm:text-sm font-medium">Next-day</div>
                        </td>
                      </tr>
                      <tr className="border-b border-gray-800">
                        <td className="py-3 px-2 sm:py-4 sm:px-4 text-white text-xs sm:text-sm break-words">Arrival window</td>
                        <td className="py-3 px-1 sm:py-4 sm:px-3 text-center">
                          <div className="text-gray-300 text-xs sm:text-sm font-medium">4–6 hours</div>
                        </td>
                        <td className="py-3 px-1 sm:py-4 sm:px-3 text-center">
                          <div className="text-gray-300 text-xs sm:text-sm font-medium">1–2 hours</div>
                        </td>
                        <td className="py-3 px-1 sm:py-4 sm:px-3 text-center">
                          <div className="text-gray-300 text-xs sm:text-sm font-medium">Exact time</div>
                        </td>
                      </tr>
                      <tr className="border-b border-gray-800">
                        <td className="py-3 px-2 sm:py-4 sm:px-4 text-white text-xs sm:text-sm break-words">Guarantee</td>
                        <td className="py-3 px-1 sm:py-4 sm:px-3 text-center">
                          <div className="text-gray-300 text-xs sm:text-sm font-medium">7 days</div>
                        </td>
                        <td className="py-3 px-1 sm:py-4 sm:px-3 text-center">
                          <div className="text-gray-300 text-xs sm:text-sm font-medium">14 days</div>
                        </td>
                        <td className="py-3 px-1 sm:py-4 sm:px-3 text-center">
                          <div className="text-gray-300 text-xs sm:text-sm font-medium">30-90 days</div>
                        </td>
                      </tr>
                      <tr className="border-b border-gray-800">
                        <td className="py-3 px-2 sm:py-4 sm:px-4 text-white text-xs sm:text-sm break-words">Materials quality</td>
                        <td className="py-3 px-1 sm:py-4 sm:px-3 text-center">
                          <div className="text-gray-300 text-xs sm:text-sm font-medium">Standard</div>
                        </td>
                        <td className="py-3 px-1 sm:py-4 sm:px-3 text-center">
                          <div className="text-gray-300 text-xs sm:text-sm font-medium">Better-quality</div>
                        </td>
                        <td className="py-3 px-1 sm:py-4 sm:px-3 text-center">
                          <div className="text-gray-300 text-xs sm:text-sm font-medium">Premium</div>
                        </td>
                      </tr>
                      <tr className="border-b border-gray-800">
                        <td className="py-3 px-2 sm:py-4 sm:px-4 text-white text-xs sm:text-sm break-words">Premium finish</td>
                        <td className="py-3 px-1 sm:py-4 sm:px-3 text-center">
                          <div className="text-gray-600 text-lg sm:text-xl font-light">—</div>
                        </td>
                        <td className="py-3 px-1 sm:py-4 sm:px-3 text-center">
                          <div className="inline-flex items-center justify-center w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-white">
                            <Check className="h-3 w-3 sm:h-4 sm:w-4 text-black" strokeWidth={3} />
                          </div>
                        </td>
                        <td className="py-3 px-1 sm:py-4 sm:px-3 text-center">
                          <div className="inline-flex items-center justify-center w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-white">
                            <Check className="h-3 w-3 sm:h-4 sm:w-4 text-black" strokeWidth={3} />
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td className="py-3 px-2 sm:py-4 sm:px-4 text-white text-xs sm:text-sm break-words">Priority aftercare</td>
                        <td className="py-3 px-1 sm:py-4 sm:px-3 text-center">
                          <div className="text-gray-600 text-lg sm:text-xl font-light">—</div>
                        </td>
                        <td className="py-3 px-1 sm:py-4 sm:px-3 text-center">
                          <div className="text-gray-600 text-lg sm:text-xl font-light">—</div>
                        </td>
                        <td className="py-3 px-1 sm:py-4 sm:px-3 text-center">
                          <div className="inline-flex items-center justify-center w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-white">
                            <Check className="h-3 w-3 sm:h-4 sm:w-4 text-black" strokeWidth={3} />
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* All Packages Include Section */}
          <div className="mb-8 bg-black/20 rounded-lg p-6 sm:p-8">
            {/* Header */}
            <div className="text-center mb-6">
              <h3 className="text-2xl sm:text-3xl font-bold text-white mb-3">
                All packages protect your home
              </h3>
              <p className="text-gray-300 text-sm sm:text-base max-w-2xl mx-auto mb-6">
                Choose your service level and enjoy professional handyman work with secure payment. All work comes with our turn-up-on-time guarantee.
              </p>

              {/* Payment Badges */}
              <div className="flex justify-center items-center gap-3 flex-wrap mb-6">
                <div className="bg-white rounded-lg px-4 py-2.5 shadow-md flex items-center justify-center" style={{ minWidth: '60px', height: '40px' }}>
                  <SiVisa className="text-[#1A1F71]" size={40} />
                </div>
                <div className="bg-white rounded-lg px-4 py-2.5 shadow-md flex items-center justify-center" style={{ minWidth: '60px', height: '40px' }}>
                  <SiMastercard className="text-[#EB001B]" size={40} />
                </div>
                <div className="bg-white rounded-lg px-4 py-2.5 shadow-md flex items-center justify-center" style={{ minWidth: '60px', height: '40px' }}>
                  <SiAmericanexpress className="text-[#006FCF]" size={40} />
                </div>
                <div className="bg-white rounded-lg px-4 py-2.5 shadow-md flex items-center justify-center" style={{ minWidth: '60px', height: '40px' }}>
                  <SiApplepay className="text-black" size={40} />
                </div>
              </div>

              {/* Common Features */}
              <div className="max-w-xl mx-auto">

                <h4 className="text-xl sm:text-2xl font-bold text-white mb-4 text-center">
                  All packages include
                </h4>
                <div className="space-y-3">
                  {[
                    'Turn up on time guarantee',
                    'Fully insured handymen',
                    'Professional workmanship',
                    'Clear pricing with no hidden fees',
                    'Pay in full or spread over 3 payments',
                    'Friendly customer service',
                  ].map((feature, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <div className="flex-shrink-0">
                        <Check className="h-5 w-5 sm:h-6 sm:w-6 text-green-400" strokeWidth={3} />
                      </div>
                      <span className="text-white text-sm sm:text-base">{feature}</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>

          {/* PICK & MIX MODE: Checklist of Items */}
          {
            quote.quoteMode === 'pick_and_mix' && quote.optionalExtras && (
              <div className="mb-8">
                <div className="text-center mb-6">
                  <h3 className="text-3xl font-bold text-white mb-2">Build Your Package</h3>
                  <p className="text-gray-300 max-w-xl mx-auto">
                    Select the items you'd like to include. The price updates automatically.
                  </p>
                </div>

                <Card className="bg-gray-800 border-gray-700">
                  <CardContent className="p-4 sm:p-6">
                    {/* Pick & Mix Nudge Banner */}
                    {quote.quoteMode === 'pick_and_mix' && (
                      <div className="mb-6 rounded-lg overflow-hidden relative border border-blue-800/50">
                        {/* Background Progress Bar */}
                        <div className="absolute inset-0 bg-blue-900/30">
                          <div
                            className="h-full bg-blue-600/20 transition-all duration-500 ease-out"
                            style={{ width: `${Math.min(100, (selectedExtras.length / 3) * 100)}%` }}
                          />
                        </div>

                        <div className="relative p-4 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${selectedExtras.length >= 2 ? 'bg-amber-500 border-amber-400 text-white' : 'bg-gray-800 border-gray-600 text-gray-400'}`}>
                              <Zap className="w-5 h-5 fill-current" />
                            </div>
                            <div>
                              <h4 className="font-bold text-white text-lg">
                                {selectedExtras.length >= 3 ? 'Maximum Discount Unlocked!' : 'Bundle & Save'}
                              </h4>
                              <p className="text-sm text-gray-300">
                                {selectedExtras.length === 0 && "Select 2 items to save 5%"}
                                {selectedExtras.length === 1 && "Add 1 more item for 5% off"}
                                {selectedExtras.length === 2 && "Great! Add 1 more for 10% off"}
                                {selectedExtras.length >= 3 && "You're saving 10% on your bundle"}
                              </p>
                            </div>
                          </div>
                          {selectedExtras.length > 0 && (
                            <div className="text-right">
                              <span className={`text-xl font-bold ${selectedExtras.length >= 2 ? 'text-amber-400' : 'text-gray-500'}`}>
                                {selectedExtras.length >= 3 ? '10% OFF' : selectedExtras.length === 2 ? '5% OFF' : '0% OFF'}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="space-y-3">
                      {quote.optionalExtras.map((extra: any, idx: number) => (
                        <label
                          key={idx}
                          className={`flex items-start gap-4 p-4 rounded-xl cursor-pointer transition-all duration-200 border-2 ${selectedExtras.includes(extra.label)
                            ? 'bg-[#e8b323]/10 border-[#e8b323]'
                            : 'bg-gray-750 border-gray-700 hover:border-gray-600'
                            }`}
                          data-testid={`pm-item-${idx}`}
                        >
                          <div className="pt-1">
                            <input
                              type="checkbox"
                              checked={selectedExtras.includes(extra.label)}
                              onChange={() => toggleExtra(extra.label)}
                              className="w-6 h-6 rounded border-gray-500 text-[#e8b323] focus:ring-[#e8b323] transition-colors"
                              data-testid={`pm-checkbox-${idx}`}
                            />
                          </div>

                          <div className="flex-1">
                            <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                              <span className={`font-bold text-lg ${selectedExtras.includes(extra.label) ? 'text-white' : 'text-gray-300'}`}>
                                {extra.label}
                              </span>
                              <span className="text-[#e8b323] font-bold text-xl">
                                £{formatPrice(extra.priceInPence)}
                              </span>
                            </div>

                            <p className="text-gray-400 text-sm leading-relaxed">
                              {extra.description}
                            </p>

                            {extra.estimatedHours && (
                              <div className="mt-2 text-xs text-gray-500 flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                <span>Est. {extra.estimatedHours}h</span>
                              </div>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>

                    {/* Total Summary Inline (Optional, mainly for mobile if footer is hidden) */}
                    <div className="mt-8 pt-6 border-t border-gray-700 flex flex-col items-center">

                      {/* Price Breakdown for Pick & Mix */}
                      {quote.quoteMode === 'pick_and_mix' && calculateDiscountAmount() > 0 && (
                        <div className="w-full max-w-sm space-y-2 mb-4">
                          <div className="flex justify-between items-center text-gray-400">
                            <span>Subtotal</span>
                            <span>£{formatPrice(calculateSubtotal())}</span>
                          </div>
                          <div className="flex justify-between items-center text-emerald-400 font-medium pb-2 border-b border-gray-700">
                            <div className="flex items-center gap-1">
                              <Zap className="w-4 h-4" />
                              <span>Bundle Savings</span>
                            </div>
                            <span>-£{formatPrice(calculateDiscountAmount())}</span>
                          </div>
                        </div>
                      )}

                      <p className="text-gray-400 text-sm mb-1">Total Estimated Price</p>
                      <div className="text-5xl font-bold text-white mb-6">
                        £{formatPrice(calculateSimpleTotal())}
                      </div>

                      {!hasBooked && !hasReserved && (
                        <div className="w-full max-w-sm space-y-3">
                          <Button
                            className="w-full bg-[#e8b323] hover:bg-[#d19b1e] text-black font-bold text-lg py-6 shadow-lg transform active:scale-95 transition-transform"
                            onClick={() => {
                              setHasReserved(true);
                              setTimeout(() => {
                                // Scroll to confirm button area logic if needed
                                const target = document.getElementById('confirm-button');
                                target?.scrollIntoView({ behavior: 'smooth' });
                              }, 100);
                            }}
                            disabled={calculateSimpleTotal() === 0}
                            data-testid="button-book-pm-inline"
                          >
                            {calculateSimpleTotal() === 0 ? 'Select items to continue' : 'Proceed with Selection'}
                          </Button>
                          <p className="text-center text-xs text-gray-500">
                            Secure your booking with a deposit
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )
          }

          {/* Quote Display - Simple mode */}
          {
            quote.quoteMode === 'simple' && quote.basePrice && quote.optionalExtras && (
              /* SIMPLE MODE: Single Quote with Optional Extras */
              <>
                <Card className="bg-gray-800 border-gray-700 mb-6">
                  <CardContent className="p-6">
                    {/* Base Price Display */}
                    <div className="text-center mb-6">
                      <h3 className="text-white text-lg font-semibold mb-3">Your Quote</h3>
                      <div className="text-6xl font-bold text-[#e8b323] mb-2">
                        £{formatPrice(hasReserved ? calculateSimpleTotal() : quote.basePrice)}
                      </div>
                      <p className="text-gray-400 text-sm">
                        {hasReserved ? (
                          <>Base: £{formatPrice(quote.basePrice)} {selectedExtras.length > 0 && `+ extras`}</>
                        ) : (
                          <>All-inclusive quote</>
                        )}
                      </p>
                    </div>

                    {/* Job Deliverables */}
                    <div className="bg-gradient-to-br from-gray-700/70 to-gray-800/70 rounded-xl p-5 mb-4 border border-gray-600/50">
                      <h4 className="text-white font-bold mb-4 text-lg flex items-center gap-2">
                        <div className="w-1.5 h-6 bg-[#7DB00E] rounded-full"></div>
                        Scope of Works
                      </h4>
                      <div className="space-y-2.5">
                        {(() => {
                          // Extract all deliverables from jobs
                          const deliverables: string[] = [];

                          if (quote.jobs && Array.isArray(quote.jobs)) {
                            quote.jobs.forEach((job) => {
                              if (job.tasks && Array.isArray(job.tasks)) {
                                job.tasks.forEach((task) => {
                                  // Use deliverable if available, otherwise fall back to description
                                  const deliverable = task.deliverable || task.description;
                                  if (deliverable) {
                                    deliverables.push(deliverable);
                                  }
                                });
                              }
                            });
                          }

                          // Add standard service guarantees at the end
                          const serviceGuarantees = [
                            'Turn up on time guarantee',
                            'Insured handymen',
                            'Professional workmanship'
                          ];

                          // Show deliverables first, then service guarantees
                          const allItems = [...deliverables, ...serviceGuarantees];

                          return allItems.map((item, idx) => (
                            <div key={idx} className="flex items-start gap-3 group">
                              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-[#7DB00E] flex items-center justify-center mt-0.5">
                                <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              </div>
                              <span className="text-white text-base font-bold leading-relaxed">{item}</span>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>

                    {/* CTA Button for Simple Mode - BEFORE reservation */}
                    {!hasBooked && !hasReserved && (
                      <div className="mt-6 pt-6 border-t border-gray-700">
                        <Button
                          className="w-full bg-[#e8b323] hover:bg-[#d19b1e] text-black font-bold text-lg py-6"
                          onClick={() => {
                            setHasReserved(true);
                            setTimeout(() => {
                              const target = quote.optionalExtras && quote.optionalExtras.length > 0
                                ? document.getElementById('optional-extras')
                                : document.getElementById('confirm-button');
                              target?.scrollIntoView({ behavior: 'smooth' });
                            }, 100);
                          }}
                          data-testid="button-book-now-simple"
                        >
                          Reserve your slot
                        </Button>
                        <div className="mt-4 space-y-2">
                          <div className="flex items-center gap-2 text-sm text-gray-400">
                            <Lock className="h-4 w-4 text-blue-400" />
                            <span>3-month workmanship guarantee included</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Optional Extras - AFTER reservation */}
                {hasReserved && !hasBooked && quote.optionalExtras && quote.optionalExtras.length > 0 && (
                  <Card id="optional-extras" className="bg-gray-800 border-gray-700 mb-6">
                    <CardContent className="p-6">
                      <h4 className="text-white text-lg font-semibold mb-2">Popular finishing touches</h4>
                      <p className="text-gray-400 text-sm mb-4">Customers also book these enhancements:</p>
                      <div className="space-y-3">
                        {quote.optionalExtras.map((extra: any, idx: number) => (
                          <label
                            key={idx}
                            className={`flex items-start gap-3 p-4 rounded-lg cursor-pointer transition-colors ${selectedExtras.includes(extra.label)
                              ? 'bg-[#e8b323]/20 border-2 border-[#e8b323]'
                              : 'bg-gray-700/50 border-2 border-gray-600 hover:border-gray-500'
                              }`}
                            data-testid={`extra-${extra.label}`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedExtras.includes(extra.label)}
                              onChange={() => toggleExtra(extra.label)}
                              className="mt-1 h-5 w-5 rounded border-gray-500 text-[#e8b323] focus:ring-[#e8b323]"
                              data-testid={`checkbox-extra-${idx}`}
                            />
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-white font-medium">{extra.label}</span>
                                {extra.isRecommended && (
                                  <Badge className="bg-green-600 text-white text-xs px-2 py-0.5">
                                    Recommended
                                  </Badge>
                                )}
                              </div>
                              <p className="text-gray-400 text-sm">{extra.description}</p>
                            </div>
                            <span className="text-[#e8b323] font-bold text-lg shrink-0">
                              +£{formatPrice(extra.priceInPence)}
                            </span>
                          </label>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )
          }

          {/* Optional Extras for HHH Mode */}
          {
            hasReserved && quote.quoteMode !== 'simple' && quote.optionalExtras && quote.optionalExtras.length > 0 && (
              <div id="optional-extras" className="mt-6 px-4">
                <Card className="bg-gray-800 border-gray-700">
                  <CardContent className="p-4">
                    <h4 className="text-white text-base font-semibold mb-1">Popular finishing touches</h4>
                    <p className="text-gray-400 text-xs mb-3">Customers also book these enhancements:</p>
                    <div className="space-y-2">
                      {quote.optionalExtras.map((extra: any, idx: number) => (
                        <label
                          key={idx}
                          className={`flex items-start gap-2 p-3 rounded-lg cursor-pointer transition-colors ${selectedExtras.includes(extra.label)
                            ? 'bg-[#e8b323]/20 border-2 border-[#e8b323]'
                            : 'bg-gray-700/50 border-2 border-gray-600 hover:border-gray-500'
                            }`}
                          data-testid={`extra-hhh-${extra.label}`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedExtras.includes(extra.label)}
                            onChange={() => toggleExtra(extra.label)}
                            className="mt-0.5 h-4 w-4 rounded border-gray-500 text-[#e8b323] focus:ring-[#e8b323]"
                            data-testid={`checkbox-extra-hhh-${idx}`}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                              <span className="text-white font-medium text-sm">{extra.label}</span>
                              {extra.isRecommended && (
                                <Badge className="bg-green-600 text-white text-xs px-1.5 py-0">
                                  Recommended
                                </Badge>
                              )}
                            </div>
                            <p className="text-gray-400 text-xs">{extra.description}</p>
                          </div>
                          <span className="text-[#e8b323] font-bold text-sm shrink-0 mt-0.5">
                            +£{formatPrice(extra.priceInPence)}
                          </span>
                        </label>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )
          }

          {/* Pay in 3 Section - Simple Pie Chart Design */}
          {
            !hasReserved && (
              <div className="mt-8 px-4" data-testid="pay-in-3-section">
                <div className="bg-gradient-to-br from-amber-900/20 to-orange-900/10 border border-amber-500/30 rounded-2xl p-8 flex flex-col md:flex-row items-center justify-center gap-6">
                  {/* Pie Chart SVG - 3 equal segments */}
                  <div className="relative w-28 h-28 flex-shrink-0">
                    <svg viewBox="0 0 100 100" className="w-full h-full transform -rotate-90">
                      {/* Segment 1 - Filled (amber) */}
                      <circle
                        cx="50"
                        cy="50"
                        r="40"
                        fill="transparent"
                        stroke="#f59e0b"
                        strokeWidth="20"
                        strokeDasharray="83.78 251.33"
                        strokeDashoffset="0"
                      />
                      {/* Segment 2 - Lighter */}
                      <circle
                        cx="50"
                        cy="50"
                        r="40"
                        fill="transparent"
                        stroke="#78350f"
                        strokeWidth="20"
                        strokeDasharray="83.78 251.33"
                        strokeDashoffset="-83.78"
                      />
                      {/* Segment 3 - Lighter */}
                      <circle
                        cx="50"
                        cy="50"
                        r="40"
                        fill="transparent"
                        stroke="#78350f"
                        strokeWidth="20"
                        strokeDasharray="83.78 251.33"
                        strokeDashoffset="-167.56"
                      />
                    </svg>
                  </div>

                  {/* Text Content */}
                  <div className="text-center">
                    <h3 className="text-2xl font-bold text-white mb-1">Pay in 3</h3>
                    <p className="text-gray-300 text-sm mb-3">Spread the cost into 3 simple monthly payments.</p>
                    <ul className="text-gray-400 text-sm space-y-1 inline-block text-left">
                      <li className="flex items-center gap-2">
                        <span className="text-amber-500">✓</span> No credit checks
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-amber-500">✓</span> No forms to fill
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-amber-500">✓</span> Instant approval
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            )
          }

          {/* FAQ Section - Hide when payment form is shown */}
          {
            !hasReserved && (
              <div className="mt-8 px-4">
                <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-6">
                  <div className="text-center mb-6">
                    <h3 className="text-3xl font-bold text-white mb-2">Questions?</h3>
                    <p className="text-gray-300">We've got answers.</p>
                  </div>

                  <Accordion type="single" collapsible className="space-y-2">
                    {/* Detailed Comparison Table */}
                    <AccordionItem value="comparison-table" className="border-b border-gray-700">
                      <AccordionTrigger className="text-white hover:text-[#e8b323] text-left font-medium py-4 text-base">
                        <div className="flex items-center gap-2">
                          <Crown className="w-4 h-4 text-[#e8b323]" />
                          <span>Compare Tiers: What's Included?</span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="text-gray-300 pb-4">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm text-left">
                            <thead>
                              <tr className="border-b border-gray-700 text-gray-400">
                                <th className="py-2 pr-4 font-normal w-1/4">Feature</th>
                                <th className="py-2 px-2 font-normal text-center w-1/4">Basic</th>
                                <th className="py-2 px-2 font-normal text-center w-1/4 text-green-400">Hassle-Free</th>
                                <th className="py-2 px-2 font-bold text-center w-1/4 text-[#e8b323]">Elite</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-800">
                              {/* Warranty */}
                              <tr>
                                <td className="py-3 pr-4 font-medium text-white">Warranty</td>
                                <td className="py-3 px-2 text-center text-gray-500">30 Days</td>
                                <td className="py-3 px-2 text-center text-gray-400">6 Months</td>
                                <td className="py-3 px-2 text-center font-bold text-[#e8b323]">1 Year</td>
                              </tr>
                              {/* Arrival */}
                              <tr>
                                <td className="py-3 pr-4 font-medium text-white">Arrival</td>
                                <td className="py-3 px-2 text-center text-gray-500">Day Window</td>
                                <td className="py-3 px-2 text-center text-gray-400">Priority</td>
                                <td className="py-3 px-2 text-center font-bold text-pink-400">8am Guaranteed</td>
                              </tr>
                              {/* Materials */}
                              <tr>
                                <td className="py-3 pr-4 font-medium text-white">Materials</td>
                                <td className="py-3 px-2 text-center text-gray-500">Standard</td>
                                <td className="py-3 px-2 text-center text-gray-400">Better</td>
                                <td className="py-3 px-2 text-center font-bold text-white">We Source & Buy</td>
                              </tr>
                              {/* Extras */}
                              <tr>
                                <td className="py-3 pr-4 font-medium text-white">"While-I'm-There"</td>
                                <td className="py-3 px-2 text-center text-gray-600">-</td>
                                <td className="py-3 px-2 text-center text-green-400 font-bold">15 Mins</td>
                                <td className="py-3 px-2 text-center text-green-400 font-bold">15 Mins</td>
                              </tr>
                              {/* Cleanup */}
                              <tr>
                                <td className="py-3 pr-4 font-medium text-white">Cleanup</td>
                                <td className="py-3 px-2 text-center text-gray-500">Broom Swept</td>
                                <td className="py-3 px-2 text-center text-gray-400">Tidy</td>
                                <td className="py-3 px-2 text-center font-bold text-blue-400">Sparkle Finish</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="item-1" className="border-b border-gray-700">
                      <AccordionTrigger className="text-white hover:text-[#e8b323] text-left font-medium py-4 text-base">
                        What happens after I book?
                      </AccordionTrigger>
                      <AccordionContent className="text-gray-300 pb-4">
                        We'll call you within 1 hour to confirm the details and schedule a convenient time. Your deposit secures your booking and is deducted from the final price.
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="item-2" className="border-b border-gray-700">
                      <AccordionTrigger className="text-white hover:text-[#e8b323] text-left font-medium py-4 text-base">
                        What are my payment options?
                      </AccordionTrigger>
                      <AccordionContent className="text-gray-300 pb-4">
                        You can pay in full upfront, or choose to spread the cost over 3 monthly payments (a small convenience fee applies). Both options require a deposit to secure your booking, which is deducted from the final price.
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="item-3" className="border-b border-gray-700">
                      <AccordionTrigger className="text-white hover:text-[#e8b323] text-left font-medium py-4 text-base">
                        What if the job costs more than quoted?
                      </AccordionTrigger>
                      <AccordionContent className="text-gray-300 pb-4">
                        Your quote is fixed. We'll never charge more without discussing it with you first. If we discover additional work needed, we'll explain everything and get your approval before proceeding.
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="item-4" className="border-b border-gray-700">
                      <AccordionTrigger className="text-white hover:text-[#e8b323] text-left font-medium py-4 text-base">
                        How quickly can you start?
                      </AccordionTrigger>
                      <AccordionContent className="text-gray-300 pb-4">
                        It depends on your chosen tier. Handy Fix jobs are typically scheduled within 2 weeks, Hassle-Free within 1 week, and High Standard jobs can often be prioritized for next-day service.
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="item-5" className="border-b border-gray-700">
                      <AccordionTrigger className="text-white hover:text-[#e8b323] text-left font-medium py-4 text-base">
                        What payment methods do you accept?
                      </AccordionTrigger>
                      <AccordionContent className="text-gray-300 pb-4">
                        We accept all major credit/debit cards, Apple Pay, and Google Pay. The remaining balance can be paid by card or bank transfer after the job is complete.
                      </AccordionContent>
                    </AccordionItem>

                    <AccordionItem value="item-6" className="border-b-0">
                      <AccordionTrigger className="text-white hover:text-[#e8b323] text-left font-medium py-4 text-base">
                        Are you insured and qualified?
                      </AccordionTrigger>
                      <AccordionContent className="text-gray-300 pb-4">
                        Yes, we're fully insured with £5M public liability coverage. Our team is qualified, experienced, and background-checked. All work comes with a guarantee.
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              </div>
            )
          }

          {/* Payment Methods Section - Hide when payment form is shown, will move inside payment section */}
          {
            !hasReserved && (
              <div className="mt-6 px-4">
                <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-6">
                  <h3 className="text-xl font-bold text-white mb-4 text-center">Secure Payment Methods</h3>
                  <div className="flex justify-center items-center gap-3 flex-wrap">
                    <div className="bg-white rounded-lg px-4 py-2.5 shadow-md flex items-center justify-center" style={{ minWidth: '60px', height: '40px' }}>
                      <SiVisa className="text-[#1A1F71]" size={40} />
                    </div>
                    <div className="bg-white rounded-lg px-4 py-2.5 shadow-md flex items-center justify-center" style={{ minWidth: '60px', height: '40px' }}>
                      <SiMastercard className="text-[#EB001B]" size={40} />
                    </div>
                    <div className="bg-white rounded-lg px-4 py-2.5 shadow-md flex items-center justify-center" style={{ minWidth: '60px', height: '40px' }}>
                      <SiAmericanexpress className="text-[#006FCF]" size={40} />
                    </div>
                    <div className="bg-white rounded-lg px-4 py-2.5 shadow-md flex items-center justify-center" style={{ minWidth: '60px', height: '40px' }}>
                      <SiApplepay className="text-black" size={40} />
                    </div>
                  </div>
                </div>
              </div>
            )
          }

          {/* Confirm Button or Confirmation */}
          {
            hasBooked && !datePreferencesSubmitted ? (
              /* Tenant View or Direct Booking flow when leadId exists */
              <div ref={dateSelectionRef} className="mt-8">
                <Card className="border-[#e8b323] bg-gray-800 border-2">
                  <CardContent className="p-8">
                    <h3 className="text-xl font-bold text-[#e8b323] mb-4 text-center">
                      Schedule the Repair
                    </h3>
                    <DateSelectionForm
                      tier={mapTierToHHH(selectedEEEPackage || 'essential')}
                      onSubmit={handleDatePreferencesSubmit}
                    />
                  </CardContent>
                </Card>
              </div>
            ) : hasBooked && datePreferencesSubmitted ? (
              <Card className="mt-8 border-green-500 bg-green-900/30 border-2">
                <CardContent className="p-8 text-center">
                  <div className="inline-flex items-center justify-center w-20 h-20 bg-green-500 rounded-full mb-4">
                    <Check className="h-12 w-12 text-white" />
                  </div>
                  <h3 className="text-4xl font-bold text-green-400 mb-2">Thank You!</h3>
                  <p className="text-xl text-gray-200 mb-4">
                    We will be in contact shortly.
                  </p>
                  <p className="text-gray-300">
                    We'll call you at {quote.phone} to confirm the details and schedule your job.
                  </p>
                </CardContent>
              </Card>
            ) : hasReserved ? (
              <div id="confirm-button" className="mt-8">
                <Card className="bg-gray-800 border-gray-700">
                  <CardContent className="p-6">
                    <div className="max-w-md mx-auto">
                      <h3 className="text-2xl font-bold text-white mb-2 text-center">
                        Reserve Your Slot
                      </h3>
                      {(() => {
                        // Get base tier price - use packages array to match footer exactly
                        const selectedPkg = packages.find(p => p.tier === selectedEEEPackage);
                        const baseTierPrice = selectedPkg?.price || (quote.quoteMode === 'simple'
                          ? quote.basePrice || 0
                          : (quote[`${selectedEEEPackage}Price` as keyof PersonalizedQuote] as number));

                        // Calculate extras total
                        const extrasTotal = selectedExtras.reduce((sum, label) => {
                          const extra = quote.optionalExtras?.find(e => e.label === label);
                          return sum + (extra?.priceInPence || 0);
                        }, 0);

                        // [RAMANUJAM] Add BUSY_PRO productization adjustments
                        const busyProAdjustments = calculateBusyProAdjustments();

                        // Calculate total job price (before convenience fee)
                        const baseJobPrice = baseTierPrice + extrasTotal + busyProAdjustments.schedulingFee + busyProAdjustments.bundlePrice;

                        // Calculate installment-related values - match footer exactly
                        const isTier1 = selectedEEEPackage === 'essential';
                        const isInstallmentsMode = !isTier1 && paymentMode === 'installments';
                        const CONVENIENCE_FEE_RATE = 0.10; // 10% convenience fee
                        const convenienceFee = isInstallmentsMode ? Math.round(baseJobPrice * CONVENIENCE_FEE_RATE) : 0;
                        const totalWithFee = baseJobPrice + convenienceFee;

                        // Calculate deposit
                        const totalDeposit = calculateDeposit(baseJobPrice);

                        // For installments: remaining balance after deposit, split into 3 payments
                        const remainingBalance = Math.max(0, totalWithFee - totalDeposit);
                        const monthlyInstallment = Math.round(remainingBalance / 3);

                        // Calculate materials for breakdown display
                        const extrasMaterials = selectedExtras.reduce((sum, label) => {
                          const extra = quote.optionalExtras?.find(e => e.label === label);
                          return sum + (extra?.materialsCostInPence || 0);
                        }, 0);
                        const materialsCost = (quote.materialsCostWithMarkupPence || 0) + extrasMaterials;
                        const jobCostExcludingMaterials = baseJobPrice - materialsCost;

                        return (
                          <>
                            {/* Payment Choice Toggle */}
                            <div className="flex justify-center mb-6">
                              <div className="bg-gray-700/50 p-1 rounded-lg inline-flex items-center border border-gray-600">
                                <button
                                  onClick={() => setPaymentMode('full')}
                                  className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${paymentMode === 'full'
                                    ? 'bg-[#e8b323] text-gray-900 shadow-lg'
                                    : 'text-gray-400 hover:text-white'
                                    }`}
                                >
                                  Pay in Full
                                </button>
                                <button
                                  onClick={() => setPaymentMode('installments')}
                                  className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${paymentMode === 'installments'
                                    ? 'bg-[#e8b323] text-gray-900 shadow-lg'
                                    : 'text-gray-400 hover:text-white'
                                    }`}
                                >
                                  Pay in 3
                                </button>
                              </div>
                            </div>

                            <div className="text-center mb-6">
                              <div className="mb-4">
                                <h4 className="text-lg font-semibold text-white mb-2">Payment Breakdown</h4>
                                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-700 text-sm mb-2">
                                  <span className="text-gray-400">Payment method:</span>
                                  <span className="font-semibold text-white">
                                    {isInstallmentsMode ? '3 Monthly Payments' : 'Pay in Full'}
                                  </span>
                                </div>
                                <p className="text-sm text-gray-400">
                                  {isInstallmentsMode
                                    ? 'Pay a deposit today, then 3 easy monthly payments.'
                                    : 'To reserve your slot, we require a deposit to confirm your booking.'}
                                </p>
                              </div>
                              <div className="bg-gray-700/50 rounded-lg p-5 inline-block text-left border border-gray-600 w-full max-w-sm">
                                <div className="space-y-2 mb-3 pb-3 border-b-2 border-gray-600">
                                  {/* Base price */}
                                  <div className="flex justify-between gap-4">
                                    <span className="text-gray-300">{quote.quoteMode === 'simple' ? 'Job price' : getPackageDisplayName(selectedEEEPackage || 'essential')}:</span>
                                    <span className="text-white">£{Math.round(baseTierPrice / 100)}</span>
                                  </div>

                                  {/* [RAMANUJAM] BUSY_PRO choices */}
                                  {quote.segment === 'BUSY_PRO' && (
                                    <>
                                      {timingChoice === 'next_week' && (
                                        <div className="flex justify-between gap-4">
                                          <span className="text-green-400">Next week discount:</span>
                                          <span className="text-green-400">-£60</span>
                                        </div>
                                      )}
                                      {whileImThereBundle !== 'none' && (
                                        <div className="flex justify-between gap-4">
                                          <span className="text-gray-300">
                                            + "While I'm There" bundle:
                                          </span>
                                          <span className="text-white">
                                            +£{Math.round(busyProAdjustments.bundlePrice / 100)}
                                          </span>
                                        </div>
                                      )}
                                    </>
                                  )}

                                  {/* Optional extras */}
                                  {extrasTotal > 0 && (
                                    <div className="flex justify-between gap-4">
                                      <span className="text-gray-300">+ Optional extras ({selectedExtras.length}):</span>
                                      <span className="text-white">£{Math.round(extrasTotal / 100)}</span>
                                    </div>
                                  )}

                                  {/* Total */}
                                  <div className="flex justify-between gap-4 pt-2 border-t border-gray-500">
                                    <span className="font-semibold text-gray-200">Total:</span>
                                    <span className="font-semibold text-white">£{Math.round(totalWithFee / 100)}</span>
                                  </div>
                                </div>

                                {isInstallmentsMode ? (
                                  <>
                                    <div className="space-y-2 mb-3 pb-3 border-b border-gray-600">
                                      <div className="text-xs text-gray-400 mb-2">Deposit breakdown:</div>
                                      <div className="flex justify-between gap-4 text-sm">
                                        <span className="text-gray-300">Materials (100% upfront):</span>
                                        <span className="text-white">£{Math.round(materialsCost / 100)}</span>
                                      </div>
                                      <div className="flex justify-between gap-4 text-sm">
                                        <span className="text-gray-300">Labour booking fee (30%):</span>
                                        <span className="text-white">£{Math.round((jobCostExcludingMaterials * 0.30) / 100)}</span>
                                      </div>
                                      <div className="flex justify-between gap-4 bg-[#e8b323]/10 -mx-2 px-2 py-2 rounded mt-2">
                                        <span className="font-bold text-white">Total deposit today:</span>
                                        <span className="font-bold text-[#e8b323] text-lg">£{Math.round(totalDeposit / 100)}</span>
                                      </div>
                                    </div>
                                    <div className="space-y-2">
                                      <div className="text-sm text-gray-400 mb-1">Then 3 monthly payments of:</div>
                                      <div className="flex justify-between gap-4 bg-gray-600/50 -mx-2 px-2 py-2 rounded">
                                        <span className="font-semibold text-white">Monthly payment:</span>
                                        <span className="font-semibold text-white text-lg">£{Math.round(monthlyInstallment / 100)}</span>
                                      </div>
                                      <div className="text-xs text-gray-500 text-right">
                                        (3 × £{Math.round(monthlyInstallment / 100)} = £{Math.round(remainingBalance / 100)})
                                      </div>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <div className="space-y-2 mb-3">
                                      <div className="text-xs text-gray-400 mb-2">Deposit breakdown:</div>
                                      <div className="flex justify-between gap-4 text-sm">
                                        <span className="text-gray-300">Materials (100% upfront):</span>
                                        <span className="text-white">£{Math.round(materialsCost / 100)}</span>
                                      </div>
                                      <div className="flex justify-between gap-4 text-sm">
                                        <span className="text-gray-300">Labour booking fee (30%):</span>
                                        <span className="text-white">£{Math.round((jobCostExcludingMaterials * 0.30) / 100)}</span>
                                      </div>
                                    </div>
                                    <div className="flex justify-between gap-4 bg-[#e8b323]/10 -mx-2 px-2 py-2 rounded">
                                      <span className="font-bold text-white">Total deposit today:</span>
                                      <span className="font-bold text-[#e8b323] text-xl">£{Math.round(totalDeposit / 100)}</span>
                                    </div>
                                  </>
                                )}
                              </div>
                              <div className="mt-4 bg-blue-900/20 border border-blue-700/30 rounded-lg p-3 inline-block max-w-sm">
                                <p className="text-sm text-blue-200">
                                  {isInstallmentsMode ? (
                                    <>💡 <strong>How it works:</strong> Pay your £{Math.round(totalDeposit / 100)} deposit now, then 3 monthly payments of £{Math.round(monthlyInstallment / 100)} will be charged automatically.</>
                                  ) : (
                                    <>💡 <strong>Important:</strong> Your £{Math.round(totalDeposit / 100)} deposit will be deducted from the final bill. You'll only pay the remaining balance after the job is complete.</>
                                  )}
                                </p>
                              </div>
                            </div>

                            {
                              stripePromise ? (
                                <Elements
                                  stripe={stripePromise}
                                  key={`${selectedEEEPackage}-${isInstallmentsMode ? 'installments' : 'full'}-${selectedExtras.join(',')}`}
                                >
                                  <PaymentForm
                                    amount={totalDeposit}
                                    customerName={quote.customerName || ''}
                                    customerEmail={quote.email || ''}
                                    quoteId={quote.id}
                                    selectedTier={quote.quoteMode === 'simple' ? 'simple' : (selectedEEEPackage || 'essential')}
                                    selectedTierPrice={totalWithFee}
                                    selectedExtras={selectedExtras}
                                    paymentType={isInstallmentsMode ? 'installments' : 'full'}
                                    onSuccess={handleBooking}
                                    onError={(error) => {
                                      toast({
                                        title: 'Payment Failed',
                                        description: error,
                                        variant: 'destructive',
                                      });
                                    }}
                                  />
                                </Elements>
                              ) : (
                                <div className="text-center p-4 bg-red-900/20 border border-red-500 rounded-lg">
                                  <p className="text-red-400">Payment system is not configured. Please contact support.</p>
                                </div>
                              )}
                          </>
                        );
                      })()}
                      <a
                        href="tel:07449501762"
                        className="block text-center text-gray-400 hover:text-[#e8b323] transition-colors text-sm underline mt-4"
                        data-testid="link-call-fallback"
                      >
                        Prefer to call? Click here
                      </a>
                    </div>
                  </CardContent>
                </Card>

                {/* Secure Payment Methods - Show after payment form */}
                <div className="mt-6 px-4">
                  <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-6">
                    <h3 className="text-xl font-bold text-white mb-4 text-center">Secure Payment Methods</h3>
                    <div className="flex justify-center items-center gap-3 flex-wrap">
                      <div className="bg-white rounded-lg px-4 py-2.5 shadow-md flex items-center justify-center" style={{ minWidth: '60px', height: '40px' }}>
                        <SiVisa className="text-[#1A1F71]" size={40} />
                      </div>
                      <div className="bg-white rounded-lg px-4 py-2.5 shadow-md flex items-center justify-center" style={{ minWidth: '60px', height: '40px' }}>
                        <SiMastercard className="text-[#EB001B]" size={40} />
                      </div>
                      <div className="bg-white rounded-lg px-4 py-2.5 shadow-md flex items-center justify-center" style={{ minWidth: '60px', height: '40px' }}>
                        <SiAmericanexpress className="text-[#006FCF]" size={40} />
                      </div>
                      <div className="bg-white rounded-lg px-4 py-2.5 shadow-md flex items-center justify-center" style={{ minWidth: '60px', height: '40px' }}>
                        <SiApplepay className="text-black" size={40} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null
          }

          {/* Sticky Running Total - Shows after "Approve and check dates" is clicked */}
          {
            quote?.segment === 'BUSY_PRO' && hasApprovedProduct && !hasBooked && (
              <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#7DB00E] backdrop-blur-lg border-t border-[#6da000] shadow-2xl safe-area-bottom">
                <div className="max-w-2xl mx-auto px-6 py-4 flex items-center justify-between">
                  <div className="flex flex-col">
                    <p className="text-xs text-white/80 font-medium uppercase tracking-wider">Running Total</p>
                    <p className="text-3xl font-bold text-white leading-none mt-1">
                      £{formatPrice(calculateSimpleTotal())}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-white/80">Complete your selections above</p>
                  </div>
                </div>
              </div>
            )
          }

          <style>{`
            .scrollbar-hide::-webkit-scrollbar { display: none; }
            .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
          `}</style>
        </div>
      </div>
    </div>
  );
}
