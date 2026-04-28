/**
 * Open Dispatch Link — single shareable URL per dispatch.
 *
 * URL: /dispatch-link/:token
 *
 * Flow:
 *   1. Visitor sees the brief (privacy-gated: postcode only, no address yet)
 *   2. Click "I'm taking this" → searchable picker of the contractor pool
 *   3. Pick yourself → server issues a per-contractor link
 *   4. Redirect to /contractor-job/:contractorToken (existing flow)
 *
 * Shares the light-mode "Premium Operator" design language with the
 * per-contractor page (navy hero, off-white page bg).
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useMemo } from "react";
import {
    Check, X, AlertCircle, MapPin, Loader2, Lock, Hammer, Search, ImageIcon,
    ChevronDown, ShieldCheck, Package, Clock, Zap, Droplet, ArrowUpFromLine,
    Play, Maximize2, MousePointerClick, UserCheck, CreditCard, Trophy,
} from "lucide-react";

interface PublicDispatch {
    id: string;
    shortRef: string;
    title: string;
    subtitle: string | null;
    postcode: string;
    customerFirstName: string;
    tasks: Array<{
        num: number; title: string; tier: string; category?: string; hours: number; payPence: number;
        description?: string; warning?: string; materials?: string[]; mediaUrls?: string[];
    }>;
    totalHours: number;
    totalContractorPayPence: number;
    scheduledDate: string | null;
    bondRequired: boolean;
    bondAmountPence: number | null;
    mediaUrls: string[];
    proposalSummary: string | null;
    preferredDates: { date: string; timeSlot: 'am' | 'pm' | 'full_day' | 'flexible' }[] | null;
}

interface OpenDispatchData {
    dispatch: PublicDispatch;
    isLocked: boolean;
    lockedToContractorName: string | null;
}

interface PoolContractor {
    id: string;
    name: string;
    city: string | null;
    phoneSuffix: string | null;
}

// No pence on contractor-facing displays — round to whole pound.
function fmt(p: number) { return `£${Math.round(p / 100)}`; }
function fmtDate(iso: string | null) {
    if (!iso) return "TBC";
    return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
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
function fmtPreferredDate(d: { date: string; timeSlot: string }) {
    const dt = new Date(d.date);
    const day = dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    const slot = d.timeSlot === "am" ? "AM" : d.timeSlot === "pm" ? "PM" : d.timeSlot === "full_day" ? "Full day" : "Flex";
    return `${day} · ${slot}`;
}
function isVideo(url: string): boolean { return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url); }
function skillMix(tasks: PublicDispatch["tasks"]) {
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

// Auto-detect risk flags from task warning text — gives contractors a heads-up
// of what's involved without reading every task.
function riskFlags(tasks: PublicDispatch["tasks"]): Array<{ key: string; label: string; icon: any }> {
    const allText = tasks.map((t) => `${t.warning || ""} ${t.description || ""} ${t.title}`).join(" ").toLowerCase();
    const flags: Array<{ key: string; label: string; icon: any }> = [];
    if (/\b(isolate at consumer unit|wiring|electrical|part p|circuit)\b/.test(allText)) flags.push({ key: "elec", label: "Electrical", icon: Zap });
    if (/\b(isolate water|tap|pipework|plumbing|leak)\b/.test(allText)) flags.push({ key: "plumb", label: "Plumbing", icon: Droplet });
    if (/\b(height|ladder|tower|roof|gutter|scaffold)\b/.test(allText)) flags.push({ key: "height", label: "Working at height", icon: ArrowUpFromLine });
    return flags;
}

const fadeInUp = {
    initial: { opacity: 0, y: 8 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
    transition: { duration: 0.35 },
};

export default function DispatchLinkPage() {
    const { token } = useParams<{ token: string }>();
    const [, setLocation] = useLocation();
    const [showPicker, setShowPicker] = useState(false);
    const [search, setSearch] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [expandedTaskNum, setExpandedTaskNum] = useState<number | null>(null);
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

    const { data, isLoading, isError } = useQuery<OpenDispatchData>({
        queryKey: ["dispatch-link", token],
        queryFn: () => fetch(`/api/dispatch-link/${token}`).then((r) => {
            if (!r.ok) throw new Error("not found");
            return r.json();
        }),
        enabled: !!token,
        retry: false,
    });

    // Lazy-load contractor pool only when picker opens
    const { data: pool, isLoading: poolLoading } = useQuery<{ contractors: PoolContractor[] }>({
        queryKey: ["dispatch-link-contractors", token],
        queryFn: () => fetch(`/api/dispatch-link/${token}/contractors`).then((r) => r.json()),
        enabled: showPicker,
    });

    const claim = useMutation({
        mutationFn: async (contractorId: string) => {
            const r = await fetch(`/api/dispatch-link/${token}/claim`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contractorId }),
            });
            const body = await r.json();
            if (!r.ok) throw new Error(body.error || "claim failed");
            return body;
        },
        onSuccess: ({ token: contractorToken }) => {
            // Hand off to the existing per-contractor flow
            setLocation(`/contractor-job/${contractorToken}`);
        },
        onError: (e: any) => setError(e?.message || "Could not claim — try again."),
    });

    // Filter pool by search input
    const filteredPool = useMemo(() => {
        const list = pool?.contractors || [];
        if (!search.trim()) return list;
        const q = search.toLowerCase();
        return list.filter((c) =>
            c.name.toLowerCase().includes(q) ||
            (c.city || "").toLowerCase().includes(q) ||
            (c.phoneSuffix || "").includes(q)
        );
    }, [pool, search]);

    if (isLoading) {
        return (
            <div className="min-h-screen bg-[#F7F8FA] flex flex-col items-center justify-center gap-3">
                <div className="w-12 h-12 border-2 border-slate-300 border-t-[#3B7A3F] rounded-full animate-spin" />
                <p className="text-slate-500 text-sm">Loading job…</p>
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
                    <h1 className="text-xl font-semibold text-[#0E1116] mb-2">Link not found</h1>
                    <p className="text-sm text-[#5C6470] leading-relaxed">This dispatch link may have expired. Reach out to Ben if you need help.</p>
                </div>
            </div>
        );
    }

    const { dispatch, isLocked, lockedToContractorName } = data;

    // Locked-out splash
    if (isLocked) {
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
                    <p className="text-sm text-[#5C6470] leading-relaxed mb-3">
                        {lockedToContractorName
                            ? <>Locked to <span className="font-semibold text-[#0E1116]">{lockedToContractorName}</span>. Better luck next one.</>
                            : <>Another contractor accepted this first. Better luck next one.</>}
                    </p>
                    <p className="text-xs text-[#8B92A0]">Ben — 07449 501 762</p>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#F7F8FA] font-sans text-[#0E1116] selection:bg-[#3B7A3F]/20 pb-28">
            {/* Header */}
            <header className="sticky top-0 z-30 bg-[#F7F8FA]/85 backdrop-blur-md border-b border-[#E6E8EC]">
                <div className="max-w-[680px] mx-auto px-4 py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <img src="/logo.png" alt="Handy" className="w-8 h-8 object-contain shrink-0" />
                        <span className="font-semibold text-[15px]">Handy</span>
                    </div>
                    {/* Flashing live pill — replaces the verbose banner. Conveys urgency
                        in 12 chars: red dot pulses, "FIRST WINS · #ref" tells the whole story. */}
                    <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.08em] font-bold bg-red-50 text-red-700 border border-red-300 px-2.5 py-1 rounded-full">
                        <span className="relative flex h-2 w-2">
                            <span className="absolute inset-0 rounded-full bg-red-500 opacity-75 animate-ping" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                        </span>
                        First wins · #{dispatch.shortRef}
                    </span>
                </div>
            </header>

            <main className="max-w-[680px] mx-auto px-4 py-6 space-y-6">
                {/* Hero — contractor-focused: title, price, summary, dates, skills */}
                <motion.div {...fadeInUp}>
                    <div className="rounded-2xl p-6 sm:p-7 shadow-[0_12px_40px_rgba(27,42,74,0.18)] relative overflow-hidden bg-gradient-to-br from-[#1B2A4A] via-[#152340] to-[#0E1933]">
                        <div className="absolute -top-24 -right-24 w-80 h-80 bg-[#F5A623]/15 rounded-full blur-3xl pointer-events-none" />
                        <div className="absolute -bottom-32 -left-20 w-72 h-72 bg-[#7DB00E]/10 rounded-full blur-3xl pointer-events-none" />

                        <div className="relative">
                            <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-white/55 mb-3">
                                {dispatch.subtitle?.split(",")[0]?.trim() || dispatch.postcode} · #{dispatch.shortRef}
                            </p>

                            <p className="text-5xl sm:text-6xl font-semibold text-[#F5A623] tabular-nums tracking-tight leading-none drop-shadow-[0_2px_12px_rgba(245,166,35,0.25)]">
                                {fmt(dispatch.totalContractorPayPence)}
                            </p>
                            <p className="text-[12px] uppercase tracking-[0.08em] text-white/65 mt-2 font-medium">
                                Net pay · {dispatch.tasks.length} task{dispatch.tasks.length !== 1 ? "s" : ""}
                            </p>

                            {dispatch.proposalSummary && (
                                <p className="mt-5 text-[15px] sm:text-[16px] font-semibold leading-snug text-white">
                                    {dispatch.proposalSummary}
                                </p>
                            )}

                            <div className="mt-4 flex flex-wrap gap-1.5 items-center">
                                {/* Duration band — replaces raw hours */}
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-white/[0.07] text-white/85 px-2.5 py-1 rounded-full border border-white/10">
                                    <Clock className="h-3 w-3" /> {durationBand(dispatch.totalHours)}
                                </span>
                                {/* Skill mix */}
                                {skillMix(dispatch.tasks).map((s) => (
                                    <span key={s.tier} className="inline-flex items-center gap-1 text-[11px] font-medium bg-white/[0.07] text-white/85 px-2.5 py-1 rounded-full border border-white/10">
                                        <span className={`w-1.5 h-1.5 rounded-full ${tierDot(s.tier)}`} />
                                        {s.count} {tierLabel(s.tier)}
                                    </span>
                                ))}
                                {/* Materials supplied — Handy supplies materials by default */}
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-[#7DB00E]/15 text-[#7DB00E] px-2.5 py-1 rounded-full border border-[#7DB00E]/30">
                                    <Package className="h-3 w-3" /> Materials supplied
                                </span>
                                {/* Bond preview */}
                                {dispatch.bondRequired && dispatch.bondAmountPence && (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-[#F5A623]/15 text-[#F5A623] px-2.5 py-1 rounded-full border border-[#F5A623]/30">
                                        <ShieldCheck className="h-3 w-3" /> {fmt(dispatch.bondAmountPence)} bond
                                    </span>
                                )}
                                {/* Media count */}
                                {(() => {
                                    const totalPhotos = (dispatch.mediaUrls || []).filter((u) => !isVideo(u)).length
                                        + dispatch.tasks.reduce((acc, t) => acc + (t.mediaUrls || []).filter((u) => !isVideo(u)).length, 0);
                                    const totalVideos = (dispatch.mediaUrls || []).filter((u) => isVideo(u)).length
                                        + dispatch.tasks.reduce((acc, t) => acc + (t.mediaUrls || []).filter((u) => isVideo(u)).length, 0);
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

                            {/* Risk flags — auto-derived from task warnings */}
                            {(() => {
                                const flags = riskFlags(dispatch.tasks);
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

                            <div className="mt-4 pt-4 border-t border-white/10">
                                <div className="flex items-start gap-2 text-[14px]">
                                    <MapPin className="h-4 w-4 text-[#F5A623] shrink-0 mt-0.5" />
                                    <span className="text-white/85">
                                        <span className="inline-block bg-white/10 text-white px-2 py-0.5 rounded-md text-[12px] font-medium tabular-nums">{dispatch.postcode}</span>
                                        <span className="text-white/50 text-[12px] ml-2">full address unlocks on bond</span>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* Photos & video walkthrough — between hero and scope */}
                {dispatch.mediaUrls && dispatch.mediaUrls.length > 0 && (() => {
                    const videoCount = dispatch.mediaUrls.filter(isVideo).length;
                    const photoCount = dispatch.mediaUrls.length - videoCount;
                    return (
                        <motion.div {...fadeInUp}>
                            <div className="flex items-baseline justify-between mb-2.5">
                                <h2 className="text-[11px] uppercase tracking-[0.1em] font-semibold text-[#5C6470]">
                                    Walkthrough
                                </h2>
                                <span className="text-[11px] text-[#8B92A0] tabular-nums">
                                    {photoCount > 0 && `${photoCount} photo${photoCount !== 1 ? "s" : ""}`}
                                    {photoCount > 0 && videoCount > 0 && " · "}
                                    {videoCount > 0 && `${videoCount} video${videoCount !== 1 ? "s" : ""}`}
                                </span>
                            </div>
                            <div className="-mx-4 px-4">
                                <div className="flex gap-2.5 overflow-x-auto snap-x snap-mandatory pb-2">
                                    {dispatch.mediaUrls.map((u, i) => {
                                        const video = isVideo(u);
                                        return (
                                            <button
                                                key={i}
                                                onClick={() => setLightboxUrl(u)}
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
                        </motion.div>
                    );
                })()}

                {/* Scope accordion — tap a row to expand description / warning / materials */}
                <motion.div {...fadeInUp}>
                    <h2 className="text-[11px] uppercase tracking-[0.1em] font-semibold text-[#5C6470] mb-2.5">Scope at a glance</h2>
                    <div className="bg-white rounded-2xl border border-[#E6E8EC] divide-y divide-[#E6E8EC] overflow-hidden">
                        {dispatch.tasks.map((t) => {
                            const isOpen = expandedTaskNum === t.num;
                            return (
                                <div key={t.num}>
                                    <button
                                        onClick={() => setExpandedTaskNum(isOpen ? null : t.num)}
                                        className="w-full px-4 py-3.5 flex items-center gap-3 hover:bg-[#F1F3F6] transition-colors text-left"
                                    >
                                        <span className={`w-2 h-2 rounded-full ${tierDot(t.tier)} shrink-0`} />
                                        <span className="text-[13px] font-mono text-[#8B92A0] shrink-0 w-5 tabular-nums">{t.num}.</span>
                                        <span className="text-[14px] font-medium text-[#0E1116] flex-1 truncate">{t.title}</span>
                                        {t.warning && <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />}
                                        <span className="text-[14px] font-semibold tabular-nums text-[#0E1116] shrink-0 w-[64px] text-right">{fmt(t.payPence)}</span>
                                        <ChevronDown className={`h-4 w-4 text-[#8B92A0] shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
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
                                                <div className="px-4 pb-5 pt-2 space-y-3 bg-[#FAFBFC]">
                                                    <div className="flex items-center gap-2 flex-wrap text-[11px] uppercase tracking-[0.08em] text-[#8B92A0] font-semibold">
                                                        <span className={`w-1.5 h-1.5 rounded-full ${tierDot(t.tier)}`} />
                                                        {tierLabel(t.tier)}
                                                        {t.category && (
                                                            <span className="bg-[#F1F3F6] text-[#5C6470] px-1.5 py-0.5 rounded normal-case tracking-normal text-[11px] font-medium">
                                                                {t.category.replace(/_/g, " ")}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {t.description && (
                                                        <p className="text-[14px] leading-relaxed text-[#5C6470]">{t.description}</p>
                                                    )}
                                                    {t.warning && (
                                                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                                                            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-700 mb-1 flex items-center gap-1.5">
                                                                <AlertCircle className="h-3 w-3" /> On-site warning
                                                            </p>
                                                            <p className="text-[13px] text-[#0E1116] leading-relaxed">{t.warning}</p>
                                                        </div>
                                                    )}
                                                    {t.materials && t.materials.length > 0 && (
                                                        <div>
                                                            <p className="text-[11px] uppercase tracking-[0.08em] text-[#8B92A0] font-semibold mb-1.5">Materials supplied</p>
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {t.materials.map((m, i) => (
                                                                    <span key={i} className="text-[12px] bg-[#F1F3F6] text-[#5C6470] px-2 py-1 rounded-md">{m}</span>
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

                {/* How this works — 4-icon grid */}
                <motion.div {...fadeInUp}>
                    <h2 className="text-[11px] uppercase tracking-[0.1em] font-semibold text-[#5C6470] mb-2.5">How this works</h2>
                    <div className="bg-white rounded-2xl border border-[#E6E8EC] p-5">
                        <div className="grid grid-cols-4 gap-3">
                            {[
                                { icon: MousePointerClick, label: "Tap to claim", num: 1 },
                                { icon: UserCheck, label: "Pick yourself", num: 2 },
                                { icon: CreditCard, label: `Pay £${((dispatch.bondAmountPence || 0) / 100).toFixed(0)} bond`, num: 3 },
                                { icon: Trophy, label: "First locks it", num: 4 },
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
                            Bond refunded the same day you mark complete.
                        </p>
                    </div>
                </motion.div>

                {/* Footer */}
                <motion.div {...fadeInUp} className="text-center pt-2">
                    <p className="text-[10px] text-[#8B92A0] uppercase tracking-[0.12em]">
                        Handy Services · Open dispatch
                    </p>
                </motion.div>
            </main>

            {/* Lightbox for tapped media */}
            {lightboxUrl && (() => {
                const video = isVideo(lightboxUrl);
                return (
                    <div className="fixed inset-0 z-[70] bg-[#0E1116]/95 backdrop-blur flex items-center justify-center p-4" onClick={() => setLightboxUrl(null)}>
                        <button
                            onClick={() => setLightboxUrl(null)}
                            className="absolute top-4 right-4 text-white/80 hover:text-white p-2 rounded-full bg-white/10 hover:bg-white/20"
                            aria-label="Close"
                        >
                            <X className="h-5 w-5" />
                        </button>
                        <div className="max-w-5xl max-h-full" onClick={(e) => e.stopPropagation()}>
                            {video
                                ? <video src={lightboxUrl} controls autoPlay className="max-h-[90vh] max-w-full rounded-xl" />
                                : <img src={lightboxUrl} alt="" className="max-h-[90vh] max-w-full rounded-xl object-contain" />}
                        </div>
                    </div>
                );
            })()}

            {/* Sticky bottom CTA */}
            <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#E6E8EC] bg-white/95 backdrop-blur-md">
                <div className="max-w-[680px] mx-auto px-4 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                        <p className="text-[10px] uppercase tracking-[0.08em] font-semibold text-[#8B92A0] leading-none">Net pay</p>
                        <p className="text-[20px] font-semibold tabular-nums text-[#0E1116] leading-tight mt-0.5">{fmt(dispatch.totalContractorPayPence)}</p>
                    </div>
                    <button
                        onClick={() => setShowPicker(true)}
                        className="px-5 py-3 rounded-xl font-semibold text-[14px] bg-[#3B7A3F] hover:bg-[#2F6133] text-white transition-all active:scale-[0.97] shadow-md shadow-[#3B7A3F]/20 inline-flex items-center gap-2"
                    >
                        <Hammer className="h-4 w-4" /> I'm taking this
                    </button>
                </div>
            </div>

            {/* ─── Picker modal ─── */}
            <AnimatePresence>
                {showPicker && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[60] bg-[#0E1116]/40 backdrop-blur-sm flex items-end sm:items-center justify-center"
                        onClick={() => { setShowPicker(false); setError(null); setSearch(""); }}
                    >
                        <motion.div
                            initial={{ y: 20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 20, opacity: 0 }}
                            className="w-full sm:max-w-md bg-white sm:rounded-2xl rounded-t-3xl border-t sm:border border-[#E6E8EC] shadow-2xl max-h-[85vh] flex flex-col"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="p-5 border-b border-[#E6E8EC]">
                                <div className="flex items-center justify-between mb-1">
                                    <h3 className="text-[16px] font-semibold">Pick yourself</h3>
                                    <button onClick={() => { setShowPicker(false); setError(null); setSearch(""); }} className="text-[#8B92A0] hover:text-[#0E1116]">
                                        <X className="h-5 w-5" />
                                    </button>
                                </div>
                                <p className="text-[12px] text-[#5C6470] mb-3">From the Handy contractor pool. Search by name, city, or last 4 of phone.</p>
                                <div className="relative">
                                    <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#8B92A0]" />
                                    <input
                                        type="text"
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        placeholder="Search…"
                                        className="w-full bg-[#F7F8FA] border border-[#E6E8EC] rounded-lg pl-9 pr-3 py-2 text-[14px] focus:outline-none focus:border-[#3B7A3F] focus:ring-2 focus:ring-[#3B7A3F]/20"
                                        autoFocus
                                    />
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto p-2">
                                {poolLoading ? (
                                    <div className="flex items-center justify-center py-10 gap-2 text-[#8B92A0]">
                                        <Loader2 className="h-4 w-4 animate-spin" /> Loading contractor pool…
                                    </div>
                                ) : filteredPool.length === 0 ? (
                                    <p className="text-center py-8 text-[14px] text-[#8B92A0]">
                                        No contractors match. Try a shorter search.
                                    </p>
                                ) : (
                                    filteredPool.map((c) => (
                                        <button
                                            key={c.id}
                                            onClick={() => {
                                                setError(null);
                                                claim.mutate(c.id);
                                            }}
                                            disabled={claim.isPending}
                                            className="w-full px-3 py-3 rounded-lg hover:bg-[#F1F3F6] disabled:opacity-50 flex items-center justify-between text-left transition-colors"
                                        >
                                            <div>
                                                <p className="text-[14px] font-medium text-[#0E1116]">{c.name}</p>
                                                <p className="text-[12px] text-[#8B92A0]">
                                                    {c.city || "—"}{c.phoneSuffix && ` · phone ends ${c.phoneSuffix}`}
                                                </p>
                                            </div>
                                            {claim.isPending ? <Loader2 className="h-4 w-4 animate-spin text-[#3B7A3F]" /> : <Check className="h-4 w-4 text-[#8B92A0]" />}
                                        </button>
                                    ))
                                )}
                            </div>

                            {error && (
                                <div className="p-4 border-t border-[#E6E8EC] bg-red-50">
                                    <p className="text-[12px] text-red-700 flex items-center gap-1.5">
                                        <AlertCircle className="h-3.5 w-3.5" /> {error}
                                    </p>
                                </div>
                            )}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
