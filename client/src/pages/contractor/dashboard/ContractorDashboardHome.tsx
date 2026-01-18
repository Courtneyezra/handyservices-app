import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { AvailabilityHarvester } from "@/components/dashboard/AvailabilityHarvester";
import { ConfettiTools } from "@/components/dashboard/ConfettiTools";
import { QuoteTemplatesSlider } from "@/components/dashboard/QuoteTemplatesSlider";
import { Link, useLocation } from "wouter";
import {
    Calendar, Clock, DollarSign, ArrowRight, CheckCircle2, Sparkles,
    Plus, Home, User, Settings, Zap, ChevronRight, BarChart3, FileText, Briefcase, AlertCircle
} from "lucide-react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { useState, useEffect } from "react";
import { format } from "date-fns";

import { SmartSetupModal } from '@/components/dashboard/SmartSetupModal';

export default function ContractorDashboardHome() {
    const [location, setLocation] = useLocation();
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [showConfetti, setShowConfetti] = useState(false);

    // Nudge State
    const [showNudge, setShowNudge] = useState(false);
    const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);

    // Fetch profile for slug and name
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

    const firstName = profileData?.user?.firstName || 'Contractor';
    const profile = profileData?.profile;
    const slug = profile?.slug;

    // Check completeness
    const completeness = [
        profile?.slug ? 15 : 0,
        profile?.bio ? 15 : 0,
        profile?.heroImageUrl ? 15 : 0,
        profile?.profileImageUrl ? 15 : 0,
        (profile?.skills?.length > 0) ? 15 : 0,
        (profile?.verificationStatus === 'verified') ? 25 : 0
    ].reduce((a, b) => a + b, 0);

    const missingItems = [];
    if (!profile?.slug) missingItems.push('Choose your public handle');
    if (!profile?.heroImageUrl) missingItems.push('Add a cover photo');
    if (!profile?.bio) missingItems.push('Write a short bio');
    if (profile?.verificationStatus !== 'verified') missingItems.push('Complete verification to get your badge');

    // Trigger Nudge on Load if incomplete and not dismissed recently
    useEffect(() => {
        if (profileData && !profile?.publicProfileEnabled) {
            const hasSeenNudge = sessionStorage.getItem('hasSeenProfileNudge');
            if (!hasSeenNudge) {
                setShowNudge(true);
                sessionStorage.setItem('hasSeenProfileNudge', 'true');
            }
        }
    }, [profileData, profile]);

    // Check for welcome param
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('welcome') === 'true') {
            setShowConfetti(true);
            // Clean URL without reload
            window.history.replaceState({}, '', '/contractor/dashboard');
        }
    }, []);

    return (
        <div className="min-h-screen bg-slate-950 pb-24 text-slate-100 font-sans selection:bg-amber-500/30">
            {showConfetti && <ConfettiTools />}

            <SmartSetupModal
                isOpen={showNudge}
                onClose={() => setShowNudge(false)}
                profileStrength={completeness}
                missingItems={missingItems}
            />



            {/* Mobile Header */}
            <div className="lg:hidden sticky top-0 z-30 bg-slate-950/80 backdrop-blur-md border-b border-slate-800 px-4 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-amber-400 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-900/20">
                        <span className="font-bold text-white text-lg">{firstName.charAt(0)}</span>
                    </div>
                    <div>
                        <h1 className="font-bold text-base leading-tight">Hello, {firstName}</h1>
                        <p className="text-xs text-slate-400">Business Dashboard</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Popover>
                        <PopoverTrigger asChild>
                            <button className="p-2 rounded-full bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition-colors">
                                <Settings className="w-5 h-5" />
                            </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56 bg-slate-900 border-slate-800 p-2 mr-4">
                            <div className="flex flex-col space-y-1">
                                <Link href="/contractor/profile">
                                    <button className="flex items-center gap-3 w-full px-3 py-2.5 text-sm md:text-base text-slate-300 hover:bg-slate-800 hover:text-white rounded-lg transition-colors text-left">
                                        <User className="w-4 h-4" />
                                        <span>Profile</span>
                                    </button>
                                </Link>
                                <Link href="/contractor/dashboard/settings">
                                    <button className="flex items-center gap-3 w-full px-3 py-2.5 text-sm md:text-base text-slate-300 hover:bg-slate-800 hover:text-white rounded-lg transition-colors text-left">
                                        <Settings className="w-4 h-4" />
                                        <span>Settings</span>
                                    </button>
                                </Link>
                            </div>
                        </PopoverContent>
                    </Popover>
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-4 lg:px-0 py-6 space-y-8">

                {/* Desktop Welcome (Hidden on Mobile) */}
                <div className="hidden lg:block">
                    <h1 className="text-3xl font-bold text-white">Dashboard</h1>
                    <p className="text-slate-400 mt-1">Manage your business, quotes, and availability.</p>
                </div>

                {/* HERO: Smart Quote Generator (The Hook) */}
                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-900 via-slate-900 to-slate-900 border border-indigo-500/30 shadow-2xl shadow-indigo-900/20 group">
                    <div className="absolute top-0 right-0 p-32 bg-indigo-500/10 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>

                    <div className="relative p-6 sm:p-8">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                            <div className="space-y-4 max-w-lg">
                                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 backdrop-blur-sm">
                                    <Sparkles className="w-3.5 h-3.5 text-indigo-300" />
                                    <span className="text-xs font-semibold text-indigo-200 tracking-wide uppercase">New AI Feature</span>
                                </div>

                                <h2 className="text-2xl sm:text-3xl font-bold text-white leading-tight">
                                    Create a <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-200 to-amber-500">Magic Quote</span> in seconds.
                                </h2>
                                <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
                                    Stop writing quotes at night. Our AI builds "Good, Better, Best" options instantly—helping you win 3x more jobs.
                                </p>
                            </div>

                            <Link href="/contractor/dashboard/quotes/new">
                                <button className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white font-bold rounded-xl shadow-lg shadow-amber-900/40 transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-3 group-hover:shadow-amber-500/25">
                                    <Zap className="w-5 h-5 fill-current" />
                                    <span>Build Quote Now</span>
                                    <ChevronRight className="w-4 h-4 opacity-70" />
                                </button>
                            </Link>
                        </div>
                    </div>
                </div>

                {/* Quick Templates Slider */}
                <QuoteTemplatesSlider />

                {/* "TROJAN HORSE": Availability Widget (The Harvest) */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 space-y-6">

                        {/* THE HARVESTER WIDGET */}
                        <div className="relative group rounded-2xl">
                            {/* Animated Aura - Outer Glow */}
                            <div className="absolute -inset-1 bg-gradient-to-r from-amber-500 via-emerald-500 to-amber-500 rounded-2xl blur-lg opacity-40 group-hover:opacity-70 transition duration-1000 group-hover:duration-200 animate-gradient-x"></div>

                            {/* Neon Tint Edge - Inner Border */}
                            <div className="absolute -inset-[1px] bg-gradient-to-r from-amber-400 via-emerald-400 to-amber-400 rounded-2xl opacity-50 group-hover:opacity-100 transition duration-500"></div>

                            {/* Content Widget */}
                            <div className="relative bg-slate-950/90 border border-slate-800 rounded-2xl overflow-hidden backdrop-blur-sm h-full shadow-2xl">
                                <AvailabilityHarvester />
                            </div>
                        </div>

                        {/* Recent Activity / Stats Grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 backdrop-blur-sm">
                                <div className="flex items-start justify-between mb-4">
                                    <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400">
                                        <Clock className="w-5 h-5" />
                                    </div>
                                    <span className="text-xs font-bold bg-slate-800 text-slate-400 px-2 py-1 rounded">Month</span>
                                </div>
                                <p className="text-3xl font-bold text-white mb-1">0</p>
                                <p className="text-sm text-slate-400">Active Jobs</p>
                            </div>

                            <Link href="/contractor/financials">
                                <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 backdrop-blur-sm cursor-pointer hover:bg-slate-800/50 transition-colors group">
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 group-hover:bg-emerald-500/20 transition-colors">
                                            <BarChart3 className="w-5 h-5" />
                                        </div>
                                        <div className="flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                                            <ArrowRight className="w-3 h-3 text-slate-500 group-hover:text-emerald-400" />
                                        </div>
                                    </div>
                                    <p className="text-3xl font-bold text-white mb-1">£0</p>
                                    <p className="text-sm text-slate-400">Revenue</p>
                                </div>
                            </Link>

                            <Link href="/contractor/financials">
                                <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 backdrop-blur-sm cursor-pointer hover:bg-slate-800/50 transition-colors group">
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="w-10 h-10 rounded-lg bg-rose-500/10 flex items-center justify-center text-rose-400 group-hover:bg-rose-500/20 transition-colors">
                                            <DollarSign className="w-5 h-5" />
                                        </div>
                                        <div className="flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                                            <ArrowRight className="w-3 h-3 text-slate-500 group-hover:text-rose-400" />
                                        </div>
                                    </div>
                                    <p className="text-3xl font-bold text-white mb-1">£0</p>
                                    <p className="text-sm text-slate-400">Expenses</p>
                                </div>
                            </Link>
                        </div>
                    </div>

                    {/* Right Column: "Get More Jobs" / Profile Status */}
                    <div className="space-y-6">
                        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 h-full relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 blur-3xl rounded-full pointer-events-none"></div>
                            <h3 className="text-lg font-bold text-white mb-2">Profile Status</h3>

                            {profile?.verificationStatus === 'verified' ? (
                                <div className="flex items-center gap-2 text-sky-400 mb-6 bg-sky-500/10 px-3 py-2 rounded-lg border border-sky-500/20 w-fit">
                                    <Sparkles className="w-4 h-4 fill-sky-400/20" />
                                    <span className="text-sm font-bold uppercase tracking-wide">Handy Verified</span>
                                </div>
                            ) : (
                                <div className="space-y-3 mb-6">
                                    <div className="flex items-center gap-2 text-amber-400 bg-amber-500/10 px-3 py-2 rounded-lg border border-amber-500/20 w-fit">
                                        <AlertCircle className="w-4 h-4" />
                                        <span className="text-sm font-semibold capitalize">{profile?.verificationStatus === 'pending' ? 'Verification Pending' : 'Unverified'}</span>
                                    </div>

                                    {/* Insurance Grace Period Alert */}
                                    {!profile?.publicLiabilityInsuranceUrl && profile?.createdAt && (() => {
                                        const daysSinceSignup = Math.floor((new Date().getTime() - new Date(profile.createdAt).getTime()) / (1000 * 60 * 60 * 24));
                                        const gracePeriod = 7;
                                        const daysLeft = gracePeriod - daysSinceSignup;

                                        if (daysLeft > 0) {
                                            return (
                                                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-200">
                                                    <span className="font-bold block mb-1">⚠️ Insurance Needed</span>
                                                    You have <span className="text-white font-bold">{daysLeft} days</span> left in your grace period to upload Public Liability Insurance.
                                                </div>
                                            );
                                        } else {
                                            return (
                                                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-200">
                                                    <span className="font-bold block mb-1">⛔ Insurance Overdue</span>
                                                    Your grace period has ended. Please upload your Public Liability Insurance immediately to continue accepting jobs.
                                                </div>
                                            );
                                        }
                                    })()}
                                </div>
                            )}

                            <div className="space-y-4">
                                <div>
                                    <div className="flex justify-between text-sm mb-2">
                                        <span className="text-slate-400">Profile Strength</span>
                                        <span className="text-amber-400 font-bold">85%</span>
                                    </div>
                                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                                        <div className="h-full w-[85%] bg-gradient-to-r from-amber-600 to-amber-400 rounded-full"></div>
                                    </div>
                                </div>

                                <div className="pt-4 border-t border-slate-800 space-y-3">
                                    {slug ? (
                                        <div className="grid grid-cols-2 gap-3">
                                            <a href={`/handy/${slug}`} target="_blank" rel="noopener noreferrer">
                                                <button className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2">
                                                    View Profile
                                                    <ArrowRight className="w-4 h-4" />
                                                </button>
                                            </a>
                                            <Link href="/contractor/dashboard/settings?tab=profile">
                                                <button className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2">
                                                    <User className="w-4 h-4" />
                                                    Edit
                                                </button>
                                            </Link>
                                        </div>
                                    ) : (
                                        <Link href="/contractor/dashboard/settings?tab=profile">
                                            <button className="w-full py-3 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/50 text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2">
                                                <User className="w-4 h-4" />
                                                Setup Public Profile
                                            </button>
                                        </Link>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* STICKY MOBILE BOTTOM MENU (The App Feel) */}
            <div className="fixed bottom-0 left-0 right-0 z-50 bg-slate-950/90 backdrop-blur-lg border-t border-slate-800 lg:hidden pb-safe">
                <div className="grid grid-cols-5 h-16 items-center px-2">
                    <Link href="/contractor/dashboard">
                        <a className={`flex flex-col items-center justify-center gap-1 h-full w-full text-amber-500`}>
                            <Home className="w-5 h-5" />
                            <span className="text-[10px] font-medium">Home</span>
                        </a>
                    </Link>
                    <Link href="/contractor/calendar">
                        <a className="flex flex-col items-center justify-center gap-1 h-full w-full text-slate-500 hover:text-slate-300">
                            <Calendar className="w-5 h-5" />
                            <span className="text-[10px] font-medium">Schedule</span>
                        </a>
                    </Link>

                    {/* CENTER FAB - CREATE QUOTE */}
                    <div className="relative -top-5 flex flex-col justify-end items-center w-full">
                        <AnimatePresence>
                            {isPlusMenuOpen && (
                                <motion.div
                                    initial={{ opacity: 0, y: 20, scale: 0.8 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 20, scale: 0.8 }}
                                    className="absolute bottom-20 mb-2 flex flex-col items-center gap-3 z-50 min-w-[max-content]"
                                >
                                    {/* Magic Quote */}
                                    <Link href="/contractor/dashboard/quotes/new?mode=hhh">
                                        <button className="flex items-center gap-3 bg-slate-900 border border-amber-500/30 text-white px-5 py-3 rounded-full shadow-xl shadow-black/50 whitespace-nowrap backdrop-blur-md hover:bg-slate-800 transition-colors w-48">
                                            <Sparkles className="w-4 h-4 text-amber-500" />
                                            <span className="font-bold text-sm">Magic Quote</span>
                                        </button>
                                    </Link>

                                    {/* Manual Quote */}
                                    <Link href="/contractor/dashboard/quotes/new?mode=simple">
                                        <button className="flex items-center gap-3 bg-slate-900 border border-slate-700 text-slate-300 px-5 py-3 rounded-full shadow-xl shadow-black/50 whitespace-nowrap backdrop-blur-md hover:bg-slate-800 hover:text-white transition-colors w-48">
                                            <FileText className="w-4 h-4" />
                                            <span className="font-bold text-sm">Create Quote</span>
                                        </button>
                                    </Link>

                                    {/* Pick & Mix Quote */}
                                    <Link href="/contractor/dashboard/quotes/new?mode=pick_and_mix">
                                        <button className="flex items-center gap-3 bg-slate-900 border border-slate-700 text-slate-300 px-5 py-3 rounded-full shadow-xl shadow-black/50 whitespace-nowrap backdrop-blur-md hover:bg-slate-800 hover:text-white transition-colors w-48">
                                            <Sparkles className="w-4 h-4 text-emerald-400" />
                                            <span className="font-bold text-sm">Pick & Mix Quote</span>
                                        </button>
                                    </Link>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <button
                            onClick={() => setIsPlusMenuOpen(!isPlusMenuOpen)}
                            className={`w-14 h-14 rounded-full shadow-xl shadow-amber-500/30 flex items-center justify-center text-white transform active:scale-95 transition-all border-4 border-slate-950 z-40 ${isPlusMenuOpen ? 'bg-slate-800 rotate-45' : 'bg-gradient-to-tr from-amber-500 to-orange-600'}`}
                        >
                            <Plus className={`w-7 h-7 transition-transform duration-200 ${isPlusMenuOpen ? 'text-slate-400' : 'text-white'}`} />
                        </button>
                    </div>

                    <Link href="/contractor/dashboard/quotes">
                        <a className="flex flex-col items-center justify-center gap-1 h-full w-full text-slate-500 hover:text-slate-300">
                            <FileText className="w-5 h-5" />
                            <span className="text-[10px] font-medium">Quotes</span>
                        </a>
                    </Link>
                    <Link href="/contractor/dashboard/jobs">
                        <a className="flex flex-col items-center justify-center gap-1 h-full w-full text-slate-500 hover:text-slate-300">
                            <Briefcase className="w-5 h-5" />
                            <span className="text-[10px] font-medium">Jobs</span>
                        </a>
                    </Link>
                </div>
            </div>
        </div>
    );
}
