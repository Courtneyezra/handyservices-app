/**
 * PayAdjustmentCard — single pay-adjustment row in the contractor view.
 *
 * Module 07 — Pay Protection. Renders one `pay_adjustments` row with
 * type icon, amount, status badge, date and reason. Tap to expand for
 * full detail + evidence photo strip.
 *
 * Status colour map per Module 13 brand tokens:
 *   pending_review  → gold left border
 *   auto_approved   → emerald
 *   admin_approved  → emerald
 *   rejected        → muted gray
 */
import { useState } from 'react';
import { ChevronDown, Hammer, AlertTriangle, Receipt, Trophy, Clock, ShieldCheck, X as XIcon, Check as CheckIcon } from 'lucide-react';

const NAVY = '#1B2A4A';
const YELLOW = '#F5A623';
const YELLOW_LIGHT = '#FFF8EC';
const YELLOW_TEXT = '#92591E';
const BORDER = '#D0D5E3';
const MUTED = '#6B7280';
const TEXT_DARK = '#111827';
const BG_LIGHT = '#F7F8FC';

export type PayAdjustmentStatus = 'auto_approved' | 'pending_review' | 'admin_approved' | 'rejected';

export type PayAdjustmentType =
    | 'misscope_uplift'
    | 'mis_scope_uplift'        // legacy alias
    | 'callout_fee'
    | 'callout'                  // legacy alias
    | 'cancellation_comp'
    | 'materials_reimbursement'
    | 'materials'                // legacy alias
    | 'day_rate_topup'
    | 'completion_bonus';

export interface PayAdjustment {
    id: string;
    type: PayAdjustmentType;
    status: PayAdjustmentStatus;
    amount_pence: number;
    reason: string | null;
    evidence_photos: string[] | null;
    variance_pct?: number | null;
    dispatch_id: string | null;
    created_at: string;
    resolved_at?: string | null;
    resolved_by?: string | null;
    review_notes?: string | null;
}

export function fmtPence(p: number): string {
    return `£${(p / 100).toFixed(2).replace(/\.00$/, '')}`;
}

export function typeMeta(type: PayAdjustmentType): { label: string; Icon: typeof Hammer; tint: string } {
    switch (type) {
        case 'misscope_uplift':
        case 'mis_scope_uplift':
            return { label: 'Mis-scope uplift', Icon: Hammer, tint: NAVY };
        case 'callout_fee':
        case 'callout':
            return { label: 'Call-out fee', Icon: AlertTriangle, tint: '#D97706' };
        case 'cancellation_comp':
            return { label: 'Cancellation comp', Icon: Clock, tint: '#7C3AED' };
        case 'materials_reimbursement':
        case 'materials':
            return { label: 'Materials reimbursement', Icon: Receipt, tint: '#0891B2' };
        case 'day_rate_topup':
            return { label: 'Day-rate top-up', Icon: ShieldCheck, tint: NAVY };
        case 'completion_bonus':
            return { label: 'Completion bonus', Icon: Trophy, tint: YELLOW };
        default:
            return { label: 'Pay adjustment', Icon: ShieldCheck, tint: NAVY };
    }
}

export function statusMeta(status: PayAdjustmentStatus): {
    label: string;
    bg: string;
    fg: string;
    border: string;
    Icon: typeof CheckIcon;
} {
    switch (status) {
        case 'pending_review':
            return { label: 'Pending review', bg: YELLOW_LIGHT, fg: YELLOW_TEXT, border: YELLOW, Icon: Clock };
        case 'auto_approved':
            return { label: 'Auto-approved', bg: '#ECFDF5', fg: '#065F46', border: '#10B981', Icon: CheckIcon };
        case 'admin_approved':
            return { label: 'Approved', bg: '#ECFDF5', fg: '#065F46', border: '#10B981', Icon: CheckIcon };
        case 'rejected':
            return { label: 'Rejected', bg: BG_LIGHT, fg: MUTED, border: BORDER, Icon: XIcon };
        default:
            return { label: status, bg: BG_LIGHT, fg: MUTED, border: BORDER, Icon: ShieldCheck };
    }
}

function fmtDate(iso: string): string {
    try {
        return new Date(iso).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        });
    } catch {
        return iso;
    }
}

interface Props {
    adjustment: PayAdjustment;
    /** Visual emphasis for pending-review (yellow left bar). Defaults to true for pending. */
    accent?: boolean;
}

export default function PayAdjustmentCard({ adjustment, accent }: Props) {
    const [expanded, setExpanded] = useState(false);
    const tm = typeMeta(adjustment.type);
    const sm = statusMeta(adjustment.status);
    const { Icon: TypeIcon } = tm;
    const { Icon: StatusIcon } = sm;
    const showAccent = accent ?? adjustment.status === 'pending_review';
    const reasonShort = adjustment.reason
        ? adjustment.reason.length > 80
            ? `${adjustment.reason.slice(0, 80)}…`
            : adjustment.reason
        : null;

    return (
        <div
            className="bg-white rounded-2xl border overflow-hidden transition-all"
            style={{
                borderColor: BORDER,
                borderLeftWidth: showAccent ? 4 : 1,
                borderLeftColor: showAccent ? sm.border : BORDER,
            }}
        >
            <button
                type="button"
                onClick={() => setExpanded(v => !v)}
                className="w-full text-left p-4 flex items-start gap-3 hover:bg-[#F7F8FC] transition-colors"
            >
                <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${tm.tint}15` }}
                >
                    <TypeIcon className="h-4 w-4" style={{ color: tm.tint }} />
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[14px] font-bold leading-tight" style={{ color: TEXT_DARK }}>
                            {tm.label}
                        </p>
                        <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-[0.04em]"
                            style={{ backgroundColor: sm.bg, color: sm.fg }}
                        >
                            <StatusIcon className="h-3 w-3 stroke-[3]" />
                            {sm.label}
                        </span>
                    </div>
                    <p className="text-[12px] mt-1" style={{ color: MUTED }}>
                        {fmtDate(adjustment.created_at)}
                        {adjustment.variance_pct != null && (
                            <> · variance {(adjustment.variance_pct).toFixed(2)}×</>
                        )}
                    </p>
                    {reasonShort && (
                        <p className="text-[12px] mt-1.5 leading-snug" style={{ color: MUTED }}>
                            {reasonShort}
                        </p>
                    )}
                </div>

                <div className="text-right shrink-0">
                    <p className="text-[18px] font-bold tabular-nums leading-none" style={{ color: NAVY }}>
                        {fmtPence(adjustment.amount_pence)}
                    </p>
                    <ChevronDown
                        className={`h-4 w-4 mt-2 ml-auto transition-transform ${expanded ? 'rotate-180' : ''}`}
                        style={{ color: MUTED }}
                    />
                </div>
            </button>

            {expanded && (
                <div className="px-4 pb-4 pt-0 border-t" style={{ borderColor: BORDER }}>
                    <div className="space-y-3 pt-3">
                        {adjustment.dispatch_id && (
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.06em] font-bold" style={{ color: MUTED }}>
                                    Dispatch
                                </p>
                                <p className="text-[12px] font-mono" style={{ color: TEXT_DARK }}>
                                    {adjustment.dispatch_id.slice(0, 8)}…
                                </p>
                            </div>
                        )}
                        {adjustment.reason && (
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.06em] font-bold" style={{ color: MUTED }}>
                                    Reason
                                </p>
                                <p className="text-[13px] leading-relaxed" style={{ color: TEXT_DARK }}>
                                    {adjustment.reason}
                                </p>
                            </div>
                        )}
                        {adjustment.evidence_photos && adjustment.evidence_photos.length > 0 && (
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.06em] font-bold mb-1.5" style={{ color: MUTED }}>
                                    Evidence ({adjustment.evidence_photos.length})
                                </p>
                                <div className="grid grid-cols-3 gap-2">
                                    {adjustment.evidence_photos.map((url, i) => (
                                        <a
                                            key={i}
                                            href={url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="block aspect-square rounded-lg overflow-hidden border"
                                            style={{ borderColor: BORDER }}
                                        >
                                            <img src={url} alt={`evidence ${i + 1}`} className="w-full h-full object-cover" />
                                        </a>
                                    ))}
                                </div>
                            </div>
                        )}
                        {adjustment.review_notes && (
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.06em] font-bold" style={{ color: MUTED }}>
                                    Admin notes
                                </p>
                                <p className="text-[13px] leading-relaxed" style={{ color: TEXT_DARK }}>
                                    {adjustment.review_notes}
                                </p>
                            </div>
                        )}
                        {adjustment.resolved_at && (
                            <p className="text-[11px]" style={{ color: MUTED }}>
                                Resolved {fmtDate(adjustment.resolved_at)}
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
