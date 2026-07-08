/**
 * CallPerformancePage - VA Call Performance dashboard
 *
 * Feedback & training surface for phone conversions. Viewed by the owner
 * (admin) and Ben the VA — both see the same data.
 *
 * The win condition for every call: the caller agrees to send photos/video
 * via WhatsApp ('video_request'). The AI-agent lane exists because missed
 * VA calls fall back to an Eleven Labs AI agent — the VA-vs-AI comparison
 * is training material, not shaming.
 *
 * Data: GET /api/calls/va-overview?period=week|month|all
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
    Phone, PhoneMissed, Timer, Bot, Headset, Video,
    Lightbulb, AlertTriangle, Loader2, ExternalLink, TrendingUp,
    FilePlus2,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
    scoreChipClassLight,
    scoreBarClass,
    formatFlag,
    formatNextStep,
} from "@/components/calls/CallScorecard";

// ─── Types (contract of GET /api/calls/va-overview) ─────────────────────

interface DimensionScores {
    discovery: number | null;
    conversionBehaviour: number | null;
    rapport: number | null;
    accuracy: number | null;
}

interface LaneScores {
    count: number | null;
    avgOverall: number | null;
    dimensions: DimensionScores | null;
}

interface VaOverview {
    totals: {
        total: number | null;
        va: number | null;
        aiAgent: number | null;
        missed: number | null;
        missedNoAnswer: number | null;
        missedAbandoned: number | null;
        voicemail: number | null;
        unclassified: number | null;
        answeredRatePct: number | null;
    };
    answerTime: {
        avgSeconds: number | null;
        p90Seconds: number | null;
        within15sPct: number | null;
    };
    callLength: {
        vaAvgSeconds: number | null;
        aiAvgSeconds: number | null;
    };
    scores: {
        va: LaneScores | null;
        aiAgent: LaneScores | null;
    };
    nextSteps: Record<string, number | null>;
    discoveryCaptureRates: {
        name: number | null;
        phone: number | null;
        postcode: number | null;
        jobDescription: number | null;
        urgency: number | null;
    };
    flags: Array<{ flag: string; count: number | null }>;
    coachingThemes: string[];
    trend: Array<{
        weekStart: string;
        total: number | null;
        missed: number | null;
        vaAvgScore: number | null;
        aiAvgScore: number | null;
    }>;
    recentScored: Array<{
        id: string;
        customerName: string | null;
        startTime: string | null;
        handledBy: string | null;
        overall: number | null;
        nextStepSecured: string | null;
        coachingNote: string | null;
        flags: string[];
    }>;
    perVa?: Array<{
        userId: string | null;
        name: string;
        answered: number;
        scored: number;
        avgOverall: number | null;
        videoRequests: number;
        videoRequestPct: number | null;
        avgAnswerSeconds: number | null;
    }>;
}

type Period = "today" | "yesterday" | "week" | "month" | "all";

// ─── Formatting helpers (any numeric field can be null → em-dash) ───────

const DASH = "—";

function fmtNum(n: number | null | undefined): string {
    return n == null ? DASH : String(n);
}

function fmtPct(n: number | null | undefined): string {
    return n == null ? DASH : `${Math.round(n)}%`;
}

function fmtSecs(n: number | null | undefined): string {
    if (n == null) return DASH;
    if (n < 60) return `${Math.round(n)}s`;
    const mins = Math.floor(n / 60);
    const secs = Math.round(n % 60);
    return `${mins}m ${secs}s`;
}

const DIMENSION_LABELS: Array<{ key: keyof DimensionScores; label: string }> = [
    { key: "discovery", label: "Discovery" },
    { key: "conversionBehaviour", label: "Conversion" },
    { key: "rapport", label: "Rapport" },
    { key: "accuracy", label: "Accuracy" },
];

const NEXT_STEP_ORDER = ["video_request", "instant_quote", "site_visit", "callback", "none"];

const CAPTURE_LABELS: Array<{ key: keyof VaOverview["discoveryCaptureRates"]; label: string }> = [
    { key: "name", label: "Name" },
    { key: "phone", label: "Phone" },
    { key: "postcode", label: "Postcode" },
    { key: "jobDescription", label: "Job description" },
    { key: "urgency", label: "Urgency" },
];

// ─── Small building blocks ───────────────────────────────────────────────

function Panel({ title, icon: Icon, children, className }: {
    title: string;
    icon?: React.ElementType;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("bg-card border rounded-xl p-4 shadow-sm", className)}>
            <div className="flex items-center gap-2 mb-3">
                {Icon && <Icon className="w-4 h-4 text-zinc-500" />}
                <h2 className="text-sm font-semibold text-zinc-700">{title}</h2>
            </div>
            {children}
        </div>
    );
}

function KpiCard({ label, value, sub, icon: Icon, accent }: {
    label: string;
    value: string;
    sub?: string;
    icon: React.ElementType;
    accent?: "green" | "red" | "amber" | "blue";
}) {
    const accentClass =
        accent === "green" ? "text-emerald-600" :
        accent === "red" ? "text-red-600" :
        accent === "amber" ? "text-amber-500" :
        accent === "blue" ? "text-blue-600" :
        "text-foreground";
    return (
        <div className="bg-card border rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
                <Icon className="w-3.5 h-3.5 text-zinc-500" />
                <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{label}</span>
            </div>
            <p className={cn("text-2xl font-bold font-mono leading-none", accentClass)}>{value}</p>
            {sub && <p className="text-[11px] text-zinc-500 mt-1.5">{sub}</p>}
        </div>
    );
}

function ProgressBar({ value, barClass }: { value: number | null | undefined; barClass?: string }) {
    return (
        <div className="h-2 rounded-full bg-zinc-200 overflow-hidden">
            <div
                className={cn("h-full rounded-full transition-all", barClass || scoreBarClass(value))}
                style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }}
            />
        </div>
    );
}

function LaneColumn({ title, icon: Icon, lane, barClass, badgeClass }: {
    title: string;
    icon: React.ElementType;
    lane: LaneScores | null;
    barClass: string;
    badgeClass: string;
}) {
    return (
        <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-3">
                <span className={cn("inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold", badgeClass)}>
                    <Icon className="w-3.5 h-3.5" />
                    {title}
                </span>
                <div className="flex items-center gap-2">
                    <span className="text-[11px] text-zinc-500">
                        {lane?.count != null ? `${lane.count} scored` : "no data"}
                    </span>
                    <span className={cn("px-2 py-0.5 rounded-md border text-sm font-bold font-mono", scoreChipClassLight(lane?.avgOverall))}>
                        {fmtNum(lane?.avgOverall)}
                    </span>
                </div>
            </div>
            <div className="space-y-2.5">
                {DIMENSION_LABELS.map(({ key, label }) => {
                    const value = lane?.dimensions?.[key];
                    return (
                        <div key={key}>
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-xs text-zinc-600">{label}</span>
                                <span className="text-xs font-mono text-zinc-600">{fmtNum(value)}</span>
                            </div>
                            <ProgressBar value={value} barClass={value == null ? "bg-zinc-300" : barClass} />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Page ────────────────────────────────────────────────────────────────

const PERIODS: Array<{ id: Period; label: string }> = [
    { id: "today", label: "Today" },
    { id: "yesterday", label: "Yesterday" },
    { id: "week", label: "This week" },
    { id: "month", label: "This month" },
    { id: "all", label: "All time" },
];

// Insights tab body of the Calls hub. (Formerly the standalone
// CallPerformancePage; /admin/call-performance now redirects into the hub.)
export function CallInsights() {
    const [period, setPeriod] = useState<Period>("month");
    const [expandedNote, setExpandedNote] = useState<string | null>(null);

    const { data, isLoading, isError } = useQuery<VaOverview>({
        queryKey: ["va-overview", period],
        queryFn: async () => {
            const res = await fetch(`/api/calls/va-overview?period=${period}`);
            if (!res.ok) throw new Error("Failed to fetch call performance overview");
            return res.json();
        },
    });

    if (isLoading) {
        return (
            <div className="flex justify-center py-24">
                <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
            </div>
        );
    }

    if (isError || !data) {
        return (
            <div className="flex flex-col items-center gap-3 py-24 text-center">
                <AlertTriangle className="w-8 h-8 text-red-600" />
                <p className="text-sm text-zinc-600">Couldn't load call performance data. Try refreshing.</p>
            </div>
        );
    }

    const { totals, answerTime, callLength, scores, nextSteps, discoveryCaptureRates, flags, coachingThemes, trend, recentScored } = data;
    const perVa = data.perVa ?? [];

    const answeredCount = (totals.va ?? 0) + (totals.aiAgent ?? 0);
    const nextStepEntries = NEXT_STEP_ORDER
        .filter((k) => nextSteps && k in nextSteps)
        .map((k) => ({ key: k, count: nextSteps[k] ?? 0 }));
    // Include any unexpected extra keys the server may add
    Object.keys(nextSteps || {}).forEach((k) => {
        if (!NEXT_STEP_ORDER.includes(k)) nextStepEntries.push({ key: k, count: nextSteps[k] ?? 0 });
    });
    const nextStepTotal = nextStepEntries.reduce((sum, e) => sum + e.count, 0);
    const trendMax = Math.max(1, ...trend.map((w) => w.total ?? 0));

    return (
        <div className="max-w-6xl mx-auto space-y-4">
            {/* ─── Period selector (hub owns the page title) ─── */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <p className="text-xs text-zinc-500">
                    Every call has one goal: get photos or video on WhatsApp. Here's how we're doing.
                </p>
                <div className="flex items-center gap-1 bg-muted border rounded-lg p-1 self-start">
                    {PERIODS.map((p) => (
                        <button
                            key={p.id}
                            onClick={() => setPeriod(p.id)}
                            className={cn(
                                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                                period === p.id
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-zinc-500 hover:text-zinc-700"
                            )}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* ─── KPI cards ─── */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                <KpiCard
                    label="Answered rate"
                    value={fmtPct(totals.answeredRatePct)}
                    sub={totals.total != null ? `${answeredCount} of ${totals.total} calls` : undefined}
                    icon={Phone}
                    accent={totals.answeredRatePct != null && totals.answeredRatePct >= 50 ? "green" : "amber"}
                />
                <KpiCard
                    label="Missed calls"
                    value={fmtNum(totals.missed)}
                    sub={
                        [
                            totals.missedNoAnswer ? `${totals.missedNoAnswer} no-answer` : null,
                            totals.missedAbandoned ? `${totals.missedAbandoned} hung up <10s` : null,
                            totals.voicemail ? `${totals.voicemail} voicemail` : null,
                        ]
                            .filter(Boolean)
                            .join(" · ") || undefined
                    }
                    icon={PhoneMissed}
                    accent="red"
                />
                <KpiCard
                    label="Avg answer time"
                    value={fmtSecs(answerTime.avgSeconds)}
                    sub={
                        answerTime.within15sPct != null
                            ? `${fmtPct(answerTime.within15sPct)} within 15s (3 rings)`
                            : "No ring data yet — tracked on new calls"
                    }
                    icon={Timer}
                    accent={answerTime.within15sPct == null ? undefined : answerTime.within15sPct >= 80 ? "green" : "amber"}
                />
                <KpiCard
                    label="VA avg score"
                    value={fmtNum(scores.va?.avgOverall)}
                    sub={scores.va?.count != null ? `${scores.va.count} calls scored · avg ${fmtSecs(callLength.vaAvgSeconds)}` : undefined}
                    icon={Headset}
                    accent={scores.va?.avgOverall == null ? undefined : scores.va.avgOverall >= 70 ? "green" : scores.va.avgOverall >= 40 ? "amber" : "red"}
                />
                <KpiCard
                    label="AI avg score"
                    value={fmtNum(scores.aiAgent?.avgOverall)}
                    sub={scores.aiAgent?.count != null ? `${scores.aiAgent.count} calls scored · avg ${fmtSecs(callLength.aiAvgSeconds)}` : undefined}
                    icon={Bot}
                    accent="blue"
                />
                <KpiCard
                    label="Videos agreed"
                    value={fmtNum(nextSteps?.video_request)}
                    sub="WhatsApp photo/video — the win"
                    icon={Video}
                    accent="green"
                />
            </div>

            {/* ─── Per-VA leaderboard ─── */}
            {perVa.length > 0 && (
                <Panel title="By VA" icon={Headset}>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-zinc-200">
                                    <th className="text-left py-1.5 pr-3 font-semibold">VA</th>
                                    <th className="text-right py-1.5 px-2 font-semibold">Answered</th>
                                    <th className="text-right py-1.5 px-2 font-semibold">Avg score</th>
                                    <th className="text-right py-1.5 px-2 font-semibold">WhatsApp media</th>
                                    <th className="text-right py-1.5 pl-2 font-semibold">Avg answer</th>
                                </tr>
                            </thead>
                            <tbody>
                                {perVa.map((v) => (
                                    <tr key={v.userId ?? v.name} className="border-b border-zinc-200/60 last:border-0">
                                        <td className="py-2 pr-3 font-medium text-foreground">{v.name}</td>
                                        <td className="py-2 px-2 text-right tabular-nums text-zinc-700">{v.answered}</td>
                                        <td className="py-2 px-2 text-right">
                                            <span className={cn("px-1.5 py-0.5 rounded border text-xs font-bold font-mono", scoreChipClassLight(v.avgOverall))}>
                                                {fmtNum(v.avgOverall)}
                                            </span>
                                        </td>
                                        <td className="py-2 px-2 text-right tabular-nums">
                                            <span className={cn(v.videoRequestPct != null && v.videoRequestPct >= 50 ? "text-emerald-600 font-semibold" : "text-zinc-600")}>
                                                {fmtPct(v.videoRequestPct)}
                                            </span>
                                            <span className="text-zinc-400"> ({v.videoRequests})</span>
                                        </td>
                                        <td className="py-2 pl-2 text-right tabular-nums text-zinc-600">{fmtSecs(v.avgAnswerSeconds)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-2">Answered calls attributed to each VA. Missed calls have no owner and stay in the totals above.</p>
                </Panel>
            )}

            {/* ─── Coaching themes + flags ─── */}
            <Panel title="Coaching themes" icon={Lightbulb}>
                {coachingThemes.length === 0 && flags.length === 0 ? (
                    <p className="text-xs text-zinc-500">No coaching themes yet — scored calls will surface patterns here.</p>
                ) : (
                    <div className="space-y-3">
                        {coachingThemes.length > 0 && (
                            <ul className="space-y-1.5">
                                {coachingThemes.map((theme, i) => (
                                    <li key={i} className="flex items-start gap-2 text-sm text-zinc-700">
                                        <Lightbulb className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                                        {theme}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {flags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-1 border-t border-zinc-200">
                                {flags.map(({ flag, count }) => (
                                    <span
                                        key={flag}
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-500/10 border border-red-500/30 text-red-600 text-[11px] font-medium mt-2"
                                    >
                                        <AlertTriangle className="w-3 h-3" />
                                        {formatFlag(flag)}
                                        <span className="font-mono font-bold">×{fmtNum(count)}</span>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </Panel>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* ─── VA vs AI comparison ─── */}
                <Panel title="VA vs AI agent" icon={Bot}>
                    <p className="text-[11px] text-zinc-500 mb-3 -mt-1">
                        Missed calls fall back to the AI agent — its calls are training material, not competition.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-6">
                        <LaneColumn
                            title="VA (Ben)"
                            icon={Headset}
                            lane={scores.va}
                            barClass="bg-emerald-500"
                            badgeClass="bg-emerald-500/15 text-emerald-600 border border-emerald-500/30"
                        />
                        <LaneColumn
                            title="AI agent"
                            icon={Bot}
                            lane={scores.aiAgent}
                            barClass="bg-blue-500"
                            badgeClass="bg-blue-500/15 text-blue-600 border border-blue-500/30"
                        />
                    </div>
                </Panel>

                {/* ─── Next-step outcomes ─── */}
                <Panel title="Next-step outcomes" icon={Video}>
                    <p className="text-[11px] text-zinc-500 mb-3 -mt-1">
                        The goal of every call: caller agrees to send photos/video on WhatsApp.
                    </p>
                    {nextStepEntries.length === 0 ? (
                        <p className="text-xs text-zinc-500">No scored calls yet.</p>
                    ) : (
                        <div className="space-y-2.5">
                            {nextStepEntries.map(({ key, count }) => {
                                const isWin = key === "video_request";
                                const isNone = key === "none";
                                const share = nextStepTotal > 0 ? (count / nextStepTotal) * 100 : 0;
                                return (
                                    <div key={key}>
                                        <div className="flex items-center justify-between mb-1">
                                            <span className={cn(
                                                "text-xs flex items-center gap-1.5",
                                                isWin ? "text-emerald-600 font-semibold" : isNone ? "text-red-500" : "text-zinc-600"
                                            )}>
                                                {isWin && <Video className="w-3.5 h-3.5" />}
                                                {formatNextStep(key)}
                                                {isWin && (
                                                    <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30">
                                                        Goal
                                                    </span>
                                                )}
                                            </span>
                                            <span className="text-xs font-mono text-zinc-600">{count}</span>
                                        </div>
                                        <ProgressBar
                                            value={share}
                                            barClass={isWin ? "bg-emerald-500" : isNone ? "bg-red-500/60" : "bg-zinc-600"}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </Panel>

                {/* ─── Discovery capture rates ─── */}
                <Panel title="Discovery capture rates" icon={Phone}>
                    <p className="text-[11px] text-zinc-500 mb-3 -mt-1">
                        How often each key detail gets captured on scored calls.
                    </p>
                    <div className="space-y-2.5">
                        {CAPTURE_LABELS.map(({ key, label }) => {
                            const value = discoveryCaptureRates?.[key];
                            return (
                                <div key={key}>
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs text-zinc-600">{label}</span>
                                        <span className="text-xs font-mono text-zinc-600">{fmtPct(value)}</span>
                                    </div>
                                    <ProgressBar value={value} />
                                </div>
                            );
                        })}
                    </div>
                </Panel>

                {/* ─── Weekly trend ─── */}
                <Panel title="Weekly trend" icon={TrendingUp}>
                    {trend.length === 0 ? (
                        <p className="text-xs text-zinc-500">No trend data yet.</p>
                    ) : (
                        <div>
                            <div className="flex items-end gap-2 h-32">
                                {trend.map((week) => {
                                    const total = week.total ?? 0;
                                    const missed = Math.min(week.missed ?? 0, total);
                                    const answered = total - missed;
                                    return (
                                        <div
                                            key={week.weekStart}
                                            className="flex-1 flex flex-col justify-end h-full min-w-0"
                                            title={`Week of ${format(new Date(week.weekStart), "d MMM")}: ${total} calls, ${missed} missed${week.vaAvgScore != null ? `, VA score ${week.vaAvgScore}` : ""}${week.aiAvgScore != null ? `, AI score ${week.aiAvgScore}` : ""}`}
                                        >
                                            <div className="w-full flex flex-col justify-end rounded-t overflow-hidden" style={{ height: `${(total / trendMax) * 100}%` }}>
                                                <div className="w-full bg-red-500/50" style={{ height: total > 0 ? `${(missed / total) * 100}%` : 0 }} />
                                                <div className="w-full bg-emerald-500/70 flex-1" />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="flex gap-2 mt-1.5">
                                {trend.map((week) => (
                                    <div key={week.weekStart} className="flex-1 text-center min-w-0">
                                        <p className="text-[10px] text-zinc-500 truncate">
                                            {format(new Date(week.weekStart), "d MMM")}
                                        </p>
                                        <p className="text-[9px] font-mono text-zinc-600 truncate">
                                            {week.vaAvgScore != null || week.aiAvgScore != null
                                                ? `${week.vaAvgScore ?? "—"}/${week.aiAvgScore ?? "—"}`
                                                : ""}
                                        </p>
                                    </div>
                                ))}
                            </div>
                            <div className="flex items-center gap-4 mt-2 pt-2 border-t border-zinc-200">
                                <span className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                                    <span className="w-2 h-2 rounded-sm bg-emerald-500/70" /> Answered
                                </span>
                                <span className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                                    <span className="w-2 h-2 rounded-sm bg-red-500/50" /> Missed
                                </span>
                                <span className="text-[10px] text-zinc-600 ml-auto">Scores: VA / AI</span>
                            </div>
                        </div>
                    )}
                </Panel>
            </div>

            {/* ─── Recent scored calls ─── */}
            <Panel title="Recent scored calls" icon={Phone}>
                {recentScored.length === 0 ? (
                    <p className="text-xs text-zinc-500">No scored calls yet.</p>
                ) : (
                    <div className="overflow-x-auto -mx-4 px-4">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-zinc-200">
                                    <th className="py-2 pr-3">Time</th>
                                    <th className="py-2 pr-3">Customer</th>
                                    <th className="py-2 pr-3">Lane</th>
                                    <th className="py-2 pr-3">Score</th>
                                    <th className="py-2 pr-3">Next step</th>
                                    <th className="py-2 pr-3">Flags</th>
                                    <th className="py-2 pr-3">Coaching note</th>
                                    <th className="py-2" />
                                </tr>
                            </thead>
                            <tbody>
                                {recentScored.map((call) => {
                                    const isExpanded = expandedNote === call.id;
                                    const isVa = call.handledBy === "va";
                                    return (
                                        <tr key={call.id} className="border-b border-zinc-200/80 last:border-0 align-top">
                                            <td className="py-2.5 pr-3 text-xs text-zinc-600 whitespace-nowrap">
                                                {call.startTime ? format(new Date(call.startTime), "d MMM HH:mm") : DASH}
                                            </td>
                                            <td className="py-2.5 pr-3 text-xs text-zinc-200 max-w-[140px] truncate">
                                                {call.customerName || "Unknown"}
                                            </td>
                                            <td className="py-2.5 pr-3">
                                                <span className={cn(
                                                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold",
                                                    isVa
                                                        ? "bg-emerald-500/15 text-emerald-600 border border-emerald-500/30"
                                                        : "bg-blue-500/15 text-blue-600 border border-blue-500/30"
                                                )}>
                                                    {isVa ? <Headset className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                                                    {isVa ? "VA" : "AI"}
                                                </span>
                                            </td>
                                            <td className="py-2.5 pr-3">
                                                <span className={cn(
                                                    "inline-block px-1.5 py-0.5 rounded border text-xs font-bold font-mono",
                                                    scoreChipClassLight(call.overall)
                                                )}>
                                                    {fmtNum(call.overall)}
                                                </span>
                                            </td>
                                            <td className="py-2.5 pr-3 text-xs whitespace-nowrap">
                                                <span className={cn(
                                                    call.nextStepSecured === "video_request"
                                                        ? "text-emerald-600 font-medium"
                                                        : call.nextStepSecured === "none"
                                                            ? "text-red-600/70"
                                                            : "text-zinc-600"
                                                )}>
                                                    {formatNextStep(call.nextStepSecured)}
                                                </span>
                                            </td>
                                            <td className="py-2.5 pr-3">
                                                {call.flags.length > 0 ? (
                                                    <div className="flex flex-wrap gap-1 max-w-[160px]">
                                                        {call.flags.map((flag) => (
                                                            <span
                                                                key={flag}
                                                                className="px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/30 text-red-600 text-[9px] whitespace-nowrap"
                                                            >
                                                                {formatFlag(flag)}
                                                            </span>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-zinc-600">{DASH}</span>
                                                )}
                                            </td>
                                            <td className="py-2.5 pr-3 min-w-[180px] max-w-[280px]">
                                                {call.coachingNote ? (
                                                    <button
                                                        onClick={() => setExpandedNote(isExpanded ? null : call.id)}
                                                        title={call.coachingNote}
                                                        className={cn(
                                                            "text-left text-xs text-zinc-600 hover:text-zinc-200 transition-colors",
                                                            !isExpanded && "line-clamp-1"
                                                        )}
                                                    >
                                                        {call.coachingNote}
                                                    </button>
                                                ) : (
                                                    <span className="text-xs text-zinc-600">{DASH}</span>
                                                )}
                                            </td>
                                            <td className="py-2.5 text-right">
                                                <div className="inline-flex items-center gap-3">
                                                    {/* Opens the contextual generator linked to this call (no phone/job in this payload — the generator enriches via lookup) */}
                                                    <Link
                                                        href={`/admin/generate-contextual-quote?fromCallId=${encodeURIComponent(call.id)}${call.customerName ? `&name=${encodeURIComponent(call.customerName)}` : ""}`}
                                                        className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-900 transition-colors whitespace-nowrap"
                                                    >
                                                        <FilePlus2 className="w-3 h-3" /> Build quote
                                                    </Link>
                                                    <Link
                                                        href={`/admin/calls/${call.id}/review`}
                                                        className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-900 transition-colors whitespace-nowrap"
                                                    >
                                                        Review <ExternalLink className="w-3 h-3" />
                                                    </Link>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Panel>
        </div>
    );
}
