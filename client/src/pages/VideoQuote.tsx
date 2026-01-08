
import { useState, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { Loader2, ArrowLeft, ChevronRight, Lock, Calendar, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PackageSelectionSection, type Package } from "@/components/video-review/PackageSelectionSection";
import { BookingCalendar, type BookingSlot } from "@/components/ui/booking-calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ProgressIndicator } from "@/components/video-review/ProgressIndicator";
import { ErrorBanner, type ErrorState } from "@/components/video-review/ErrorBanner";
import { motion } from "framer-motion";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { generateEEETaglines } from "../../../shared/taglines";
import { selectBenefits, createCapacityChecker, createContextFlags } from "../../../shared/benefits-decorator";

export default function VideoQuote() {
  const [location, setLocation] = useLocation();
  const [match, params] = useRoute('/quote-link/:slug');
  const slug = match ? params?.slug : null;

  const [quoteData, setQuoteData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ErrorState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedTier, setSelectedTier] = useState<"essential" | "enhanced" | "elite" | "consultation">("enhanced");
  const [showBookingCalendar, setShowBookingCalendar] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<BookingSlot | undefined>(undefined);
  const { toast } = useToast();

  // Fetch quote data
  useEffect(() => {
    if (!slug) {
      setLoading(false);
      return;
    }

    const fetchQuote = async () => {
      try {
        const res = await fetch(`/api/personalized-quotes/${slug}`);
        if (!res.ok) throw new Error("Quote not found");
        const data = await res.json();
        setQuoteData(data);
        if (data.quoteMode === 'consultation') {
          setSelectedTier('consultation');
        }
      } catch (err: any) {
        console.error("Error fetching quote:", err);
        setError({
          message: "We couldn't load your quote.",
          details: "The link might be expired or invalid.",
          retry: () => window.location.reload()
        });
      } finally {
        setLoading(false);
      }
    };

    fetchQuote();
  }, [slug]);

  const handleReserve = async () => {
    if (!quoteData) return;

    // For consultation, force user to pick a slot if not already picked
    if (selectedTier === 'consultation' && !selectedSlot) {
      setShowBookingCalendar(true);
      return;
    }

    setSubmitting(true);

    // Find selected package details
    const selectedPkg = packages.find(p => p.tier === selectedTier);
    if (!selectedPkg) return;

    try {
      await apiRequest('/api/leads', 'POST', {
        customerName: quoteData.customerName,
        phone: quoteData.phone,
        email: quoteData.email || undefined,
        jobDescription: quoteData.jobDescription,
        source: 'quote_link_reservation',
        outcome: selectedTier === 'consultation' ? 'consultation_booked' : 'reserved',
        eeePackage: selectedTier,
        quoteAmount: selectedTier === 'consultation' ? (quoteData.basePrice || quoteData.baseJobPricePence || 8500) : selectedPkg.price * 100, // Pence
        bookingRequest: selectedSlot ? {
          date: selectedSlot.date.toISOString(),
          slot: selectedSlot.slot
        } : undefined
      });

      setShowBookingCalendar(false);

      toast({
        title: selectedTier === 'consultation' ? "Visit Booked!" : "Slot Reserved!",
        description: selectedTier === 'consultation' ? "We'll see you on the selected date." : "We'll contact you shortly to confirm your booking.",
      });

      // Redirect to home or confirmation
      setTimeout(() => {
        setLocation('/landing');
      }, 2000);

    } catch (err) {
      console.error("Reservation error:", err);
      toast({
        title: "Error",
        description: "Failed to reserve slot. Please call us directly.",
        variant: "destructive"
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#1a2332] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }

  if (!quoteData && !loading) {
    return (
      <div className="min-h-screen bg-[#1a2332] flex flex-col items-center justify-center p-6 text-center">
        <h2 className="text-xl font-bold text-white mb-2">Quote Not Found</h2>
        <p className="text-slate-400 mb-6">This link may be invalid or expired.</p>
        <Button onClick={() => setLocation('/landing')} className="bg-emerald-500 hover:bg-emerald-600">
          Return Home
        </Button>
      </div>
    );
  }

  // --- RECONSTRUCT PACKAGES LOGIC ---
  // This logic mimics the original VideoQuote.tsx calculation
  const basePrice = (quoteData.basePrice || quoteData.essentialPrice || 0) / 100;
  const jobTasks = quoteData.tasks ? quoteData.tasks.map((t: string) => ({ description: t })) : [{ description: quoteData.jobDescription }];
  const urgency = quoteData.urgency || 'medium';

  const enhancedMarkup = Math.max(basePrice * 0.08, 15);
  const eliteMarkup = Math.max(basePrice * 0.18, 35);
  const aftercareFee = 25;

  const roundPrice = (p: number) => {
    const rounded = Math.round(p);
    const lastDigit = rounded % 10;
    if (lastDigit === 9) return rounded;
    if (lastDigit < 5) return rounded - lastDigit + 9;
    return rounded + (9 - lastDigit);
  };

  const priceEssential = roundPrice(basePrice);
  const priceEnhanced = roundPrice(basePrice + enhancedMarkup);
  const priceElite = roundPrice(basePrice + eliteMarkup + aftercareFee);

  const taglines = generateEEETaglines(
    { summary: quoteData.jobDescription, urgency },
    { essential: 3, enhanced: 12, elite: 36 }
  );

  // We need createEEETierFeatures equivalent or similar
  // Simplified feature generation for display
  const baseFeatures = jobTasks.slice(0, 3).map((t: any) => t.description);

  const packages: Package[] = [
    {
      tier: "essential",
      name: "Essential",
      price: priceEssential,
      description: taglines.essential,
      features: [...baseFeatures, "Turn up on time guarantee", "Clean up and leave tidy guarantee"],
      warrantyMonths: 3
    },
    {
      tier: "enhanced",
      name: "Enhanced",
      price: priceEnhanced,
      description: taglines.enhanced,
      isPopular: true,
      features: ["12-month workmanship warranty", ...baseFeatures, "Priority scheduling", "Materials sourcing included"],
      warrantyMonths: 12
    },
    {
      tier: "elite",
      name: "Elite",
      price: priceElite,
      description: taglines.elite,
      hasAftercare: true,
      features: ["36-month workmanship warranty", ...baseFeatures, "Express next-day slots", "Dedicated project manager"],
      warrantyMonths: 36
    }
  ];

  const selectedPkg = selectedTier === 'consultation'
    ? { name: 'Diagnostic Visit', price: (quoteData.basePrice || quoteData.baseJobPricePence || 8500) / 100, tier: 'consultation' }
    : (packages.find(p => p.tier === selectedTier) || packages[1]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[#1a2332] pb-64 relative"
    >
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {/* Header */}
      <div className="bg-[#1a2332] border-b border-gray-700/50 sticky top-0 z-50 backdrop-blur-md bg-opacity-90">
        <div className="max-w-md mx-auto px-4 h-14 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation('/landing')}
            className="text-white hover:bg-white/10 -ml-2"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Home
          </Button>
          <span className="text-sm font-medium text-slate-300">
            Select Package
          </span>
          <div className="w-10"></div>
        </div>
        <ProgressIndicator currentSection="quote" />
      </div>

      <div className="max-w-md mx-auto py-6">
        <div className="px-4 mb-6">
          <h1 className="text-2xl font-bold text-white mb-1">Hi {quoteData.customerName},</h1>
          <p className="text-slate-400 text-sm">Choose the package that works best for you.</p>
        </div>

        {quoteData?.quoteMode === 'consultation' ? (
          <div className="px-4 pb-32">
            <div className="relative rounded-xl border-2 border-amber-500/50 bg-slate-800/50 overflow-hidden">
              <div className="absolute top-0 right-0 bg-amber-500 text-black text-[10px] font-bold px-3 py-1 rounded-bl-lg z-10">
                REQUIRED
              </div>
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-white font-bold text-xl">Professional Site Consultation</h3>
                    <p className="text-amber-400 text-sm font-medium mt-1">Fee 100% credited to final job</p>
                  </div>
                  <div className="text-2xl font-bold text-white">£{((quoteData.basePrice || quoteData.baseJobPricePence || 8500) / 100)}</div>
                </div>

                <p className="text-slate-300 text-sm mb-6 border-l-2 border-amber-500/50 pl-4 py-1 italic">
                  "Due to the complexity of this job, a senior technician needs to assess the site to provide a guaranteed fixed price."
                </p>

                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500">
                      <Lock className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-white font-medium text-sm">Detailed Complexity Assessment</p>
                      <p className="text-slate-400 text-xs">We identify hidden issues before starting.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500">
                      <Check className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-white font-medium text-sm">Deductible Deposit</p>
                      <p className="text-slate-400 text-xs">The £85 fee is removed from your final quote.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500">
                      <Calendar className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-white font-medium text-sm">Priority Scheduling</p>
                      <p className="text-slate-400 text-xs">Unlocks immediate booking slots.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <PackageSelectionSection
            packages={packages}
            selectedTier={selectedTier as "essential" | "enhanced" | "elite"}
            onSelect={setSelectedTier}
          />
        )}

        {/* Sticky Footer */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-[#1a2332]/95 backdrop-blur-xl border-t border-slate-700/50 z-40 shadow-[0_-8px_30px_rgba(0,0,0,0.5)]">
          <div className="max-w-md mx-auto">
            <div className="flex items-center justify-between mb-3 px-1">
              <div>
                <p className="text-slate-400 text-xs uppercase tracking-wider font-semibold">Selected</p>
                <p className="text-white font-bold text-lg">{selectedPkg.name} <span className="text-emerald-400">£{selectedPkg.price}</span></p>
              </div>
              {selectedPkg.tier !== 'essential' && (
                <div className="text-right">
                  <div className="bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded text-[10px] text-emerald-400 font-medium">
                    Split Payments Available
                  </div>
                </div>
              )}
            </div>

            <Button
              className="w-full h-14 text-lg font-bold rounded-xl shadow-lg bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white transform active:scale-95 transition-all"
              onClick={handleReserve}
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 className="w-5 h-5 animate-spin mx-auto" />
              ) : (
                <>
                  {selectedTier === 'consultation' ? "Book Diagnostic Visit" : `Reserve ${selectedPkg.name} Slot`}
                  <ChevronRight className="w-5 h-5 ml-2" />
                </>
              )}
            </Button>
            <div className="flex items-center justify-center gap-2 mt-3 text-slate-500 text-[10px]">
              <Lock className="w-3 h-3" />
              <span>Valid for 15:00 minutes. No payment required now.</span>
            </div>
          </div>
        </div>
      </div>
      <Dialog open={showBookingCalendar} onOpenChange={setShowBookingCalendar}>
        <DialogContent className="bg-[#1a2332] text-white border-slate-700 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule Your Diagnostic Visit</DialogTitle>
            <DialogDescription className="text-slate-400">
              Select a preferred date and time for our senior technician to visit.
            </DialogDescription>
          </DialogHeader>

          <BookingCalendar
            onSelect={(slot) => setSelectedSlot(slot)}
            selectedSlot={selectedSlot}
            className="mt-4"
          />

          <Button
            onClick={handleReserve}
            disabled={!selectedSlot || submitting}
            className="w-full mt-4 bg-emerald-500 hover:bg-emerald-600 text-white font-bold h-12 rounded-xl"
          >
            {submitting ? <Loader2 className="animate-spin" /> : "Confirm Application & Book Visit"}
          </Button>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
