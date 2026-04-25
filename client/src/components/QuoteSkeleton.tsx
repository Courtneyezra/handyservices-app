import handyServicesLogo from "../assets/handy-logo.webp";

/**
 * Skeleton loading screen for PersonalizedQuotePage (contextual quote layout)
 *
 * Mirrors the real page's section order, background, and rough block sizes
 * so the transition from skeleton → loaded quote is seamless (no layout jump,
 * no theme flash).
 *
 * Sections (top → bottom):
 *  1. Scarcity banner strip
 *  2. Value hero (headline + sub + contractor strip)
 *  3. Social proof (rating strip + testimonial card)
 *  4. Guarantee section
 *  5. Hassle comparison (two-column "Without us / With us")
 *  6. "Secure your slot" reveal header + Pay-in-3 banner
 *  7. Scope of works card
 *  8. Unified quote card (toggle, total, line items, extras, multi-job, total row)
 *  9. Date picker grid
 * 10. Trust badges + PDF link + payment methods
 */
export function QuoteSkeleton() {
    const Bar = ({ className = "" }: { className?: string }) => (
        <div className={`bg-slate-200 rounded ${className}`} />
    );

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900 animate-pulse">
            {/* 1. Scarcity Banner */}
            <div className="w-full bg-slate-100 border-b border-slate-200 py-2 px-4">
                <div className="max-w-4xl mx-auto flex items-center justify-center gap-3">
                    <Bar className="h-3 w-3 rounded-full" />
                    <Bar className="h-3 w-64" />
                </div>
            </div>

            {/* 2. Value Hero */}
            <section className="bg-white border-b border-slate-200 py-12 px-4">
                <div className="max-w-3xl mx-auto text-center space-y-5">
                    <Bar className="h-4 w-32 mx-auto" />
                    <Bar className="h-10 w-3/4 mx-auto" />
                    <Bar className="h-10 w-2/3 mx-auto" />
                    <Bar className="h-5 w-1/2 mx-auto mt-4" />

                    {/* Contractor / "Prepared by" strip */}
                    <div className="flex items-center justify-center gap-4 pt-6">
                        <div className="w-14 h-14 rounded-full bg-slate-200" />
                        <div className="space-y-2">
                            <Bar className="h-4 w-40" />
                            <Bar className="h-3 w-28" />
                        </div>
                    </div>
                </div>
            </section>

            {/* 3. Social Proof */}
            <section className="bg-slate-50 py-12 px-4">
                <div className="max-w-3xl mx-auto space-y-8">
                    {/* 4.9 / 500+ / £2M strip */}
                    <div className="grid grid-cols-3 gap-4">
                        {[0, 1, 2].map((i) => (
                            <div key={i} className="flex flex-col items-center gap-2">
                                <Bar className="h-7 w-16" />
                                <Bar className="h-3 w-20" />
                            </div>
                        ))}
                    </div>

                    {/* Testimonial card */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-3">
                        <Bar className="h-3 w-24" />
                        <Bar className="h-4 w-full" />
                        <Bar className="h-4 w-11/12" />
                        <Bar className="h-4 w-3/4" />
                        <div className="flex items-center gap-3 pt-2">
                            <div className="w-10 h-10 rounded-full bg-slate-200" />
                            <Bar className="h-3 w-32" />
                        </div>
                    </div>
                </div>
            </section>

            {/* 4. Guarantee */}
            <section className="bg-white border-y border-slate-200 py-12 px-4">
                <div className="max-w-2xl mx-auto text-center space-y-4">
                    <Bar className="h-3 w-32 mx-auto" />
                    <Bar className="h-8 w-2/3 mx-auto" />
                    <Bar className="h-4 w-full" />
                    <Bar className="h-4 w-5/6 mx-auto" />
                </div>
            </section>

            {/* 5. Hassle Comparison */}
            <section className="bg-white py-12 px-4">
                <div className="max-w-2xl mx-auto space-y-6">
                    <Bar className="h-7 w-1/2" />
                    <div className="grid grid-cols-2 gap-4">
                        {[0, 1].map((col) => (
                            <div
                                key={col}
                                className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-3"
                            >
                                <Bar className="h-4 w-24" />
                                {[0, 1, 2, 3].map((row) => (
                                    <Bar key={row} className="h-3 w-full" />
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* 6. Reveal header + Pay-in-3 banner */}
            <section className="bg-slate-50 pt-16 pb-4 px-4">
                <div className="max-w-2xl mx-auto text-center space-y-4">
                    {/* Pay in 3 banner */}
                    <div className="rounded-xl bg-slate-200 h-20 max-w-lg mx-auto mb-6" />
                    <Bar className="h-6 w-1/2 mx-auto" />
                    <Bar className="h-12 w-3/4 mx-auto" />
                    <Bar className="h-4 w-2/3 mx-auto" />
                    {/* Confidence card */}
                    <div className="max-w-lg mx-auto mt-6 bg-white border border-slate-200 p-5 rounded-xl space-y-2">
                        <Bar className="h-3 w-full" />
                        <Bar className="h-3 w-5/6 mx-auto" />
                    </div>
                </div>
            </section>

            {/* 7. Scope of Works card */}
            <section className="bg-slate-50 py-8 px-4">
                <div className="max-w-2xl mx-auto bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-slate-200" />
                        <div className="space-y-2">
                            <Bar className="h-4 w-32" />
                            <Bar className="h-3 w-24" />
                        </div>
                    </div>
                    <Bar className="h-4 w-full" />
                    <Bar className="h-4 w-11/12" />
                    <Bar className="h-4 w-4/5" />
                    <div className="space-y-2 pt-2">
                        {[0, 1, 2].map((i) => (
                            <div key={i} className="flex gap-2">
                                <Bar className="h-3 w-3 rounded-full mt-1.5" />
                                <Bar className="h-3 flex-1" />
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* 8. Unified Quote Card */}
            <section className="bg-slate-50 pt-4 pb-12 px-4">
                <div className="max-w-2xl mx-auto bg-white border border-slate-200 rounded-2xl shadow-lg overflow-hidden">
                    {/* Header: Save% + Total */}
                    <div className="bg-slate-900 px-6 py-6 text-center space-y-3">
                        <div className="inline-block bg-slate-700 rounded-full h-6 w-24" />
                        <div className="bg-slate-700 h-12 w-48 rounded mx-auto" />
                        <div className="bg-slate-700 h-3 w-32 rounded mx-auto" />
                    </div>

                    {/* Booking mode toggle */}
                    <div className="px-6 pt-6">
                        <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-lg">
                            <div className="h-10 bg-white rounded-md shadow-sm" />
                            <div className="h-10" />
                        </div>
                    </div>

                    {/* Deposit / balance line */}
                    <div className="px-6 py-4 flex justify-between items-center border-b border-slate-100">
                        <Bar className="h-4 w-40" />
                        <Bar className="h-4 w-20" />
                    </div>

                    {/* Line items */}
                    <div className="px-6 py-4 space-y-5">
                        <Bar className="h-3 w-32" />
                        {[0, 1, 2].map((i) => (
                            <div key={i} className="space-y-2 pb-4 border-b border-slate-100 last:border-0">
                                <div className="flex justify-between gap-4">
                                    <Bar className="h-4 w-2/3" />
                                    <Bar className="h-4 w-16" />
                                </div>
                                <Bar className="h-3 w-11/12" />
                                <Bar className="h-3 w-3/4" />
                                <div className="flex flex-wrap gap-2 pt-1">
                                    <div className="bg-slate-100 rounded-full h-5 w-20" />
                                    <div className="bg-slate-100 rounded-full h-5 w-24" />
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Optional Extras */}
                    <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 space-y-4">
                        <Bar className="h-3 w-36" />
                        {[0, 1].map((i) => (
                            <div
                                key={i}
                                className="flex items-start gap-3 bg-white border border-slate-200 rounded-lg p-3"
                            >
                                <div className="w-5 h-5 rounded border-2 border-slate-300 mt-0.5 flex-shrink-0" />
                                <div className="flex-1 space-y-2">
                                    <div className="flex justify-between gap-4">
                                        <Bar className="h-4 w-1/2" />
                                        <Bar className="h-4 w-14" />
                                    </div>
                                    <Bar className="h-3 w-full" />
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Multi-job discount + Total */}
                    <div className="px-6 py-4 border-t border-slate-200 space-y-3">
                        <div className="flex justify-between">
                            <Bar className="h-3 w-32" />
                            <Bar className="h-3 w-16" />
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                            <Bar className="h-5 w-20" />
                            <Bar className="h-7 w-28" />
                        </div>
                    </div>

                    {/* 9. Date Picker */}
                    <div className="px-6 py-6 border-t border-slate-200 space-y-4">
                        <Bar className="h-4 w-32" />
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                            {[0, 1, 2, 3, 4, 5].map((i) => (
                                <div
                                    key={i}
                                    className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2 text-center"
                                >
                                    <div className="bg-slate-200 h-3 w-10 mx-auto rounded" />
                                    <div className="bg-slate-200 h-6 w-8 mx-auto rounded" />
                                    <div className="bg-slate-200 h-3 w-10 mx-auto rounded" />
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* CTA button */}
                    <div className="px-6 pb-6">
                        <div className="h-14 bg-slate-300 rounded-xl" />
                    </div>
                </div>

                {/* PDF download link */}
                <div className="max-w-2xl mx-auto mt-3 flex items-center justify-center gap-2">
                    <Bar className="h-4 w-4" />
                    <Bar className="h-4 w-48" />
                </div>
            </section>

            {/* 10. Trust badges + payment methods */}
            <section className="bg-white border-t border-slate-200 py-8 px-4">
                <div className="max-w-3xl mx-auto space-y-6">
                    {/* Badge row: Fixed price · Photo report · Full cleanup · Guaranteed */}
                    <div className="flex flex-wrap justify-center gap-x-6 gap-y-3">
                        {[0, 1, 2, 3].map((i) => (
                            <div key={i} className="flex items-center gap-2">
                                <Bar className="h-4 w-4 rounded-full" />
                                <Bar className="h-3 w-20" />
                            </div>
                        ))}
                    </div>

                    {/* DBS / Insurance pills */}
                    <div className="flex flex-wrap justify-center gap-3">
                        {[0, 1, 2].map((i) => (
                            <div
                                key={i}
                                className="bg-slate-100 border border-slate-200 rounded-full h-7 w-24"
                            />
                        ))}
                    </div>

                    {/* Payment methods strip */}
                    <div className="flex flex-wrap justify-center gap-3 pt-2">
                        {[0, 1, 2, 3, 4].map((i) => (
                            <div key={i} className="bg-slate-100 rounded-md h-8 w-12" />
                        ))}
                    </div>
                </div>
            </section>

            {/*
             * Centered loading card.
             * Uses inset-0 + flex centering so it sits in the true viewport
             * middle (both height and width). The skeleton shows through the
             * subtle scrim — gives the page "shape" while the card delivers
             * conversion-boosting reassurance during the 1-2s wait:
             *   - "Preparing your fixed-price quote" (not generic "Loading")
             *   - £2M Insured / DBS Checked / 4.9★ trust badges (lifted from
             *     deeper in the page so even fast bouncers see them)
             *   - "No surprises. No hidden fees." — kills the top quoting
             *     objection at the moment attention is highest.
             */}
            <div
                className="fixed inset-0 flex items-center justify-center bg-white/40 backdrop-blur-[1px] z-50 pointer-events-none px-4"
                role="status"
                aria-live="polite"
            >
                <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl px-6 py-7 max-w-sm w-full text-center pointer-events-auto">
                    {/* Inline keyframes for the logo breathe + halo float */}
                    <style>{`
                        @keyframes logo-breathe {
                            0%, 100% { transform: scale(1) rotate(0deg); }
                            50%      { transform: scale(1.08) rotate(-2deg); }
                        }
                        @keyframes halo-pulse {
                            0%, 100% { transform: scale(1);   opacity: 0.45; }
                            50%      { transform: scale(1.25); opacity: 0;   }
                        }
                    `}</style>

                    {/* Animated brand logo with pulsing halo */}
                    <div className="relative inline-flex items-center justify-center mb-4 h-16 w-16 mx-auto">
                        <span
                            aria-hidden
                            className="absolute inset-0 rounded-full bg-[#e8b323]"
                            style={{
                                animation: "halo-pulse 1.8s ease-in-out infinite",
                            }}
                        />
                        <span
                            aria-hidden
                            className="absolute inset-1 rounded-full bg-[#e8b323]/40"
                            style={{
                                animation: "halo-pulse 1.8s ease-in-out infinite",
                                animationDelay: "0.4s",
                            }}
                        />
                        <img
                            src={handyServicesLogo}
                            alt="Handy Services"
                            className="relative h-14 w-14 object-contain drop-shadow-sm"
                            style={{
                                animation: "logo-breathe 2s ease-in-out infinite",
                                transformOrigin: "center",
                            }}
                        />
                    </div>

                    {/* Headline — specific, not generic */}
                    <h3 className="text-base font-semibold text-slate-900 mb-1">
                        Preparing your fixed-price quote
                    </h3>

                    {/* Conversion line — kill the #1 objection */}
                    <p className="text-sm text-slate-600 mb-5">
                        No surprises. No hidden fees.
                    </p>

                    {/* Trust badges row */}
                    <div className="flex items-center justify-center gap-x-3 gap-y-2 flex-wrap pt-4 border-t border-slate-100">
                        <span className="inline-flex items-center gap-1 text-xs text-slate-700 font-medium">
                            <span className="text-[#7DB00E]">✓</span> £2M Insured
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className="inline-flex items-center gap-1 text-xs text-slate-700 font-medium">
                            <span className="text-[#7DB00E]">✓</span> DBS Checked
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className="inline-flex items-center gap-1 text-xs text-slate-700 font-medium">
                            <span className="text-[#e8b323]">★</span> 4.9 Google
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
