/**
 * The comms board's slim header, rendering full screen outside the admin shell (`isFullScreenAdmin`,
 * client/src/lib/handy-desk-path.ts). Words only (captain, 18 Sep 2026: plain, very few icons): the
 * Handy Services logo, the page's title, the way back to the Handy Desk, the diary still to come, then
 * the page's own controls (`children`) and a More menu that stands in for the sidebar.
 */
import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { HANDY_DESK_PATH } from "@/lib/handy-desk-path";
import handyLogo from "@/assets/handy-logo.webp";

const AdminNavMenu = lazy(() => import("@/components/layout/AdminNavMenu"));

const WORD = "inline-flex min-h-9 shrink-0 items-center whitespace-nowrap text-[13px] transition-colors";

/** With no sidebar on the page, this is the way to the rest of the admin and to Log out; loaded on first open. */
function MoreMenu() {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);
    return (
        <div className="relative">
            <button
                type="button"
                data-testid="desk-more-button"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className={cn(WORD, open ? 'text-white underline underline-offset-4' : 'text-slate-300 hover:text-white')}
            >
                More
            </button>
            {open && (
                <>
                    <div aria-hidden className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                    <div className="absolute right-0 top-full z-50 mt-2 rounded-md border border-slate-700 bg-slate-900 shadow-xl">
                        <Suspense fallback={<p className="p-4 text-xs text-slate-400">Loading…</p>}>
                            <AdminNavMenu onNavigate={() => setOpen(false)} />
                        </Suspense>
                    </div>
                </>
            )}
        </div>
    );
}

export function FullScreenHeader({ title, logoTestId, children }: { title: string; logoTestId: string; children?: ReactNode }) {
    return (
        <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-b border-slate-800 px-4 py-2 sm:px-6">
            <img data-testid={logoTestId} src={handyLogo} alt="Handy Services" width={28} height={28} className="h-7 w-7 shrink-0 rounded-full object-cover" />
            <h1 className="text-[15px] font-bold tracking-[-0.01em] text-white">{title}</h1>
            <Link href={HANDY_DESK_PATH} data-testid="header-link-handy-desk" className={cn(WORD, 'text-slate-300 hover:text-white')}>Handy Desk</Link>
            <span data-testid="header-link-diary" aria-disabled="true" title="Coming soon" className={cn(WORD, 'hidden cursor-not-allowed text-slate-500 sm:inline-flex')}>Diary (soon)</span>
            <div className="ml-auto flex items-center gap-5">
                {children}
                <MoreMenu />
            </div>
        </header>
    );
}
