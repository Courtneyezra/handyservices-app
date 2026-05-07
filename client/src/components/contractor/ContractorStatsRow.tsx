/**
 * ContractorStatsRow — reusable horizontal row of 3–4 stat cards
 * shared by Module 09 dashboards (Builder day-packs, Specialist queue,
 * Earnings tab). Module 13 brand styling: navy text on white card with
 * a yellow accent for the value. No external state — pure presentational.
 *
 * Per docs/architecture/modules/09-contractor-app-v2.md §3.
 */

import { ReactNode } from 'react';

export interface StatCard {
    label: string;
    value: ReactNode;
    sublabel?: ReactNode;
    /** Optional small badge next to the value, e.g. "+12%". */
    trend?: { text: string; tone: 'positive' | 'negative' | 'neutral' } | null;
    /** Optional click handler — turns the card into a button. */
    onClick?: () => void;
}

interface Props {
    stats: StatCard[];
    /** Optional layout: 'grid' (default, equal cols) or 'scroll' (horizontal). */
    layout?: 'grid' | 'scroll';
}

const NAVY = '#1B2A4A';
const YELLOW = '#F5A623';
const BORDER = '#D0D5E3';
const MUTED = '#6B7280';

export default function ContractorStatsRow({ stats, layout = 'grid' }: Props) {
    if (stats.length === 0) return null;

    // Tailwind JIT needs literal class strings — keep these whitelisted.
    const gridColsByCount: Record<number, string> = {
        1: 'grid gap-2 grid-cols-1',
        2: 'grid gap-2 grid-cols-2',
        3: 'grid gap-2 grid-cols-3',
        4: 'grid gap-2 grid-cols-4',
    };
    const containerClass =
        layout === 'scroll'
            ? 'flex gap-2 overflow-x-auto pb-1 -mx-4 px-4'
            : gridColsByCount[Math.min(stats.length, 4)] ?? 'grid gap-2 grid-cols-3';

    return (
        <div className={containerClass} data-testid="contractor-stats-row">
            {stats.map((s, i) => {
                const trendColor =
                    s.trend?.tone === 'positive'
                        ? 'text-emerald-600'
                        : s.trend?.tone === 'negative'
                            ? 'text-red-500'
                            : 'text-slate-500';
                const inner = (
                    <div className="flex flex-col h-full">
                        <p
                            className="text-[10px] uppercase tracking-[0.06em] font-bold mb-1"
                            style={{ color: MUTED }}
                        >
                            {s.label}
                        </p>
                        <div className="flex items-baseline gap-1.5">
                            <p
                                className="text-xl sm:text-2xl font-bold tabular-nums leading-tight"
                                style={{ color: NAVY }}
                            >
                                {s.value}
                            </p>
                            {s.trend && (
                                <span className={`text-[11px] font-semibold ${trendColor}`}>
                                    {s.trend.text}
                                </span>
                            )}
                        </div>
                        {s.sublabel && (
                            <p className="text-[11px] mt-1" style={{ color: MUTED }}>
                                {s.sublabel}
                            </p>
                        )}
                    </div>
                );
                const cardClass =
                    'bg-white rounded-xl border p-3 sm:p-4 min-w-[120px] flex-1';
                if (s.onClick) {
                    return (
                        <button
                            key={i}
                            onClick={s.onClick}
                            className={`${cardClass} text-left active:scale-[0.99] transition-transform`}
                            style={{ borderColor: BORDER }}
                            onMouseEnter={e => (e.currentTarget.style.borderColor = YELLOW)}
                            onMouseLeave={e => (e.currentTarget.style.borderColor = BORDER)}
                        >
                            {inner}
                        </button>
                    );
                }
                return (
                    <div
                        key={i}
                        className={cardClass}
                        style={{ borderColor: BORDER }}
                    >
                        {inner}
                    </div>
                );
            })}
        </div>
    );
}
