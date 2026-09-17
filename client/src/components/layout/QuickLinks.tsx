/**
 * B1 — quick access to the three Handy Desk destinations (Design export "Comms Board.dc.html" §1):
 * Handy Desk, Diary and Comms board. Diary has no admin page yet (task B6), so it ships disabled as
 * "Coming soon". Held colour is amber (captain's answer 95).
 *
 * Shared by the admin shell (SidebarLayout: desktop header and sub-1024px slide-out) and the Handy
 * Desk's own full-screen header, which renders outside the shell. Each render passes a variant, used
 * as a test id suffix so a test can tell them apart; `desk` is styled for the desk's slate header.
 */
import { useEffect, useState } from "react";
import { Calendar, Kanban, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { hasAdminToken, adminAuthHeaders } from "@/hooks/usePriceQueue";
import { NEW_BOARD_PATH } from "@/hooks/useOldComms";
import { heldCountOf, queueQuery, queueQueryKey, updatedAgoLabel, type DeskQueue } from "@/lib/handy-desk-queue";
import { cn } from "@/lib/utils";
import { HANDY_DESK_PATH } from "@/lib/handy-desk-path";

/**
 * The held-count badge's query. Every admin page polls this every 15s, so it asks for the cheap
 * shape: no `readyToPrice`, so the server does no quote read for a badge that would discard it
 * (client/src/lib/handy-desk-queue.ts `queueQuery`; server/comms-v2/api/queue.ts). A server that
 * lists quotes anyway is belted by `heldCountOf`, which counts held items only. The shell passes
 * enabled=false for VAs, who get no quick links.
 */
export function useHeldCount(enabled: boolean): { heldCount: number | null; updatedAt: number } {
    const { data, dataUpdatedAt } = useQuery<DeskQueue>({
        queryKey: queueQueryKey(),
        queryFn: async () => {
            const res = await fetch(queueQuery(), { headers: adminAuthHeaders() });
            if (!res.ok) throw new Error(`Failed to load the queue (${res.status})`);
            return res.json();
        },
        enabled: enabled && hasAdminToken(),
        refetchInterval: 15_000,
    });
    return { heldCount: data ? heldCountOf(data) : null, updatedAt: dataUpdatedAt };
}

function UpdatedAgo({ updatedAt, className, testId }: { updatedAt: number; className: string; testId: string }) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, []);
    return (
        <span data-testid={testId} className={className}>
            {updatedAgoLabel((now - updatedAt) / 1000)}
        </span>
    );
}

export type QuickLinksVariant = 'desktop' | 'mobile' | 'desk';

export function QuickLinks({ variant, location, heldCount, updatedAt, onNavigate }: {
    variant: QuickLinksVariant;
    location: string;
    heldCount: number | null;
    updatedAt: number;
    onNavigate?: () => void;
}) {
    const vertical = variant === 'mobile';
    const desk = variant === 'desk';
    const linkClass = (active: boolean) => cn(
        "flex items-center gap-1.5 rounded-md text-sm font-medium transition-colors",
        vertical ? "px-3 py-2.5" : "px-3 py-2",
        desk && "shrink-0 whitespace-nowrap",
        desk
            ? (active ? "bg-slate-800 text-amber-400" : "text-slate-300 hover:bg-slate-800 hover:text-white")
            : (active ? "bg-slate-900 text-amber-400" : "text-muted-foreground hover:text-foreground hover:bg-muted"),
    );
    return (
        <nav
            aria-label="Quick links"
            data-testid={`topbar-quick-links-${variant}`}
            className={cn("flex items-center gap-1", vertical ? "flex-col items-stretch gap-1" : "")}
        >
            <Link
                href={HANDY_DESK_PATH}
                data-testid={`topbar-link-handy-desk-${variant}`}
                onClick={onNavigate}
                className={linkClass(location === HANDY_DESK_PATH)}
            >
                <Sparkles className="w-4 h-4" /> Handy Desk
            </Link>
            <span
                title="Coming soon"
                aria-disabled="true"
                data-testid={`topbar-link-diary-${variant}`}
                className={cn(
                    "flex cursor-not-allowed items-center gap-1.5 rounded-md text-sm font-medium",
                    desk ? "shrink-0 whitespace-nowrap text-slate-500" : "text-muted-foreground/50",
                    vertical ? "px-3 py-2.5" : "px-3 py-2",
                )}
            >
                <Calendar className="w-4 h-4" /> Diary
                <span className={cn(
                    "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                    desk ? "bg-slate-800 text-slate-400" : "bg-muted text-muted-foreground",
                )}>Coming soon</span>
            </span>
            <Link
                href={NEW_BOARD_PATH}
                data-testid={`topbar-link-comms-board-${variant}`}
                onClick={onNavigate}
                className={linkClass(location === NEW_BOARD_PATH)}
            >
                <Kanban className="w-4 h-4" /> Comms board
                {heldCount !== null && heldCount > 0 && (
                    <span data-testid={`topbar-held-badge-${variant}`} className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {heldCount}
                    </span>
                )}
            </Link>
            {updatedAt > 0 && (
                <UpdatedAgo
                    updatedAt={updatedAt}
                    testId={`topbar-updated-${variant}`}
                    className={cn(
                        "text-xs",
                        desk ? "text-slate-500" : "text-muted-foreground",
                        vertical ? "px-3 pt-1" : "ml-1 hidden xl:inline",
                    )}
                />
            )}
        </nav>
    );
}
