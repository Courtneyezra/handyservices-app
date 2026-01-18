import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { ArrowLeft, Plus, Search, Filter, Loader2, FileText, CheckCircle2, Clock, Eye, AlertCircle, Calendar } from "lucide-react";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import ContractorAppShell from "@/components/layout/ContractorAppShell";

interface Quote {
    id: string;
    shortSlug: string;
    customerName: string;
    jobDescription: string;
    quoteMode: 'hhh' | 'simple' | 'pick_and_mix';
    basePricePence: number | null;
    baseJobPricePence: number | null;
    essentialPrice: number | null;
    viewedAt: string | null;
    bookedAt: string | null;
    expiresAt: string | null;
    createdAt: string;
    status: string | null;
}

type Tab = 'active' | 'booked';

export default function QuotesListPage() {
    const [, setLocation] = useLocation();
    const [activeTab, setActiveTab] = useState<Tab>('active');
    const [searchQuery, setSearchQuery] = useState('');

    const { data: quotes, isLoading } = useQuery<Quote[]>({
        queryKey: ['contractor-quotes'],
        queryFn: async () => {
            const token = localStorage.getItem('contractorToken');
            const res = await fetch('/api/contractor/quotes', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to fetch quotes');
            return res.json();
        },
    });

    const filteredQuotes = quotes?.filter(quote => {
        // 1. Filter by Tab Logic
        const isBooked = !!quote.bookedAt;

        if (activeTab === 'active') {
            // Active = Not Booked (includes Viewed, Sent, Expired - though maybe hide expired? User asked for clean UI. Let's keep Expired in Active for now but maybe at bottom or strictly separate. Plan said Active vs Booked specifically.)
            // Let's hide Expired from Active to keep it super clean? user didn't explicitly ask to hide expired, but "Active" implies valid.
            // Actually, let's keep it simple: Active = !Booked.
            if (isBooked) return false;
        } else {
            // Booked = Booked
            if (!isBooked) return false;
        }

        // 2. Search Filter
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            return (
                quote.customerName?.toLowerCase().includes(q) ||
                quote.jobDescription?.toLowerCase().includes(q) ||
                quote.shortSlug?.toLowerCase().includes(q)
            );
        }

        return true;
    });

    // Helper to get price display
    const getPriceDisplay = (quote: Quote) => {
        if (quote.quoteMode === 'hhh') {
            if (quote.essentialPrice) return `From £${(quote.essentialPrice / 100).toFixed(0)}`;
            if (quote.baseJobPricePence) return `Est. £${(quote.baseJobPricePence / 100).toFixed(0)}`;
        }
        if (quote.basePricePence) return `£${(quote.basePricePence / 100).toFixed(0)}`;
        return 'Price Pending';
    };

    // Helper for Status Badge
    const getStatusBadge = (quote: Quote) => {
        const isExpired = new Date(quote.expiresAt || '') < new Date();

        if (quote.bookedAt) {
            return (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#00C875] text-white">
                    <CheckCircle2 className="w-3.5 h-3.5 fill-current" />
                    <span className="text-[10px] font-bold uppercase tracking-wide">Accepted</span>
                </div>
            );
        }

        if (isExpired) {
            return (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#323338] text-white">
                    <Clock className="w-3.5 h-3.5 fill-current" />
                    <span className="text-[10px] font-bold uppercase tracking-wide">Expired</span>
                </div>
            );
        }

        if (quote.viewedAt) {
            return (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#00A2FF] text-white">
                    <Eye className="w-3.5 h-3.5 fill-current" />
                    <span className="text-[10px] font-bold uppercase tracking-wide">Viewed</span>
                </div>
            );
        }

        return (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#FDAB3D] text-white">
                <FileText className="w-3.5 h-3.5 fill-current" />
                <span className="text-[10px] font-bold uppercase tracking-wide">Sent</span>
            </div>
        );
    };

    return (
        <ContractorAppShell>
            <div className="bg-white sticky top-0 z-20 shadow-sm border-b border-gray-100">
                <div className="px-5 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <h1 className="font-bold text-xl text-[#323338]">My Quotes</h1>
                        <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full text-xs font-bold">
                            {quotes?.length || 0}
                        </span>
                    </div>
                    <Link href="/contractor/dashboard/quotes/new?mode=hhh">
                        <button className="flex items-center gap-2 px-4 py-2 bg-[#6C6CFF] hover:bg-[#5858E0] text-white rounded-lg font-bold text-sm shadow-md shadow-blue-500/20 transition-all active:scale-95">
                            <Plus size={16} strokeWidth={3} />
                            <span className="hidden sm:inline">New Quote</span>
                        </button>
                    </Link>
                </div>

                {/* Tabs */}
                <div className="px-5 flex gap-6">
                    <button
                        onClick={() => setActiveTab('active')}
                        className={cn(
                            "pb-3 text-sm font-bold border-b-2 transition-all",
                            activeTab === 'active'
                                ? "text-[#6C6CFF] border-[#6C6CFF]"
                                : "text-gray-400 border-transparent hover:text-gray-600"
                        )}
                    >
                        Active Quotes
                    </button>
                    <button
                        onClick={() => setActiveTab('booked')}
                        className={cn(
                            "pb-3 text-sm font-bold border-b-2 transition-all",
                            activeTab === 'booked'
                                ? "text-[#00C875] border-[#00C875]"
                                : "text-gray-400 border-transparent hover:text-gray-600"
                        )}
                    >
                        Booked Jobs
                    </button>
                </div>
            </div>

            <div className="p-5 space-y-6">

                {/* Search Bar */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={activeTab === 'active' ? "Search active quotes..." : "Search booked jobs..."}
                        className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6C6CFF]/20 focus:border-[#6C6CFF] transition-all"
                    />
                </div>

                {/* Content */}
                <div className="space-y-3">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-3">
                            <Loader2 className="w-8 h-8 animate-spin text-[#6C6CFF]" />
                            <p className="text-sm font-medium">Loading quotes...</p>
                        </div>
                    ) : filteredQuotes && filteredQuotes.length > 0 ? (
                        <AnimatePresence mode='popLayout'>
                            {filteredQuotes.map((quote) => (
                                <Link key={quote.id} href={`/contractor/dashboard/quotes/${quote.shortSlug}`}>
                                    <motion.div
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.95 }}
                                        layout
                                        className="group bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all cursor-pointer active:scale-[0.99]"
                                    >
                                        <div className="flex justify-between items-start mb-3">
                                            <div className="flex flex-col">
                                                <h3 className="font-bold text-base text-[#323338] line-clamp-1 group-hover:text-[#6C6CFF] transition-colors">
                                                    {quote.customerName || "Unnamed Client"}
                                                </h3>
                                                <span className="text-xs text-gray-400 flex items-center gap-1 mt-1 font-medium">
                                                    <Clock className="w-3 h-3" />
                                                    {quote.bookedAt
                                                        ? `Booked ${formatDistanceToNow(new Date(quote.bookedAt), { addSuffix: true })}`
                                                        : `Created ${formatDistanceToNow(new Date(quote.createdAt), { addSuffix: true })}`
                                                    }
                                                </span>
                                            </div>
                                            {getStatusBadge(quote)}
                                        </div>

                                        <p className="text-sm text-gray-500 line-clamp-2 mb-4 leading-relaxed font-medium">
                                            {quote.jobDescription || "No description provided."}
                                        </p>

                                        <div className="flex items-center justify-between pt-3 border-t border-gray-50">
                                            <div className="flex items-center gap-2">
                                                <span className={cn(
                                                    "text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wider",
                                                    quote.quoteMode === 'hhh' ? "bg-purple-50 text-purple-600" :
                                                        quote.quoteMode === 'pick_and_mix' ? "bg-emerald-50 text-emerald-600" :
                                                            "bg-gray-100 text-gray-600"
                                                )}>
                                                    {quote.quoteMode === 'hhh' ? 'Magic Quote' : quote.quoteMode === 'pick_and_mix' ? 'Pick & Mix' : 'Standard'}
                                                </span>
                                            </div>
                                            <span className="font-bold text-[#323338] text-base">
                                                {getPriceDisplay(quote)}
                                            </span>
                                        </div>
                                    </motion.div>
                                </Link>
                            ))}
                        </AnimatePresence>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                            <div className="w-20 h-20 rounded-full bg-gray-50 flex items-center justify-center border border-gray-100">
                                {activeTab === 'active' ? (
                                    <FileText className="w-8 h-8 text-gray-300" />
                                ) : (
                                    <CheckCircle2 className="w-8 h-8 text-gray-300" />
                                )}
                            </div>
                            <div className="space-y-1">
                                <h3 className="font-bold text-gray-800 text-lg">
                                    {activeTab === 'active' ? "No active quotes" : "No booked jobs"}
                                </h3>
                                <p className="text-gray-400 text-sm max-w-[200px] mx-auto leading-relaxed">
                                    {activeTab === 'active'
                                        ? "Any quotes you send will appear here until they are booked."
                                        : "When a client accepts a quote, it will move here."}
                                </p>
                            </div>
                            {activeTab === 'active' && (
                                <Link href="/contractor/dashboard/quotes/new?mode=hhh">
                                    <button className="px-8 py-3 bg-[#6C6CFF] hover:bg-[#5858E0] text-white font-bold rounded-xl transition-colors shadow-lg shadow-blue-500/20 flex items-center gap-2 mt-4">
                                        <Plus className="w-5 h-5" />
                                        <span>Create Magic Quote</span>
                                    </button>
                                </Link>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </ContractorAppShell>
    );
}
