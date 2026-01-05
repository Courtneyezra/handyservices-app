import { useState } from "react";
import { LayoutDashboard, Calendar, Clock, FileText, User, Menu, LogOut, Plus } from "lucide-react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";

interface ContractorDashboardLayoutProps {
    children: React.ReactNode;
}

export default function ContractorDashboardLayout({ children }: ContractorDashboardLayoutProps) {
    const [location] = useLocation();
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    // Logout Mutation
    const logoutMutation = useMutation({
        mutationFn: async () => {
            // Basic logout call
            await fetch('/api/contractor/logout', { method: 'POST' });
            window.location.href = '/contractor/login';
        }
    });

    const navItems = [
        { icon: LayoutDashboard, label: "Overview", href: "/contractor/dashboard" },
        { icon: Calendar, label: "Bookings", href: "/contractor/dashboard/bookings" },
        { icon: Clock, label: "Availability", href: "/contractor/dashboard/availability" },
        { icon: FileText, label: "My Quotes", href: "/contractor/dashboard/quotes" },
        { icon: User, label: "Profile", href: "/contractor/profile" },
    ];

    return (
        <div className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden">
            {/* Mobile Backdrop */}
            {isSidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={cn(
                "fixed inset-y-0 left-0 w-64 bg-slate-900 text-white flex flex-col z-50 transition-transform duration-300 lg:relative lg:translate-x-0 shadow-xl",
                isSidebarOpen ? "translate-x-0" : "-translate-x-full"
            )}>
                {/* Logo Area */}
                <div className="p-6 flex items-center gap-3 border-b border-slate-800">
                    <div className="w-10 h-10 bg-amber-500 rounded-lg flex items-center justify-center font-bold text-slate-900 text-xl">
                        H
                    </div>
                    <div className="flex flex-col leading-tight">
                        <span className="font-bold text-lg text-white">Contractor</span>
                        <span className="font-normal text-sm text-slate-400">Hub</span>
                    </div>
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-4 py-6 space-y-1">
                    {navItems.map((item) => {
                        const isActive = location === item.href;
                        return (
                            <Link key={item.href} href={item.href}>
                                <a
                                    onClick={() => setIsSidebarOpen(false)}
                                    className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${isActive
                                        ? "bg-amber-500 text-slate-900 shadow-lg shadow-amber-900/20"
                                        : "text-slate-400 hover:text-white hover:bg-slate-800"
                                        }`}>
                                    <item.icon className="w-5 h-5" />
                                    {item.label}
                                </a>
                            </Link>
                        );
                    })}
                </nav>

                {/* Bottom Actions */}
                <div className="p-4 mt-auto border-t border-slate-800">
                    <button
                        onClick={() => logoutMutation.mutate()}
                        className="flex items-center gap-3 px-4 py-3 w-full text-slate-400 hover:text-red-400 hover:bg-red-950/30 rounded-lg text-sm font-medium transition-colors"
                    >
                        <LogOut className="w-5 h-5" />
                        Sign Out
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
                {/* Header */}
                <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:px-8 shadow-sm z-30">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => setIsSidebarOpen(true)}
                            className="p-2 text-slate-500 hover:text-slate-800 lg:hidden"
                        >
                            <Menu className="w-6 h-6" />
                        </button>
                        <h2 className="text-lg font-bold text-slate-800 truncate">
                            {navItems.find(i => i.href === location)?.label || "Dashboard"}
                        </h2>
                    </div>

                    <div className="flex items-center gap-4">
                        <Link href="/contractor/dashboard/quotes/new">
                            <button className="hidden sm:flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-bold rounded-lg hover:bg-slate-800 transition-colors shadow-md">
                                <Plus className="w-4 h-4" />
                                Create Quote
                            </button>
                        </Link>
                    </div>
                </header>

                {/* Content Scroll Area */}
                <div className="flex-1 overflow-auto p-4 lg:p-8 bg-slate-50">
                    {children}
                </div>
            </main>
        </div>
    );
}
