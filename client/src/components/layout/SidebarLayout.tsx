import { useState } from "react";
import { LayoutDashboard, PhoneCall, Settings, Bell, HelpCircle, Package, MessageSquare, Wrench, Mic, DollarSign, Menu, X as CloseIcon } from "lucide-react";
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

    const navItems = [
        { icon: LayoutDashboard, label: "Dashboard", href: "/admin" },
        {
            icon: Mic,
            label: "Live Switchboard",
            href: "/admin/live-call",
            badge: isLive ? "LIVE" : null
        },
        { icon: MessageSquare, label: "WhatsApp CRM", href: "/admin/whatsapp-intake" },
        { icon: Wrench, label: "Handyman Map", href: "/admin/handymen" },
        { icon: Package, label: "SKU Manager", href: "/admin/skus" },
        { icon: DollarSign, label: "Quote Generator", href: "/admin/generate-quote" },
        { icon: PhoneCall, label: "Call Logs", href: "/admin/calls" },
        { icon: Settings, label: "Settings", href: "/admin/settings" },
    ];

    return (
        <div className="flex h-screen bg-gray-950 font-sans text-white overflow-hidden">
            {/* Mobile Backdrop */}
            {isSidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={cn(
                "fixed inset-y-0 left-0 w-64 bg-[#0f172a] text-white flex flex-col z-50 transition-transform duration-300 lg:relative lg:translate-x-0",
                isSidebarOpen ? "translate-x-0" : "-translate-x-full"
            )}>
                {/* Logo Area */}
                <div className="p-6 flex items-center gap-3">
                    <img
                        src="/logo.png"
                        alt="Handy"
                        className="w-10 h-10 object-contain"
                    />
                    <div className="flex flex-col leading-tight">
                        <span className="font-bold text-lg text-white">Handy</span>
                        <span className="font-normal text-sm text-slate-300">Services</span>
                    </div>
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-4 py-4 space-y-1">
                    {navItems.map((item) => {
                        const isActive = location === item.href;
                        return (
                            <Link key={item.href} href={item.href}>
                                <a
                                    onClick={() => setIsSidebarOpen(false)}
                                    className={`flex items-center justify-between px-4 py-3 rounded-lg text-sm font-medium transition-colors ${isActive
                                        ? "bg-handy-gold text-gray-900 shadow-md shadow-yellow-900/20"
                                        : "text-slate-400 hover:text-white hover:bg-white/5"
                                        }`}>
                                    <div className="flex items-center gap-3">
                                        <item.icon className="w-5 h-5" />
                                        {item.label}
                                    </div>
                                    {item.badge && (
                                        <span className="bg-red-500 text-[10px] font-black px-1.5 py-0.5 rounded text-white animate-pulse">
                                            {item.badge}
                                        </span>
                                    )}
                                </a>
                            </Link>
                        );
                    })}
                </nav>

                {/* Bottom Actions */}
                <div className="p-4 mt-auto border-t border-white/10 space-y-2">
                    <button className="flex items-center gap-3 px-4 py-3 w-full text-slate-400 hover:text-white hover:bg-white/5 rounded-lg text-sm font-medium transition-colors">
                        <HelpCircle className="w-5 h-5" />
                        Help & Support
                    </button>
                    <div className="pt-4 flex items-center gap-3 px-4">
                        <div className="w-8 h-8 rounded-full bg-slate-700 overflow-hidden">
                            <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix" alt="User" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">Dispatcher</p>
                            <p className="text-xs text-slate-500 truncate">admin@nexus.com</p>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
                {/* Header */}
                <header className="h-16 bg-gray-900/80 backdrop-blur-lg border-b border-gray-700/50 flex items-center justify-between px-4 lg:px-8 shadow-lg z-30">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => setIsSidebarOpen(true)}
                            className="p-2 text-slate-400 hover:text-white lg:hidden"
                        >
                            <Menu className="w-6 h-6" />
                        </button>
                        <h2 className="text-sm lg:text-lg font-semibold text-white truncate max-w-[150px] lg:max-w-none">
                            {navItems.find(i => i.href === location)?.label || "Dashboard"}
                        </h2>
                    </div>
                    <div className="flex items-center gap-2 lg:gap-4">
                        <button className="p-2 text-gray-400 hover:text-white rounded-full hover:bg-white/10 transition-colors relative hidden sm:block">
                            <Bell className="w-5 h-5" />
                            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-gray-900"></span>
                        </button>
                        <button className="px-3 lg:px-4 py-2 bg-handy-gold text-gray-900 text-[10px] lg:text-sm font-bold rounded-lg hover:bg-handy-gold-hover transition-colors shadow-lg shadow-yellow-900/20">
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
                                        <p className="font-bold text-sm">Active Voice Call in Progress</p>
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
