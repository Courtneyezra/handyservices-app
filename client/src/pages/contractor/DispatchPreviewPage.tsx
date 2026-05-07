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
    Check, X, AlertCircle, MapPin, Hammer, Package, Calendar,
    Star, Trophy, Truck, ShieldCheck, Clock, ExternalLink, Sparkles,
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
    // Bonuses on top
    completionBonusPence: number;
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
    completionBonusPence: 2500,
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

// Compute potential max earnings: day rate + completion + max 5★ reviews
function computeMaxPotential(p: DayPack): number {
    return p.dayRatePence
        + p.completionBonusPence
        + (p.fiveStarBonusPerReviewPence * p.maxFiveStarReviews);
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

    const maxPotential = computeMaxPotential(PACK);
    const mapEmbedUrl = buildMapEmbedUrl(PACK);
    const mapDeepLink = buildMapDeepLink(PACK);

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

                            {/* Day-rate floor + day framing */}
                            <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-white/85">
                                <span className="inline-flex items-center gap-2">
                                    <ShieldCheck className="h-4 w-4 text-[#7DB00E]" />
                                    {fmt(PACK.dayRatePence)} guaranteed
                                </span>
                                <span className="inline-flex items-center gap-2">
                                    <Calendar className="h-4 w-4 text-[#F5A623]" /> Estimated full day
                                </span>
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* ───── BONUSES — what you can earn on top ───── */}
                <motion.div {...fadeInUp}>
                    <div className="flex items-baseline justify-between mb-2.5">
                        <h2 className="text-[11px] uppercase tracking-[0.1em] font-semibold text-[#5C6470]">
                            Bonuses available
                        </h2>
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#3B7A3F] tabular-nums">
                            <Sparkles className="h-3 w-3" />
                            up to {fmt(maxPotential)}
                        </span>
                    </div>
                    <div className="bg-white rounded-2xl border border-[#E6E8EC] divide-y divide-[#E6E8EC] overflow-hidden">

                        {/* Multi-job completion */}
                        <div className="flex items-start gap-3 p-4">
                            <div className="w-10 h-10 rounded-xl bg-[#F5A623]/10 flex items-center justify-center shrink-0">
                                <Trophy className="h-5 w-5 text-[#F5A623]" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-[14px] font-semibold text-[#0E1116] leading-tight">
                                    Multi-job completion
                                </p>
                                <p className="text-[12px] text-[#5C6470] leading-relaxed mt-1">
                                    Complete all {PACK.jobs.length} jobs by end of day — bonus unlocks at sign-off
                                </p>
                            </div>
                            <span className="text-[14px] font-semibold tabular-nums text-[#F5A623] shrink-0 ml-1">
                                +{fmt(PACK.completionBonusPence)}
                            </span>
                        </div>

                        {/* 5★ review */}
                        <div className="flex items-start gap-3 p-4">
                            <div className="w-10 h-10 rounded-xl bg-[#3B7A3F]/10 flex items-center justify-center shrink-0">
                                <Star className="h-5 w-5 text-[#3B7A3F] fill-[#3B7A3F]" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-[14px] font-semibold text-[#0E1116] leading-tight">
                                    5★ review bonus
                                </p>
                                <p className="text-[12px] text-[#5C6470] leading-relaxed mt-1">
                                    +{fmt(PACK.fiveStarBonusPerReviewPence)} per Google review · up to {PACK.maxFiveStarReviews} = +{fmt(PACK.fiveStarBonusPerReviewPence * PACK.maxFiveStarReviews)}
                                </p>
                            </div>
                            <span className="text-[14px] font-semibold tabular-nums text-[#3B7A3F] shrink-0 ml-1">
                                +{fmt(PACK.fiveStarBonusPerReviewPence)} ea
                            </span>
                        </div>
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
                                return (
                                    <li key={job.num} className="relative pl-8 pb-5 last:pb-3">
                                        {/* Vertical line behind dot */}
                                        {!isLast && (
                                            <span
                                                className="absolute left-[11px] top-4 bottom-0 w-px bg-[#E6E8EC]"
                                                aria-hidden
                                            />
                                        )}
                                        {/* Dot */}
                                        <span
                                            className={`absolute left-0 top-1 w-[22px] h-[22px] rounded-full bg-white border-2 border-[#0E1116] flex items-center justify-center text-[10px] font-bold tabular-nums`}
                                        >
                                            {job.num}
                                        </span>

                                        <div className="flex items-baseline justify-between gap-3">
                                            <p className="text-[10px] uppercase tracking-[0.08em] font-semibold text-[#8B92A0]">
                                                Stop {job.num}
                                            </p>
                                            <span className={`w-1.5 h-1.5 rounded-full ${tierDot(job.tier)}`} />
                                        </div>
                                        <p className="text-[15px] font-semibold text-[#0E1116] mt-0.5 leading-tight">
                                            {job.title}
                                        </p>
                                        <p className="text-[12px] text-[#5C6470] mt-1">
                                            {job.postcode} · #{job.slug}
                                        </p>
                                        {job.description && (
                                            <p className="text-[12px] text-[#8B92A0] mt-1.5 leading-relaxed">
                                                {job.description}
                                            </p>
                                        )}
                                        {job.materials && job.materials.length > 0 && (
                                            <div className="flex flex-wrap gap-1.5 mt-2">
                                                {job.materials.map((m, i) => (
                                                    <span key={i} className="text-[11px] bg-[#F1F3F6] text-[#5C6470] px-2 py-0.5 rounded-md">
                                                        {m}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </li>
                                );
                            })}

                            {/* ───── BONUS UNLOCK NODE — end of day ───── */}
                            <li className="relative pl-8">
                                <span
                                    className="absolute left-0 top-1 w-[22px] h-[22px] rounded-full bg-gradient-to-br from-[#F5A623] to-[#F2871E] border-2 border-[#F5A623] flex items-center justify-center shadow-md shadow-[#F5A623]/30"
                                    aria-hidden
                                >
                                    <Trophy className="h-3 w-3 text-white" />
                                </span>
                                <div className="bg-gradient-to-r from-[#FFF8EC] to-[#FFF4E0] border border-[#F5A623]/30 rounded-xl p-3.5">
                                    <div className="flex items-baseline justify-between gap-2">
                                        <p className="text-[10px] uppercase tracking-[0.08em] font-semibold text-[#92591E]">
                                            End of day
                                        </p>
                                        <span className="text-[12px] font-bold tabular-nums text-[#92591E]">
                                            +{fmt(PACK.completionBonusPence)} unlocked
                                        </span>
                                    </div>
                                    <p className="text-[14px] font-semibold text-[#0E1116] mt-0.5 leading-tight">
                                        Day complete
                                    </p>
                                    <p className="text-[12px] text-[#92591E] mt-1 leading-relaxed">
                                        All {PACK.jobs.length} stops done — completion bonus added to your day's pay.
                                    </p>
                                </div>
                            </li>
                        </ol>
                    </div>
                </motion.div>

                {/* ───── PAY PROTECTION ───── */}
                <motion.div {...fadeInUp}>
                    <h2 className="text-[11px] uppercase tracking-[0.1em] font-semibold text-[#5C6470] mb-2.5">
                        Pay protection · we cover you
                    </h2>
                    <div className="bg-white rounded-2xl border border-[#E6E8EC] p-4 sm:p-5 space-y-3">
                        {[
                            { label: "Day-rate guarantee", detail: `${fmt(PACK.dayRatePence)} for the day, even if jobs cancel` },
                            { label: "Mis-scope auto-uplift", detail: "If a job runs over our estimate, we pay the extra time" },
                            { label: "Call-out fee", detail: "£45 if a customer's not home or you can't start" },
                            { label: "Cancellation comp", detail: "Comp if customer cancels last-minute" },
                            { label: "Materials reimbursement", detail: "Receipt + 10% handling for anything we missed" },
                            { label: "48h pay", detail: "Money in your account 2 days after completion" },
                        ].map((g, i) => (
                            <div key={i} className="flex items-start gap-3">
                                <div className="w-5 h-5 rounded-full bg-[#3B7A3F]/10 flex items-center justify-center shrink-0 mt-0.5">
                                    <Check className="h-3 w-3 text-[#3B7A3F] stroke-[3]" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[13px] font-semibold text-[#0E1116] leading-tight">{g.label}</p>
                                    <p className="text-[12px] text-[#5C6470] leading-relaxed mt-0.5">{g.detail}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </motion.div>

                {/* ───── HOW IT WORKS ───── */}
                <motion.div {...fadeInUp}>
                    <h2 className="text-[11px] uppercase tracking-[0.1em] font-semibold text-[#5C6470] mb-2.5">How this works</h2>
                    <div className="bg-white rounded-2xl border border-[#E6E8EC] p-4 sm:p-5">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                            {[
                                { icon: Calendar, label: "Accept the day", num: 1 },
                                { icon: Hammer, label: "Work through the timeline", num: 2 },
                                { icon: Trophy, label: "Complete + photos = bonus", num: 3 },
                                { icon: Star, label: "Pay in 48h", num: 4 },
                            ].map(({ icon: Icon, label, num }) => (
                                <div key={num} className="text-center">
                                    <div className="relative mx-auto w-12 h-12 rounded-xl bg-[#3B7A3F]/[0.08] flex items-center justify-center mb-2">
                                        <Icon className="h-5 w-5 text-[#3B7A3F]" />
                                        <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#3B7A3F] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                                            {num}
                                        </span>
                                    </div>
                                    <p className="text-[12px] font-medium text-[#0E1116] leading-tight">{label}</p>
                                </div>
                            ))}
                        </div>
                        <p className="text-[11px] text-[#8B92A0] text-center mt-4 italic">
                            One offer · {PACK.jobs.length} jobs · one good day's work.
                        </p>
                    </div>
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
                                <p className="text-[10px] uppercase tracking-[0.08em] font-semibold text-[#8B92A0] leading-none">Day rate</p>
                                <p className="text-[20px] font-semibold tabular-nums text-[#0E1116] leading-tight mt-0.5">
                                    {fmt(PACK.dayRatePence)}
                                    <span className="text-[12px] text-[#3B7A3F] font-semibold ml-1">+ bonuses</span>
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
