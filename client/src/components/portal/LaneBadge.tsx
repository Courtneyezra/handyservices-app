import { cn } from '@/lib/utils';

/**
 * The clerk's verdict as a lane chip — never a score.
 *
 * Takes any string on purpose: lanes the portal does not know yet (decline proposals, T6a)
 * render as a harmless neutral chip instead of crashing or hiding the row.
 */
const LANE_UI: Record<string, { label: string; chip: string }> = {
    quote_ready: { label: 'Quote ready', chip: 'bg-emerald-600 text-white' },
    quote_pending: { label: 'Researching...', chip: 'bg-blue-500 text-white' },
    needs_info: { label: 'Needs info', chip: 'bg-amber-500 text-white' },
    visit_first: { label: 'Visit first', chip: 'bg-slate-700 text-white' },
};

/** One-line explanation of what a lane means; empty for unknown lanes. */
export const LANE_BLURB: Record<string, string> = {
    quote_ready: 'Everything needed to price this is in the thread.',
    quote_pending: 'Background research in progress. Ready for pricing soon.',
    needs_info: 'These answers change the price or the scope. Ask before you send.',
    visit_first: 'This one cannot be priced honestly from the thread. Book a visit, not a guess.',
};

export function LaneBadge({ lane, className }: { lane: string; className?: string }) {
    const ui = LANE_UI[lane] ?? { label: lane.replace(/_/g, ' '), chip: 'bg-slate-200 text-slate-700' };
    return (
        <span className={cn(
            'inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide',
            ui.chip,
            className,
        )}>
            {ui.label}
        </span>
    );
}
