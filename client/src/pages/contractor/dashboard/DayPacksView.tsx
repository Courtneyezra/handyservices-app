/**
 * DayPacksView — Builder dashboard (Module 09 §3.1).
 *
 * Hero: "Hi {name} — your week" with a 14-day calendar strip joining
 * /api/contractor/day-commitments to status. Today's pack featured atop.
 * "Commit a new day" CTA opens a modal posting to Module 06's
 * POST /api/contractor/day-commitments.
 *
 * Module 13 brand styling: navy hero, yellow accent CTAs, white cards on
 * bgLight surface. Polls day-commitments every 60s for fresh state.
 *
 * Day-commitments endpoints are gated server-side by FF_DAY_PACK; when OFF
 * the API returns 503 and the view falls back to a friendly placeholder.
 */

import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { addDays, format, parseISO, startOfDay } from 'date-fns';
import { Loader2, Plus, X, CalendarRange, Sparkles, ChevronRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import ContractorStatsRow, { type StatCard } from '@/components/contractor/ContractorStatsRow';

const NAVY = '#1B2A4A';
const NAVY_DEEP = '#152340';
const NAVY_DEEPEST = '#0E1933';
const YELLOW = '#F5A623';
const BG_LIGHT = '#F7F8FC';
const BORDER = '#D0D5E3';
const MUTED = '#6B7280';
const TEXT_DARK = '#111827';

type CommitmentStatus =
    | 'open'
    | 'pending'
    | 'matched'
    | 'accepted'
    | 'completed'
    | 'released';

interface DayCommitment {
    id: string;
    unit_id: string;
    date: string; // YYYY-MM-DD
    status: CommitmentStatus;
    target_pence: number;
    area_filter: string[] | null;
    day_pack_id?: string | null;
    bonus_eligible?: boolean;
    [k: string]: unknown;
}

interface ProfileResp {
    user?: { firstName?: string };
    profile?: {
        id?: string;
        contractorSegment?: string;
        dayRateTargetPence?: number | null;
        homePostcode?: string | null;
    } | null;
}

function getCleanToken(): string | null {
    const token = localStorage.getItem('contractorToken');
    return token?.trim().replace(/[^a-zA-Z0-9._-]/g, '') ?? null;
}

function fmtPounds(pence: number): string {
    return `£${(pence / 100).toFixed(0)}`;
}

const STATUS_BADGE: Record<CommitmentStatus, { label: string; bg: string; fg: string }> = {
    open:     { label: 'OPEN',     bg: '#FEF3C7', fg: '#92591E' },
    pending:  { label: 'PENDING',  bg: '#FEF3C7', fg: '#92591E' },
    matched:  { label: 'MATCHED',  bg: '#DBEAFE', fg: '#1E40AF' },
    accepted: { label: 'ACCEPTED', bg: '#D1FAE5', fg: '#065F46' },
    completed:{ label: 'DONE',     bg: '#E0E7FF', fg: '#3730A3' },
    released: { label: 'RELEASED', bg: '#F3F4F6', fg: '#6B7280' },
};

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export default function DayPacksView() {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const [showCommitModal, setShowCommitModal] = useState(false);

    // 14-day window starting today
    const today = useMemo(() => startOfDay(new Date()), []);
    const days = useMemo(
        () => Array.from({ length: 14 }, (_, i) => addDays(today, i)),
        [today],
    );
    const fromStr = format(days[0], 'yyyy-MM-dd');
    const toStr = format(days[days.length - 1], 'yyyy-MM-dd');

    // Fetch profile (firstName, day_rate_target_pence)
    const { data: profileData } = useQuery<ProfileResp>({
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

    const firstName = profileData?.user?.firstName ?? 'there';
    const dayRateTargetPence = profileData?.profile?.dayRateTargetPence ?? 28000;
    const homePostcode = profileData?.profile?.homePostcode ?? '';
    const unitId = profileData?.profile?.id ?? '';

    // Fetch day-commitments — endpoint requires X-Contractor-Token header
    // (the Module 06 routes auth via that header; value is the unit_id).
    const {
        data: commitmentsData,
        isLoading: commitmentsLoading,
        isError: commitmentsError,
        error: commitmentsErrObj,
    } = useQuery<{ commitments: DayCommitment[] }>({
        queryKey: ['day-commitments', unitId, fromStr, toStr],
        queryFn: async () => {
            const res = await fetch(
                `/api/contractor/day-commitments?from=${fromStr}&to=${toStr}`,
                {
                    headers: { 'X-Contractor-Token': unitId },
                },
            );
            if (res.status === 503) {
                // FF_DAY_PACK off — surface gracefully.
                return { commitments: [] };
            }
            if (!res.ok) throw new Error(`Failed to fetch commitments (${res.status})`);
            return res.json();
        },
        enabled: Boolean(unitId),
        refetchInterval: 60_000, // 60s polling per spec
    });

    const commitments = commitmentsData?.commitments ?? [];

    // Index commitments by date for fast lookup
    const byDate = useMemo(() => {
        const m = new Map<string, DayCommitment>();
        for (const c of commitments) {
            // The route returns either ISO date or YYYY-MM-DD. Normalise.
            const k = c.date?.slice(0, 10);
            if (k) m.set(k, c);
        }
        return m;
    }, [commitments]);

    // Today's pack — the commitment whose date == today and status accepted/matched
    const todayKey = format(today, 'yyyy-MM-dd');
    const todaysPack = byDate.get(todayKey);
    const todaysPackHasOffer = todaysPack && todaysPack.day_pack_id;

    // Stats
    const startOfWeek = useMemo(() => {
        const d = new Date(today);
        const dow = d.getDay(); // 0=Sun, 1=Mon
        const monOffset = (dow === 0 ? -6 : 1 - dow);
        return addDays(d, monOffset);
    }, [today]);
    const endOfWeek = addDays(startOfWeek, 7);

    const daysBookedThisWeek = commitments.filter(c => {
        const k = c.date?.slice(0, 10);
        if (!k) return false;
        const d = parseISO(k);
        return d >= startOfWeek && d < endOfWeek &&
            (c.status === 'accepted' || c.status === 'matched' || c.status === 'completed');
    }).length;

    const totalEarningsTargetPence = commitments
        .filter(c => c.status !== 'released')
        .reduce((sum, c) => sum + (c.target_pence ?? 0), 0);

    const bonusEligibleCount = commitments.filter(
        c => c.bonus_eligible === true && c.status === 'accepted',
    ).length;

    const stats: StatCard[] = [
        {
            label: 'Booked this week',
            value: `${daysBookedThisWeek}`,
            sublabel: 'days',
        },
        {
            label: 'Earnings target',
            value: fmtPounds(totalEarningsTargetPence),
            sublabel: 'across open packs',
        },
        {
            label: 'Bonus eligible',
            value: `${bonusEligibleCount}`,
            sublabel: 'pending completion',
        },
    ];

    // Commit-a-day mutation
    const commitMutation = useMutation({
        mutationFn: async (input: {
            date: string;
            target_pence: number;
            area_filter: string[];
        }) => {
            const res = await fetch('/api/contractor/day-commitments', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Contractor-Token': unitId,
                },
                body: JSON.stringify(input),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message || `Failed (${res.status})`);
            }
            return res.json();
        },
        onSuccess: () => {
            toast({ title: 'Day committed', description: 'Looking for matching jobs…' });
            setShowCommitModal(false);
            queryClient.invalidateQueries({ queryKey: ['day-commitments'] });
        },
        onError: (err: Error) => {
            toast({
                title: 'Could not commit',
                description: err.message ?? 'Try again',
                variant: 'destructive',
            });
        },
    });

    // ── Render ────────────────────────────────────────────────────────────
    return (
        <div
            className="min-h-screen pb-32"
            style={{ backgroundColor: BG_LIGHT, color: TEXT_DARK, fontFamily: 'Poppins, sans-serif' }}
        >
            {/* Yellow accent strip */}
            <div style={{ backgroundColor: YELLOW, color: NAVY }}>
                <p className="max-w-[680px] mx-auto px-4 py-1.5 text-[11px] font-bold tracking-[0.04em] text-center uppercase">
                    Builder · Day-Packs
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
                        <div
                            className="absolute -top-20 -right-20 w-72 h-72 rounded-full blur-3xl pointer-events-none"
                            style={{ backgroundColor: 'rgba(245,166,35,0.15)' }}
                        />
                        <div className="relative text-white">
                            <p className="text-[10px] uppercase tracking-[0.12em] font-semibold opacity-60 mb-1">
                                Your week
                            </p>
                            <h1 className="text-2xl sm:text-3xl font-bold leading-tight">
                                Hi {firstName} — let's plan it
                            </h1>
                            <p className="text-[13px] opacity-80 mt-1.5 max-w-md">
                                Commit days you want full and we'll bundle the right jobs for you.
                            </p>

                            <button
                                type="button"
                                onClick={() => setShowCommitModal(true)}
                                className="mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-bold active:scale-[0.98] transition"
                                style={{ backgroundColor: YELLOW, color: NAVY }}
                            >
                                <Plus className="h-4 w-4 stroke-[3]" />
                                Commit a new day
                            </button>
                        </div>
                    </div>
                </motion.section>

                {/* ───── TODAY'S PACK (featured) ───── */}
                {todaysPack && (
                    <motion.section
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: 0.05 }}
                    >
                        <Link
                            href={
                                todaysPackHasOffer
                                    ? `/contractor/dispatch/${todaysPack.day_pack_id}`
                                    : `/contractor/dashboard/day-packs#${todaysPack.id}`
                            }
                        >
                            <div
                                className="bg-white rounded-2xl border p-4 sm:p-5 cursor-pointer hover:border-[#F5A623] transition-colors"
                                style={{ borderColor: BORDER }}
                            >
                                <div className="flex items-center gap-2 mb-2">
                                    <Sparkles className="h-4 w-4" style={{ color: YELLOW }} />
                                    <p
                                        className="text-[10px] uppercase tracking-[0.08em] font-bold"
                                        style={{ color: YELLOW }}
                                    >
                                        Today's pack
                                    </p>
                                </div>
                                <div className="flex items-end justify-between">
                                    <div>
                                        <p
                                            className="text-2xl font-bold leading-tight"
                                            style={{ color: NAVY }}
                                        >
                                            {fmtPounds(todaysPack.target_pence)} target
                                        </p>
                                        <p className="text-[12px] mt-0.5" style={{ color: MUTED }}>
                                            {(todaysPack.area_filter && todaysPack.area_filter.length > 0)
                                                ? todaysPack.area_filter.join(', ')
                                                : 'Anywhere in your catchment'}
                                        </p>
                                    </div>
                                    <span
                                        className="text-[10px] font-bold uppercase rounded-full px-2 py-0.5"
                                        style={{
                                            backgroundColor: STATUS_BADGE[todaysPack.status]?.bg,
                                            color: STATUS_BADGE[todaysPack.status]?.fg,
                                        }}
                                    >
                                        {STATUS_BADGE[todaysPack.status]?.label}
                                    </span>
                                </div>
                            </div>
                        </Link>
                    </motion.section>
                )}

                {/* ───── STATS ROW ───── */}
                <motion.section
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.1 }}
                >
                    <ContractorStatsRow stats={stats} />
                </motion.section>

                {/* ───── 14-DAY STRIP ───── */}
                <motion.section
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.15 }}
                >
                    <div
                        className="bg-white rounded-2xl border p-4"
                        style={{ borderColor: BORDER }}
                    >
                        <div className="flex items-center justify-between mb-3">
                            <h2
                                className="text-[12px] font-bold uppercase tracking-[0.06em]"
                                style={{ color: NAVY }}
                            >
                                <CalendarRange className="h-3.5 w-3.5 inline mr-1" />
                                Next 14 days
                            </h2>
                            {commitmentsLoading && (
                                <Loader2 className="h-4 w-4 animate-spin" style={{ color: NAVY }} />
                            )}
                        </div>

                        {commitmentsError ? (
                            <p className="text-[12px] py-4 text-center" style={{ color: MUTED }}>
                                {String((commitmentsErrObj as Error)?.message ?? 'Could not load commitments.')}
                            </p>
                        ) : (
                            <div className="grid grid-cols-7 gap-1.5">
                                {days.map(d => {
                                    const k = format(d, 'yyyy-MM-dd');
                                    const c = byDate.get(k);
                                    const status = c?.status;
                                    const badge = status ? STATUS_BADGE[status] : null;
                                    const isToday = k === todayKey;
                                    const dayLink = c?.day_pack_id
                                        ? `/contractor/dispatch/${c.day_pack_id}`
                                        : null;

                                    const inner = (
                                        <div
                                            className="aspect-square rounded-lg border p-1.5 flex flex-col"
                                            style={{
                                                borderColor: c ? badge?.fg ?? BORDER : BORDER,
                                                backgroundColor: c ? badge?.bg : '#FFFFFF',
                                            }}
                                        >
                                            <p
                                                className="text-[9px] uppercase font-semibold"
                                                style={{ color: c ? badge?.fg : MUTED }}
                                            >
                                                {format(d, 'EEE')}
                                            </p>
                                            <p
                                                className="text-base font-bold leading-tight"
                                                style={{ color: c ? badge?.fg : NAVY }}
                                            >
                                                {format(d, 'd')}
                                            </p>
                                            {isToday && (
                                                <span
                                                    className="text-[8px] font-bold uppercase mt-auto"
                                                    style={{ color: YELLOW }}
                                                >
                                                    today
                                                </span>
                                            )}
                                            {c && c.target_pence > 0 && (
                                                <span
                                                    className="text-[9px] font-bold mt-auto tabular-nums"
                                                    style={{ color: badge?.fg }}
                                                >
                                                    {fmtPounds(c.target_pence)}
                                                </span>
                                            )}
                                        </div>
                                    );

                                    return dayLink ? (
                                        <Link key={k} href={dayLink}>
                                            <button className="w-full text-left active:scale-[0.97] transition">
                                                {inner}
                                            </button>
                                        </Link>
                                    ) : (
                                        <div key={k}>{inner}</div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </motion.section>

                {/* ───── COMMITMENTS LIST ───── */}
                {commitments.length > 0 && (
                    <motion.section
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: 0.2 }}
                    >
                        <h2
                            className="text-[12px] font-bold uppercase tracking-[0.06em] mb-2 px-1"
                            style={{ color: NAVY }}
                        >
                            Your commitments
                        </h2>
                        <div className="space-y-2">
                            {commitments
                                .filter(c => c.status !== 'released')
                                .sort((a, b) => a.date.localeCompare(b.date))
                                .map(c => {
                                    const badge = STATUS_BADGE[c.status];
                                    const link = c.day_pack_id
                                        ? `/contractor/dispatch/${c.day_pack_id}`
                                        : null;
                                    const card = (
                                        <div
                                            className="bg-white rounded-xl border p-3 flex items-center justify-between"
                                            style={{ borderColor: BORDER }}
                                        >
                                            <div className="flex-1 min-w-0">
                                                <p
                                                    className="text-[13px] font-semibold"
                                                    style={{ color: NAVY }}
                                                >
                                                    {format(parseISO(c.date.slice(0, 10)), 'EEE d MMM')}
                                                </p>
                                                <p className="text-[11px]" style={{ color: MUTED }}>
                                                    {c.area_filter && c.area_filter.length > 0
                                                        ? c.area_filter.join(', ')
                                                        : 'Anywhere'} · {fmtPounds(c.target_pence)}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span
                                                    className="text-[10px] font-bold uppercase rounded-full px-2 py-0.5"
                                                    style={{
                                                        backgroundColor: badge?.bg,
                                                        color: badge?.fg,
                                                    }}
                                                >
                                                    {badge?.label}
                                                </span>
                                                {link && <ChevronRight className="h-4 w-4" style={{ color: MUTED }} />}
                                            </div>
                                        </div>
                                    );
                                    return link ? (
                                        <Link key={c.id} href={link}>
                                            <button className="w-full text-left active:scale-[0.99] transition">
                                                {card}
                                            </button>
                                        </Link>
                                    ) : (
                                        <div key={c.id}>{card}</div>
                                    );
                                })}
                        </div>
                    </motion.section>
                )}

                {/* ───── EMPTY STATE ───── */}
                {!commitmentsLoading && commitments.length === 0 && !commitmentsError && (
                    <motion.section
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                    >
                        <div
                            className="bg-white rounded-2xl border p-6 text-center"
                            style={{ borderColor: BORDER }}
                        >
                            <CalendarRange className="h-10 w-10 mx-auto mb-3" style={{ color: MUTED }} />
                            <p className="text-[14px] font-semibold" style={{ color: NAVY }}>
                                No days committed yet
                            </p>
                            <p className="text-[12px] mt-1" style={{ color: MUTED }}>
                                Commit a day and we'll fill it with bundled jobs.
                            </p>
                        </div>
                    </motion.section>
                )}
            </main>

            {showCommitModal && (
                <CommitDayModal
                    onClose={() => setShowCommitModal(false)}
                    defaultTargetPence={dayRateTargetPence}
                    defaultPostcode={homePostcode}
                    submitting={commitMutation.isPending}
                    onSubmit={(payload) => commitMutation.mutate(payload)}
                />
            )}
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────────────
// CommitDayModal — date + area + target_pence
// ────────────────────────────────────────────────────────────────────────────

interface CommitModalProps {
    onClose: () => void;
    defaultTargetPence: number;
    defaultPostcode: string;
    submitting: boolean;
    onSubmit: (input: {
        date: string;
        target_pence: number;
        area_filter: string[];
    }) => void;
}

function CommitDayModal({
    onClose,
    defaultTargetPence,
    defaultPostcode,
    submitting,
    onSubmit,
}: CommitModalProps) {
    const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');
    const [date, setDate] = useState(tomorrow);
    const [areaInput, setAreaInput] = useState(defaultPostcode);
    const [targetPounds, setTargetPounds] = useState(
        Math.round(defaultTargetPence / 100).toString(),
    );

    const handleSubmit = () => {
        const target = Math.round(Number(targetPounds || 0) * 100);
        const area_filter = areaInput
            .split(',')
            .map(a => a.trim().toUpperCase())
            .filter(Boolean);
        onSubmit({ date, target_pence: target, area_filter });
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
            style={{ backgroundColor: 'rgba(15,23,42,0.6)' }}
            onClick={onClose}
        >
            <motion.div
                initial={{ y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 40, opacity: 0 }}
                transition={{ type: 'spring', damping: 25, stiffness: 280 }}
                className="w-full max-w-md bg-white rounded-2xl p-5 sm:p-6"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h2 className="text-lg font-bold" style={{ color: NAVY }}>
                            Commit a day
                        </h2>
                        <p className="text-[12px]" style={{ color: MUTED }}>
                            We'll bundle jobs to fill it.
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-full hover:bg-slate-100"
                        aria-label="Close"
                    >
                        <X className="h-4 w-4" style={{ color: MUTED }} />
                    </button>
                </div>

                <div className="space-y-4">
                    <div>
                        <label
                            className="block text-[11px] font-bold uppercase tracking-wider mb-1.5"
                            style={{ color: MUTED }}
                        >
                            Date
                        </label>
                        <input
                            type="date"
                            value={date}
                            min={tomorrow}
                            onChange={e => setDate(e.target.value)}
                            className="w-full px-3 py-2.5 rounded-lg border text-[14px] outline-none focus:border-amber-400"
                            style={{ borderColor: BORDER, color: TEXT_DARK }}
                        />
                    </div>

                    <div>
                        <label
                            className="block text-[11px] font-bold uppercase tracking-wider mb-1.5"
                            style={{ color: MUTED }}
                        >
                            Area (postcode prefixes, comma-separated)
                        </label>
                        <input
                            type="text"
                            value={areaInput}
                            onChange={e => setAreaInput(e.target.value)}
                            placeholder="NG7, NG8"
                            className="w-full px-3 py-2.5 rounded-lg border text-[14px] outline-none focus:border-amber-400"
                            style={{ borderColor: BORDER, color: TEXT_DARK }}
                        />
                    </div>

                    <div>
                        <label
                            className="block text-[11px] font-bold uppercase tracking-wider mb-1.5"
                            style={{ color: MUTED }}
                        >
                            Day-rate target (£)
                        </label>
                        <input
                            type="number"
                            min={0}
                            step={10}
                            value={targetPounds}
                            onChange={e => setTargetPounds(e.target.value)}
                            className="w-full px-3 py-2.5 rounded-lg border text-[14px] outline-none focus:border-amber-400"
                            style={{ borderColor: BORDER, color: TEXT_DARK }}
                        />
                        <p className="text-[10px] mt-1" style={{ color: MUTED }}>
                            We'll honour the day-rate floor regardless of bundled value.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={submitting || !date}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-[14px] font-bold active:scale-[0.98] transition disabled:opacity-50"
                        style={{ backgroundColor: NAVY, color: '#FFFFFF' }}
                    >
                        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                        Commit day
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
