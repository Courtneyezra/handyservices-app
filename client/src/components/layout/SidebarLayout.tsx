import { useState, useEffect } from "react";
import { LayoutDashboard, PhoneCall, Settings, Bell, HelpCircle, Package, MessageSquare, Wrench, Mic, DollarSign, Menu, X as CloseIcon, Megaphone, LayoutTemplate, Users, Inbox, User, FileText, Calendar, Kanban, GitBranch, Map, ChevronLeft, ChevronRight, Home, BarChart3, ClipboardCheck, Building2, AlertCircle, GraduationCap, BookOpen, LogOut } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { ThemeToggle } from "@/components/ThemeToggle";
import InstallPrompt from "@/components/InstallPrompt";
import { Link, useLocation } from "wouter";
import { useLiveCall } from "@/contexts/LiveCallContext";
import { cn } from "@/lib/utils";
import handyLogo from "@/assets/handy-logo.png";

interface SidebarLayoutProps {
    children: React.ReactNode;
}

export default function SidebarLayout({ children }: SidebarLayoutProps) {
    const [location, setLocation] = useLocation();
    const { isLive } = useLiveCall();
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [showQuoteMenu, setShowQuoteMenu] = useState(false);

    // Parse logged-in user info for menu filtering + display
    const adminUser = (() => {
        try {
            const u = localStorage.getItem('adminUser');
            return u ? JSON.parse(u) : null;
        } catch { return null; }
    })();
    const isVA = adminUser?.role === 'va';
    const displayName = adminUser?.firstName ? `${adminUser.firstName} ${adminUser.lastName || ''}`.trim() : 'Dispatcher';
    const displayEmail = adminUser?.email || '';

    const [isCollapsed, setIsCollapsed] = useState(() => {
        // Persist collapse state in localStorage
        if (typeof window !== 'undefined') {
            return localStorage.getItem('sidebar-collapsed') === 'true';
        }
        return false;
    });

    // Fetch review queue count for sidebar badge
    const { data: reviewData } = useQuery<{ count: number }>({
        queryKey: ["leads-needs-review-count"],
        queryFn: async () => {
            const res = await fetch("/api/admin/leads/needs-review");
            if (!res.ok) return { count: 0 };
            return res.json();
        },
        refetchInterval: 60000, // Refresh every minute
        staleTime: 30000,
    });
    const reviewCount = reviewData?.count || 0;

    // Fetch follow-up inbox count for sidebar badge
    const { data: followUpItems } = useQuery<any[]>({
        queryKey: ['/api/contractor/inbox'],
        queryFn: async () => {
            const res = await fetch('/api/contractor/inbox');
            if (!res.ok) return [];
            return res.json();
        },
        refetchInterval: 15000,
        staleTime: 5000,
    });
    const followUpCount = followUpItems?.length || 0;

    // Persist collapse state
    useEffect(() => {
        localStorage.setItem('sidebar-collapsed', String(isCollapsed));
    }, [isCollapsed]);

    return (
        <div className="flex h-screen bg-background font-sans text-foreground overflow-hidden transition-colors duration-300">
            {/* Mobile Backdrop — hidden for VA (no sidebar) */}
            {!isVA && isSidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* Sidebar — hidden for VA */}
            <aside className={cn(
                "fixed inset-y-0 left-0 bg-card text-card-foreground flex flex-col z-50 transition-all duration-300 lg:relative lg:translate-x-0 border-r border-border",
                isCollapsed ? "w-16" : "w-64",
                isSidebarOpen ? "translate-x-0" : "-translate-x-full",
                isVA && "!hidden"
            )}>
                {/* Logo Area */}
                <div className={cn("p-4 flex items-center gap-3", isCollapsed && "justify-center p-3")}>
                    <img
                        src="/logo.png"
                        alt="Handy"
                        className={cn("object-contain", isCollapsed ? "w-8 h-8" : "w-10 h-10")}
                    />
                    {!isCollapsed && (
                        <div className="flex flex-col leading-tight">
                            <span className="font-bold text-lg text-secondary">Handy</span>
                            <span className="font-normal text-sm text-muted-foreground">Services</span>
                        </div>
                    )}
                </div>

                {/* Collapse Toggle Button - Desktop only */}
                <button
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    className="hidden lg:flex absolute -right-3 top-20 w-6 h-6 bg-primary text-primary-foreground rounded-full items-center justify-center shadow-md hover:bg-primary/90 transition-colors z-50"
                    title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                    {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                </button>

                {/* Navigation */}
                <nav className={cn("flex-1 py-4 space-y-6 overflow-y-auto", isCollapsed ? "px-2" : "px-4")}>
                    {(isVA ? [
                        // ─── VA Menu: stripped down ───
                        {
                            title: "YOUR TOOLS",
                            items: [
                                { icon: PhoneCall, label: "Follow-Ups", href: "/admin/follow-ups", badge: followUpCount > 0 ? String(followUpCount) : null },
                                { icon: Mic, label: "Live Switchboard", href: "/admin/live-call", badge: isLive ? "LIVE" : null },
                                { icon: DollarSign, label: "Quote Generator", href: "/admin/generate-quote" },
                                { icon: FileText, label: "Recent Quotes", href: "/admin/quotes" },
                                { icon: BarChart3, label: "My Stats", href: "/admin/va-stats" },
                            ]
                        },
                        {
                            title: "HELP",
                            items: [
                                { icon: BookOpen, label: "Resources", href: "/admin/resources" },
                                { icon: GraduationCap, label: "Onboarding", href: "/admin/onboarding" },
                                { icon: ClipboardCheck, label: "Training", href: "/admin/training-center" },
                            ]
                        }
                    ] : [
                        // ─── Admin Menu: full access ───
                        {
                            title: "DISPATCH CONSOLE",
                            items: [
                                { icon: Home, label: "Pipeline Home", href: "/admin/pipeline-home" },
                                { icon: PhoneCall, label: "Follow-Ups", href: "/admin/follow-ups", badge: followUpCount > 0 ? String(followUpCount) : null },
                                { icon: Inbox, label: "Inbox", href: "/admin/inbox", badge: "NEW" },
                                { icon: LayoutTemplate, label: "Dispatch Board", href: "/admin/dispatch" },
                                { icon: BarChart3, label: "Reports Dashboard", href: "/admin/dashboard" },
                                { icon: Mic, label: "Live Switchboard", href: "/admin/live-call", badge: isLive ? "LIVE" : null },
                            ]
                        },
                        {
                            title: "OPERATIONS",
                            items: [
                                { icon: Map, label: "Lead Tube Map", href: "/admin/tube-map", badge: "NEW" },
                                { icon: GitBranch, label: "Pipeline Map", href: "/admin/pipeline" },
                                { icon: Kanban, label: "Lead Kanban", href: "/admin/funnel" },
                                { icon: ClipboardCheck, label: "Segment Review", href: "/admin/leads/review", badge: reviewCount > 0 ? String(reviewCount) : null },
                                { icon: Users, label: "Contractors", href: "/admin/contractors" },
                                { icon: Wrench, label: "Handyman Map", href: "/admin/handymen" },
                                { icon: LayoutDashboard, label: "Fleet Dashboard", href: "/admin/handyman/dashboard" },
                                { icon: User, label: "Leads (Classic)", href: "/admin/leads" },
                            ]
                        },
                        {
                            title: "SALES & FINANCE",
                            items: [
                                { icon: DollarSign, label: "Quote Generator", href: "/admin/generate-quote" },
                                { icon: FileText, label: "Recent Quotes", href: "/admin/quotes" },
                                { icon: Wrench, label: "Booking Visits", href: "/admin/visits" },
                                { icon: FileText, label: "Invoices", href: "/admin/invoices" },
                                { icon: Package, label: "SKU Manager", href: "/admin/skus" },
                            ]
                        },
                        {
                            title: "PROPERTY MGMT",
                            items: [
                                { icon: AlertCircle, label: "Tenant Issues", href: "/admin/tenant-issues", badge: "NEW" },
                                { icon: Building2, label: "Properties", href: "/admin/properties" },
                            ]
                        },
                        {
                            title: "SYSTEM",
                            items: [
                                { icon: Calendar, label: "Availability", href: "/admin/availability" },
                                { icon: LayoutTemplate, label: "Marketing", href: "/admin/marketing" },
                                { icon: Settings, label: "Settings", href: "/admin/settings" },
                                { icon: GraduationCap, label: "Onboarding", href: "/admin/onboarding" },
                                { icon: BookOpen, label: "VA Resources", href: "/admin/resources" },
                            ]
                        }
                    ]).map((group, idx) => (
                        <div key={idx}>
                            {!isCollapsed && (
                                <h3 className="mb-2 px-4 text-[10px] font-black uppercase tracking-wider text-muted-foreground/50 font-mono">
                                    {group.title}
                                </h3>
                            )}
                            {isCollapsed && idx > 0 && <div className="border-t border-border/50 my-2" />}
                            <div className="space-y-1">
                                {group.items.map((item) => (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        onClick={() => setIsSidebarOpen(false)}
                                        title={isCollapsed ? item.label : undefined}
                                        className={cn(
                                            "flex items-center rounded-lg text-sm font-medium transition-all duration-200 relative",
                                            isCollapsed
                                                ? "justify-center p-2.5"
                                                : "justify-between px-4 py-2.5",
                                            location === item.href
                                                ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                                                : "text-muted-foreground hover:text-foreground hover:bg-muted",
                                            !isCollapsed && location === item.href && "translate-x-1",
                                            !isCollapsed && location !== item.href && "hover:translate-x-1"
                                        )}>
                                        <div className={cn("flex items-center", !isCollapsed && "gap-3")}>
                                            <item.icon className={cn("w-4 h-4", location === item.href && "animate-pulse")} />
                                            {!isCollapsed && item.label}
                                        </div>
                                        {!isCollapsed && item.badge && (
                                            <span className={`${isLive && item.href.includes('live') ? 'bg-red-500' : 'bg-amber-500'} text-[10px] font-black px-1.5 py-0.5 rounded text-white animate-pulse`}>
                                                {item.badge}
                                            </span>
                                        )}
                                        {isCollapsed && item.badge && (
                                            <span className={`absolute -top-1 -right-1 w-2 h-2 ${isLive && item.href.includes('live') ? 'bg-red-500' : 'bg-amber-500'} rounded-full animate-pulse`} />
                                        )}
                                    </Link>
                                ))}
                            </div>
                        </div>
                    ))}

                    {/* Access to Legacy Comms (Collapsed/Hidden or just less prominent) */}
                    {!isCollapsed && !isVA && (
                        <div className="mt-4 px-4 pt-4 border-t border-border/50">
                            <p className="text-[10px] text-muted-foreground mb-2 font-mono uppercase">LEGACY VIEWS</p>
                            <Link href="/admin/calls" className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground mb-2"><PhoneCall className="w-3 h-3" /> Call Logs</Link>
                            <Link href="/admin/whatsapp-intake" className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"><MessageSquare className="w-3 h-3" /> WhatsApp CRM</Link>
                        </div>
                    )}
                </nav>

                {/* Bottom Actions */}
                <div className={cn("mt-auto border-t border-border bg-card/50 backdrop-blur-sm", isCollapsed ? "p-2 space-y-2" : "p-4 space-y-2")}>
                    {!isVA && (
                        <button
                            className={cn(
                                "flex items-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg text-sm font-medium transition-colors",
                                isCollapsed ? "justify-center p-2.5 w-full" : "gap-3 px-4 py-3 w-full"
                            )}
                            title={isCollapsed ? "Help & Support" : undefined}
                        >
                            <HelpCircle className="w-5 h-5" />
                            {!isCollapsed && "Help & Support"}
                        </button>
                    )}
                    <div className={cn("flex items-center", isCollapsed ? "justify-center pt-2" : "pt-2 gap-3 px-4")}>
                        <div className={cn("rounded-full bg-slate-700 overflow-hidden ring-2 ring-border", isCollapsed ? "w-8 h-8" : "w-8 h-8")}>
                            <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${adminUser?.firstName || 'Felix'}`} alt="User" />
                        </div>
                        {!isCollapsed && (
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
                                <p className="text-xs text-muted-foreground truncate">{displayEmail}</p>
                            </div>
                        )}
                    </div>
                    {/* Logout button */}
                    <button
                        onClick={() => {
                            localStorage.removeItem('adminToken');
                            localStorage.removeItem('adminUser');
                            setLocation('/admin/login');
                        }}
                        className={cn(
                            "flex items-center text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg text-sm font-medium transition-colors",
                            isCollapsed ? "justify-center p-2.5 w-full" : "gap-3 px-4 py-2.5 w-full"
                        )}
                        title={isCollapsed ? "Log out" : undefined}
                    >
                        <LogOut className="w-4 h-4" />
                        {!isCollapsed && "Log out"}
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
                {/* Header */}
                <header className="h-16 bg-background/80 backdrop-blur-lg border-b border-border flex items-center justify-between px-4 lg:px-8 shadow-sm z-30 transition-colors duration-300">
                    <div className="flex items-center gap-4">
                        {!isVA && (
                            <button
                                onClick={() => setIsSidebarOpen(true)}
                                className="p-2 text-muted-foreground hover:text-foreground lg:hidden"
                            >
                                <Menu className="w-6 h-6" />
                            </button>
                        )}
                        <div className="flex items-center gap-2">
                            <img src="/logo.png" alt="Handy" className="w-8 h-8 object-contain" />
                            <div className="flex flex-col leading-tight">
                                <span className="font-bold text-sm text-secondary">Handy</span>
                                <span className="font-normal text-[10px] text-muted-foreground">Services</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 lg:gap-4">
                        {isVA ? (
                            <>
                                <Link href="/admin/resources" className={cn(
                                        "p-2 rounded-full transition-colors",
                                        location === "/admin/resources"
                                            ? "text-primary bg-primary/10"
                                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                                    )}>
                                    <HelpCircle className="w-5 h-5" />
                                </Link>
                                <button
                                    onClick={() => {
                                        localStorage.removeItem('adminToken');
                                        localStorage.removeItem('adminUser');
                                        setLocation('/admin/login');
                                    }}
                                    className="p-2 text-muted-foreground hover:text-red-400 rounded-full hover:bg-red-500/10 transition-colors"
                                    title="Log out"
                                >
                                    <LogOut className="w-5 h-5" />
                                </button>
                            </>
                        ) : (
                            <>
                                <ThemeToggle />
                                <button className="p-2 text-muted-foreground hover:text-foreground rounded-full hover:bg-muted transition-colors relative hidden sm:block">
                                    <Bell className="w-5 h-5" />
                                    <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-background"></span>
                                </button>
                                <button className="px-3 lg:px-4 py-2 bg-primary text-primary-foreground text-[10px] lg:text-sm font-bold rounded-lg hover:bg-primary/90 transition-colors shadow-sm">
                                    + New Call
                                </button>
                            </>
                        )}
                    </div>
                </header>

                {/* Content Area */}
                <div className={cn("flex-1 overflow-auto p-4 lg:p-8", isVA && "pb-20")}>
                    {/* Live Call Notification Banner */}
                    {isLive && location !== '/admin/live-call' && (
                        <Link href="/admin/live-call">
                            <div className="mb-6 bg-red-600 text-white p-3 rounded-xl flex items-center justify-between shadow-lg shadow-red-900/30 cursor-pointer animate-in slide-in-from-top duration-300">
                                <div className="flex items-center gap-3">
                                    <div className="bg-white/20 p-2 rounded-lg animate-pulse">
                                        <Mic className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <p className="font-bold text-sm">
                                            Active Voice Call in Progress
                                        </p>
                                        <p className="text-xs text-white/80">Transcription and analysis happening live...</p>
                                    </div>
                                </div>
                                <button className="bg-white text-red-600 px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-red-50 transition-colors">
                                    View Call
                                </button>
                            </div>
                        </Link>
                    )}
                    {children}
                </div>
            </main>

            {/* VA Bottom Tab Bar — always visible for VA users */}
            {isVA && (
                <>
                    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-lg border-t border-border">
                        <div className="flex items-stretch justify-around h-16">
                            {/* Tab 1: Follow-Ups */}
                            {(() => {
                                const isActive = location === "/admin/follow-ups";
                                return (
                                    <Link href="/admin/follow-ups" className={cn(
                                        "flex flex-col items-center justify-center gap-0.5 flex-1 px-2 transition-colors relative",
                                        isActive ? "text-primary" : "text-muted-foreground"
                                    )}>
                                        <div className="relative">
                                            <PhoneCall className={cn("w-5 h-5", isActive && "text-primary")} />
                                            {followUpCount > 0 && (
                                                <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold px-1">
                                                    {followUpCount}
                                                </span>
                                            )}
                                        </div>
                                        <span className={cn("text-[10px] font-semibold", isActive && "text-primary")}>Follow-Ups</span>
                                        {isActive && <div className="absolute bottom-1 w-6 h-0.5 rounded-full bg-primary" />}
                                    </Link>
                                );
                            })()}

                            {/* Tab 2: Live */}
                            {(() => {
                                const isActive = location === "/admin/live-call";
                                return (
                                    <Link href="/admin/live-call" className={cn(
                                        "flex flex-col items-center justify-center gap-0.5 flex-1 px-2 transition-colors relative",
                                        isActive ? "text-primary" : "text-muted-foreground"
                                    )}>
                                        <Mic className={cn("w-5 h-5", isActive && "text-primary")} />
                                        <span className={cn("text-[10px] font-semibold", isActive && "text-primary")}>Live</span>
                                        {isActive && <div className="absolute bottom-1 w-6 h-0.5 rounded-full bg-primary" />}
                                    </Link>
                                );
                            })()}

                            {/* Tab 2: QUOTES — Central, prominent, with popover submenu */}
                            {(() => {
                                const quotePages = ["/admin/generate-quote", "/admin/quotes"];
                                const isQuoteActive = quotePages.includes(location);
                                return (
                                    <div className="relative flex-1">
                                        <button
                                            onClick={() => setShowQuoteMenu(prev => !prev)}
                                            className="flex flex-col items-center justify-center gap-0.5 w-full h-full px-2 transition-colors relative"
                                        >
                                            <div className={cn(
                                                "flex items-center justify-center w-10 h-10 -mt-4 rounded-full shadow-lg transition-colors",
                                                isQuoteActive
                                                    ? "bg-green-500 text-white"
                                                    : "bg-green-600/80 text-white/90"
                                            )}>
                                                <DollarSign className="w-5 h-5" />
                                            </div>
                                            <span className={cn("text-[10px] font-bold -mt-0.5", isQuoteActive ? "text-green-400" : "text-muted-foreground")}>Quotes</span>
                                        </button>

                                        {/* Popover menu */}
                                        {showQuoteMenu && (
                                            <>
                                                <div className="fixed inset-0 z-40" onClick={() => setShowQuoteMenu(false)} />
                                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 bg-card border border-border rounded-xl shadow-xl overflow-hidden min-w-[160px]">
                                                    <Link
                                                        href="/admin/generate-quote"
                                                        onClick={() => setShowQuoteMenu(false)}
                                                        className={cn(
                                                            "flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors",
                                                            location === "/admin/generate-quote"
                                                                ? "text-green-400 bg-green-500/10"
                                                                : "text-foreground hover:bg-muted"
                                                        )}
                                                    >
                                                        <DollarSign className="w-4 h-4" />
                                                        New Quote
                                                    </Link>
                                                    <div className="border-t border-border" />
                                                    <Link
                                                        href="/admin/quotes"
                                                        onClick={() => setShowQuoteMenu(false)}
                                                        className={cn(
                                                            "flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors",
                                                            location === "/admin/quotes"
                                                                ? "text-green-400 bg-green-500/10"
                                                                : "text-foreground hover:bg-muted"
                                                        )}
                                                    >
                                                        <FileText className="w-4 h-4" />
                                                        All Quotes
                                                    </Link>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                );
                            })()}

                            {/* Tab 3: Calls */}
                            {(() => {
                                const isActive = location === "/admin/calls";
                                return (
                                    <Link href="/admin/calls" className={cn(
                                        "flex flex-col items-center justify-center gap-0.5 flex-1 px-2 transition-colors relative",
                                        isActive ? "text-primary" : "text-muted-foreground"
                                    )}>
                                        <PhoneCall className={cn("w-5 h-5", isActive && "text-primary")} />
                                        <span className={cn("text-[10px] font-semibold", isActive && "text-primary")}>Calls</span>
                                        {isActive && <div className="absolute bottom-1 w-6 h-0.5 rounded-full bg-primary" />}
                                    </Link>
                                );
                            })()}

                            {/* Tab 4: Stats */}
                            {(() => {
                                const isActive = location === "/admin/va-stats";
                                return (
                                    <Link href="/admin/va-stats" className={cn(
                                        "flex flex-col items-center justify-center gap-0.5 flex-1 px-2 transition-colors relative",
                                        isActive ? "text-primary" : "text-muted-foreground"
                                    )}>
                                        <BarChart3 className={cn("w-5 h-5", isActive && "text-primary")} />
                                        <span className={cn("text-[10px] font-semibold", isActive && "text-primary")}>Stats</span>
                                        {isActive && <div className="absolute bottom-1 w-6 h-0.5 rounded-full bg-primary" />}
                                    </Link>
                                );
                            })()}
                        </div>
                    </nav>
                    <InstallPrompt />
                </>
            )}
        </div>
    );
}
