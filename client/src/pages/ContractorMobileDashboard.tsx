import { useState, useEffect } from "react";
import ContractorAppShell from "@/components/layout/ContractorAppShell";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
    Plus, Search, Bell, FileText, Calendar,
    CreditCard, Settings, Archive, Sparkles,
    ArrowRight, CheckCircle2, LayoutGrid, Clock,
    Briefcase, User, Zap, ChevronRight, X
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function ContractorMobileDashboard() {
    const [, setLocation] = useLocation();

    // 1. Data Fetching (Migrated from Old Dashboard)
    const { data: profileData } = useQuery({
        queryKey: ['contractor-profile'],
        queryFn: async () => {
            const token = localStorage.getItem('contractorToken');
            const res = await fetch('/api/contractor/me', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to fetch profile');
            return res.json();
        },
    });

    const user = profileData?.user || { firstName: "Partner" };
    const profile = profileData?.profile;

    // Profile Completeness Logic
    const completeness = [
        profile?.slug ? 15 : 0,
        profile?.bio ? 15 : 0,
        profile?.heroImageUrl ? 15 : 0,
        profile?.profileImageUrl ? 15 : 0,
        (profile?.skills?.length > 0) ? 15 : 0,
        (profile?.verificationStatus === 'verified') ? 25 : 0
    ].reduce((a, b) => a + b, 0);

    // States
    const [isActionsOpen, setIsActionsOpen] = useState(false);

    // Mock Data needs to be replaced with real queries later, but for UI:
    const recentItems = [
        { type: "Quote", id: "#1023", client: "Sarah J.", status: "Sent", date: "2h ago", color: "bg-blue-100 text-blue-700" },
        { type: "Job", id: "#892", client: "Mike T.", status: "Scheduled", date: "Tomorrow", color: "bg-emerald-100 text-emerald-700" },
        { type: "Invoice", id: "#INV-22", client: "Apex Inc", status: "Paid", date: "Yesterday", color: "bg-purple-100 text-purple-700" },
    ];

    return (
        <ContractorAppShell>

            {/* 1. Top Navigation */}
            <div className="bg-white px-5 py-4 sticky top-0 z-20 flex items-center justify-between shadow-sm border-b border-gray-100">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#6C6CFF] to-[#A3A3FF] flex items-center justify-center text-white font-bold text-sm shadow-md shadow-blue-500/20">
                        {user.firstName[0]}
                    </div>
                    <div className="flex flex-col">
                        <h1 className="font-bold text-lg leading-none">Hi, {user.firstName}</h1>
                        <span className="text-xs text-slate-400 font-medium">{profile?.slug ? `@${profile.slug}` : 'Setup your handle'}</span>
                    </div>
                </div>
                <div className="flex items-center gap-4 text-gray-500">
                    <Search className="w-5 h-5" />
                    <div className="relative">
                        <Bell className="w-5 h-5" />
                        <div className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></div>
                    </div>
                </div>
            </div>

            <div className="p-5 space-y-6">

                {/* 2. Quick Actions Pill Grid */}
                <div>
                    <h2 className="text-xs font-bold text-gray-400 mb-3 px-1 uppercase tracking-wider">Quick Actions</h2>
                    <div className="grid grid-cols-4 gap-3">
                        <button onClick={() => setIsActionsOpen(true)} className="flex flex-col items-center gap-2 group">
                            <div className="w-14 h-14 rounded-2xl bg-[#6C6CFF] text-white flex items-center justify-center shadow-lg shadow-blue-500/30 group-active:scale-95 transition-transform">
                                <Plus size={26} />
                            </div>
                            <span className="text-[10px] font-bold text-gray-600">Create</span>
                        </button>

                        <Link href="/contractor/dashboard/quotes/new">
                            <button className="flex flex-col items-center gap-2 group w-full">
                                <div className="w-14 h-14 rounded-2xl bg-white border border-gray-100 text-slate-600 flex items-center justify-center shadow-sm group-active:scale-95 transition-transform">
                                    <FileText size={22} className="text-[#6C6CFF]" />
                                </div>
                                <span className="text-[10px] font-bold text-gray-600">Quote</span>
                            </button>
                        </Link>

                        <Link href="/contractor/calendar">
                            <button className="flex flex-col items-center gap-2 group w-full">
                                <div className="w-14 h-14 rounded-2xl bg-white border border-gray-100 text-slate-600 flex items-center justify-center shadow-sm group-active:scale-95 transition-transform">
                                    <Calendar size={22} className="text-emerald-500" />
                                </div>
                                <span className="text-[10px] font-bold text-gray-600">Calendar</span>
                            </button>
                        </Link>

                        <Link href="/contractor/financials">
                            <button className="flex flex-col items-center gap-2 group w-full">
                                <div className="w-14 h-14 rounded-2xl bg-white border border-gray-100 text-slate-600 flex items-center justify-center shadow-sm group-active:scale-95 transition-transform">
                                    <CreditCard size={22} className="text-purple-500" />
                                </div>
                                <span className="text-[10px] font-bold text-gray-600">Invoice</span>
                            </button>
                        </Link>
                    </div>
                </div>

                {/* 3. MAGIC QUOTE HERO (Re-skinned for Monday.com Style) */}
                <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#2B2D42] to-[#1E1F24] text-white shadow-xl group">
                    {/* Abstract Shapes */}
                    <div className="absolute top-0 right-0 w-40 h-40 bg-[#6C6CFF]/20 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>

                    <div className="relative p-6">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#6C6CFF]/20 border border-[#6C6CFF]/30 backdrop-blur-sm mb-4">
                            <Sparkles className="w-3 h-3 text-[#A3A3FF]" />
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[#A3A3FF]">AI Powered</span>
                        </div>

                        <h2 className="text-2xl font-bold leading-tight mb-2">Magic Quote</h2>
                        <p className="text-slate-400 text-sm mb-6 leading-relaxed max-w-[80%]">
                            Turn a quick voice note into a professional "Good, Better, Best" quote in seconds.
                        </p>

                        <Link href="/contractor/dashboard/quotes/new?mode=magic">
                            <button className="w-full py-3.5 bg-gradient-to-r from-[#6C6CFF] to-[#5858E0] hover:from-[#5858E0] hover:to-[#4040CC] text-white font-bold rounded-xl shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2 active:scale-[0.98] transition-all">
                                <Zap size={18} className="fill-white" />
                                Generate Quote
                            </button>
                        </Link>
                    </div>
                </div>

                {/* 4. PARTNER OPT-IN (The "Lead Gen" Add-on) */}
                {profile?.verificationStatus !== 'verified' && (
                    <div className="rounded-3xl p-6 bg-gradient-to-br from-[#FF9F1C] to-[#FF5400] text-white shadow-xl shadow-orange-500/20 relative overflow-hidden">
                        <div className="relative z-10 space-y-4">
                            <div className="flex items-center justify-between">
                                <span className="inline-flex items-center gap-2 px-3 py-1 bg-white/20 rounded-full text-xs font-bold backdrop-blur-sm">
                                    <LayoutGrid size={12} /> Partner Network
                                </span>
                                <span className="text-xs font-bold bg-white/20 px-2 py-1 rounded-md">{completeness}% Ready</span>
                            </div>

                            <div>
                                <h3 className="text-xl font-bold leading-tight mb-1">Get more jobs sent to you.</h3>
                                <p className="text-white/80 text-sm font-medium">Join the Handy Network to receive pre-verified leads.</p>
                            </div>

                            <button
                                onClick={() => setLocation("/contractor/partner-onboarding")}
                                className="w-full py-3 bg-white text-orange-600 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-orange-50 transition-colors shadow-lg"
                            >
                                Complete Profile <ArrowRight size={16} />
                            </button>
                        </div>
                    </div>
                )}

                {/* 5. Recent Activity List */}
                <div>
                    <div className="flex items-center justify-between mb-3 px-1">
                        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Recent Activity</h2>
                        <Link href="/contractor/items" className="text-xs text-[#6C6CFF] font-bold">See All</Link>
                    </div>

                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-50">
                        {recentItems.map((item, idx) => (
                            <div key={idx} className="p-4 flex items-center gap-4 hover:bg-gray-50 transition-colors">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold ${item.color.replace('text', 'bg').replace('100', '500').replace('700', 'white')}`}>
                                    {item.type[0]}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h4 className="font-bold text-sm text-slate-700 truncate">{item.client}</h4>
                                    <p className="text-xs text-gray-400 flex items-center gap-1 font-medium">
                                        {item.type} {item.id} • <Clock size={10} /> {item.date}
                                    </p>
                                </div>
                                <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${item.color}`}>
                                    {item.status}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

            </div>



            {/* 7. QUICK ACTION OVERLAY (The "Magic" Menu) */}
            <AnimatePresence>
                {isActionsOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsActionsOpen(false)}
                            className="fixed inset-0 bg-slate-900/60 z-50 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ y: "100%" }}
                            animate={{ y: 0 }}
                            exit={{ y: "100%" }}
                            transition={{ type: "spring", damping: 25, stiffness: 300 }}
                            className="fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl z-50 p-6 pb-10"
                        >
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-xl font-bold text-slate-800">Create New</h3>
                                <button onClick={() => setIsActionsOpen(false)} className="p-2 bg-slate-100 rounded-full text-slate-500">
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="grid gap-4">
                                <Link href="/contractor/dashboard/quotes/new?mode=magic">
                                    <button className="w-full p-4 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white flex items-center gap-4 shadow-lg shadow-indigo-500/20">
                                        <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                                            <Sparkles className="w-6 h-6 text-white" />
                                        </div>
                                        <div className="text-left">
                                            <div className="font-bold text-lg">Magic Quote</div>
                                            <div className="text-indigo-100 text-sm">Create from voice or text</div>
                                        </div>
                                        <ChevronRight className="ml-auto w-6 h-6 text-white/50" />
                                    </button>
                                </Link>

                                <div className="grid grid-cols-2 gap-4">
                                    <Link href="/contractor/dashboard/quotes/new?mode=simple">
                                        <button className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex flex-col items-center gap-3 hover:bg-slate-100 transition-colors">
                                            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                                                <FileText size={20} />
                                            </div>
                                            <span className="font-bold text-slate-700">Manual Quote</span>
                                        </button>
                                    </Link>
                                    <Link href="/contractor/create-invoice">
                                        <button className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex flex-col items-center gap-3 hover:bg-slate-100 transition-colors">
                                            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                                                <CreditCard size={20} />
                                            </div>
                                            <span className="font-bold text-slate-700">New Invoice</span>
                                        </button>
                                    </Link>
                                    <Link href="/contractor/new-client">
                                        <button className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex flex-col items-center gap-3 hover:bg-slate-100 transition-colors">
                                            <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center text-orange-600">
                                                <User size={20} />
                                            </div>
                                            <span className="font-bold text-slate-700">Add Client</span>
                                        </button>
                                    </Link>
                                    <Link href="/contractor/schedule-visit">
                                        <button className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex flex-col items-center gap-3 hover:bg-slate-100 transition-colors">
                                            <div className="w-10 h-10 rounded-full bg-pink-100 flex items-center justify-center text-pink-600">
                                                <Calendar size={20} />
                                            </div>
                                            <span className="font-bold text-slate-700">Book Visit</span>
                                        </button>
                                    </Link>
                                </div>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </ContractorAppShell>
    );
}
