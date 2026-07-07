/**
 * CallsHubPage — the single home for everything calls.
 *
 * Consolidates the old Call Logs + Call Performance surfaces into one page:
 *   • List (default) — every incoming call, filterable, with inline actions
 *     (Build quote, WhatsApp video request, Review).
 *   • Insights — the VA performance analytics (was /admin/call-performance).
 *
 * Work first, analytics second. Route: /admin/calls?tab=list|insights
 * Shown to owner (admin) and Ben (va).
 */

import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { subDays, format, isToday, isYesterday } from "date-fns";
import {
    Phone, Loader2, ChevronLeft, ChevronRight, Search,
    FilePlus2, ExternalLink, Headset, Bot, PhoneMissed, Voicemail,
} from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { cn } from "@/lib/utils";
import { CallDetailsModal } from "@/components/calls/CallDetailsModal";
import { CallInsights } from "@/pages/admin/CallPerformancePage";
import { parseAiScore, scoreChipClassLight, formatNextStep } from "@/components/calls/CallScorecard";

// ─── Row shape (from GET /api/calls) ────────────────────────────────────
interface CallRow {
    id: string;
    callId: string;
    customerName: string;
    phoneNumber: string;
    startTime: string;
    jobSummary?: string;
    outcome: string | null;
    status: string;
    missedReason?: string;
    recordingUrl?: string;
    handledBy?: string | null;
    ringSeconds?: number | null;
    durationSeconds?: number | null;
    aiScoreJson?: unknown;
}

type LaneFilter = "all" | "va" | "ai_agent" | "missed";

// ─── Helpers ─────────────────────────────────────────────────────────────
function formatCallTime(startTime: string) {
    const d = new Date(startTime);
    if (isToday(d)) return format(d, "'Today' HH:mm");
    if (isYesterday(d)) return format(d, "'Yesterday' HH:mm");
    return format(d, "d MMM HH:mm");
}

function fmtDuration(secs?: number | null) {
    if (secs == null || secs <= 0) return "—";
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

/** Resolve the call's lane, preferring the authoritative handledBy column,
 *  falling back to outcome/missedReason for older unclassified rows. */
function resolveLane(call: CallRow): LaneFilter | "voicemail" {
    if (call.handledBy === "va") return "va";
    if (call.handledBy === "ai_agent") return "ai_agent";
    if (call.handledBy === "missed") return "missed";
    if (call.handledBy === "voicemail") return "voicemail";
    // Fallback for rows predating handledBy
    const o = call.outcome?.toUpperCase();
    if (o === "ELEVEN_LABS" || call.missedReason) return "ai_agent";
    if (o === "NO_ANSWER" || o === "MISSED_CALL") return "missed";
    if (o === "VOICEMAIL" || o === "VOICEMAIL_LEFT") return "voicemail";
    if (call.outcome) return "va";
    return "missed";
}

function LaneBadge({ lane }: { lane: LaneFilter | "voicemail" }) {
    const map = {
        va: { label: "VA", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: Headset },
        ai_agent: { label: "AI", cls: "bg-blue-50 text-blue-700 border-blue-200", Icon: Bot },
        missed: { label: "Missed", cls: "bg-red-50 text-red-700 border-red-200", Icon: PhoneMissed },
        voicemail: { label: "VM", cls: "bg-orange-50 text-orange-700 border-orange-200", Icon: Voicemail },
    } as const;
    const { label, cls, Icon } = map[lane];
    return (
        <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-semibold", cls)}>
            <Icon className="w-3 h-3" /> {label}
        </span>
    );
}

// Pre-fill the "send us a video" WhatsApp message. The job phrase comes from
// the scorer's mediaRequestPhrase (built to slot into this sentence); falls
// back to a generic phrasing so it never reads broken. Ben edits before send.
function whatsappVideoRequest(call: CallRow) {
    const cleanNumber = call.phoneNumber.replace(/\D/g, "");
    const generic = /^(unknown|voice caller|unknown caller|caller)?$/i.test((call.customerName ?? "").trim());
    const firstName = generic ? "there" : call.customerName!.split(" ")[0];
    const phrase = parseAiScore(call.aiScoreJson)?.mediaRequestPhrase?.trim();
    const middle = phrase ? `showing us ${phrase}` : "showing us the job";
    const message = `Hi ${firstName},\n\nAs discussed, please send us a quick video ${middle} — as long or short as you like \u{1F60A}\n\nBen, Handy Services`;
    window.open(`https://wa.me/${cleanNumber}?text=${encodeURIComponent(message)}`, "_blank");
}

function buildQuoteHref(call: CallRow) {
    const p = new URLSearchParams();
    p.set("fromCallId", call.id);
    if (call.phoneNumber) p.set("phone", call.phoneNumber);
    if (call.customerName && call.customerName !== "Unknown") p.set("name", call.customerName);
    if (call.jobSummary) p.set("job", call.jobSummary);
    return `/admin/generate-contextual-quote?${p.toString()}`;
}

// ─── List tab ────────────────────────────────────────────────────────────
function CallsListTab() {
    const [, navigate] = useLocation();
    const [page, setPage] = useState(1);
    const [lane, setLane] = useState<LaneFilter>("all");
    const [search, setSearch] = useState("");
    const [selectedCallId, setSelectedCallId] = useState<string | null>(null);

    const { data, isLoading } = useQuery({
        queryKey: ["calls-hub", page, search],
        queryFn: async () => {
            const params = new URLSearchParams({
                page: String(page),
                limit: "30",
                startDate: subDays(new Date(), 60).toISOString(),
                endDate: new Date().toISOString(),
            });
            if (search.trim()) params.set("search", search.trim());
            const res = await fetch(`/api/calls?${params}`);
            if (!res.ok) throw new Error("Failed to fetch calls");
            return res.json() as Promise<{ calls: CallRow[]; pagination: any }>;
        },
        placeholderData: keepPreviousData,
    });

    const allCalls = data?.calls || [];
    const pagination = data?.pagination;

    const calls = useMemo(
        () => (lane === "all" ? allCalls : allCalls.filter((c) => resolveLane(c) === lane)),
        [allCalls, lane],
    );

    const LANES: Array<{ id: LaneFilter; label: string }> = [
        { id: "all", label: "All" },
        { id: "va", label: "Answered (VA)" },
        { id: "ai_agent", label: "AI agent" },
        { id: "missed", label: "Missed" },
    ];

    return (
        <div className="space-y-3">
            {/* Filter bar */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex items-center gap-1 bg-muted border rounded-lg p-1 self-start">
                    {LANES.map((l) => (
                        <button
                            key={l.id}
                            onClick={() => setLane(l.id)}
                            className={cn(
                                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                                lane === l.id ? "bg-background text-foreground shadow-sm" : "text-zinc-500 hover:text-zinc-700",
                            )}
                        >
                            {l.label}
                        </button>
                    ))}
                </div>
                <div className="relative flex-1 max-w-xs">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                        placeholder="Search name or number…"
                        className="w-full bg-card border rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground placeholder-zinc-400 focus:outline-none focus:border-zinc-400"
                    />
                </div>
            </div>

            {/* List */}
            {isLoading ? (
                <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-zinc-400" /></div>
            ) : calls.length === 0 ? (
                <div className="text-center py-16 text-sm text-zinc-500">No calls match this filter.</div>
            ) : (
                <div className="space-y-1.5">
                    {calls.map((call) => {
                        const l = resolveLane(call);
                        const score = parseAiScore(call.aiScoreJson);
                        const nextStep = score?.dimensions?.conversionBehaviour?.nextStepSecured;
                        return (
                            <div
                                key={call.id}
                                className="flex items-center gap-3 p-2.5 rounded-xl bg-card border shadow-sm hover:bg-muted/40 transition-colors cursor-pointer"
                                onClick={() => setSelectedCallId(call.id)}
                            >
                                {/* Identity */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm text-foreground truncate">
                                            {call.customerName || "Unknown"}
                                        </span>
                                        <LaneBadge lane={l} />
                                        {score?.overall != null && (
                                            <span className={cn("px-1.5 py-0 rounded border text-[10px] font-bold font-mono", scoreChipClassLight(score.overall))}>
                                                {score.overall}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-zinc-500">
                                        <span>{formatCallTime(call.startTime)}</span>
                                        <span>· {fmtDuration(call.durationSeconds)}</span>
                                        {nextStep && nextStep !== "none" && (
                                            <span className={cn("truncate", nextStep === "video_request" ? "text-emerald-600 font-medium" : "")}>
                                                · {formatNextStep(nextStep)}
                                            </span>
                                        )}
                                        {call.jobSummary && (
                                            <span className="truncate text-zinc-400">· {call.jobSummary}</span>
                                        )}
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-1.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                    <button
                                        title="Send WhatsApp video request"
                                        onClick={() => whatsappVideoRequest(call)}
                                        className="p-1.5 rounded-lg bg-green-50 text-green-600 border border-green-200 hover:bg-green-100"
                                    >
                                        <FaWhatsapp className="w-4 h-4" />
                                    </button>
                                    <button
                                        title="Build quote from this call"
                                        onClick={() => navigate(buildQuoteHref(call))}
                                        className="p-1.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100"
                                    >
                                        <FilePlus2 className="w-4 h-4" />
                                    </button>
                                    <button
                                        title="Review call"
                                        onClick={() => navigate(`/admin/calls/${call.id}/review`)}
                                        className="p-1.5 rounded-lg bg-muted text-zinc-500 border hover:text-zinc-800"
                                    >
                                        <ExternalLink className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Pagination (server-side; note lane filter is within-page) */}
            {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                    <button
                        disabled={page <= 1}
                        onClick={() => setPage((p) => p - 1)}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-card border disabled:opacity-30 text-zinc-500"
                    >
                        <ChevronLeft className="w-3.5 h-3.5" /> Prev
                    </button>
                    <span className="text-xs text-zinc-500">{page} / {pagination.totalPages}</span>
                    <button
                        disabled={page >= pagination.totalPages}
                        onClick={() => setPage((p) => p + 1)}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-card border disabled:opacity-30 text-zinc-500"
                    >
                        Next <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                </div>
            )}

            <CallDetailsModal
                open={!!selectedCallId}
                callId={selectedCallId}
                onClose={() => setSelectedCallId(null)}
            />
        </div>
    );
}

// ─── Hub shell ───────────────────────────────────────────────────────────
export default function CallsHubPage() {
    const searchStr = useSearch();
    const [, navigate] = useLocation();
    const activeTab = new URLSearchParams(searchStr).get("tab") === "insights" ? "insights" : "list";

    const setTab = (tab: "list" | "insights") => {
        navigate(tab === "list" ? "/admin/calls" : "/admin/calls?tab=insights", { replace: true });
    };

    return (
        <div className="max-w-6xl mx-auto p-4 lg:p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Phone className="w-5 h-5 text-zinc-500" />
                    <h1 className="text-xl font-bold text-foreground">Calls</h1>
                </div>
            </div>

            {/* Tab switcher */}
            <div className="flex items-center gap-1 border-b">
                {(["list", "insights"] as const).map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setTab(tab)}
                        className={cn(
                            "px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors",
                            activeTab === tab
                                ? "border-foreground text-foreground"
                                : "border-transparent text-zinc-500 hover:text-zinc-700",
                        )}
                    >
                        {tab === "list" ? "Call log" : "Insights"}
                    </button>
                ))}
            </div>

            {activeTab === "list" ? <CallsListTab /> : <CallInsights />}
        </div>
    );
}
