
import { useState } from "react";
import { motion } from "framer-motion";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Check, Lock, ShieldCheck, MapPin, HelpCircle, Wrench, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookingCalendar, type BookingSlot } from "@/components/ui/booking-calendar";
import { useToast } from "@/hooks/use-toast";
import { NeonBadge } from "@/components/ui/neon-badge";
import { format } from "date-fns";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";
import { Elements } from '@stripe/react-stripe-js';
import { stripePromise } from '@/lib/stripe';
import { PaymentForm } from '@/components/PaymentForm';
import { ExpertStickyNote } from "@/components/ExpertStickyNote";
import mikeProfilePhoto from '@assets/mike-profile-photo.png';

type TierId = 'standard' | 'priority' | 'emergency';

const slotLabels: Record<string, string> = {
    morning: "Morning (8am - 12pm)",
    afternoon: "Afternoon (12pm - 4pm)",
    evening: "Evening (4pm - 8pm)"
};

interface TierOption {
    id: TierId;
    name: string;
    price: number;
    color: 'blue' | 'amber' | 'red';
    desc: string;
    features: string[];
    isRefundable?: boolean;
}

export default function DiagnosticVisitPage() {
    const [, params] = useRoute('/visit-link/:slug');
    const { toast } = useToast();

    const [selectedSlot, setSelectedSlot] = useState<BookingSlot | undefined>(undefined);
    const [isProcessing, setIsProcessing] = useState(false);

    // Track which tier is selected for booking
    const [selectedTier, setSelectedTier] = useState<TierOption | null>(null);
    const [showPayment, setShowPayment] = useState(false);

    // Fetch quote basic details
    const { data: quote, isLoading } = useQuery({
        queryKey: ['/api/personalized-quotes', params?.slug],
        queryFn: async () => {
            const res = await fetch(`/api/personalized-quotes/${params?.slug}`);
            if (!res.ok) throw new Error("Link invalid");
            return res.json();
        },
        enabled: !!params?.slug
    });

    const handleSlotConfirm = async () => {
        if (!selectedSlot || !quote) return;

        // Simply show the payment form
        setShowPayment(true);
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
            </div>
        );
    }

    if (!quote) return <div className="p-10 text-center text-white">Invalid Link</div>;


    // Use price from quote or default to 85 for standard
    const isCommercial = quote.clientType === 'commercial';

    // Pricing Configuration
    const PRICES = isCommercial
        ? { standard: 85, priority: 150, emergency: 250 }
        : { standard: 49, priority: 99, emergency: 175 }; // Residential Rates

    const basePrice = quote.basePrice ? (quote.basePrice / 100) : PRICES.standard;

    const TIERS: TierOption[] = [
        {
            id: 'standard',
            name: 'Standard Visit',
            price: quote.tierStandardPrice ? (quote.tierStandardPrice / 100) : PRICES.standard,
            color: 'blue',
            desc: 'Diagnosis & Quote Only',
            features: [
                'Senior Expert Assessment',
                'Guaranteed Fixed Quote',
                'Risk & Issues Check',
                'Fee 100% Credited to Job'
            ],
            isRefundable: true
        },
        {
            id: 'priority',
            name: 'Priority Visit',
            price: quote.tierPriorityPrice ? (quote.tierPriorityPrice / 100) : PRICES.priority,
            color: 'amber',
            desc: 'Fast Track + Minor Fixes',
            features: [
                'Same Day / Next Morning',
                'Senior Technician',
                'Includes 30mins Minor Labor',
                'Priority Report Delivery'
            ],
            isRefundable: true
        },
        {
            id: 'emergency',
            name: 'Emergency',
            price: quote.tierEmergencyPrice ? (quote.tierEmergencyPrice / 100) : PRICES.emergency,
            color: 'red',
            desc: 'Immediate Response',
            features: [
                'Arrival within 4 Hours',
                'Head Technician',
                'Immediate "Make Safe" / Fix',
                'Includes 1hr Emergency Labor'
            ],
            isRefundable: false
        }
    ];

    // Determine the price to display in the modal
    const finalPrice = selectedTier ? selectedTier.price : basePrice;
    const finalTierName = selectedTier ? selectedTier.name : "Diagnostic Visit";

    // Helper to get wait time
    const getWaitDays = (tierId: string) => {
        switch (tierId) {
            case 'emergency': return 0;
            case 'priority': return 3;
            default: return 10;
        }
    };

    const handlePaymentSuccess = async (paymentIntentId: string) => {
        if (!quote || !selectedSlot || !selectedTier) return;

        try {
            // 1. Create Lead
            const leadRes = await fetch('/api/leads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customerName: quote.customerName,
                    phone: quote.phone,
                    email: quote.email,
                    jobDescription: `Diagnostic Visit - ${selectedTier.name}. Booked for ${format(selectedSlot.date, 'PPP')} ${selectedSlot.slot}.`,
                    source: 'diagnostic_visit',
                    transcriptJson: {
                        visitTier: selectedTier.id,
                        bookingDate: selectedSlot.date,
                        bookingSlot: selectedSlot.slot,
                        stripePaymentIntentId: paymentIntentId
                    }
                })
            });

            if (!leadRes.ok) throw new Error("Failed to create lead");
            const leadData = await leadRes.json();

            // 2. Track Booking on Quote
            const trackRes = await fetch(`/api/personalized-quotes/${quote.id}/track-visit-booking`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    leadId: leadData.leadId,
                    tierId: selectedTier.id,
                    amountPence: selectedTier.price * 100,
                    paymentIntentId,
                    slot: selectedSlot
                })
            }); // Add semicolon

            if (!trackRes.ok) throw new Error("Failed to track booking");

            toast({
                title: "Booking Confirmed!",
                description: `Payment successful. Expert is booked for ${format(selectedSlot.date, 'MMM d')}.`,
            });
            setShowPayment(false);
            // TODO: Redirect to success page or refresh
        } catch (e) {
            console.error(e);
            toast({ title: "Error", description: "Payment succeeded but booking failed to save. Please contact support.", variant: 'destructive' });
        }
    };

    return (
        <div className="min-h-screen bg-[#0f172a] font-sans pb-20">
            {/* --- HEADER --- */}
            <div className="sticky top-0 z-50 bg-[#0f172a]/90 backdrop-blur border-b border-slate-800">
                <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center font-bold text-black">H</div>
                        <span className="text-white font-bold tracking-tight">Handy Services</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                        <Lock className="w-3 h-3" /> Secure Booking
                    </div>
                </div>
            </div>

            <div className={`mx-auto px-4 py-8 ${quote.visitTierMode === 'tiers' ? 'max-w-7xl' : 'max-w-xl'}`}>
                {/* --- HERO SECTION --- */}
                <div className="mb-12 text-center max-w-2xl mx-auto">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold text-sm mb-6 animate-pulse">
                        <Check className="w-4 h-4" /> 100% Refundable against your final quote
                    </div>

                    <h1 className="text-3xl md:text-4xl font-bold text-white mb-4">
                        Site Visit & Diagnosis
                    </h1>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-slate-400 leading-relaxed text-lg"
                    >
                        <p className="mb-4">
                            To guarantee a fixed price we can legally stand by, our <span className="text-primary font-bold">Top Rated Handyman</span> first needs to assess the site.
                        </p>

                        <ExpertStickyNote
                            text={quote.assessmentReason || quote.jobDescription}
                            address={quote.address || quote.postcode}
                            mikePhotoUrl={mikeProfilePhoto}
                            className="mt-8"
                        />
                    </motion.div>
                </div>

                {/* --- CONTENT BASED ON MODE --- */}
                {quote.visitTierMode === 'tiers' ? (
                    /* --- 3-TIER GRID --- */
                    <div className="space-y-16">
                        <div className="flex flex-col gap-8 max-w-xl mx-auto">
                            {TIERS.map((tier) => (
                                <div key={tier.id} className={`group relative bg-slate-800/40 border rounded-2xl p-4 md:p-6 backdrop-blur flex flex-col transition-all duration-300 hover:bg-slate-800/60
                                    ${tier.id === 'priority' ? 'border-amber-500/50 shadow-2xl shadow-amber-900/10' : 'border-slate-700 hover:border-slate-600'}
                                    ${tier.id === 'emergency' ? 'hover:border-red-500/30' : ''}
                                `}>
                                    {/* 100% Refundable Badge on Every Card */}
                                    <div className="absolute top-0 right-0 left-0 flex justify-center -mt-3 z-20">
                                        <div className="transform scale-90 md:scale-100">
                                            <NeonBadge text="100% Refundable" color="green" />
                                        </div>
                                    </div>

                                    {tier.id === 'priority' && (
                                        <div className="absolute top-10 md:top-12 left-1/2 -translate-x-1/2 w-full text-center">
                                            <span className="px-2 py-0.5 md:px-3 md:py-1 bg-amber-500/20 rounded-full border border-amber-500/30 text-amber-400 text-[9px] md:text-[10px] font-bold tracking-wide uppercase">
                                                Most Popular
                                            </span>
                                        </div>
                                    )}

                                    <div className="mt-6 mb-4 md:mt-8 md:mb-6">
                                        <h3 className={`text-xl md:text-2xl font-bold mb-1 md:mb-2 ${tier.id === 'emergency' ? 'text-red-400' : tier.id === 'priority' ? 'text-amber-400' : 'text-white'}`}>
                                            {tier.name}
                                        </h3>
                                        <p className="text-xs md:text-sm text-slate-400 font-medium">{tier.desc}</p>
                                    </div>

                                    <div className="flex items-baseline gap-1 mb-2 md:mb-2">
                                        <span className="text-3xl md:text-4xl font-black text-white">£{tier.price}</span>
                                        <span className="text-slate-500 text-xs md:text-sm font-medium">Refundable Deposit</span>
                                    </div>

                                    {/* Trust Signal - Hidden on mobile to save space */}
                                    <div className="hidden md:flex text-[10px] text-slate-500 mb-6 items-center gap-1">
                                        <HelpCircle className="w-3 h-3" />
                                        <span>Why a deposit? Guaranteed expert, no cowboys.</span>
                                    </div>

                                    {/* Feature Differentiators - Horizontal Pills on Mobile, Vertical on Desktop if needed, but Pills look cleaner generally */}
                                    <div className="flex-1 mb-4 md:mb-8">
                                        <div className="flex flex-wrap gap-1.5 md:gap-2">
                                            {tier.features.map((feature, i) => (
                                                <div key={i} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] md:text-xs font-medium
                                                    ${tier.color === 'red'
                                                        ? 'bg-red-500/10 border-red-500/20 text-red-200'
                                                        : tier.color === 'amber'
                                                            ? 'bg-amber-500/10 border-amber-500/20 text-amber-200'
                                                            : 'bg-blue-500/10 border-blue-500/20 text-blue-200'}
                                                `}>
                                                    <Check className="w-3 h-3 md:w-3.5 md:h-3.5 shrink-0 opacity-70" />
                                                    <span>
                                                        {feature.replace('Senior Technician', 'Top Rated Handyman').replace('Head Technician', 'Head Handyman')}
                                                    </span>
                                                </div>
                                            ))}

                                            {/* Specific Value Prop Callout as a Pill */}
                                            {tier.id === 'standard' && (
                                                <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-slate-700 bg-slate-800/50 text-slate-400 text-[10px] md:text-xs">
                                                    <span>Quote focused</span>
                                                </div>
                                            )}
                                            {tier.id === 'priority' && (
                                                <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-amber-500/30 bg-amber-500/5 text-amber-400 text-[10px] md:text-xs">
                                                    <Wrench className="w-3 h-3" />
                                                    <span>+30mins labor</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Embedded Booking Calendar */}
                                    <div className="mb-4 pt-4 border-t border-slate-700/50">
                                        <BookingCalendar
                                            selectedSlot={selectedTier?.id === tier.id ? selectedSlot : undefined}
                                            onSelect={(slot) => {
                                                setSelectedTier(tier);
                                                setSelectedSlot(slot);
                                                if (slot) setShowPayment(true); // Auto-show payment
                                            }}
                                            minDaysInFuture={getWaitDays(tier.id)}
                                            className="transform scale-95 origin-top-left w-full"
                                        />
                                    </div>

                                    {selectedTier?.id === tier.id && selectedSlot && (
                                        <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
                                            <div className="bg-emerald-950/30 p-3 rounded-lg border border-emerald-500/20 flex gap-3">
                                                <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                                                <p className="text-[10px] text-emerald-200">
                                                    Booking <strong>{tier.name}</strong> for <strong>{format(selectedSlot.date, 'MMM d')}</strong>, {slotLabels[selectedSlot.slot]}
                                                </p>
                                            </div>

                                            {/* Direct Payment Form (No Proceed Button) */}
                                            <div className="animate-in fade-in slide-in-from-top-2 bg-slate-900/80 p-4 rounded-xl border border-slate-700/50 mt-4">
                                                {stripePromise ? (
                                                    <Elements stripe={stripePromise}>
                                                        <PaymentForm
                                                            amount={tier.price * 100}
                                                            customerName={quote.customerName}
                                                            customerEmail={quote.email || undefined}
                                                            quoteId={quote.id}
                                                            selectedTier={tier.id}
                                                            selectedTierPrice={tier.price * 100}
                                                            mode="visit"
                                                            slot={selectedSlot ? {
                                                                date: selectedSlot.date.toISOString(),
                                                                slot: selectedSlot.slot
                                                            } : undefined}
                                                            onSuccess={handlePaymentSuccess}
                                                        />
                                                    </Elements>
                                                ) : (
                                                    <div className="p-4 text-center text-red-400 bg-red-900/20 rounded-lg">
                                                        <AlertCircle className="w-6 h-6 mx-auto mb-2" />
                                                        <p className="font-bold">Payment system unavailable</p>
                                                        <p className="text-sm opacity-80 mt-1">Configuration missing. If you recently added API keys, please restart the dev server.</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* Text Reinforcement */}
                                    <div className="text-[10px] text-center text-emerald-400/80 mt-3 font-medium flex items-center justify-center gap-1.5">
                                        <Check className="w-3 h-3" /> 100% Refundable on Quote Acceptance
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* --- SOCIAL PROOF --- */}
                        <div className="text-center">
                            <p className="text-slate-500 text-sm font-medium flex items-center justify-center gap-2">
                                <span className="flex -space-x-2 overflow-hidden">
                                    <span className="inline-block h-6 w-6 rounded-full ring-2 ring-slate-900 bg-slate-700"></span>
                                    <span className="inline-block h-6 w-6 rounded-full ring-2 ring-slate-900 bg-slate-600"></span>
                                    <span className="inline-block h-6 w-6 rounded-full ring-2 ring-slate-900 bg-slate-500"></span>
                                </span>
                                Joined by 500+ locals who chose certainty over guesswork.
                            </p>
                        </div>

                        {/* --- HOW IT WORKS (Refundable Section) --- */}
                        <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-2xl p-8 max-w-4xl mx-auto backdrop-blur-sm">
                            <div className="flex flex-col md:flex-row items-center gap-6">
                                <div className="p-4 bg-emerald-500/10 rounded-full shrink-0">
                                    <ShieldCheck className="w-10 h-10 text-emerald-400" />
                                </div>
                                <div className="text-center md:text-left">
                                    <h3 className="text-xl font-bold text-white mb-2">How the 100% Refund Works</h3>
                                    <p className="text-slate-300 leading-relaxed">
                                        We prefer to fix problems, not just charge for visits.
                                        When you proceed with the quoted work (for jobs valued over £250),
                                        <span className="text-emerald-400 font-bold"> we deduct the full cost of this visit </span> from your final invoice.
                                        This ensures you only pay for the solution, not the assessment.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* --- FAQ SECTION --- */}
                        <div className="max-w-3xl mx-auto">
                            <h3 className="text-xl font-bold text-white mb-6 text-center flex items-center justify-center gap-2">
                                <HelpCircle className="w-5 h-5 text-slate-400" />
                                Commonly Asked Questions
                            </h3>
                            <Accordion type="single" collapsible className="w-full space-y-4">
                                <AccordionItem value="item-quote-fee" className="border border-slate-800 rounded-xl bg-slate-900/50 px-4">
                                    <AccordionTrigger className="text-slate-200 hover:text-white">Why do I have to pay for a quote?</AccordionTrigger>
                                    <AccordionContent className="text-slate-400">
                                        Free quotes often mean a hurried salesperson or an uninsured "cowboy" looking for a quick buck. Our refundable deposit guarantees a **Top Rated Handyman** spends dedicated time to diagnose your issue accurately. This ensures you get a fixed price, not a guess.
                                    </AccordionContent>
                                </AccordionItem>

                                <AccordionItem value="item-1" className="border border-slate-800 rounded-xl bg-slate-900/50 px-4">
                                    <AccordionTrigger className="text-slate-200 hover:text-white">Is the visit fee really refundable?</AccordionTrigger>
                                    <AccordionContent className="text-slate-400">
                                        Yes. If you proceed with the quoted work (over £250 value), the entire visit fee (Standard, Priority, or Emergency) is deducted from your final invoice. You effectively get the site visit for free.
                                    </AccordionContent>
                                </AccordionItem>
                                <AccordionItem value="item-2" className="border border-slate-800 rounded-xl bg-slate-900/50 px-4">
                                    <AccordionTrigger className="text-slate-200 hover:text-white">What if the job is a quick 10-minute fix?</AccordionTrigger>
                                    <AccordionContent className="text-slate-400">
                                        <p className="mb-2">It depends on your selected tier:</p>
                                        <ul className="list-disc pl-4 space-y-1">
                                            <li><span className="text-amber-400">Priority & Emergency:</span> We include 30-60 mins of minor labor. If it's a quick fix, we'll do it there and then for no extra cost.</li>
                                            <li><span className="text-blue-400">Standard:</span> This is primarily for diagnosis. If it's a quick fix, the technician can do it but standard hourly labor rates may apply on top of the visit fee.</li>
                                        </ul>
                                    </AccordionContent>
                                </AccordionItem>
                                <AccordionItem value="item-3" className="border border-slate-800 rounded-xl bg-slate-900/50 px-4">
                                    <AccordionTrigger className="text-slate-200 hover:text-white">Can I change my tier later?</AccordionTrigger>
                                    <AccordionContent className="text-slate-400">
                                        Once booked, the slot is reserved for that specific technician level. However, you can always upgrade to Priority by calling us if you need it sooner.
                                    </AccordionContent>
                                </AccordionItem>
                            </Accordion>
                        </div>
                    </div>
                ) : (
                    /* --- SINGLE CARD (Standard View) --- */
                    <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 md:p-8 backdrop-blur mb-8 shadow-xl max-w-xl mx-auto">
                        <div className="flex flex-col items-center text-center">
                            <div className="text-5xl font-black text-white mb-3">£{basePrice}</div>
                            <div className="text-emerald-400 text-sm font-bold mb-8 flex items-center gap-1.5 bg-emerald-950/40 px-3 py-1.5 rounded-full border border-emerald-500/30">
                                <Check className="w-3 h-3" strokeWidth={3} /> 100% Deductible from final quote
                            </div>

                            <ul className="space-y-4 mb-8 text-left w-full max-w-xs mx-auto">
                                <li className="flex items-start gap-3 text-sm text-slate-200">
                                    <ShieldCheck className="w-5 h-5 text-amber-500 shrink-0" />
                                    <span className="font-medium">Assessment by Top Rated Handyman</span>
                                </li>
                                <li className="flex items-start gap-3 text-sm text-slate-200">
                                    <Check className="w-5 h-5 text-emerald-500 shrink-0" />
                                    <span>Fixed Price Quote Guarantee</span>
                                </li>
                                <li className="flex items-start gap-3 text-sm text-slate-200">
                                    <Check className="w-5 h-5 text-emerald-500 shrink-0" />
                                    <span>Same/Next Day Availability</span>
                                </li>
                                <li className="flex items-start gap-3 text-sm text-slate-200">
                                    <Check className="w-5 h-5 text-emerald-500 shrink-0" />
                                    <span>Full Report & Recommendations</span>
                                </li>
                            </ul>

                            {/* Embedded Booking Calendar for Single Card */}
                            <div className="w-full mb-6">
                                <BookingCalendar
                                    selectedSlot={selectedSlot}
                                    onSelect={(slot) => {
                                        // For single card mode, we map to a default tier structure if needed, or just track slot
                                        setSelectedTier({
                                            id: 'standard',
                                            name: 'Diagnostic Visit',
                                            price: basePrice,
                                            color: 'blue',
                                            desc: 'Standard',
                                            features: []
                                        });
                                        setSelectedSlot(slot);
                                    }}
                                    minDaysInFuture={10} // Standard default
                                    className="w-full"
                                />
                            </div>

                            {selectedSlot && (
                                <div className="w-full space-y-3 animate-in fade-in slide-in-from-bottom-2">
                                    <div className="bg-emerald-950/30 p-3 rounded-lg border border-emerald-500/20 flex gap-3 text-left">
                                        <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                                        <p className="text-sm text-emerald-200">
                                            Booking for <strong>{format(selectedSlot.date, 'MMM d')}</strong>, {slotLabels[selectedSlot.slot]}
                                        </p>
                                    </div>

                                    {!showPayment ? (
                                        <Button
                                            onClick={handleSlotConfirm}
                                            disabled={isProcessing}
                                            className="w-full bg-[#E8B323] hover:bg-[#D1A120] text-black font-bold h-12 text-lg rounded-xl shadow-[0_0_20px_rgba(232,179,35,0.2)]"
                                        >
                                            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Proceed to Payment"}
                                        </Button>
                                    ) : (
                                        <div className="animate-in fade-in slide-in-from-top-2 bg-slate-800/80 p-4 rounded-xl border border-slate-700/50">
                                            {stripePromise ? (
                                                <Elements stripe={stripePromise}>
                                                    <PaymentForm
                                                        amount={basePrice * 100} // fallback
                                                        customerName={quote.customerName}
                                                        customerEmail={quote.email || undefined}
                                                        quoteId={quote.id}
                                                        selectedTier={selectedTier?.id || 'standard'}
                                                        selectedTierPrice={basePrice * 100}
                                                        mode="visit"
                                                        slot={selectedSlot ? {
                                                            date: selectedSlot.date.toISOString(),
                                                            slot: selectedSlot.slot
                                                        } : undefined}
                                                        onSuccess={handlePaymentSuccess}
                                                    />
                                                </Elements>
                                            ) : (
                                                <div className="p-4 text-center text-red-400 bg-red-900/20 rounded-lg">
                                                    <AlertCircle className="w-6 h-6 mx-auto mb-2" />
                                                    <p>Payment system unavailable. Please contact support.</p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {!showPayment && <p className="text-xs text-slate-500 mt-2">No payment taken until confirmed</p>}
                                </div>
                            )}
                            {!selectedSlot && <p className="text-xs text-slate-500 mt-3">No payment taken until date confirmed</p>}
                        </div>
                    </div>
                )}

                {/* --- CONTEXT INFO --- */}
                <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-800 flex items-start gap-4 mt-8 max-w-xl mx-auto">
                    <div className="p-2 bg-amber-500/10 rounded-lg">
                        <MapPin className="w-5 h-5 text-amber-500" />
                    </div>
                    <div>
                        <h4 className="text-sm font-bold text-white mb-1">Service Location</h4>
                        <p className="text-xs text-slate-400">{quote.postcode}</p>
                    </div>
                </div>
            </div>


        </div>
    );
}
