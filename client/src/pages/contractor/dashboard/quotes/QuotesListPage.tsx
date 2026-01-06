
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { ArrowLeft, Plus, Search, Filter, Loader2, FileText, CheckCircle2, Clock, Eye, AlertCircle, Calendar } from "lucide-react";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

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

export default function QuotesListPage() {
    const [, setLocation] = useLocation();
    const [filter, setFilter] = useState<'all' | 'opened' | 'accepted' | 'expired'>('all');

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
        if (filter === 'all') return true;

        const isExpired = new Date(quote.expiresAt || '') < new Date();
        const isBooked = !!quote.bookedAt;
        const isViewed = !!quote.viewedAt;

        if (filter === 'accepted') return isBooked;
        if (filter === 'expired') return isExpired && !isBooked;
        if (filter === 'opened') return isViewed && !isBooked && !isExpired;

        return true;
    });

    // Helper to get price display
    const getPriceDisplay = (quote: Quote) => {
        if (quote.quoteMode === 'hhh') {
            // For HHH, maybe show "From £X" (Essential price)
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
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span className="text-xs font-bold">Accepted</span>
                </div>
            );
        }

        if (isExpired) {
            return (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                    <Clock className="w-3.5 h-3.5" />
                    <span className="text-xs font-bold">Expired</span>
                </div>
            );
        }

        if (quote.viewedAt) {
            return (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    <Eye className="w-3.5 h-3.5" />
                    <span className="text-xs font-bold">Viewed</span>
                </div>
            );
        }

        return (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <FileText className="w-3.5 h-3.5" />
                <span className="text-xs font-bold">Sent</span>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 font-sans pb-24">

            {/* Header */}
            <div className="sticky top-0 z-30 bg-slate-950/80 backdrop-blur-md px-4 py-4 flex items-center justify-between border-b border-slate-800">
                <div className="flex items-center gap-3">
                    <Link href="/contractor/dashboard">
                        <button className="p-2 -ml-2 rounded-full hover:bg-slate-800 text-slate-400">
                            <ArrowLeft className="w-5 h-5" />
                        </button>
                    </Link>
                    <h1 className="font-bold text-lg">My Quotes</h1>
                </div>
                <Link href="/contractor/dashboard/quotes/new?mode=hhh">
                    <button className="p-2 rounded-full bg-amber-500 text-slate-900 hover:bg-amber-400 transition-colors shadow-lg shadow-amber-900/20">
                        <Plus className="w-5 h-5" />
                    </button>
                </Link>
            </div>

            {/* Filters */}
            <div className="px-4 py-4 overflow-x-auto no-scrollbar">
                <div className="flex gap-2">
                    {['all', 'opened', 'accepted', 'expired'].map((f) => (
                        <button
                            key={f}
                            onClick={() => setFilter(f as any)}
                            className={cn(
                                "px-4 py-2 rounded-full text-xs font-bold capitalize whitespace-nowrap border transition-all",
                                filter === f
                                    ? "bg-slate-800 text-white border-slate-700"
                                    : "bg-transparent text-slate-500 border-transparent hover:bg-slate-900"
                            )}
                        >
                            {f}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content */}
            <div className="px-4 space-y-4">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-3">
                        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
                        <p className="text-sm">Loading quotes...</p>
                    </div>
                ) : filteredQuotes && filteredQuotes.length > 0 ? (
                    <div className="space-y-3">
                        {filteredQuotes.map((quote) => (
                            <Link key={quote.id} href={`/contractor/dashboard/quotes/${quote.shortSlug}`}>
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="block bg-slate-900/50 border border-slate-800 rounded-xl p-4 active:scale-[0.98] transition-all hover:bg-slate-900 cursor-pointer"
                                >
                                    <div className="flex justify-between items-start mb-3">
                                        <div className="flex flex-col">
                                            <span className="font-bold text-base text-white line-clamp-1">{quote.customerName}</span>
                                            <span className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                                                <Calendar className="w-3 h-3" />
                                                {formatDistanceToNow(new Date(quote.createdAt), { addSuffix: true })}
                                            </span>
                                        </div>
                                        {getStatusBadge(quote)}
                                    </div>

                                    <p className="text-sm text-slate-400 line-clamp-2 mb-4 leading-relaxed">
                                        {quote.jobDescription}
                                    </p>

                                    <div className="flex items-center justify-between pt-3 border-t border-slate-800/50">
                                        <div className="flex items-center gap-2">
                                            <span className={cn(
                                                "text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider",
                                                quote.quoteMode === 'hhh' ? "bg-amber-500/10 text-amber-500 border-amber-500/20" :
                                                    quote.quoteMode === 'pick_and_mix' ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
                                                        "bg-slate-800 text-slate-400 border-slate-700"
                                            )}>
                                                {quote.quoteMode === 'hhh' ? 'Magic' : quote.quoteMode === 'pick_and_mix' ? 'Pick & Mix' : 'Standard'}
                                            </span>
                                        </div>
                                        <span className="font-bold text-white">
                                            {getPriceDisplay(quote)}
                                        </span>
                                    </div>
                                </motion.div>
                            </Link>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                        <div className="w-16 h-16 rounded-full bg-slate-900 flex items-center justify-center border border-slate-800">
                            <FileText className="w-8 h-8 text-slate-600" />
                        </div>
                        <div className="space-y-1">
                            <h3 className="font-bold text-white text-lg">No quotes found</h3>
                            <p className="text-slate-400 text-sm max-w-[200px] mx-auto">
                                {filter === 'all'
                                    ? "You haven't generated any quotes yet."
                                    : `No ${filter} quotes found.`}
                            </p>
                        </div>
                        {filter === 'all' && (
                            <Link href="/contractor/dashboard/quotes/new?mode=hhh">
                                <button className="px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded-xl transition-colors shadow-lg shadow-amber-900/20 flex items-center gap-2">
                                    <Plus className="w-4 h-4" />
                                    <span>Create Quote</span>
                                </button>
                            </Link>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
