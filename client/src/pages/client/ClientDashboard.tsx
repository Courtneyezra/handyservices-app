import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Briefcase, FileText, CreditCard, Star, ChevronRight, AlertCircle, Loader2, Calendar, CheckCircle2, Clock, Wrench, Home } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface Job {
    id: string;
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
    scheduledDate: string | null;
    completedAt: string | null;
    totalAmount: number;
    paymentStatus: 'pending' | 'paid' | 'partial';
    createdAt: string;
}

interface ClientPortalData {
    customer: {
        name: string;
        email: string | null;
        phone: string | null;
    };
    jobs: Job[];
    stats: {
        totalJobs: number;
        completedJobs: number;
        pendingPayments: number;
    };
}

export default function ClientDashboard() {
    const { token } = useParams<{ token: string }>();

    const { data, isLoading, error } = useQuery<ClientPortalData>({
        queryKey: ["client-portal", token],
        queryFn: async () => {
            const res = await fetch(`/api/client-portal/dashboard/${token}`);
            if (!res.ok) throw new Error("Portal not found");
            return res.json();
        },
        enabled: !!token,
    });

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gray-900 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500" />
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
                <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 max-w-md text-center">
                    <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                    <h1 className="text-xl font-semibold text-white mb-2">Portal Not Found</h1>
                    <p className="text-gray-400">This link may have expired or is invalid.</p>
                </div>
            </div>
        );
    }

    const { customer, jobs, stats } = data;

    const getStatusBadge = (status: Job['status']) => {
        switch (status) {
            case 'completed':
                return (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400">
                        <CheckCircle2 className="h-3 w-3" />
                        Completed
                    </span>
                );
            case 'in_progress':
                return (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400">
                        <Wrench className="h-3 w-3" />
                        In Progress
                    </span>
                );
            case 'pending':
                return (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400">
                        <Clock className="h-3 w-3" />
                        Scheduled
                    </span>
                );
            case 'cancelled':
                return (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-500/20 text-gray-400">
                        Cancelled
                    </span>
                );
        }
    };

    const getPaymentBadge = (status: Job['paymentStatus'], amount: number) => {
        if (status === 'paid') {
            return (
                <span className="text-green-400 text-sm font-medium">Paid</span>
            );
        }
        return (
            <span className="text-yellow-400 text-sm font-medium">
                Due: {(amount / 100).toFixed(2)}
            </span>
        );
    };

    return (
        <div className="min-h-screen bg-gray-900 py-8 px-4">
            <div className="max-w-2xl mx-auto">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="h-16 w-16 bg-yellow-500 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Home className="h-8 w-8 text-black" />
                    </div>
                    <h1 className="text-2xl font-bold text-white mb-1">Welcome back, {customer.name.split(' ')[0]}!</h1>
                    <p className="text-gray-400">Your service history and account</p>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-3 gap-3 mb-6">
                    <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 text-center">
                        <p className="text-2xl font-bold text-white">{stats.totalJobs}</p>
                        <p className="text-xs text-gray-400">Total Jobs</p>
                    </div>
                    <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 text-center">
                        <p className="text-2xl font-bold text-green-400">{stats.completedJobs}</p>
                        <p className="text-xs text-gray-400">Completed</p>
                    </div>
                    <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 text-center">
                        <p className="text-2xl font-bold text-yellow-400">{stats.pendingPayments}</p>
                        <p className="text-xs text-gray-400">Pending</p>
                    </div>
                </div>

                {/* Quick Actions */}
                <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 mb-6">
                    <h2 className="text-sm font-medium text-gray-400 mb-3">Quick Actions</h2>
                    <div className="grid grid-cols-2 gap-3">
                        <Link href={`/client/${token}/request`}>
                            <button className="w-full p-3 bg-yellow-500 hover:bg-yellow-400 rounded-lg text-black font-medium text-sm flex items-center justify-center gap-2 transition-colors">
                                <Briefcase className="h-4 w-4" />
                                Request Service
                            </button>
                        </Link>
                        <Link href={`/client/${token}/invoices`}>
                            <button className="w-full p-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-white font-medium text-sm flex items-center justify-center gap-2 transition-colors">
                                <FileText className="h-4 w-4" />
                                View Invoices
                            </button>
                        </Link>
                    </div>
                </div>

                {/* Job History */}
                <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                    <div className="p-4 border-b border-gray-700 flex items-center justify-between">
                        <h2 className="text-lg font-semibold text-white">Job History</h2>
                        <span className="text-sm text-gray-400">{jobs.length} jobs</span>
                    </div>

                    {jobs.length === 0 ? (
                        <div className="p-8 text-center">
                            <Briefcase className="h-12 w-12 text-gray-600 mx-auto mb-3" />
                            <p className="text-gray-400">No jobs yet</p>
                            <p className="text-sm text-gray-500 mt-1">Your service history will appear here</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-700">
                            {jobs.map((job) => (
                                <div
                                    key={job.id}
                                    className="p-4 hover:bg-gray-700/50 transition-colors cursor-pointer"
                                >
                                    <div className="flex items-start justify-between mb-2">
                                        <div className="flex-1">
                                            <p className="text-white font-medium line-clamp-1">{job.description}</p>
                                            <p className="text-sm text-gray-400 flex items-center gap-1 mt-1">
                                                <Calendar className="h-3 w-3" />
                                                {job.scheduledDate
                                                    ? format(new Date(job.scheduledDate), "MMM d, yyyy")
                                                    : formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })
                                                }
                                            </p>
                                        </div>
                                        <ChevronRight className="h-5 w-5 text-gray-500" />
                                    </div>
                                    <div className="flex items-center justify-between">
                                        {getStatusBadge(job.status)}
                                        {getPaymentBadge(job.paymentStatus, job.totalAmount)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="mt-8 text-center">
                    <p className="text-xs text-gray-500">
                        Need help? Contact us at support@v6handyman.com
                    </p>
                </div>
            </div>
        </div>
    );
}
