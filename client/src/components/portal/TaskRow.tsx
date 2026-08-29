import { Link } from 'wouter';
import { cn } from '@/lib/utils';
import { LaneBadge } from './LaneBadge';
import { ageLabel, type PortalCard } from './types';

/**
 * One row of the task inbox: who, why it needs a human (lane badge + signal chips), how old,
 * and one line of what they said. The whole row is the tap target — phone-first.
 */
export function TaskRow({ card }: { card: PortalCard }) {
    const name = card.contactName?.trim() || card.displayPhone;
    const signals: Array<{ text: string; style: string }> = [];
    if (card.complaint) signals.push({ text: 'Complaint', style: 'bg-red-100 text-red-700' });
    if (card.callbackDue) signals.push({ text: 'Callback due', style: 'bg-red-100 text-red-700' });
    if (card.openQuestionCount > 0) signals.push({
        text: card.openQuestionCount === 1 ? 'Question for you' : `${card.openQuestionCount} questions`,
        style: 'bg-blue-100 text-blue-700',
    });
    if (card.heldDraftCount > 0) signals.push({
        text: card.heldDraftCount === 1 ? 'Held draft' : `${card.heldDraftCount} held drafts`,
        style: 'bg-purple-100 text-purple-700',
    });
    if (!signals.length && card.tags.includes('needs_ben')) {
        signals.push({ text: 'Flagged', style: 'bg-blue-100 text-blue-700' });
    }

    return (
        <Link
            href={`/admin/portal/review/${card.id}`}
            className={cn(
                'block rounded-xl border bg-white p-3.5 active:bg-slate-50',
                card.wait.severity === 'breached' ? 'border-red-300' : 'border-slate-200',
            )}
        >
            <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[15px] font-bold text-slate-900">{name}</span>
                <span className="whitespace-nowrap font-mono text-xs text-slate-400" title={card.lastMessageAt ?? undefined}>
                    {ageLabel(card.lastCustomerMessageAt ?? card.lastMessageAt)}
                </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {card.intakeReadiness && <LaneBadge lane={card.intakeReadiness} />}
                {signals.map((s) => (
                    <span key={s.text} className={cn('inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide', s.style)}>
                        {s.text}
                    </span>
                ))}
            </div>
            {card.lastMessagePreview && (
                <p className="mt-1.5 truncate text-sm text-slate-600">{card.lastMessagePreview}</p>
            )}
        </Link>
    );
}
