import { useLocation } from "wouter";
import { Lock, ClipboardCheck, Ruler, ShieldCheck, FileCheck } from "lucide-react";
import { format } from "date-fns";
import { VisitBookingCard } from "@/components/visit/VisitBookingCard";
import type { VisitBookingSelection } from "@/components/VisitDatePicker";
import { useToast } from "@/hooks/use-toast";
import handyLogo from "@/assets/handy-logo-transparent.png";

/**
 * Survey-required contextual quote.
 *
 * Some jobs can't be safely committed sight-unseen — the scope only firms up
 * once someone stands in the room. For those, the admin flags the quote
 * `surveyRequired` with a `surveyFeePence`, and the customer sees THIS instead
 * of the normal job booking card: no "I'm flexible", no date-pick for the job —
 * they book & pay a site survey first. The job is quoted properly on the day.
 *
 * Reuses the working visit wiring: VisitBookingCard's two lanes, slot soft-hold,
 * the visit payment intent (which charges the stored survey_fee_pence
 * authoritatively) and the webhook → booking promotion. The job money paths are
 * refused server-side for these quotes, so this is the only way through.
 */
export function SurveyRequiredQuote({ quote }: { quote: any }) {
    const [, setLocation] = useLocation();
    const { toast } = useToast();

    const feePence: number = quote?.surveyFeePence || 0;
    const feePounds = Math.round(feePence / 100);

    const handlePaymentSuccess = (_pi: string, lane: "flex" | "date", sel?: VisitBookingSelection) => {
        toast({
            title: "Survey booked!",
            description:
                lane === "date" && sel
                    ? `Payment received. We'll see you on ${format(sel.date, "EEE, MMM d")}.`
                    : "Payment received. We'll text you your survey slot shortly.",
        });
        setLocation(`/booking-confirmed/${quote.id}`);
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

            {/* Hero — why a survey first */}
            <div className="px-4 pt-10 pb-16 text-center max-w-2xl mx-auto">
                <div className="inline-flex items-center gap-2 rounded-full bg-[#7DB00E]/15 border border-[#7DB00E]/30 px-3 py-1 text-[#9BD534] text-xs font-bold uppercase tracking-wider mb-5">
                    <Ruler className="w-3.5 h-3.5" /> Site survey first
                </div>
                <h1 className="text-3xl md:text-4xl font-black text-white leading-tight tracking-tight">
                    {quote.customerName ? `${quote.customerName}, this` : "This"} one we quote{" "}
                    <span className="text-[#7DB00E]">on-site</span>.
                </h1>
                <p className="text-slate-300 text-base md:text-lg mt-4 leading-relaxed">
                    {quote.jobTopLine || quote.contextualHeadline
                        ? <>To price <span className="text-white font-semibold">{quote.jobTopLine || quote.contextualHeadline}</span> properly, an expert needs to see it. </>
                        : "To price this properly, an expert needs to see it. "}
                    We come out, measure up and hand you a <span className="text-white font-semibold">fixed written quote</span> — no surprises later.
                </p>

                {/* Trust row */}
                <div className="mt-7 grid grid-cols-3 gap-3 text-left max-w-md mx-auto">
                    {[
                        { icon: ClipboardCheck, label: "Fixed written quote" },
                        { icon: ShieldCheck, label: "Insured, top-rated" },
                        { icon: FileCheck, label: `£${feePounds} off the job` },
                    ].map(({ icon: Icon, label }) => (
                        <div key={label} className="flex flex-col items-center gap-2 rounded-xl bg-slate-800/40 border border-slate-700 px-2 py-3 text-center">
                            <Icon className="w-5 h-5 text-[#9BD534]" />
                            <span className="text-[11px] text-slate-300 leading-tight font-medium">{label}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Booking card — the ONLY way to proceed on a survey-gated quote */}
            <div className="px-4 -mt-6 relative z-10">
                <VisitBookingCard
                    quote={quote}
                    feePenceOverride={feePence}
                    creditNote="Credited to your final job quote"
                    onPaymentSuccess={handlePaymentSuccess}
                />
            </div>

            <p className="text-center text-xs text-slate-500 mt-8 px-6 max-w-md mx-auto">
                Your survey fee comes straight off the job once you go ahead. We'll confirm the full price in writing after the visit.
            </p>
        </div>
    );
}
