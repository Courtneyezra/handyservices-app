/**
 * QuoteBuilderPanel — slide-over panel for Ben to review and send quotes.
 *
 * Uses the estimator agent via POST /api/pricing/estimate-build (async start)
 * and GET /api/pricing/estimate-build/:id (poll status). Shows loading state
 * while research is running, and displays job lines with materials, time
 * estimates, and procedures.
 *
 * "Open in builder" hands the QuoteBuild to the contextual generator (sessionStorage +
 * ?conv=), which prices with the real engine; Ben confirms every line there. The old
 * POST /api/quotes/from-estimate (hardcoded rate, sent without Ben) was deleted in P8.
 *
 * Follows the slide-over patterns from CommsPage ThreadPanel and QuotePrepPanel.
 */
import { useEffect, useState } from 'react';
import {
    Sheet, SheetContent, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import {
    Loader2, Send, AlertCircle, FileText, Clock, Package, RefreshCw,
    CheckCircle2, ChevronDown, Sparkles, AlertTriangle, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQuoteResearch } from './useQuoteResearch';
import { JobLineCard } from './JobLineCard';
import type { EstimatedMaterial, QuoteBuild } from '@shared/quote-build';

function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

interface QuoteBuilderPanelProps {
    conversationId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called when quote is successfully sent/created. */
    onQuoteSent?: () => void;
}

/** Format pence as GBP. */
function formatPence(pence: number): string {
    return `\u00A3${(pence / 100).toFixed(2)}`;
}

export function QuoteBuilderPanel({
    conversationId,
    open,
    onOpenChange,
    onQuoteSent,
}: QuoteBuilderPanelProps) {
    const research = useQuoteResearch(conversationId);
    const [localBuild, setLocalBuild] = useState<QuoteBuild | null>(null);
    const [sending, setSending] = useState(false);
    const [sendError, setSendError] = useState<string | null>(null);
    const [sendSuccess, setSendSuccess] = useState(false);

    // Sync research data to local state (enables editing)
    useEffect(() => {
        if (research.data) {
            setLocalBuild(research.data);
        }
    }, [research.data]);

    // Reset state when conversation changes or panel opens
    useEffect(() => {
        if (open) {
            setSendError(null);
            setSendSuccess(false);
        }
    }, [open, conversationId]);

    // Handle materials change for a line
    const handleMaterialsChange = (lineIndex: number, materials: EstimatedMaterial[]) => {
        if (!localBuild) return;
        setLocalBuild({
            ...localBuild,
            lines: localBuild.lines.map((line) =>
                line.lineIndex === lineIndex ? { ...line, materials } : line
            ),
        });
    };

    // Calculate totals
    const totalMinutes = localBuild?.lines.reduce((sum, l) => sum + (l.time.minutes ?? 0), 0) ?? 0;
    const totalMaterialsPence = localBuild?.lines.reduce(
        (sum, l) => sum + l.materials.reduce(
            (mSum, m) => mSum + (m.unitPricePence ?? 0) * (m.qty ?? 1),
            0
        ),
        0
    ) ?? 0;
    const lowConfidenceCount = localBuild?.lines.filter((l) => l.time.confidence === 'low').length ?? 0;
    const unresolvedCount = localBuild?.lines.filter((l) => l.unresolved).length ?? 0;
    const needsReviewCount = localBuild?.lines.reduce(
        (sum, l) => sum + l.materials.filter((m) => m.needsReview).length,
        0
    ) ?? 0;

    // P8 (4 Sep 2026): /api/quotes/from-estimate is DELETED (it priced with a hardcoded rate and
    // sent without Ben). The estimate is handed to the contextual generator, which prices with
    // the real engine and where Ben confirms every line before anything is sent.
    const handleSendQuote = async () => {
        if (!localBuild) return;
        setSending(true);
        setSendError(null);
        try {
            sessionStorage.setItem('estimatorBuildHandoff', JSON.stringify({ conversationId, build: localBuild, at: new Date().toISOString() }));
            setSendSuccess(true);
            onQuoteSent?.();
            window.location.assign(`/admin/quotes/contextual?conv=${encodeURIComponent(conversationId)}`);
        } catch (err) {
            setSendError(err instanceof Error ? err.message : 'Could not open the builder');
        } finally {
            setSending(false);
        }
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="right"
                className="flex w-full flex-col p-0 sm:max-w-lg"
            >
                {/* Header */}
                <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                    <div>
                        <SheetTitle className="flex items-center gap-2 text-base font-bold text-slate-900">
                            <FileText className="h-4 w-4" />
                            Quote Builder
                        </SheetTitle>
                        <SheetDescription className="text-xs text-slate-500">
                            Review and send the estimated quote
                        </SheetDescription>
                    </div>
                    <button
                        type="button"
                        onClick={() => onOpenChange(false)}
                        className="rounded p-1 text-slate-400 hover:text-slate-600"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </header>

                {/* Content */}
                <div className="flex-1 overflow-y-auto">
                    {/* Loading state */}
                    {(research.isLoading || research.isResearching) && (
                        <div className="flex flex-col items-center justify-center py-16">
                            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                            <p className="mt-3 text-sm font-medium text-slate-600">
                                {research.isLoading ? 'Starting research...' : 'Researching materials & time...'}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                                This may take a minute or two
                            </p>
                        </div>
                    )}

                    {/* Error state */}
                    {research.error && !research.isResearching && (
                        <div className="p-4">
                            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                                <div className="flex items-center gap-2 text-sm font-semibold text-red-800">
                                    <AlertCircle className="h-4 w-4" />
                                    Research Failed
                                </div>
                                <p className="mt-1 text-xs text-red-700">{research.error}</p>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={research.start}
                                    className="mt-3"
                                >
                                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                                    Retry
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Empty state - no data and not loading */}
                    {!localBuild && !research.isLoading && !research.isResearching && !research.error && (
                        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                            <Sparkles className="h-10 w-10 text-slate-300" />
                            <p className="mt-3 text-sm font-medium text-slate-600">
                                Ready to research this quote
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                                Click below to analyze materials, time, and procedures
                            </p>
                            <Button
                                onClick={research.start}
                                className="mt-4"
                            >
                                <Sparkles className="mr-1.5 h-4 w-4" />
                                Start Research
                            </Button>
                        </div>
                    )}

                    {/* Build content */}
                    {localBuild && !research.isResearching && (
                        <div className="space-y-4 p-4">
                            {/* Summary bar */}
                            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-100 p-3">
                                <div className="flex items-center gap-1.5 text-xs">
                                    <FileText className="h-3.5 w-3.5 text-slate-500" />
                                    <span className="font-medium text-slate-700">
                                        {localBuild.lines.length} line{localBuild.lines.length !== 1 ? 's' : ''}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1.5 text-xs">
                                    <Clock className="h-3.5 w-3.5 text-slate-500" />
                                    <span className="font-medium text-slate-700">
                                        {totalMinutes < 60
                                            ? `${totalMinutes} min`
                                            : `${(totalMinutes / 60).toFixed(1)} hrs`}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1.5 text-xs">
                                    <Package className="h-3.5 w-3.5 text-slate-500" />
                                    <span className="font-medium text-slate-700">
                                        {formatPence(totalMaterialsPence)} materials
                                    </span>
                                </div>
                            </div>

                            {/* Warnings */}
                            {(lowConfidenceCount > 0 || unresolvedCount > 0 || needsReviewCount > 0) && (
                                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                                    <div className="flex items-center gap-2 text-xs font-semibold text-amber-800">
                                        <AlertTriangle className="h-3.5 w-3.5" />
                                        Items need attention
                                    </div>
                                    <ul className="mt-1.5 space-y-0.5 pl-5 text-xs text-amber-700">
                                        {lowConfidenceCount > 0 && (
                                            <li className="list-disc">
                                                {lowConfidenceCount} line{lowConfidenceCount !== 1 ? 's' : ''} with low confidence time estimates
                                            </li>
                                        )}
                                        {unresolvedCount > 0 && (
                                            <li className="list-disc">
                                                {unresolvedCount} unresolved item{unresolvedCount !== 1 ? 's' : ''}
                                            </li>
                                        )}
                                        {needsReviewCount > 0 && (
                                            <li className="list-disc">
                                                {needsReviewCount} material{needsReviewCount !== 1 ? 's' : ''} with unverified prices
                                            </li>
                                        )}
                                    </ul>
                                </div>
                            )}

                            {/* Agent summary */}
                            {research.summary && (
                                <div className="rounded-lg border border-slate-200 bg-white p-3">
                                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                                        <Sparkles className="h-3.5 w-3.5" />
                                        Research Summary
                                    </div>
                                    <p className="mt-1.5 text-xs text-slate-600 whitespace-pre-wrap">
                                        {research.summary}
                                    </p>
                                    {research.turns && (
                                        <p className="mt-2 text-[10px] text-slate-400">
                                            Completed in {research.turns} turn{research.turns !== 1 ? 's' : ''}
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Quote-level notes */}
                            {(localBuild.quoteNotes?.length ?? 0) > 0 && (
                                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                    <p className="text-xs font-semibold text-slate-700">Quote Notes</p>
                                    <ul className="mt-1.5 space-y-0.5 pl-4">
                                        {localBuild.quoteNotes!.map((note, i) => (
                                            <li key={i} className="list-disc text-xs text-slate-600">{note}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* Unresolved items */}
                            {(localBuild.unresolvedItems?.length ?? 0) > 0 && (
                                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                                    <div className="flex items-center gap-2 text-xs font-semibold text-red-800">
                                        <AlertCircle className="h-3.5 w-3.5" />
                                        Unresolved Items
                                    </div>
                                    <ul className="mt-1.5 space-y-0.5 pl-4">
                                        {localBuild.unresolvedItems!.map((item, i) => (
                                            <li key={i} className="list-disc text-xs text-red-700">{item}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* Job lines */}
                            <div className="space-y-3">
                                <h3 className="text-sm font-semibold text-slate-800">Job Lines</h3>
                                {localBuild.lines.map((line) => (
                                    <JobLineCard
                                        key={line.lineIndex}
                                        line={line}
                                        onMaterialsChange={handleMaterialsChange}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer with Send Quote */}
                {localBuild && !research.isResearching && (
                    <footer className="border-t border-slate-200 bg-white p-4">
                        {sendError && (
                            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
                                {sendError}
                            </div>
                        )}
                        {sendSuccess && (
                            <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5">
                                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Opened in the builder: price and send from there
                                </div>
                            </div>
                        )}
                        <div className="flex items-center gap-3">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={research.start}
                                disabled={sending || research.isResearching}
                            >
                                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                                Re-research
                            </Button>
                            <Button
                                onClick={handleSendQuote}
                                disabled={sending || sendSuccess}
                                className="flex-1"
                            >
                                {sending ? (
                                    <>
                                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                                        Opening...
                                    </>
                                ) : sendSuccess ? (
                                    <>
                                        <CheckCircle2 className="mr-1.5 h-4 w-4" />
                                        Opened in builder
                                    </>
                                ) : (
                                    <>
                                        <Send className="mr-1.5 h-4 w-4" />
                                        Open in builder to price
                                    </>
                                )}
                            </Button>
                        </div>
                    </footer>
                )}
            </SheetContent>
        </Sheet>
    );
}
