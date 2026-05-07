/**
 * PayProtectionView — contractor Pay Protection tab.
 *
 * Module 07 — Pay Protection. Hosts the contractor-facing list of
 * `pay_adjustments` plus the "open new claim" CTA. Polls
 * `/api/contractor/pay-adjustments/mine` every 30s for live updates.
 *
 * Gated by FF_PAY_PROTECTION on the client (the route registers regardless;
 * server endpoints also enforce the flag and return 503 when off).
 *
 * Design language: brand navy + yellow per Module 13. Mirrors the
 * DispatchPreviewPage aesthetic so the contractor feels at home.
 */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
    ShieldCheck,
    Hammer,
    AlertTriangle,
    Receipt,
    Trophy,
    Clock,
    Wallet,
    Plus,
    Loader2,
} from 'lucide-react';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import PayAdjustmentList from '@/components/contractor/PayAdjustmentList';
import PayAdjustmentForm, { type DispatchOption } from '@/components/contractor/PayAdjustmentForm';
import type { PayAdjustment } from '@/components/contractor/PayAdjustmentCard';

const NAVY = '#1B2A4A';
const NAVY_DEEP = '#152340';
const NAVY_DEEPEST = '#0E1933';
const YELLOW = '#F5A623';
const BORDER = '#D0D5E3';
const MUTED = '#6B7280';
const TEXT_DARK = '#111827';
const BG_LIGHT = '#F7F8FC';

const fadeInUp = {
    initial: { opacity: 0, y: 8 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
    transition: { duration: 0.35 },
};

const SEVEN_GUARANTEES = [
    { Icon: ShieldCheck, label: 'Day-rate floor', detail: '£16–£28/hr by tier — guaranteed' },
    { Icon: Hammer, label: 'Mis-scope uplift', detail: 'Job ran over? We pay extra' },
    { Icon: AlertTriangle, label: 'Call-out fee', detail: '£45 if you can\'t start' },
    { Icon: Clock, label: 'Cancellation comp', detail: '50–75% if customer cancels' },
    { Icon: Receipt, label: 'Materials', detail: 'Receipt + 10% handling' },
    { Icon: Wallet, label: '48h pay', detail: 'Money in your account in 2 days' },
    { Icon: Trophy, label: 'Completion bonus', detail: 'All-or-nothing on day-packs' },
];

interface Dispatch {
    id: string;
    booking_id?: string | null;
    customer_address?: string | null;
    description?: string | null;
    completed_at?: string | null;
    created_at?: string | null;
    estimate_minutes?: number | null;
}

function fmtPence(p: number): string {
    return `£${(p / 100).toFixed(2).replace(/\.00$/, '')}`;
}

function authHeaders(): Record<string, string> {
    const token = localStorage.getItem('contractorToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchAdjustments(): Promise<PayAdjustment[]> {
    const res = await fetch('/api/contractor/pay-adjustments/mine?limit=50', {
        headers: authHeaders(),
    });
    if (res.status === 503) {
        // Flag is OFF server-side — surface a friendly empty state.
        return [];
    }
    if (!res.ok) {
        throw new Error(`Failed to load (${res.status})`);
    }
    const body = await res.json();
    // Server may return either { data: [...] } envelope or a bare array.
    return Array.isArray(body) ? body : (body?.data ?? []);
}

async function fetchRecentDispatches(): Promise<Dispatch[]> {
    // Best-effort — the contractor app already has an endpoint for "my jobs".
    // If it's not available we fall back to an empty list and the form lets
    // the user paste a dispatch ID manually.
    const candidates = [
        '/api/contractor/jobs?limit=20',
        '/api/contractor/dispatches?limit=20',
    ];
    for (const url of candidates) {
        try {
            const res = await fetch(url, { headers: authHeaders() });
            if (!res.ok) continue;
            const body = await res.json();
            const list = Array.isArray(body) ? body : (body?.data ?? body?.jobs ?? []);
            if (Array.isArray(list) && list.length > 0) return list;
        } catch {
            // ignore and try the next candidate
        }
    }
    return [];
}

function dispatchOptions(dispatches: Dispatch[]): DispatchOption[] {
    return dispatches.map(d => {
        const when = d.completed_at || d.created_at;
        const dateStr = when
            ? new Date(when).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
            : '';
        const labelParts = [
            d.description?.slice(0, 50),
            d.customer_address?.slice(0, 30),
            dateStr,
        ].filter(Boolean);
        return {
            id: d.id,
            label: labelParts.length > 0 ? labelParts.join(' · ') : `Dispatch ${d.id.slice(0, 8)}`,
            estimateMinutes: d.estimate_minutes ?? undefined,
        };
    });
}

export default function PayProtectionView() {
    const flags = useFeatureFlags();
    const [openForm, setOpenForm] = useState(false);

    const adjustmentsQ = useQuery<PayAdjustment[]>({
        queryKey: ['pay-adjustments-mine'],
        queryFn: fetchAdjustments,
        refetchInterval: 30_000, // 30s polling per spec
        enabled: flags.contractor_app_v2 || true, // always allowed — flag check renders placeholder below
    });

    const dispatchesQ = useQuery<Dispatch[]>({
        queryKey: ['contractor-recent-dispatches-for-pa'],
        queryFn: fetchRecentDispatches,
        staleTime: 60_000,
    });

    // Compute "this month" stats from the adjustments.
    const stats = useMemo(() => {
        const list = adjustmentsQ.data ?? [];
        const thisMonth = new Date();
        thisMonth.setDate(1);
        thisMonth.setHours(0, 0, 0, 0);
        const inMonth = list.filter(a => {
            const created = new Date(a.created_at);
            return created >= thisMonth;
        });
        const claimedPence = inMonth
            .filter(a => a.status === 'auto_approved' || a.status === 'admin_approved')
            .reduce((sum, a) => sum + (a.amount_pence ?? 0), 0);
        const approvedCount = inMonth.filter(
            a => a.status === 'auto_approved' || a.status === 'admin_approved',
        ).length;
        const pendingCount = list.filter(a => a.status === 'pending_review').length;
        return { claimedPence, approvedCount, pendingCount };
    }, [adjustmentsQ.data]);

    // ── Feature-flag placeholder ────────────────────────────────────────────
    // Route registers regardless of FF_PAY_PROTECTION; the view itself
    // renders a placeholder when the flag is off.
    if (!flags.pay_protection) {
        return <ComingSoon />;
    }

    return (
        <div
            className="min-h-screen pb-32"
            style={{ backgroundColor: BG_LIGHT, color: TEXT_DARK, fontFamily: 'Poppins, sans-serif' }}
        >
            {/* Yellow accent strip */}
            <div style={{ backgroundColor: YELLOW, color: NAVY }}>
                <p className="max-w-[680px] mx-auto px-4 py-1.5 text-[11px] font-bold tracking-[0.04em] text-center uppercase">
                    Pay Protection · 7 Guarantees
                </p>
            </div>

            <main className="max-w-[680px] mx-auto px-4 py-6 space-y-5">

                {/* ───── HERO ───── */}
                <motion.section {...fadeInUp}>
                    <div
                        className="rounded-2xl p-6 sm:p-7 relative overflow-hidden"
                        style={{
                            background: `linear-gradient(135deg, ${NAVY}, ${NAVY_DEEP}, ${NAVY_DEEPEST})`,
                            boxShadow: '0 12px 40px rgba(27,42,74,0.18)',
                        }}
                    >
                        <div
                            className="absolute -top-24 -right-24 w-80 h-80 rounded-full blur-3xl pointer-events-none"
                            style={{ backgroundColor: 'rgba(245,166,35,0.15)' }}
                        />
                        <div
                            className="absolute -bottom-32 -left-20 w-72 h-72 rounded-full blur-3xl pointer-events-none"
                            style={{ backgroundColor: 'rgba(245,166,35,0.10)' }}
                        />
                        <div className="relative text-white">
                            <p className="text-[10px] uppercase tracking-[0.12em] font-semibold opacity-60 mb-2">
                                We've got you covered
                            </p>
                            <h1 className="text-3xl sm:text-4xl font-bold leading-tight">
                                Pay Protection
                            </h1>
                            <p className="text-[13px] opacity-80 mt-2 max-w-md leading-relaxed">
                                Seven guarantees that backstop your pay — from mis-scope uplifts and call-out fees to
                                materials reimbursement and 48-hour payouts.
                            </p>

                            {/* 7-icon strip */}
                            <div className="grid grid-cols-7 gap-1.5 mt-5">
                                {SEVEN_GUARANTEES.map((g, i) => {
                                    const Icon = g.Icon;
                                    return (
                                        <div
                                            key={i}
                                            className="aspect-square rounded-xl flex items-center justify-center"
                                            style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
                                            title={`${g.label} — ${g.detail}`}
                                        >
                                            <Icon className="h-4 w-4" style={{ color: YELLOW }} />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </motion.section>

                {/* ───── SUMMARY CARD ───── */}
                <motion.section {...fadeInUp}>
                    <div
                        className="bg-white rounded-2xl border p-5"
                        style={{ borderColor: BORDER }}
                    >
                        <div className="flex items-baseline justify-between mb-3">
                            <p className="text-[11px] uppercase tracking-[0.08em] font-bold" style={{ color: MUTED }}>
                                This month
                            </p>
                            <p className="text-[11px]" style={{ color: MUTED }}>
                                {stats.pendingCount} pending
                            </p>
                        </div>
                        <div className="flex items-baseline gap-3 flex-wrap">
                            <p className="text-3xl font-bold tabular-nums" style={{ color: NAVY }}>
                                {fmtPence(stats.claimedPence)}
                            </p>
                            <p className="text-[13px]" style={{ color: MUTED }}>
                                claimed · {stats.approvedCount} adjustment{stats.approvedCount === 1 ? '' : 's'} approved
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={() => setOpenForm(true)}
                            className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-[14px] font-bold text-white active:scale-[0.98] transition-all"
                            style={{ backgroundColor: NAVY }}
                        >
                            <Plus className="h-4 w-4 stroke-[3]" />
                            Open new claim
                        </button>
                    </div>
                </motion.section>

                {/* ───── LIST ───── */}
                <motion.section {...fadeInUp}>
                    {adjustmentsQ.isLoading ? (
                        <div className="bg-white rounded-2xl border p-8 flex items-center justify-center" style={{ borderColor: BORDER }}>
                            <Loader2 className="h-5 w-5 animate-spin" style={{ color: NAVY }} />
                        </div>
                    ) : adjustmentsQ.isError ? (
                        <div
                            className="rounded-2xl border p-5 text-[13px]"
                            style={{ borderColor: BORDER, backgroundColor: '#FEF2F2', color: '#991B1B' }}
                        >
                            Could not load your adjustments. Try refreshing.
                        </div>
                    ) : (
                        <PayAdjustmentList adjustments={adjustmentsQ.data ?? []} />
                    )}
                </motion.section>

                {/* ───── 7 GUARANTEES (expanded text) ───── */}
                <motion.section {...fadeInUp}>
                    <div
                        className="bg-white rounded-2xl border p-5"
                        style={{ borderColor: BORDER }}
                    >
                        <h3 className="text-[12px] font-bold uppercase tracking-[0.06em] mb-3" style={{ color: NAVY }}>
                            Your 7 guarantees
                        </h3>
                        <div className="space-y-3">
                            {SEVEN_GUARANTEES.map((g, i) => {
                                const Icon = g.Icon;
                                return (
                                    <div key={i} className="flex items-start gap-3">
                                        <div
                                            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                                            style={{ backgroundColor: BG_LIGHT, color: NAVY }}
                                        >
                                            <Icon className="h-4 w-4" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[13px] font-bold" style={{ color: TEXT_DARK }}>
                                                {g.label}
                                            </p>
                                            <p className="text-[12px] mt-0.5" style={{ color: MUTED }}>
                                                {g.detail}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </motion.section>

            </main>

            {openForm && (
                <PayAdjustmentForm
                    dispatches={dispatchOptions(dispatchesQ.data ?? [])}
                    onClose={() => setOpenForm(false)}
                />
            )}
        </div>
    );
}

function ComingSoon() {
    return (
        <div
            className="min-h-screen flex items-center justify-center px-6"
            style={{ backgroundColor: BG_LIGHT, fontFamily: 'Poppins, sans-serif' }}
        >
            <div
                className="max-w-md w-full bg-white rounded-2xl border p-8 text-center"
                style={{ borderColor: BORDER }}
            >
                <div
                    className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center"
                    style={{ backgroundColor: BG_LIGHT, color: NAVY }}
                >
                    <ShieldCheck className="h-6 w-6" />
                </div>
                <h2 className="text-xl font-bold" style={{ color: NAVY }}>Pay Protection is coming</h2>
                <p className="text-[13px] mt-2" style={{ color: MUTED }}>
                    Seven guarantees that backstop your pay — mis-scope uplift, call-out fee, materials
                    reimbursement and more. Rolling out in phases. Check back soon.
                </p>
            </div>
        </div>
    );
}
