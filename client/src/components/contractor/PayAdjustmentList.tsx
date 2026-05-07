/**
 * PayAdjustmentList — sectioned list of pay adjustments for the contractor.
 *
 * Module 07 — Pay Protection. Sections in priority order:
 *   1. Pending review (gold border) — front and centre.
 *   2. Auto-approved + Admin-approved (treated together as "approved").
 *   3. Rejected (collapsible, muted).
 *
 * Empty state: friendly "Nothing yet" placeholder so the contractor knows
 * the feature exists but has nothing to show.
 */
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import PayAdjustmentCard, { type PayAdjustment } from './PayAdjustmentCard';

const NAVY = '#1B2A4A';
const BORDER = '#D0D5E3';
const MUTED = '#6B7280';
const BG_LIGHT = '#F7F8FC';

interface Props {
    adjustments: PayAdjustment[];
}

export default function PayAdjustmentList({ adjustments }: Props) {
    const [showRejected, setShowRejected] = useState(false);

    const pending = adjustments.filter(a => a.status === 'pending_review');
    const approved = adjustments.filter(
        a => a.status === 'auto_approved' || a.status === 'admin_approved',
    );
    const rejected = adjustments.filter(a => a.status === 'rejected');

    if (adjustments.length === 0) {
        return (
            <div
                className="rounded-2xl border p-8 text-center"
                style={{ borderColor: BORDER, backgroundColor: BG_LIGHT }}
            >
                <p className="text-[14px] font-bold" style={{ color: NAVY }}>No claims yet</p>
                <p className="text-[12px] mt-1" style={{ color: MUTED }}>
                    Open a new claim if you've had a mis-scope, call-out or materials run.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            {pending.length > 0 && (
                <Section title="Active claims" subtitle="Awaiting admin review">
                    <div className="space-y-2">
                        {pending.map(a => (
                            <PayAdjustmentCard key={a.id} adjustment={a} accent />
                        ))}
                    </div>
                </Section>
            )}

            {approved.length > 0 && (
                <Section title="Recent adjustments" subtitle={`${approved.length} approved`}>
                    <div className="space-y-2">
                        {approved.map(a => (
                            <PayAdjustmentCard key={a.id} adjustment={a} />
                        ))}
                    </div>
                </Section>
            )}

            {rejected.length > 0 && (
                <Section title="Rejected" subtitle={`${rejected.length}`}>
                    <button
                        type="button"
                        onClick={() => setShowRejected(v => !v)}
                        className="w-full flex items-center justify-between rounded-xl px-3 py-2 hover:bg-white border"
                        style={{ borderColor: BORDER, color: MUTED }}
                    >
                        <span className="text-[12px] font-semibold">
                            {showRejected ? 'Hide' : 'Show'} rejected claims
                        </span>
                        <ChevronDown
                            className={`h-4 w-4 transition-transform ${showRejected ? 'rotate-180' : ''}`}
                        />
                    </button>
                    {showRejected && (
                        <div className="space-y-2 mt-2">
                            {rejected.map(a => (
                                <PayAdjustmentCard key={a.id} adjustment={a} accent={false} />
                            ))}
                        </div>
                    )}
                </Section>
            )}
        </div>
    );
}

function Section({
    title,
    subtitle,
    children,
}: {
    title: string;
    subtitle?: string;
    children: React.ReactNode;
}) {
    return (
        <section className="space-y-2">
            <div className="flex items-baseline justify-between">
                <h3 className="text-[12px] font-bold uppercase tracking-[0.06em]" style={{ color: NAVY }}>
                    {title}
                </h3>
                {subtitle && (
                    <span className="text-[11px]" style={{ color: MUTED }}>
                        {subtitle}
                    </span>
                )}
            </div>
            {children}
        </section>
    );
}
