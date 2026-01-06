import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Loader2, FileText, CheckCircle2, Calendar, Briefcase } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";

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

export default function JobsPage() {
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

    // Filter only accepted (booked) quotes
    const jobs = quotes?.filter(quote => !!quote.bookedAt);

    // Helper to get price display
    const getPriceDisplay = (quote: Quote) => {
        if (quote.quoteMode === 'hhh') {
            if (quote.essentialPrice) return `From £${(quote.essentialPrice / 100).toFixed(0)}`;
            if (quote.baseJobPricePence) return `Est. £${(quote.baseJobPricePence / 100).toFixed(0)}`;
        }
        if (quote.basePricePence) return `£${(quote.basePricePence / 100).toFixed(0)}`;
        return 'Price Pending';
    };

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 font-sans pb-24">

            {/* Header */}
            <div className="sticky top-0 z-30 bg-slate-950/80 backdrop-blur-md px-4 py-4 flex items-center gap-3 border-b border-slate-800">
                <Link href="/contractor/dashboard">
                    <button className="p-2 -ml-2 rounded-full hover:bg-slate-800 text-slate-400">
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                </Link>
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                        <Briefcase className="w-4 h-4" />
                    </div>
                    <h1 className="font-bold text-lg">My Jobs</h1>
                </div>
            </div>

            {/* Content */}
            <div className="px-4 py-6 space-y-4">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-3">
                        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
                        <p className="text-sm">Loading jobs...</p>
                    </div>
                ) : jobs && jobs.length > 0 ? (
                    <div className="space-y-3">
                        {jobs.map((job) => (
                            <Link key={job.id} href={`/contractor/dashboard/quotes/${job.shortSlug}`}>
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="block bg-slate-900/50 border border-slate-800 rounded-xl p-4 active:scale-[0.98] transition-all hover:bg-slate-900 cursor-pointer group"
                                >
                                    <div className="flex justify-between items-start mb-3">
                                        <div className="flex flex-col">
                                            <span className="font-bold text-base text-white line-clamp-1 group-hover:text-amber-500 transition-colors">{job.customerName}</span>
                                            <span className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                                                <Calendar className="w-3 h-3" />
                                                Booked {formatDistanceToNow(new Date(job.bookedAt!), { addSuffix: true })}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                            <CheckCircle2 className="w-3.5 h-3.5" />
                                            <span className="text-xs font-bold">Active</span>
                                        </div>
                                    </div>

                                    <p className="text-sm text-slate-400 line-clamp-2 mb-4 leading-relaxed">
                                        {job.jobDescription}
                                    </p>

                                    <div className="flex items-center justify-between pt-3 border-t border-slate-800/50">
                                        <span className="text-xs text-slate-500">
                                            {job.quoteMode === 'hhh' ? 'Magic Quote' : job.quoteMode === 'pick_and_mix' ? 'Pick & Mix' : 'Standard Quote'}
                                        </span>
                                        <span className="font-bold text-white">
                                            {getPriceDisplay(job)}
                                        </span>
                                    </div>
                                </motion.div>
                            </Link>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                        <div className="w-16 h-16 rounded-full bg-slate-900 flex items-center justify-center border border-slate-800">
                            <Briefcase className="w-8 h-8 text-slate-600" />
                        </div>
                        <div className="space-y-1">
                            <h3 className="font-bold text-white text-lg">No jobs yet</h3>
                            <p className="text-slate-400 text-sm max-w-[200px] mx-auto">
                                Accepted quotes will appear here as active jobs.
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
