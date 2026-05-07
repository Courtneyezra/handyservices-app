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

import { useState } from "react";
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

// Bonus earned for completing a given number of stops.
// First stop is the warm-up (no bonus); every stop after earns the per-stop amount.
function bonusForCompleted(p: DayPack, completedCount: number): number {
    return Math.max(0, completedCount - 1) * p.bonusPerAdditionalStopPence;
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

    const maxPotential = computeMaxPotential(PACK);
    const mapEmbedUrl = buildMapEmbedUrl(PACK);
    const mapDeepLink = buildMapDeepLink(PACK);

    const completedCount = completedStops.size;
    const totalStops = PACK.jobs.length;
    const earnedStopBonusPence = bonusForCompleted(PACK, completedCount);
    const earnedReviewBonusPence = claimedReviews.size * PACK.fiveStarBonusPerReviewPence;
    const earnedBonusPence = earnedStopBonusPence + earnedReviewBonusPence;
    const allComplete = completedCount === totalStops;
    const progressPct = (completedCount / totalStops) * 100;

    function toggleStop(num: number) {
        setCompletedStops(prev => {
            const next = new Set(prev);
            if (next.has(num)) {
                next.delete(num);
                // If we un-tick a stop, its review claim should also be revoked
                setClaimedReviews(rev => { const n = new Set(rev); n.delete(num); return n; });
            } else {
                next.add(num);
            }
            return next;
        });
    }
    function toggleExpanded(num: number) {
        setExpandedStop(prev => (prev === num ? null : num));
    }
    function claimReview(num: number) {
        setClaimedReviews(prev => {
            const next = new Set(prev);
            next.add(num);
            return next;
        });
    }
    function resetCompletions() {
        setCompletedStops(new Set());
        setClaimedReviews(new Set());
        setExpandedStop(null);
    }

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

            <main className="max-w-[680px] mx-auto px-4 py-6 space-y-5">

                {/* ───── HERO — day rate, the ONE number ───── */}
                <motion.div {...fadeInUp}>
                    <div className="rounded-2xl p-6 sm:p-7 shadow-[0_12px_40px_rgba(27,42,74,0.18)] relative overflow-hidden bg-gradient-to-br from-[#1B2A4A] via-[#152340] to-[#0E1933]">
                        <div className="absolute -top-24 -right-24 w-80 h-80 bg-[#F5A623]/15 rounded-full blur-3xl pointer-events-none" />
                        <div className="absolute -bottom-32 -left-20 w-72 h-72 bg-[#7DB00E]/10 rounded-full blur-3xl pointer-events-none" />

                        <div className="relative">
                            <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-white/55 mb-1.5">
                                {fmtDate(PACK.date)} · {PACK.area}
                            </p>
                            <p className="text-[14px] sm:text-[15px] font-semibold text-white/85 mb-4">
                                Hi {PACK.contractorName} — your day-pack offer
                            </p>

                            <p className="text-[10px] uppercase tracking-[0.08em] text-white/55 font-semibold">Your day rate</p>
                            <p className="text-5xl sm:text-6xl font-semibold text-[#F5A623] tabular-nums tracking-tight leading-none drop-shadow-[0_2px_12px_rgba(245,166,35,0.25)] mt-1">
                                {fmt(PACK.dayRatePence)}
                            </p>
                            <p className="text-[12px] uppercase tracking-[0.08em] text-white/65 mt-2 font-medium">
                                {PACK.jobs.length} stops · {PACK.area.split('·')[1]?.trim() || PACK.area}
                            </p>

                            {/* Materials supplied */}
                            <p className="mt-4 inline-flex items-center gap-2 text-[14px] sm:text-[15px] font-semibold text-[#7DB00E]">
                                <Package className="h-4 w-4 sm:h-[18px] sm:w-[18px]" /> Materials supplied by Handy
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
                                        className={`text-[13px] font-bold tabular-nums ${earnedBonusPence > 0 ? 'text-[#7DB00E]' : 'text-white/45'}`}
                                    >
                                        +{fmt(earnedBonusPence)} earned
                                    </motion.span>
                                </div>
                                <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                                    <motion.div
                                        className="h-full bg-gradient-to-r from-[#7DB00E] to-[#F5A623]"
                                        initial={{ width: 0 }}
                                        animate={{ width: `${progressPct}%` }}
                                        transition={{ duration: 0.5, ease: "easeOut" }}
                                    />
                                </div>
                            </div>

                            {/* Day-rate floor */}
                            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-white/85">
                                <span className="inline-flex items-center gap-2">
                                    <ShieldCheck className="h-4 w-4 text-[#7DB00E]" />
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

                {/* ───── MISSIONS — Grab-style earned/pending stack ───── */}
                <motion.div {...fadeInUp}>
                    <div className="flex items-baseline justify-between mb-2.5">
                        <h2 className="text-[11px] uppercase tracking-[0.1em] font-semibold text-[#5C6470]">
                            Today's missions
                        </h2>
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums">
                            <span className="text-[#3B7A3F]">{fmt(earnedBonusPence)} earned</span>
                            <span className="text-[#8B92A0]">·</span>
                            <span className="text-[#8B92A0]">up to {fmt(maxStopBonusPence(PACK) + (PACK.fiveStarBonusPerReviewPence * PACK.maxFiveStarReviews))}</span>
                        </span>
                    </div>
                    <div className="bg-white rounded-2xl border border-[#E6E8EC] overflow-hidden divide-y divide-[#E6E8EC]">
                        {/* Per-stop bonus rows — one per stop after the first */}
                        {PACK.jobs.slice(1).map((job) => {
                            const isEarned = completedStops.has(job.num);
                            return (
                                <motion.div
                                    key={`stop-mission-${job.num}`}
                                    animate={{ backgroundColor: isEarned ? '#F0FAEC' : '#FFFFFF' }}
                                    transition={{ duration: 0.3 }}
                                    className="flex items-center gap-3 p-3"
                                >
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${isEarned ? 'bg-[#3B7A3F]' : 'bg-[#F5A623]/10'}`}>
                                        {isEarned ? <Check className="h-4 w-4 text-white stroke-[3]" /> : <Trophy className="h-4 w-4 text-[#F5A623]" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-[13px] font-semibold leading-tight ${isEarned ? 'text-[#3B7A3F]' : 'text-[#0E1116]'}`}>
                                            Complete Stop {job.num}
                                        </p>
                                        <p className="text-[11px] text-[#8B92A0] truncate mt-0.5">
                                            {job.title}
                                        </p>
                                    </div>
                                    <span className={`text-[13px] font-bold tabular-nums shrink-0 transition-colors ${isEarned ? 'text-[#3B7A3F]' : 'text-[#F5A623]'}`}>
                                        +{fmt(PACK.bonusPerAdditionalStopPence)}
                                    </span>
                                </motion.div>
                            );
                        })}

                        {/* 5★ review claims — one row per stop */}
                        {PACK.jobs.map((job) => {
                            const isEarned = claimedReviews.has(job.num);
                            const isUnlocked = completedStops.has(job.num);
                            return (
                                <motion.div
                                    key={`review-mission-${job.num}`}
                                    animate={{
                                        backgroundColor: isEarned ? '#F0FAEC' : isUnlocked ? '#FFFFFF' : '#FAFBFC',
                                        opacity: isUnlocked || isEarned ? 1 : 0.5,
                                    }}
                                    transition={{ duration: 0.3 }}
                                    className="flex items-center gap-3 p-3"
                                >
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${isEarned ? 'bg-[#3B7A3F]' : 'bg-[#3B7A3F]/10'}`}>
                                        {isEarned ? <Check className="h-4 w-4 text-white stroke-[3]" /> : <Star className={`h-4 w-4 ${isEarned ? 'text-white' : 'text-[#3B7A3F]'}`} />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-[13px] font-semibold leading-tight ${isEarned ? 'text-[#3B7A3F]' : 'text-[#0E1116]'}`}>
                                            5★ review · Stop {job.num}
                                        </p>
                                        <p className="text-[11px] text-[#8B92A0] mt-0.5">
                                            {isEarned ? 'Claimed' : isUnlocked ? 'Tap "Claim 5★" on Stop ' + job.num : 'Complete the stop first'}
                                        </p>
                                    </div>
                                    <span className={`text-[13px] font-bold tabular-nums shrink-0 transition-colors ${isEarned ? 'text-[#3B7A3F]' : isUnlocked ? 'text-[#3B7A3F]' : 'text-[#8B92A0]'}`}>
                                        +{fmt(PACK.fiveStarBonusPerReviewPence)}
                                    </span>
                                </motion.div>
                            );
                        })}
                    </div>
                </motion.div>

                {/* ───── MAP — today's route ───── */}
                <motion.div {...fadeInUp}>
                    <h2 className="text-[11px] uppercase tracking-[0.1em] font-semibold text-[#5C6470] mb-2.5">
                        Today's route
                    </h2>
                    <div className="bg-white rounded-2xl border border-[#E6E8EC] overflow-hidden">
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
                        <div className="p-3 sm:p-4 flex items-center justify-between gap-3 border-t border-[#E6E8EC]">
                            <div className="flex items-center gap-2 text-[12px] text-[#5C6470] min-w-0">
                                <MapPin className="h-4 w-4 text-[#8B92A0] shrink-0" />
                                <span className="truncate">
                                    {PACK.jobs.length} stops · {PACK.area.split('·')[1]?.trim() || PACK.area}
                                </span>
                            </div>
                            <a
                                href={mapDeepLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#3B7A3F] hover:text-[#2F6133] active:scale-[0.97] transition-transform"
                            >
                                Open in Google Maps
                                <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                        </div>
                    </div>
                </motion.div>

                {/* ───── TIMELINE — your day, no per-job prices ───── */}
                <motion.div {...fadeInUp}>
                    <div className="flex items-baseline justify-between mb-2.5">
                        <h2 className="text-[11px] uppercase tracking-[0.1em] font-semibold text-[#5C6470]">
                            Your day · in order
                        </h2>
                        <span className="text-[11px] text-[#8B92A0] tabular-nums">
                            {PACK.jobs.length} stops
                        </span>
                    </div>

                    <div className="bg-white rounded-2xl border border-[#E6E8EC] p-4 sm:p-5">
                        <ol className="relative">
                            {PACK.jobs.map((job, idx) => {
                                const isLast = idx === PACK.jobs.length - 1;
                                const isComplete = completedStops.has(job.num);
                                const isExpanded = expandedStop === job.num;
                                const earnsBonus = job.num > 1; // first stop is the warm-up
                                const reviewClaimed = claimedReviews.has(job.num);
                                const hasDetails = job.description || (job.materials && job.materials.length > 0);
                                return (
                                    <li key={job.num} className="relative pl-9 pb-3 last:pb-1">
                                        {/* Vertical line behind dot — solid green for completed segments */}
                                        {!isLast && (
                                            <span
                                                className={`absolute left-[13px] top-7 bottom-0 w-px transition-colors ${isComplete ? 'bg-[#3B7A3F]' : 'bg-[#E6E8EC]'}`}
                                                aria-hidden
                                            />
                                        )}
                                        {/* Tick dot — primary completion control */}
                                        <button
                                            onClick={() => toggleStop(job.num)}
                                            aria-label={isComplete ? `Stop ${job.num} complete — tap to undo` : `Mark stop ${job.num} complete`}
                                            className={`absolute left-0 top-1 w-[26px] h-[26px] rounded-full flex items-center justify-center text-[10px] font-bold tabular-nums transition-all active:scale-90 z-[1] ${
                                                isComplete
                                                    ? 'bg-[#3B7A3F] border-2 border-[#3B7A3F] text-white shadow-md shadow-[#3B7A3F]/30'
                                                    : 'bg-white border-2 border-[#0E1116] text-[#0E1116] hover:bg-[#F1F3F6]'
                                            }`}
                                        >
                                            {isComplete ? <Check className="h-3.5 w-3.5 stroke-[3]" /> : job.num}
                                        </button>

                                        {/* Compact card — tap to expand details */}
                                        <button
                                            onClick={() => toggleExpanded(job.num)}
                                            className="w-full text-left rounded-lg -mx-1 px-1 py-1 hover:bg-[#FAFBFC] active:bg-[#F1F3F6] transition-colors"
                                        >
                                            <div className="flex items-start gap-2">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <p className="text-[10px] uppercase tracking-[0.08em] font-semibold text-[#8B92A0]">
                                                            Stop {job.num}
                                                        </p>
                                                        {earnsBonus && !isComplete && (
                                                            <span className="inline-flex items-center text-[10px] font-bold tabular-nums text-[#F5A623]">
                                                                +{fmt(PACK.bonusPerAdditionalStopPence)}
                                                            </span>
                                                        )}
                                                        <span className={`w-1.5 h-1.5 rounded-full ${tierDot(job.tier)} ml-auto`} />
                                                    </div>
                                                    <p className={`text-[15px] font-semibold mt-0.5 leading-tight transition-colors ${isComplete ? 'text-[#5C6470] line-through decoration-[#3B7A3F]/40' : 'text-[#0E1116]'}`}>
                                                        {job.title}
                                                    </p>
                                                    {job.addressLine ? (
                                                        <p className="text-[13px] font-medium text-[#0E1116] mt-1">
                                                            {job.addressLine}
                                                        </p>
                                                    ) : null}
                                                    <p className="text-[11px] text-[#5C6470] mt-0.5">
                                                        {job.postcode} · #{job.slug}
                                                    </p>
                                                </div>
                                                {hasDetails && (
                                                    <ChevronDown
                                                        className={`h-4 w-4 text-[#8B92A0] shrink-0 mt-0.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                                    />
                                                )}
                                            </div>
                                        </button>

                                        {/* Expandable details */}
                                        <AnimatePresence initial={false}>
                                            {isExpanded && hasDetails && (
                                                <motion.div
                                                    initial={{ height: 0, opacity: 0 }}
                                                    animate={{ height: "auto", opacity: 1 }}
                                                    exit={{ height: 0, opacity: 0 }}
                                                    transition={{ duration: 0.2, ease: "easeOut" }}
                                                    className="overflow-hidden"
                                                >
                                                    <div className="mt-2 pl-1 space-y-2 text-left">
                                                        {job.description && (
                                                            <p className="text-[12px] text-[#5C6470] leading-relaxed">
                                                                {job.description}
                                                            </p>
                                                        )}
                                                        {job.materials && job.materials.length > 0 && (
                                                            <div>
                                                                <p className="text-[10px] uppercase tracking-[0.06em] font-semibold text-[#8B92A0] mb-1">Materials supplied</p>
                                                                <div className="flex flex-wrap gap-1.5">
                                                                    {job.materials.map((m, i) => (
                                                                        <span key={i} className="text-[11px] bg-[#F1F3F6] text-[#5C6470] px-2 py-0.5 rounded-md">
                                                                            {m}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>

                                        {/* Earned-bonus + claim-review row — only for completed stops */}
                                        <AnimatePresence>
                                            {isComplete && (earnsBonus || true) && (
                                                <motion.div
                                                    initial={{ opacity: 0, y: -4 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, y: -4 }}
                                                    transition={{ duration: 0.25 }}
                                                    className="mt-2 flex flex-wrap items-center gap-1.5"
                                                >
                                                    {earnsBonus && (
                                                        <span className="inline-flex items-center gap-1 bg-[#F5A623]/15 text-[#92591E] border border-[#F5A623]/30 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums">
                                                            <Sparkles className="h-3 w-3" />
                                                            +{fmt(PACK.bonusPerAdditionalStopPence)} earned
                                                        </span>
                                                    )}
                                                    {!reviewClaimed ? (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); claimReview(job.num); }}
                                                            className="inline-flex items-center gap-1 bg-white border border-[#3B7A3F] text-[#3B7A3F] rounded-full px-2 py-0.5 text-[11px] font-bold hover:bg-[#3B7A3F] hover:text-white transition-colors active:scale-[0.96]"
                                                        >
                                                            <Star className="h-3 w-3" />
                                                            Claim 5★ +£10
                                                        </button>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 bg-[#3B7A3F]/15 text-[#3B7A3F] border border-[#3B7A3F]/30 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums">
                                                            <Star className="h-3 w-3 fill-[#3B7A3F]" />
                                                            +{fmt(PACK.fiveStarBonusPerReviewPence)} review claimed
                                                        </span>
                                                    )}
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </li>
                                );
                            })}

                            {/* ───── BONUS UNLOCK NODE — activates when all stops complete ───── */}
                            <li className="relative pl-9">
                                <span
                                    className={`absolute left-0 top-1 w-[26px] h-[26px] rounded-full flex items-center justify-center transition-all ${
                                        allComplete
                                            ? 'bg-gradient-to-br from-[#F5A623] to-[#F2871E] border-2 border-[#F5A623] shadow-md shadow-[#F5A623]/40'
                                            : 'bg-white border-2 border-[#E6E8EC]'
                                    }`}
                                    aria-hidden
                                >
                                    <Trophy className={`h-3.5 w-3.5 ${allComplete ? 'text-white' : 'text-[#8B92A0]'}`} />
                                </span>
                                <motion.div
                                    animate={{ scale: allComplete ? [1.02, 1] : 1 }}
                                    transition={{ duration: 0.4 }}
                                    className={`rounded-xl p-3.5 transition-all ${
                                        allComplete
                                            ? 'bg-gradient-to-r from-[#FFF8EC] to-[#FFF4E0] border border-[#F5A623]/40'
                                            : 'bg-[#FAFBFC] border border-[#E6E8EC] opacity-70'
                                    }`}
                                >
                                    <div className="flex items-baseline justify-between gap-2">
                                        <p className={`text-[10px] uppercase tracking-[0.08em] font-semibold ${allComplete ? 'text-[#92591E]' : 'text-[#8B92A0]'}`}>
                                            {allComplete ? "Day complete" : "End of day"}
                                        </p>
                                        <span className={`text-[12px] font-bold tabular-nums ${allComplete ? 'text-[#92591E]' : 'text-[#8B92A0]'}`}>
                                            {allComplete
                                                ? `+${fmt(maxStopBonusPence(PACK))} earned`
                                                : `up to +${fmt(maxStopBonusPence(PACK))}`}
                                        </span>
                                    </div>
                                    <p className={`text-[14px] font-semibold mt-0.5 leading-tight ${allComplete ? 'text-[#0E1116]' : 'text-[#5C6470]'}`}>
                                        {allComplete ? "🏆 All stops done" : "Finish the day"}
                                    </p>
                                    <p className={`text-[12px] mt-1 leading-relaxed ${allComplete ? 'text-[#92591E]' : 'text-[#8B92A0]'}`}>
                                        {allComplete
                                            ? `All ${PACK.jobs.length} stops complete — full bonus added to your day's pay.`
                                            : `Tick each stop above as you finish to bank +${fmt(PACK.bonusPerAdditionalStopPence)} per stop after the first.`}
                                    </p>
                                </motion.div>
                            </li>
                        </ol>
                    </div>
                </motion.div>

                {/* ───── PAY PROTECTION (collapsed by default for existing contractors) ───── */}
                <motion.div {...fadeInUp}>
                    <details className="group bg-white rounded-2xl border border-[#E6E8EC] overflow-hidden">
                        <summary className="flex items-center gap-3 p-4 cursor-pointer hover:bg-[#FAFBFC] transition-colors list-none [&::-webkit-details-marker]:hidden">
                            <div className="w-8 h-8 rounded-lg bg-[#3B7A3F]/10 flex items-center justify-center shrink-0">
                                <ShieldCheck className="h-4 w-4 text-[#3B7A3F]" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-semibold text-[#0E1116] leading-tight">
                                    Pay protection · 6 guarantees
                                </p>
                                <p className="text-[11px] text-[#8B92A0] mt-0.5">
                                    Day-rate floor · uplifts · call-outs · cancellations · materials · 48h pay
                                </p>
                            </div>
                            <ChevronDown className="h-4 w-4 text-[#8B92A0] shrink-0 transition-transform group-open:rotate-180" />
                        </summary>
                        <div className="px-4 pb-4 pt-0 space-y-2 border-t border-[#E6E8EC]">
                            {[
                                { label: "Day-rate guarantee", detail: `${fmt(PACK.dayRatePence)} guaranteed even if jobs cancel` },
                                { label: "Mis-scope auto-uplift", detail: "If a job runs over our estimate, we pay extra" },
                                { label: "Call-out fee", detail: "£45 if customer's not home or you can't start" },
                                { label: "Cancellation comp", detail: "Comp if customer cancels last-minute" },
                                { label: "Materials reimbursement", detail: "Receipt + 10% handling" },
                                { label: "48h pay", detail: "Money in your account 2 days after completion" },
                            ].map((g, i) => (
                                <div key={i} className="flex items-start gap-2 pt-2">
                                    <Check className="h-3.5 w-3.5 text-[#3B7A3F] stroke-[3] shrink-0 mt-1" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[12px] font-semibold text-[#0E1116] leading-tight">{g.label}</p>
                                        <p className="text-[11px] text-[#5C6470] leading-relaxed mt-0.5">{g.detail}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </details>
                </motion.div>

                {/* ───── FOOTER ───── */}
                <motion.div {...fadeInUp} className="text-center pt-1">
                    <p className="text-[10px] text-[#8B92A0] uppercase tracking-[0.12em]">
                        Handy Services · Day-Pack Preview
                    </p>
                </motion.div>
            </main>

            {/* ───── STICKY CTA ───── */}
            {!decided && (
                <div
                    className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#E6E8EC] bg-white/95 backdrop-blur-md"
                    style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
                >
                    <div className="max-w-[680px] mx-auto px-4 pt-3 pb-3">
                        <div className="flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                                <p className="text-[10px] uppercase tracking-[0.08em] font-semibold text-[#8B92A0] leading-none">
                                    {completedCount > 0 ? `Earnings · ${completedCount}/${totalStops} stops` : 'Day rate'}
                                </p>
                                <p className="text-[20px] font-semibold tabular-nums text-[#0E1116] leading-tight mt-0.5">
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
                                        <span className="text-[12px] text-[#3B7A3F] font-semibold ml-1">+ bonuses</span>
                                    )}
                                </p>
                            </div>
                            <button
                                onClick={() => setDecided('declined')}
                                className="px-4 py-3 min-h-[44px] rounded-xl font-semibold text-[14px] text-[#5C6470] hover:text-[#0E1116] hover:bg-[#F1F3F6] transition-colors"
                            >
                                Pass
                            </button>
                            <button
                                onClick={() => setDecided('accepted')}
                                className="px-5 py-3 min-h-[44px] rounded-xl font-semibold text-[14px] bg-[#3B7A3F] hover:bg-[#2F6133] text-white transition-all active:scale-[0.97] shadow-md shadow-[#3B7A3F]/20 inline-flex items-center gap-2"
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
                        className="fixed inset-0 z-[60] bg-[#0E1116]/40 backdrop-blur-sm flex items-center justify-center p-4"
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
                                        ? `In production, all ${PACK.jobs.length} jobs would lock to you and customers would be notified.`
                                        : "In production, the day-pack would dissolve and jobs return to single-offer routing."}
                                </p>
                            </div>
                            <button
                                onClick={() => setDecided(null)}
                                className="text-[13px] text-[#5C6470] hover:text-[#0E1116] underline min-h-[44px]"
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
