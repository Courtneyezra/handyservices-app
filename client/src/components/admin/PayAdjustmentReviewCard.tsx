/**
 * PayAdjustmentReviewCard — single admin review card.
 *
 * Module 07 — Pay Protection. Larger than the contractor card: shows
 * full evidence inline plus Approve / Reject affordances. Uses TanStack
 * Query mutations against /api/admin/pay-adjustments/:id/{approve|reject}.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X, Loader2, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
    fmtPence,
    statusMeta,
    typeMeta,
    type PayAdjustment,
} from '@/components/contractor/PayAdjustmentCard';

const NAVY = '#1B2A4A';
const NAVY_DEEP = '#152340';
const BORDER = '#D0D5E3';
const MUTED = '#6B7280';
const TEXT_DARK = '#111827';
const BG_LIGHT = '#F7F8FC';

export interface AdminPayAdjustment extends PayAdjustment {
    contractor_name?: string | null;
    contractor_id?: string | null;
    unit_id?: string | null;
    dispatch_summary?: string | null;
}

interface Props {
    adjustment: AdminPayAdjustment;
}

export default function PayAdjustmentReviewCard({ adjustment }: Props) {
    const tm = typeMeta(adjustment.type);
    const sm = statusMeta(adjustment.status);
    const { Icon: TypeIcon } = tm;
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const [showRejectForm, setShowRejectForm] = useState(false);
    const [rejectReason, setRejectReason] = useState('');
    const [approveAmount, setApproveAmount] = useState<string>(
        ((adjustment.amount_pence ?? 0) / 100).toFixed(2),
    );
    const [approveNote, setApproveNote] = useState('');

    const approve = useMutation({
        mutationFn: async () => {
            const body = {
                approved_pence: Math.round(Number(approveAmount) * 100),
                note: approveNote.trim() || undefined,
            };
            const res = await fetch(`/api/admin/pay-adjustments/${adjustment.id}/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err?.error || `Approve failed (${res.status})`);
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-pay-adjustments'] });
            toast({ title: 'Approved', description: 'Adjustment approved.' });
        },
        onError: (e: Error) => {
            toast({ title: 'Error', description: e.message, variant: 'destructive' });
        },
    });

    const reject = useMutation({
        mutationFn: async () => {
            if (!rejectReason.trim()) {
                throw new Error('Reason required to reject');
            }
            const res = await fetch(`/api/admin/pay-adjustments/${adjustment.id}/reject`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ reason: rejectReason.trim() }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err?.error || `Reject failed (${res.status})`);
            }
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin-pay-adjustments'] });
            toast({ title: 'Rejected', description: 'Claim rejected.' });
            setShowRejectForm(false);
        },
        onError: (e: Error) => {
            toast({ title: 'Error', description: e.message, variant: 'destructive' });
        },
    });

    const ageHours = (() => {
        try {
            const created = new Date(adjustment.created_at).getTime();
            return Math.floor((Date.now() - created) / 3_600_000);
        } catch {
            return 0;
        }
    })();

    const isPending = adjustment.status === 'pending_review';

    return (
        <div
            className="bg-white rounded-2xl border overflow-hidden"
            style={{
                borderColor: BORDER,
                borderLeftWidth: isPending ? 4 : 1,
                borderLeftColor: isPending ? sm.border : BORDER,
            }}
        >
            {/* Header strip */}
            <div className="p-4 flex items-start gap-3 border-b" style={{ borderColor: BORDER }}>
                <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${tm.tint}15` }}
                >
                    <TypeIcon className="h-5 w-5" style={{ color: tm.tint }} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[15px] font-bold" style={{ color: TEXT_DARK }}>
                            {tm.label}
                        </p>
                        <span
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-[0.04em]"
                            style={{ backgroundColor: sm.bg, color: sm.fg }}
                        >
                            {sm.label}
                        </span>
                        {ageHours > 24 && isPending && (
                            <span
                                className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-[0.04em]"
                                style={{ backgroundColor: '#FEF2F2', color: '#991B1B' }}
                            >
                                {ageHours}h old
                            </span>
                        )}
                    </div>
                    <p className="text-[12px] mt-1" style={{ color: MUTED }}>
                        {adjustment.contractor_name ?? 'Contractor'}
                        {adjustment.contractor_id && (
                            <> · <span className="font-mono">{adjustment.contractor_id.slice(0, 8)}</span></>
                        )}
                        {adjustment.dispatch_summary && <> · {adjustment.dispatch_summary}</>}
                    </p>
                </div>
                <div className="text-right shrink-0">
                    <p className="text-[10px] uppercase tracking-[0.06em] font-bold" style={{ color: MUTED }}>
                        Requested
                    </p>
                    <p className="text-[20px] font-bold tabular-nums" style={{ color: NAVY }}>
                        {fmtPence(adjustment.amount_pence)}
                    </p>
                </div>
            </div>

            {/* Detail body */}
            <div className="p-4 space-y-3">
                {adjustment.variance_pct != null && (
                    <DetailRow label="Variance" value={`${adjustment.variance_pct.toFixed(2)}× baseline`} />
                )}
                {adjustment.dispatch_id && (
                    <DetailRow
                        label="Dispatch"
                        value={
                            <span className="font-mono text-[12px]">{adjustment.dispatch_id}</span>
                        }
                    />
                )}
                {adjustment.reason && (
                    <DetailRow label="Reason" value={adjustment.reason} block />
                )}

                {adjustment.evidence_photos && adjustment.evidence_photos.length > 0 && (
                    <div>
                        <p className="text-[10px] uppercase tracking-[0.06em] font-bold mb-2" style={{ color: MUTED }}>
                            Evidence ({adjustment.evidence_photos.length})
                        </p>
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                            {adjustment.evidence_photos.map((url, i) => (
                                <a
                                    key={i}
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block aspect-square rounded-lg overflow-hidden border relative group"
                                    style={{ borderColor: BORDER }}
                                >
                                    <img src={url} alt={`evidence ${i + 1}`} className="w-full h-full object-cover" />
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                                        <ExternalLink className="h-4 w-4 text-white opacity-0 group-hover:opacity-100" />
                                    </div>
                                </a>
                            ))}
                        </div>
                    </div>
                )}

                {/* Actions — only for pending_review */}
                {isPending && (
                    <div className="pt-3 border-t mt-2 space-y-3" style={{ borderColor: BORDER }}>
                        {!showRejectForm ? (
                            <>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-[10px] uppercase tracking-[0.06em] font-bold block mb-1" style={{ color: MUTED }}>
                                            Approve amount (£)
                                        </label>
                                        <input
                                            type="number"
                                            min={0}
                                            step={0.01}
                                            value={approveAmount}
                                            onChange={(e) => setApproveAmount(e.target.value)}
                                            className="w-full rounded-lg border px-3 py-2 text-[14px]"
                                            style={{ borderColor: BORDER }}
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] uppercase tracking-[0.06em] font-bold block mb-1" style={{ color: MUTED }}>
                                            Note (optional)
                                        </label>
                                        <input
                                            type="text"
                                            value={approveNote}
                                            onChange={(e) => setApproveNote(e.target.value)}
                                            className="w-full rounded-lg border px-3 py-2 text-[14px]"
                                            style={{ borderColor: BORDER }}
                                            placeholder="Internal note"
                                        />
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setShowRejectForm(true)}
                                        className="flex-1 px-4 py-2.5 rounded-xl font-semibold text-[13px] border hover:bg-[#F7F8FC] inline-flex items-center justify-center gap-2"
                                        style={{ borderColor: BORDER, color: MUTED }}
                                    >
                                        <X className="h-4 w-4" />
                                        Reject
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => approve.mutate()}
                                        disabled={approve.isPending}
                                        className="flex-1 px-4 py-2.5 rounded-xl font-bold text-[13px] text-white inline-flex items-center justify-center gap-2 active:scale-[0.97] transition-all disabled:opacity-60"
                                        style={{ backgroundColor: NAVY }}
                                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = NAVY_DEEP; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = NAVY; }}
                                    >
                                        {approve.isPending ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Check className="h-4 w-4 stroke-[3]" />
                                        )}
                                        Approve
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase tracking-[0.06em] font-bold block" style={{ color: MUTED }}>
                                    Reason for rejection
                                </label>
                                <textarea
                                    value={rejectReason}
                                    onChange={(e) => setRejectReason(e.target.value)}
                                    rows={2}
                                    className="w-full rounded-lg border px-3 py-2 text-[14px]"
                                    style={{ borderColor: BORDER }}
                                    placeholder="Visible to the contractor"
                                    autoFocus
                                />
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setShowRejectForm(false)}
                                        className="flex-1 px-4 py-2.5 rounded-xl font-semibold text-[13px] border hover:bg-[#F7F8FC]"
                                        style={{ borderColor: BORDER, color: MUTED }}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => reject.mutate()}
                                        disabled={reject.isPending}
                                        className="flex-1 px-4 py-2.5 rounded-xl font-bold text-[13px] text-white inline-flex items-center justify-center gap-2 disabled:opacity-60"
                                        style={{ backgroundColor: '#B91C1C' }}
                                    >
                                        {reject.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4 stroke-[3]" />}
                                        Confirm reject
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {!isPending && adjustment.review_notes && (
                    <DetailRow label="Admin note" value={adjustment.review_notes} block />
                )}
            </div>
        </div>
    );
}

function DetailRow({
    label,
    value,
    block,
}: {
    label: string;
    value: React.ReactNode;
    block?: boolean;
}) {
    if (block) {
        return (
            <div>
                <p className="text-[10px] uppercase tracking-[0.06em] font-bold" style={{ color: MUTED }}>
                    {label}
                </p>
                <p className="text-[13px] leading-relaxed mt-1" style={{ color: TEXT_DARK }}>
                    {value}
                </p>
            </div>
        );
    }
    return (
        <div className="flex items-baseline gap-3">
            <span className="text-[10px] uppercase tracking-[0.06em] font-bold w-20 shrink-0" style={{ color: MUTED }}>
                {label}
            </span>
            <span className="text-[13px]" style={{ color: TEXT_DARK }}>
                {value}
            </span>
        </div>
    );
}
