import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Lock, ClipboardList, MapPin, CalendarCheck, FileCheck } from "lucide-react";
import { format } from "date-fns";
import { QuotePreparingScreen } from "@/components/quote/QuotePreparingScreen";
import { IrresistibleOfferScreen } from "@/components/quote/IrresistibleOfferScreen";
import { VisitHero, VisitGuarantee, VisitProof } from "@/components/visit/VisitSections";
import { VisitBookingCard } from "@/components/visit/VisitBookingCard";
import type { VisitBookingSelection } from "@/components/VisitDatePicker";
import { useToast } from "@/hooks/use-toast";
import type { QuoteOffer } from "@shared/pricing-settings";
import { VISIT_SET_DATE_PREMIUM_PENCE, VISIT_FLEX_WINDOW_DAYS } from "@/lib/visit-pricing";
import handyLogo from "@/assets/handy-logo-transparent.png";

const VISIT_PREMIUM = Math.round(VISIT_SET_DATE_PREMIUM_PENCE / 100); // £, for copy

// Loading checklist for THIS product: paying an expert to visit on-site and
// produce a fixed written quote — not generating an instant price like the
// quote page. Each step tells that visit-to-quote story.
const VISIT_PREP_STEPS = [
    { icon: ClipboardList, label: "Reviewing what you need looked at" },
    { icon: MapPin, label: "Matching you with a local expert" },
    { icon: CalendarCheck, label: "Checking visit slots near you" },
    { icon: FileCheck, label: "Getting your on-site quote ready" },
];

/**
 * Diagnostic visit page — modelled on the CONTEXTUAL quote page's 3-phase flow:
 *
 *   1. preparing → QuotePreparingScreen (branded loader)
 *   2. offer     → IrresistibleOfferScreen (price-free at_home template):
 *                  accept → flexible lane, decline → exact date lane
 *   3. quote     → VisitHero + VisitBookingCard (two lanes) + guarantee + proof
 *
 * The booking lanes, slot soft-hold, visit payment intent and webhook→booking
 * promotion are reused from the existing visit wiring.
 */

// Price-free flex/exact lane chooser. The actual £ premium for the exact lane
// lives on the booking card / server — this screen only seeds the lane, so it
// never quotes the job-calibrated set-date premium.
const VISIT_OFFER: QuoteOffer = {
    id: "visit_flex_v1",
    type: "flex_date",
    enabled: true,
    template: "at_home",
    weight: 1,
    // Cold-link users land here second, so lead with WHAT the visit is and why
    // it's risk-free — then offer the timing choice. {base} renders the real fee.
    eyebrow: "your {base} visit — credited to the job",
    headline: "We come out, then quote it *properly*",
    subhead: "An expert visits and writes you a fixed quote — and your {base} comes off the job.",
    benefits: [
        { icon: "shield", text: "Insured, top-rated handyman" },
        { icon: "check", text: "Fixed written quote + photos" },
        { icon: "wallet", text: "{base} credited — risk-free" },
    ],
    acceptLabel: `Stay flexible — save £${VISIT_PREMIUM}`,
    declineLabel: `Pick exact slot (+£${VISIT_PREMIUM})`,
    finePrint: `Flexible = within {days} days · Exact = +£${VISIT_PREMIUM}. No payment yet.`,
    flexWithinDays: VISIT_FLEX_WINDOW_DAYS,
};

export default function DiagnosticVisitPage() {
    // Resolve the slug from the canonical /visit/:slug or the legacy alias.
    const [, visitParams] = useRoute("/visit/:slug");
    const [, legacyParams] = useRoute("/visit-link/:slug");
    const slug = visitParams?.slug ?? legacyParams?.slug;
    const [, setLocation] = useLocation();
    const { toast } = useToast();

    const [flowPhase, setFlowPhase] = useState<"preparing" | "offer" | "quote">("preparing");
    const [initialLane, setInitialLane] = useState<"flex" | "date">("flex");

    const { data: quote, isLoading } = useQuery({
        queryKey: ["/api/personalized-quotes", slug],
        queryFn: async () => {
            const res = await fetch(`/api/personalized-quotes/${slug}`);
            if (!res.ok) throw new Error("Link invalid");
            return res.json();
        },
        enabled: !!slug,
    });

    // ── Phase 1: Preparing ──────────────────────────────────────────────
    if (flowPhase === "preparing" && (isLoading || quote)) {
        return (
            <QuotePreparingScreen
                ready={!!quote}
                customerName={quote?.customerName}
                subcopy="Ben is sorting your visit…"
                steps={VISIT_PREP_STEPS}
                onComplete={() => setFlowPhase("offer")}
            />
        );
    }

    if (!quote) {
        return <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-10">Invalid link</div>;
    }

    // ── Phase 2: Offer (lane chooser) ───────────────────────────────────
    if (flowPhase === "offer") {
        return (
            <IrresistibleOfferScreen
                offer={VISIT_OFFER}
                basePricePence={quote.basePrice || 0}
                customerName={quote.customerName}
                onAccept={() => { setInitialLane("flex"); setFlowPhase("quote"); }}
                onDecline={() => { setInitialLane("date"); setFlowPhase("quote"); }}
            />
        );
    }

    // ── Phase 3: Booking page ───────────────────────────────────────────
    const handlePaymentSuccess = (_pi: string, lane: "flex" | "date", sel?: VisitBookingSelection) => {
        toast({
            title: "Visit booked!",
            description:
                lane === "date" && sel
                    ? `Payment received. We'll see you on ${format(sel.date, "EEE, MMM d")}.`
                    : "Payment received. We'll text you your visit slot shortly.",
        });
        setLocation(`/booking-confirmed/${quote.id ?? slug}`);
    };

    return (
        <div className="min-h-screen bg-slate-900 font-sans pb-20">
            {/* Sticky header */}
            <div className="sticky top-0 z-50 bg-slate-900/90 backdrop-blur border-b border-slate-800">
                <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <img src={handyLogo} alt="HandyServices" className="w-8 h-8 object-contain" />
                        <span className="text-white font-extrabold tracking-tight text-lg">
                            Handy<span className="text-[#7DB00E]">Services</span>
                        </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                        <Lock className="w-3 h-3" /> Secure Booking
                    </div>
                </div>
            </div>

            <VisitHero quote={quote} />

            {/* Booking card sits directly under the hero, as on the contextual page */}
            <div className="px-4 py-12 -mt-8 relative z-10">
                <VisitBookingCard quote={quote} initialLane={initialLane} onPaymentSuccess={handlePaymentSuccess} />
            </div>

            <VisitGuarantee quote={quote} />
            <VisitProof quote={quote} />
        </div>
    );
}
