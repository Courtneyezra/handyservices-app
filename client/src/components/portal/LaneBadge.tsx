import { cn } from '@/lib/utils';
import { READINESS_UI, readinessUi, isIntakeReadiness } from '@shared/intake-readiness';

/**
 * The clerk's verdict as a lane chip — never a score.
 *
 * P8 / C: labels and colours come from the ONE vocabulary (shared/intake-readiness.ts), the same
 * record the comms board pills and the thread card use. Takes any string on purpose: a value the
 * vocabulary does not know renders as a neutral chip instead of crashing or hiding the row.
 */
export const LANE_BLURB: Record<string, string> = Object.fromEntries(
    Object.entries(READINESS_UI).map(([k, v]) => [k, v.blurb]),
);

export function LaneBadge({ lane, className }: { lane: string; className?: string }) {
    const ui = readinessUi(lane);
    return (
        <span
            title={isIntakeReadiness(lane) ? ui.blurb : undefined}
            className={cn(
                'inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide',
                ui.chip,
                className,
            )}
        >
            {ui.label}
        </span>
    );
}
