/**
 * EarningsView — earnings tab for all segments (Module 09 §4).
 *
 * Surfaces this-week / this-month totals, 30-day £/hr average, pending
 * payouts, last 10 payouts, plus a tax-ready CSV export.
 *
 * Uses existing endpoints:
 *   GET /api/contractor/earnings-summary
 *   GET /api/contractor/payouts
 *   GET /api/contractor/tax-summary
 *
 * If any return non-2xx the section degrades to a placeholder rather than
 * the whole tab failing.
 *
 * Module 13 brand styling — navy header, white cards on bgLight surface.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { format, startOfWeek } from 'date-fns';
import {
    AlertCircle,
    CalendarDays,
    Clock,
    Download,
    Loader2,
    PoundSterling,
    TrendingUp,
} from 'lucide-react';
import ContractorStatsRow, { type StatCard } from '@/components/contractor/ContractorStatsRow';

const NAVY = '#1B2A4A';
const NAVY_DEEP = '#152340';
const NAVY_DEEPEST = '#0E1933';
const YELLOW = '#F5A623';
const BG_LIGHT = '#F7F8FC';
const BORDER = '#D0D5E3';
const MUTED = '#6B7280';
const TEXT_DARK = '#111827';

interface EarningsSummary {
    thisMonth: { totalPence: number; jobCount: number };
    lastMonth: { totalPence: number; jobCount: number };
    pending: { totalPence: number; count: number; nextScheduledAt: string | null };
}

interface Payout {
    id: number | string;
    jobId?: number | null;
    quoteId?: string | null;
    grossAmountPence: number;
    platformFeePence?: number;
    netPayoutPence: number;
    status: string;
    failureReason?: string | null;
    heldReason?: string | null;
    scheduledPayoutAt?: string | null;
    paidAt?: string | null;
    createdAt: string;
    jobDescription?: string | null;
    jobDate?: string | null;
    customerName?: string | null;
}

interface TaxSummary {
    years: Array<{
        taxYear: string;
        totalGrossPence: number;
        totalPlatformFeePence: number;
        totalNetPayoutPence: number;
        totalJobs: number;
    }>;
}

const STATUS_BADGE: Record<string, { label: string; bg: string; fg: string }> = {
    paid:       { label: 'Paid',       bg: '#D1FAE5', fg: '#065F46' },
    pending:    { label: 'Pending',    bg: '#FEF3C7', fg: '#92591E' },
    processing: { label: 'Processing', bg: '#DBEAFE', fg: '#1E40AF' },
    held:       { label: 'Held',       bg: '#FED7AA', fg: '#9A3412' },
    failed:     { label: 'Failed',     bg: '#FEE2E2', fg: '#991B1B' },
    reversed:   { label: 'Reversed',   bg: '#F3F4F6', fg: '#6B7280' },
};

function fetchWithAuth<T>(url: string): Promise<T> {
    const token = localStorage.getItem('contractorToken')
        ?.trim()
        .replace(/[^a-zA-Z0-9._-]/g, '');
    return fetch(url, { headers: { Authorization: `Bearer ${token}` } }).then(res => {
        if (!res.ok) throw new Error(`Failed to fetch (${res.status})`);
        return res.json();
    });
}

function fmtPence(p: number): string {
    return `£${(p / 100).toFixed(2).replace(/\.00$/, '')}`;
}

export default function EarningsView() {
    const summaryQ = useQuery<EarningsSummary>({
        queryKey: ['/api/contractor/earnings-summary'],
        queryFn: () => fetchWithAuth<EarningsSummary>('/api/contractor/earnings-summary'),
    });

    const payoutsQ = useQuery<Payout[]>({
        queryKey: ['/api/contractor/payouts'],
        queryFn: () => fetchWithAuth<Payout[]>('/api/contractor/payouts'),
    });

    const taxQ = useQuery<TaxSummary>({
        queryKey: ['/api/contractor/tax-summary'],
        queryFn: () => fetchWithAuth<TaxSummary>('/api/contractor/tax-summary'),
    });

    // This-week roll-up from payouts (server doesn't expose week directly)
    const thisWeekPence = useMemo(() => {
        if (!payoutsQ.data) return 0;
        const monStart = startOfWeek(new Date(), { weekStartsOn: 1 });
        return payoutsQ.data
            .filter(p => {
                const when = p.paidAt ?? p.createdAt;
                if (!when) return false;
                const d = new Date(when);
                return d >= monStart && p.status !== 'failed' && p.status !== 'reversed';
            })
            .reduce((sum, p) => sum + (p.netPayoutPence ?? 0), 0);
    }, [payoutsQ.data]);

    // 30-day avg £/hr — best-effort. Until server returns real-work-minutes
    // (ADR-005), we use an approximation: jobs in last 30 days × 4h.
    const avgPerHourPence = useMemo(() => {
        if (!payoutsQ.data || payoutsQ.data.length === 0) return null;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 30);
        const recent = payoutsQ.data.filter(p => {
            const when = p.paidAt ?? p.createdAt;
            return when && new Date(when) >= cutoff;
        });
        if (recent.length === 0) return null;
        const total = recent.reduce((s, p) => s + (p.netPayoutPence ?? 0), 0);
        const hours = recent.length * 4;
        if (hours === 0) return null;
        return total / hours;
    }, [payoutsQ.data]);

    const summary = summaryQ.data;
    const lastMonthDelta = summary
        ? summary.lastMonth.totalPence > 0
            ? Math.round(
                ((summary.thisMonth.totalPence - summary.lastMonth.totalPence) /
                    summary.lastMonth.totalPence) *
                    100,
            )
            : null
        : null;

    const stats: StatCard[] = [
        {
            label: 'This week',
            value: fmtPence(thisWeekPence),
        },
        {
            label: 'This month',
            value: summary ? fmtPence(summary.thisMonth.totalPence) : '—',
            sublabel: summary ? `${summary.thisMonth.jobCount} jobs` : undefined,
            trend:
                lastMonthDelta != null
                    ? {
                        text: `${lastMonthDelta >= 0 ? '+' : ''}${lastMonthDelta}%`,
                        tone: lastMonthDelta >= 0 ? 'positive' : 'negative',
                    }
                    : null,
        },
        {
            label: 'Avg £/hr',
            value: avgPerHourPence ? fmtPence(avgPerHourPence) : '—',
            sublabel: '30-day average',
        },
        {
            label: 'Pending',
            value: summary ? fmtPence(summary.pending.totalPence) : '—',
            sublabel: summary
                ? `${summary.pending.count} payout${summary.pending.count === 1 ? '' : 's'}`
                : undefined,
        },
    ];

    const handleExport = () => {
        if (!payoutsQ.data || payoutsQ.data.length === 0) return;
        const lines = [
            'Payout ID,Date,Description,Customer,Gross,Net,Status',
            ...payoutsQ.data.map(p =>
                [
                    p.id,
                    (p.paidAt ?? p.jobDate ?? p.createdAt ?? '').toString().slice(0, 10),
                    `"${(p.jobDescription ?? '').replace(/"/g, '""')}"`,
                    `"${(p.customerName ?? '').replace(/"/g, '""')}"`,
                    (p.grossAmountPence / 100).toFixed(2),
                    (p.netPayoutPence / 100).toFixed(2),
                    p.status,
                ].join(','),
            ),
        ];
        const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `earnings-${format(new Date(), 'yyyy-MM-dd')}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleDownloadTaxSummary = () => {
        if (!taxQ.data?.years?.length) return;
        const lines = [
            'Tax Year,Gross,Platform Fee,Net Payout,Total Jobs',
            ...taxQ.data.years.map(y =>
                [
                    y.taxYear,
                    (y.totalGrossPence / 100).toFixed(2),
                    (y.totalPlatformFeePence / 100).toFixed(2),
                    (y.totalNetPayoutPence / 100).toFixed(2),
                    y.totalJobs,
                ].join(','),
            ),
        ];
        const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tax-summary-${new Date().getFullYear()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const recentPayouts = (payoutsQ.data ?? []).slice(0, 10);
    const allLoading = summaryQ.isLoading && payoutsQ.isLoading;

    return (
        <div
            className="min-h-screen pb-32"
            style={{ backgroundColor: BG_LIGHT, color: TEXT_DARK, fontFamily: 'Poppins, sans-serif' }}
        >
            {/* Yellow accent strip */}
            <div style={{ backgroundColor: YELLOW, color: NAVY }}>
                <p className="max-w-[680px] mx-auto px-4 py-1.5 text-[11px] font-bold tracking-[0.04em] text-center uppercase">
                    Earnings · Pay-out history
                </p>
            </div>

            <main className="max-w-[680px] mx-auto px-4 py-5 space-y-5">

                {/* ───── HERO ───── */}
                <motion.section
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                >
                    <div
                        className="rounded-2xl p-5 sm:p-6 relative overflow-hidden"
                        style={{
                            background: `linear-gradient(135deg, ${NAVY}, ${NAVY_DEEP}, ${NAVY_DEEPEST})`,
                            boxShadow: '0 12px 40px rgba(27,42,74,0.18)',
                        }}
                    >
                        <div className="relative text-white">
                            <p className="text-[10px] uppercase tracking-[0.12em] font-semibold opacity-60 mb-1">
                                This month
                            </p>
                            <h1 className="text-3xl sm:text-4xl font-bold leading-tight tabular-nums">
                                {summary ? fmtPence(summary.thisMonth.totalPence) : '—'}
                            </h1>
                            <p className="text-[13px] opacity-80 mt-1.5">
                                {summary
                                    ? `${summary.thisMonth.jobCount} jobs · ${summary.pending.count} pending`
                                    : 'Loading earnings…'}
                            </p>
                        </div>
                    </div>
                </motion.section>

                {/* ───── STATS ───── */}
                <motion.section
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.05 }}
                >
                    <ContractorStatsRow stats={stats} />
                </motion.section>

                {/* ───── EXPORT ROW ───── */}
                <motion.section
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.1 }}
                    className="flex flex-wrap gap-2"
                >
                    <button
                        type="button"
                        onClick={handleExport}
                        disabled={!payoutsQ.data || payoutsQ.data.length === 0}
                        className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-bold border bg-white active:scale-[0.98] transition disabled:opacity-50"
                        style={{ borderColor: BORDER, color: NAVY }}
                    >
                        <Download className="h-3.5 w-3.5" />
                        Export CSV
                    </button>
                    {taxQ.data && taxQ.data.years.length > 0 && (
                        <button
                            type="button"
                            onClick={handleDownloadTaxSummary}
                            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-bold border bg-white active:scale-[0.98] transition"
                            style={{ borderColor: BORDER, color: NAVY }}
                        >
                            <CalendarDays className="h-3.5 w-3.5" />
                            Tax-year summary
                        </button>
                    )}
                </motion.section>

                {/* ───── RECENT PAYOUTS ───── */}
                <motion.section
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.15 }}
                >
                    <h2
                        className="text-[12px] font-bold uppercase tracking-[0.06em] mb-2 px-1"
                        style={{ color: NAVY }}
                    >
                        Recent payouts
                    </h2>

                    {allLoading ? (
                        <div
                            className="bg-white rounded-2xl border p-8 flex items-center justify-center"
                            style={{ borderColor: BORDER }}
                        >
                            <Loader2 className="h-5 w-5 animate-spin" style={{ color: NAVY }} />
                        </div>
                    ) : (payoutsQ.isError && summaryQ.isError) ? (
                        <div
                            className="bg-white rounded-2xl border p-6 text-center"
                            style={{ borderColor: BORDER }}
                        >
                            <PoundSterling
                                className="h-10 w-10 mx-auto mb-3"
                                style={{ color: MUTED }}
                            />
                            <p className="text-[14px] font-semibold" style={{ color: NAVY }}>
                                Earnings data coming soon
                            </p>
                            <p className="text-[12px] mt-1" style={{ color: MUTED }}>
                                Once your first job pays out it'll show up here.
                            </p>
                        </div>
                    ) : recentPayouts.length === 0 ? (
                        <div
                            className="bg-white rounded-2xl border p-6 text-center"
                            style={{ borderColor: BORDER }}
                        >
                            <PoundSterling
                                className="h-10 w-10 mx-auto mb-3"
                                style={{ color: MUTED }}
                            />
                            <p className="text-[14px] font-semibold" style={{ color: NAVY }}>
                                No payouts yet
                            </p>
                            <p className="text-[12px] mt-1" style={{ color: MUTED }}>
                                Complete jobs to start earning.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {recentPayouts.map(p => {
                                const badge = STATUS_BADGE[p.status] ?? STATUS_BADGE.pending;
                                const when = p.paidAt ?? p.jobDate ?? p.createdAt;
                                return (
                                    <div
                                        key={p.id}
                                        className="bg-white rounded-xl border p-3 flex items-start justify-between"
                                        style={{ borderColor: BORDER }}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <p
                                                className="text-[13px] font-semibold truncate"
                                                style={{ color: NAVY }}
                                            >
                                                {p.jobDescription ??
                                                    p.customerName ??
                                                    `Job ${(p.jobId ?? p.id).toString().slice(0, 8)}`}
                                            </p>
                                            <p className="text-[11px]" style={{ color: MUTED }}>
                                                {when ? format(new Date(when), 'dd MMM yyyy') : '—'}
                                            </p>
                                            {p.status === 'held' && p.heldReason && (
                                                <p
                                                    className="text-[11px] mt-1 flex items-center gap-1"
                                                    style={{ color: '#9A3412' }}
                                                >
                                                    <AlertCircle className="h-3 w-3" />
                                                    {p.heldReason === 'stripe_not_active'
                                                        ? 'Connect your Stripe account'
                                                        : p.heldReason === 'dispute_open'
                                                            ? 'Dispute under review'
                                                            : p.heldReason}
                                                </p>
                                            )}
                                        </div>
                                        <div className="text-right ml-3 shrink-0">
                                            <p
                                                className="text-[13px] font-bold tabular-nums"
                                                style={{ color: NAVY }}
                                            >
                                                {fmtPence(p.netPayoutPence)}
                                            </p>
                                            <span
                                                className="inline-block text-[10px] font-bold uppercase rounded-full px-2 py-0.5 mt-1"
                                                style={{ backgroundColor: badge.bg, color: badge.fg }}
                                            >
                                                {badge.label}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {summary?.pending.nextScheduledAt && (
                        <p
                            className="mt-3 text-[11px] flex items-center gap-1.5"
                            style={{ color: MUTED }}
                        >
                            <Clock className="h-3 w-3" />
                            Next payout scheduled
                            {' '}
                            {format(new Date(summary.pending.nextScheduledAt), 'dd MMM, HH:mm')}
                        </p>
                    )}
                </motion.section>

                {/* Note about ADR-005 — placeholder for real-work-minutes */}
                <motion.section
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.3, delay: 0.2 }}
                >
                    <p
                        className="text-[10px] flex items-start gap-1.5 px-1"
                        style={{ color: MUTED }}
                    >
                        <TrendingUp className="h-3 w-3 mt-0.5 shrink-0" />
                        £/hr is an estimate based on completed jobs over the last 30 days. We're working on per-minute precision per ADR-005.
                    </p>
                </motion.section>
            </main>
        </div>
    );
}
