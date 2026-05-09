/**
 * PayAdjustmentsAdminPage — admin review queue for pay adjustments.
 *
 * Module 07 — Pay Protection. Lists `pending_review` rows by default with
 * filters by type, date range and contractor. Each row gives Approve / Reject
 * affordances via PayAdjustmentReviewCard.
 *
 * The route registers regardless of FF_PAY_PROTECTION (admin queue stays
 * accessible per Module 07 §11 Rollback). Server endpoints enforce auth.
 */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, ShieldCheck, Filter, RefreshCw } from 'lucide-react';
import PayAdjustmentReviewCard, {
    type AdminPayAdjustment,
} from '@/components/admin/PayAdjustmentReviewCard';
import { adminFetch } from '@/lib/adminFetch';

const NAVY = '#1B2A4A';
const YELLOW = '#F5A623';
const BORDER = '#D0D5E3';
const MUTED = '#6B7280';
const TEXT_DARK = '#111827';
const BG_LIGHT = '#F7F8FC';

type StatusFilter = 'pending_review' | 'auto_approved' | 'admin_approved' | 'rejected' | 'all';
type TypeFilter = 'all' | 'misscope_uplift' | 'callout_fee' | 'cancellation_comp'
    | 'materials_reimbursement' | 'day_rate_topup' | 'completion_bonus';

const STATUS_TABS: { id: StatusFilter; label: string }[] = [
    { id: 'pending_review', label: 'Pending review' },
    { id: 'auto_approved', label: 'Auto-approved' },
    { id: 'admin_approved', label: 'Approved' },
    { id: 'rejected', label: 'Rejected' },
    { id: 'all', label: 'All' },
];

const TYPE_OPTIONS: { id: TypeFilter; label: string }[] = [
    { id: 'all', label: 'All types' },
    { id: 'misscope_uplift', label: 'Mis-scope uplift' },
    { id: 'callout_fee', label: 'Call-out fee' },
    { id: 'cancellation_comp', label: 'Cancellation comp' },
    { id: 'materials_reimbursement', label: 'Materials' },
    { id: 'day_rate_topup', label: 'Day-rate top-up' },
    { id: 'completion_bonus', label: 'Completion bonus' },
];

interface ListResponse {
    /** Server returns `adjustments` (Module 07 admin route). Old shape used `data` — accept both. */
    adjustments?: AdminPayAdjustment[];
    data?: AdminPayAdjustment[];
    count?: number;
    meta?: { total: number; limit: number; offset: number };
}

async function fetchList(
    status: StatusFilter,
    type: TypeFilter,
    contractor: string,
): Promise<AdminPayAdjustment[]> {
    const params = new URLSearchParams();
    if (status !== 'all') params.set('status', status);
    if (type !== 'all') params.set('type', type);
    if (contractor.trim()) params.set('contractor', contractor.trim());
    params.set('limit', '100');

    const res = await adminFetch(`/api/admin/pay-adjustments?${params.toString()}`);
    if (res.status === 503) {
        throw new Error('Pay-protection module not enabled.');
    }
    if (!res.ok) {
        throw new Error(`Failed to load (${res.status})`);
    }
    const body: ListResponse | AdminPayAdjustment[] = await res.json();
    if (Array.isArray(body)) return body;
    return body.adjustments ?? body.data ?? [];
}

export default function PayAdjustmentsAdminPage() {
    const [status, setStatus] = useState<StatusFilter>('pending_review');
    const [type, setType] = useState<TypeFilter>('all');
    const [contractor, setContractor] = useState('');

    const listQ = useQuery<AdminPayAdjustment[]>({
        queryKey: ['admin-pay-adjustments', status, type, contractor],
        queryFn: () => fetchList(status, type, contractor),
        refetchInterval: 30_000,
    });

    const stats = useMemo(() => {
        const list = listQ.data ?? [];
        const totalPence = list.reduce((sum, a) => sum + (a.amount_pence ?? 0), 0);
        return { count: list.length, totalPence };
    }, [listQ.data]);

    return (
        <div className="min-h-screen" style={{ backgroundColor: BG_LIGHT, color: TEXT_DARK, fontFamily: 'Poppins, sans-serif' }}>
            {/* Header */}
            <header
                className="border-b"
                style={{ backgroundColor: NAVY, color: 'white', borderColor: NAVY }}
            >
                <div className="max-w-6xl mx-auto px-6 py-5 flex items-center gap-3">
                    <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                        style={{ backgroundColor: 'rgba(245,166,35,0.15)' }}
                    >
                        <ShieldCheck className="h-5 w-5" style={{ color: YELLOW }} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[10px] uppercase tracking-[0.12em] font-semibold opacity-60">
                            Module 07 — Pay Protection
                        </p>
                        <h1 className="text-xl sm:text-2xl font-bold">Pay adjustments</h1>
                    </div>
                    <button
                        type="button"
                        onClick={() => listQ.refetch()}
                        className="p-2 rounded-lg hover:bg-white/10"
                        aria-label="Refresh"
                    >
                        <RefreshCw className={`h-4 w-4 ${listQ.isFetching ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-6 py-6 space-y-5">

                {/* Filter bar */}
                <section className="bg-white rounded-2xl border p-4 space-y-3" style={{ borderColor: BORDER }}>
                    <div className="flex items-center gap-2 mb-1">
                        <Filter className="h-4 w-4" style={{ color: MUTED }} />
                        <span className="text-[12px] font-bold uppercase tracking-[0.06em]" style={{ color: MUTED }}>
                            Filters
                        </span>
                    </div>

                    {/* Status tabs */}
                    <div className="flex flex-wrap gap-1.5">
                        {STATUS_TABS.map(tab => {
                            const active = tab.id === status;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setStatus(tab.id)}
                                    className="px-3 py-1.5 rounded-full text-[12px] font-bold transition-colors"
                                    style={{
                                        backgroundColor: active ? NAVY : BG_LIGHT,
                                        color: active ? 'white' : MUTED,
                                    }}
                                >
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Type + contractor filter row */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label className="text-[10px] uppercase tracking-[0.06em] font-bold block mb-1" style={{ color: MUTED }}>
                                Type
                            </label>
                            <select
                                value={type}
                                onChange={(e) => setType(e.target.value as TypeFilter)}
                                className="w-full rounded-lg border px-3 py-2 text-[14px] bg-white"
                                style={{ borderColor: BORDER }}
                            >
                                {TYPE_OPTIONS.map(o => (
                                    <option key={o.id} value={o.id}>{o.label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-[10px] uppercase tracking-[0.06em] font-bold block mb-1" style={{ color: MUTED }}>
                                Contractor (id or name)
                            </label>
                            <input
                                type="text"
                                value={contractor}
                                onChange={(e) => setContractor(e.target.value)}
                                placeholder="Filter by contractor"
                                className="w-full rounded-lg border px-3 py-2 text-[14px]"
                                style={{ borderColor: BORDER }}
                            />
                        </div>
                    </div>
                </section>

                {/* Summary line */}
                <div className="flex items-baseline justify-between px-1">
                    <p className="text-[13px]" style={{ color: MUTED }}>
                        <span className="font-bold" style={{ color: TEXT_DARK }}>{stats.count}</span> result{stats.count === 1 ? '' : 's'}
                        {' · '}
                        total <span className="font-bold" style={{ color: TEXT_DARK }}>£{(stats.totalPence / 100).toFixed(2)}</span>
                    </p>
                    {listQ.isFetching && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: MUTED }} />
                    )}
                </div>

                {/* Body */}
                {listQ.isLoading ? (
                    <div className="bg-white rounded-2xl border p-12 flex items-center justify-center" style={{ borderColor: BORDER }}>
                        <Loader2 className="h-6 w-6 animate-spin" style={{ color: NAVY }} />
                    </div>
                ) : listQ.isError ? (
                    <div
                        className="rounded-2xl border p-5 text-[13px]"
                        style={{ borderColor: BORDER, backgroundColor: '#FEF2F2', color: '#991B1B' }}
                    >
                        {(listQ.error as Error)?.message ?? 'Failed to load adjustments.'}
                    </div>
                ) : (listQ.data ?? []).length === 0 ? (
                    <div
                        className="bg-white rounded-2xl border p-12 text-center"
                        style={{ borderColor: BORDER }}
                    >
                        <p className="text-[14px] font-bold" style={{ color: NAVY }}>Nothing here</p>
                        <p className="text-[12px] mt-1" style={{ color: MUTED }}>
                            No adjustments match your filters.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {(listQ.data ?? []).map(a => (
                            <PayAdjustmentReviewCard key={a.id} adjustment={a} />
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}
