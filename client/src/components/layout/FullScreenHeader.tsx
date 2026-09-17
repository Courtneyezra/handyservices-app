/**
 * The slim slate header of the admin pages that render full screen, outside the admin shell
 * (client/src/App.tsx): the Handy Desk and the comms board. It carries the Handy Services logo, the
 * page's title and the shell's quick links with their held-count badge; the page adds its own
 * controls after them (`children`), pushed right with `ml-auto`.
 */
import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Loader2, MoreHorizontal } from "lucide-react";
import { QuickLinks, useHeldCount } from "@/components/layout/QuickLinks";
import { cn } from "@/lib/utils";
import handyLogo from "@/assets/handy-logo.webp";

const AdminNavMenu = lazy(() => import("@/components/layout/AdminNavMenu"));

/** With no sidebar on these pages, this is the way to the rest of the admin and to Log out; loaded on first open. */
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
                className={cn('flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors', open ? 'bg-slate-800 text-amber-400' : 'text-slate-300 hover:bg-slate-800 hover:text-white')}
            >
                <MoreHorizontal className="h-4 w-4" /> More
            </button>
            {open && (
                <>
                    <div aria-hidden className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                    <div className="absolute right-0 top-full z-50 mt-2 rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
                        <Suspense fallback={<Loader2 className="m-4 h-4 w-4 animate-spin text-slate-400" />}>
                            <AdminNavMenu onNavigate={() => setOpen(false)} />
                        </Suspense>
                    </div>
                </>
            )}
        </div>
    );
}

export function FullScreenHeader({ title, logoTestId, children }: { title: string; logoTestId: string; children?: ReactNode }) {
    const [location] = useLocation();
    const { heldCount, updatedAt } = useHeldCount(true);
    return (
        <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-800 px-4 py-2 sm:px-6">
            <img data-testid={logoTestId} src={handyLogo} alt="Handy Services" width={32} height={32} className="h-8 w-8 shrink-0 rounded-full object-cover" />
            <h1 className="text-lg font-extrabold tracking-[-0.02em] text-white">{title}</h1>
            <div className="order-last w-full overflow-x-auto md:order-none md:w-auto">
                <QuickLinks variant="desk" location={location} heldCount={heldCount} updatedAt={updatedAt} />
            </div>
            {children}
            <div className={children ? '' : 'ml-auto'}><MoreMenu /></div>
        </header>
    );
}
