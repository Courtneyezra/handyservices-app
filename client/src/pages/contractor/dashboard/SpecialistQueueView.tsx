/**
 * SpecialistQueueView — Specialist dashboard (Module 09 §3.3).
 *
 * Cert-gated job queue. Cert verification status prominently displayed —
 * any cert expiring < 30 days pins a yellow "Update cert" CTA. A stale
 * cert silently zeroes the queue (server-side filter), so we surface that
 * via the status panel.
 *
 * Module 13 brand styling — navy hero, white cards, yellow accent for the
 * cert renewal CTA.
 */

import { useMemo } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { differenceInDays, parseISO } from 'date-fns';
import {
    AlertTriangle,
    BadgeCheck,
    Briefcase,
    ChevronRight,
    Loader2,
    ShieldCheck,
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

interface CertEntry {
    type: string;            // 'gas_safe' | 'part_p' | 'niceic' | 'structural' | …
    status?: 'verified' | 'pending' | 'expired';
    expiresAt?: string | null;
    expires_at?: string | null;
    number?: string | null;
}

interface ProfileResp {
    user?: { firstName?: string };
    profile?: {
        contractorSegment?: string;
        certs?: CertEntry[] | string[];
    } | null;
}

interface SpecialistJob {
    id: string;
    customerName?: string;
    description?: string;
    postcode?: string;
    cert_required?: string;
    payoutPence?: number;
    scheduledDate?: string;
}

function getCleanToken(): string | null {
    const token = localStorage.getItem('contractorToken');
    return token?.trim().replace(/[^a-zA-Z0-9._-]/g, '') ?? null;
}

const CERT_LABELS: Record<string, string> = {
    gas_safe: 'Gas Safe',
    part_p: 'Part P',
    niceic: 'NICEIC',
    structural: 'Structural Engineer',
};

function normaliseCert(c: CertEntry | string): CertEntry {
    if (typeof c === 'string') {
        return { type: c, status: 'verified' };
    }
    return {
        ...c,
        expiresAt: c.expiresAt ?? c.expires_at ?? null,
    };
}

export default function SpecialistQueueView() {
    const [, setLocation] = useLocation();

    // Profile
    const { data: profileData, isLoading: profileLoading } = useQuery<ProfileResp>({
        queryKey: ['contractor-profile'],
        queryFn: async () => {
            const token = getCleanToken();
            const res = await fetch('/api/contractor/me', {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error('Failed to fetch profile');
            return res.json();
        },
        staleTime: 5 * 60_000,
    });

    const certs: CertEntry[] = useMemo(() => {
        const raw = profileData?.profile?.certs ?? [];
        if (!Array.isArray(raw)) return [];
        return (raw as Array<CertEntry | string>).map(normaliseCert);
    }, [profileData]);

    // Specialist queue — best-effort. If the segment-aware filter isn't
    // implemented server-side yet, we fall back to the existing /jobs feed
    // and let the user click through to the legacy view.
    const { data: jobs, isLoading: jobsLoading, isError: jobsError } = useQuery<
        SpecialistJob[]
    >({
        queryKey: ['contractor-jobs', 'specialist'],
        queryFn: async () => {
            const token = getCleanToken();
            const candidates = [
                '/api/contractor/jobs?segment_filter=specialist',
                '/api/contractor/jobs?cert_required=any',
                '/api/contractor/bookings',
            ];
            for (const url of candidates) {
                try {
                    const res = await fetch(url, {
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    if (!res.ok) continue;
                    const body = await res.json();
                    const list: SpecialistJob[] = Array.isArray(body)
                        ? body
                        : body?.data ?? body?.jobs ?? [];
                    if (Array.isArray(list)) return list;
                } catch {
                    // try next
                }
            }
            return [];
        },
    });

    // Cert renewal warnings (< 30 days)
    const expiringCerts = useMemo(() => {
        return certs.filter(c => {
            if (!c.expiresAt) return false;
            try {
                const days = differenceInDays(parseISO(c.expiresAt), new Date());
                return days >= 0 && days < 30;
            } catch {
                return false;
            }
        });
    }, [certs]);

    const earliestRenewalDays = useMemo(() => {
        if (expiringCerts.length === 0) return null;
        const days = expiringCerts
            .map(c => differenceInDays(parseISO(c.expiresAt!), new Date()))
            .sort((a, b) => a - b);
        return days[0];
    }, [expiringCerts]);

    // Filter jobs to those whose cert_required matches one of the verified
    // certs the contractor holds. This is a client-side defence-in-depth;
    // server should also enforce.
    const verifiedCertTypes = certs
        .filter(c => c.status === 'verified' || c.status === undefined)
        .map(c => c.type);

    const matchedJobs = (jobs ?? []).filter(j => {
        if (!j.cert_required) return true; // no requirement → eligible
        return verifiedCertTypes.includes(j.cert_required);
    });

    // Stats
    const monthAgo = new Date();
    monthAgo.setDate(monthAgo.getDate() - 30);
    const jobsThisMonth = matchedJobs.length;

    // Average £/hr — best-effort over recent payouts; placeholder until server
    // returns real-work-minutes (ADR-005).
    const avgRatePerHour = useMemo(() => {
        const withPay = matchedJobs.filter(j => j.payoutPence && j.payoutPence > 0);
        if (withPay.length === 0) return null;
        // Conservative assumption: 4h average until server returns minutes.
        const totalPence = withPay.reduce((s, j) => s + (j.payoutPence ?? 0), 0);
        const totalHours = withPay.length * 4;
        return totalPence / totalHours;
    }, [matchedJobs]);

    const stats: StatCard[] = [
        {
            label: 'Jobs this month',
            value: `${jobsThisMonth}`,
            sublabel: 'cert-matched',
        },
        {
            label: 'Avg £/hr',
            value: avgRatePerHour ? `£${(avgRatePerHour / 100).toFixed(0)}` : '—',
            sublabel: 'last 30 days',
        },
        {
            label: 'Cert renewal',
            value: earliestRenewalDays === null ? '—' : `${earliestRenewalDays}d`,
            sublabel: earliestRenewalDays === null ? 'no expiry soon' : 'days remaining',
        },
    ];

    return (
        <div
            className="min-h-screen pb-32"
            style={{ backgroundColor: BG_LIGHT, color: TEXT_DARK, fontFamily: 'Poppins, sans-serif' }}
        >
            {/* Yellow accent strip */}
            <div style={{ backgroundColor: YELLOW, color: NAVY }}>
                <p className="max-w-[680px] mx-auto px-4 py-1.5 text-[11px] font-bold tracking-[0.04em] text-center uppercase">
                    Specialist · Cert-Gated Queue
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
                                Your queue
                            </p>
                            <h1 className="text-2xl sm:text-3xl font-bold leading-tight">
                                Hi {profileData?.user?.firstName ?? 'there'}
                            </h1>
                            <p className="text-[13px] opacity-80 mt-1.5 max-w-md">
                                Cert-gated work only. We never send you generalist jobs.
                            </p>
                        </div>
                    </div>
                </motion.section>

                {/* ───── CERT STATUS PANEL ───── */}
                <motion.section
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.05 }}
                >
                    <div
                        className="bg-white rounded-2xl border p-4"
                        style={{ borderColor: BORDER }}
                    >
                        <h2
                            className="text-[12px] font-bold uppercase tracking-[0.06em] mb-3"
                            style={{ color: NAVY }}
                        >
                            <ShieldCheck className="h-3.5 w-3.5 inline mr-1" />
                            Your certifications
                        </h2>

                        {profileLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" style={{ color: NAVY }} />
                        ) : certs.length === 0 ? (
                            <p className="text-[12px]" style={{ color: MUTED }}>
                                No certs on file. Add your Gas Safe, Part P, or NICEIC number in Settings.
                            </p>
                        ) : (
                            <div className="space-y-2">
                                {certs.map(c => {
                                    const days = c.expiresAt
                                        ? differenceInDays(parseISO(c.expiresAt), new Date())
                                        : null;
                                    const expiringSoon = days !== null && days < 30;
                                    const expired = days !== null && days < 0;
                                    return (
                                        <div
                                            key={c.type}
                                            className="flex items-center justify-between py-1.5"
                                        >
                                            <div className="flex items-center gap-2">
                                                <BadgeCheck
                                                    className="h-4 w-4"
                                                    style={{
                                                        color: expired
                                                            ? '#DC2626'
                                                            : expiringSoon
                                                                ? YELLOW
                                                                : '#059669',
                                                    }}
                                                />
                                                <span
                                                    className="text-[13px] font-semibold"
                                                    style={{ color: NAVY }}
                                                >
                                                    {CERT_LABELS[c.type] ?? c.type}
                                                </span>
                                                {c.number && (
                                                    <span
                                                        className="text-[11px]"
                                                        style={{ color: MUTED }}
                                                    >
                                                        #{c.number}
                                                    </span>
                                                )}
                                            </div>
                                            <span
                                                className="text-[11px] font-semibold"
                                                style={{
                                                    color: expired
                                                        ? '#DC2626'
                                                        : expiringSoon
                                                            ? '#92591E'
                                                            : MUTED,
                                                }}
                                            >
                                                {expired
                                                    ? 'Expired'
                                                    : days !== null
                                                        ? `${days}d left`
                                                        : 'Verified'}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {expiringCerts.length > 0 && (
                            <button
                                type="button"
                                onClick={() => setLocation('/contractor/dashboard/settings')}
                                className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[12px] font-bold active:scale-[0.98] transition"
                                style={{ backgroundColor: YELLOW, color: NAVY }}
                            >
                                <AlertTriangle className="h-3.5 w-3.5" />
                                Update cert before expiry
                            </button>
                        )}
                    </div>
                </motion.section>

                {/* ───── STATS ───── */}
                <motion.section
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.1 }}
                >
                    <ContractorStatsRow stats={stats} />
                </motion.section>

                {/* ───── QUEUE LIST ───── */}
                <motion.section
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.15 }}
                >
                    <h2
                        className="text-[12px] font-bold uppercase tracking-[0.06em] mb-2 px-1"
                        style={{ color: NAVY }}
                    >
                        Available jobs
                    </h2>

                    {jobsLoading ? (
                        <div
                            className="bg-white rounded-2xl border p-8 flex items-center justify-center"
                            style={{ borderColor: BORDER }}
                        >
                            <Loader2 className="h-5 w-5 animate-spin" style={{ color: NAVY }} />
                        </div>
                    ) : jobsError ? (
                        <div
                            className="rounded-2xl border p-5 text-[13px]"
                            style={{
                                borderColor: BORDER,
                                backgroundColor: '#FEF2F2',
                                color: '#991B1B',
                            }}
                        >
                            Could not load your queue. Try refreshing.
                        </div>
                    ) : matchedJobs.length === 0 ? (
                        <div
                            className="bg-white rounded-2xl border p-6 text-center"
                            style={{ borderColor: BORDER }}
                        >
                            <Briefcase className="h-10 w-10 mx-auto mb-3" style={{ color: MUTED }} />
                            <p className="text-[14px] font-semibold" style={{ color: NAVY }}>
                                No cert-matched jobs right now
                            </p>
                            <p className="text-[12px] mt-1" style={{ color: MUTED }}>
                                When jobs matching your certs come in, they'll appear here.
                                {expiringCerts.length > 0 && ' Renew your cert to stay in the queue.'}
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {matchedJobs.map(j => (
                                <button
                                    key={j.id}
                                    onClick={() => setLocation(`/contractor/dashboard/jobs/${j.id}`)}
                                    className="w-full text-left bg-white rounded-xl border p-3 active:scale-[0.99] transition flex items-center justify-between"
                                    style={{ borderColor: BORDER }}
                                >
                                    <div className="flex-1 min-w-0">
                                        <p
                                            className="text-[13px] font-semibold truncate"
                                            style={{ color: NAVY }}
                                        >
                                            {j.customerName ?? j.description ?? `Job ${j.id.slice(0, 8)}`}
                                        </p>
                                        <p className="text-[11px]" style={{ color: MUTED }}>
                                            {j.postcode ?? '—'}
                                            {j.cert_required && (
                                                <>
                                                    {' · '}
                                                    <span style={{ color: YELLOW, fontWeight: 600 }}>
                                                        {CERT_LABELS[j.cert_required] ?? j.cert_required}
                                                    </span>
                                                </>
                                            )}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {j.payoutPence != null && j.payoutPence > 0 && (
                                            <span
                                                className="text-[13px] font-bold tabular-nums"
                                                style={{ color: NAVY }}
                                            >
                                                £{(j.payoutPence / 100).toFixed(0)}
                                            </span>
                                        )}
                                        <ChevronRight className="h-4 w-4" style={{ color: MUTED }} />
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </motion.section>
            </main>
        </div>
    );
}
