/**
 * Day-Pack Preview — frontend-only test page.
 *
 * URL: /dispatch-preview
 *
 * Shows what a Builder's day-pack offer looks like, assembled from the 4 quotes
 * given to a contractor today. Pure UI mock — no backend calls, no real dispatch
 * fires on accept/decline. Designed to be shareable as a single link to validate
 * the day-pack UX with a real contractor.
 *
 * Seed data shape mirrors the live `PublicDispatch` interface in DispatchLinkPage.tsx
 * but extended for multi-job day-packs (job sequence, travel between, day-rate target).
 *
 * To wire up real data later: replace the static PACK constant with a useQuery
 * call against /api/day-packs/:packRef (or similar) — page UI stays identical.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Check, X, AlertCircle, MapPin, Hammer, Package, ChevronDown,
    Calendar, Star, Trophy, Truck, ShieldCheck, Clock,
} from "lucide-react";

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

interface JobInPack {
    num: number;
    slug: string;
    title: string;
    postcode: string;
    startTime: string;
    endTime: string;
    durationHours: number;
    contractorPayPence: number;
    tier: 'specialist' | 'skilled' | 'general' | 'outdoor';
    category?: string;
    description?: string;
    materials?: string[];
    travelMinutesToNext?: number;
}

interface DayPack {
    packRef: string;
    date: string;
    contractorName: string;
    area: string;
    jobs: JobInPack[];
    totalContractorPayPence: number;
    totalCustomerPayPence: number;
    totalWorkHours: number;
    totalTravelMinutes: number;
    dayRateTargetPence: number;
    topUpPence: number;
}

// ───────────────────────────────────────────────────────────────────────────
// Seed data — the 4 quotes given to the contractor today
//
// NOTE: live quote URLs (handyservices.app/quote-link/...) are gated against
// non-browser fetches, so these values are plausibly seeded based on the
// slugs + the description we have for 9fitx3o1. To replace with real numbers,
// edit this constant — page renders straight from it.
// ───────────────────────────────────────────────────────────────────────────

const PACK: DayPack = {
    packRef: "DP-MAR-FRI",
    date: "2026-05-08",
    contractorName: "Mark",
    area: "Nottingham · NG7 area",
    dayRateTargetPence: 22000,
    topUpPence: 0,
    totalContractorPayPence: 31000,
    totalCustomerPayPence: 62000,
    totalWorkHours: 6.0,
    totalTravelMinutes: 24,
    jobs: [
        {
            num: 1,
            slug: "zw2eqimg",
            title: "Replace kitchen tap",
            postcode: "NG7 2RD",
            startTime: "09:00",
            endTime: "10:00",
            durationHours: 1.0,
            contractorPayPence: 5500,
            tier: "skilled",
            category: "plumbing",
            description: "Single mixer tap replacement, customer-supplied tap. Standard isolation valves in place.",
            materials: ["Sealant", "Plumbing tape", "Flexi connectors"],
            travelMinutesToNext: 7,
        },
        {
            num: 2,
            slug: "py8jrvxz",
            title: "Hang 2 internal doors",
            postcode: "NG7 5BX",
            startTime: "10:15",
            endTime: "12:45",
            durationHours: 2.5,
            contractorPayPence: 11000,
            tier: "skilled",
            category: "carpentry",
            description: "Two pre-hung internal doors, frames already in place. Includes hinge fitting and handle install.",
            materials: ["Hinges", "Door handles", "Latches"],
            travelMinutesToNext: 5,
        },
        {
            num: 3,
            slug: "nkno7s07",
            title: "Tile bathroom splash-back",
            postcode: "NG7 9PA",
            startTime: "13:30",
            endTime: "15:30",
            durationHours: 2.0,
            contractorPayPence: 10000,
            tier: "skilled",
            category: "tiling",
            description: "Splash-back tile install over basin. Approx 1.5 sq m. Tiles supplied by customer.",
            materials: ["Adhesive", "Grout", "Spacers"],
            travelMinutesToNext: 12,
        },
        {
            num: 4,
            slug: "9fitx3o1",
            title: "Replace handle, lock and latch on door",
            postcode: "NG7 1AB",
            startTime: "15:50",
            endTime: "16:20",
            durationHours: 0.5,
            contractorPayPence: 4500,
            tier: "general",
            category: "joinery",
            description: "Replace handle, lock and latch on existing door — single line item.",
            materials: ["Lock set", "Strike plate"],
            travelMinutesToNext: 0,
        },
    ],
};

// ───────────────────────────────────────────────────────────────────────────
// Helpers (mirrors DispatchLinkPage conventions)
// ───────────────────────────────────────────────────────────────────────────

function fmt(p: number) { return `£${Math.round(p / 100)}`; }

function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-GB", {
        weekday: "long", day: "numeric", month: "long",
    });
}

function tierDot(tier: string) {
    switch (tier) {
        case "specialist": return "bg-indigo-500";
        case "skilled": return "bg-teal-500";
        case "outdoor": return "bg-amber-500";
        default: return "bg-slate-400";
    }
}

function tierLabel(t: string) { return t.charAt(0).toUpperCase() + t.slice(1); }

const fadeInUp = {
    initial: { opacity: 0, y: 8 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
    transition: { duration: 0.35 },
};

// ───────────────────────────────────────────────────────────────────────────
// Page
// ───────────────────────────────────────────────────────────────────────────

export default function DispatchPreviewPage() {
    const [expandedJob, setExpandedJob] = useState<number | null>(null);
    const [decided, setDecided] = useState<'accepted' | 'declined' | null>(null);

    const targetMet = PACK.totalContractorPayPence >= PACK.dayRateTargetPence;
    const overByPence = PACK.totalContractorPayPence - PACK.dayRateTargetPence;
    const totalCustomerCost = PACK.totalCustomerPayPence;

    return (
        <div className="min-h-screen bg-[#F7F8FA] font-sans text-[#0E1116] selection:bg-[#3B7A3F]/20 pb-32">

            {/* Header */}
            <header className="sticky top-0 z-30 bg-[#F7F8FA]/85 backdrop-blur-md border-b border-[#E6E8EC]">
                <div className="max-w-[680px] mx-auto px-4 py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <img src="/logo.png" alt="Handy" className="w-8 h-8 object-contain shrink-0" />
                        <span className="font-semibold text-[15px]">Handy</span>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.08em] font-bold bg-[#1B2A4A]/8 text-[#1B2A4A] border border-[#1B2A4A]/15 px-2.5 py-1 rounded-full">
                        <Calendar className="h-3 w-3" />
                        Day-Pack · #{PACK.packRef}
                    </span>
                </div>
            </header>

            <main className="max-w-[680px] mx-auto px-4 py-6 space-y-6">

                {/* ───── Hero — day at a glance ───── */}
                <motion.div {...fadeInUp}>
                    <div className="rounded-2xl p-6 sm:p-7 shadow-[0_12px_40px_rgba(27,42,74,0.18)] relative overflow-hidden bg-gradient-to-br from-[#1B2A4A] via-[#152340] to-[#0E1933]">
                        <div className="absolute -top-24 -right-24 w-80 h-80 bg-[#F5A623]/15 rounded-full blur-3xl pointer-events-none" />
                        <div className="absolute -bottom-32 -left-20 w-72 h-72 bg-[#7DB00E]/10 rounded-full blur-3xl pointer-events-none" />

                        {/* Day-rate target badge — top right */}
                        <div className="absolute top-3 right-3 z-10">
                            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full shadow-lg border ${
                                targetMet
                                    ? "bg-[#7DB00E] text-[#0E1933] border-[#7DB00E]/40"
                                    : "bg-amber-500 text-[#0E1933] border-amber-400"
                            }`}>
                                {targetMet ? (
                                    <>
                                        <Check className="h-3 w-3 stroke-[3]" />
                                        <span className="text-[10px] font-bold uppercase tracking-[0.04em] leading-none">
                                            Target £{Math.round(PACK.dayRateTargetPence / 100)}
                                        </span>
                                        <span className="text-[10px] font-bold tabular-nums leading-none">
                                            +{fmt(overByPence)}
                                        </span>
                                    </>
                                ) : (
                                    <>
                                        <AlertCircle className="h-3 w-3" />
                                        <span className="text-[10px] font-bold uppercase tracking-[0.04em] leading-none">
                                            Top-up: {fmt(PACK.dayRateTargetPence - PACK.totalContractorPayPence)}
                                        </span>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="relative">
                            <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-white/55 mb-1.5">
                                {fmtDate(PACK.date)} · {PACK.area}
                            </p>
                            <p className="text-[14px] font-semibold text-white/85 mb-4">
                                Hi {PACK.contractorName} — your day-pack offer
                            </p>

                            <p className="text-5xl sm:text-6xl font-semibold text-[#F5A623] tabular-nums tracking-tight leading-none drop-shadow-[0_2px_12px_rgba(245,166,35,0.25)]">
                                {fmt(PACK.totalContractorPayPence)}
                            </p>
                            <p className="text-[12px] uppercase tracking-[0.08em] text-white/65 mt-2 font-medium">
                                Your pay · {PACK.jobs.length} jobs · ~{PACK.totalWorkHours}h work
                            </p>

                            {/* Materials supplied banner */}
                            <p className="mt-4 inline-flex items-center gap-2 text-[14px] sm:text-[15px] font-semibold text-[#7DB00E]">
                                <Package className="h-4 w-4 sm:h-[18px] sm:w-[18px]" /> Materials supplied by Handy
                            </p>

                            {/* Travel + summary row */}
                            <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-white/85">
                                <span className="inline-flex items-center gap-2">
                                    <MapPin className="h-4 w-4 text-[#F5A623]" /> One area · {PACK.area.split('·')[1]?.trim() || PACK.area}
                                </span>
                                <span className="inline-flex items-center gap-2">
                                    <Truck className="h-4 w-4 text-[#F5A623]" /> ~{PACK.totalTravelMinutes} min travel total
                                </span>
                                <span className="inline-flex items-center gap-2">
                                    <Clock className="h-4 w-4 text-[#F5A623]" /> {PACK.jobs[0].startTime}–{PACK.jobs[PACK.jobs.length - 1].endTime}
                                </span>
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* ───── Job sequence ───── */}
                <motion.div {...fadeInUp}>
                    <div className="flex items-baseline justify-between mb-2.5">
                        <h2 className="text-[11px] uppercase tracking-[0.1em] font-semibold text-[#5C6470]">
                            Today's run
                        </h2>
                        <span className="text-[11px] text-[#8B92A0] tabular-nums">
                            {PACK.jobs.length} jobs · tap for details
                        </span>
                    </div>
                    <div className="bg-white rounded-2xl border border-[#E6E8EC] overflow-hidden">
                        {PACK.jobs.map((job, idx) => {
                            const isOpen = expandedJob === job.num;
                            const showTravelBelow = job.travelMinutesToNext && idx < PACK.jobs.length - 1;

                            return (
                                <div key={job.num}>
                                    {/* Job row */}
                                    <button
                                        onClick={() => setExpandedJob(isOpen ? null : job.num)}
                                        className="w-full px-4 py-4 flex items-start gap-3 hover:bg-[#F1F3F6] transition-colors text-left"
                                    >
                                        <span className="text-[12px] font-mono text-[#5C6470] tabular-nums w-12 shrink-0 pt-0.5 font-semibold">
                                            {job.startTime}
                                        </span>
                                        <span className={`w-2 h-2 rounded-full ${tierDot(job.tier)} mt-2 shrink-0`} />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[14px] font-medium text-[#0E1116] truncate">{job.title}</p>
                                            <p className="text-[12px] text-[#8B92A0] mt-0.5 truncate">
                                                {job.postcode} · {job.durationHours}h · #{job.slug}
                                            </p>
                                        </div>
                                        <span className="text-[14px] font-semibold tabular-nums text-[#0E1116] shrink-0 pt-0.5">
                                            {fmt(job.contractorPayPence)}
                                        </span>
                                        <ChevronDown className={`h-4 w-4 text-[#8B92A0] shrink-0 transition-transform mt-1 ${isOpen ? "rotate-180" : ""}`} />
                                    </button>

                                    <AnimatePresence initial={false}>
                                        {isOpen && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: "auto", opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: 0.2, ease: "easeOut" }}
                                                className="overflow-hidden"
                                            >
                                                <div className="px-4 pb-5 pt-1 space-y-3 bg-[#FAFBFC] border-t border-[#E6E8EC]">
                                                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-[#8B92A0] font-semibold">
                                                        <span className={`w-1.5 h-1.5 rounded-full ${tierDot(job.tier)}`} />
                                                        {tierLabel(job.tier)}
                                                        {job.category && (
                                                            <span className="bg-[#F1F3F6] text-[#5C6470] px-1.5 py-0.5 rounded normal-case tracking-normal text-[11px] font-medium">
                                                                {job.category.replace(/_/g, " ")}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {job.description && (
                                                        <p className="text-[13px] leading-relaxed text-[#5C6470]">{job.description}</p>
                                                    )}
                                                    {job.materials && job.materials.length > 0 && (
                                                        <div>
                                                            <p className="text-[11px] uppercase tracking-[0.08em] text-[#8B92A0] font-semibold mb-1.5">Materials supplied</p>
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {job.materials.map((m, i) => (
                                                                    <span key={i} className="text-[12px] bg-[#F1F3F6] text-[#5C6470] px-2 py-1 rounded-md">{m}</span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                    <div className="flex items-center gap-2 text-[12px] text-[#8B92A0] pt-1">
                                                        <Clock className="h-3.5 w-3.5" />
                                                        {job.startTime}–{job.endTime} · {job.durationHours}h
                                                    </div>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    {/* Travel divider */}
                                    {showTravelBelow ? (
                                        <div className="px-4 py-2 bg-[#FAFBFC] border-t border-[#E6E8EC] flex items-center gap-3">
                                            <span className="ml-12 inline-flex items-center gap-1.5 text-[11px] text-[#8B92A0] uppercase tracking-[0.06em] font-semibold">
                                                <Truck className="h-3.5 w-3.5" />
                                                Travel · ~{job.travelMinutesToNext} min
                                            </span>
                                        </div>
                                    ) : idx < PACK.jobs.length - 1 ? (
                                        <div className="border-t border-[#E6E8EC]" />
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                </motion.div>

                {/* ───── Pay protection ───── */}
                <motion.div {...fadeInUp}>
                    <h2 className="text-[11px] uppercase tracking-[0.1em] font-semibold text-[#5C6470] mb-2.5">
                        Pay protection · we cover you
                    </h2>
                    <div className="bg-white rounded-2xl border border-[#E6E8EC] p-5 space-y-3">
                        {[
                            { label: "Day-rate guarantee", detail: `Minimum £${Math.round(PACK.dayRateTargetPence / 100)} for the day, even if jobs cancel` },
                            { label: "Mis-scope auto-uplift", detail: "If a job runs over our estimate, we pay the extra time" },
                            { label: "Call-out fee", detail: "£45 if a customer's not home or you can't start" },
                            { label: "Cancellation comp", detail: "50–75% of pay if customer cancels last-minute" },
                            { label: "Materials reimbursement", detail: "Receipt + 10% handling for anything we missed" },
                            { label: "48h pay", detail: "Money in your account 2 days after completion" },
                        ].map((g, i) => (
                            <div key={i} className="flex items-start gap-3">
                                <div className="w-5 h-5 rounded-full bg-[#3B7A3F]/10 flex items-center justify-center shrink-0 mt-0.5">
                                    <Check className="h-3 w-3 text-[#3B7A3F] stroke-[3]" />
                                </div>
                                <div className="flex-1">
                                    <p className="text-[13px] font-semibold text-[#0E1116] leading-tight">{g.label}</p>
                                    <p className="text-[12px] text-[#5C6470] leading-relaxed mt-0.5">{g.detail}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </motion.div>

                {/* ───── How it works ───── */}
                <motion.div {...fadeInUp}>
                    <h2 className="text-[11px] uppercase tracking-[0.1em] font-semibold text-[#5C6470] mb-2.5">How this works</h2>
                    <div className="bg-white rounded-2xl border border-[#E6E8EC] p-5">
                        <div className="grid grid-cols-4 gap-3">
                            {[
                                { icon: Calendar, label: "Accept the day", num: 1 },
                                { icon: Hammer, label: "All 4 jobs lock to you", num: 2 },
                                { icon: Trophy, label: "Complete + photos", num: 3 },
                                { icon: Star, label: "Pay in 48h", num: 4 },
                            ].map(({ icon: Icon, label, num }) => (
                                <div key={num} className="text-center">
                                    <div className="relative mx-auto w-12 h-12 rounded-xl bg-[#3B7A3F]/[0.08] flex items-center justify-center mb-2">
                                        <Icon className="h-5 w-5 text-[#3B7A3F]" />
                                        <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#3B7A3F] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                                            {num}
                                        </span>
                                    </div>
                                    <p className="text-[11px] sm:text-[12px] font-medium text-[#0E1116] leading-tight">{label}</p>
                                </div>
                            ))}
                        </div>
                        <p className="text-[11px] text-[#8B92A0] text-center mt-4 italic">
                            One offer · all 4 jobs · one good day's work.
                        </p>
                    </div>
                </motion.div>

                {/* ───── Footer ───── */}
                <motion.div {...fadeInUp} className="text-center pt-2">
                    <p className="text-[10px] text-[#8B92A0] uppercase tracking-[0.12em]">
                        Handy Services · Day-Pack Preview
                    </p>
                </motion.div>
            </main>

            {/* ───── Sticky bottom CTA ───── */}
            {!decided && (
                <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#E6E8EC] bg-white/95 backdrop-blur-md">
                    <div className="max-w-[680px] mx-auto px-4 pt-3 pb-3">
                        <div className="flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                                <p className="text-[10px] uppercase tracking-[0.08em] font-semibold text-[#8B92A0] leading-none">You earn</p>
                                <p className="text-[20px] font-semibold tabular-nums text-[#0E1116] leading-tight mt-0.5">
                                    {fmt(PACK.totalContractorPayPence)}
                                    <span className="text-[12px] text-[#8B92A0] font-normal ml-1">· {PACK.jobs.length} jobs</span>
                                </p>
                            </div>
                            <button
                                onClick={() => setDecided('declined')}
                                className="px-4 py-3 rounded-xl font-semibold text-[14px] text-[#5C6470] hover:text-[#0E1116] hover:bg-[#F1F3F6] transition-colors"
                            >
                                Pass
                            </button>
                            <button
                                onClick={() => setDecided('accepted')}
                                className="px-5 py-3 rounded-xl font-semibold text-[14px] bg-[#3B7A3F] hover:bg-[#2F6133] text-white transition-all active:scale-[0.97] shadow-md shadow-[#3B7A3F]/20 inline-flex items-center gap-2"
                            >
                                <Hammer className="h-4 w-4" />
                                Accept day
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ───── Decision modal (preview only — no real action) ───── */}
            <AnimatePresence>
                {decided && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[60] bg-[#0E1116]/40 backdrop-blur-sm flex items-center justify-center p-4"
                        onClick={() => setDecided(null)}
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white rounded-2xl p-8 max-w-sm text-center shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5 ${
                                decided === 'accepted' ? 'bg-[#3B7A3F]/10' : 'bg-amber-50'
                            }`}>
                                {decided === 'accepted' ? (
                                    <Check className="h-7 w-7 text-[#3B7A3F] stroke-[3]" />
                                ) : (
                                    <X className="h-7 w-7 text-amber-600" />
                                )}
                            </div>
                            <h2 className="text-xl font-semibold mb-2 text-[#0E1116]">
                                {decided === 'accepted' ? "Day-pack accepted" : "Day-pack declined"}
                            </h2>
                            <div className="bg-[#F7F8FA] border border-[#E6E8EC] rounded-lg p-3 mb-5 flex items-start gap-2.5 text-left">
                                <ShieldCheck className="h-4 w-4 text-[#3B7A3F] shrink-0 mt-0.5" />
                                <p className="text-[12px] text-[#5C6470] leading-relaxed">
                                    <span className="font-semibold text-[#0E1116]">Preview only.</span> No real dispatch fired. {decided === 'accepted'
                                        ? "In production, all 4 jobs would lock to you and customers would be notified."
                                        : "In production, the day-pack would dissolve and jobs return to single-offer routing."}
                                </p>
                            </div>
                            <button
                                onClick={() => setDecided(null)}
                                className="text-[13px] text-[#5C6470] hover:text-[#0E1116] underline"
                            >
                                Reset preview
                            </button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
