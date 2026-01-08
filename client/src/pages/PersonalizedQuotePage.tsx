import { useState, useEffect, useRef } from 'react';
import { useRoute, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ChevronLeft, ChevronRight, Clock, Check, Loader2, Star, Shield, Crown, Camera, PhoneCall, UserCheck, X, Zap, Lock, ShieldCheck, Wrench, User, Phone, Mail, MapPin, ChevronDown, Calendar, Sun } from 'lucide-react';
import { SiGoogle, SiVisa, SiMastercard, SiAmericanexpress, SiApplepay, SiStripe } from 'react-icons/si';
import { FaWhatsapp } from 'react-icons/fa';
import { useToast } from '@/hooks/use-toast';
import { PaymentForm } from '@/components/PaymentForm';
import { DateSelectionForm } from '@/components/DateSelectionForm';
import { Elements } from '@stripe/react-stripe-js';
import { stripePromise } from '@/lib/stripe';
// import handymanPhoto from '@assets/Untitled design (27)_1762913661129.png';
// import handyServicesLogo from '@assets/Copy of Copy of Add a heading (256 x 256 px)_1764065869316.png';
import payIn3PromoImage from '@assets/6e08e13d-d1a3-4a91-a4cc-814b057b341d_1764693900670.webp';
import mikeProfilePhoto from '@assets/mike-profile-photo.png';
import { NeonBadge } from '@/components/ui/neon-badge';
import { format, addDays, addWeeks } from 'date-fns';

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

// Helper: Choose dynamic perks or fallback to static bullets
const getPerksForTier = (quote: PersonalizedQuote | undefined, tier: 'essential' | 'enhanced' | 'elite'): string[] => {
  if (!quote) return [];

  // Use dynamic perks if available (value pricing quotes)
  if (quote.dynamicPerks) {
    const tierMap = {
      essential: quote.dynamicPerks.essential,
      enhanced: quote.dynamicPerks.hassleFree,
      elite: quote.dynamicPerks.highStandard,
    };
    return tierMap[tier]?.map(p => p.label) || [];
  }

  // Fallback to static bullets (legacy quotes)
  const staticMap = {
    essential: HHH_FIXED_VALUE_BULLETS.handyFix,
    enhanced: HHH_FIXED_VALUE_BULLETS.hassleFree,
    elite: HHH_FIXED_VALUE_BULLETS.highStandard,
  };
  return staticMap[tier] as unknown as string[];
};




// Import the new component



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
  totalEstimatedHours?: number;
}

interface Perk {
  id: string;
  label: string;
  description: string;
}

interface PersonalizedQuote {
  id: string;
  shortSlug: string;
  customerName: string;
  phone: string;
  email?: string;
  postcode?: string;
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
}

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
          <span className="text-[9px] font-bold text-emerald-400 bg-emerald-950/50 px-1.5 py-0.5 rounded border border-emerald-500/30 uppercase tracking-wider">
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

type EEEPackageTier = 'essential' | 'enhanced' | 'elite';

interface EEEPackage {
  tier: EEEPackageTier;
  name: string;
  price: number;
  warrantyMonths: number;
  description: string;
  isPopular?: boolean;
}

export default function PersonalizedQuotePage() {
  const [, params] = useRoute('/quote-link/:slug');
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Parse query params for Tenant Mode
  // const searchParams = new URLSearchParams(window.location.search);
  // const isTenantView = searchParams.get('mode') === 'tenant';


  const [selectedEEEPackage, setSelectedEEEPackage] = useState<EEEPackageTier>('enhanced');
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]); // Shared: tracks selected extras for both Simple and HHH modes
  const [timeLeft, setTimeLeft] = useState(15 * 60); // 15 minutes in seconds
  const [hasBooked, setHasBooked] = useState(false);
  const [isBooking, setIsBooking] = useState(false);
  const [hasReserved, setHasReserved] = useState(false); // Track if user clicked "Book Now"

  const [showSocialProof, setShowSocialProof] = useState(() => !sessionStorage.getItem('socialProofSeen')); // Social proof overlay on initial load
  const [expandedTiers, setExpandedTiers] = useState<Set<EEEPackageTier>>(new Set<EEEPackageTier>(['enhanced'])); // Track which tier's "What's included" is expanded
  const [bookedLeadId, setBookedLeadId] = useState<string | null>(null); // Store lead ID after booking
  const [datePreferencesSubmitted, setDatePreferencesSubmitted] = useState(false); // Track if date preferences are submitted
  const [showPriceIncreaseNotice, setShowPriceIncreaseNotice] = useState(false); // Show banner when prices increased
  const [isQuoteExpiredOnLoad, setIsQuoteExpiredOnLoad] = useState(false); // Track if quote was expired when loaded
  const [paymentMode, setPaymentMode] = useState<'full' | 'installments'>('installments'); // Track payment mode selection - default to installments

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

  // Hydrate selectedExtras from quote.selectedExtras (for admin-preselected extras)
  useEffect(() => {
    if (quote?.selectedExtras && quote.selectedExtras.length > 0) {
      setSelectedExtras(quote.selectedExtras);
    }
  }, [quote?.id]); // Only run when quote ID changes (quote loaded)

  // Calculate countdown timer from expiresAt
  useEffect(() => {
    if (!quote?.expiresAt) return;

    const calculateTimeLeft = () => {
      const expiryTime = new Date(quote.expiresAt!).getTime();
      const now = Date.now();
      const diff = Math.floor((expiryTime - now) / 1000);
      return Math.max(0, diff); // Never go negative
    };

    // Set initial time
    setTimeLeft(calculateTimeLeft());

    // Update every second
    const interval = setInterval(() => {
      const remaining = calculateTimeLeft();
      setTimeLeft(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [quote?.expiresAt]);

  // Auto-scroll to Enhanced package on mount
  useEffect(() => {
    if (quote && scrollContainerRef.current) {
      setTimeout(() => {
        const enhancedCard = scrollContainerRef.current?.querySelector('[data-testid="package-enhanced"]');
        if (enhancedCard) {
          const containerRect = scrollContainerRef.current!.getBoundingClientRect();
          const cardRect = enhancedCard.getBoundingClientRect();
          const containerCenter = containerRect.width / 2;
          const cardCenter = cardRect.width / 2;
          const scrollOffset = cardRect.left - containerRect.left - containerCenter + cardCenter;

          scrollContainerRef.current?.scrollBy({
            left: scrollOffset,
            behavior: 'instant'
          });
        }
      }, 50);
    }
  }, [quote]);

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

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

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
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-[#e8b323]" />
      </div>
    );
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

  // Check if quote has expired (timer reached 0, expiresAt is in the past, OR backend returned 410 expired status)
  const isExpired = isQuoteExpiredOnLoad || timeLeft === 0 || (quote.expiresAt && new Date(quote.expiresAt) < new Date());

  // Only create packages array if in HHH mode
  const packages: EEEPackage[] = quote.quoteMode === 'hhh' && quote.essentialPrice && quote.enhancedPrice && quote.elitePrice ? [
    {
      tier: 'essential',
      name: 'Handy Fix',
      price: quote.essentialPrice,
      warrantyMonths: 1, // 1 month
      description: 'Good & Reliable',
    },
    {
      tier: 'enhanced',
      name: 'Hassle-Free',
      price: quote.enhancedPrice,
      warrantyMonths: 6, // 6 months
      description: 'Priority & Convenience',
      isPopular: true,
    },
    {
      tier: 'elite',
      name: 'High Speed',
      price: quote.elitePrice,
      warrantyMonths: 12, // 12 months
      description: 'Fastest & Most Premium',
    },
  ] : [];

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

  return (
    <div className="h-screen bg-gradient-to-b from-gray-900 to-gray-800 flex flex-col relative">
      {/* Social Proof Overlay */}
      {showSocialProof && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg mx-4 p-8 space-y-6">
            {/* Google Reviews Section */}
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

              {/* Review Snippets */}
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

            {/* Trust Signals */}
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

            {/* CTA Button */}
            <Button
              onClick={() => {
                setShowSocialProof(false);
                sessionStorage.setItem('socialProofSeen', 'true');
              }}
              className="w-full bg-[#e8b323] hover:bg-[#d1a01f] text-gray-900 font-bold text-lg h-14 text-base shadow-lg"
              data-testid="button-see-my-quote"
            >
              See My Quote
            </Button>
          </div>
        </div>
      )}

      {/* Quote Expired Popup */}
      {isExpired && <QuoteExpiredPopup />}

      {/* Christmas Pay in 3 Promo Banner with Timer - Hidden once payment is made */}
      {!quote.bookedAt && (
        <div className="sticky top-0 z-50 bg-gradient-to-r from-red-700 via-red-600 to-green-700 border-b border-red-500/50 px-3 py-2">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-lg flex-shrink-0">🎄</span>
                <p className="text-white text-xs sm:text-sm truncate">
                  Christmas Cash Crunch? <span className="text-yellow-300 font-bold">Pay in 3!</span> Spread the cost into the new year 🎁
                </p>
              </div>
              <div className="flex items-center gap-1.5 bg-black/30 rounded px-2 py-1 flex-shrink-0">
                <Clock className="h-3 w-3 text-yellow-300" />
                <span className="text-sm font-bold text-white">{formatTime(timeLeft)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Price Increase Notice Banner */}
      {showPriceIncreaseNotice && (
        <div className="sticky top-[60px] z-40 bg-orange-600/95 backdrop-blur border-b border-orange-700 px-4 py-3">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="h-5 w-5 text-white flex-shrink-0" />
                  <h3 className="text-white font-bold">Prices Updated</h3>
                </div>
                <p className="text-white/90 text-sm">
                  Your quote expired, so we've refreshed it to reflect current demand and availability.
                </p>
              </div>
              <button
                onClick={() => setShowPriceIncreaseNotice(false)}
                className="text-white/80 hover:text-white transition-colors flex-shrink-0"
                data-testid="button-close-price-notice"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 px-4 py-3 pb-24 overflow-auto">
        <div className="max-w-2xl mx-auto">
          {/* Promotional Banner Image - Top of Page */}
          <div className="mb-6 rounded-xl overflow-hidden shadow-lg h-48 md:h-64 relative" data-testid="promo-banner">
            <img
              src={quote.contractor?.coverPhotoUrl || payIn3PromoImage}
              alt={quote.contractor?.coverPhotoUrl ? `Cover image for ${quote.contractor.name}` : "Handy Services - Pay in 3 interest-free payments"}
              className="w-full h-full object-cover"
            />
            {quote.contractor?.coverPhotoUrl && (
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end p-4">
                {/* Optional: Add text overlay if needed, currently just darkening bottom for contrast */}
              </div>
            )}
          </div>

          {/* Customer Information - Top of Page */}
          <Card className="bg-black/40 border-gray-700 mb-6" data-testid="customer-info-card">
            <CardContent className="p-4">
              <div className="mb-3 pb-3 border-b border-gray-700">
                {/* Quoted by Section */}
                <div className="flex items-center gap-3">
                  <img
                    src={quote.contractor?.profilePhotoUrl || mikeProfilePhoto}
                    alt={quote.contractor?.name || "Mike"}
                    className="w-12 h-12 rounded-full border-2 border-[#e8b323] object-cover"
                  />
                  <div>
                    <p className="text-white font-semibold text-sm">
                      Quoted by: {quote.contractor?.name || "Mike"}
                    </p>
                    {quote.contractor?.companyName && quote.contractor.companyName !== quote.contractor.name && (
                      <p className="text-gray-400 text-xs">{quote.contractor.companyName}</p>
                    )}
                    <div className="flex items-center gap-1">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} className="h-3 w-3 fill-[#e8b323] text-[#e8b323]" />
                      ))}
                      <span className="text-gray-400 text-xs ml-1">(4.9)</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <User className="h-5 w-5 text-[#e8b323] flex-shrink-0" />
                  <p className="text-white font-medium">{quote.customerName}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Phone className="h-5 w-5 text-[#e8b323] flex-shrink-0" />
                  <p className="text-white font-medium">{quote.phone}</p>
                </div>
                {quote.email && (
                  <div className="flex items-center gap-3">
                    <Mail className="h-5 w-5 text-[#e8b323] flex-shrink-0" />
                    <p className="text-white font-medium">{quote.email}</p>
                  </div>
                )}
                {quote.postcode && (
                  <div className="flex items-center gap-3">
                    <MapPin className="h-5 w-5 text-[#e8b323] flex-shrink-0" />
                    <p className="text-white font-medium">{quote.postcode}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Header */}
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-white mb-4 text-center">Your Personalized Quote</h2>
            <Card className="bg-black/40 border-gray-700">
              <CardContent className="p-4">
                {(() => {
                  // Extract summary and deliverables from jobs if available
                  const summary = quote.jobs?.[0]?.summary;
                  const deliverables: string[] = [];

                  if (quote.jobs && Array.isArray(quote.jobs)) {
                    quote.jobs.forEach((job) => {
                      if (job.tasks && Array.isArray(job.tasks)) {
                        job.tasks.forEach((task) => {
                          const deliverable = task.deliverable || task.description;
                          if (deliverable) {
                            deliverables.push(deliverable);
                          }
                        });
                      }
                    });
                  }

                  return (
                    <div className="space-y-4">
                      {/* Summary paragraph */}
                      {summary && (
                        <p className="text-gray-300 text-sm leading-relaxed">
                          {summary}
                        </p>
                      )}

                      {/* Deliverables as bullet points */}
                      {deliverables.length > 0 && (
                        <div className="space-y-2">
                          {deliverables.map((item, index) => (
                            <div key={index} className="flex items-start gap-3">
                              <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                                <Check className="h-3 w-3 text-white" />
                              </div>
                              <p className="text-white text-sm">{item}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Fallback to jobDescription if no jobs data */}
                      {!summary && deliverables.length === 0 && (
                        <div className="space-y-2">
                          {quote.jobDescription.split(/(?=[A-Z][a-z])/).map((task, index) => {
                            const trimmed = task.trim();
                            if (!trimmed) return null;
                            return (
                              <div key={index} className="flex items-start gap-3">
                                <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                                  <Check className="h-3 w-3 text-white" />
                                </div>
                                <p className="text-white text-sm">{trimmed}</p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </div>

          {/* HHH MODE: 3-Tier Package Stack - Dark Vertical Cards (Positioned FIRST) */}
          {quote.quoteMode !== 'simple' && packages.length > 0 && (
            <div className="w-full mb-8 space-y-6 px-4">
              {/* Header Text */}
              <div className="text-center mb-6">
                <h2 className="text-2xl md:text-3xl font-bold text-white">
                  Your job, your way — choose your preferred service level.
                </h2>
              </div>

              {/* Payment Mode Toggle - REMOVED to avoid duplication with sticky footer */}
              {/* <div className="mb-8">...</div> */}

              {packages.map((pkg) => {
                const rawFeatures = quote.tierDeliverables?.[pkg.tier === 'essential' ? 'essential' : pkg.tier === 'enhanced' ? 'hassleFree' : 'highStandard'] ||
                  getPerksForTier(quote, pkg.tier as 'essential' | 'enhanced' | 'elite');
                // DEBUG: Check for duplication
                console.log(`[Quote] Tier ${pkg.tier} raw features:`, rawFeatures);
                const features = Array.from(new Set(rawFeatures.map(f => typeof f === 'string' ? f.trim() : f)));
                console.log(`[Quote] Tier ${pkg.tier} unique features:`, features);
                const isExpanded = expandedTiers.has(pkg.tier);
                // UX Improvement: Show more features by default (4 instead of 1)
                const hasMoreFeatures = features.length > 4;

                // Tier 1 (essential) never shows installments, Tier 2/3 can use them
                const isTier1 = pkg.tier === 'essential';
                const isTier2or3 = pkg.tier === 'enhanced' || pkg.tier === 'elite';
                const showInstallments = isTier2or3 && paymentMode === 'installments';

                // Calculate extras total for this tier
                const extrasTotal = selectedExtras.reduce((sum, label) => {
                  const extra = quote.optionalExtras?.find(e => e.label === label);
                  return sum + (extra?.priceInPence || 0);
                }, 0);

                // Total job price = tier price + extras
                const baseJobPrice = pkg.price + extrasTotal;

                // Calculate installment pricing with 10% convenience fee
                const LENIENCY_FEE_RATE = 0.10; // 10%
                const convenienceFee = showInstallments ? Math.round(baseJobPrice * LENIENCY_FEE_RATE) : 0;
                const totalWithFee = baseJobPrice + convenienceFee;

                // Calculate deposit and installment amounts
                // Deposit uses base job price (tier + extras, no fee) - matches calculateDeposit function
                const depositAmount = calculateDeposit(pkg.price);
                const remainingBalance = Math.max(0, (showInstallments ? totalWithFee : baseJobPrice) - depositAmount);
                const installmentAmount = Math.round(remainingBalance / 3);

                // Define tier-specific styles matching reference image
                const tierStyles = {
                  essential: {
                    bg: 'bg-gradient-to-br from-slate-800 to-slate-900',
                    badge: null,
                    badgeColor: ''
                  },
                  enhanced: {
                    bg: 'bg-gradient-to-br from-green-900 to-green-950',
                    badge: 'MOST POPULAR',
                    badgeColor: 'bg-lime-400'
                  },
                  elite: {
                    bg: 'bg-gradient-to-br from-rose-900 to-rose-950',
                    badge: 'PREMIUM',
                    badgeColor: 'bg-pink-400'
                  }
                };

                const style = tierStyles[pkg.tier as keyof typeof tierStyles];

                // Handy Fix disabled when installment mode active
                const isDisabled = isTier1 && paymentMode === 'installments';

                return (
                  <div
                    key={pkg.tier}
                    className={`relative ${isDisabled ? 'opacity-50 pointer-events-none' : ''}`}
                    data-testid={`package-${pkg.tier}`}
                  >
                    {isDisabled && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 rounded-2xl">
                        <div className="bg-gray-900 px-4 py-2 rounded-lg border border-gray-700">
                          <p className="text-white text-sm font-semibold">Only available with Pay on Completion</p>
                        </div>
                      </div>
                    )}
                    <div className={`${style.bg} rounded-2xl overflow-hidden text-white shadow-2xl ${pkg.tier === 'enhanced'
                      ? 'border-4 border-yellow-400 shadow-yellow-400/50'
                      : 'border border-white/10'
                      }`}>
                      {/* Full-Width Banner - Only for Enhanced and Elite tiers */}
                      {style.badge && (
                        <div className={`${style.badgeColor} text-black text-center py-2 px-4`}>
                          <span className="text-xs font-bold uppercase tracking-wide">
                            {style.badge}
                          </span>
                        </div>
                      )}

                      {/* Card Content with Padding */}
                      <div className="p-6">
                        {/* Header: Tier Name */}
                        <div className="mb-4">
                          <h3 className="text-2xl font-bold text-white">
                            {pkg.name}
                          </h3>
                          {
                            pkg.tier === 'enhanced' && (
                              <div className="flex flex-wrap gap-2 mt-2">
                                <TooltipProvider>
                                  <Tooltip delayDuration={0}>
                                    <TooltipTrigger asChild>
                                      <div><NeonBadge text="Free 15m Extra Time" color="green" icon={Clock} /></div>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom" className="bg-green-950 border-green-800 text-green-100 max-w-[200px]">
                                      <p>We'll stay 15 mins extra <strong>for free</strong> to tackle any small odd jobs you need doing.</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </div>
                            )
                          }
                          {
                            pkg.tier === 'elite' && (
                              <div className="flex flex-wrap gap-2 mt-2">
                                <TooltipProvider>
                                  <Tooltip delayDuration={0}>
                                    <TooltipTrigger asChild>
                                      <div><NeonBadge text="Guaranteed 8am" color="pink" icon={Sun} /></div>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom" className="bg-pink-950 border-pink-800 text-pink-100 max-w-[200px]">
                                      <p>The "Golden Slot". We arrive at 8am sharp. No traffic excuses, no waiting in.</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                                <TooltipProvider>
                                  <Tooltip delayDuration={0}>
                                    <TooltipTrigger asChild>
                                      <div><NeonBadge text="Sparkle Clean" color="blue" icon={Wrench} /></div>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom" className="bg-blue-950 border-blue-800 text-blue-100 max-w-[200px]">
                                      <p>We bring a Dyson and disinfectant. We leave your home cleaner than we found it.</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </div>
                            )
                          }
                        </div>

                        {/* Pricing Section */}
                        <div className="mb-6">
                          {isTier1 ? (
                            <>
                              {/* Tier 1: Always deposit + rest on day (no installments) */}
                              <div className="flex items-baseline gap-2 mb-1">
                                <span className="text-pink-400 line-through text-2xl font-bold">
                                  £{formatPrice(Math.round(pkg.price * 1.4))}
                                </span>
                                <span className="text-5xl font-black text-white">
                                  £{formatPrice(pkg.price)}
                                </span>
                              </div>
                              <p className="text-gray-400 text-sm">Deposit + rest on completion</p>
                            </>
                          ) : showInstallments ? (
                            <>
                              {/* Tier 2/3: Installment Mode with Fee Breakdown */}
                              <div className="space-y-2">
                                <div className="flex items-baseline gap-2">
                                  <span className="text-4xl font-black text-white">
                                    £{formatPrice(depositAmount)}
                                  </span>
                                  <span className="text-gray-400 text-lg">deposit today</span>
                                </div>
                                <div className="flex items-baseline gap-2">
                                  <span className="text-2xl font-bold text-lime-400">
                                    + £{formatPrice(installmentAmount)}
                                  </span>
                                  <span className="text-gray-400 text-sm">× 3 monthly payments</span>
                                </div>
                                <div className="pt-2 pb-1 border-t border-white/10">
                                  <div className="flex justify-between items-center text-sm font-semibold">
                                    <span className="text-white">Total</span>
                                    <span className="text-white">£{formatPrice(totalWithFee)}</span>
                                  </div>
                                </div>
                              </div>
                            </>
                          ) : (
                            <>
                              {/* Tier 2/3: Standard Mode */}
                              <div className="flex items-baseline gap-2 mb-1">
                                <span className="text-pink-400 line-through text-2xl font-bold">
                                  £{formatPrice(Math.round(pkg.price * 1.4))}
                                </span>
                                <span className="text-5xl font-black text-white">
                                  £{formatPrice(pkg.price)}
                                </span>
                              </div>
                              <p className="text-gray-400 text-sm">Deposit + rest on day</p>
                            </>
                          )}
                        </div>

                        {/* Feature List with Expandable Toggle */}
                        <div className="space-y-3 mb-6">
                          {/* Show first 4 features when collapsed, all when expanded */}
                          {(isExpanded ? features : features.slice(0, 4)).map((deliverable, idx) => (
                            <div key={idx} className="flex items-start gap-3">
                              <Check className="h-5 w-5 text-white flex-shrink-0 mt-0.5" strokeWidth={3} />
                              <span className="text-gray-200 text-sm leading-relaxed flex-1">{deliverable}</span>
                            </div>
                          ))}

                          {/* Expand/Collapse Button - Only show if more than 4 features */}
                          {hasMoreFeatures && (
                            <button
                              onClick={() => {
                                setExpandedTiers(prev => {
                                  const newSet = new Set(prev);
                                  if (newSet.has(pkg.tier)) {
                                    newSet.delete(pkg.tier);
                                  } else {
                                    newSet.add(pkg.tier);
                                  }
                                  return newSet;
                                });
                              }}
                              className="flex items-center justify-between w-full pt-2 text-gray-300 hover:text-white transition-colors"
                              data-testid={`expand-toggle-${pkg.tier}`}
                            >
                              <span className="text-sm font-medium">
                                {isExpanded ? 'Show less' : `+${features.length - 4} more`}
                              </span>
                              <ChevronDown
                                className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                              />
                            </button>
                          )}

                          {/* Warranty with badge */}
                          <div className="flex items-center justify-between pt-3 border-t border-white/10">
                            <div className="flex items-center gap-2">
                              <Lock className="h-4 w-4 text-gray-300" />
                              <span className="text-gray-300 text-sm">Guarantee</span>
                            </div>
                            <span className="bg-lime-400 text-black text-xs font-bold px-3 py-1 rounded-full">
                              {pkg.warrantyMonths} {pkg.warrantyMonths === 1 ? 'MONTH' : 'MONTHS'}
                            </span>
                          </div>

                          {/* Availability Strip */}
                          <div className="mt-3 border-t border-white/10 pt-3">
                            <div className="flex items-center gap-2 mb-2">
                              <Clock className="h-4 w-4 text-gray-300" />
                              <span className="text-gray-300 text-sm">Earliest Availability</span>
                            </div>
                            <DateStrip tier={pkg.tier as 'essential' | 'enhanced' | 'elite'} availableDates={quote.availability?.availableDates || []} />
                          </div>
                        </div>

                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Three Ways Header + Comparison Grid - HHH Mode Only */}
          {quote.quoteMode === 'hhh' && (
            <>
              {/* Spotify-Style Intro */}
              <div className="mb-8 text-center">
                <h3 className="text-3xl md:text-4xl font-bold text-white mb-3">Choose your service level</h3>
                <p className="text-gray-300 text-base md:text-lg max-w-xl mx-auto">
                  Pick the package that fits your needs and budget. All options solve your problem—choose how it's done.
                </p>
              </div>

              {/* Comparison Grid */}
              <Card className="bg-black/40 border-gray-700 mb-6" data-testid="comparison-grid">
                <CardContent className="p-0">
                  {/* Table View (All Screens) */}
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
            </>
          )}

          {/* PICK & MIX MODE: Checklist of Items */}
          {quote.quoteMode === 'pick_and_mix' && quote.optionalExtras && (
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
          )}

          {/* Quote Display - Simple mode */}
          {quote.quoteMode === 'simple' && quote.basePrice && quote.optionalExtras && (
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
                  <div className="bg-gray-700/50 rounded-lg p-4 mb-4">
                    <h4 className="text-white font-semibold mb-3 text-sm">What You'll Get:</h4>
                    <div className="space-y-2">
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
                          <div key={idx} className="flex items-center gap-3">
                            <div className="flex-shrink-0 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                            <span className="text-gray-200 text-sm">{item}</span>
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
          )}

          {/* Optional Extras for HHH Mode */}
          {hasReserved && quote.quoteMode !== 'simple' && quote.optionalExtras && quote.optionalExtras.length > 0 && (
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
          )}

          {/* Google Reviews Banner */}
          <div className="mt-6 px-4">
            <div className="bg-gray-800/80 border border-gray-700 rounded-lg p-4">
              <div className="flex items-center justify-center gap-3 mb-4">
                <SiGoogle className="h-10 w-10 text-white" />
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4].map((i) => (
                    <Star key={i} className="h-5 w-5 fill-[#e8b323] text-[#e8b323]" />
                  ))}
                  <Star className="h-5 w-5 fill-[#e8b323] text-[#e8b323]" style={{ clipPath: 'inset(0 10% 0 0)' }} />
                </div>
                <div className="text-white">
                  <span className="text-2xl font-bold">4.9</span>
                  <span className="text-gray-400 ml-2">from 300+ Reviews</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-gray-300">
                  <Lock className="h-4 w-4 text-blue-400" />
                  <span>Secure quote backed by guarantee</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-300">
                  <Clock className="h-4 w-4 text-amber-400" />
                  <span>Takes less than 30 seconds</span>
                </div>
              </div>

              {/* Customer Reviews */}
              <div className="mt-4 pt-4 border-t border-gray-700 space-y-3">
                <div className="bg-gray-900/50 rounded-lg p-3">
                  <div className="flex items-center gap-1 mb-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star key={i} className="h-3 w-3 fill-[#e8b323] text-[#e8b323]" />
                    ))}
                  </div>
                  <p className="text-gray-300 text-sm italic">"Brilliant service! Turned up on time and did a fantastic job. Highly recommend."</p>
                  <p className="text-gray-500 text-xs mt-1">— Sarah M., Verified Customer</p>
                </div>

                <div className="bg-gray-900/50 rounded-lg p-3">
                  <div className="flex items-center gap-1 mb-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star key={i} className="h-3 w-3 fill-[#e8b323] text-[#e8b323]" />
                    ))}
                  </div>
                  <p className="text-gray-300 text-sm italic">"The pay in 3 option was perfect for Christmas. Got my shelves up without breaking the bank!"</p>
                  <p className="text-gray-500 text-xs mt-1">— James T., Verified Customer</p>
                </div>

                <div className="bg-gray-900/50 rounded-lg p-3">
                  <div className="flex items-center gap-1 mb-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star key={i} className="h-3 w-3 fill-[#e8b323] text-[#e8b323]" />
                    ))}
                  </div>
                  <p className="text-gray-300 text-sm italic">"Professional, friendly and reasonably priced. Will definitely use again!"</p>
                  <p className="text-gray-500 text-xs mt-1">— Emma W., Verified Customer</p>
                </div>
              </div>
            </div>
          </div>

          {/* Pay in 3 Section - Simple Pie Chart Design */}
          {!hasReserved && (
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
          )}

          {/* FAQ Section - Hide when payment form is shown */}
          {!hasReserved && (
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
          )}

          {/* Payment Methods Section - Hide when payment form is shown, will move inside payment section */}
          {!hasReserved && (
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
          )}

          {/* Confirm Button or Confirmation */}
          {hasBooked && !datePreferencesSubmitted ? (
            /* Tenant View or Direct Booking flow when leadId exists */
            <div ref={dateSelectionRef} className="mt-8">
              <Card className="border-[#e8b323] bg-gray-800 border-2">
                <CardContent className="p-8">
                  <h3 className="text-xl font-bold text-[#e8b323] mb-4 text-center">
                    Schedule the Repair
                  </h3>
                  <DateSelectionForm
                    tier={mapTierToHHH(selectedEEEPackage)}
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

                      // Calculate total job price (before convenience fee)
                      const baseJobPrice = baseTierPrice + extrasTotal;

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
                                {extrasTotal > 0 ? (
                                  <>
                                    <div className="flex justify-between gap-4">
                                      <span className="text-gray-300">{quote.quoteMode === 'simple' ? 'Job price' : getPackageDisplayName(selectedEEEPackage)}:</span>
                                      <span className="text-white">£{Math.round(baseTierPrice / 100)}</span>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                      <span className="text-gray-300">+ Optional extras ({selectedExtras.length}):</span>
                                      <span className="text-white">£{Math.round(extrasTotal / 100)}</span>
                                    </div>
                                    <div className="flex justify-between gap-4 pt-2 border-t border-gray-500">
                                      <span className="font-semibold text-gray-200">Total:</span>
                                      <span className="font-semibold text-white">£{Math.round(totalWithFee / 100)}</span>
                                    </div>
                                  </>
                                ) : (
                                  <div className="flex justify-between gap-4">
                                    <span className="font-semibold text-gray-200">{quote.quoteMode === 'simple' ? 'Job price' : getPackageDisplayName(selectedEEEPackage)}:</span>
                                    <span className="font-semibold text-white">£{Math.round(totalWithFee / 100)}</span>
                                  </div>
                                )}
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
                                  customerName={quote.customerName}
                                  customerEmail={quote.email}
                                  quoteId={quote.id}
                                  selectedTier={quote.quoteMode === 'simple' ? 'simple' : selectedEEEPackage}
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
        </div >

        {/* Sticky Footer - Package Selection Bar (HHH Mode Only) */}
        {
          quote.quoteMode !== 'simple' && packages.length > 0 && !hasBooked && (
            <div className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900/98 backdrop-blur-lg border-t border-gray-700 shadow-2xl">
              <div className="max-w-2xl mx-auto px-2 py-2">
                {/* Payment Toggle Row */}
                <div className="flex items-center justify-center gap-2 mb-1.5">
                  <span className={`text-[10px] uppercase tracking-wider ${paymentMode === 'full' ? 'text-white font-medium' : 'text-gray-500'}`}>
                    Pay in Full
                  </span>
                  <button
                    onClick={() => setPaymentMode(paymentMode === 'installments' ? 'full' : 'installments')}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${paymentMode === 'installments' ? 'bg-[#e8b323]' : 'bg-gray-600'
                      }`}
                    data-testid="footer-payment-toggle"
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-md transition-transform ${paymentMode === 'installments' ? 'translate-x-5' : 'translate-x-0.5'
                        }`}
                    />
                  </button>
                  <span className={`text-[10px] uppercase tracking-wider ${paymentMode === 'installments' ? 'text-white font-medium' : 'text-gray-500'}`}>
                    Pay Monthly
                  </span>
                </div>

                {/* Package Selection Row */}
                <div className="flex gap-1.5 mb-2">
                  {packages.map((pkg) => {
                    const isSelected = selectedEEEPackage === pkg.tier;
                    const isTier1 = pkg.tier === 'essential';
                    const isDisabledByPaymentMode = isTier1 && paymentMode === 'installments';

                    const LENIENCY_FEE_RATE = 0.10; // 10% convenience fee for 3 monthly payments
                    const showInstallments = !isTier1 && paymentMode === 'installments';
                    const convenienceFee = showInstallments ? Math.round(pkg.price * LENIENCY_FEE_RATE) : 0;
                    const displayPrice = pkg.price + convenienceFee;

                    // Calculate deposit from base price (without fee), then monthly from total with fee
                    const depositAmount = calculateDeposit(pkg.price);
                    const remainingBalance = Math.max(0, displayPrice - depositAmount);
                    const monthlyInstallment = Math.round(remainingBalance / 3);

                    return (
                      <button
                        key={pkg.tier}
                        onClick={() => {
                          if (!isDisabledByPaymentMode) {
                            setSelectedEEEPackage(pkg.tier);
                          }
                        }}
                        disabled={isDisabledByPaymentMode}
                        tabIndex={isDisabledByPaymentMode ? -1 : 0}
                        aria-disabled={isDisabledByPaymentMode}
                        className={`flex-1 py-1.5 px-1 rounded-md text-center transition-all ${isDisabledByPaymentMode
                          ? 'bg-gray-800/50 opacity-40 cursor-not-allowed'
                          : isSelected
                            ? 'bg-[#e8b323] text-gray-900 shadow-lg ring-1 ring-[#e8b323]'
                            : 'bg-gray-800 text-white hover:bg-gray-700 border border-gray-600'
                          }`}
                        data-testid={`footer-package-${pkg.tier}`}
                      >
                        <div className="text-[10px] font-medium opacity-80 truncate uppercase tracking-tight">
                          {pkg.name}
                        </div>
                        <div className="text-xs font-bold leading-tight">
                          {showInstallments ? (
                            <div className="flex flex-col items-center justify-center leading-none">
                              <span className={`font-black tracking-tight text-[11px] ${isSelected ? 'text-gray-900' : 'text-lime-400'}`}>
                                £{Math.round(depositAmount / 100)} Today
                              </span>
                              <span className={`text-[9px] font-medium mt-0.5 ${isSelected ? 'text-gray-800/80' : 'text-gray-400'}`}>
                                then 3x £{Math.round(monthlyInstallment / 100)}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center justify-center gap-1">
                              <span>£{Math.round(displayPrice / 100)}</span>
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Approve Button */}
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      setHasReserved(true);
                      setTimeout(() => {
                        const target = quote.optionalExtras && quote.optionalExtras.length > 0
                          ? document.getElementById('optional-extras')
                          : document.getElementById('confirm-button');
                        target?.scrollIntoView({ behavior: 'smooth' });
                      }, 100);
                    }}
                    className="flex-1 bg-[#e8b323] hover:bg-[#d1a01f] text-gray-900 font-bold text-sm py-2.5 h-auto shadow-lg"
                    data-testid="button-approve-footer"
                  >
                    <Check className="h-4 w-4 mr-1.5" />
                    Approve & Pay Deposit
                  </Button>
                </div>
              </div>
            </div>
          )
        }



        {/* Sticky Footer - Pick & Mix Mode */}
        {
          quote.quoteMode === 'pick_and_mix' && !hasBooked && (
            <div className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900/98 backdrop-blur-lg border-t border-gray-700 shadow-2xl safe-area-bottom">
              <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">Total</p>
                  <p className="text-2xl font-bold text-white leading-none">
                    £{formatPrice(calculateSimpleTotal())}
                  </p>
                </div>

                <Button
                  onClick={() => {
                    setHasReserved(true);
                    setTimeout(() => {
                      const target = document.getElementById('confirm-button');
                      target?.scrollIntoView({ behavior: 'smooth' });
                    }, 100);
                  }}
                  disabled={calculateSimpleTotal() === 0}
                  className="flex-1 bg-[#e8b323] hover:bg-[#d1a01f] text-gray-900 font-bold shadow-lg"
                  data-testid="button-book-pm-footer"
                >
                  {calculateSimpleTotal() === 0 ? 'Select Items' : 'Book Now'}
                  <ChevronRight className="ml-1 h-5 w-5" />
                </Button>
              </div>
            </div>
          )
        }

        <style>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>

      </div>
    </div >
  );
}
