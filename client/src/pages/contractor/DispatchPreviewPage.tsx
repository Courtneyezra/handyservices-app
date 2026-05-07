/**
 * Day-Pack Preview — frontend-only test page.
 *
 * URL: /dispatch-preview
 *
 * Shows what a Builder's day-pack offer looks like, assembled from the 4 quotes
 * given to a contractor today. Pure UI mock — no backend calls, no real dispatch
 * fires on accept/decline.
 *
 * Design principle: Builders don't see per-job prices. They see ONE day rate,
 * the bonus structure (completion + 5★), and a timeline of where they're going.
 * The day rate is the offer — the engine that derives it stays hidden.
 */

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Check, X, AlertCircle, MapPin, Hammer, Package, Calendar, ChevronDown,
    Star, Trophy, Truck, ShieldCheck, Clock, ExternalLink, Sparkles,
} from "lucide-react";

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

interface JobInPack {
    num: number;
    slug: string;
    title: string;
    addressLine?: string;     // Street / business name — optional (production gates this on bond)
    postcode: string;
    startTime: string;
    endTime: string;
    durationHours: number;
    tier: 'specialist' | 'skilled' | 'general' | 'outdoor';
    category?: string;
    description?: string;
    materials?: string[];
    travelMinutesToNext?: number;
    coords: { lat: number; lng: number };
}

interface DayPack {
    packRef: string;
    date: string;
    contractorName: string;
    area: string;
    jobs: JobInPack[];
    // Day rate — the ONE number the Builder sees as their pay
    dayRatePence: number;
    // Per-additional-stop bonus — first stop is the warm-up (no bonus),
    // every stop after earns this. Total max = (jobs.length - 1) × this.
    bonusPerAdditionalStopPence: number;
    fiveStarBonusPerReviewPence: number;
    maxFiveStarReviews: number;
    // Day stats
    totalWorkHours: number;
    totalTravelMinutes: number;
    totalDistanceMiles: number;
}

// ───────────────────────────────────────────────────────────────────────────
// Seed data — the 4 real quotes given to the contractor today.
//
// Pulled from production API (/api/personalized-quotes/:slug):
//   zw2eqimg → NG5 1EN  · Install 6x4 shed + level floor       · £320 customer
//   py8jrvxz → NG9 4AF  · Supply & fit Arden gate panel/repair · £110 customer
//   nkno7s07 → NG14 5BQ · Install bendable PVC curtain track   · £251 customer
//   9fitx3o1 → NG2 1AH  · Replace handle/lock/latch on door    · line item only
//                         (parent quote has 6 line items — only this one)
//
// Real geographic spread (NG2 / NG5 / NG9 / NG14) makes this a tough day —
// ~28 miles, ~70 min driving, ~8h work = ~9.5h on the road. Day rate £200
// surfaces the tension exactly: £21/hr equivalent. Honest stress test.
//
// Order is route-optimised (south-west loop): NG2 → NG9 → NG5 → NG14.
// ───────────────────────────────────────────────────────────────────────────

const PACK: DayPack = {
    packRef: "DP-MAR-FRI",
    date: "2026-05-08",
    contractorName: "Mark",
    area: "Nottingham · NG2 / NG9 / NG5 / NG14",
    // Hardcoded £200 for the test page — real day rate is computed by the
    // hidden engine (rev-share + floor + segment) at routing time.
    dayRatePence: 20000,
    // First stop is the warm-up (no bonus). Each subsequent stop earns this.
    // For 4 stops, max bonus = 3 × £10 = £30.
    bonusPerAdditionalStopPence: 1000,
    fiveStarBonusPerReviewPence: 1000,
    maxFiveStarReviews: 4,
    totalWorkHours: 8.0,
    totalTravelMinutes: 70,
    totalDistanceMiles: 28,
    jobs: [
        {
            num: 1,
            slug: "9fitx3o1",
            title: "Replace handle, lock and latch on door",
            addressLine: "Adamo Foods, Unit 12 Castle Park",
            postcode: "NG2 1AH",
            startTime: "08:00",
            endTime: "08:30",
            durationHours: 0.5,
            tier: "general",
            category: "joinery",
            description: "Replace handle, lock and latch on existing door — single line item from a wider building maintenance quote.",
            materials: ["Lock set", "Strike plate"],
            travelMinutesToNext: 15,
            coords: { lat: 52.9333, lng: -1.1374 }, // West Bridgford / Meadows
        },
        {
            num: 2,
            slug: "py8jrvxz",
            title: "Supply and fit Arden gate panel + repair",
            // Address pending — show postcode only for now
            postcode: "NG9 4AF",
            startTime: "08:45",
            endTime: "10:15",
            durationHours: 1.5,
            tier: "outdoor",
            category: "fencing_gates",
            description: "Supply and fit a new garden gate and repair the broken panel on the Arden fence — both jobs in one visit.",
            materials: ["Replacement panel", "Hinges", "Fixings"],
            travelMinutesToNext: 30,
            coords: { lat: 52.9251, lng: -1.2156 }, // Beeston
        },
        {
            num: 3,
            slug: "zw2eqimg",
            title: "Install 6x4 shed and level floor",
            addressLine: "4 Westbury Mews",
            postcode: "NG5 1EN",
            startTime: "10:45",
            endTime: "14:45",
            durationHours: 4.0,
            tier: "outdoor",
            category: "shed_install",
            description: "Install 6x4 shed and level the floor properly so it's stable and ready to use. Site clean-up included.",
            materials: ["Shed kit", "Levelling sand", "Bearers"],
            travelMinutesToNext: 25,
            coords: { lat: 52.9784, lng: -1.1467 }, // Sherwood / Carlton
        },
        {
            num: 4,
            slug: "nkno7s07",
            title: "Install bendable PVC curtain track",
            addressLine: "11A Glen Road",
            postcode: "NG14 5BQ",
            startTime: "15:10",
            endTime: "17:10",
            durationHours: 2.0,
            tier: "skilled",
            category: "joinery_fittings",
            description: "Supply and install bendable PVC curtain track end-to-end — sourcing materials and final fitting.",
            materials: ["Bendable PVC track", "Brackets", "End stops"],
            travelMinutesToNext: 0,
            coords: { lat: 53.0094, lng: -1.0445 }, // Lowdham / Burton Joyce
        },
    ],
};

// ───────────────────────────────────────────────────────────────────────────
// Helpers
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

const fadeInUp = {
    initial: { opacity: 0, y: 8 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
    transition: { duration: 0.35 },
};

// Maximum bonus from per-stop completion (warm-up first stop is excluded)
function maxStopBonusPence(p: DayPack): number {
    return Math.max(0, (p.jobs.length - 1) * p.bonusPerAdditionalStopPence);
}

// Compute potential max earnings: day rate + all stop bonuses + max 5★ reviews
function computeMaxPotential(p: DayPack): number {
    return p.dayRatePence
        + maxStopBonusPence(p)
        + (p.fiveStarBonusPerReviewPence * p.maxFiveStarReviews);
}

// Bonus earned for the set of completed stops.
// Every stop with num > 1 earns the per-stop bonus when ticked.
// (First stop is the warm-up — completing it alone earns nothing.)
function bonusFromCompleted(p: DayPack, completed: Set<number>): number {
    let n = 0;
    for (const num of completed) if (num > 1) n += 1;
    return n * p.bonusPerAdditionalStopPence;
}

// Build Google Maps Embed directions URL.
// Uses lat,lng coords directly — more reliable than postcode geocoding,
// especially for short UK postcodes that can be ambiguous without city/country.
// No zoom override → map auto-fits to the entire route.
function buildMapEmbedUrl(p: DayPack): string {
    const key = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY;
    const formatPoint = (j: JobInPack) => `${j.coords.lat},${j.coords.lng}`;
    if (key && p.jobs.length >= 2) {
        const origin = formatPoint(p.jobs[0]);
        const destination = formatPoint(p.jobs[p.jobs.length - 1]);
        const waypoints = p.jobs.slice(1, -1).map(formatPoint).join("|");
        const wpParam = waypoints ? `&waypoints=${waypoints}` : "";
        return `https://www.google.com/maps/embed/v1/directions?key=${key}&origin=${origin}&destination=${destination}${wpParam}&mode=driving`;
    }
    // Fallback: centered map on first job, no directions overlay.
    const c = p.jobs[0].coords;
    return `https://www.google.com/maps?q=${c.lat},${c.lng}&z=13&output=embed`;
}

// Open-in-Maps deep link using the Maps URLs API.
// Coords-based for unambiguous routing across Maps app versions.
function buildMapDeepLink(p: DayPack): string {
    const formatPoint = (j: JobInPack) => `${j.coords.lat},${j.coords.lng}`;
    const origin = formatPoint(p.jobs[0]);
    const destination = formatPoint(p.jobs[p.jobs.length - 1]);
    const waypoints = p.jobs.slice(1, -1).map(formatPoint).join("|");
    const wpParam = waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : "";
    return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${wpParam}&travelmode=driving`;
}

// ───────────────────────────────────────────────────────────────────────────
// Page
// ───────────────────────────────────────────────────────────────────────────

export default function DispatchPreviewPage() {
    const [decided, setDecided] = useState<'accepted' | 'declined' | null>(null);
    // Interactive tick-to-complete — each stop number can be marked done.
    // Persists across renders within the session; resets on page reload.
    const [completedStops, setCompletedStops] = useState<Set<number>>(new Set());
    // Single-expanded-row pattern: only one stop expanded at a time keeps the
    // page compact. null = all collapsed.
    const [expandedStop, setExpandedStop] = useState<number | null>(null);
    // 5★ review bonus claims — once a stop is complete, its review can be
    // requested. Tracks which stops have had their review claimed for animation.
    const [claimedReviews, setClaimedReviews] = useState<Set<number>>(new Set());
    // Toast notification stack — Uber-style transient feedback on key events.
    const [toast, setToast] = useState<{ id: number; msg: string; tone: 'bonus' | 'win' } | null>(null);
    const toastIdRef = useRef(0);
    function showToast(msg: string, tone: 'bonus' | 'win' = 'bonus') {
        toastIdRef.current += 1;
        setToast({ id: toastIdRef.current, msg, tone });
        const myId = toastIdRef.current;
        setTimeout(() => setToast(t => (t?.id === myId ? null : t)), 2400);
    }
    // Confetti burst — fires once when all stops complete, then resets.
    const [confettiOn, setConfettiOn] = useState(false);

    const maxPotential = computeMaxPotential(PACK);
    const mapEmbedUrl = buildMapEmbedUrl(PACK);
    const mapDeepLink = buildMapDeepLink(PACK);

    const completedCount = completedStops.size;
    const totalStops = PACK.jobs.length;
    const earnedStopBonusPence = bonusFromCompleted(PACK, completedStops);
    const earnedReviewBonusPence = claimedReviews.size * PACK.fiveStarBonusPerReviewPence;
    const earnedBonusPence = earnedStopBonusPence + earnedReviewBonusPence;
    const allComplete = completedCount === totalStops;
    const progressPct = (completedCount / totalStops) * 100;

    function toggleStop(num: number) {
        const wasComplete = completedStops.has(num);
        setCompletedStops(prev => {
            const next = new Set(prev);
            if (next.has(num)) {
                next.delete(num);
                setClaimedReviews(rev => { const n = new Set(rev); n.delete(num); return n; });
            } else {
                next.add(num);
            }
            return next;
        });
        // Fire toast on completion (only when newly ticking, not un-ticking)
        if (!wasComplete) {
            const earnsBonus = num > 1;
            showToast(earnsBonus ? `Stop ${num} done · +£10` : `Stop ${num} done!`, 'bonus');
        }
    }
    function toggleExpanded(num: number) {
        setExpandedStop(prev => (prev === num ? null : num));
    }
    function claimReview(num: number) {
        setClaimedReviews(prev => { const next = new Set(prev); next.add(num); return next; });
        showToast(`5★ claimed · +£10`, 'bonus');
    }
    function resetCompletions() {
        setCompletedStops(new Set());
        setClaimedReviews(new Set());
        setExpandedStop(null);
        setConfettiOn(false);
    }
    // Trigger confetti on transition from incomplete → all complete
    useEffect(() => {
        if (allComplete) {
            setConfettiOn(true);
            showToast(`🏆 Day complete · ${fmt(maxStopBonusPence(PACK))} earned`, 'win');
            const t = setTimeout(() => setConfettiOn(false), 4000);
            return () => clearTimeout(t);
        }
    }, [allComplete]);

    return (
        <div className="min-h-screen bg-[#F7F8FC] font-['Poppins',sans-serif] text-[#111827] selection:bg-[#1B2A4A]/20 pb-32">

            {/* Brand nav bar — navy with logo + 5★ rating + phone */}
            <header className="bg-[#1B2A4A] text-white">
                <div className="max-w-[680px] mx-auto px-4 py-2.5 flex items-center gap-3">
                    <img src="/logo.png" alt="Handy" className="w-8 h-8 object-contain shrink-0" />
                    <div className="flex-1 min-w-0">
                        <p className="font-bold text-[14px] leading-tight">Handy Services</p>
                        <p className="text-[10px] leading-tight">
                            <span className="text-[#F5A623]">★★★★★</span>
                            <span className="text-white/80 ml-1">4.9 · 300+ reviews</span>
                        </p>
                    </div>
                    <a href="tel:07449501762" className="text-[12px] font-bold text-white whitespace-nowrap">
                        07449 501 762
                    </a>
                </div>
            </header>

            {/* Yellow accent strip */}
            <div className="bg-[#F5A623] text-[#1B2A4A]">
                <p className="max-w-[680px] mx-auto px-4 py-1.5 text-[11px] font-bold tracking-[0.04em] text-center">
                    DAY-PACK · {fmtDate(PACK.date).toUpperCase()}
                </p>
            </div>

            <main className="max-w-[680px] mx-auto px-4 py-6 space-y-5">

                {/* ───── HERO — day rate, the ONE number ───── */}
                <motion.div {...fadeInUp}>
                    <div className="rounded-2xl p-6 sm:p-7 shadow-[0_12px_40px_rgba(27,42,74,0.18)] relative overflow-hidden bg-gradient-to-br from-[#1B2A4A] via-[#152340] to-[#0E1933]">
                        <div className="absolute -top-24 -right-24 w-80 h-80 bg-[#F5A623]/15 rounded-full blur-3xl pointer-events-none" />
                        <div className="absolute -bottom-32 -left-20 w-72 h-72 bg-[#F5A623]/10 rounded-full blur-3xl pointer-events-none" />

                        <div className="relative">
                            <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-white/60 mb-2">
                                Hi {PACK.contractorName}
                            </p>

                            <p className="text-6xl sm:text-7xl font-bold text-[#F5A623] tabular-nums tracking-tight leading-none drop-shadow-[0_2px_12px_rgba(245,166,35,0.25)]">
                                <motion.span
                                    key={`hero-${PACK.dayRatePence + earnedBonusPence}`}
                                    initial={{ scale: earnedBonusPence > 0 ? 1.15 : 1 }}
                                    animate={{ scale: 1 }}
                                    transition={{ type: "spring", stiffness: 300, damping: 18 }}
                                    className="inline-block"
                                >
                                    {fmt(PACK.dayRatePence + earnedBonusPence)}
                                </motion.span>
                            </p>
                            <p className="text-[11px] uppercase tracking-[0.1em] text-white/60 mt-2 font-bold">
                                {earnedBonusPence > 0
                                    ? <>+{fmt(earnedBonusPence)} earned</>
                                    : <>{PACK.jobs.length} stops · materials supplied</>}
                            </p>

                            {/* Progress bar — fills as stops are ticked off */}
                            <div className="mt-4 pt-4 border-t border-white/10">
                                <div className="flex items-baseline justify-between mb-2">
                                    <span className="text-[10px] uppercase tracking-[0.08em] font-semibold text-white/65">
                                        Progress · {completedCount}/{totalStops} stops
                                    </span>
                                    <motion.span
                                        key={`bonus-${earnedBonusPence}`}
                                        initial={{ scale: 1 }}
                                        animate={{ scale: completedCount > 0 ? [1.2, 1] : 1 }}
                                        transition={{ duration: 0.3 }}
                                        className={`text-[13px] font-bold tabular-nums ${earnedBonusPence > 0 ? 'text-[#F5A623]' : 'text-white/45'}`}
                                    >
                                        +{fmt(earnedBonusPence)} earned
                                    </motion.span>
                                </div>
                                <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                                    <motion.div
                                        className="h-full bg-gradient-to-r from-[#F5A623] to-[#F5A623]"
                                        initial={{ width: 0 }}
                                        animate={{ width: `${progressPct}%` }}
                                        transition={{ duration: 0.5, ease: "easeOut" }}
                                    />
                                </div>
                            </div>

                            {/* Day-rate floor */}
                            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-white/85">
                                <span className="inline-flex items-center gap-2">
                                    <ShieldCheck className="h-4 w-4 text-[#F5A623]" />
                                    {fmt(PACK.dayRatePence)} guaranteed
                                </span>
                                {completedCount > 0 && (
                                    <button
                                        onClick={resetCompletions}
                                        className="inline-flex items-center gap-1.5 text-[12px] text-white/55 hover:text-white/85 underline-offset-2 hover:underline"
                                    >
                                        Reset
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </motion.div>


                {/* ───── MAP — today's route ───── */}
                <motion.div {...fadeInUp}>
                    <div className="bg-white rounded-2xl border border-[#D0D5E3] overflow-hidden">
                        <iframe
                            src={mapEmbedUrl}
                            width="100%"
                            height="280"
                            style={{ border: 0, display: "block" }}
                            loading="lazy"
                            allowFullScreen
                            referrerPolicy="no-referrer-when-downgrade"
                            title="Day-pack route map"
                        />
                        <a
                            href={mapDeepLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-1.5 p-3 text-[13px] font-semibold text-[#1B2A4A] hover:bg-[#F7F8FC] active:scale-[0.99] transition-all border-t border-[#D0D5E3]"
                        >
                            Open in Google Maps
                            <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                    </div>
                </motion.div>

                {/* ───── TIMELINE — your day ───── */}
                <motion.div {...fadeInUp}>

                    <div className="bg-white rounded-2xl border border-[#D0D5E3] overflow-hidden">
                        <ol className="relative">
                            {PACK.jobs.map((job, idx) => {
                                const isLast = idx === PACK.jobs.length - 1;
                                const isComplete = completedStops.has(job.num);
                                const isExpanded = expandedStop === job.num;
                                const earnsBonus = job.num > 1; // first stop is the warm-up
                                const reviewClaimed = claimedReviews.has(job.num);
                                const hasDetails = job.description || (job.materials && job.materials.length > 0);
                                return (
                                    <li key={job.num} className="relative">
                                        {/* Vertical connector — runs from THIS dot's bottom (top:44px,
                                            which is p-4 + dot height) to the NEXT dot's top (extending
                                            -16px past the li's bottom, which is exactly the next li's
                                            top padding, landing on the next dot's top). Always rendered
                                            — the trophy is the final <li> so this links every numbered
                                            stop down to it. */}
                                        <span
                                            className={`absolute left-[29px] top-[44px] -bottom-4 w-[2px] transition-colors pointer-events-none z-0 ${isComplete ? 'bg-[#1B2A4A]' : 'bg-[#D0D5E3]'}`}
                                            aria-hidden
                                        />

                                        <div className="flex items-start gap-3 p-4">
                                            {/* Tick dot — primary completion control */}
                                            <button
                                                onClick={() => toggleStop(job.num)}
                                                aria-label={isComplete ? `Stop ${job.num} complete — tap to undo` : `Mark stop ${job.num} complete`}
                                                className={`relative w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold tabular-nums transition-all active:scale-90 shrink-0 z-[1] ${
                                                    isComplete
                                                        ? 'bg-[#1B2A4A] border-2 border-[#1B2A4A] text-white'
                                                        : 'bg-white border-2 border-[#1B2A4A] text-[#1B2A4A]'
                                                }`}
                                            >
                                                {isComplete ? <Check className="h-4 w-4 stroke-[3]" /> : job.num}
                                            </button>

                                            {/* Compact body — tap to expand details */}
                                            <button
                                                onClick={() => toggleExpanded(job.num)}
                                                className="flex-1 min-w-0 text-left -my-1 py-1 -mx-1 px-1 rounded-md active:bg-[#F7F8FC] transition-colors"
                                            >
                                                <div className="flex items-start gap-2">
                                                    <div className="flex-1 min-w-0">
                                                        <p className={`text-[15px] font-bold leading-snug transition-colors ${isComplete ? 'text-[#6B7280] line-through decoration-[#1B2A4A]/40' : 'text-[#111827]'}`}>
                                                            {job.title}
                                                        </p>
                                                        <p className="text-[12px] text-[#6B7280] mt-1 leading-snug">
                                                            {job.addressLine ? <>{job.addressLine} · </> : null}{job.postcode}
                                                        </p>
                                                    </div>
                                                    {earnsBonus && !isComplete && (
                                                        <span className="inline-flex items-center text-[11px] font-bold tabular-nums text-[#F5A623] shrink-0 mt-0.5">
                                                            +{fmt(PACK.bonusPerAdditionalStopPence)}
                                                        </span>
                                                    )}
                                                    {hasDetails && (
                                                        <ChevronDown
                                                            className={`h-4 w-4 text-[#6B7280] shrink-0 mt-1 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                                        />
                                                    )}
                                                </div>
                                            </button>
                                        </div>

                                        {/* Expandable details (slug + description + materials) */}
                                        <AnimatePresence initial={false}>
                                            {isExpanded && hasDetails && (
                                                <motion.div
                                                    initial={{ height: 0, opacity: 0 }}
                                                    animate={{ height: "auto", opacity: 1 }}
                                                    exit={{ height: 0, opacity: 0 }}
                                                    transition={{ duration: 0.2, ease: "easeOut" }}
                                                    className="overflow-hidden"
                                                >
                                                    <div className="pl-[56px] pr-4 pb-4 space-y-2.5 text-left">
                                                        {job.description && (
                                                            <p className="text-[12px] text-[#6B7280] leading-relaxed">
                                                                {job.description}
                                                            </p>
                                                        )}
                                                        {job.materials && job.materials.length > 0 && (
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {job.materials.map((m, i) => (
                                                                    <span key={i} className="text-[11px] bg-[#F7F8FC] text-[#6B7280] px-2 py-0.5 rounded-md">
                                                                        {m}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}
                                                        <p className="text-[10px] text-[#6B7280] font-mono pt-1">
                                                            #{job.slug}
                                                        </p>
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>

                                        {/* Earned-bonus + claim-review row — only for completed stops */}
                                        <AnimatePresence>
                                            {isComplete && (
                                                <motion.div
                                                    initial={{ opacity: 0, y: -4 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, y: -4 }}
                                                    transition={{ duration: 0.25 }}
                                                    className="pl-[56px] pr-4 pb-4 -mt-1 flex flex-wrap items-center gap-1.5"
                                                >
                                                    {earnsBonus && (
                                                        <span className="inline-flex items-center gap-1 bg-[#FFF8EC] text-[#92591E] border border-[#F5A623]/40 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums">
                                                            +{fmt(PACK.bonusPerAdditionalStopPence)} earned
                                                        </span>
                                                    )}
                                                    {!reviewClaimed ? (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); claimReview(job.num); }}
                                                            className="inline-flex items-center gap-1 bg-[#1B2A4A] text-white rounded-full px-2.5 py-1 text-[11px] font-bold active:scale-[0.96] transition-transform"
                                                        >
                                                            <Star className="h-3 w-3 fill-[#F5A623] stroke-[#F5A623]" />
                                                            Claim 5★ · +£10
                                                        </button>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 bg-[#FFF8EC] text-[#92591E] border border-[#F5A623]/40 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums">
                                                            <Star className="h-3 w-3 fill-[#F5A623]" />
                                                            +{fmt(PACK.fiveStarBonusPerReviewPence)} review
                                                        </span>
                                                    )}
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </li>
                                );
                            })}

                            {/* ───── BONUS UNLOCK NODE — activates when all stops complete ───── */}
                            <li>
                                <motion.div
                                    animate={{ scale: allComplete ? [1.02, 1] : 1 }}
                                    transition={{ duration: 0.4 }}
                                    className={`flex items-center gap-3 p-4 transition-all ${
                                        allComplete ? 'bg-[#FFF8EC] border-l-4 border-l-[#F5A623]' : ''
                                    }`}
                                >
                                    <div
                                        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all ${
                                            allComplete
                                                ? 'bg-[#F5A623] border-2 border-[#F5A623]'
                                                : 'bg-white border-2 border-[#D0D5E3]'
                                        }`}
                                        aria-hidden
                                    >
                                        <Trophy className={`h-4 w-4 ${allComplete ? 'text-white' : 'text-[#6B7280]'}`} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-[13px] font-bold leading-tight ${allComplete ? 'text-[#1B2A4A]' : 'text-[#6B7280]'}`}>
                                            {allComplete ? "All stops done" : "Finish the day"}
                                        </p>
                                        <p className={`text-[11px] mt-0.5 ${allComplete ? 'text-[#92591E]' : 'text-[#6B7280]'}`}>
                                            {allComplete ? "Full bonus banked" : "Tick stops as you finish"}
                                        </p>
                                    </div>
                                    <span className={`text-[14px] font-bold tabular-nums shrink-0 ${allComplete ? 'text-[#92591E]' : 'text-[#6B7280]'}`}>
                                        {allComplete ? `+${fmt(maxStopBonusPence(PACK))}` : `up to +${fmt(maxStopBonusPence(PACK))}`}
                                    </span>
                                </motion.div>
                            </li>
                        </ol>
                    </div>
                </motion.div>

                {/* ───── PAY PROTECTION (collapsed by default for existing contractors) ───── */}
                <motion.div {...fadeInUp}>
                    <details className="group bg-white rounded-2xl border border-[#D0D5E3] overflow-hidden">
                        <summary className="flex items-center gap-3 p-4 cursor-pointer hover:bg-[#F7F8FC] transition-colors list-none [&::-webkit-details-marker]:hidden">
                            <div className="w-8 h-8 rounded-lg bg-[#1B2A4A]/10 flex items-center justify-center shrink-0">
                                <ShieldCheck className="h-4 w-4 text-[#1B2A4A]" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-semibold text-[#111827] leading-tight">
                                    Pay protection · 6 guarantees
                                </p>
                                <p className="text-[11px] text-[#6B7280] mt-0.5">
                                    Day-rate floor · uplifts · call-outs · cancellations · materials · 48h pay
                                </p>
                            </div>
                            <ChevronDown className="h-4 w-4 text-[#6B7280] shrink-0 transition-transform group-open:rotate-180" />
                        </summary>
                        <div className="px-4 pb-4 pt-0 space-y-2 border-t border-[#D0D5E3]">
                            {[
                                { label: "Day-rate guarantee", detail: `${fmt(PACK.dayRatePence)} guaranteed even if jobs cancel` },
                                { label: "Mis-scope auto-uplift", detail: "If a job runs over our estimate, we pay extra" },
                                { label: "Call-out fee", detail: "£45 if customer's not home or you can't start" },
                                { label: "Cancellation comp", detail: "Comp if customer cancels last-minute" },
                                { label: "Materials reimbursement", detail: "Receipt + 10% handling" },
                                { label: "48h pay", detail: "Money in your account 2 days after completion" },
                            ].map((g, i) => (
                                <div key={i} className="flex items-start gap-2 pt-2">
                                    <Check className="h-3.5 w-3.5 text-[#1B2A4A] stroke-[3] shrink-0 mt-1" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[12px] font-semibold text-[#111827] leading-tight">{g.label}</p>
                                        <p className="text-[11px] text-[#6B7280] leading-relaxed mt-0.5">{g.detail}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </details>
                </motion.div>

            </main>

            {/* ───── BRAND FOOTER (navy) ───── */}
            <footer className="bg-[#1B2A4A] text-white">
                <div className="max-w-[680px] mx-auto px-4 py-5 flex items-center gap-3">
                    <img src="/logo.png" alt="Handy" className="w-8 h-8 object-contain shrink-0" />
                    <div className="flex-1 min-w-0">
                        <p className="font-bold text-[13px] leading-tight">Handy Services</p>
                        <p className="text-[10px] text-[#F5A623] leading-tight mt-0.5">
                            Next-day · Fast · Fully insured
                        </p>
                    </div>
                    <div className="text-right shrink-0">
                        <p className="text-[10px] uppercase tracking-[0.06em] text-white/60 font-bold">Get in touch</p>
                        <a href="tel:07449501762" className="text-[12px] font-bold text-white block">07449 501 762</a>
                    </div>
                </div>
            </footer>

            {/* ───── TOAST (Uber-style transient feedback) ───── */}
            <AnimatePresence>
                {toast && (
                    <motion.div
                        key={toast.id}
                        initial={{ y: -60, opacity: 0, scale: 0.95 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        exit={{ y: -60, opacity: 0, scale: 0.95 }}
                        transition={{ type: "spring", stiffness: 280, damping: 20 }}
                        className="fixed top-3 left-1/2 -translate-x-1/2 z-[55] pointer-events-none"
                    >
                        <div className={`px-4 py-2.5 rounded-full shadow-2xl font-bold text-[14px] tabular-nums ${
                            toast.tone === 'win'
                                ? 'bg-gradient-to-r from-[#F5A623] to-[#F5A623] text-white shadow-[#F5A623]/40'
                                : 'bg-[#1B2A4A] text-white shadow-[#1B2A4A]/30'
                        }`}>
                            {toast.msg}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ───── CONFETTI (fires once on full completion) ───── */}
            <AnimatePresence>
                {confettiOn && (
                    <div className="fixed inset-0 pointer-events-none z-[54] overflow-hidden">
                        {Array.from({ length: 36 }).map((_, i) => {
                            const left = Math.random() * 100;
                            const delay = Math.random() * 0.4;
                            const duration = 1.8 + Math.random() * 1.6;
                            const size = 8 + Math.random() * 6;
                            const colors = ['#F5A623', '#F5A623', '#1B2A4A', '#F5A623', '#FFFFFF'];
                            const color = colors[i % colors.length];
                            const xDrift = (Math.random() - 0.5) * 200;
                            const rot = Math.random() * 720;
                            return (
                                <motion.div
                                    key={i}
                                    initial={{ y: -40, x: 0, opacity: 1, rotate: 0 }}
                                    animate={{
                                        y: typeof window !== 'undefined' ? window.innerHeight + 40 : 900,
                                        x: xDrift,
                                        opacity: [1, 1, 0],
                                        rotate: rot,
                                    }}
                                    transition={{ duration, delay, ease: "easeIn" }}
                                    className="absolute"
                                    style={{
                                        left: `${left}%`,
                                        top: 0,
                                        width: size,
                                        height: size * 1.4,
                                        backgroundColor: color,
                                        borderRadius: 2,
                                    }}
                                />
                            );
                        })}
                    </div>
                )}
            </AnimatePresence>

            {/* ───── STICKY CTA ───── */}
            {!decided && (
                <div
                    className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#D0D5E3] bg-white/95 backdrop-blur-md"
                    style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
                >
                    <div className="max-w-[680px] mx-auto px-4 pt-3 pb-3">
                        <div className="flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                                <p className="text-[10px] uppercase tracking-[0.08em] font-semibold text-[#6B7280] leading-none">
                                    {completedCount > 0 ? `Earnings · ${completedCount}/${totalStops} stops` : 'Day rate'}
                                </p>
                                <p className="text-[20px] font-semibold tabular-nums text-[#111827] leading-tight mt-0.5">
                                    {fmt(PACK.dayRatePence + earnedBonusPence)}
                                    {earnedBonusPence > 0 ? (
                                        <motion.span
                                            key={`tally-${earnedBonusPence}`}
                                            initial={{ scale: 1.3 }}
                                            animate={{ scale: 1 }}
                                            transition={{ duration: 0.3 }}
                                            className="text-[12px] text-[#F5A623] font-bold ml-1"
                                        >
                                            +{fmt(earnedBonusPence)}
                                        </motion.span>
                                    ) : (
                                        <span className="text-[12px] text-[#1B2A4A] font-semibold ml-1">+ bonuses</span>
                                    )}
                                </p>
                            </div>
                            <button
                                onClick={() => setDecided('declined')}
                                className="px-4 py-3 min-h-[44px] rounded-xl font-semibold text-[14px] text-[#6B7280] hover:text-[#111827] hover:bg-[#F7F8FC] transition-colors"
                            >
                                Pass
                            </button>
                            <button
                                onClick={() => setDecided('accepted')}
                                className="px-5 py-3 min-h-[44px] rounded-xl font-semibold text-[14px] bg-[#1B2A4A] hover:bg-[#152340] text-white transition-all active:scale-[0.97] shadow-md shadow-[#1B2A4A]/20 inline-flex items-center gap-2"
                            >
                                <Hammer className="h-4 w-4" />
                                Accept day
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ───── DECISION MODAL (preview only) ───── */}
            <AnimatePresence>
                {decided && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[60] bg-[#111827]/40 backdrop-blur-sm flex items-center justify-center p-4"
                        onClick={() => setDecided(null)}
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white rounded-2xl p-7 sm:p-8 max-w-sm w-full text-center shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5 ${
                                decided === 'accepted' ? 'bg-[#1B2A4A]/10' : 'bg-amber-50'
                            }`}>
                                {decided === 'accepted' ? (
                                    <Check className="h-7 w-7 text-[#1B2A4A] stroke-[3]" />
                                ) : (
                                    <X className="h-7 w-7 text-amber-600" />
                                )}
                            </div>
                            <h2 className="text-xl font-semibold mb-2 text-[#111827]">
                                {decided === 'accepted' ? "Day-pack accepted" : "Day-pack declined"}
                            </h2>
                            <div className="bg-[#F7F8FC] border border-[#D0D5E3] rounded-lg p-3 mb-5 flex items-start gap-2.5 text-left">
                                <ShieldCheck className="h-4 w-4 text-[#1B2A4A] shrink-0 mt-0.5" />
                                <p className="text-[12px] text-[#6B7280] leading-relaxed">
                                    <span className="font-semibold text-[#111827]">Preview only.</span> No real dispatch fired. {decided === 'accepted'
                                        ? `In production, all ${PACK.jobs.length} jobs would lock to you and customers would be notified.`
                                        : "In production, the day-pack would dissolve and jobs return to single-offer routing."}
                                </p>
                            </div>
                            <button
                                onClick={() => setDecided(null)}
                                className="text-[13px] text-[#6B7280] hover:text-[#111827] underline min-h-[44px]"
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
