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
// Seed data — the 4 quotes given to the contractor today
//
// NOTE: Live quote URLs (handyservices.app/quote-link/...) are 403-gated
// against non-browser fetches; values are plausibly seeded based on the slugs.
// Swap PACK out for a useQuery later — page renders straight from this.
// ───────────────────────────────────────────────────────────────────────────

const PACK: DayPack = {
    packRef: "DP-MAR-FRI",
    date: "2026-05-08",
    contractorName: "Mark",
    area: "Nottingham · NG7 area",
    // Hardcoded £200 for the test page — real day rate is computed by the
    // hidden engine (rev-share + floor + segment) at routing time.
    dayRatePence: 20000,
    completionBonusPence: 2500,
    fiveStarBonusPerReviewPence: 1000,
    maxFiveStarReviews: 4,
    totalWorkHours: 6.0,
    totalTravelMinutes: 24,
    totalDistanceMiles: 6.2,
    jobs: [
        {
            num: 1,
            slug: "zw2eqimg",
            title: "Replace kitchen tap",
            postcode: "NG7 2RD",
            startTime: "09:00",
            endTime: "10:00",
            durationHours: 1.0,
            tier: "skilled",
            category: "plumbing",
            description: "Single mixer tap replacement, customer-supplied tap. Standard isolation valves in place.",
            materials: ["Sealant", "Plumbing tape", "Flexi connectors"],
            travelMinutesToNext: 7,
            coords: { lat: 52.9510, lng: -1.1828 },
        },
        {
            num: 2,
            slug: "py8jrvxz",
            title: "Hang 2 internal doors",
            postcode: "NG7 5BX",
            startTime: "10:15",
            endTime: "12:45",
            durationHours: 2.5,
            tier: "skilled",
            category: "carpentry",
            description: "Two pre-hung internal doors, frames already in place. Includes hinge fitting and handle install.",
            materials: ["Hinges", "Door handles", "Latches"],
            travelMinutesToNext: 5,
            coords: { lat: 52.9456, lng: -1.1872 },
        },
        {
            num: 3,
            slug: "nkno7s07",
            title: "Tile bathroom splash-back",
            postcode: "NG7 9PA",
            startTime: "13:30",
            endTime: "15:30",
            durationHours: 2.0,
            tier: "skilled",
            category: "tiling",
            description: "Splash-back tile install over basin. Approx 1.5 sq m. Tiles supplied by customer.",
            materials: ["Adhesive", "Grout", "Spacers"],
            travelMinutesToNext: 12,
            coords: { lat: 52.9387, lng: -1.1966 },
        },
        {
            num: 4,
            slug: "9fitx3o1",
            title: "Replace handle, lock and latch on door",
            postcode: "NG7 1AB",
            startTime: "15:50",
            endTime: "16:20",
            durationHours: 0.5,
            tier: "general",
            category: "joinery",
            description: "Replace handle, lock and latch on existing door — single line item.",
            materials: ["Lock set", "Strike plate"],
            travelMinutesToNext: 0,
            coords: { lat: 52.9533, lng: -1.1739 },
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
// Falls back to plain map URL (no directions) if API key is missing.
function buildMapEmbedUrl(p: DayPack): string {
    const key = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY;
    const points = p.jobs.map(j => encodeURIComponent(j.postcode));
    if (key && points.length >= 2) {
        const origin = points[0];
        const destination = points[points.length - 1];
        const waypoints = points.slice(1, -1).join("|");
        return `https://www.google.com/maps/embed/v1/directions?key=${key}&origin=${origin}&destination=${destination}${waypoints ? `&waypoints=${waypoints}` : ""}&mode=driving&zoom=13`;
    }
    // Fallback: centered map on first job, no directions.
    const c = p.jobs[0].coords;
    return `https://www.google.com/maps?q=${c.lat},${c.lng}&z=13&output=embed`;
}

// Open-in-Maps deep link — no API key needed.
function buildMapDeepLink(p: DayPack): string {
    const points = p.jobs.map(j => encodeURIComponent(j.postcode)).join("/");
    return `https://www.google.com/maps/dir/${points}/`;
}

// ───────────────────────────────────────────────────────────────────────────
// Page
// ───────────────────────────────────────────────────────────────────────────

export default function DispatchPreviewPage() {
    const [decided, setDecided] = useState<'accepted' | 'declined' | null>(null);

    const maxPotential = computeMaxPotential(PACK);
    const mapEmbedUrl = buildMapEmbedUrl(PACK);
    const mapDeepLink = buildMapDeepLink(PACK);
    const lastJob = PACK.jobs[PACK.jobs.length - 1];
    const dayEndTime = lastJob.endTime;

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
                                {PACK.jobs.length} jobs · ~{PACK.totalWorkHours}h · {PACK.area.split('·')[1]?.trim() || PACK.area}
                            </p>

                            {/* Materials supplied */}
                            <p className="mt-4 inline-flex items-center gap-2 text-[14px] sm:text-[15px] font-semibold text-[#7DB00E]">
                                <Package className="h-4 w-4 sm:h-[18px] sm:w-[18px]" /> Materials supplied by Handy
                            </p>

                            {/* Day-rate floor + meta row */}
                            <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-white/85">
                                <span className="inline-flex items-center gap-2">
                                    <ShieldCheck className="h-4 w-4 text-[#7DB00E]" />
                                    {fmt(PACK.dayRatePence)} guaranteed
                                </span>
                                <span className="inline-flex items-center gap-2">
                                    <Truck className="h-4 w-4 text-[#F5A623]" /> ~{PACK.totalTravelMinutes} min travel
                                </span>
                                <span className="inline-flex items-center gap-2">
                                    <Clock className="h-4 w-4 text-[#F5A623]" /> {PACK.jobs[0].startTime}–{dayEndTime}
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
                                <Truck className="h-4 w-4 text-[#8B92A0] shrink-0" />
                                <span className="truncate tabular-nums">
                                    ~{PACK.totalDistanceMiles} mi · ~{PACK.totalTravelMinutes} min driving
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
                            Your day · timeline
                        </h2>
                        <span className="text-[11px] text-[#8B92A0] tabular-nums">
                            {PACK.jobs.length} stops · ~{PACK.totalWorkHours}h work
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
                                            <p className="text-[12px] font-mono text-[#5C6470] tabular-nums font-semibold">
                                                {job.startTime}
                                            </p>
                                            <span className={`w-1.5 h-1.5 rounded-full ${tierDot(job.tier)}`} />
                                        </div>
                                        <p className="text-[15px] font-semibold text-[#0E1116] mt-0.5 leading-tight">
                                            {job.title}
                                        </p>
                                        <p className="text-[12px] text-[#5C6470] mt-1">
                                            {job.postcode} · {job.durationHours}h · #{job.slug}
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

                                        {/* Travel marker */}
                                        {!isLast && job.travelMinutesToNext ? (
                                            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[#8B92A0] uppercase tracking-[0.06em] font-semibold">
                                                <Truck className="h-3 w-3" />
                                                ~{job.travelMinutesToNext} min drive
                                            </div>
                                        ) : null}
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
                                        <p className="text-[12px] font-mono text-[#92591E] tabular-nums font-semibold">
                                            ~{dayEndTime}
                                        </p>
                                        <span className="text-[12px] font-bold tabular-nums text-[#92591E]">
                                            +{fmt(PACK.completionBonusPence)} unlocked
                                        </span>
                                    </div>
                                    <p className="text-[14px] font-semibold text-[#0E1116] mt-0.5 leading-tight">
                                        Day complete
                                    </p>
                                    <p className="text-[12px] text-[#92591E] mt-1 leading-relaxed">
                                        All {PACK.jobs.length} jobs done — completion bonus added to your day's pay.
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
