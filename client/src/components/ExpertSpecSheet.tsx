import React from 'react';
import { motion } from 'framer-motion';
import { Clock, Check } from 'lucide-react';

/** Splits job description text into bullet-point items */
function formatContent(content: string) {
    const taskVerbs = /^(fix|install|replace|repair|mount|hang|fit|paint|plaster|tile|seal|remove|build|assemble|check|clean|trim|gloss|sand|strip|patch|wire|connect|unblock)\b/i;
    const rawItems = content
        .split(/,\s*|;\s*|\n/)
        .map(s => s.trim())
        .filter(Boolean);

    const items: string[] = [];
    for (const item of rawItems) {
        const andParts = item.split(/\s+and\s+/i);
        if (andParts.length > 1 && andParts.every(p => taskVerbs.test(p.trim()))) {
            items.push(...andParts.map(p => p.trim()));
        } else {
            items.push(item);
        }
    }

    if (items.length > 1) {
        return items.map((item, i) => (
            <div key={i} className="flex items-start gap-2.5 mb-2 pl-1">
                <div className="w-1.5 h-1.5 rounded-full bg-[#7DB00E] mt-2 shrink-0" />
                <p className="text-slate-700 font-semibold leading-relaxed capitalize">{item}</p>
            </div>
        ));
    }

    return content.split('\n').map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-2" />;

        if (trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.match(/^\d+\./)) {
            return (
                <div key={i} className="flex items-start gap-2.5 mb-2 pl-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#7DB00E] mt-2 shrink-0" />
                    <p className="text-slate-700 font-semibold leading-relaxed">{trimmed.replace(/^[•\-\d\.]+\s*/, '')}</p>
                </div>
            );
        }

        return <p key={i} className="text-slate-700 font-bold leading-relaxed mb-3">{trimmed}</p>;
    });
}

/* ─── Scope of Works ─── */

interface PricingLineItem {
    lineId: string;
    description: string;
    category?: string;
    timeEstimateMinutes?: number;
    [key: string]: any;
}

interface ScopeOfWorksProps {
    text: string;
    summary?: string | null;
    proposalSummary?: string | null;
    pricingLineItems?: PricingLineItem[] | null;
    estimatorPhotoUrl?: string;
    className?: string;
}

export function ScopeOfWorks({ text, summary, proposalSummary, pricingLineItems, estimatorPhotoUrl, className = '' }: ScopeOfWorksProps) {
    const hasProposal = proposalSummary && proposalSummary.length > 0;
    const hasLineItems = pricingLineItems && pricingLineItems.length > 0;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={className}
        >
            <div className="bg-white rounded-xl p-5 md:p-6 border border-slate-200 shadow-sm relative">
                <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500 mb-4 text-center">Job summary</h3>
                {hasProposal ? (
                    <div>
                        <span className="text-3xl text-[#7DB00E] font-serif leading-none absolute left-4">{"\u201C"}</span>
                        <p className="text-slate-800 text-base md:text-lg font-semibold leading-relaxed pl-4">{proposalSummary}{"\u201D"}</p>
                    </div>
                ) : hasLineItems ? (
                    <div className="space-y-2.5">
                        {pricingLineItems.map((item) => (
                            <div key={item.lineId} className="flex items-start gap-3">
                                <div className="w-5 h-5 rounded-full bg-[#7DB00E]/10 flex items-center justify-center shrink-0 mt-0.5">
                                    <Check className="w-3 h-3 text-[#7DB00E]" strokeWidth={3} />
                                </div>
                                <p className="text-slate-700 text-sm md:text-base font-medium leading-relaxed">{item.description}</p>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-sm md:text-base">
                        {formatContent(text)}
                    </div>
                )}
                {estimatorPhotoUrl && (
                    <div className="flex items-center gap-2 justify-end mt-4 pt-3 border-t border-slate-100">
                        <div className="text-right">
                            <div className="text-sm font-bold text-slate-900">Ben</div>
                            <div className="text-[9px] font-bold uppercase text-[#7DB00E] tracking-wider">Estimator</div>
                        </div>
                        <div className="w-9 h-9 rounded-full border-2 border-[#7DB00E]/30 overflow-hidden shadow-sm">
                            <img src={estimatorPhotoUrl} alt="Ben" className="w-full h-full object-cover" />
                        </div>
                    </div>
                )}
            </div>
            {summary && (
                <p className="text-slate-500 text-sm leading-relaxed mt-3 px-1">{summary}</p>
            )}
        </motion.div>
    );
}

/* ─── Estimator Footer ─── */

interface EstimatorFooterProps {
    estimatorPhotoUrl?: string;
    className?: string;
}

export function EstimatorFooter({ estimatorPhotoUrl, className = '' }: EstimatorFooterProps) {
    return (
        <div className={`flex items-center justify-between px-1 ${className}`}>
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <Clock className="w-3 h-3" />
                <span>Quote valid 48h</span>
            </div>
            <div className="flex items-center gap-2">
                <div className="text-right">
                    <div className="text-sm font-bold text-slate-900">Ben</div>
                    <div className="text-[9px] font-bold uppercase text-[#7DB00E] tracking-wider">Estimator</div>
                </div>
                {estimatorPhotoUrl && (
                    <div className="w-9 h-9 rounded-full border-2 border-[#7DB00E]/30 overflow-hidden shadow-sm">
                        <img src={estimatorPhotoUrl} alt="Ben" className="w-full h-full object-cover" />
                    </div>
                )}
            </div>
        </div>
    );
}

/* ─── Legacy export (used in quick-mode layout) ─── */

interface ExpertSpecSheetProps {
    text: string;
    summary?: string | null;
    customerName?: string;
    address?: string | null;
    estimatorPhotoUrl?: string;
    className?: string;
    children?: React.ReactNode;
}

export function ExpertSpecSheet({
    text,
    summary,
    estimatorPhotoUrl,
    className = '',
    children
}: ExpertSpecSheetProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`w-full ${className}`}
        >
            <ScopeOfWorks text={text} summary={summary} />
            {children && <div className="mt-6">{children}</div>}
            <EstimatorFooter estimatorPhotoUrl={estimatorPhotoUrl} className="mt-4" />
        </motion.div>
    );
}
