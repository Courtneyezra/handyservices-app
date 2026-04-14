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
import { ChevronLeft, ChevronRight, Clock, Check, Loader2, Star, Shield, Crown, Camera, PhoneCall, UserCheck, X, Zap, Lock, ShieldCheck, Wrench, User, Phone, Mail, MapPin, ChevronDown, Calendar, CalendarCheck, Sun, Clipboard, Calculator, CreditCard, Gift, Play, Truck, Award, Sparkles, Package, Download, Building, FileText } from 'lucide-react';
import { SiGoogle, SiVisa, SiMastercard, SiAmericanexpress, SiApplepay, SiStripe, SiKlarna } from 'react-icons/si';
import { FaWhatsapp, FaPaypal } from 'react-icons/fa';
import { useToast } from '@/hooks/use-toast';
import { PaymentForm } from '@/components/PaymentForm';
import { QuoteSkeleton } from '@/components/QuoteSkeleton';
import { Elements } from '@stripe/react-stripe-js';
import { stripePromise } from '@/lib/stripe';
// import handymanPhoto from '@assets/Untitled design (27)_1762913661129.png';
import handyServicesLogo from '../assets/handy-logo.webp';
import payIn3PromoImage from '../assets/pay-in-3-banner-original.webp';
import mikeProfilePhoto from '../assets/mike-profile-photo.webp';
import { NeonBadge } from '@/components/ui/neon-badge';
import { format } from 'date-fns';
// CountdownTimer removed - quotes no longer expire
import { ExpertStickyNote } from '@/components/ExpertStickyNote';
import { ScopeOfWorks, EstimatorFooter, ExpertSpecSheet } from '@/components/ExpertSpecSheet';
import { PaymentToggle } from '@/components/quote/PaymentToggle';
import { MobilePricingCard, KeyFeature } from '@/components/quote/MobilePricingCard';
import { getExpertNoteText, getLineItems, getScopeOfWorks } from "@/lib/quote-helpers";
import { generateQuotePDF } from "@/lib/quote-pdf-generator";
import { InstantActionQuote } from '@/components/InstantActionQuote';
import { ExpertAssessmentQuote } from '@/components/ExpertAssessmentQuote';
import { DatePricingCalendar, SchedulingTier } from '@/components/DatePricingCalendar';
import { TimeSlotSelector, TimeSlotType } from '@/components/TimeSlotSelector';

import { SectionWrapper } from '@/components/SectionWrapper';
import { StickyCTA } from '@/components/StickyCTA';
import { SingleProductQuote } from '@/components/quote/SingleProductQuote';
import { HassleComparisonCard } from '@/components/quote/HassleComparisonCard';
import { BudgetQuoteInline } from '@/components/quote/BudgetQuoteInline';
import { UnifiedQuoteCard } from '@/components/quote/UnifiedQuoteCard';
import { BookingConfirmation } from '@/components/quote/BookingConfirmation';
import { ScarcityBanner } from '@/components/quote/ScarcityBanner';
import { QuoteTimer } from '@/components/quote/QuoteTimer';
import { QuoteTimerProvider, StickyTimerProgress } from '@/components/quote/QuoteTimerContext';
import type { LayoutTier, BookingMode, LineItemResult, BatchDiscount } from '../../../shared/contextual-pricing-types';
import {
  initQuotePageTracking,
  trackQuoteViewed,
  trackSectionViewed,
  trackBookingModeInteraction,
  trackCTAClick,
  trackPaymentCompleted,
  trackPricingLayers,
  trackScrollDepth,
  trackTimeOnPage,
} from '@/lib/quote-analytics';
import { identifyUser, capturePageView } from '@/lib/posthog';

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
      '💰 Fixed price — no clock-watching',
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
  LANDLORD: {
    // Single product - hassle-free landlord service
    handyFix: [
      'Quality workmanship',
      'Scheduled within 5 working days',
      'Invoice on completion',
      'Full cleanup included',
    ],
    // This is the tier shown (enhanced = "Landlord Service")
    hassleFree: [
      '💰 Fixed price — budget it as an expense',
      '⚡ Scheduled within 48-72 hours',
      '📸 Photo report included',
      '🔑 Tenant coordination available',
      '📄 Tax-ready invoice',
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
      '💰 Fixed price — budget it as an expense',
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
  EMERGENCY: {
    // EMERGENCY RESPONSE = Same-day attendance
    handyFix: [
      'Same-day attendance',
      'Problem contained',
      'Quote for permanent fix',
    ],
    hassleFree: [
      '🚨 Same-day attendance',
      '🔧 Problem contained',
      '📋 Quote for permanent fix',
      '🌙 Out-of-hours available',
    ],
    highStandard: [
      '🚨 Same-day attendance',
      '🔧 Permanent fix same day',
      '🌙 Out-of-hours available',
      '⚡ Priority over other jobs',
    ]
  },
  TRUST_SEEKER: {
    // STANDARD = Basic reliable service
    handyFix: [
      'Quality workmanship',
      'Full cleanup included',
      'Scheduled within 2 weeks',
      'Clear communication throughout',
    ],
    // TRUSTED SERVICE = Anchor tier (trust + safety)
    hassleFree: [
      '🛡️ DBS-checked tradesperson',
      '📞 We call before arrival',
      '💬 Clear explanation of work',
      '🧹 Thorough cleanup guaranteed',
      '✅ Fixed price (no hourly)',
    ],
    // SAME PERSON = Continuity
    highStandard: [
      '🛡️ DBS-checked tradesperson',
      '📞 We call before arrival',
      '💬 Clear explanation of work',
      '🧹 Thorough cleanup guaranteed',
      '✅ Fixed price (no hourly)',
      '👤 Same person for future jobs',
    ]
  },
  OLDER_WOMAN: {
    // Single product - trust & safety focused for older customers
    handyFix: [
      'Quality workmanship',
      'Full cleanup included',
      'Scheduled within 2 weeks',
      'Clear communication throughout',
    ],
    // This is the tier shown (enhanced = "Peace of Mind Service")
    hassleFree: [
      '🛡️ DBS-checked & ID shown on arrival',
      '📞 We call 30 minutes before arriving',
      '💬 Patient explanation before we start',
      '🧹 Overshoes & dust sheets — no mess',
      '✅ Fixed price — no surprises',
    ],
    highStandard: [
      '🛡️ DBS-checked & ID shown on arrival',
      '📞 We call 30 minutes before arriving',
      '💬 Patient explanation before we start',
      '🧹 Overshoes & dust sheets — no mess',
      '✅ Fixed price — no surprises',
      '👤 Same tradesperson for future jobs',
    ]
  },
  RENTER: {
    // RENTER SERVICE = Transparent, landlord-ready
    handyFix: [
      'Fixed quote upfront',
      'Photo before/after',
      'Landlord-ready invoice',
    ],
    hassleFree: [
      '📋 Fixed quote upfront',
      '📸 Photo before/after',
      '🧾 Landlord-ready invoice',
      '📧 Invoice landlord directly',
    ],
    highStandard: [
      '📋 Fixed quote upfront',
      '📸 Photo before/after',
      '🧾 Landlord-ready invoice',
      '📧 Invoice landlord directly',
      '📄 Detailed condition report',
    ]
  }
};

// SEGMENT_DISPLAY_CONFIG removed — EVE single-price model, all segments use UnifiedQuoteCard

// SEGMENT_TIER_NAMES removed — EVE single-price model, tier names come from SchedulingConfig.priceLabel

// getPerksForTier removed — EVE single-price model, features shown via UnifiedQuoteCard/SchedulingConfig

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
  depositPaidAt?: Date | string;
  depositAmountPence?: number;
  selectedDate?: Date | string | null;
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
  segment?: 'EMERGENCY' | 'BUSY_PRO' | 'PROP_MGR' | 'LANDLORD' | 'SMALL_BIZ' | 'TRUST_SEEKER' | 'RENTER' | 'DIY_DEFERRER' | 'CONTEXTUAL';

  // Dynamic Tier Config (from Value Pricing Engine)
  essential?: { name: string; description: string };
  hassleFree?: { name: string; description: string };
  highStandard?: { name: string; description: string };

  // Phase 1 Segmentation Fields
  jobType?: 'SINGLE' | 'COMPLEX' | 'MULTIPLE';
  quotability?: 'INSTANT' | 'VIDEO' | 'VISIT';

  // Contextual Pricing Engine fields (Phase 5a)
  layoutTier?: LayoutTier;
  contextualHeadline?: string;
  contextualMessage?: string;
  valueBullets?: string[];
  bookingModes?: BookingMode[];
  requiresHumanReview?: boolean;
  reviewReason?: string;
  pricingLineItems?: LineItemResult[];
  batchDiscount?: BatchDiscount;
  finalPricePence?: number;
  subtotalPence?: number;
  /** Dead zone framing note (shown near price when quote lands in £100-£200 band) */
  deadZoneFraming?: string;

  // Context signals (Phase 5b)
  contextSignals?: {
    urgency?: string;
    isReturningCustomer?: boolean;
    [key: string]: unknown;
  };

  // Content library selections (Phase 5c)
  selectedContent?: {
    guarantee: { id: number; title: string; copy: string; icon?: string } | null;
    testimonials: { id: number; author: string; location?: string; text: string; rating?: number; jobCategory?: string }[];
    hassleItems: { id: number; heading: string; body: string }[];
    claims: { id: number; text: string; category?: string }[];
    images: { id: number; url: string; alt?: string; context?: string }[];
  } | null;
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
      subtitle: <>Fixed price, no clock-watching.<br />Priority scheduling available this week.</>,
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
        { icon: 'Lock', title: "No Price Surprises", text: "No 'oh, that'll be extra'. The price is fixed before we start." },
        { icon: 'Clock', title: "No Rearranging Your Day", text: "You pick the slot. We arrive on time — no half-day windows." },
        { icon: 'Shield', title: "No Risk If It's Not Perfect", text: "Not right? We return and fix it free. 90-day guarantee." }
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
      mainTitle: "No Chasing. No Site Visits. No Invoice Drama.",
      description: "Stop chasing tradesmen, driving to properties, and waiting for paperwork. One text, we handle the rest.",
      boxText: "One vendor. Every property. Zero chasing.",
      badges: [
        { label: 'Response', value: '24-48hr SLA', icon: 'Clock' },
        { label: 'Billing', value: 'Monthly Net 30', icon: 'Lock' },
        { label: 'Reports', value: 'Photo Docs', icon: 'Camera' },
        { label: 'Scale', value: 'Multi-Property', icon: 'Shield' }
      ]
    }
  },
  LANDLORD: {
    hero: {
      title: "Your Rental. Handled.",
      subtitle: "Tax-deductible maintenance. Photo proof for deposit disputes.",
      scrollText: "See what's included"
    },
    proof: {
      title: "BUILT FOR LANDLORDS",
      mainTitle: "You don't need to be there.",
      description: "Photo proof of every job, tenant coordination if needed, and a proper invoice for your records. Text us the problem, we handle the rest.",
      mapOverlayText: "Covering your area",
      testimonial: {
        text: "I live 2 hours away. They coordinated with my tenant, sent photos, invoice was in my email by 5pm. Exactly what I needed.",
        author: "Mark T.",
        detail: "Landlord, 2 rental properties"
      }
    },
    guarantee: {
      title: "LANDLORD READY",
      mainTitle: "No Driving Over. No Middleman. No Chasing.",
      description: "No 2-hour drive to check the work. No playing phone tag between tenant and tradesman. No chasing for receipts at tax time.",
      boxText: "Photo proof. Proper invoice. Zero chasing.",
      badges: [
        { label: 'Response', value: '48-72hr', icon: 'Clock' },
        { label: 'Proof', value: 'Photo Report', icon: 'Camera' },
        { label: 'Invoice', value: 'Tax-Ready', icon: 'Lock' },
        { label: 'Access', value: 'Tenant Coord', icon: 'Shield' }
      ]
    }
  },
  SMALL_BIZ: {
    hero: {
      title: "Fixed Tonight. Open Tomorrow.",
      subtitle: "Zero disruption. Fixed price. No clock-watching.",
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
      title: "ZERO DISRUPTION",
      mainTitle: "No Closing the Shop. No Lost Revenue.",
      description: "No shutting down during trading hours. No customers seeing the chaos. We work when you're closed — open tomorrow to a finished job.",
      boxText: "After-hours service. Zero disruption. Customers never know.",
      badges: [
        { label: 'Schedule', value: 'After-Hours', icon: 'Clock' },
        { label: 'Invoice', value: 'VAT Invoice', icon: 'Lock' },
        { label: 'Safety', value: 'RAMS Ready', icon: 'Shield' },
        { label: 'Quality', value: 'Commercial', icon: 'Star' }
      ]
    }
  },
  EMERGENCY: {
    hero: {
      title: "We're On Our Way",
      subtitle: <>Emergency response.<br />Same-day attendance.</>,
      scrollText: "Get Help Now"
    },
    proof: {
      title: "EMERGENCY RESPONSE",
      mainTitle: "Fast Response When It Matters.",
      testimonial: {
        text: "Water everywhere at 6pm. They were here by 7:30, leak stopped, mess cleaned up.",
        author: "Helen R.",
        detail: "Emergency Leak"
      },
      description: "When you need help fast, we're there.",
      stats: [
        { value: "2hr", label: "Avg Response", subtext: "Same Day" },
        { value: "24/7", label: "Available", subtext: "Out-of-Hours" },
        { value: "4.9", label: "Rating", subtext: "Emergency Jobs" }
      ]
    },
    guarantee: {
      title: "EMERGENCY GUARANTEE",
      mainTitle: <span className="font-bold block leading-tight">If we can't fix it,<br className="md:hidden" /> you don't pay the callout.</span>,
      description: "We contain the problem and quote for the permanent fix. No hidden charges.",
      boxText: "Problem contained. Quote provided.",
      guaranteeItems: [
        { icon: 'Zap', title: "Same-Day", text: "We attend the same day you call." },
        { icon: 'Shield', title: "Contained", text: "We stop the damage and prevent further issues." },
        { icon: 'FileText', title: "Clear Quote", text: "Full quote for permanent repair before we leave." }
      ],
      badges: [
        { label: 'Speed', value: 'Same-Day', icon: 'Zap' },
        { label: 'Safety', value: 'Insured', icon: 'Shield' },
        { label: 'Hours', value: '24/7', icon: 'Clock' },
        { label: 'Quality', value: 'Pro', icon: 'Star' }
      ]
    },
  },
  TRUST_SEEKER: {
    hero: {
      title: "Someone You Can Trust",
      subtitle: <>Vetted, patient, respectful.<br />We take our time to do it right.</>,
      scrollText: "View your quote"
    },
    proof: {
      title: "CUSTOMER TESTIMONIAL",
      mainTitle: "See what our customers say.",
      testimonial: {
        text: "Since my husband passed, I've been nervous about tradesmen. They were patient, explained everything, cleaned up beautifully.",
        author: "Margaret H.",
        detail: "Repeat Customer"
      },
      description: "We understand inviting someone into your home requires trust.",
      stats: [
        { value: "100%", label: "DBS Checked", subtext: "Safe & Verified" },
        { value: "4.9", label: "Rating", subtext: "Local Reviews" },
        { value: "100%", label: "Fixed Price", subtext: "No Hourly" }
      ]
    },
    guarantee: {
      title: "PEACE OF MIND",
      mainTitle: <span className="font-bold block leading-tight">Respect for you <br className="md:hidden" /> and your home.</span>,
      description: "We understand inviting someone into your home requires trust. We take that seriously.",
      image: "/assets/quote-images/older-person-door.webp",
      boxText: "Polite. Clean. Safe.",
      guaranteeItems: [
        { icon: 'Shield', title: "Safety First", text: "All staff are DBS-checked and ID-verified for your peace of mind." },
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
  OLDER_WOMAN: {
    hero: {
      title: "Someone You Can Trust",
      subtitle: <>Vetted, friendly, and here to help.<br />We take our time to do it right.</>,
      scrollText: "View your quote"
    },
    proof: {
      title: "YOU'RE IN SAFE HANDS",
      mainTitle: "We treat your home like our own.",
      testimonial: {
        text: "They showed ID at the door, explained everything clearly, wore overshoes the whole time, and left everything spotless. I felt completely safe.",
        author: "Patricia D.",
        detail: "Repeat Customer"
      },
      description: "We understand inviting someone into your home is a big decision. That's why all our team are DBS-checked, ID-verified, and trained to be patient and respectful.",
      stats: [
        { value: "100%", label: "DBS Checked", subtext: "Safe & Verified" },
        { value: "4.9", label: "Google rating", subtext: "★★★★★" },
        { value: "100%", label: "Fixed Price", subtext: "No Hidden Fees" }
      ]
    },
    guarantee: {
      title: "PEACE OF MIND",
      mainTitle: <span className="font-bold block leading-tight">Your comfort and safety<br className="md:hidden" /> come first.</span>,
      description: "We know it matters who you let into your home. Every member of our team is vetted, polite, and takes the time to explain everything clearly.",
      image: "/assets/quote-images/door-greeting.webp",
      boxText: "Safe. Clean. Respectful.",
      guaranteeItems: [
        { icon: 'Shield', title: "Vetted & Verified", text: "All staff are DBS-checked and show ID on arrival. Your safety is our priority." },
        { icon: 'Sparkles', title: "Clean & Tidy", text: "We wear overshoes and use dust sheets. We always leave your home spotless." },
        { icon: 'Phone', title: "We Call Ahead", text: "We phone 30 minutes before arriving so you're never caught off guard." }
      ],
      badges: [
        { label: 'Safety', value: 'DBS Checked', icon: 'Shield' },
        { label: 'Tidiness', value: 'Spotless', icon: 'Sparkles' },
        { label: 'Price', value: 'Fixed', icon: 'Lock' },
        { label: 'Guarantee', value: '12 Months', icon: 'Star' }
      ]
    }
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
  RENTER: {
    hero: {
      title: "Your Rental. Fixed Right.",
      subtitle: "We can invoice your landlord directly.",
      scrollText: "See Your Quote"
    },
    proof: {
      title: "RENTER-FRIENDLY",
      mainTitle: "Renter-Friendly Service.",
      description: "Fixed prices, proper invoices, photo proof. Everything you need for your landlord.",
      mapOverlayText: "Live in your area",
      testimonial: {
        text: "They sent photos and a proper invoice to my landlord. Got reimbursed the same week.",
        author: "Tom S.",
        detail: "Renter"
      }
    },
    guarantee: {
      title: "DEPOSIT PROTECTION",
      mainTitle: "Protect Your Deposit",
      description: "Photo documentation and detailed reports protect you at checkout.",
      boxText: "Photo proof on every job. Landlord-ready invoice.",
      badges: [
        { label: 'Photos', value: 'Included', icon: 'Camera' },
        { label: 'Invoice', value: 'Landlord-Ready', icon: 'FileText' },
        { label: 'Price', value: 'Fixed', icon: 'Lock' },
        { label: 'Warranty', value: '30 Days', icon: 'Shield' }
      ]
    }
  },
  CONTEXTUAL: {
    hero: {
      title: '', // Will be overridden by contextualHeadline
      subtitle: '',
      scrollText: 'See your personalised quote below',
    },
    proof: {
      title: 'TRUSTED LOCALLY',
      mainTitle: 'Trusted by Nottingham homeowners',
      description: 'Join hundreds of satisfied customers',
      testimonial: {
        text: 'Turned up on time, great quality work, left the place spotless. Will definitely use again.',
        author: 'Sarah M.',
        detail: 'Nottingham',
      },
      stats: [
        { value: '4.9', label: 'Google Rating', subtext: '★★★★★' },
        { value: '500+', label: 'Completed Jobs', subtext: 'and counting' },
        { value: '£2M', label: 'Insured', subtext: 'fully covered' },
      ],
    },
    guarantee: {
      title: 'OUR GUARANTEE',
      mainTitle: <span className="font-bold block leading-tight">Not right? We return<br /> and fix it free.</span>,
      description: 'Quality workmanship, full cleanup, and photo report on every job. No questions asked.',
      boxText: 'Quality guaranteed. No hidden fees.',
      guaranteeItems: [
        { icon: 'Shield', title: 'Quality Guaranteed', text: 'Quality workmanship on every job, backed by our guarantee.' },
        { icon: 'Sparkles', title: 'Full Cleanup', text: 'We leave your home spotless. Every time.' },
        { icon: 'Camera', title: 'Photo Report', text: 'Photo documentation on completion so you can see the results.' },
      ],
      badges: [
        { label: 'Insured', value: '£2M', icon: 'Shield' },
        { label: 'Vetted', value: 'DBS Checked', icon: 'UserCheck' },
        { label: 'Price', value: 'Fixed', icon: 'Lock' },
        { label: 'Quality', value: 'Guaranteed', icon: 'Star' },
      ],
    },
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
  const isInView = useInView(ref, { once: true, margin: "100px" });
  const springValue = useSpring(0, { duration: 1200, bounce: 0 });

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

// Extracted Google Reviews Carousel Component (fixes React hooks-in-IIFE violation)
const GoogleReviewCard = ({ postcode, variant = 'light' }: { postcode?: string | null; variant?: 'light' | 'dark' }) => {
  const { data: reviewsData, isLoading } = useQuery({
    queryKey: ['google-reviews', variant, postcode],
    queryFn: async () => {
      const location = postcode ? postcode.split(' ')[0] : 'nottingham';
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
    }, variant === 'light' ? 6000 : 5000);
    return () => clearInterval(interval);
  }, [reviewsData, variant]);

  const reviews = reviewsData?.reviews || [];
  const currentReview = reviews[activeIndex];

  if (isLoading || !currentReview) {
    if (variant === 'light') {
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
      <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 relative shadow-sm animate-pulse">
        <div className="h-4 bg-slate-200 rounded w-1/3 mb-4"></div>
        <div className="space-y-2">
          <div className="h-2 bg-slate-200 rounded w-full"></div>
          <div className="h-2 bg-slate-200 rounded w-5/6"></div>
        </div>
      </div>
    );
  }

  if (variant === 'light') {
    return (
      <div className="bg-slate-50 border border-slate-100 rounded-xl p-6 transition-all duration-500 h-[180px] overflow-hidden">
        <div className="flex justify-between items-start mb-3">
          <div className="flex gap-1 text-[#F4B400]">
            {[...Array(5)].map((_, i) => (
              <Star key={i} className={`w-3.5 h-3.5 ${i < currentReview.rating ? 'fill-current' : 'text-slate-300'}`} />
            ))}
          </div>
          <SiGoogle className="w-4 h-4 text-slate-400" />
        </div>
        <p className="text-slate-600 text-sm leading-relaxed mb-4 italic line-clamp-3">
          "{currentReview.text.length > 120 ? currentReview.text.substring(0, 120) + '...' : currentReview.text}"
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
  }

  // Dark variant
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
};

// Quick Social Proof for Warm Leads (Cialdini 1984)
const ValueSocialProof = ({ quote, pricingSettings }: { quote: PersonalizedQuote; pricingSettings?: { googleRating?: string; reviewCount?: number; propertiesServed?: string; jobsCompleted?: string } }) => {
  const segmentKey = quote.segment && SEGMENT_CONTENT_MAP[quote.segment] ? quote.segment : 'BUSY_PRO';
  const rawContent = SEGMENT_CONTENT_MAP[segmentKey].proof;

  // Dynamically replace hardcoded social proof values with configurable settings
  const content = {
    ...rawContent,
    stats: rawContent.stats?.map((stat: any) => {
      const v = stat.value;
      const l = (stat.label || '').toLowerCase();
      // Replace hardcoded Google rating
      if (v === '4.9' && (l.includes('google') || l.includes('rating'))) {
        return { ...stat, value: pricingSettings?.googleRating ?? '4.9' };
      }
      // Replace hardcoded jobs completed
      if (v === '500+' && l.includes('completed')) {
        return { ...stat, value: pricingSettings?.jobsCompleted ?? '500+' };
      }
      return stat;
    }),
  };

  // Icon mapping for stats
  const statIcons = [Zap, Star, UserCheck];

  // Determine location from postcode or address
  const postcode = quote.postcode?.toUpperCase() || '';
  const address = quote.address?.toLowerCase() || '';
  const postcodeArea = postcode.match(/^[A-Z]{1,2}/)?.[0] || '';
  const POSTCODE_CITIES: Record<string, string> = {
    NG: 'Nottingham', DE: 'Derby', LE: 'Leicester', S: 'Sheffield',
    B: 'Birmingham', M: 'Manchester', L: 'Liverpool', LS: 'Leeds',
    BS: 'Bristol', E: 'London', EC: 'London', N: 'London', W: 'London',
    SW: 'London', SE: 'London', NW: 'London', WC: 'London',
    CV: 'Coventry', NE: 'Newcastle', G: 'Glasgow', EH: 'Edinburgh',
    CF: 'Cardiff', BN: 'Brighton', SO: 'Southampton', OX: 'Oxford',
    CB: 'Cambridge', MK: 'Milton Keynes', PE: 'Peterborough',
  };
  const locationName =
    address.includes('derby') ? 'Derby' :
    address.includes('nottingham') ? 'Nottingham' :
    POSTCODE_CITIES[postcodeArea] || 'your area';

  // Derive customer type from vaContext for contextual H2
  const vaCtxSocial = ((quote as any).contextSignals?.vaContext || '').toLowerCase();
  const customerType =
    /landlord|rental|tenant|buy.to.let|btl|letting/.test(vaCtxSocial) ? 'landlords' :
    /property manager|portfolio|prop mgr|managing agent/.test(vaCtxSocial) ? 'property managers' :
    /office|business|company|commercial|shop/.test(vaCtxSocial) ? 'businesses' :
    /professional|busy exec|corporate/.test(vaCtxSocial) ? 'professionals' :
    'homeowners';

  const socialProofTitle = `Trusted by ${locationName} ${customerType}`;

  // Lazy load Wistia scripts — only when video section enters viewport
  const videoRef = useRef<HTMLDivElement>(null);
  const [wistiaLoaded, setWistiaLoaded] = useState(false);
  useEffect(() => {
    if (wistiaLoaded || !videoRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
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
          setWistiaLoaded(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(videoRef.current);
    return () => observer.disconnect();
  }, [wistiaLoaded]);

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
            {socialProofTitle}
          </h2>
          <p className="text-slate-500 mb-8">
            {content.description}
          </p>

          {/* Social Proof Video - Trust Builder (lazy loaded) */}
          <div ref={videoRef} className="relative aspect-video rounded-2xl overflow-hidden bg-slate-900 shadow-xl mb-12 border-4 border-white/50 ring-1 ring-slate-900/10">
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
          <GoogleReviewCard postcode={quote.postcode} variant="light" />
        </div>
      </div>
    </SectionWrapper>
  );
};

/**
 * Pick the best hero background image based on vaContext and job type.
 * Uses local assets — DB-backed image selection to be wired later.
 */
function getHeroImage(quote: PersonalizedQuote): string {
  const vaCtx = ((quote as any).contextSignals?.vaContext || '').toLowerCase();
  const jobDesc = (quote.jobDescription || '').toLowerCase();
  const firstCategory = quote.pricingLineItems?.[0]?.category || '';

  // Archetype detection
  const isLandlord = /landlord|rental|tenant|buy.to.let|btl|letting/.test(vaCtx);
  const isElderly = /elderly|older|pensioner|senior/.test(vaCtx);

  // Job type detection
  const isPlumbing = /plumb|tap|leak|pipe|drain|toilet|shower|boiler/.test(jobDesc) ||
    firstCategory === 'plumbing_minor';
  const isPainting = /paint|decor|wall|colour|color/.test(jobDesc) ||
    firstCategory === 'painting';

  if (isElderly || isLandlord) return '/assets/quote-images/older-person-door.webp';
  if (isPlumbing) return '/assets/quote-images/plumber-smile.webp';
  if (isPainting) return '/assets/quote-images/painting.webp';
  return '/assets/quote-images/door-greeting.webp';
}

const ValueHero = ({ quote, config }: { quote: PersonalizedQuote, config: any }) => {
  // Get segment content
  const segmentKey = quote.segment && SEGMENT_CONTENT_MAP[quote.segment] ? quote.segment : 'DEFAULT';
  const content = { ...SEGMENT_CONTENT_MAP[segmentKey].hero };
  const isBusyPro = quote.segment === 'BUSY_PRO';
  const isOlderWoman = quote.segment === 'OLDER_WOMAN';
  const isContextual = quote.segment === 'CONTEXTUAL' || !!(quote?.layoutTier && quote?.valueBullets);

  // Contextual quotes: override hero title/subtitle with LLM-generated content
  if (isContextual) {
    if (quote.contextualHeadline) content.title = quote.contextualHeadline;
    if (quote.contextualMessage) content.subtitle = quote.contextualMessage;
  }

  // Generate natural language job description from line items
  const getJobTopLine = (): string => {
    if (quote?.jobs && Array.isArray(quote.jobs) && quote.jobs.length > 0) {
      const items: string[] = [];
      (quote.jobs as any[]).forEach((job: any) => {
        // Handle flat job structure (from live call popup)
        if (job.description && !job.tasks) {
          // Skip add-ons for hero text
          if (!job.description.startsWith('Add-on:')) {
            // Convert to natural language (lowercase, remove technical suffixes)
            let desc = job.description
              .replace(/\s*\([^)]*\)/g, '') // Remove parenthetical notes like "(2-4 Shelves)"
              .replace(/Installation/gi, 'installation')
              .replace(/Repair/gi, 'repair')
              .replace(/Replacement/gi, 'replacement')
              .trim();
            // Lowercase first letter for joining
            if (items.length > 0) {
              desc = desc.charAt(0).toLowerCase() + desc.slice(1);
            }
            items.push(desc);
          }
        }
        // Handle nested tasks structure (from other quote generators)
        else if (job.tasks && Array.isArray(job.tasks)) {
          job.tasks.forEach((task: any) => {
            const taskDesc = task.deliverable || task.description;
            if (taskDesc) {
              items.push(taskDesc);
            }
          });
        }
      });

      if (items.length === 0) {
        return quote?.jobDescription || 'Your handyman job';
      } else if (items.length === 1) {
        return items[0];
      } else if (items.length === 2) {
        return `${items[0]} and ${items[1]}`;
      } else {
        // "X, Y, and Z" or "X, Y, plus Z"
        const lastItem = items[items.length - 1];
        const otherItems = items.slice(0, -1);
        return `${otherItems.join(', ')}, plus ${lastItem}`;
      }
    }
    return quote?.jobDescription || 'Your handyman job';
  };

  return (
    <SectionWrapper className={`relative overflow-hidden`}>
      {/* Background Image with Overlay */}
      <div className="absolute inset-0 z-0 select-none">
        <img
          src={getHeroImage(quote)}
          alt="Friendly Plumber"
          className="w-full h-full object-cover opacity-50 contrast-125"
          style={{ objectPosition: 'center 30%' }}
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

        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-4 drop-shadow-sm text-white leading-tight">
          Hi {quote.customerName.split(' ')[0]},
        </h1>

        {/* Contextual headline — punchy outcome statement, only for contextual quotes */}
        {isContextual && content.title && (
          <p className="text-2xl font-bold text-white/90 italic mb-3 drop-shadow-sm">
            "{content.title}"
          </p>
        )}

        {/* Job line — only for non-contextual quotes (contextual quotes show line items in pricing card) */}
        {!isContextual && (
          <p className="text-slate-400 text-sm mb-6 px-4 md:px-0">
            {getJobTopLine()}
          </p>
        )}

        {/* Quote Prepared By */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-[#7DB00E] shadow-xl">
            <img src="/assets/quote-images/ben-estimator.webp" alt="Ben" className="w-full h-full object-cover" />
          </div>
          <div className="text-left">
            <div className="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-0.5">Prepared by</div>
            <div className="text-white font-bold text-lg leading-none">Ben <span className="text-[#7DB00E] text-sm font-normal">from HandyServices</span></div>
          </div>
        </div>

      </motion.div>
      {/* Timer progress bar at bottom of hero */}
      <div className="absolute bottom-0 left-0 right-0 z-10">
        <StickyTimerProgress />
      </div>
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
              <GoogleReviewCard postcode={quote.postcode} variant="dark" />
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
  const content = { ...SEGMENT_CONTENT_MAP[segmentKey].guarantee };
  const isBusyPro = quote.segment === 'BUSY_PRO';
  const isOlderWoman = quote.segment === 'OLDER_WOMAN';
  const isContextualGuarantee = quote.segment === 'CONTEXTUAL' || !!(quote?.layoutTier && quote?.valueBullets);

  // For contextual quotes, override mainTitle based on customerType from vaContext
  if (isContextualGuarantee) {
    const vaCtx = ((quote as any).contextSignals?.vaContext || '').toLowerCase();
    const isLandlord = /landlord|rental|tenant|buy.to.let|btl|letting/.test(vaCtx);
    const isProfessional = /property manager|portfolio|prop mgr|managing agent|professional|busy exec|corporate|office|business|company|commercial|shop/.test(vaCtx);
    if (isLandlord) {
      content.mainTitle = 'Your property protected. 90-day guarantee.';
    } else if (isProfessional) {
      content.mainTitle = 'Zero hassle. 90-day guarantee.';
    } else {
      content.mainTitle = <span className="font-bold block leading-tight">Not right? We return<br /> and fix it free.</span>;
    }
  }

  // Icon mapping
  const iconMap: Record<string, any> = {
    'Wrench': Wrench,
    'Shield': Shield,
    'UserCheck': UserCheck,
    'Lock': Lock,
    'Clock': Clock,
    'Zap': Zap,
    'Star': Star,
    'Sparkles': Sparkles,
    'Phone': Phone,
  };

  return (
    <SectionWrapper className={`bg-[#1D2D3D] text-white relative`}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "50px" }}
        transition={{ duration: 0.5 }}
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
                  loading="lazy"
                />
                {/* Badge Overlay */}
                <div className="absolute bottom-4 right-4 z-20">
                  <div className="bg-[#7DB00E] text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg border border-white/20">
                    Verified Pro
                  </div>
                </div>
              </div>
            ) : (
              // Rectangular contractor image — contextual engine picks image based on job type
              <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-slate-900 shadow-xl border-4 border-white/10 ring-1 ring-slate-900/10 group">
                <div className="absolute inset-0 bg-gradient-to-t from-[#1D2D3D] via-transparent to-transparent opacity-60 z-10" />
                <img
                  src={getHeroImage(quote)}
                  alt="Professional handyman at work"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                  loading="lazy"
                />
                <div className="absolute bottom-4 right-4 z-20">
                  <div className="bg-[#7DB00E] text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg border border-white/20">
                    Verified Pro
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <h2 className="text-[#7DB00E] text-xs font-bold uppercase tracking-[0.2em] mb-4">{content.title}</h2>
        <h3 className="text-4xl md:text-5xl font-light mb-8 text-white">{content.mainTitle}</h3>

        <p className="text-slate-300 text-sm md:text-base mb-6">{content.description}</p>

        {/* Certainty Items — BUSY_PRO & OLDER_WOMAN (Kahneman & Tversky, 1979) */}
        {(isBusyPro || isOlderWoman) && content.guaranteeItems && (
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

// ---------------------------------------------------------------------------
// Contextual Quote Layout (Phase 5a)
// Renders contextual quotes with Quick/Standard/Complex layout tiers.
// ---------------------------------------------------------------------------

interface ContextualQuoteLayoutProps {
  quote: PersonalizedQuote;
  formatPrice: (priceInPence: number) => number;
  handleBooking: (paymentIntentId: string) => Promise<void>;
  isBooking: boolean;
  hasBooked: boolean;
  selectedDate: Date | undefined;
  setSelectedDate: (d: Date | undefined) => void;
  selectedTimeSlot: 'AM' | 'PM' | undefined;
  setSelectedTimeSlot: (s: 'AM' | 'PM' | undefined) => void;
  showPaymentForm: boolean;
  setShowPaymentForm: (v: boolean) => void;
  selectedEEEPackage: EEEPackageTier | null;
  setSelectedEEEPackage: (t: EEEPackageTier | null) => void;
  pricingSettings?: { googleRating?: string; reviewCount?: number; propertiesServed?: string; jobsCompleted?: string };
  getTimeOnPage?: () => number;
}

/** Hardcoded Google reviews for Standard/Complex layouts */
const GOOGLE_REVIEWS = [
  {
    text: "Turned up on time, great quality work, left the place spotless. Will definitely use again.",
    author: "Sarah M.",
    detail: "Nottingham",
  },
  {
    text: "Fixed everything on the list in one visit. Professional, friendly, and fair price.",
    author: "David T.",
    detail: "West Bridgford",
  },
  {
    text: "Brilliant service start to finish. Communicated well, no hidden costs, top quality work.",
    author: "James R.",
    detail: "Beeston",
  },
];

/** Category badge display names */
const CATEGORY_LABELS: Record<string, string> = {
  general_fixing: 'General Fixing',
  flat_pack: 'Flat Pack Assembly',
  tv_mounting: 'TV Mounting',
  carpentry: 'Carpentry',
  plumbing_minor: 'Plumbing',
  electrical_minor: 'Electrical',
  painting: 'Painting',
  tiling: 'Tiling',
  plastering: 'Plastering',
  lock_change: 'Lock Change',
  guttering: 'Guttering',
  pressure_washing: 'Pressure Washing',
  fencing: 'Fencing',
  garden_maintenance: 'Garden',
  bathroom_fitting: 'Bathroom',
  kitchen_fitting: 'Kitchen',
  door_fitting: 'Door Fitting',
  flooring: 'Flooring',
  curtain_blinds: 'Curtain & Blinds',
  silicone_sealant: 'Sealant Work',
  shelving: 'Shelving',
  furniture_repair: 'Furniture Repair',
  waste_removal: 'Waste Removal',
  other: 'Other',
};

/** Shared trust strip used across all contextual layouts */
function ContextualTrustStrip({ showRiskReversal = false, googleRating, reviewCount }: { showRiskReversal?: boolean; googleRating?: string; reviewCount?: number }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-slate-500 py-3">
        <span className="flex items-center gap-1">
          <Shield className="w-3.5 h-3.5 text-slate-400" />
          £2M Insured
        </span>
        <span className="text-slate-300">·</span>
        <span className="flex items-center gap-1">
          <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
          {googleRating ?? "4.9"} Google ({reviewCount ?? 127} reviews)
        </span>
        <span className="text-slate-300">·</span>
        <span className="flex items-center gap-1">
          <Lock className="w-3.5 h-3.5 text-slate-400" />
          Fixed Price
        </span>
      </div>
      {showRiskReversal && (
        <p className="text-xs text-center text-slate-500 italic">
          Not right? We return and fix it free. No questions.
        </p>
      )}
    </div>
  );
}

/** Simple Book Now CTA — single button, date selection happens after */
function ContextualBookNowButton({ onClick, label = 'Book Now' }: { onClick?: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      className="w-full py-4 px-6 bg-amber-500 hover:bg-amber-600 text-white font-bold text-lg rounded-xl shadow-lg hover:shadow-xl transition-all"
    >
      {label}
    </button>
  );
}

/** Value bullets list with checkmark icons */
function ValueBulletsList({ bullets }: { bullets: string[] }) {
  return (
    <ul className="space-y-2.5">
      {bullets.map((bullet, i) => (
        <li key={i} className="flex items-start gap-2.5">
          <div className="w-5 h-5 rounded-full bg-[#7DB00E]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Check className="w-3 h-3 text-[#7DB00E]" />
          </div>
          <span className="text-sm text-slate-700">{bullet}</span>
        </li>
      ))}
    </ul>
  );
}

/** Line items breakdown table with Job / Time / Price columns */
function PricingLineItems({
  lineItems,
  batchDiscount,
  formatPrice,
}: {
  lineItems: LineItemResult[];
  batchDiscount?: BatchDiscount;
  formatPrice: (p: number) => number;
}) {
  const formatTime = (minutes: number) => {
    if (minutes < 60) return `${minutes}m`;
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  };

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Price Breakdown</h3>
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Job</p>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right w-12">Time</p>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider text-right w-14">Price</p>
        </div>

        {/* Line items */}
        {lineItems.map((item, i) => (
          <div
            key={item.lineId}
            className={`grid grid-cols-[1fr_auto] gap-2 items-center px-4 py-3 ${
              i < lineItems.length - 1 ? 'border-b border-slate-100' : ''
            }`}
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800 leading-snug">{item.description}</p>
              <Badge variant="secondary" className="mt-1 text-[10px] font-medium">
                {CATEGORY_LABELS[item.category] || item.category}
              </Badge>
            </div>
            <p className="text-sm font-bold text-slate-900 text-right w-14">£{formatPrice(item.guardedPricePence)}</p>
          </div>
        ))}

        {/* Batch discount row */}
        {batchDiscount?.applied && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-[#7DB00E]/5">
            <div className="flex items-center gap-2">
              <Gift className="w-4 h-4 text-[#7DB00E]" />
              <p className="text-sm font-medium text-[#7DB00E]">
                Multi-job discount ({batchDiscount.discountPercent}% off)
              </p>
            </div>
            <p className="text-sm font-bold text-[#7DB00E]">
              -£{formatPrice(batchDiscount.savingsPence)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Categorised line items — groups by category with per-section subtotals */
function CategorisedPricingLineItems({
  lineItems,
  batchDiscount,
  formatPrice,
}: {
  lineItems: LineItemResult[];
  batchDiscount?: BatchDiscount;
  formatPrice: (p: number) => number;
}) {
  const formatTime = (minutes: number) => {
    if (minutes < 60) return `${minutes}m`;
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  };

  // Group line items by category
  const grouped = lineItems.reduce<Record<string, LineItemResult[]>>((acc, item) => {
    const cat = item.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  const categories = Object.entries(grouped);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Price Breakdown</h3>
      <div className="space-y-3">
        {categories.map(([category, items]) => {
          const subtotal = items.reduce((sum, item) => sum + item.guardedPricePence, 0);
          return (
            <div key={category} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              {/* Category header */}
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wrench className="w-3.5 h-3.5 text-slate-400" />
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                    {CATEGORY_LABELS[category] || category}
                  </p>
                </div>
                <p className="text-xs font-bold text-slate-700">£{formatPrice(subtotal)}</p>
              </div>

              {/* Items in this category */}
              {items.map((item, i) => (
                <div
                  key={item.lineId}
                  className={`grid grid-cols-[1fr_auto] gap-2 items-center px-4 py-3 ${
                    i < items.length - 1 ? 'border-b border-slate-100' : ''
                  }`}
                >
                  <p className="text-sm text-slate-700 leading-snug min-w-0">{item.description}</p>
                  <p className="text-sm font-semibold text-slate-800 text-right w-14">£{formatPrice(item.guardedPricePence)}</p>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Batch discount callout */}
      {batchDiscount?.applied && (
        <div className="flex items-center justify-between px-4 py-3 bg-[#7DB00E]/5 border border-[#7DB00E]/20 rounded-xl">
          <div className="flex items-center gap-2">
            <Gift className="w-4 h-4 text-[#7DB00E]" />
            <p className="text-sm font-medium text-[#7DB00E]">
              Multi-job discount ({batchDiscount.discountPercent}% off)
            </p>
          </div>
          <p className="text-sm font-bold text-[#7DB00E]">
            -£{formatPrice(batchDiscount.savingsPence)}
          </p>
        </div>
      )}
    </div>
  );
}

type ReviewForCard = { text: string; author: string; detail?: string; location?: string };

/** Google review card */
function ContextualGoogleReviewCard({ review }: { review: ReviewForCard }) {
  const byline = review.location || review.detail;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex gap-0.5 mb-2">
        {[...Array(5)].map((_, i) => (
          <Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
        ))}
      </div>
      <p className="text-sm text-slate-600 italic">"{review.text}"</p>
      <p className="text-xs text-slate-400 mt-2">— {review.author}{byline ? `, ${byline}` : ''}</p>
    </div>
  );
}

/** Photo gallery placeholder section */
function PhotoGalleryPlaceholder() {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Our Work</h3>
      <div className="grid grid-cols-2 gap-2">
        <div className="aspect-video bg-slate-100 rounded-lg flex items-center justify-center border border-slate-200">
          <span className="text-slate-400 text-xs">Gallery coming soon</span>
        </div>
        <div className="aspect-video bg-slate-100 rounded-lg flex items-center justify-center border border-slate-200">
          <span className="text-slate-400 text-xs">Gallery coming soon</span>
        </div>
      </div>
    </section>
  );
}

/** Human review banner — shown to customer when AI parser fell back */
function HumanReviewBanner({ reason }: { reason?: string }) {
  const [searchParams] = useState(() => new URLSearchParams(window.location.search));
  const isAdmin = searchParams.get('admin') === 'true';
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
      <div className="w-5 h-5 rounded-full bg-amber-200 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Clock className="w-3 h-3 text-amber-700" />
      </div>
      <div>
        <p className="text-sm font-semibold text-amber-800">
          This quote is being reviewed by our team. We'll confirm shortly.
        </p>
        {isAdmin && reason && <p className="text-xs text-amber-600 mt-1">{reason}</p>}
      </div>
    </div>
  );
}

/** Main contextual quote layout router — picks Quick/Standard/Complex */
function ContextualQuoteLayout({
  quote,
  formatPrice,
  handleBooking,
  isBooking,
  hasBooked,
  selectedDate,
  setSelectedDate,
  selectedTimeSlot,
  setSelectedTimeSlot,
  showPaymentForm,
  setShowPaymentForm,
  selectedEEEPackage,
  setSelectedEEEPackage,
  pricingSettings,
  getTimeOnPage,
}: ContextualQuoteLayoutProps) {

  const totalPrice = quote.finalPricePence || quote.basePrice || 0;
  // Helper for CTA tracking within this sub-component
  const trackingRef = { current: { getTimeOnPage: getTimeOnPage || (() => 0) } };
  const layoutTier = quote.layoutTier || 'standard';

  // Determine how many value bullets to show per tier
  const bulletLimit = layoutTier === 'quick' ? 3 : layoutTier === 'standard' ? 4 : 5;
  const displayBullets = (quote.valueBullets || []).slice(0, bulletLimit);

  // Contextual CTA copy — falls back to "Book Now"
  const ctaCopy = (() => {
    const signals = quote.contextSignals;
    if (signals?.urgency === 'emergency') return 'Book Emergency Slot';
    if (quote.selectedContent?.hassleItems?.some(h => h.heading?.toLowerCase().includes('tenant'))) return 'Sort My Rental';
    if (layoutTier === 'quick') return 'Book Now';
    return 'Get This Sorted';
  })();

  // Testimonials — content library if available, fall back to hardcoded
  const testimonialsToShow: ReviewForCard[] = quote.selectedContent?.testimonials?.length
    ? quote.selectedContent.testimonials.map(t => ({ text: t.text, author: t.author, location: t.location }))
    : GOOGLE_REVIEWS;

  // Guarantee copy — content library if available, fall back to hardcoded
  const guaranteeCopy = quote.selectedContent?.guarantee?.copy || 'Not right? We return and fix it free. No questions.';
  const guaranteeTitle = quote.selectedContent?.guarantee?.title || 'Our Guarantee';

  // Shared brand hero block
  const brandHero = (
    <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 text-center">
      <img src={handyServicesLogo} alt="HandyServices" className="h-8 mx-auto mb-4 opacity-90" />
      <h1 className="text-2xl sm:text-3xl font-bold text-white leading-tight">
        {quote.contextualHeadline || 'Your Quote'}
      </h1>
      {quote.contextualMessage && (
        <p className="text-slate-300 text-sm mt-2 leading-relaxed">{quote.contextualMessage}</p>
      )}
    </div>
  );

  // Shared Book Now CTA (amber/gold)
  const bookNowCTA = (
    <Button
      className="w-full h-14 text-lg font-bold bg-amber-500 hover:bg-amber-600 text-white rounded-xl shadow-lg shadow-amber-500/20 transition-all active:scale-[0.98]"
      disabled={isBooking}
      onClick={() => {
        trackCTAClick({
          quoteId: quote.id,
          shortSlug: quote.shortSlug,
          ctaType: 'book_now',
          segment: quote.segment || 'UNKNOWN',
          totalPricePence: totalPrice,
          timeOnPageMs: trackingRef.current?.getTimeOnPage() || 0,
        });
        setShowPaymentForm(true);
      }}
    >
      {isBooking ? (
        <span className="flex items-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          Processing...
        </span>
      ) : (
        ctaCopy
      )}
    </Button>
  );

  // Shared WhatsApp fallback
  const whatsappFallback = (
    <div className="text-center pb-4">
      <a
        href={`https://wa.me/447508744402?text=${encodeURIComponent(`Hi, I have a question about my quote (${quote.shortSlug})`)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-[#25D366] transition-colors"
        onClick={() => trackCTAClick({
          quoteId: quote.id,
          shortSlug: quote.shortSlug,
          ctaType: 'whatsapp_question',
          segment: quote.segment || 'UNKNOWN',
          totalPricePence: totalPrice,
          timeOnPageMs: trackingRef.current?.getTimeOnPage() || 0,
        })}
      >
        <FaWhatsapp className="w-4 h-4" />
        Questions? Message us
      </a>
    </div>
  );

  // Shared prominent price display
  const priceDisplay = (
    <div className="text-center py-4">
      <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-1">Total Price</p>
      <p className="text-5xl font-extrabold text-slate-900">
        £{formatPrice(totalPrice)}
      </p>
      <p className="text-xs text-slate-400 mt-1">Fixed price — no hidden extras</p>
      {quote.deadZoneFraming && (
        <p className="text-xs text-zinc-500 text-center mt-1 italic">
          {quote.deadZoneFraming}
        </p>
      )}
    </div>
  );

  // Common wrapper for all contextual layouts
  const pageWrapper = (children: React.ReactNode) => (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* Human review banner */}
      {quote.requiresHumanReview && (
        <div className="px-4 pt-4 max-w-xl mx-auto">
          <HumanReviewBanner reason={quote.reviewReason} />
        </div>
      )}

      <div className="max-w-xl mx-auto px-4 py-6 space-y-6">
        {children}
      </div>
    </div>
  );

  // =====================================================================
  // QUICK LAYOUT — 1 line item, one screen, clean and fast
  // =====================================================================
  if (layoutTier === 'quick') {
    return pageWrapper(
      <>
        <div data-track-section="hero">{brandHero}</div>
        <div data-track-section="price">{priceDisplay}</div>

        {/* Value bullets (max 3) */}
        {displayBullets.length > 0 && (
          <div data-track-section="value_bullets">
            <Card className="border-slate-200">
              <CardContent className="p-5">
                <ValueBulletsList bullets={displayBullets} />
              </CardContent>
            </Card>
          </div>
        )}

        <div data-track-section="book_cta">{bookNowCTA}</div>
        <div data-track-section="trust_strip"><ContextualTrustStrip googleRating={pricingSettings?.googleRating} reviewCount={pricingSettings?.reviewCount} /></div>
        {/* Batch nudge — show only for single job quotes */}
        {quote.pricingLineItems && quote.pricingLineItems.length === 1 && (
          <div className="text-center space-y-2 pt-2">
            <p className="text-xs text-zinc-500">Got more jobs? Add them to this visit</p>
            <a
              href={`https://wa.me/447508744402?text=${encodeURIComponent(`Hi, I'd like to add another job to my quote for ${quote.customerName}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-700 text-sm text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors"
            >
              <span>+</span>
              <span>Add another job to this visit</span>
            </a>
            <p className="text-xs text-zinc-600">One visit — everything sorted</p>
          </div>
        )}
        {whatsappFallback}
      </>
    );
  }

  // =====================================================================
  // STANDARD LAYOUT — 2-3 line items with table breakdown
  // =====================================================================
  if (layoutTier === 'standard') {
    return pageWrapper(
      <>
        <div data-track-section="hero">{brandHero}</div>

        {/* Line items breakdown table */}
        {quote.pricingLineItems && quote.pricingLineItems.length > 0 && (
          <div data-track-section="line_items">
            <PricingLineItems
              lineItems={quote.pricingLineItems}
              batchDiscount={quote.batchDiscount}
              formatPrice={formatPrice}
            />
          </div>
        )}

        {/* Batch savings callout (if applicable) */}
        {quote.batchDiscount?.applied && quote.batchDiscount.discountPercent > 0 && (
          <div data-track-section="batch_discount" className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
            <p className="text-sm font-medium text-amber-800">
              You save £{formatPrice(quote.batchDiscount.savingsPence)} by booking these jobs together
            </p>
          </div>
        )}

        {/* Total price (prominent) */}
        <div data-track-section="price">{priceDisplay}</div>

        {/* Value bullets (max 4) */}
        {displayBullets.length > 0 && (
          <div data-track-section="value_bullets">
            <Card className="border-slate-200">
              <CardContent className="p-5">
                <ValueBulletsList bullets={displayBullets} />
              </CardContent>
            </Card>
          </div>
        )}

        {/* Hassle items — why customers choose us */}
        {quote.selectedContent?.hassleItems && quote.selectedContent.hassleItems.length > 0 && (
          <div data-track-section="hassle_items" className="space-y-2">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Why customers choose us</p>
            <div className="space-y-2">
              {quote.selectedContent.hassleItems.slice(0, 3).map((item) => (
                <div key={item.id} className="flex items-start gap-3 p-3 bg-zinc-900/50 rounded-lg border border-zinc-800">
                  <span className="text-lime-400 mt-0.5">✓</span>
                  <div>
                    <p className="text-sm font-medium text-zinc-200">{item.heading}</p>
                    {item.body && <p className="text-xs text-zinc-400 mt-0.5">{item.body}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div data-track-section="book_cta">{bookNowCTA}</div>
        <div data-track-section="trust_strip"><ContextualTrustStrip googleRating={pricingSettings?.googleRating} reviewCount={pricingSettings?.reviewCount} /></div>

        {/* Single review for social proof — content library if available, hardcoded fallback */}
        <div data-track-section="google_review"><ContextualGoogleReviewCard review={testimonialsToShow[0]} /></div>

        {/* Batch nudge — show only for single job quotes */}
        {quote.pricingLineItems && quote.pricingLineItems.length === 1 && (
          <div className="text-center space-y-2 pt-2">
            <p className="text-xs text-zinc-500">Got more jobs? Add them to this visit</p>
            <a
              href={`https://wa.me/447508744402?text=${encodeURIComponent(`Hi, I'd like to add another job to my quote for ${quote.customerName}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-700 text-sm text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors"
            >
              <span>+</span>
              <span>Add another job to this visit</span>
            </a>
            <p className="text-xs text-zinc-600">One visit — everything sorted</p>
          </div>
        )}
        {whatsappFallback}
      </>
    );
  }

  // =====================================================================
  // COMPLEX LAYOUT — 4+ line items, categorised sections, grand total
  // =====================================================================
  return pageWrapper(
    <>
      <div data-track-section="hero">{brandHero}</div>

      {/* Categorised job sections with per-section subtotals */}
      {quote.pricingLineItems && quote.pricingLineItems.length > 0 && (
        <div data-track-section="line_items">
          <CategorisedPricingLineItems
            lineItems={quote.pricingLineItems}
            batchDiscount={quote.batchDiscount}
            formatPrice={formatPrice}
          />
        </div>
      )}

      {/* Batch discount callout (if applicable) */}
      {quote.batchDiscount?.applied && quote.batchDiscount.discountPercent > 0 && (
        <div data-track-section="batch_discount" className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
          <p className="text-sm font-medium text-amber-800">
            Multi-job savings: £{formatPrice(quote.batchDiscount.savingsPence)} off ({quote.batchDiscount.discountPercent}% discount)
          </p>
        </div>
      )}

      {/* Grand total (prominent) */}
      <div data-track-section="price" className="text-center py-4">
        <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-1">Grand Total</p>
        <p className="text-5xl font-extrabold text-slate-900">
          £{formatPrice(totalPrice)}
        </p>
        <p className="text-xs text-slate-400 mt-1">Fixed price — no hidden extras</p>
        {quote.deadZoneFraming && (
          <p className="text-xs text-zinc-500 text-center mt-1 italic">
            {quote.deadZoneFraming}
          </p>
        )}
      </div>

      {/* Value bullets (max 5) */}
      {displayBullets.length > 0 && (
        <div data-track-section="value_bullets">
          <Card className="border-slate-200">
            <CardContent className="p-5">
              <ValueBulletsList bullets={displayBullets} />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Hassle items — why customers choose us */}
      {quote.selectedContent?.hassleItems && quote.selectedContent.hassleItems.length > 0 && (
        <div data-track-section="hassle_items" className="space-y-2">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Why customers choose us</p>
          <div className="space-y-2">
            {quote.selectedContent.hassleItems.slice(0, 3).map((item) => (
              <div key={item.id} className="flex items-start gap-3 p-3 bg-zinc-900/50 rounded-lg border border-zinc-800">
                <span className="text-lime-400 mt-0.5">✓</span>
                <div>
                  <p className="text-sm font-medium text-zinc-200">{item.heading}</p>
                  {item.body && <p className="text-xs text-zinc-400 mt-0.5">{item.body}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Guarantee statement — content library if available, hardcoded fallback */}
      <div data-track-section="guarantee" className="bg-[#7DB00E]/5 border border-[#7DB00E]/20 rounded-xl p-4 text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <ShieldCheck className="w-4 h-4 text-[#7DB00E]" />
          <p className="text-sm font-semibold text-[#7DB00E]">{guaranteeTitle}</p>
        </div>
        <p className="text-sm text-slate-600">{guaranteeCopy}</p>
      </div>

      <div data-track-section="book_cta">{bookNowCTA}</div>

      {/* Trust strip with risk reversal for complex quotes */}
      <div data-track-section="trust_strip"><ContextualTrustStrip showRiskReversal googleRating={pricingSettings?.googleRating} reviewCount={pricingSettings?.reviewCount} /></div>

      {/* Multiple reviews for social proof — content library if available, hardcoded fallback */}
      <div data-track-section="google_reviews" className="space-y-3">
        {testimonialsToShow.map((review, i) => (
          <ContextualGoogleReviewCard key={i} review={review} />
        ))}
      </div>

      {/* Batch nudge — show only for single job quotes */}
        {quote.pricingLineItems && quote.pricingLineItems.length === 1 && (
          <div className="text-center space-y-2 pt-2">
            <p className="text-xs text-zinc-500">Got more jobs? Add them to this visit</p>
            <a
              href={`https://wa.me/447508744402?text=${encodeURIComponent(`Hi, I'd like to add another job to my quote for ${quote.customerName}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-700 text-sm text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors"
            >
              <span>+</span>
              <span>Add another job to this visit</span>
            </a>
            <p className="text-xs text-zinc-600">One visit — everything sorted</p>
          </div>
        )}
      {whatsappFallback}
    </>
  );
}

export default function PersonalizedQuotePage() {
  const [, canonicalParams] = useRoute('/quote/:slug');
  const [, longParams] = useRoute('/quote-link/:slug');
  const [, shortParams] = useRoute('/q/:slug');
  const params = canonicalParams || longParams || shortParams; // Support /quote/:slug, /quote-link/:slug, and /q/:slug
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
  const selectedCalendarDateRef = useRef<Date | null>(null);
  const [isWeekendBooking, setIsWeekendBooking] = useState(false);
  const [dateFee, setDateFee] = useState(0); // in pence
  const [timeSlotType, setTimeSlotType] = useState<TimeSlotType | null>(null);
  const timeSlotTypeRef = useRef<TimeSlotType | null>(null);
  const [exactTime, setExactTime] = useState<string | null>(null);
  const [timeFee, setTimeFee] = useState(0); // in pence

  const [showSocialProof, setShowSocialProof] = useState(false); // Social proof overlay disabled elsewhere
  const [expandedTiers, setExpandedTiers] = useState<Set<EEEPackageTier>>(new Set<EEEPackageTier>(['enhanced'])); // Track which tier's "What's included" is expanded
  const [bookedLeadId, setBookedLeadId] = useState<string | null>(null); // Store lead ID after booking
  const [showPriceIncreaseNotice, setShowPriceIncreaseNotice] = useState(false); // Show banner when prices increased
  // Quote expiration removed - quotes no longer expire
  // const [isQuoteExpiredOnLoad, setIsQuoteExpiredOnLoad] = useState(false);
  const [paymentMode, setPaymentMode] = useState<'full' | 'installments'>('full'); // Track payment mode selection - default to full
  const [expandedMobileCard, setExpandedMobileCard] = useState<EEEPackageTier | null>(null); // Track which mobile card is expanded (accordion) - all start collapsed
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined); // Track selected date from mobile dateselect
  const [selectedDatesBuffer, setSelectedDatesBuffer] = useState<Date[]>([]); // 3-date buffer model
  const [dateTimePrefsBuffer, setDateTimePrefsBuffer] = useState<{ date: Date; timeSlot: 'am' | 'pm' | 'flexible' | 'full_day' }[]>([]); // Per-date time prefs
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<'AM' | 'PM' | undefined>(undefined); // Track selected time slot (AM/PM)
  // const [isExpiredState, setIsExpiredState] = useState(false); // Removed - quotes no longer expire
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
  const confirmationRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to confirmation after booking
  useEffect(() => {
    if (hasBooked && confirmationRef.current) {
      // Small delay to ensure the component is rendered
      setTimeout(() => {
        confirmationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  }, [hasBooked]);

  // Fetch personalized quote data
  const { data: quote, isLoading, error } = useQuery<PersonalizedQuote>({
    queryKey: ['/api/personalized-quotes', params?.slug],
    queryFn: async () => {
      const response = await fetch(`/api/personalized-quotes/${params?.slug}`);

      // 410 handling removed - quotes no longer expire

      if (!response.ok) {
        throw new Error('Quote not found');
      }
      const data = await response.json();
      // Extract batchDiscount from pricingLayerBreakdown if not at top level
      if (!data.batchDiscount && data.pricingLayerBreakdown?.batchDiscount) {
        data.batchDiscount = data.pricingLayerBreakdown.batchDiscount;
      }
      // Extract finalPricePence and subtotalPence from pricingLayerBreakdown
      if (!data.finalPricePence && data.pricingLayerBreakdown?.finalPricePence) {
        data.finalPricePence = data.pricingLayerBreakdown.finalPricePence;
      }
      if (!data.subtotalPence && data.pricingLayerBreakdown?.subtotalPence) {
        data.subtotalPence = data.pricingLayerBreakdown.subtotalPence;
      }
      // Extract deadZoneFraming from pricingLayerBreakdown.messaging if not at top level
      if (!data.deadZoneFraming && data.pricingLayerBreakdown?.messaging?.deadZoneFraming) {
        data.deadZoneFraming = data.pricingLayerBreakdown.messaging.deadZoneFraming;
      }
      return data;
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

  // Fetch configurable pricing settings (social proof + pricing params from public endpoint)
  const { data: pricingSettings } = useQuery<{
    googleRating: string;
    reviewCount: number;
    propertiesServed: string;
    jobsCompleted: string;
    depositPercent?: number;
    payInFullDiscountPercent?: number;
    flexibleDiscountPercent?: number;
  }>({
    queryKey: ['pricing-settings-public'],
    queryFn: async () => {
      const res = await fetch('/api/settings/pricing/public');
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 300_000, // 5 min cache
  });

  // Fetch invoice data for confirmation screen
  const { data: invoiceData } = useQuery<{ invoiceNumber: string }>({
    queryKey: ['invoice-by-quote', quote?.id],
    queryFn: async () => {
      const response = await fetch(`/api/invoices/by-quote/${quote?.id}`);
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!quote?.id && !!quote?.depositPaidAt,
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

  // Initialize booking state from quote data (for returning customers who already paid)
  useEffect(() => {
    if (quote?.depositPaidAt || quote?.bookedAt) {
      setHasBooked(true);
      setHasApprovedProduct(true);
      // Hydrate selected package from quote
      if (quote.selectedPackage) {
        setSelectedEEEPackage(quote.selectedPackage as EEEPackageTier);
      } else {
        // Default to enhanced if no package was stored
        setSelectedEEEPackage('enhanced');
      }
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

    if (storedHasBooked === 'true') {
      setHasBooked(true);
    }
    if (storedLeadId) {
      setBookedLeadId(storedLeadId);
    }
  }, [params?.slug]);

  // ---------------------------------------------------------------------------
  // PostHog: Contextual Quote Analytics
  // ---------------------------------------------------------------------------

  const trackingRef = useRef<ReturnType<typeof initQuotePageTracking> | null>(null);
  const maxScrollDepthRef = useRef(0);
  const hasTrackedViewRef = useRef(false);

  // Initialize page tracking on mount
  useEffect(() => {
    if (!params?.slug) return;
    trackingRef.current = initQuotePageTracking(params.slug);

    // Track scroll depth
    const handleScroll = () => {
      const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollHeight > 0) {
        const depth = Math.round((window.scrollY / scrollHeight) * 100);
        if (depth > maxScrollDepthRef.current) {
          maxScrollDepthRef.current = depth;
        }
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      // Fire exit events
      if (quote && trackingRef.current) {
        trackScrollDepth(quote.id, params.slug!, maxScrollDepthRef.current);
        trackTimeOnPage(quote.id, params.slug!, trackingRef.current.getTimeOnPage());
      }
    };
  }, [params?.slug]);

  // Track quote viewed (once per page load, after data arrives)
  useEffect(() => {
    if (!quote || !trackingRef.current || hasTrackedViewRef.current) return;
    hasTrackedViewRef.current = true;

    // Identify the customer in PostHog so all events tie to a person profile
    if (quote.phone) {
      identifyUser(quote.phone, {
        name: quote.customerName,
        email: quote.email || undefined,
        segment: quote.segment || 'UNKNOWN',
        postcode: quote.postcode || undefined,
        is_returning_customer: quote.contextSignals?.isReturningCustomer || false,
        first_quote_date: quote.createdAt,
      });
    }

    const isContextualQuote = quote.segment === 'CONTEXTUAL' || !!(quote.layoutTier && quote.valueBullets);
    const tracking = trackingRef.current;
    const createdAt = quote.createdAt ? new Date(quote.createdAt).getTime() : Date.now();
    const hoursAfterCreation = Math.round((Date.now() - createdAt) / 3600000);

    // Derive analytics metadata for contextual content fields
    const vaCtxRaw: string = (quote as any).contextSignals?.vaContext || '';
    const vaCtxLower = vaCtxRaw.toLowerCase();
    const derivedCustomerType =
      /landlord|rental|tenant|buy.to.let|btl|letting/.test(vaCtxLower) ? 'landlord' :
      /property manager|portfolio|prop mgr|managing agent/.test(vaCtxLower) ? 'property_manager' :
      /office|business|company|commercial|shop/.test(vaCtxLower) ? 'business' :
      /professional|busy exec|corporate/.test(vaCtxLower) ? 'professional' :
      'homeowner';
    const segKey = (quote.segment || 'DEFAULT') as keyof typeof SEGMENT_CONTENT_MAP;
    const derivedImageShown: string | undefined =
      quote.selectedContent?.images?.[0]?.url ||
      (SEGMENT_CONTENT_MAP[segKey] as any)?.guarantee?.image ||
      undefined;
    // DB image ID for platform-level view tracking (fire-and-forget, no auth needed)
    const dbImageId: number | undefined = quote.selectedContent?.images?.[0]?.id;
    if (dbImageId) {
      fetch('/api/quote-platform/images/track-view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: dbImageId }),
      }).catch(() => {});
    }

    // Fire $pageview for PostHog heatmaps, scroll depth, and session recordings
    capturePageView({
      quote_id: quote.id,
      segment: quote.segment || 'UNKNOWN',
      layout_tier: quote.layoutTier,
    });

    trackQuoteViewed({
      quoteId: quote.id,
      shortSlug: quote.shortSlug,
      segment: quote.segment || 'UNKNOWN',
      layoutTier: quote.layoutTier || null,
      totalPricePence: quote.finalPricePence || quote.basePrice || 0,
      lineItemCount: quote.pricingLineItems?.length || 1,
      jobCategories: quote.pricingLineItems?.map(l => l.category) || [],
      batchDiscountApplied: quote.batchDiscount?.applied || false,
      batchDiscountPercent: quote.batchDiscount?.discountPercent || 0,
      // Pricing layers (from pricingLayerBreakdown stored on quote)
      layer1ReferencePence: (quote as any).pricingLayerBreakdown?.layerBreakdown?.layer1ReferencePence,
      layer3LLMSuggestedPence: (quote as any).pricingLayerBreakdown?.layerBreakdown?.layer3LLMSuggestedPence,
      layer4FinalPence: (quote as any).pricingLayerBreakdown?.layerBreakdown?.layer4FinalPence,
      // Content shown
      valueBulletCount: quote.valueBullets?.length || 0,
      bookingModesShown: quote.bookingModes || [],
      // Contextual content identifiers (Task 1)
      imageShown: derivedImageShown,
      customerType: derivedCustomerType,
      vaContextLength: vaCtxRaw.length,
      hasContextualHeadline: !!(quote.contextualHeadline),
      // Revisit & timing
      isRevisit: tracking.isRevisit,
      hoursAfterCreation,
      deviceType: tracking.deviceType,
      referrer: tracking.referrer,
    });

    // Also fire pricing layer detail for contextual quotes
    if (isContextualQuote && quote.pricingLineItems && (quote as any).pricingLayerBreakdown) {
      const breakdown = (quote as any).pricingLayerBreakdown;
      trackPricingLayers({
        quoteId: quote.id,
        shortSlug: quote.shortSlug,
        lineItems: quote.pricingLineItems.map(l => ({
          lineId: l.lineId,
          category: l.category,
          referencePricePence: l.referencePricePence,
          llmSuggestedPence: l.llmSuggestedPricePence,
          guardedPricePence: l.guardedPricePence,
          adjustmentFactors: l.adjustmentFactors?.map(a => a.factor) || [],
        })),
        subtotalPence: breakdown.subtotalPence || 0,
        finalPricePence: breakdown.finalPricePence || 0,
        batchDiscountPercent: breakdown.batchDiscount?.discountPercent || 0,
        confidence: breakdown.confidence || 'unknown',
      });
    }
  }, [quote]);

  // Section visibility tracking via IntersectionObserver
  useEffect(() => {
    if (!quote) return;

    const sectionTimers: Record<string, number> = {};
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          const section = entry.target.getAttribute('data-track-section');
          if (!section) return;

          if (entry.isIntersecting) {
            sectionTimers[section] = Date.now();
          } else if (sectionTimers[section]) {
            const timeSpent = Date.now() - sectionTimers[section];
            if (timeSpent > 500) { // Only track if viewed >500ms
              const scrollDepth = Math.round((window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100);
              trackSectionViewed({
                quoteId: quote.id,
                shortSlug: quote.shortSlug,
                section,
                timeSpentMs: timeSpent,
                scrollDepthPercent: scrollDepth,
              });
              // Beacon to our own DB for in-app engagement analytics
              fetch('/api/analytics/quotes/section-event', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  quoteId: quote.id,
                  shortSlug: quote.shortSlug,
                  section,
                  dwellTimeMs: timeSpent,
                  scrollDepthPercent: scrollDepth,
                  deviceType: window.innerWidth < 768 ? 'mobile' : window.innerWidth < 1024 ? 'tablet' : 'desktop',
                  layoutTier: quote.layoutTier,
                }),
              }).catch(() => {}); // fire-and-forget
            }
            delete sectionTimers[section];
          }
        });
      },
      { threshold: 0.5 }
    );

    // Observe all sections with data-track-section attribute
    document.querySelectorAll('[data-track-section]').forEach(el => observer.observe(el));

    return () => observer.disconnect();
  }, [quote]);

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

    // Payment has already succeeded at this point (Stripe confirmed it)
    // The webhook will create the job/invoice - we just need to:
    // 1. Try to create lead (optional, webhook also handles this)
    // 2. Track booking details
    // 3. ALWAYS redirect to confirmation page

    let leadId: string | null = null;

    try {
      // Create lead with quote data (non-blocking - webhook also creates lead)
      const leadData = {
        customerName: quote.customerName,
        phone: quote.phone,
        email: quote.email || undefined,
        jobDescription: quote.jobDescription,
        outcome: 'phone_quote',
        eeePackage: 'standard', // Single price model
        quoteAmount: quotePrice,
        source: 'personalized_quote',
        stripePaymentId: paymentIntentId,
      };

      const leadResponse = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(leadData),
      });

      if (leadResponse.ok) {
        const lead: any = await leadResponse.json();
        leadId = lead.id;

        // Store lead ID for confirmation (scoped by quote slug)
        const prefix = `quote_${params?.slug}`;
        setBookedLeadId(lead.id);
        sessionStorage.setItem(`${prefix}_bookedLeadId`, lead.id);
        sessionStorage.setItem(`${prefix}_hasBooked`, 'true');
      } else {
        console.warn('Lead creation failed but payment succeeded - webhook will handle it');
      }
    } catch (leadError) {
      console.warn('Lead creation error but payment succeeded:', leadError);
      // Continue - payment is complete, webhook will handle lead creation
    }

    // Track booking with mode-specific data (fire and forget)
    try {
      if (quote?.id) {
        await fetch(`/api/personalized-quotes/${quote.id}/track-booking`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leadId: leadId,
            selectedPackage: 'standard', // Single price model
            selectedExtras: selectedExtras.length > 0 ? selectedExtras : undefined,
            paymentType: effectivePaymentType,
            // Scheduling fields
            selectedDate: selectedDate || selectedCalendarDateRef.current || selectedCalendarDate || undefined,
            selectedDates: selectedDatesBuffer.length > 0
              ? selectedDatesBuffer.map(d => d.toISOString())
              : undefined,
            dateTimePreferences: dateTimePrefsBuffer.length > 0
              ? dateTimePrefsBuffer.map(p => ({ date: p.date.toISOString(), timeSlot: p.timeSlot }))
              : undefined,
            schedulingTier: schedulingTier || undefined,
            timeSlotType: timeSlotTypeRef.current || timeSlotType || undefined,
            exactTimeRequested: exactTime || undefined,
            isWeekendBooking: isWeekendBooking,
            schedulingFeeInPence: dateFee + timeFee,
            // [RAMANUJAM] Include BUSY_PRO productization choices
            timingChoice: quote.segment === 'BUSY_PRO' ? timingChoice : undefined,
            whileImThereBundle: quote.segment === 'BUSY_PRO' ? whileImThereBundle : undefined,
          }),
        });
      }
    } catch (trackError) {
      console.warn('Booking tracking failed:', trackError);
      // Continue - payment is complete
    }

    // Track image booking count in quote platform DB (fire-and-forget)
    const bookedImageId = quote?.selectedContent?.images?.[0]?.id;
    if (bookedImageId) {
      fetch('/api/quote-platform/images/track-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: bookedImageId }),
      }).catch(() => {});
    }

    // PostHog: Track the conversion event
    if (trackingRef.current) {
      const quotePrice = quote.finalPricePence || quote.basePrice || 0;
      trackPaymentCompleted({
        quoteId: quote.id,
        shortSlug: quote.shortSlug,
        segment: quote.segment || 'UNKNOWN',
        totalPricePence: quotePrice,
        depositPence: Math.round(quotePrice * 0.3),
        paymentMode: effectivePaymentType as 'full' | 'installments',
        bookingMode: schedulingTier || undefined,
        selectedDate: (selectedDate || selectedCalendarDateRef.current || selectedCalendarDate)?.toISOString(),
        schedulingTier: schedulingTier || undefined,
        timeSlotType: timeSlotType || undefined,
        selectedExtras,
        timeFromViewToPayMs: trackingRef.current.getTimeOnPage(),
        revisitCount: trackingRef.current.visitCount,
        lineItemCount: quote.pricingLineItems?.length || 1,
        jobCategories: quote.pricingLineItems?.map(l => l.category) || [],
        batchDiscountApplied: quote.batchDiscount?.applied || false,
      });
    }

    setHasBooked(true);
    setIsBooking(false);

    // ALWAYS redirect to confirmation page - payment succeeded
    window.location.href = `/booking-confirmed/${quote.id}`;
  };

  if (isLoading) {
    return <QuoteSkeleton />;
  }

  // Quote expiration check removed - quotes no longer expire

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
  const routeType = quote.recommendedRoute || 'tiers'; // Default to tiers for full booking UI

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

  // ---------------------------------------------------------------------------
  // Contextual Quote Detection (Phase 5a)
  // Contextual quotes now route through the rich proposal flow (ScarcityBanner,
  // ValueHero, ValueSocialProof, ValueGuarantee, HassleComparisonCard, Packages,
  // Payment) instead of the bare-bones ContextualQuoteLayout.
  // ---------------------------------------------------------------------------
  const isContextualQuote = (quote?.segment === 'CONTEXTUAL') || !!(quote?.layoutTier && quote?.valueBullets);

  // [DEBUG] Log all conditions for BUSY_PRO feature overrides
  console.log('[QUOTE DEBUG] =====================================');
  console.log('[QUOTE DEBUG] segment:', quote.segment);
  console.log('[QUOTE DEBUG] proposalModeEnabled:', quote.proposalModeEnabled);
  console.log('[QUOTE DEBUG] quoteMode:', quote.quoteMode);
  console.log('[QUOTE DEBUG] recommendedRoute:', quote.recommendedRoute);
  console.log('[QUOTE DEBUG] Single price model — basePrice:', quote.basePrice);
  console.log('[QUOTE DEBUG] =====================================');

  // Quote expiration removed - quotes no longer expire
  // const isActuallyExpired = false;

  // EVE single price — used directly by UnifiedQuoteCard
  // For contextual quotes, prefer finalPricePence from the contextual pricing engine
  const quotePrice = (isContextualQuote ? quote.finalPricePence : undefined) || quote.basePrice || quote.enhancedPrice || 0;

  // getProductsForSegment removed — EVE single-price, UnifiedQuoteCard handles display

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

  // Get display name for the service (no longer tier-based)
  const getPackageDisplayName = (_tier: EEEPackageTier): string => {
    return 'Service';
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

  // Weighted Scroll Layout (for proposalModeEnabled OR contextual quotes)
  // Contextual quotes use the same rich flow: ScarcityBanner → ValueHero →
  // ValueSocialProof → ValueGuarantee → HassleComparisonCard → Packages → Payment
  if (quote.proposalModeEnabled || isContextualQuote) {
    return (
      <QuoteTimerProvider>
      <div className="min-h-screen bg-slate-50 font-sans selection:bg-[#7DB00E] selection:text-white relative text-slate-900">

        {/* Scarcity Banner - Top of page, data-driven per segment */}
        <ScarcityBanner segment={quote.segment || 'UNKNOWN'} postcode={quote.postcode} />

        {/* Value Sections Flow */}
        <ValueHero quote={quote} config={config} />

        {/* Unified Social Proof Section */}
        <ValueSocialProof quote={quote} pricingSettings={pricingSettings ?? undefined} />

        <ValueGuarantee quote={quote} config={config} />

        {/* Hassle Comparison — "Without Us vs With Us" */}
        <SectionWrapper className="bg-white">
          <div className="max-w-2xl mx-auto">
            {(() => {
              const vaCtx = ((quote as any).contextSignals?.vaContext || '').toLowerCase();
              const customerType =
                /landlord|rental|tenant|buy.to.let|btl|letting/.test(vaCtx) ? 'landlords' :
                /property manager|portfolio|prop mgr|managing agent/.test(vaCtx) ? 'property managers' :
                /office|business|company|commercial|shop/.test(vaCtx) ? 'businesses' :
                /professional|busy exec|corporate/.test(vaCtx) ? 'professionals' :
                'homeowners';
              const hassleTitle = isContextualQuote ? `Why ${customerType} choose us.` : undefined;
              return (
                <>
                  {hassleTitle && <h3 className="text-2xl font-bold text-slate-800 mb-4">{hassleTitle}</h3>}
                  <HassleComparisonCard segment={quote.segment || 'UNKNOWN'} hideTitle={!!hassleTitle} />
                </>
              );
            })()}
          </div>
        </SectionWrapper>

        {/* The Final Reveal: Quote Section */}
        <section id="packages-section" className="bg-slate-50 pt-16 pb-8 px-4 md:px-6 lg:px-8 relative overflow-visible">
          <div className="w-full max-w-full">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              viewport={{ once: true, margin: "50px" }}
              className="space-y-12"
            >
              <div className="text-center space-y-4">

                {/* Pay in 3 Banner - Top Placement */}
                <div className="rounded-xl overflow-hidden shadow-sm border border-slate-200 mb-8 max-w-lg mx-auto transform -rotate-1 hover:rotate-0 transition-transform duration-300">
                  <img src={payIn3PromoImage} className="w-full h-auto object-cover" alt="Pay in 3 Interest Free" loading="lazy" />
                </div>

                <div>
                  <h3 className="text-xl md:text-2xl font-bold text-slate-500 mb-2">We can't work with everyone,</h3>
                  <h2 className="text-4xl md:text-6xl font-extrabold tracking-tight text-[#1D2D3D]">Secure Your Slot?</h2>
                </div>
                <p className="text-slate-600 text-lg max-w-2xl mx-auto">Based on quality materials and insured labour, here's what proper workmanship costs:</p>

                {/* Price Confidence Statement */}
                <div className="max-w-lg mx-auto mt-6 bg-white border border-slate-200 p-5 rounded-xl shadow-sm">
                  <p className="text-slate-700 text-xs md:text-sm italic font-light leading-relaxed">
                    "We won't be the cheapest quote you get.
                    <br />
                    <span className="text-[#1D2D3D] font-medium">We will be the last one you need.</span>"
                  </p>
                </div>


              </div>

              {/* Scope of Works — standalone block */}
              <ScopeOfWorks
                text={getScopeOfWorks(quote as any)}
                summary={(quote.jobs as any)?.[0]?.summary}
                proposalSummary={isContextualQuote ? (quote as any).proposalSummary : undefined}
                pricingLineItems={isContextualQuote ? quote.pricingLineItems : undefined}
                estimatorPhotoUrl={mikeProfilePhoto}
              />

              {/* Price Card + Booking Flow */}
              {quotePrice > 0 && !hasBooked && (
                <QuoteTimer>
                  <Elements stripe={stripePromise}>
                    <UnifiedQuoteCard
                      segment={quote.segment || 'UNKNOWN'}
                      basePrice={quotePrice}
                      customerName={quote.customerName}
                      customerEmail={quote.email || undefined}
                      bookingModes={isContextualQuote && quote.bookingModes ? quote.bookingModes : undefined}
                      batchDiscount={isContextualQuote && quote.batchDiscount ? quote.batchDiscount : undefined}
                      pricingLineItems={quote.pricingLineItems || undefined}
                      contextualBullets={isContextualQuote && quote.valueBullets ? quote.valueBullets : undefined}
                      allowedDates={(quote as any).availableDates ?? null}
                      quoteId={quote.id}
                      jobDescription={quote.jobDescription}
                      location={quote.postcode?.split(' ')[0]}
                      optionalExtras={quote.optionalExtras}
                      depositPercent={pricingSettings?.depositPercent}
                      payInFullDiscountPercent={pricingSettings?.payInFullDiscountPercent}
                      flexibleDiscountPercent={pricingSettings?.flexibleDiscountPercent}
                      contractor={null}
                      isBooking={isBooking}
                      onBook={async (config) => {
                        setIsBooking(true);
                        setSelectedEEEPackage('enhanced');
                        setHasApprovedProduct(true);
                        if (config.selectedDate) {
                          setSelectedCalendarDate(config.selectedDate);
                          selectedCalendarDateRef.current = config.selectedDate;
                        }
                        // Store all preferred dates and per-date time prefs for the 3-date buffer model
                        if (config.selectedDates && config.selectedDates.length > 0) {
                          setSelectedDatesBuffer(config.selectedDates);
                        }
                        if (config.dateTimePreferences && config.dateTimePreferences.length > 0) {
                          setDateTimePrefsBuffer(config.dateTimePreferences);
                        }
                        if (config.timeSlot) {
                          setTimeSlotType(config.timeSlot as TimeSlotType);
                          timeSlotTypeRef.current = config.timeSlot as TimeSlotType;
                        }

                        // Map add-ons to bundle type
                        if (config.addOns.includes('quick_task')) {
                          setWhileImThereBundle('quick');
                        }

                        // Show payment form (for non-flexible timing)
                        // Skip external payment section when multi-date buffer used (payment handled inline in card)
                        const paidInline = config.selectedDates && config.selectedDates.length >= 3;
                        if (!config.usedDownsell && !paidInline) {
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


                  {/* PDF Download — subtle link */}
                  <button
                    onClick={() => {
                      trackCTAClick({
                        quoteId: quote.id,
                        shortSlug: quote.shortSlug,
                        ctaType: 'pdf_download',
                        segment: quote.segment || 'UNKNOWN',
                        totalPricePence: quote.finalPricePence || quote.basePrice || 0,
                        timeOnPageMs: trackingRef.current?.getTimeOnPage() || 0,
                      });
                      generateQuotePDF({
                        quoteId: quote.id,
                        customerName: quote.customerName || 'Customer',
                        address: quote.address,
                        postcode: quote.postcode,
                        jobDescription: getExpertNoteText(quote as any),
                        priceInPence: quotePrice,
                        segment: quote.segment || undefined,
                        validityHours: 48,
                        createdAt: quote.createdAt ? new Date(quote.createdAt) : new Date(),
                      });
                    }}
                    className="w-full flex items-center justify-center gap-2 text-sm text-white hover:text-[#7DB00E] transition-colors py-2 mt-2"
                  >
                    <FileText className="w-4 h-4" />
                    <span>Download quote for your records</span>
                  </button>
                </QuoteTimer>
              )}

            </motion.div>

            {/* Payment Section — shows after user books via UnifiedQuoteCard */}
            {selectedEEEPackage && hasApprovedProduct && (
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

                    {/* 3-Date summary — dates already picked in UnifiedQuoteCard */}
                    {selectedDatesBuffer.length > 0 && (
                      <div className={`flex items-center gap-2 mb-4 text-sm ${quote.clientType === 'commercial' ? 'text-gray-300' : 'text-slate-600'}`}>
                        <CalendarCheck className="w-4 h-4 text-[#7DB00E]" />
                        <span>
                          Preferred dates: {selectedDatesBuffer.map(dd => dd.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })).join(', ')}
                        </span>
                      </div>
                    )}

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

                      // EVE single price
                      const basePrice = quotePrice;

                      if (!basePrice) return null;

                      const extrasTotal = selectedExtras.reduce((sum, label) => {
                        const extra = quote.optionalExtras?.find(e => e.label === label);
                        return sum + (extra?.priceInPence || 0);
                      }, 0);

                      // [RAMANUJAM] Add BUSY_PRO productization adjustments
                      const busyProAdjustments = calculateBusyProAdjustments();
                      const baseJobPrice = basePrice + extrasTotal + busyProAdjustments.schedulingFee + busyProAdjustments.bundlePrice;
                      // EVE single-price: no tier distinction, installments always available
                      const isInstallmentsMode = paymentMode === 'installments';

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

                {/* Booking Confirmation - Handled by BookingConfirmation component in footer section */}
              </motion.div>
            )}
          </div>
        </section >

        {/* COMPACT TRUST FOOTER */}
        <div className="bg-slate-50 py-5 px-6 border-t border-slate-200 relative">
          <div className="max-w-lg mx-auto flex flex-col items-center gap-3">
            <div className="flex items-center gap-3 opacity-60">
              <SiVisa className="w-7 h-7 text-[#1434CB]" />
              <SiMastercard className="w-7 h-7 text-[#EB001B]" />
              <SiAmericanexpress className="w-7 h-7 text-[#2E77BC]" />
              <SiApplepay className="w-7 h-7 text-slate-900" />
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
              <Lock className="w-3 h-3" />
              Secure payments via Stripe · 256-bit SSL
            </div>
            <p className="text-[10px] text-slate-400">
              &copy; {new Date().getFullYear()} HandyServices. All rights reserved.
            </p>
          </div>
        </div>


        {/* Floating Social Proof Badge - Only show in early phase to avoid clutter/overlap */}
        {
          scrollPhase === 'early' && !showPaymentForm && (
            <div className="fixed bottom-4 right-4 z-40">
              <div className="bg-white border border-slate-200 text-slate-900 rounded-lg shadow-lg p-3 flex items-center gap-3 animate-in slide-in-from-bottom-5">
                <div className="flex flex-col">
                  <div className="flex gap-0.5 text-[#7DB00E]">
                    <Star className="w-3 h-3 fill-current" />
                    <Star className="w-3 h-3 fill-current" />
                    <Star className="w-3 h-3 fill-current" />
                    <Star className="w-3 h-3 fill-current" />
                    <Star className="w-3 h-3 fill-current" />
                  </div>
                  <span className="text-[10px] text-gray-400 font-bold uppercase mt-0.5">{pricingSettings?.googleRating ?? "4.9"}/5 RATED</span>
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
      </QuoteTimerProvider>
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
                <span className="text-xl font-bold text-gray-900">{pricingSettings?.googleRating ?? "4.9"}</span>
              </div>
              <p className="text-gray-600 text-sm">Based on {pricingSettings?.reviewCount ? `${pricingSettings.reviewCount}+` : "347+"} reviews</p>
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
                  <p className="font-semibold text-gray-900">{pricingSettings?.jobsCompleted ?? "2,500+"} Jobs Completed</p>
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

      {/* QuoteExpiredPopup removed - quotes no longer expire */}

      {!quote.bookedAt && (
        <div className="sticky top-0 z-50 bg-gradient-to-r from-gray-950 via-gray-900 to-gray-950 border-b border-amber-500/30 px-3 py-2.5">
          <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <span className="text-xl flex-shrink-0 animate-pulse">✨</span>
              <p className="text-gray-100 text-xs sm:text-sm font-medium truncate">
                <span className="text-[#e8b323] font-bold">New Year Offer:</span> Pay in 3 Interest-Free available today.
              </p>
            </div>
            {/* Countdown timer removed - quotes no longer expire */}
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
                <p className="text-white/90 text-sm">Your quote has been updated with new pricing.</p>
              </div>
              <button onClick={() => setShowPriceIncreaseNotice(false)} className="text-white/80"><X className="h-5 w-5" /></button>
            </div>
          </div>
        )
      }

      <div className="flex-1 px-4 py-3 pb-24 overflow-auto">
        <div className="max-w-2xl mx-auto">
          <div className="mb-6 rounded-xl overflow-hidden shadow-lg w-full h-auto relative">
            <img src={payIn3PromoImage} className="w-full h-auto" />
          </div>

          <div className="mb-10 px-4">
            <ExpertSpecSheet
              text={getScopeOfWorks(quote as any)}
              summary={(quote.jobs as any)?.[0]?.summary}
              customerName={quote.customerName || ''}
              address={quote.address || quote.postcode}
              estimatorPhotoUrl={mikeProfilePhoto}
              className="mt-8 transform max-w-xl mx-auto"
            />
          </div>

          {(
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
                        {getLineItems(quote as any).map((item, idx) => (
                          <div key={idx} className="flex items-start gap-3">
                            <span className="flex-shrink-0 text-[#7DB00E] text-lg leading-relaxed">•</span>
                            <span className="text-white text-base font-medium leading-relaxed">
                              {item.quantity && item.quantity > 1 ? `${item.quantity}x ` : ''}{item.description}
                            </span>
                          </div>
                        ))}
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
            hasReserved && quote.optionalExtras && quote.optionalExtras.length > 0 && (
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

          {/* Pay in 3 Section - Simple Pie Chart Design - Hide when already booked */}
          {
            !hasReserved && !hasBooked && (
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

          {/* FAQ Section - Hide when payment form is shown or already booked */}
          {
            !hasReserved && !hasBooked && (
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

          {/* Payment Methods Section - Hide when payment form is shown or already booked */}
          {
            !hasReserved && !hasBooked && (
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
            hasBooked ? (
              /* Payment confirmed - show full summary */
              <div ref={confirmationRef} className="mt-8">
                <BookingConfirmation
                  customerName={quote.customerName}
                  depositPaidPence={quote.depositAmountPence || (() => {
                    // Fallback calculation if depositAmountPence not set
                    const baseTierPrice = quotePrice;
                    const extrasTotal = selectedExtras.reduce((sum, label) => {
                      const extra = quote.optionalExtras?.find(e => e.label === label);
                      return sum + (extra?.priceInPence || 0);
                    }, 0);
                    const materialsCost = quote.materialsCostWithMarkupPence || 0;
                    const baseJobPrice = baseTierPrice + extrasTotal;
                    const jobCostExcludingMaterials = Math.max(0, baseJobPrice - materialsCost);
                    return materialsCost + Math.round(jobCostExcludingMaterials * 0.30);
                  })()}
                  jobDescription={quote.jobDescription}
                  postcode={quote.postcode || ''}
                  selectedDate={quote.selectedDate || selectedCalendarDate}
                  invoiceNumber={invoiceData?.invoiceNumber}
                  quoteSlug={quote.shortSlug || quote.id}
                  email={quote.email}
                  selectedPackage={quote.selectedPackage || selectedEEEPackage || undefined}
                  selectedExtras={quote.selectedExtras || selectedExtras}
                />
              </div>
            ) : hasReserved ? (
              <div id="confirm-button" className="mt-8">
                <Card className="bg-gray-800 border-gray-700">
                  <CardContent className="p-6">
                    <div className="max-w-md mx-auto">
                      <h3 className="text-2xl font-bold text-white mb-2 text-center">
                        Reserve Your Slot
                      </h3>
                      {(() => {
                        // EVE single price
                        const baseTierPrice = quotePrice;

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
                                    <span className="text-gray-300">{getPackageDisplayName(selectedEEEPackage || 'enhanced')}:</span>
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
                                    selectedTier={selectedEEEPackage || 'enhanced'}
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
