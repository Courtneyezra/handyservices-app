/**
 * PayAdjustmentForm — modal for opening a new pay-adjustment claim.
 *
 * Module 07 — Pay Protection. Three claim types:
 *   - misscope_uplift (Mis-scope uplift)
 *   - callout_fee     (Call-out fee)
 *   - materials       (Materials reimbursement)
 *
 * Submits to the relevant /api/contractor/pay-adjustments/* endpoint
 * (see api-surface.md §2.8). Server response carries `{ id, type, status }`
 * — `auto_approved` if the rules clear, `pending_review` for admin review.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Loader2, Hammer, AlertTriangle, Receipt, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import PhotoUpload from './PhotoUpload';

const NAVY = '#1B2A4A';
const NAVY_DEEP = '#152340';
const YELLOW = '#F5A623';
const BORDER = '#D0D5E3';
const MUTED = '#6B7280';
const TEXT_DARK = '#111827';
const BG_LIGHT = '#F7F8FC';

export interface DispatchOption {
    id: string;
    label: string;          // e.g. "Replace lock — NG2 1AH · 6 May"
    estimateMinutes?: number;
}

interface Props {
    /** Recent dispatches the contractor can attach a claim to. */
    dispatches: DispatchOption[];
    onClose: () => void;
    /** Pre-select a type when opening from an inline trigger on a job. */
    initialType?: ClaimType;
    /** Pre-select a dispatch when opening from a job page. */
    initialDispatchId?: string;
}

type ClaimType = 'misscope_uplift' | 'callout_fee' | 'materials';

interface CreatedAdjustment {
    id: string;
    type: string;
    status: 'auto_approved' | 'pending_review';
}

function authHeaders(): Record<string, string> {
    const token = localStorage.getItem('contractorToken');
    return token
        ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
        : { 'Content-Type': 'application/json' };
}

export default function PayAdjustmentForm({
    dispatches,
    onClose,
    initialType,
    initialDispatchId,
}: Props) {
    const [step, setStep] = useState<'choose' | 'fill'>(initialType ? 'fill' : 'choose');
    const [type, setType] = useState<ClaimType | null>(initialType ?? null);
    const [dispatchId, setDispatchId] = useState<string>(initialDispatchId ?? '');
    const [reason, setReason] = useState('');
    const [photos, setPhotos] = useState<string[]>([]);
    const [actualMinutes, setActualMinutes] = useState<string>('');
    const [calloutReason, setCalloutReason] = useState<'no_access' | 'customer_no_show' | 'unsafe'>('customer_no_show');
    const [receiptAmountPence, setReceiptAmountPence] = useState<string>('');
    const [supplier, setSupplier] = useState<string>('');

    const { toast } = useToast();
    const queryClient = useQueryClient();

    const submit = useMutation({
        mutationFn: async (): Promise<CreatedAdjustment> => {
            if (!type) throw new Error('Choose a claim type first');
            if (!dispatchId) throw new Error('Pick a dispatch');

            let url = '';
            let body: Record<string, unknown> = {};

            if (type === 'misscope_uplift') {
                if (photos.length === 0) throw new Error('Add at least one evidence photo');
                if (!reason.trim()) throw new Error('Add a brief reason');
                url = '/api/contractor/pay-adjustments/uplift';
                body = {
                    dispatch_id: dispatchId,
                    photos,
                    reason: reason.trim(),
                    actual_minutes: actualMinutes ? Number(actualMinutes) : undefined,
                };
            } else if (type === 'callout_fee') {
                if (photos.length === 0) throw new Error('Add a photo (door, no-answer note)');
                url = '/api/contractor/pay-adjustments/callout';
                body = {
                    dispatch_id: dispatchId,
                    reason: calloutReason,
                    note: reason.trim() || undefined,
                    photos,
                };
            } else if (type === 'materials') {
                if (photos.length === 0) throw new Error('Receipt photo required');
                if (!receiptAmountPence) throw new Error('Receipt total required');
                url = '/api/contractor/pay-adjustments/materials';
                body = {
                    dispatch_id: dispatchId,
                    receipt_photo_url: photos[0],
                    amount_pence: Math.round(Number(receiptAmountPence) * 100),
                    supplier: supplier.trim() || undefined,
                };
            }

            const res = await fetch(url, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err?.error || `Request failed (${res.status})`);
            }
            return res.json();
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['pay-adjustments-mine'] });
            const tone = data.status === 'auto_approved' ? 'Approved' : 'Submitted for review';
            toast({
                title: tone,
                description: data.status === 'auto_approved'
                    ? 'Adjustment approved automatically.'
                    : 'Admin will review within 24h.',
            });
            onClose();
        },
        onError: (e: Error) => {
            toast({
                title: 'Could not submit',
                description: e.message,
                variant: 'destructive',
            });
        },
    });

    function chooseType(t: ClaimType) {
        setType(t);
        setStep('fill');
    }

    return (
        <div
            className="fixed inset-0 z-[60] backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
            style={{ backgroundColor: 'rgba(17, 24, 39, 0.4)' }}
            onClick={() => onClose()}
        >
            <div
                className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] overflow-hidden shadow-2xl flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <header
                    className="px-5 py-4 flex items-center gap-3 border-b shrink-0"
                    style={{ borderColor: BORDER, backgroundColor: NAVY, color: 'white' }}
                >
                    {step === 'fill' && !initialType && (
                        <button
                            type="button"
                            onClick={() => setStep('choose')}
                            className="p-1 -ml-1 rounded-md hover:bg-white/10"
                            aria-label="Back"
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </button>
                    )}
                    <div className="flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: YELLOW }}>
                            Pay Protection
                        </p>
                        <h2 className="text-[16px] font-bold">
                            {step === 'choose' ? 'Open a claim' : type && labelForType(type)}
                        </h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1 -mr-1 rounded-md hover:bg-white/10"
                        aria-label="Close"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </header>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-5 py-5">
                    {step === 'choose' && (
                        <div className="space-y-2.5">
                            <p className="text-[13px]" style={{ color: MUTED }}>
                                Pick a claim type. Auto-approval kicks in for clean evidence; tougher cases go to admin.
                            </p>
                            <ChoiceButton
                                onClick={() => chooseType('misscope_uplift')}
                                Icon={Hammer}
                                title="Mis-scope uplift"
                                desc="Job ran longer than estimate. Photo + minutes."
                            />
                            <ChoiceButton
                                onClick={() => chooseType('callout_fee')}
                                Icon={AlertTriangle}
                                title="Call-out fee"
                                desc="Customer not home or you couldn't start. £45."
                            />
                            <ChoiceButton
                                onClick={() => chooseType('materials')}
                                Icon={Receipt}
                                title="Materials reimbursement"
                                desc="Receipt + 10% handling. Auto up to £30."
                            />
                        </div>
                    )}

                    {step === 'fill' && type && (
                        <form
                            onSubmit={(e) => { e.preventDefault(); submit.mutate(); }}
                            className="space-y-4"
                        >
                            {/* Dispatch picker */}
                            <Field label="Dispatch" required>
                                <select
                                    value={dispatchId}
                                    onChange={(e) => setDispatchId(e.target.value)}
                                    className="w-full rounded-lg border px-3 py-2 text-[14px] bg-white"
                                    style={{ borderColor: BORDER, color: TEXT_DARK }}
                                >
                                    <option value="">Choose a recent dispatch…</option>
                                    {dispatches.map(d => (
                                        <option key={d.id} value={d.id}>{d.label}</option>
                                    ))}
                                </select>
                                {dispatches.length === 0 && (
                                    <p className="text-[11px] mt-1" style={{ color: MUTED }}>
                                        No recent dispatches found. You can paste a dispatch ID below.
                                    </p>
                                )}
                                {dispatches.length === 0 && (
                                    <input
                                        type="text"
                                        value={dispatchId}
                                        onChange={(e) => setDispatchId(e.target.value)}
                                        placeholder="dispatch id (uuid)"
                                        className="mt-2 w-full rounded-lg border px-3 py-2 text-[12px] font-mono"
                                        style={{ borderColor: BORDER }}
                                    />
                                )}
                            </Field>

                            {type === 'misscope_uplift' && (
                                <>
                                    <Field
                                        label="Actual minutes worked"
                                        hint="We compare against the baseline estimate to compute variance."
                                    >
                                        <input
                                            type="number"
                                            min={0}
                                            step={1}
                                            value={actualMinutes}
                                            onChange={(e) => setActualMinutes(e.target.value)}
                                            className="w-full rounded-lg border px-3 py-2 text-[14px]"
                                            style={{ borderColor: BORDER }}
                                            placeholder="e.g. 180"
                                        />
                                    </Field>
                                    <Field label="What happened" required>
                                        <textarea
                                            value={reason}
                                            onChange={(e) => setReason(e.target.value)}
                                            rows={3}
                                            className="w-full rounded-lg border px-3 py-2 text-[14px]"
                                            style={{ borderColor: BORDER }}
                                            placeholder="Brief description of why the job ran over"
                                        />
                                    </Field>
                                    <PhotoUpload
                                        value={photos}
                                        onChange={setPhotos}
                                        max={4}
                                        required
                                        label="Evidence photos"
                                        hint="Show the extra work / unexpected condition."
                                    />
                                </>
                            )}

                            {type === 'callout_fee' && (
                                <>
                                    <Field label="Reason" required>
                                        <select
                                            value={calloutReason}
                                            onChange={(e) => setCalloutReason(e.target.value as any)}
                                            className="w-full rounded-lg border px-3 py-2 text-[14px] bg-white"
                                            style={{ borderColor: BORDER }}
                                        >
                                            <option value="customer_no_show">Customer not home</option>
                                            <option value="no_access">No access to property</option>
                                            <option value="unsafe">Unsafe to start</option>
                                        </select>
                                    </Field>
                                    <Field label="Notes (optional)">
                                        <textarea
                                            value={reason}
                                            onChange={(e) => setReason(e.target.value)}
                                            rows={2}
                                            className="w-full rounded-lg border px-3 py-2 text-[14px]"
                                            style={{ borderColor: BORDER }}
                                            placeholder="Anything we should know"
                                        />
                                    </Field>
                                    <PhotoUpload
                                        value={photos}
                                        onChange={setPhotos}
                                        max={3}
                                        required
                                        label="Photo evidence"
                                        hint="Closed door, no-answer note, etc."
                                    />
                                </>
                            )}

                            {type === 'materials' && (
                                <>
                                    <Field label="Receipt total (£)" required>
                                        <input
                                            type="number"
                                            min={0}
                                            step={0.01}
                                            value={receiptAmountPence}
                                            onChange={(e) => setReceiptAmountPence(e.target.value)}
                                            className="w-full rounded-lg border px-3 py-2 text-[14px]"
                                            style={{ borderColor: BORDER }}
                                            placeholder="e.g. 24.50"
                                        />
                                    </Field>
                                    <Field label="Supplier (optional)">
                                        <input
                                            type="text"
                                            value={supplier}
                                            onChange={(e) => setSupplier(e.target.value)}
                                            className="w-full rounded-lg border px-3 py-2 text-[14px]"
                                            style={{ borderColor: BORDER }}
                                            placeholder="Screwfix, Wickes, …"
                                        />
                                    </Field>
                                    <PhotoUpload
                                        value={photos}
                                        onChange={setPhotos}
                                        max={3}
                                        required
                                        label="Receipt photo"
                                        hint="First photo is treated as the primary receipt."
                                    />
                                </>
                            )}

                            {submit.isError && (
                                <div
                                    className="rounded-lg p-3 text-[12px]"
                                    style={{ backgroundColor: '#FEE2E2', color: '#991B1B' }}
                                >
                                    {(submit.error as Error)?.message ?? 'Submission failed'}
                                </div>
                            )}

                            <div className="flex gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="flex-1 px-4 py-3 rounded-xl font-semibold text-[14px] hover:bg-[#F7F8FC]"
                                    style={{ color: MUTED }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submit.isPending}
                                    className="flex-1 px-5 py-3 rounded-xl font-bold text-[14px] text-white inline-flex items-center justify-center gap-2 transition-all active:scale-[0.97] disabled:opacity-60"
                                    style={{ backgroundColor: NAVY }}
                                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = NAVY_DEEP; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = NAVY; }}
                                >
                                    {submit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                                    Submit claim
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}

function labelForType(t: ClaimType): string {
    if (t === 'misscope_uplift') return 'Mis-scope uplift';
    if (t === 'callout_fee') return 'Call-out fee';
    return 'Materials reimbursement';
}

function ChoiceButton({
    onClick,
    Icon,
    title,
    desc,
}: {
    onClick: () => void;
    Icon: typeof Hammer;
    title: string;
    desc: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="w-full flex items-start gap-3 p-4 rounded-2xl border bg-white text-left active:scale-[0.99] transition-all hover:shadow-md"
            style={{ borderColor: BORDER }}
        >
            <div
                className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: BG_LIGHT, color: NAVY }}
            >
                <Icon className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-[14px] font-bold" style={{ color: TEXT_DARK }}>{title}</p>
                <p className="text-[12px] mt-0.5" style={{ color: MUTED }}>{desc}</p>
            </div>
        </button>
    );
}

function Field({
    label,
    required,
    hint,
    children,
}: {
    label: string;
    required?: boolean;
    hint?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="space-y-1.5">
            <label className="text-[12px] font-bold uppercase tracking-[0.06em] block" style={{ color: NAVY }}>
                {label}
                {required && <span className="text-red-500 ml-1">*</span>}
            </label>
            {children}
            {hint && (
                <p className="text-[11px]" style={{ color: MUTED }}>{hint}</p>
            )}
        </div>
    );
}
