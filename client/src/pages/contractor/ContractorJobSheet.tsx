/**
 * Contractor Job Sheet — Tokenised contractor-facing page (light-mode rebuild).
 *
 * URL: /contractor-job/:token
 *
 * Design: "Premium Operator" — light page (#F7F8FA), white content cards,
 * one dark hero slab (#0E1116) with gold price as the dramatic anchor.
 * Mini collapsible task accordion + sticky bottom CTA that morphs through
 * the prereq ladder (warnings → bond → accept).
 *
 * Privacy gating:
 *   pre-accept  → postcode + first name only
 *   post-accept → full address + phone + day-of action buttons
 *   locked-out  → "Job already taken" splash
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useRef, useEffect, useMemo } from "react";
import {
    Check, X, AlertCircle, MessageCircle, ChevronDown, ShieldCheck, MapPin,
    Phone, Camera, Loader2, FileWarning, CheckCircle2, Lock, CreditCard,
    Play, ImageIcon, Maximize2, Package, Clock, Zap, Droplet, ArrowUpFromLine,
} from "lucide-react";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { getStripe, isStripeConfigured } from "@/lib/stripe";

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

interface Task {
    num: number;
    title: string;
    tier: string;
    category?: string;
    hours: number;
    payPence: number;
    payMethod: "floor" | "share";
    description: string;
    warning?: string;
    materials: string[];
    mediaUrls?: string[];
}

interface JobSheetData {
    link: {
        id: string;
        token: string;
        contractorName: string;
        status: "pending" | "viewed" | "accepted" | "declined" | "questioning" | "locked_taken";
        warningsAcknowledged: { taskNum: number; warningText: string; ackedAt: string }[];
        responseMessage: string | null;
        acceptedAt: string | null;
        declinedAt: string | null;
    };
    dispatch: {
        id: string;
        shortRef: string;
        title: string;
        subtitle: string | null;
        postcode: string;
        customerFirstName: string;
        customerFullName: string | null;
        customerPhone: string | null;
        customerAddress: string | null;
        tasks: Task[];
        totalHours: number;
        totalContractorPayPence: number;
        status: string;
        scheduledDate: string | null;
        bondRequired: boolean;
        bondAmountPence: number | null;
        mediaUrls: string[];
        proposalSummary: string | null;
        preferredDates: { date: string; timeSlot: 'am' | 'pm' | 'full_day' | 'flexible' }[] | null;
    };
    bond: {
        id: string;
        amountPence: number;
        status: "pending" | "held" | "refunded" | "forfeited" | "failed";
        paidAt: string | null;
        refundedAt: string | null;
        refundReason: string | null;
    } | null;
    broadcastCount: number;
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

// We don't charge pence on contractor-facing displays — round to whole pound.
// Underlying pence values are kept in the DB for accounting accuracy.
function fmt(p: number): string {
    return `£${Math.round(p / 100)}`;
}

function fmtCompact(p: number): string {
    return fmt(p);
}

function fmtDate(iso: string | null): string {
    if (!iso) return "TBC";
    return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function fmtDatePlus(iso: string | null, daysAfter: number): string {
    if (!iso) return "TBC";
    const d = new Date(iso);
    d.setDate(d.getDate() + daysAfter);
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function shortJobLabel(subtitle: string | null, title: string): string {
    const area = subtitle?.split(",")[0]?.trim() || "";
    let t = (title || "").replace(/[—:·]/g, " ").replace(/\s+/g, " ").trim();
    if (t.length > 28) {
        const cut = t.lastIndexOf(" ", 28);
        t = t.slice(0, cut > 0 ? cut : 28).trim();
    }
    return area ? `${area} · ${t}` : t;
}

function tierDot(tier: string): string {
    switch (tier) {
        case "specialist": return "bg-indigo-500";
        case "skilled": return "bg-teal-500";
        case "outdoor": return "bg-amber-500";
        default: return "bg-slate-400";
    }
}

function tierLabel(tier: string): string {
    return tier.charAt(0).toUpperCase() + tier.slice(1);
}

// "Tue 28 Apr · AM" — compact preferred-date chip label
function fmtPreferredDate(d: { date: string; timeSlot: string }): string {
    const dt = new Date(d.date);
    const day = dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    const slot = d.timeSlot === "am" ? "AM" : d.timeSlot === "pm" ? "PM" : d.timeSlot === "full_day" ? "Full day" : "Flex";
    return `${day} · ${slot}`;
}

// Count tasks per tier and return ordered chips
function skillMix(tasks: Task[]): Array<{ tier: string; count: number }> {
    const order = ["specialist", "skilled", "general", "outdoor"];
    const counts: Record<string, number> = {};
    for (const t of tasks) counts[t.tier] = (counts[t.tier] || 0) + 1;
    return order.filter((k) => counts[k]).map((k) => ({ tier: k, count: counts[k] }));
}

// Convert hours into a contractor-friendly band — replaces raw hours figure.
function durationBand(totalHours: number): string {
    if (totalHours <= 4) return "Half day";
    if (totalHours <= 8) return "Single visit";
    if (totalHours <= 16) return "1–2 days";
    if (totalHours <= 24) return "2–3 days";
    return "Multi-day";
}

// Auto-detect risk flags from task warning text
function riskFlags(tasks: Task[]): Array<{ key: string; label: string; icon: any }> {
    const allText = tasks.map((t) => `${t.warning || ""} ${t.description || ""} ${t.title}`).join(" ").toLowerCase();
    const flags: Array<{ key: string; label: string; icon: any }> = [];
    if (/\b(isolate at consumer unit|wiring|electrical|part p|circuit)\b/.test(allText)) flags.push({ key: "elec", label: "Electrical", icon: Zap });
    if (/\b(isolate water|tap|pipework|plumbing|leak)\b/.test(allText)) flags.push({ key: "plumb", label: "Plumbing", icon: Droplet });
    if (/\b(height|ladder|tower|roof|gutter|scaffold)\b/.test(allText)) flags.push({ key: "height", label: "Working at height", icon: ArrowUpFromLine });
    return flags;
}

async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(file);
    });
}

function isVideo(url: string): boolean {
    return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
}

const fadeInUp = {
    initial: { opacity: 0, y: 8 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
    transition: { duration: 0.35 },
};

// ───────────────────────────────────────────────────────────────────────────
// Main component
// ───────────────────────────────────────────────────────────────────────────

export default function ContractorJobSheet() {
    const { token } = useParams<{ token: string }>();
    const queryClient = useQueryClient();

    const { data, isLoading, isError, refetch } = useQuery<JobSheetData>({
        queryKey: ["contractor-job", token],
        queryFn: () => fetch(`/api/contractor-job/${token}`).then((r) => {
            if (!r.ok) throw new Error("not found");
            return r.json();
        }),
        enabled: !!token,
        retry: false,
    });

    // ─── UI state ──────────────────────────────────────────────────────────
    const [expandedTaskNum, setExpandedTaskNum] = useState<number | null>(null);
    const [questionText, setQuestionText] = useState("");
    const [declineReason, setDeclineReason] = useState("");
    const [showDeclineModal, setShowDeclineModal] = useState(false);
    const [showVariationModal, setShowVariationModal] = useState(false);
    const [showCompletionModal, setShowCompletionModal] = useState(false);
    const [showBondSheet, setShowBondSheet] = useState(false);
    const [variationDesc, setVariationDesc] = useState("");
    const [variationReason, setVariationReason] = useState("");
    const [variationExtra, setVariationExtra] = useState("");
    const [variationPhotos, setVariationPhotos] = useState<File[]>([]);
    const [completionPhotos, setCompletionPhotos] = useState<File[]>([]);
    const [completionNotes, setCompletionNotes] = useState("");
    const [actionResult, setActionResult] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

    const variationFileRef = useRef<HTMLInputElement>(null);
    const completionFileRef = useRef<HTMLInputElement>(null);
    const taskRefs = useRef<Record<number, HTMLDivElement | null>>({});

    // ─── Mutations ─────────────────────────────────────────────────────────
    const ackWarning = useMutation({
        mutationFn: async (args: { taskNum: number; warningText: string }) => {
            const r = await fetch(`/api/contractor-job/${token}/acknowledge-warning`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(args),
            });
            if (!r.ok) throw new Error((await r.json()).error || "ack failed");
            return r.json();
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["contractor-job", token] }),
    });

    const acceptJob = useMutation({
        mutationFn: async () => {
            const r = await fetch(`/api/contractor-job/${token}/accept`, { method: "POST" });
            const body = await r.json();
            if (!r.ok) throw new Error(body.error || "accept failed");
            return body;
        },
        onSuccess: () => {
            setActionResult({ kind: "ok", msg: "Job accepted. Customer details unlocked below." });
            refetch();
        },
        onError: (e: any) => setActionResult({ kind: "err", msg: e.message }),
    });

    const declineJob = useMutation({
        mutationFn: async (reason: string) => {
            const r = await fetch(`/api/contractor-job/${token}/decline`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reason }),
            });
            if (!r.ok) throw new Error("decline failed");
            return r.json();
        },
        onSuccess: () => {
            setActionResult({ kind: "ok", msg: "Declined. Thanks for letting us know." });
            setShowDeclineModal(false);
            refetch();
        },
    });

    const askQuestion = useMutation({
        mutationFn: async (question: string) => {
            const r = await fetch(`/api/contractor-job/${token}/question`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question }),
            });
            if (!r.ok) throw new Error("question failed");
            return r.json();
        },
        onSuccess: () => {
            setActionResult({ kind: "ok", msg: "Question sent — Ben will get back to you." });
            setQuestionText("");
            refetch();
        },
    });

    const reportVariation = useMutation({
        mutationFn: async (args: { description: string; reason: string; photos: string[]; additionalPricePence: number }) => {
            const r = await fetch(`/api/contractor-job/${token}/variation`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(args),
            });
            if (!r.ok) throw new Error("variation failed");
            return r.json();
        },
        onSuccess: () => {
            setActionResult({ kind: "ok", msg: "Variation reported. Ben has been notified." });
            setShowVariationModal(false);
            setVariationDesc(""); setVariationReason(""); setVariationExtra(""); setVariationPhotos([]);
        },
    });

    const completeJob = useMutation({
        mutationFn: async (args: { photos: string[]; notes: string }) => {
            const r = await fetch(`/api/contractor-job/${token}/complete`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(args),
            });
            if (!r.ok) throw new Error((await r.json()).error || "complete failed");
            return r.json();
        },
        onSuccess: () => {
            setActionResult({ kind: "ok", msg: "Job marked complete with photos. Thanks." });
            setShowCompletionModal(false);
            setCompletionPhotos([]); setCompletionNotes("");
            refetch();
        },
        onError: (e: any) => setActionResult({ kind: "err", msg: e.message }),
    });

    // ─── Loading / Error ──────────────────────────────────────────────────
    if (isLoading) {
        return (
            <div className="min-h-screen bg-[#F7F8FA] flex flex-col items-center justify-center gap-4">
                <div className="w-12 h-12 border-2 border-slate-300 border-t-[#3B7A3F] rounded-full animate-spin" />
                <p className="text-slate-500 text-sm">Loading job sheet...</p>
            </div>
        );
    }
    if (isError || !data) {
        return (
            <div className="min-h-screen bg-[#F7F8FA] flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl border border-[#E6E8EC] p-10 max-w-md text-center shadow-sm">
                    <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-5">
                        <AlertCircle className="h-7 w-7 text-red-500" />
                    </div>
                    <h1 className="text-xl font-semibold text-[#0E1116] mb-2">Job sheet not found</h1>
                    <p className="text-sm text-[#5C6470] leading-relaxed">This link may have expired. Reach out to Ben if you need help.</p>
                </div>
            </div>
        );
    }

    const { link, dispatch, bond, broadcastCount } = data;
    const isLockedTaken = link.status === "locked_taken";
    const isAccepted = link.status === "accepted";
    const isDeclined = link.status === "declined";
    const tasks = dispatch.tasks;
    const totalWarnings = tasks.filter((t) => t.warning).length;
    const ackedCount = (link.warningsAcknowledged || []).length;
    const allWarningsAcked = ackedCount >= totalWarnings;
    const bondHeld = bond?.status === "held";
    const bondNeeded = !!dispatch.bondRequired && !bondHeld;
    const isPostAcceptState = isAccepted;

    // ─── Locked-taken state ───────────────────────────────────────────────
    if (isLockedTaken) {
        return (
            <div className="min-h-screen bg-[#F7F8FA] flex items-center justify-center p-4">
                <motion.div
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-white rounded-2xl border border-[#E6E8EC] p-10 max-w-md text-center shadow-sm"
                >
                    <div className="w-14 h-14 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-5">
                        <Lock className="h-7 w-7 text-amber-600" />
                    </div>
                    <h1 className="text-xl font-semibold text-[#0E1116] mb-2">Job already taken</h1>
                    <p className="text-sm text-[#5C6470] leading-relaxed mb-4">
                        Sorry {link.contractorName} — another contractor accepted this first. We'll have another one for you soon.
                    </p>
                    <p className="text-xs text-[#8B92A0]">Ben — 07449 501 762</p>
                </motion.div>
            </div>
        );
    }

    // ─── Sticky CTA logic ─────────────────────────────────────────────────
    type CtaState =
        | { mode: "warnings"; remaining: number }
        | { mode: "bond"; amountPence: number }
        | { mode: "accept"; payPence: number }
        | { mode: "accepted" }
        | { mode: "declined" };

    const ctaState: CtaState = (() => {
        if (isAccepted) return { mode: "accepted" };
        if (isDeclined) return { mode: "declined" };
        if (!allWarningsAcked) return { mode: "warnings", remaining: totalWarnings - ackedCount };
        if (bondNeeded) return { mode: "bond", amountPence: dispatch.bondAmountPence || 0 };
        return { mode: "accept", payPence: dispatch.totalContractorPayPence };
    })();

    function ctaClick() {
        if (ctaState.mode === "warnings") {
            // Scroll to & expand the first un-acked warning task
            const next = tasks.find((t) => t.warning && !(link.warningsAcknowledged || []).some((a) => a.taskNum === t.num));
            if (next) {
                setExpandedTaskNum(next.num);
                setTimeout(() => taskRefs.current[next.num]?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
            }
        } else if (ctaState.mode === "bond") {
            setShowBondSheet(true);
        } else if (ctaState.mode === "accept") {
            acceptJob.mutate();
        }
    }

    const ctaDisabled = ctaState.mode === "accepted" || ctaState.mode === "declined" || acceptJob.isPending;

    function ctaLabel(): string {
        switch (ctaState.mode) {
            case "warnings": return `Tick ${ctaState.remaining} warning${ctaState.remaining > 1 ? "s" : ""}`;
            case "bond": return `Pay ${fmt(ctaState.amountPence)} bond`;
            case "accept": return acceptJob.isPending ? "Accepting…" : `Accept job — ${fmtCompact(ctaState.payPence)}`;
            case "accepted": return "Accepted";
            case "declined": return "Declined";
        }
    }

    // ─── Main render ──────────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-[#F7F8FA] font-sans text-[#0E1116] selection:bg-[#3B7A3F]/20 pb-28">
            {/* ─── Sticky header (light) ─── */}
            <header className="sticky top-0 z-30 bg-[#F7F8FA]/85 backdrop-blur-md border-b border-[#E6E8EC]">
                <div className="max-w-[680px] mx-auto px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <img src="/logo.png" alt="Handy" className="w-8 h-8 object-contain" />
                        <span className="font-semibold text-[15px] text-[#0E1116]">Handy</span>
                        <span className="text-[#8B92A0]">·</span>
                        <span className="text-[13px] text-[#5C6470]">{link.contractorName}</span>
                    </div>
                    <span className="text-[10px] uppercase tracking-[0.08em] font-semibold text-[#5C6470]">
                        Job ref <span className="text-[#0E1116]">#{dispatch.shortRef}</span>
                    </span>
                </div>
            </header>

            <main className="max-w-[680px] mx-auto px-4 py-6 space-y-6">

                {/* ─── Action result banner ─── */}
                <AnimatePresence>
                    {actionResult && (
                        <motion.div
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            className={`rounded-xl border p-3.5 flex items-start gap-2.5 ${actionResult.kind === "ok" ? "bg-[#3B7A3F]/[0.06] border-[#3B7A3F]/30" : "bg-red-50 border-red-200"}`}
                        >
                            {actionResult.kind === "ok"
                                ? <CheckCircle2 className="h-4 w-4 text-[#3B7A3F] shrink-0 mt-0.5" />
                                : <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />}
                            <p className={`text-sm flex-1 ${actionResult.kind === "ok" ? "text-[#1F4520]" : "text-red-700"}`}>{actionResult.msg}</p>
                            <button onClick={() => setActionResult(null)} className="text-[#8B92A0] hover:text-[#0E1116]">
                                <X className="h-4 w-4" />
                            </button>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* ─── Hero — contractor-focused: title, price, summary, dates, skills ─── */}
                <motion.div {...fadeInUp}>
                    <div className="rounded-2xl p-6 sm:p-7 shadow-[0_12px_40px_rgba(27,42,74,0.18)] relative overflow-hidden bg-gradient-to-br from-[#1B2A4A] via-[#152340] to-[#0E1933]">
                        <div className="absolute -top-24 -right-24 w-80 h-80 bg-[#F5A623]/15 rounded-full blur-3xl pointer-events-none" />
                        <div className="absolute -bottom-32 -left-20 w-72 h-72 bg-[#7DB00E]/10 rounded-full blur-3xl pointer-events-none" />

                        <div className="relative">
                            {/* Eyebrow: area · job ref */}
                            <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-white/55 mb-3">
                                {dispatch.subtitle?.split(",")[0]?.trim() || dispatch.postcode} · #{dispatch.shortRef}
                            </p>

                            {/* Big price anchor */}
                            <p className="text-5xl sm:text-6xl font-semibold text-[#F5A623] tabular-nums tracking-tight leading-none drop-shadow-[0_2px_12px_rgba(245,166,35,0.25)]">
                                {fmt(dispatch.totalContractorPayPence)}
                            </p>
                            <p className="text-[12px] uppercase tracking-[0.08em] text-white/65 mt-2 font-medium">
                                Net pay · {tasks.length} task{tasks.length !== 1 ? "s" : ""}
                            </p>

                            {/* Contractor-flavoured summary — replaces the customer-marketing title */}
                            {dispatch.proposalSummary && (
                                <p className="mt-5 text-[15px] sm:text-[16px] font-semibold leading-snug text-white">
                                    {dispatch.proposalSummary}
                                </p>
                            )}

                            {/* Signal chips — duration, skill mix, materials, bond, media */}
                            <div className="mt-4 flex flex-wrap gap-1.5 items-center">
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-white/[0.07] text-white/85 px-2.5 py-1 rounded-full border border-white/10">
                                    <Clock className="h-3 w-3" /> {durationBand(dispatch.totalHours)}
                                </span>
                                {skillMix(tasks).map((s) => (
                                    <span key={s.tier} className="inline-flex items-center gap-1 text-[11px] font-medium bg-white/[0.07] text-white/85 px-2.5 py-1 rounded-full border border-white/10">
                                        <span className={`w-1.5 h-1.5 rounded-full ${tierDot(s.tier)}`} />
                                        {s.count} {tierLabel(s.tier)}
                                    </span>
                                ))}
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-[#7DB00E]/15 text-[#7DB00E] px-2.5 py-1 rounded-full border border-[#7DB00E]/30">
                                    <Package className="h-3 w-3" /> Materials supplied
                                </span>
                                {dispatch.bondRequired && dispatch.bondAmountPence && (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-[#F5A623]/15 text-[#F5A623] px-2.5 py-1 rounded-full border border-[#F5A623]/30">
                                        <ShieldCheck className="h-3 w-3" /> {fmt(dispatch.bondAmountPence)} bond
                                    </span>
                                )}
                                {(() => {
                                    const totalPhotos = (dispatch.mediaUrls || []).filter((u) => !isVideo(u)).length
                                        + tasks.reduce((acc, t) => acc + (t.mediaUrls || []).filter((u) => !isVideo(u)).length, 0);
                                    const totalVideos = (dispatch.mediaUrls || []).filter((u) => isVideo(u)).length
                                        + tasks.reduce((acc, t) => acc + (t.mediaUrls || []).filter((u) => isVideo(u)).length, 0);
                                    if (totalPhotos === 0 && totalVideos === 0) return null;
                                    return (
                                        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium bg-white/[0.07] text-white/85 px-2.5 py-1 rounded-full border border-white/10">
                                            <ImageIcon className="h-3 w-3" />
                                            {totalPhotos > 0 && `${totalPhotos} photo${totalPhotos !== 1 ? "s" : ""}`}
                                            {totalPhotos > 0 && totalVideos > 0 && " · "}
                                            {totalVideos > 0 && `${totalVideos} video${totalVideos !== 1 ? "s" : ""}`}
                                        </span>
                                    );
                                })()}
                            </div>

                            {/* Risk flags — auto-derived */}
                            {(() => {
                                const flags = riskFlags(tasks);
                                if (flags.length === 0) return null;
                                return (
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        {flags.map((f) => {
                                            const Icon = f.icon;
                                            return (
                                                <span key={f.key} className="inline-flex items-center gap-1 text-[11px] font-medium bg-amber-500/15 text-amber-300 px-2.5 py-1 rounded-full border border-amber-400/30">
                                                    <Icon className="h-3 w-3" /> {f.label}
                                                </span>
                                            );
                                        })}
                                    </div>
                                );
                            })()}

                            {/* Preferred dates from customer */}
                            {dispatch.preferredDates && dispatch.preferredDates.length > 0 && (
                                <div className="mt-4 pt-4 border-t border-white/10">
                                    <p className="text-[10px] uppercase tracking-[0.08em] text-white/50 font-semibold mb-2">Customer prefers</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {dispatch.preferredDates.slice(0, 3).map((d, i) => (
                                            <span key={i} className="inline-flex items-center text-[12px] font-medium bg-white/10 text-white px-2.5 py-1 rounded-md tabular-nums">
                                                {fmtPreferredDate(d)}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Address row — privacy-gated */}
                            <div className="mt-4 pt-4 border-t border-white/10">
                                <div className="flex items-start gap-2 text-[14px]">
                                    <MapPin className="h-4 w-4 text-[#F5A623] shrink-0 mt-0.5" />
                                    <span className="text-white/85">
                                        {isPostAcceptState
                                            ? <>{dispatch.customerAddress || dispatch.postcode} · <a href={`tel:${dispatch.customerPhone}`} className="text-[#F5A623]">{dispatch.customerPhone}</a></>
                                            : <>
                                                <span className="inline-block bg-white/10 text-white px-2 py-0.5 rounded-md text-[12px] font-medium tabular-nums">{dispatch.postcode}</span>
                                                <span className="text-white/50 text-[12px] ml-2">full address unlocks on accept</span>
                                              </>
                                        }
                                    </span>
                                </div>
                            </div>

                            {!isAccepted && !isDeclined && broadcastCount > 1 && (
                                <p className="mt-4 text-[11px] text-white/45 italic">
                                    Sent to a few of our pool — first to confirm secures it.
                                </p>
                            )}
                        </div>
                    </div>
                </motion.div>

                {/* ─── Photos & video walkthrough — horizontal swipe carousel ─── */}
                {dispatch.mediaUrls && dispatch.mediaUrls.length > 0 && (() => {
                    const videoCount = dispatch.mediaUrls.filter(isVideo).length;
                    const photoCount = dispatch.mediaUrls.length - videoCount;
                    return (
                        <motion.div {...fadeInUp}>
                            <div className="flex items-baseline justify-between mb-2.5">
                                <SectionEyebrow>
                                    {videoCount > 0 && photoCount > 0 ? "Photos & videos" : videoCount > 0 ? "Video walkthrough" : "Photos"}
                                </SectionEyebrow>
                                <span className="text-[11px] text-[#8B92A0] tabular-nums">
                                    {photoCount > 0 && `${photoCount} photo${photoCount !== 1 ? "s" : ""}`}
                                    {photoCount > 0 && videoCount > 0 && " · "}
                                    {videoCount > 0 && `${videoCount} video${videoCount !== 1 ? "s" : ""}`}
                                </span>
                            </div>
                            <PhotoCarousel urls={dispatch.mediaUrls} onClick={setLightboxUrl} />
                        </motion.div>
                    );
                })()}

                {/* ─── Scope of work — accordion of mini rows ─── */}
                <motion.div {...fadeInUp}>
                    <div className="flex items-baseline justify-between mb-3">
                        <SectionEyebrow>Scope of work</SectionEyebrow>
                        {totalWarnings > 0 && (
                            <span className="text-[11px] text-[#5C6470] font-medium">
                                {ackedCount}/{totalWarnings} warnings ack'd
                            </span>
                        )}
                    </div>

                    <div className="bg-white rounded-2xl border border-[#E6E8EC] divide-y divide-[#E6E8EC] overflow-hidden">
                        {tasks.map((t) => {
                            const isOpen = expandedTaskNum === t.num;
                            const isAcked = (link.warningsAcknowledged || []).some((a) => a.taskNum === t.num);
                            const hasWarning = !!t.warning;
                            return (
                                <div key={t.num} ref={(el) => { taskRefs.current[t.num] = el; }}>
                                    {/* Closed row — always visible, mini */}
                                    <button
                                        onClick={() => setExpandedTaskNum(isOpen ? null : t.num)}
                                        className="w-full px-4 py-3.5 flex items-center gap-3 hover:bg-[#F1F3F6] transition-colors text-left"
                                    >
                                        <span className={`w-2 h-2 rounded-full ${tierDot(t.tier)} shrink-0`} aria-label={tierLabel(t.tier)} />
                                        <span className="text-[13px] font-mono text-[#8B92A0] shrink-0 w-5 tabular-nums">{t.num}.</span>
                                        <span className="text-[14px] font-medium text-[#0E1116] flex-1 truncate">{t.title}</span>
                                        {hasWarning && (
                                            <span className={`shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full ${isAcked ? "bg-[#3B7A3F]/10 text-[#3B7A3F]" : "bg-amber-100 text-amber-700"}`} title={isAcked ? "Acknowledged" : "Warning unread"}>
                                                {isAcked ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                                            </span>
                                        )}
                                        <span className="text-[14px] font-semibold tabular-nums text-[#0E1116] shrink-0 w-[64px] text-right">{fmt(t.payPence)}</span>
                                        <ChevronDown className={`h-4 w-4 text-[#8B92A0] shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                                    </button>

                                    {/* Expanded panel */}
                                    <AnimatePresence initial={false}>
                                        {isOpen && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: "auto", opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: 0.22, ease: "easeOut" }}
                                                className="overflow-hidden"
                                            >
                                                <div className="px-4 pb-5 pt-2 space-y-3.5 bg-[#FAFBFC]">
                                                    <div className="flex items-center gap-2 flex-wrap text-[11px] uppercase tracking-[0.08em] text-[#8B92A0] font-semibold">
                                                        <span className={`w-1.5 h-1.5 rounded-full ${tierDot(t.tier)}`} />
                                                        {tierLabel(t.tier)}
                                                        {t.category && (
                                                            <span className="bg-[#F1F3F6] text-[#5C6470] px-1.5 py-0.5 rounded normal-case tracking-normal text-[11px] font-medium">
                                                                {t.category.replace(/_/g, " ")}
                                                            </span>
                                                        )}
                                                        <span className="text-[#8B92A0]">· {t.hours} hrs · {t.payMethod === "floor" ? "£/hr floor" : "rev share"}</span>
                                                    </div>
                                                    <p className="text-[14px] leading-relaxed text-[#5C6470]">{t.description}</p>

                                                    {hasWarning && (
                                                        <label className={`flex items-start gap-3 rounded-lg p-3.5 cursor-pointer transition-colors ${isAcked ? "bg-[#3B7A3F]/[0.06] border border-[#3B7A3F]/30" : "bg-amber-50 border border-amber-200 hover:bg-amber-100/70"}`}>
                                                            <input
                                                                type="checkbox"
                                                                checked={isAcked}
                                                                disabled={isAccepted || isDeclined}
                                                                onChange={() => !isAcked && ackWarning.mutate({ taskNum: t.num, warningText: t.warning! })}
                                                                className="mt-0.5 w-4 h-4 rounded accent-[#3B7A3F] cursor-pointer"
                                                            />
                                                            <div className="flex-1">
                                                                <p className={`text-[11px] font-semibold uppercase tracking-[0.08em] mb-1 flex items-center gap-1.5 ${isAcked ? "text-[#3B7A3F]" : "text-amber-700"}`}>
                                                                    {isAcked ? <><Check className="h-3 w-3" /> Acknowledged</> : <><AlertCircle className="h-3 w-3" /> On-site warning · tick to confirm read</>}
                                                                </p>
                                                                <p className="text-[13px] text-[#0E1116] leading-relaxed">{t.warning}</p>
                                                            </div>
                                                        </label>
                                                    )}

                                                    <div>
                                                        <p className="text-[11px] uppercase tracking-[0.08em] text-[#8B92A0] font-semibold mb-1.5">Materials supplied</p>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {t.materials.map((m, i) => (
                                                                <span key={i} className="text-[12px] bg-[#F1F3F6] text-[#5C6470] px-2 py-1 rounded-md">{m}</span>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    {t.mediaUrls && t.mediaUrls.length > 0 && (
                                                        <div>
                                                            <p className="text-[11px] uppercase tracking-[0.08em] text-[#8B92A0] font-semibold mb-1.5 flex items-center gap-1.5">
                                                                <ImageIcon className="h-3 w-3" /> Reference photos / video
                                                            </p>
                                                            <div className="grid grid-cols-4 gap-2">
                                                                {t.mediaUrls.map((u, i) => (
                                                                    <MediaThumb key={i} url={u} onClick={() => setLightboxUrl(u)} />
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            );
                        })}
                    </div>
                </motion.div>

                {/* ─── Bond timeline — number-only pre-accept ─── */}
                {dispatch.bondRequired && !isAccepted && !isDeclined && (
                    <motion.div {...fadeInUp}>
                        <SectionEyebrow>Security bond</SectionEyebrow>
                        <div className="bg-white rounded-2xl border border-[#E6E8EC] p-5">
                            <div className="flex items-baseline justify-between">
                                <p className="text-[14px] font-semibold text-[#0E1116]">
                                    {fmt(dispatch.bondAmountPence || 0)} returned when you tick complete
                                </p>
                                {bondHeld && (
                                    <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#3B7A3F] bg-[#3B7A3F]/10 px-2 py-0.5 rounded-md">
                                        Paid
                                    </span>
                                )}
                            </div>
                            <p className="text-[12px] text-[#5C6470] mt-1 leading-relaxed">
                                {Math.round(((dispatch.bondAmountPence || 0) / dispatch.totalContractorPayPence) * 100)}% of pay · held by Stripe (not us) · refunded same-day on completion
                            </p>
                            <BondTimeline
                                amountPence={dispatch.bondAmountPence || 0}
                                payPence={dispatch.totalContractorPayPence}
                                scheduledDate={dispatch.scheduledDate}
                            />
                        </div>
                    </motion.div>
                )}

                {/* ─── Post-accept day-of actions ─── */}
                {isAccepted && (
                    <motion.div {...fadeInUp}>
                        <SectionEyebrow>Day-of actions</SectionEyebrow>
                        <div className="bg-white rounded-2xl border border-[#E6E8EC] p-5 space-y-2.5">
                            <div className="flex items-center gap-2 mb-1">
                                <CheckCircle2 className="h-4 w-4 text-[#3B7A3F]" />
                                <p className="text-[14px] font-semibold text-[#0E1116]">You're on this job.</p>
                            </div>
                            <p className="text-[13px] text-[#5C6470] leading-relaxed">
                                Customer details unlocked above. Hit Variation if anything changes on-site, or Mark Complete with photos when done.
                            </p>
                            <div className="grid grid-cols-2 gap-2.5 pt-2">
                                <button
                                    onClick={() => setShowVariationModal(true)}
                                    className="flex items-center justify-center gap-2 py-2.5 px-3 bg-amber-50 hover:bg-amber-100 text-amber-700 font-medium text-[13px] rounded-lg border border-amber-200 transition-colors"
                                >
                                    <FileWarning className="h-4 w-4" /> Report variation
                                </button>
                                <button
                                    onClick={() => setShowCompletionModal(true)}
                                    className="flex items-center justify-center gap-2 py-2.5 px-3 bg-[#3B7A3F]/[0.06] hover:bg-[#3B7A3F]/10 text-[#3B7A3F] font-medium text-[13px] rounded-lg border border-[#3B7A3F]/30 transition-colors"
                                >
                                    <Camera className="h-4 w-4" /> Mark complete
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}

                {/* ─── Decline confirmation ─── */}
                {isDeclined && (
                    <motion.div {...fadeInUp}>
                        <div className="bg-white rounded-2xl border border-[#E6E8EC] p-5 text-center">
                            <p className="text-[14px] text-[#5C6470]">You declined this job. Thanks for letting us know.</p>
                            {link.responseMessage && <p className="text-[12px] text-[#8B92A0] mt-2 italic">"{link.responseMessage}"</p>}
                        </div>
                    </motion.div>
                )}

                {/* ─── Question + decline links (footer) ─── */}
                {!isAccepted && !isDeclined && (
                    <motion.div {...fadeInUp}>
                        <div className="bg-white rounded-2xl border border-[#E6E8EC] p-5 space-y-3">
                            <p className="text-[12px] text-[#8B92A0] font-medium">Got a question?</p>
                            <textarea
                                value={questionText}
                                onChange={(e) => setQuestionText(e.target.value)}
                                placeholder="e.g. Do you have a tower for the roof tile work? What date are we looking at?"
                                rows={3}
                                className="w-full bg-[#F7F8FA] border border-[#E6E8EC] rounded-lg px-3 py-2.5 text-[14px] text-[#0E1116] placeholder-[#8B92A0] focus:outline-none focus:border-[#3B7A3F] focus:ring-2 focus:ring-[#3B7A3F]/20 resize-none transition-shadow"
                            />
                            <div className="flex items-center justify-between gap-3">
                                <button
                                    onClick={() => setShowDeclineModal(true)}
                                    className="text-[13px] text-[#8B92A0] hover:text-red-600 underline-offset-2 hover:underline transition-colors"
                                >
                                    Not for me
                                </button>
                                <button
                                    onClick={() => questionText.trim() && askQuestion.mutate(questionText.trim())}
                                    disabled={!questionText.trim() || askQuestion.isPending}
                                    className="flex items-center gap-1.5 px-4 py-2 bg-white text-[#0E1116] hover:bg-[#F1F3F6] disabled:bg-[#F7F8FA] disabled:text-[#8B92A0] text-[13px] font-medium rounded-lg border border-[#D4D8DE] disabled:border-[#E6E8EC] transition-colors"
                                >
                                    <MessageCircle className="h-3.5 w-3.5" /> Send question
                                </button>
                            </div>
                            <div className="pt-3 border-t border-[#E6E8EC] flex items-center justify-center gap-2 text-[12px] text-[#8B92A0]">
                                <Phone className="h-3.5 w-3.5" /> Or call Ben:
                                <a href="tel:+447449501762" className="text-[#3B7A3F] font-semibold">07449 501 762</a>
                            </div>
                        </div>
                    </motion.div>
                )}

                <p className="text-center text-[10px] text-[#8B92A0] uppercase tracking-[0.12em] pt-2">
                    Handy Services · Confidential brief for {link.contractorName}
                </p>
            </main>

            {/* ─── STICKY BOTTOM BAR — morphing CTA ─── */}
            {!isAccepted && !isDeclined && (
                <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#E6E8EC] bg-white/95 backdrop-blur-md">
                    <div className="max-w-[680px] mx-auto px-4 py-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                            <p className="text-[10px] uppercase tracking-[0.08em] font-semibold text-[#8B92A0] leading-none">Net pay</p>
                            <p className="text-[20px] font-semibold tabular-nums text-[#0E1116] leading-tight mt-0.5">{fmt(dispatch.totalContractorPayPence)}</p>
                        </div>
                        <button
                            onClick={ctaClick}
                            disabled={ctaDisabled}
                            className={`px-5 py-3 rounded-xl font-semibold text-[14px] transition-all active:scale-[0.97] disabled:cursor-not-allowed shrink-0 ${
                                ctaState.mode === "warnings" ? "bg-amber-500 hover:bg-amber-600 text-white" :
                                ctaState.mode === "bond" ? "bg-amber-500 hover:bg-amber-600 text-white" :
                                ctaState.mode === "accept" ? "bg-[#3B7A3F] hover:bg-[#2F6133] text-white shadow-md shadow-[#3B7A3F]/20" :
                                "bg-[#E6E8EC] text-[#8B92A0]"
                            }`}
                        >
                            {acceptJob.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : ctaLabel()}
                        </button>
                    </div>
                </div>
            )}

            {/* ─── Lightbox ─── */}
            {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}

            {/* ─── Decline modal ─── */}
            {showDeclineModal && (
                <ModalShell onClose={() => setShowDeclineModal(false)}>
                    <h3 className="text-[16px] font-semibold text-[#0E1116] mb-1">Decline this job</h3>
                    <p className="text-[13px] text-[#5C6470] mb-3">A quick reason helps Ben learn what works for you.</p>
                    <textarea
                        value={declineReason}
                        onChange={(e) => setDeclineReason(e.target.value)}
                        placeholder="e.g. Already booked that week / not my area / pay too low for the hours"
                        rows={3}
                        className="w-full bg-[#F7F8FA] border border-[#E6E8EC] rounded-lg px-3 py-2.5 text-[14px] text-[#0E1116] placeholder-[#8B92A0] focus:outline-none focus:border-[#3B7A3F] focus:ring-2 focus:ring-[#3B7A3F]/20 resize-none"
                    />
                    <div className="flex gap-2 mt-4">
                        <button onClick={() => setShowDeclineModal(false)} className="flex-1 py-2.5 bg-[#F1F3F6] hover:bg-[#E6E8EC] text-[#5C6470] rounded-lg text-[14px] font-medium transition-colors">Cancel</button>
                        <button
                            onClick={() => declineJob.mutate(declineReason)}
                            disabled={declineJob.isPending}
                            className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-[14px] font-medium disabled:opacity-50"
                        >
                            {declineJob.isPending ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Decline"}
                        </button>
                    </div>
                </ModalShell>
            )}

            {/* ─── Variation modal ─── */}
            {showVariationModal && (
                <ModalShell onClose={() => setShowVariationModal(false)}>
                    <h3 className="text-[16px] font-semibold text-amber-700 mb-1">Report variation</h3>
                    <p className="text-[13px] text-[#5C6470] mb-4">Something different on-site? Flag it now so Ben can amend the customer's quote.</p>
                    <Label>What's changed?</Label>
                    <textarea
                        value={variationDesc}
                        onChange={(e) => setVariationDesc(e.target.value)}
                        placeholder="e.g. Bath panel won't fit — going to re-use existing with new battens"
                        rows={3}
                        className="w-full bg-[#F7F8FA] border border-[#E6E8EC] rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 resize-none"
                    />
                    <Label className="mt-3">Why? (optional)</Label>
                    <input
                        value={variationReason}
                        onChange={(e) => setVariationReason(e.target.value)}
                        placeholder="e.g. Wrong size for the bath"
                        className="w-full bg-[#F7F8FA] border border-[#E6E8EC] rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                    />
                    <Label className="mt-3">Extra cost (£, optional)</Label>
                    <input
                        type="number"
                        value={variationExtra}
                        onChange={(e) => setVariationExtra(e.target.value)}
                        placeholder="e.g. 25"
                        className="w-full bg-[#F7F8FA] border border-[#E6E8EC] rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                    />
                    <Label className="mt-3">Photos (optional)</Label>
                    <input ref={variationFileRef} type="file" accept="image/*" multiple onChange={(e) => setVariationPhotos(Array.from(e.target.files || []))} className="hidden" />
                    <button onClick={() => variationFileRef.current?.click()} className="w-full py-2 bg-[#F7F8FA] hover:bg-[#F1F3F6] text-[#5C6470] rounded-lg border border-[#E6E8EC] text-[13px] flex items-center justify-center gap-2">
                        <Camera className="h-4 w-4" /> {variationPhotos.length > 0 ? `${variationPhotos.length} photo(s) selected` : "Add photos"}
                    </button>
                    <div className="flex gap-2 mt-4">
                        <button onClick={() => setShowVariationModal(false)} className="flex-1 py-2.5 bg-[#F1F3F6] hover:bg-[#E6E8EC] text-[#5C6470] rounded-lg text-[14px] font-medium">Cancel</button>
                        <button
                            onClick={async () => {
                                if (!variationDesc.trim()) return;
                                const photos = await Promise.all(variationPhotos.map(fileToDataUrl));
                                reportVariation.mutate({
                                    description: variationDesc, reason: variationReason, photos,
                                    additionalPricePence: variationExtra ? Math.round(parseFloat(variationExtra) * 100) : 0,
                                });
                            }}
                            disabled={!variationDesc.trim() || reportVariation.isPending}
                            className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[14px] font-medium disabled:opacity-50"
                        >
                            {reportVariation.isPending ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Submit"}
                        </button>
                    </div>
                </ModalShell>
            )}

            {/* ─── Completion modal ─── */}
            {showCompletionModal && (
                <ModalShell onClose={() => setShowCompletionModal(false)}>
                    <h3 className="text-[16px] font-semibold text-[#3B7A3F] mb-1">Mark job complete</h3>
                    <p className="text-[13px] text-[#5C6470] mb-4">Upload at least one photo of the finished work. Required.</p>
                    <input ref={completionFileRef} type="file" accept="image/*" multiple onChange={(e) => setCompletionPhotos(Array.from(e.target.files || []))} className="hidden" />
                    <button onClick={() => completionFileRef.current?.click()} className="w-full py-3 bg-[#F7F8FA] hover:bg-[#F1F3F6] text-[#5C6470] rounded-lg border border-[#E6E8EC] text-[13px] flex items-center justify-center gap-2">
                        <Camera className="h-4 w-4" /> {completionPhotos.length > 0 ? `${completionPhotos.length} photo(s) selected` : "Add photos *"}
                    </button>
                    <Label className="mt-3">Notes (optional)</Label>
                    <textarea
                        value={completionNotes}
                        onChange={(e) => setCompletionNotes(e.target.value)}
                        placeholder="Anything Ben should know? Customer happy?"
                        rows={3}
                        className="w-full bg-[#F7F8FA] border border-[#E6E8EC] rounded-lg px-3 py-2 text-[14px] focus:outline-none focus:border-[#3B7A3F] focus:ring-2 focus:ring-[#3B7A3F]/20 resize-none"
                    />
                    <div className="flex gap-2 mt-4">
                        <button onClick={() => setShowCompletionModal(false)} className="flex-1 py-2.5 bg-[#F1F3F6] hover:bg-[#E6E8EC] text-[#5C6470] rounded-lg text-[14px] font-medium">Cancel</button>
                        <button
                            onClick={async () => {
                                if (completionPhotos.length === 0) return;
                                const photos = await Promise.all(completionPhotos.map(fileToDataUrl));
                                completeJob.mutate({ photos, notes: completionNotes });
                            }}
                            disabled={completionPhotos.length === 0 || completeJob.isPending}
                            className="flex-1 py-2.5 bg-[#3B7A3F] hover:bg-[#2F6133] text-white rounded-lg text-[14px] font-medium disabled:opacity-50"
                        >
                            {completeJob.isPending ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Mark complete"}
                        </button>
                    </div>
                </ModalShell>
            )}

            {/* ─── Bond bottom sheet ─── */}
            {showBondSheet && dispatch.bondAmountPence && (
                <BondPaymentSheet
                    token={token!}
                    amountPence={dispatch.bondAmountPence}
                    payPence={dispatch.totalContractorPayPence}
                    scheduledDate={dispatch.scheduledDate}
                    onClose={() => setShowBondSheet(false)}
                    onPaid={() => { setShowBondSheet(false); refetch(); }}
                />
            )}
        </div>
    );
}

// ───────────────────────────────────────────────────────────────────────────
// Sub-components
// ───────────────────────────────────────────────────────────────────────────

function SectionEyebrow({ children }: { children: React.ReactNode }) {
    return (
        <h2 className="text-[11px] uppercase tracking-[0.1em] font-semibold text-[#5C6470] mb-2.5">{children}</h2>
    );
}

function Label({ children, className = "" }: { children: React.ReactNode; className?: string }) {
    return (
        <p className={`text-[11px] uppercase tracking-[0.08em] font-semibold text-[#8B92A0] mb-1.5 ${className}`}>{children}</p>
    );
}

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-[60] bg-[#0E1116]/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={onClose}>
            <div className="w-full max-w-md bg-white rounded-2xl p-5 sm:p-6 border border-[#E6E8EC] shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                {children}
            </div>
        </div>
    );
}

function PhotoCarousel({ urls, onClick }: { urls: string[]; onClick: (url: string) => void }) {
    return (
        <div className="-mx-4 px-4">
            <div className="flex gap-2.5 overflow-x-auto snap-x snap-mandatory scrollbar-thin scrollbar-thumb-[#D4D8DE] pb-2">
                {urls.map((u, i) => {
                    const video = isVideo(u);
                    return (
                        <button
                            key={i}
                            onClick={() => onClick(u)}
                            className="relative shrink-0 w-[78%] sm:w-[60%] aspect-[4/3] rounded-xl overflow-hidden bg-[#E6E8EC] snap-start hover:opacity-95 transition-opacity"
                        >
                            {video ? (
                                <>
                                    <video src={u} className="w-full h-full object-cover" preload="metadata" muted />
                                    <div className="absolute inset-0 flex items-center justify-center bg-[#0E1116]/15">
                                        <div className="bg-[#F5A623] rounded-full p-3 shadow-lg">
                                            <Play className="h-5 w-5 text-[#0E1116] fill-[#0E1116]" />
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <img src={u} alt="" className="w-full h-full object-cover" />
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function MediaThumb({ url, onClick }: { url: string; onClick: () => void }) {
    const video = isVideo(url);
    return (
        <button
            onClick={onClick}
            className="relative aspect-square rounded-lg overflow-hidden bg-[#E6E8EC] hover:opacity-90 transition-opacity"
        >
            {video ? (
                <>
                    <video src={url} className="w-full h-full object-cover" preload="metadata" muted />
                    <div className="absolute inset-0 flex items-center justify-center bg-[#0E1116]/15">
                        <Play className="h-4 w-4 text-white fill-white" />
                    </div>
                </>
            ) : (
                <img src={url} alt="" className="w-full h-full object-cover" />
            )}
        </button>
    );
}

function BondTimeline({ amountPence, payPence, scheduledDate }: { amountPence: number; payPence: number; scheduledDate: string | null }) {
    const today = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    const jobDay = scheduledDate
        ? new Date(scheduledDate).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
        : "Job day";
    const jobDayPlus1 = fmtDatePlus(scheduledDate, 1);

    const steps = [
        { when: today, label: "You pay", value: `−£${(amountPence / 100).toFixed(0)}`, cls: "text-amber-700" },
        { when: jobDay, label: "Job done", value: "✓", cls: "text-[#3B7A3F]" },
        { when: jobDay, label: "Bond back", value: `+£${(amountPence / 100).toFixed(0)}`, cls: "text-[#3B7A3F]" },
        { when: jobDayPlus1, label: "Pay paid out", value: `+£${(payPence / 100).toFixed(0)}`, cls: "text-[#0E1116]" },
    ];

    return (
        <div className="grid grid-cols-4 gap-2 mt-4">
            {steps.map((s, i) => (
                <div key={i} className="text-center">
                    <p className="text-[9px] uppercase tracking-[0.08em] font-semibold text-[#8B92A0] mb-1">{s.when}</p>
                    <div className={`bg-[#F7F8FA] rounded-lg py-2.5 px-1 border border-[#E6E8EC]`}>
                        <p className={`text-[15px] font-semibold tabular-nums ${s.cls}`}>{s.value}</p>
                        <p className="text-[10px] text-[#5C6470] mt-0.5 leading-tight">{s.label}</p>
                    </div>
                </div>
            ))}
        </div>
    );
}

// ───────────────────────────────────────────────────────────────────────────
// Bond payment sheet (Stripe Elements, opens from sticky CTA)
// ───────────────────────────────────────────────────────────────────────────

function BondPaymentSheet({
    token, amountPence, payPence, scheduledDate, onClose, onPaid,
}: {
    token: string;
    amountPence: number;
    payPence: number;
    scheduledDate: string | null;
    onClose: () => void;
    onPaid: () => void;
}) {
    const [clientSecret, setClientSecret] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetch(`/api/contractor-job/${token}/bond/intent`, { method: "POST" })
            .then((r) => r.json())
            .then((d) => {
                if (cancelled) return;
                if (d.clientSecret) setClientSecret(d.clientSecret);
                else setError(d.error || "Could not start payment");
            })
            .catch(() => !cancelled && setError("Network error"));
        return () => { cancelled = true; };
    }, [token]);

    return (
        <div className="fixed inset-0 z-[60] bg-[#0E1116]/40 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={onClose}>
            <div className="w-full sm:max-w-md bg-white sm:rounded-2xl rounded-t-3xl p-5 sm:p-6 border-t sm:border border-[#E6E8EC] shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-1">
                    <h3 className="text-[16px] font-semibold text-[#0E1116]">Pay £{(amountPence / 100).toFixed(2)} security</h3>
                    <button onClick={onClose} className="text-[#8B92A0] hover:text-[#0E1116]"><X className="h-5 w-5" /></button>
                </div>
                <p className="text-[13px] text-[#5C6470] leading-relaxed mb-4">
                    Held by Stripe. Refunded automatically when you mark the job complete with photos.
                </p>

                <BondTimeline amountPence={amountPence} payPence={payPence} scheduledDate={scheduledDate} />

                <div className="mt-5">
                    {error && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                            <p className="text-[12px] text-red-700 flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5" /> {error}</p>
                        </div>
                    )}
                    {!clientSecret || !isStripeConfigured ? (
                        <div className="bg-[#F7F8FA] border border-[#E6E8EC] rounded-lg p-4 flex items-center gap-2">
                            <Loader2 className="h-4 w-4 text-[#5C6470] animate-spin" />
                            <p className="text-[12px] text-[#5C6470]">Setting up secure payment…</p>
                        </div>
                    ) : (
                        <Elements
                            stripe={getStripe()}
                            options={{
                                clientSecret,
                                appearance: {
                                    theme: "stripe",
                                    variables: {
                                        colorPrimary: "#3B7A3F",
                                        colorBackground: "#FFFFFF",
                                        colorText: "#0E1116",
                                        colorDanger: "#B42318",
                                        borderRadius: "8px",
                                        fontFamily: "system-ui, -apple-system, sans-serif",
                                    },
                                },
                            }}
                        >
                            <BondPaymentForm token={token} onPaid={onPaid} />
                        </Elements>
                    )}
                </div>

                <p className="text-center text-[10px] text-[#8B92A0] uppercase tracking-[0.08em] mt-4">
                    <CreditCard className="h-3 w-3 inline-block mr-1" /> Secured by Stripe
                </p>
            </div>
        </div>
    );
}

function BondPaymentForm({ token, onPaid }: { token: string; onPaid: () => void }) {
    const stripe = useStripe();
    const elements = useElements();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!stripe || !elements) return;
        setSubmitting(true);
        setError(null);
        const { error: stripeError } = await stripe.confirmPayment({
            elements,
            confirmParams: { return_url: window.location.href },
            redirect: "if_required",
        });
        if (stripeError) {
            setError(stripeError.message || "Payment failed");
            setSubmitting(false);
            return;
        }
        const r = await fetch(`/api/contractor-job/${token}/bond/confirm`, { method: "POST" });
        const data = await r.json();
        if (data.status === "held") {
            onPaid();
        } else {
            setError(data.error || "Payment did not complete");
        }
        setSubmitting(false);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-3">
            <PaymentElement options={{ layout: "tabs" }} />
            {error && (
                <p className="text-[12px] text-red-600 flex items-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5" /> {error}
                </p>
            )}
            <button
                type="submit"
                disabled={!stripe || !elements || submitting}
                className="w-full py-3 bg-[#3B7A3F] hover:bg-[#2F6133] disabled:bg-[#E6E8EC] disabled:text-[#8B92A0] text-white font-semibold text-[14px] rounded-lg transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
            >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                Pay & continue
            </button>
        </form>
    );
}

// ───────────────────────────────────────────────────────────────────────────
// Lightbox (full-screen media viewer)
// ───────────────────────────────────────────────────────────────────────────

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
    const video = isVideo(url);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);
    return (
        <div className="fixed inset-0 z-[70] bg-[#0E1116]/95 backdrop-blur flex items-center justify-center p-4" onClick={onClose}>
            <button
                onClick={onClose}
                className="absolute top-4 right-4 text-white/80 hover:text-white p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                aria-label="Close"
            >
                <X className="h-5 w-5" />
            </button>
            <div className="max-w-5xl max-h-full" onClick={(e) => e.stopPropagation()}>
                {video ? (
                    <video src={url} controls autoPlay className="max-h-[90vh] max-w-full rounded-xl" />
                ) : (
                    <img src={url} alt="" className="max-h-[90vh] max-w-full rounded-xl object-contain" />
                )}
            </div>
        </div>
    );
}
