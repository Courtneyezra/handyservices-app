import { useEffect } from "react";
import { Link } from "wouter";
import {
    CalendarClock,
    ShieldCheck,
    RefreshCw,
    Package,
    CheckCircle2,
    Clock,
    HelpCircle,
    Banknote,
} from "lucide-react";
import { LandingHeader } from "@/components/LandingHeader";
import { HandLogo } from "@/components/LandingShared";

// Fair-cancellation model (locked 10 Jul 2026):
//  • Cancel 48+ hours before the booked day → full deposit refund (minus any
//    non-returnable materials already bought for the job).
//  • Cancel within 48 hours → flat £75 cancellation fee (covers the lost,
//    un-fillable contractor day + unwinding orders) PLUS any non-returnable
//    materials, deducted from the deposit. Refund the rest.
//  • The total deduction is capped at the deposit — we never chase a shortfall.
//  • Reschedule any time = free. If we cancel = full refund + priority rebook.
const NOTICE_HOURS = 48;
const LATE_FEE = 75; // flat, in pounds

/** Late-cancellation deduction: the flat fee, but never more than the deposit
 *  (we cap at the deposit and never chase the difference). */
function deductionFor(depositPounds: number): number {
    return Math.min(LATE_FEE, depositPounds);
}

const WORKED_EXAMPLES = [
    { job: 150, deposit: 45 },
    { job: 310, deposit: 93 },
    { job: 1000, deposit: 300 },
    { job: 2000, deposit: 600 },
].map(({ job, deposit }) => {
    const fee = deductionFor(deposit);
    return { job, deposit, fee, refund: deposit - fee };
});

const money = (n: number) => `£${n.toFixed(2).replace(/\.00$/, "")}`;

export default function CancellationPolicy() {
    useEffect(() => {
        const prev = document.title;
        document.title = "Cancellation & Deposit Policy — Handy Services";
        return () => {
            document.title = prev;
        };
    }, []);

    return (
        <div className="min-h-screen bg-slate-900 text-white">
            <LandingHeader />

            {/* ── HERO ─────────────────────────────────────────── */}
            <section className="bg-slate-800 px-4 lg:px-8 py-16 lg:py-20">
                <div className="max-w-3xl mx-auto text-center">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/15 text-emerald-300 text-sm font-semibold mb-6">
                        <ShieldCheck className="w-4 h-4" />
                        Fair &amp; transparent
                    </div>
                    <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
                        Cancellation &amp; Deposit Policy
                    </h1>
                    <p className="mt-5 text-lg text-white/70 leading-relaxed">
                        Your deposit reserves a contractor&rsquo;s day. Give us notice and
                        it costs you nothing. Cancel last-minute and it covers the day we
                        can no longer fill — never a penny more.
                    </p>
                    <p className="mt-3 text-sm text-white/40">Last updated 10 July 2026</p>
                </div>
            </section>

            {/* ── THE THREE RULES ──────────────────────────────── */}
            <section className="px-4 lg:px-8 py-14 lg:py-20">
                <div className="max-w-5xl mx-auto grid gap-5 md:grid-cols-3">
                    {/* Early cancel */}
                    <div className="bg-emerald-500 rounded-3xl p-7 flex flex-col">
                        <CalendarClock className="w-8 h-8 text-slate-900" />
                        <h2 className="mt-4 text-xl font-bold text-slate-900">
                            Cancel {NOTICE_HOURS}+ hours ahead
                        </h2>
                        <p className="mt-2 text-slate-900/80 font-medium leading-relaxed">
                            Give us at least {NOTICE_HOURS} hours&rsquo; notice before your
                            booked day and we can re-fill the slot.
                        </p>
                        <div className="mt-auto pt-6">
                            <span className="inline-block bg-slate-900 text-white font-bold px-4 py-2 rounded-full">
                                Full deposit back
                            </span>
                        </div>
                    </div>

                    {/* Late cancel */}
                    <div className="bg-slate-800 rounded-3xl p-7 flex flex-col border border-white/10">
                        <Clock className="w-8 h-8 text-amber-400" />
                        <h2 className="mt-4 text-xl font-bold">
                            Cancel within {NOTICE_HOURS} hours
                        </h2>
                        <p className="mt-2 text-white/70 leading-relaxed">
                            This close to the day we can&rsquo;t re-fill the slot, so a
                            contractor loses a planned day. A flat fee applies.
                        </p>
                        <div className="mt-auto pt-6">
                            <span className="inline-block bg-amber-400 text-slate-900 font-bold px-4 py-2 rounded-full">
                                {money(LATE_FEE)} fee from your deposit
                            </span>
                        </div>
                    </div>

                    {/* We cancel */}
                    <div className="bg-slate-800 rounded-3xl p-7 flex flex-col border border-white/10">
                        <RefreshCw className="w-8 h-8 text-emerald-400" />
                        <h2 className="mt-4 text-xl font-bold">If we cancel</h2>
                        <p className="mt-2 text-white/70 leading-relaxed">
                            If we ever need to cancel or can&rsquo;t attend, you&rsquo;re
                            never out of pocket — guaranteed.
                        </p>
                        <div className="mt-auto pt-6">
                            <span className="inline-block bg-emerald-400 text-slate-900 font-bold px-4 py-2 rounded-full">
                                Full refund + priority rebook
                            </span>
                        </div>
                    </div>
                </div>

                {/* Reschedule note */}
                <div className="max-w-5xl mx-auto mt-5">
                    <div className="bg-slate-800/60 border border-white/10 rounded-2xl p-5 flex items-center gap-3 justify-center text-center">
                        <RefreshCw className="w-5 h-5 text-emerald-400 shrink-0" />
                        <p className="text-white/80">
                            <strong className="text-white">Need a different day?</strong>{" "}
                            Rescheduling is always free — we just move your deposit to the new
                            date. No fee, whenever you ask.
                        </p>
                    </div>
                </div>
            </section>

            {/* ── THE FLAT FEE, EXPLAINED ──────────────────────── */}
            <section className="bg-slate-800 px-4 lg:px-8 py-14 lg:py-20">
                <div className="max-w-3xl mx-auto">
                    <div className="flex items-center gap-3">
                        <Banknote className="w-7 h-7 text-amber-400" />
                        <h2 className="text-2xl md:text-3xl font-bold">
                            The {money(LATE_FEE)} late-cancellation fee
                        </h2>
                    </div>
                    <p className="mt-4 text-white/70 leading-relaxed">
                        Inside {NOTICE_HOURS} hours we can no longer give that slot to another
                        customer, so a contractor is left with a hole in their day. The{" "}
                        <strong className="text-white">flat {money(LATE_FEE)}</strong> covers
                        that lost day and the admin of unwinding the booking. It&rsquo;s the
                        same whether your job was £150 or £2,000 — because a lost day costs the
                        same either way.
                    </p>
                    <p className="mt-3 text-white/70 leading-relaxed">
                        The fee comes out of your deposit and we refund the rest. It&rsquo;s{" "}
                        <strong className="text-white">
                            capped at your deposit
                        </strong>{" "}
                        — if your deposit is smaller than {money(LATE_FEE)}, we simply keep the
                        deposit and never ask you for more.
                    </p>

                    {/* Worked examples */}
                    <div className="mt-8 overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="text-white/50 text-sm">
                                    <th className="py-3 pr-4 font-semibold">Job total</th>
                                    <th className="py-3 px-4 font-semibold">Deposit (30%)</th>
                                    <th className="py-3 px-4 font-semibold">Fee kept</th>
                                    <th className="py-3 pl-4 font-semibold text-right">
                                        You get back
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {WORKED_EXAMPLES.map((ex) => (
                                    <tr key={ex.job} className="border-t border-white/10">
                                        <td className="py-4 pr-4 font-semibold">{money(ex.job)}</td>
                                        <td className="py-4 px-4 text-white/70">{money(ex.deposit)}</td>
                                        <td className="py-4 px-4 text-amber-300">−{money(ex.fee)}</td>
                                        <td className="py-4 pl-4 text-right font-bold text-emerald-400">
                                            {money(ex.refund)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p className="mt-4 text-white/40 text-sm">
                        Examples only, before any materials (below). Your deposit is 30% of the
                        quoted total, so exact figures depend on the job.
                    </p>
                </div>
            </section>

            {/* ── MATERIALS ────────────────────────────────────── */}
            <section className="px-4 lg:px-8 py-14 lg:py-20">
                <div className="max-w-3xl mx-auto">
                    <div className="flex items-center gap-3">
                        <Package className="w-7 h-7 text-emerald-400" />
                        <h2 className="text-2xl md:text-3xl font-bold">
                            If we&rsquo;ve already ordered materials
                        </h2>
                    </div>
                    <p className="mt-4 text-white/70 leading-relaxed">
                        Once your booking is confirmed we may order materials for your job. If
                        you cancel, here&rsquo;s exactly what happens:
                    </p>

                    <div className="mt-6 space-y-4">
                        <div className="bg-slate-800 rounded-2xl p-6 border border-white/10 flex gap-4">
                            <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" />
                            <div>
                                <h3 className="font-bold">We cancel or return everything we can</h3>
                                <p className="mt-1 text-white/70 leading-relaxed">
                                    Stock items and cancellable trade orders go straight back —
                                    you&rsquo;re not charged a penny for those.
                                </p>
                            </div>
                        </div>
                        <div className="bg-slate-800 rounded-2xl p-6 border border-white/10 flex gap-4">
                            <Banknote className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
                            <div>
                                <h3 className="font-bold">
                                    Only non-returnable items are charged — at cost
                                </h3>
                                <p className="mt-1 text-white/70 leading-relaxed">
                                    Special-order parts, cut-to-size timber, colour-mixed paint or
                                    anything already dispatched can&rsquo;t go back. We deduct just
                                    those, at what we paid, and we&rsquo;ll show you the receipts.
                                </p>
                            </div>
                        </div>
                        <div className="bg-slate-800 rounded-2xl p-6 border border-white/10 flex gap-4">
                            <Package className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" />
                            <div>
                                <h3 className="font-bold">What you pay for is yours to keep</h3>
                                <p className="mt-1 text-white/70 leading-relaxed">
                                    If you&rsquo;ve covered the cost of a non-returnable item,
                                    it&rsquo;s yours — we&rsquo;ll drop it off or you&rsquo;re
                                    welcome to collect it.
                                </p>
                            </div>
                        </div>
                    </div>

                    <p className="mt-6 text-white/60 leading-relaxed text-sm">
                        As with the fee, materials are only ever deducted from your deposit — the
                        deposit is the most you can lose, and we never invoice a shortfall.
                    </p>
                </div>
            </section>

            {/* ── FAQ ──────────────────────────────────────────── */}
            <section className="bg-slate-800 px-4 lg:px-8 py-14 lg:py-20">
                <div className="max-w-3xl mx-auto">
                    <div className="flex items-center gap-3 mb-8">
                        <HelpCircle className="w-7 h-7 text-emerald-400" />
                        <h2 className="text-2xl md:text-3xl font-bold">Common questions</h2>
                    </div>

                    <div className="space-y-6">
                        <Faq
                            q="How do I cancel or reschedule?"
                            a="Just message us on WhatsApp or call — the sooner the better. Rescheduling to a new date is always free; we simply move your deposit to the new booking."
                        />
                        <Faq
                            q={`What counts as ${NOTICE_HOURS} hours' notice?`}
                            a={`We measure from the start of your booked day. Cancel more than ${NOTICE_HOURS} hours before it and your deposit comes back in full. Inside ${NOTICE_HOURS} hours the flat ${money(LATE_FEE)} fee applies, because the slot can no longer be filled.`}
                        />
                        <Faq
                            q="Why a flat fee instead of a percentage?"
                            a={`A lost day costs us the same whether your job was small or large, so a percentage would be unfair both ways. A flat ${money(LATE_FEE)} is honest and predictable — and on smaller jobs it's capped at your deposit, so you never owe more than you paid.`}
                        />
                        <Faq
                            q="What if you've already bought materials for my job?"
                            a="We return or cancel everything we can, so you're not charged for it. Only genuinely non-returnable items (special-order parts, cut timber, mixed paint) are deducted, at cost, with receipts — and those items are then yours to keep."
                        />
                        <Faq
                            q="Could I ever owe more than my deposit?"
                            a="No. Your deposit is the absolute most you can lose. If a fee or non-returnable materials come to more than the deposit, we absorb the difference — we'll never send you a bill after you've cancelled."
                        />
                        <Faq
                            q="What if you can't do the work?"
                            a="If we cancel or can't attend for any reason, you get a full refund and priority rebooking at a time that suits you. No fee, no exceptions."
                        />
                        <Faq
                            q="How long do refunds take?"
                            a="Refunds go back to your original payment method and usually clear within 5–10 working days, depending on your bank."
                        />
                    </div>
                </div>
            </section>

            {/* ── REASSURANCE STRIP ────────────────────────────── */}
            <section className="bg-emerald-500 px-4 lg:px-8 py-10">
                <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-center gap-3 text-center">
                    <CheckCircle2 className="w-6 h-6 text-slate-900 shrink-0" />
                    <p className="text-slate-900 font-bold text-lg">
                        Reschedule any time for free. Cancel {NOTICE_HOURS}+ hours ahead for a
                        full refund. Your deposit is the most you can ever lose.
                    </p>
                </div>
            </section>

            {/* ── FOOTER ───────────────────────────────────────── */}
            <footer className="bg-slate-950 px-4 lg:px-8 py-10">
                <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
                    <Link href="/landing">
                        <div className="flex items-center gap-3 cursor-pointer">
                            <HandLogo className="w-8 h-8" />
                            <span className="text-white/60 text-sm">Handy Services Ltd</span>
                        </div>
                    </Link>
                    <p className="text-white/40 text-xs">
                        Nottingham &amp; Derby • £2M insured • DBS checked
                    </p>
                </div>
            </footer>
        </div>
    );
}

function Faq({ q, a }: { q: string; a: string }) {
    return (
        <div className="bg-slate-900 rounded-2xl p-6 border border-white/10">
            <h3 className="font-bold text-lg">{q}</h3>
            <p className="mt-2 text-white/70 leading-relaxed">{a}</p>
        </div>
    );
}
