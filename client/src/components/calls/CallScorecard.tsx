/**
 * CallScorecard - Compact AI call-quality scorecard panel
 *
 * Renders the call's aiScoreJson: overall score chip, the 4 dimension
 * scores as horizontal bars with evidence quotes, flags, and the
 * coaching note. Used by CallReviewPage and CallPerformancePage.
 */

import { AlertTriangle, ClipboardCheck, Video } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types (mirror of server aiScoreJson shape) ──────────────────────────

export interface AiScoreDimension {
    score?: number | null;
    evidence?: string;
    captured?: Record<string, boolean>;
    nextStepSecured?: string;
}

export interface AiScoreJson {
    overall?: number | null;
    dimensions?: {
        discovery?: AiScoreDimension;
        conversionBehaviour?: AiScoreDimension;
        rapport?: AiScoreDimension;
        accuracy?: AiScoreDimension;
    };
    flags?: string[];
    coachingNote?: string;
}

/** Safely parse aiScoreJson which may arrive as an object or a JSON string. */
export function parseAiScore(raw: unknown): AiScoreJson | null {
    if (!raw) return null;
    if (typeof raw === "string") {
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? (parsed as AiScoreJson) : null;
        } catch {
            return null;
        }
    }
    if (typeof raw === "object") return raw as AiScoreJson;
    return null;
}

// ─── Score helpers ───────────────────────────────────────────────────────

/** Chip classes: green >=70, amber 40-69, red <40, muted when no data. */
export function scoreChipClass(score: number | null | undefined): string {
    if (score == null) return "bg-white/10 text-white/40 border-white/10";
    if (score >= 70) return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    if (score >= 40) return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    return "bg-red-500/20 text-red-400 border-red-500/30";
}

/** Light-theme chip variant — for pages on a light background (dashboard). */
export function scoreChipClassLight(score: number | null | undefined): string {
    if (score == null) return "bg-zinc-100 text-zinc-400 border-zinc-200";
    if (score >= 70) return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (score >= 40) return "bg-amber-50 text-amber-700 border-amber-200";
    return "bg-red-50 text-red-700 border-red-200";
}

export function scoreBarClass(score: number | null | undefined): string {
    if (score == null) return "bg-white/20";
    if (score >= 70) return "bg-emerald-500";
    if (score >= 40) return "bg-amber-500";
    return "bg-red-500";
}

export function formatFlag(flag: string): string {
    return flag.replace(/_/g, " ");
}

export function formatNextStep(step: string | null | undefined): string {
    switch (step) {
        case "video_request": return "Video via WhatsApp";
        case "instant_quote": return "Instant quote";
        case "site_visit": return "Site visit";
        case "callback": return "Callback";
        case "none": return "No next step";
        default: return step ? step.replace(/_/g, " ") : "—";
    }
}

const DIMENSIONS = [
    { key: "discovery", label: "Discovery" },
    { key: "conversionBehaviour", label: "Conversion" },
    { key: "rapport", label: "Rapport" },
    { key: "accuracy", label: "Accuracy" },
] as const;

// ─── Component ───────────────────────────────────────────────────────────

interface CallScorecardProps {
    score: AiScoreJson;
    className?: string;
}

export default function CallScorecard({ score, className }: CallScorecardProps) {
    const flags = score.flags || [];
    const nextStep = score.dimensions?.conversionBehaviour?.nextStepSecured;

    return (
        <div className={cn("bg-white/5 border border-white/10 rounded-xl p-3 space-y-3", className)}>
            {/* Header + overall chip */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <ClipboardCheck className="w-4 h-4 text-white/50" />
                    <h3 className="text-sm font-semibold text-white/60">Call Scorecard</h3>
                </div>
                <span className={cn(
                    "px-2 py-0.5 rounded-md border text-sm font-bold font-mono",
                    scoreChipClass(score.overall)
                )}>
                    {score.overall != null ? score.overall : "—"}
                </span>
            </div>

            {/* Next step secured */}
            {nextStep && (
                <div className={cn(
                    "flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium",
                    nextStep === "video_request"
                        ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                        : nextStep === "none"
                            ? "bg-white/5 text-white/40 border border-white/10"
                            : "bg-blue-500/15 text-blue-400 border border-blue-500/30"
                )}>
                    <Video className="w-3.5 h-3.5 flex-shrink-0" />
                    Next step: {formatNextStep(nextStep)}
                </div>
            )}

            {/* Dimension bars with evidence */}
            <div className="space-y-2.5">
                {DIMENSIONS.map(({ key, label }) => {
                    const dim = score.dimensions?.[key];
                    const value = dim?.score;
                    return (
                        <div key={key}>
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-xs text-white/60">{label}</span>
                                <span className="text-xs font-mono text-white/70">
                                    {value != null ? value : "—"}
                                </span>
                            </div>
                            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                                <div
                                    className={cn("h-full rounded-full transition-all", scoreBarClass(value))}
                                    style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }}
                                />
                            </div>
                            {dim?.evidence && (
                                <p
                                    className="mt-1 text-[11px] italic text-white/40 line-clamp-2"
                                    title={dim.evidence}
                                >
                                    “{dim.evidence}”
                                </p>
                            )}
                            {/* Tone match: sub-score of rapport (scorecard v3+) — did the
                                handler match the caller's energy and communication style? */}
                            {key === "rapport" && (dim as any)?.toneMatch?.score != null && (
                                <div className="mt-1.5 ml-3 pl-2 border-l border-white/10">
                                    <div className="flex items-center justify-between mb-0.5">
                                        <span className="text-[11px] text-white/45">Tone match</span>
                                        <span className="text-[11px] font-mono text-white/55">
                                            {(dim as any).toneMatch.score}
                                        </span>
                                    </div>
                                    <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                                        <div
                                            className={cn("h-full rounded-full transition-all", scoreBarClass((dim as any).toneMatch.score))}
                                            style={{ width: `${Math.max(0, Math.min(100, (dim as any).toneMatch.score))}%` }}
                                        />
                                    </div>
                                    {(dim as any).toneMatch.evidence && (
                                        <p className="mt-0.5 text-[10px] italic text-white/35 line-clamp-1" title={(dim as any).toneMatch.evidence}>
                                            “{(dim as any).toneMatch.evidence}”
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Flags */}
            {flags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {flags.map((flag) => (
                        <span
                            key={flag}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-400 text-[10px] font-medium"
                        >
                            <AlertTriangle className="w-3 h-3" />
                            {formatFlag(flag)}
                        </span>
                    ))}
                </div>
            )}

            {/* Coaching note */}
            {score.coachingNote && (
                <div className="px-2.5 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-400/80 mb-0.5">
                        Coaching note
                    </p>
                    <p className="text-xs text-amber-100/80 leading-relaxed">{score.coachingNote}</p>
                </div>
            )}
        </div>
    );
}
