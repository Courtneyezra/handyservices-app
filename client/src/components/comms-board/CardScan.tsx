/**
 * The two marks a stripped-back card carries on both new-desk surfaces (captain, 17 Sep 2026: a card
 * shows scanning information only, and the text lives in the thread a tap opens): the channel a reply
 * would go on, and the dot for a draft the desk held back. Shared by the comms board's cards and
 * Floor tokens (`./BoardViews.tsx`) and the Handy Desk's "Needs you" queue cards
 * (`client/src/pages/admin/HandyDesk.tsx`), so both read the same way.
 */
import { Mail, MessageCircle, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { channelLabel } from '@/lib/comms-v2-thread';
import type { BoardCard } from '@/pages/admin/CommsV2BoardPage';

const CHANNEL_ICON: Record<string, typeof MessageSquare> = { whatsapp: MessageCircle, sms: MessageSquare, email: Mail };

/** The channel a reply would go on, as an icon that names itself. */
export function ChannelIcon({ channel, className }: { channel: BoardCard['replyChannel']; className?: string }) {
    const label = channelLabel(channel) || 'No reply channel';
    const Icon = (channel && CHANNEL_ICON[channel]) || MessageSquare;
    return (
        <span role="img" aria-label={label} title={label} className={cn('inline-flex shrink-0', !channel && 'opacity-40', className)}>
            <Icon aria-hidden className="h-3.5 w-3.5" />
        </span>
    );
}

/** The amber dot a held card wears when the desk held a draft back. */
export function DraftDot({ testId }: { testId: string }) {
    return <span data-testid={testId} role="img" aria-label="Draft ready" title="Draft ready" className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />;
}
