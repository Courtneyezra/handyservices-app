/**
 * JobLineCard — displays one estimated job line in the quote builder panel.
 *
 * Shows job title, materials list, time estimate with confidence badge,
 * procedure steps, and an expandable "Why?" section with reasoning.
 * Follows the card patterns from DraftApprovalCard.
 */
import { useState } from 'react';
import {
    ChevronDown, ChevronRight, Clock, Package, ListChecks, HelpCircle,
    AlertTriangle, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EstimatedLine, EstimatedMaterial, TimeEstimate } from '@shared/quote-build';
import { MaterialsEditor } from './MaterialsEditor';

interface JobLineCardProps {
    line: EstimatedLine;
    /** Called when materials are edited. */
    onMaterialsChange?: (lineIndex: number, materials: EstimatedMaterial[]) => void;
    /** Whether this card is expanded by default. */
    defaultExpanded?: boolean;
}

/** Format minutes as a readable duration. */
function formatDuration(mins: number): string {
    if (mins < 60) return `${mins} min`;
    const h = mins / 60;
    if (h < 8) return Number.isInteger(h) ? `${h} hour${h > 1 ? 's' : ''}` : `${h.toFixed(1)} hours`;
    const d = mins / 480;
    return Number.isInteger(d) ? `${d} day${d > 1 ? 's' : ''}` : `${d.toFixed(1)} days`;
}

/** Confidence badge styles. */
const CONFIDENCE_STYLES: Record<TimeEstimate['confidence'], { bg: string; text: string; icon: typeof CheckCircle2 }> = {
    high: { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: CheckCircle2 },
    medium: { bg: 'bg-amber-100', text: 'text-amber-700', icon: AlertCircle },
    low: { bg: 'bg-red-100', text: 'text-red-700', icon: AlertTriangle },
};

export function JobLineCard({ line, onMaterialsChange, defaultExpanded = true }: JobLineCardProps) {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const [whyOpen, setWhyOpen] = useState(false);

    const confidenceStyle = CONFIDENCE_STYLES[line.time.confidence];
    const ConfidenceIcon = confidenceStyle.icon;
    const materialsCost = line.materials.reduce(
        (sum, m) => sum + (m.unitPricePence ?? 0) * (m.qty ?? 1),
        0
    );

    return (
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            {/* Header */}
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex w-full items-start gap-3 p-3 text-left hover:bg-slate-50"
            >
                <span className="mt-0.5 shrink-0 text-slate-400">
                    {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-slate-900">{line.description}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        {line.category && (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium uppercase tracking-wide">
                                {line.category.replace(/_/g, ' ')}
                            </span>
                        )}
                        <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDuration(line.time.minutes)}
                        </span>
                        {line.materials.length > 0 && (
                            <span className="flex items-center gap-1">
                                <Package className="h-3 w-3" />
                                {line.materials.length} material{line.materials.length !== 1 ? 's' : ''}
                            </span>
                        )}
                    </div>
                </div>
                {/* Confidence badge */}
                <span className={cn(
                    'flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
                    confidenceStyle.bg, confidenceStyle.text
                )}>
                    <ConfidenceIcon className="h-3 w-3" />
                    {line.time.confidence}
                </span>
            </button>

            {expanded && (
                <div className="space-y-3 border-t border-slate-100 p-3">
                    {/* Time estimate detail */}
                    <div className="rounded-md bg-slate-50 p-2.5">
                        <div className="flex items-center gap-2 text-xs">
                            <Clock className="h-3.5 w-3.5 text-slate-500" />
                            <span className="font-semibold text-slate-700">Time Estimate</span>
                            <span className={cn(
                                'ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase',
                                confidenceStyle.bg, confidenceStyle.text
                            )}>
                                {line.time.basis}
                            </span>
                        </div>
                        <p className="mt-1.5 text-sm font-medium text-slate-900">
                            {formatDuration(line.time.minutes)}
                            {line.time.rangeMinutes && (
                                <span className="ml-1 text-xs font-normal text-slate-500">
                                    (range: {formatDuration(line.time.rangeMinutes[0])} - {formatDuration(line.time.rangeMinutes[1])})
                                </span>
                            )}
                        </p>
                        {line.time.note && (
                            <p className="mt-1 text-xs text-slate-500">{line.time.note}</p>
                        )}
                    </div>

                    {/* Materials */}
                    <div className="rounded-md bg-slate-50 p-2.5">
                        <div className="flex items-center gap-2 text-xs">
                            <Package className="h-3.5 w-3.5 text-slate-500" />
                            <span className="font-semibold text-slate-700">Materials</span>
                            {materialsCost > 0 && (
                                <span className="ml-auto text-xs font-medium text-slate-600">
                                    Total: {'\u00A3'}{(materialsCost / 100).toFixed(2)}
                                </span>
                            )}
                        </div>
                        <div className="mt-2">
                            <MaterialsEditor
                                materials={line.materials}
                                onChange={(materials) => onMaterialsChange?.(line.lineIndex, materials)}
                            />
                        </div>
                    </div>

                    {/* Procedure steps */}
                    {line.procedure.length > 0 && (
                        <div className="rounded-md bg-slate-50 p-2.5">
                            <div className="flex items-center gap-2 text-xs">
                                <ListChecks className="h-3.5 w-3.5 text-slate-500" />
                                <span className="font-semibold text-slate-700">Procedure</span>
                            </div>
                            <ol className="mt-2 space-y-1.5 pl-4">
                                {line.procedure.map((step, i) => (
                                    <li key={i} className="list-decimal text-xs text-slate-700">
                                        {step}
                                    </li>
                                ))}
                            </ol>
                        </div>
                    )}

                    {/* Assumptions */}
                    {line.assumptions.length > 0 && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5">
                            <div className="flex items-center gap-2 text-xs">
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                                <span className="font-semibold text-amber-800">Assumptions</span>
                            </div>
                            <ul className="mt-1.5 space-y-1 pl-4">
                                {line.assumptions.map((a, i) => (
                                    <li key={i} className="list-disc text-xs text-amber-700">{a}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Unresolved items */}
                    {line.unresolved && (
                        <div className="rounded-md border border-red-200 bg-red-50 p-2.5">
                            <div className="flex items-center gap-2 text-xs">
                                <AlertCircle className="h-3.5 w-3.5 text-red-600" />
                                <span className="font-semibold text-red-800">Unresolved</span>
                            </div>
                            <p className="mt-1 text-xs text-red-700">{line.unresolved}</p>
                        </div>
                    )}

                    {/* Why? reasoning (expandable) */}
                    {line.time.note && (
                        <button
                            type="button"
                            onClick={() => setWhyOpen((v) => !v)}
                            className="flex w-full items-center gap-2 rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-600 hover:bg-slate-50"
                        >
                            <HelpCircle className="h-3.5 w-3.5" />
                            <span className="font-medium">Why this estimate?</span>
                            {whyOpen ? <ChevronDown className="ml-auto h-3.5 w-3.5" /> : <ChevronRight className="ml-auto h-3.5 w-3.5" />}
                        </button>
                    )}
                    {whyOpen && line.time.note && (
                        <div className="rounded-md border border-slate-200 bg-white p-2.5 text-xs text-slate-600">
                            <p className="font-medium text-slate-800">Time estimate reasoning:</p>
                            <p className="mt-1">{line.time.note}</p>
                            {line.materials.some((m) => m.sourceNote) && (
                                <>
                                    <p className="mt-2 font-medium text-slate-800">Material sources:</p>
                                    <ul className="mt-1 space-y-0.5 pl-3">
                                        {line.materials.filter((m) => m.sourceNote).map((m, i) => (
                                            <li key={i} className="list-disc">
                                                <span className="font-medium">{m.name}:</span> {m.sourceNote}
                                            </li>
                                        ))}
                                    </ul>
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
