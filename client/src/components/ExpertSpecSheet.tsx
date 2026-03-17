import React from 'react';
import { motion } from 'framer-motion';
import { Clock } from 'lucide-react';

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

interface ScopeOfWorksProps {
    text: string;
    summary?: string | null;
    className?: string;
}

export function ScopeOfWorks({ text, summary, className = '' }: ScopeOfWorksProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={className}
        >
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Your job list</h3>
            <div className="bg-white rounded-xl p-4 md:p-5 border border-slate-200 shadow-sm text-sm md:text-base">
                {formatContent(text)}
            </div>
            {summary && (
                <p className="text-slate-500 text-sm leading-relaxed mt-3 px-1">{summary}</p>
            )}
        </motion.div>
    );
}

/* ─── Estimator Footer ─── */

interface EstimatorFooterProps {
    mikePhotoUrl?: string;
    className?: string;
}

export function EstimatorFooter({ mikePhotoUrl, className = '' }: EstimatorFooterProps) {
    return (
        <div className={`flex items-center justify-between px-1 ${className}`}>
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <Clock className="w-3 h-3" />
                <span>Quote valid 48h</span>
            </div>
            <div className="flex items-center gap-2">
                <div className="text-right">
                    <div className="text-sm font-bold text-slate-900">Mike</div>
                    <div className="text-[9px] font-bold uppercase text-[#7DB00E] tracking-wider">Estimator</div>
                </div>
                {mikePhotoUrl && (
                    <div className="w-9 h-9 rounded-full border-2 border-[#7DB00E]/30 overflow-hidden shadow-sm">
                        <img src={mikePhotoUrl} alt="Mike" className="w-full h-full object-cover" />
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
    mikePhotoUrl?: string;
    className?: string;
    children?: React.ReactNode;
}

export function ExpertSpecSheet({
    text,
    summary,
    mikePhotoUrl,
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
            <EstimatorFooter mikePhotoUrl={mikePhotoUrl} className="mt-4" />
        </motion.div>
    );
}
