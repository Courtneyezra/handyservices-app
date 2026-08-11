import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Lock, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { VisitHero, VisitGuarantee } from "@/components/visit/VisitSections";
import { VisitBookingCard } from "@/components/visit/VisitBookingCard";
import type { VisitBookingSelection } from "@/components/VisitDatePicker";
import { useToast } from "@/hooks/use-toast";
import handyLogo from "@/assets/handy-logo-transparent.png";

/**
 * Diagnostic visit page.
 *
 * Ben's WhatsApp message already tells the customer their job can't be quoted
 * remotely and they need a visit — so this link doesn't re-perform that pitch.
 * No preparing animation, no offer interstitial: it loads straight into a
 * compact header + the booking card (fee, flexible/exact lanes, wallet + card
 * pay). The booking lanes, slot soft-hold, visit payment intent and
 * webhook→booking promotion are reused from the existing visit wiring.
 */
export default function DiagnosticVisitPage() {
    // Resolve the slug from the canonical /visit/:slug or the legacy alias.
    const [, visitParams] = useRoute("/visit/:slug");
    const [, legacyParams] = useRoute("/visit-link/:slug");
    const slug = visitParams?.slug ?? legacyParams?.slug;
    const [, setLocation] = useLocation();
    const { toast } = useToast();

    const { data: quote, isLoading } = useQuery({
        queryKey: ["/api/personalized-quotes", slug],
        queryFn: async () => {
            const res = await fetch(`/api/personalized-quotes/${slug}`);
            if (!res.ok) throw new Error("Link invalid");
            return res.json();
        },
        enabled: !!slug,
    });

    if (isLoading) {
        return (
            <div className="min-h-screen bg-slate-900 text-slate-400 flex items-center justify-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" /> Loading your visit…
            </div>
        );
    }

    if (!quote) {
        return <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-10">Invalid link</div>;
    }

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

            {/* Booking card, front and centre */}
            <div className="px-4 pt-4 pb-10 relative z-10">
                <VisitBookingCard quote={quote} initialLane="flex" onPaymentSuccess={handlePaymentSuccess} />
            </div>

            {/* One trust band for reassurance — kept lean (no video/testimonial reel). */}
            <VisitGuarantee quote={quote} />
        </div>
    );
}
