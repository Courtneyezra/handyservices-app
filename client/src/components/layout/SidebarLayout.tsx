import { useState, useEffect } from "react";
import { LayoutDashboard, PhoneCall, Settings, Bell, HelpCircle, Package, MessageSquare, Wrench, Mic, DollarSign, Menu, X as CloseIcon, Megaphone, LayoutTemplate, Users, Inbox, User, FileText, Calendar, Kanban, GitBranch, Map, ChevronLeft, ChevronRight, Home, BarChart3, ClipboardCheck, Building2, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { ThemeToggle } from "@/components/ThemeToggle";
import { Link, useLocation } from "wouter";
import { useLiveCall } from "@/contexts/LiveCallContext";
import { cn } from "@/lib/utils";

interface SidebarLayoutProps {
    children: React.ReactNode;
}

export default function SidebarLayout({ children }: SidebarLayoutProps) {
    const [location] = useLocation();
    const { isLive } = useLiveCall();
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
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

    // Persist collapse state
    useEffect(() => {
        localStorage.setItem('sidebar-collapsed', String(isCollapsed));
    }, [isCollapsed]);

    return (
        <div className="flex h-screen bg-background font-sans text-foreground overflow-hidden transition-colors duration-300">
            {/* Mobile Backdrop */}
            {isSidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={cn(
                "fixed inset-y-0 left-0 bg-card text-card-foreground flex flex-col z-50 transition-all duration-300 lg:relative lg:translate-x-0 border-r border-border",
                isCollapsed ? "w-16" : "w-64",
                isSidebarOpen ? "translate-x-0" : "-translate-x-full"
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
                    {[
                        {
                            title: "DISPATCH CONSOLE",
                            items: [
                                { icon: Home, label: "Pipeline Home", href: "/admin/pipeline-home" },
                                { icon: Inbox, label: "Inbox", href: "/admin/inbox", badge: "NEW" },
                                { icon: LayoutTemplate, label: "Dispatch Board", href: "/admin/dispatch" },
                                { icon: BarChart3, label: "Reports Dashboard", href: "/admin/dashboard" },
                                {
                                    icon: Mic,
                                    label: "Live Switchboard",
                                    href: "/admin/live-call",
                                    badge: isLive ? "LIVE" : null
                                },
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
                                { icon: User, label: "Leads (Classic)", href: "/admin/leads" }, // Keeping for safety
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
                            ]
                        }
                    ].map((group, idx) => (
                        <div key={idx}>
                            {!isCollapsed && (
                                <h3 className="mb-2 px-4 text-[10px] font-black uppercase tracking-wider text-muted-foreground/50 font-mono">
                                    {group.title}
                                </h3>
                            )}
                            {isCollapsed && idx > 0 && <div className="border-t border-border/50 my-2" />}
                            <div className="space-y-1">
                                {group.items.map((item) => (
                                    <Link key={item.href} href={item.href}>
                                        <a
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
                                        </a>
                                    </Link>
                                ))}
                            </div>
                        </div>
                    ))}

                    {/* Access to Legacy Comms (Collapsed/Hidden or just less prominent) */}
                    {!isCollapsed && (
                        <div className="mt-4 px-4 pt-4 border-t border-border/50">
                            <p className="text-[10px] text-muted-foreground mb-2 font-mono uppercase">LEGACY VIEWS</p>
                            <Link href="/admin/calls"><a className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground mb-2"><PhoneCall className="w-3 h-3" /> Call Logs</a></Link>
                            <Link href="/admin/whatsapp-intake"><a className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"><MessageSquare className="w-3 h-3" /> WhatsApp CRM</a></Link>
                        </div>
                    )}
                </nav>

                {/* Bottom Actions */}
                <div className={cn("mt-auto border-t border-border bg-card/50 backdrop-blur-sm", isCollapsed ? "p-2 space-y-2" : "p-4 space-y-2")}>
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
                    <div className={cn("flex items-center", isCollapsed ? "justify-center pt-2" : "pt-2 gap-3 px-4")}>
                        <div className={cn("rounded-full bg-slate-700 overflow-hidden ring-2 ring-border", isCollapsed ? "w-8 h-8" : "w-8 h-8")}>
                            <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix" alt="User" />
                        </div>
                        {!isCollapsed && (
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">Dispatcher</p>
                                <p className="text-xs text-muted-foreground truncate">admin@nexus.com</p>
                            </div>
                        )}
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
                {/* Header */}
                <header className="h-16 bg-background/80 backdrop-blur-lg border-b border-border flex items-center justify-between px-4 lg:px-8 shadow-sm z-30 transition-colors duration-300">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => setIsSidebarOpen(true)}
                            className="p-2 text-muted-foreground hover:text-foreground lg:hidden"
                        >
                            <Menu className="w-6 h-6" />
                        </button>
                        <h2 className="text-sm lg:text-lg font-semibold text-foreground truncate max-w-[150px] lg:max-w-none">
                            {[
                                {
                                    items: [
                                        { label: "Pipeline Home", href: "/admin/pipeline-home" },
                                        { label: "Reports Dashboard", href: "/admin/dashboard" },
                                        { label: "Dispatch Board", href: "/admin/dispatch" },
                                        { label: "Live Switchboard", href: "/admin/live-call" },
                                        { label: "Lead Tube Map", href: "/admin/tube-map" },
                                        { label: "Pipeline Map", href: "/admin/pipeline" },
                                        { label: "Lead Funnel", href: "/admin/funnel" },
                                        { label: "Segment Review", href: "/admin/leads/review" },
                                        { label: "WhatsApp CRM", href: "/admin/whatsapp-intake" },
                                        { label: "Call Logs", href: "/admin/calls" },
                                        { label: "Quote Generator", href: "/admin/generate-quote" },
                                        { label: "Invoices", href: "/admin/invoices" },
                                        { label: "SKU Manager", href: "/admin/skus" },
                                        { label: "Handyman Map", href: "/admin/handymen" },
                                        { label: "Fleet Dashboard", href: "/admin/handyman/dashboard" },
                                        { label: "Marketing", href: "/admin/marketing" },
                                        { label: "Settings", href: "/admin/settings" },
                                        { label: "Tenant Issues", href: "/admin/tenant-issues" },
                                        { label: "Properties", href: "/admin/properties" },
                                    ]
                                }
                            ].flatMap(g => g.items).find(i => i.href === location)?.label || "Pipeline Home"}
                        </h2>
                    </div>
                    <div className="flex items-center gap-2 lg:gap-4">
                        <ThemeToggle />
                        <button className="p-2 text-muted-foreground hover:text-foreground rounded-full hover:bg-muted transition-colors relative hidden sm:block">
                            <Bell className="w-5 h-5" />
                            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-background"></span>
                        </button>
                        <button className="px-3 lg:px-4 py-2 bg-primary text-primary-foreground text-[10px] lg:text-sm font-bold rounded-lg hover:bg-primary/90 transition-colors shadow-sm">
                            + New Call
                        </button>
                    </div>
                </header>

                {/* Content Area */}
                <div className="flex-1 overflow-auto p-4 lg:p-8">
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
        </div>
    );
}
