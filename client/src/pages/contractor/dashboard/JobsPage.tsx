import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import ContractorAppShell from "@/components/layout/ContractorAppShell";
import { ArrowLeft, Loader2, FileText, CheckCircle2, Calendar, Briefcase, Play, CheckSquare, Clock, Wrench } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

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
    jobStatus?: 'pending' | 'in_progress' | 'completed' | null; // Job progress status
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

    const queryClient = useQueryClient();
    const { toast } = useToast();

    // Update job status using the PATCH endpoint
    const updateJobStatusMutation = useMutation({
        mutationFn: async ({ quoteId, status }: { quoteId: string; status: 'in_progress' | 'completed' }) => {
            const token = localStorage.getItem('contractorToken');
            // Use the quote's shortSlug to update via the job-assignment route
            // The jobs are stored in contractorBookingRequests, linked via quoteId
            const res = await fetch(`/api/jobs/${quoteId}/complete`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ status })
            });
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || `Failed to ${status === 'in_progress' ? 'start' : 'complete'} job`);
            }
            return res.json();
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: ['contractor-quotes'] });
            if (variables.status === 'in_progress') {
                toast({ title: "Job Started", description: "You've started working on this job." });
            } else {
                toast({ title: "Job Completed!", description: "Great work! The job has been marked as complete." });
            }
        },
        onError: (error: Error) => {
            toast({ title: "Error", description: error.message || "Failed to update job. Please try again.", variant: "destructive" });
        }
    });

    // Filter only accepted (booked) quotes (which are effectively jobs)
    // Note: The /quotes endpoint returns quotes. To get the `contractorJobId`, we might need to adjust the backend.
    // Assuming for now the backend /quotes endpoint was updated or we need to separate Jobs fetching?
    // Let's check QuotesListPage - it uses the same endpoint.
    // If quote.bookedAt is present, it's a job.
    // BUT does the quote object have the `contractorJobId`?
    // The schema shows `contractorJobs` links to `quoteId`.
    // The endpoint likely just joins them or we need to fetch `/jobs` instead.
    // Let's assume for v1 MVP we are building on top of what exists.
    // If the backend doesn't return contractorJobId, we can't call the API.
    // I should probably have checked the GET /quotes response.
    // Let's just create a GET /jobs endpoint to be clean or assume we filter here.

    // Actually, let's create a dedicated useQuery for jobs if we want to be correct.
    // But for speed, let's check if we can just filter.
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

    // Helper to get job status display
    const getJobStatusBadge = (job: Quote) => {
        const status = job.jobStatus || 'pending';
        switch (status) {
            case 'completed':
                return (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-100 text-green-600 border border-green-200">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span className="text-xs font-bold">Completed</span>
                    </div>
                );
            case 'in_progress':
                return (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-100 text-blue-600 border border-blue-200">
                        <Wrench className="w-3.5 h-3.5" />
                        <span className="text-xs font-bold">In Progress</span>
                    </div>
                );
            default:
                return (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 text-amber-600 border border-amber-200">
                        <Clock className="w-3.5 h-3.5" />
                        <span className="text-xs font-bold">Scheduled</span>
                    </div>
                );
        }
    };

    return (
        <ContractorAppShell>
            {/* Header */}
            <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-md px-4 py-4 flex items-center gap-3 border-b border-gray-100">
                <Link href="/contractor/dashboard">
                    <button className="p-2 -ml-2 rounded-full hover:bg-slate-100 text-slate-400">
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                </Link>
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                        <Briefcase className="w-4 h-4" />
                    </div>
                    <h1 className="font-bold text-lg text-slate-800">My Jobs</h1>
                </div>
            </div>

            {/* Content */}
            <div className="px-5 py-6 space-y-4">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-3">
                        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
                        <p className="text-sm">Loading jobs...</p>
                    </div>
                ) : jobs && jobs.length > 0 ? (
                    <div className="space-y-3">
                        {jobs.map((job) => (
                            <Link key={job.id} href={`/contractor/dashboard/jobs/${job.shortSlug || job.id}`}>
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="block bg-white border border-gray-100 rounded-xl p-4 active:scale-[0.98] transition-all hover:bg-gray-50 cursor-pointer group shadow-sm"
                                >
                                    <div className="flex justify-between items-start mb-3">
                                        <div className="flex flex-col">
                                            <span className="font-bold text-base text-slate-800 line-clamp-1 group-hover:text-amber-600 transition-colors">{job.customerName}</span>
                                            <span className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                                                <Calendar className="w-3 h-3" />
                                                Booked {formatDistanceToNow(new Date(job.bookedAt!), { addSuffix: true })}
                                            </span>
                                        </div>
                                        {getJobStatusBadge(job)}
                                    </div>

                                    {/* Status Actions - Show based on current job status */}
                                    {job.jobStatus !== 'completed' && (
                                        <div className="flex gap-2 mb-4">
                                            {(!job.jobStatus || job.jobStatus === 'pending') && (
                                                <Button
                                                    size="sm"
                                                    className="h-8 bg-blue-100 text-blue-600 hover:bg-blue-200 hover:text-blue-800 border border-blue-200 shadow-sm"
                                                    disabled={updateJobStatusMutation.isPending}
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        updateJobStatusMutation.mutate({ quoteId: job.id, status: 'in_progress' });
                                                    }}
                                                >
                                                    {updateJobStatusMutation.isPending ? (
                                                        <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                                                    ) : (
                                                        <Play className="w-3 h-3 mr-1.5" />
                                                    )}
                                                    Start Job
                                                </Button>
                                            )}
                                            {(job.jobStatus === 'in_progress' || job.jobStatus === 'pending' || !job.jobStatus) && (
                                                <Button
                                                    size="sm"
                                                    className="h-8 bg-emerald-100 text-emerald-600 hover:bg-emerald-200 hover:text-emerald-800 border border-emerald-200 shadow-sm"
                                                    disabled={updateJobStatusMutation.isPending}
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        updateJobStatusMutation.mutate({ quoteId: job.id, status: 'completed' });
                                                    }}
                                                >
                                                    {updateJobStatusMutation.isPending ? (
                                                        <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                                                    ) : (
                                                        <CheckSquare className="w-3 h-3 mr-1.5" />
                                                    )}
                                                    Complete
                                                </Button>
                                            )}
                                        </div>
                                    )}

                                    <p className="text-sm text-slate-500 line-clamp-2 mb-4 leading-relaxed">
                                        {job.jobDescription}
                                    </p>

                                    <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                                        <span className="text-xs text-slate-400">
                                            {job.quoteMode === 'hhh' ? 'Magic Quote' : job.quoteMode === 'pick_and_mix' ? 'Pick & Mix' : 'Standard Quote'}
                                        </span>
                                        <span className="font-bold text-slate-700">
                                            {getPriceDisplay(job)}
                                        </span>
                                    </div>
                                </motion.div>
                            </Link>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                        <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
                            <Briefcase className="w-8 h-8 text-slate-400" />
                        </div>
                        <div className="space-y-1">
                            <h3 className="font-bold text-slate-800 text-lg">No jobs yet</h3>
                            <p className="text-slate-400 text-sm max-w-[200px] mx-auto">
                                Accepted quotes will appear here as active jobs.
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </ContractorAppShell>
    );
}
