/**
 * The Handy Desk's "More" menu: the sidebar's admin destinations (components/layout/admin-nav.ts)
 * and Log out, for the desk that renders outside the admin shell. The desk loads it on first open.
 */
import { Link, useLocation } from "wouter";
import { LogOut } from "lucide-react";
import { hasAdminToken } from "@/hooks/usePriceQueue";
import { useOldComms } from "@/hooks/useOldComms";
import { adminNavGroups, logOut } from "@/components/layout/admin-nav";
import { cn } from "@/lib/utils";

function sessionIsVA(): boolean {
    try {
        return JSON.parse(localStorage.getItem('adminUser') ?? 'null')?.role === 'va';
    } catch {
        return false;
    }
}

export default function AdminNavMenu({ onNavigate }: { onNavigate: () => void }) {
    const [location, setLocation] = useLocation();
    const { data: oldComms } = useOldComms({ enabled: hasAdminToken() });
    const groups = adminNavGroups({
        isVA: sessionIsVA(),
        commsRetired: oldComms?.retired === true,
        isLive: false,
        followUpCount: 0,
        reviewCount: 0,
        priceQueueCount: 0,
        kbWaiting: 0,
        visionFailing: null,
    });
    return (
        <nav aria-label="Admin pages" data-testid="desk-more-menu" className="max-h-[70vh] w-64 overflow-y-auto py-2">
            {groups.map((group) => (
                <div key={group.title} className="px-2 pb-2">
                    <h3 className="px-2 py-1 text-[10px] font-black uppercase tracking-wider text-slate-500">{group.title}</h3>
                    {group.items.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            onClick={onNavigate}
                            className={cn(
                                "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                                location === item.href ? "bg-slate-800 text-amber-400" : "text-slate-300 hover:bg-slate-800 hover:text-white",
                            )}
                        >
                            <item.icon className="h-4 w-4 shrink-0" /> {item.label}
                        </Link>
                    ))}
                </div>
            ))}
            <div className="border-t border-slate-800 px-2 pt-2">
                <button
                    type="button"
                    onClick={() => logOut(setLocation)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-amber-400"
                >
                    <LogOut className="h-4 w-4" /> Log out
                </button>
            </div>
        </nav>
    );
}
