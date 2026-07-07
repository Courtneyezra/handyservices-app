import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Loader2, CalendarClock, CalendarDays, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Elements } from "@stripe/react-stripe-js";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { PaymentForm } from "@/components/PaymentForm";
import { VisitDatePicker, type VisitBookingSelection } from "@/components/VisitDatePicker";
import { reserveSlot, formatDateStr } from "@/hooks/useAvailability";
import { VISIT_SET_DATE_PREMIUM_PENCE, VISIT_FLEX_WINDOW_DAYS as FLEX_WINDOW_DAYS } from "@/lib/visit-pricing";

type Lane = "flex" | "date";

interface VisitBookingCardProps {
    quote: any;
    /** Which lane to open on first render (seeded by the offer interstitial). */
    initialLane?: Lane;
    onPaymentSuccess: (paymentIntentId: string, lane: Lane, sel?: VisitBookingSelection) => void;
}

/**
 * Booking card for the diagnostic visit page — the visit analogue of
 * UnifiedQuoteCard's two booking lanes, without the job-quote baggage
 * (line items, deposits, Saturday surcharge, multi-day spans).
 *
 *  • Flexible  → flat base fee, we visit within N days (no fixed slot reserved;
 *                the webhook's no-lock path routes it into the dispatch pool).
 *  • Exact     → base fee + a small set-date premium for a locked morning/
 *                afternoon. Soft-holds the slot, then the webhook promotes it.
 */
export function VisitBookingCard({ quote, initialLane = "flex", onPaymentSuccess }: VisitBookingCardProps) {
    const baseFeePence = quote?.basePrice || 0;
    const baseFee = Math.round(baseFeePence / 100);
    const datePremium = Math.round(VISIT_SET_DATE_PREMIUM_PENCE / 100);

    const [lane, setLane] = useState<Lane>(initialLane);
    useEffect(() => setLane(initialLane), [initialLane]);

    // Exact-date lane state
    const [visitSel, setVisitSel] = useState<VisitBookingSelection | undefined>();
    const [lockId, setLockId] = useState<number | undefined>();
    const [isReserving, setIsReserving] = useState(false);
    const [reserveError, setReserveError] = useState<string | null>(null);

    const switchLane = (next: Lane) => {
        setLane(next);
        setReserveError(null);
        // Leaving the date lane clears the in-flight hold so we never pay for a
        // slot the customer navigated away from.
        if (next === "flex") {
            setVisitSel(undefined);
            setLockId(undefined);
        }
    };

    const handleVisitSelect = async (sel: VisitBookingSelection) => {
        setVisitSel(sel);
        setReserveError(null);
        setLockId(undefined);
        if (!quote?.id) return;
        setIsReserving(true);
        try {
            const reservation = await reserveSlot({
                quoteId: quote.id,
                // Noon-UTC anchor for the local calendar day — never slips a day in BST.
                scheduledDate: `${formatDateStr(sel.date)}T12:00:00.000Z`,
                scheduledSlot: sel.slot,
            });
            setLockId(reservation.lockId);
        } catch (e: any) {
            setReserveError(e?.message || "That slot was just taken — please pick another.");
        } finally {
            setIsReserving(false);
        }
    };

    const stripeReady = isStripeConfigured;

    return (
        <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 md:p-8 backdrop-blur shadow-xl w-full max-w-xl mx-auto">
            {/* Price — a value pair, styled to echo the hero's "Prepared by Ben" block:
                bold figure + a divider + an uppercase label over a plain-English line. */}
            <div className="flex items-center justify-center gap-4 mb-7">
                <div className="text-6xl font-black text-white leading-none tracking-tight">£{baseFee}</div>
                <div className="text-left border-l-2 border-emerald-500/40 pl-4 py-0.5">
                    <div className="flex items-center gap-1.5 text-emerald-400 text-xs uppercase tracking-wider font-bold mb-1">
                        <Check className="w-3.5 h-3.5" strokeWidth={3} /> 100% credited
                    </div>
                    <div className="text-slate-300 text-sm leading-snug max-w-[10rem]">
                        Comes straight off your final job
                    </div>
                </div>
            </div>

            {/* Lane toggle */}
            <div className="space-y-3 mb-5">
                <button
                    type="button"
                    onClick={() => switchLane("flex")}
                    className={cn(
                        "w-full flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-all",
                        lane === "flex"
                            ? "border-[#E8B323] bg-amber-500/10"
                            : "border-slate-700 hover:border-slate-600"
                    )}
                >
                    <CalendarClock className={cn("w-5 h-5 mt-0.5 shrink-0", lane === "flex" ? "text-[#E8B323]" : "text-slate-400")} />
                    <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                            <span className="font-bold text-white text-[15px]">I'm flexible</span>
                            <span className="text-emerald-400 font-extrabold text-base">£{baseFee}</span>
                        </div>
                        <p className="text-[13px] text-slate-400 leading-snug mt-1">
                            We pick the best slot, <span className="whitespace-nowrap text-slate-200 font-semibold">within {FLEX_WINDOW_DAYS} days</span>.
                        </p>
                    </div>
                </button>

                <button
                    type="button"
                    onClick={() => switchLane("date")}
                    className={cn(
                        "w-full flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-all",
                        lane === "date"
                            ? "border-[#7DB00E] bg-[#7DB00E]/10"
                            : "border-slate-700 hover:border-slate-600"
                    )}
                >
                    <CalendarDays className={cn("w-5 h-5 mt-0.5 shrink-0", lane === "date" ? "text-[#7DB00E]" : "text-slate-400")} />
                    <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                            <span className="font-bold text-white text-[15px]">Exact date &amp; time</span>
                            <span className="text-white font-extrabold text-base">£{baseFee + datePremium}</span>
                        </div>
                        <p className="text-[13px] text-slate-400 leading-snug mt-1">
                            You choose a <span className="whitespace-nowrap text-slate-200 font-semibold">morning or afternoon</span>.
                        </p>
                    </div>
                </button>
            </div>

            {/* Lane content */}
            <AnimatePresence mode="wait">
                {lane === "flex" ? (
                    <motion.div
                        key="flex"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        className="space-y-4"
                    >
                        {stripeReady ? (
                            <Elements stripe={getStripe()}>
                                <PaymentForm
                                    amount={baseFeePence}
                                    customerName={quote.customerName}
                                    customerEmail={quote.email || undefined}
                                    quoteId={quote.id}
                                    selectedTier="standard"
                                    selectedTierPrice={baseFeePence}
                                    mode="visit"
                                    pricingLane="flex"
                                    flexBookingWithinDays={FLEX_WINDOW_DAYS}
                                    onSuccess={(pi) => { onPaymentSuccess(pi, "flex"); return Promise.resolve(); }}
                                />
                            </Elements>
                        ) : (
                            <StripeMissing />
                        )}
                    </motion.div>
                ) : (
                    <motion.div
                        key="date"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        className="space-y-4"
                    >
                        <VisitDatePicker
                            selected={visitSel}
                            postcode={quote.postcode || undefined}
                            onSelect={handleVisitSelect}
                        />

                        {isReserving && (
                            <div className="flex items-center justify-center gap-2 text-sm text-slate-300 py-1">
                                <Loader2 className="w-4 h-4 animate-spin" /> Holding your slot…
                            </div>
                        )}
                        {reserveError && (
                            <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3 text-sm text-red-300">
                                {reserveError}
                            </div>
                        )}

                        {visitSel && lockId && !isReserving && (
                            <>
                                <div className="bg-emerald-950/30 p-3 rounded-lg border border-emerald-500/20 flex gap-3">
                                    <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                                    <p className="text-sm text-emerald-200">
                                        Holding <strong>{format(visitSel.date, "EEE, MMM d")}</strong>,{" "}
                                        {visitSel.slot === "am" ? "Morning (8am – 12pm)" : "Afternoon (12pm – 5pm)"}
                                    </p>
                                </div>
                                {stripeReady ? (
                                    <Elements stripe={getStripe()}>
                                        <PaymentForm
                                            amount={baseFeePence + VISIT_SET_DATE_PREMIUM_PENCE}
                                            customerName={quote.customerName}
                                            customerEmail={quote.email || undefined}
                                            quoteId={quote.id}
                                            selectedTier="standard"
                                            selectedTierPrice={baseFeePence + VISIT_SET_DATE_PREMIUM_PENCE}
                                            mode="visit"
                                            slot={{ date: `${formatDateStr(visitSel.date)}T12:00:00.000Z`, slot: visitSel.slot }}
                                            lockId={lockId}
                                            pricingLane="date_time"
                                            onSuccess={(pi) => { onPaymentSuccess(pi, "date", visitSel); return Promise.resolve(); }}
                                        />
                                    </Elements>
                                ) : (
                                    <StripeMissing />
                                )}
                            </>
                        )}
                        {!visitSel && (
                            <p className="text-xs text-slate-500 text-center">No payment taken until you choose a date</p>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function StripeMissing() {
    return (
        <div className="p-4 text-center text-red-400 bg-red-900/20 rounded-lg">
            <AlertCircle className="w-6 h-6 mx-auto mb-2" />
            <p className="font-bold">Payment system unavailable</p>
            <p className="text-sm opacity-80 mt-1">If you recently added API keys, restart the dev server.</p>
        </div>
    );
}
