import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { ArrowLeft, Loader2, AlertCircle, Calendar, Clock, CheckCircle2, Wrench, MapPin, CreditCard, FileText, ImageIcon, Star } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface JobDetails {
    id: string;
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
    scheduledDate: string | null;
    scheduledStartTime: string | null;
    scheduledEndTime: string | null;
    completedAt: string | null;
    totalAmount: number;
    depositPaid: number;
    balanceDue: number;
    paymentStatus: 'pending' | 'paid' | 'partial';
    location: string | null;
    evidenceUrls: string[];
    contractor: {
        name: string;
        phone: string | null;
        profileImageUrl: string | null;
    } | null;
    createdAt: string;
    invoiceToken: string | null;
    reviewToken: string | null;
}

export default function JobHistoryPage() {
    const { token, jobId } = useParams<{ token: string; jobId: string }>();

    const { data: job, isLoading, error } = useQuery<JobDetails>({
        queryKey: ["client-job", token, jobId],
        queryFn: async () => {
            const res = await fetch(`/api/client-portal/jobs/${jobId}?token=${token}`);
            if (!res.ok) throw new Error("Job not found");
            return res.json();
        },
        enabled: !!token && !!jobId,
    });

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gray-900 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500" />
            </div>
        );
    }

    if (error || !job) {
        return (
            <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
                <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 max-w-md text-center">
                    <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                    <h1 className="text-xl font-semibold text-white mb-2">Job Not Found</h1>
                    <p className="text-gray-400">This job could not be found.</p>
                    <Link href={`/client/${token}`}>
                        <button className="mt-4 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white text-sm">
                            Back to Dashboard
                        </button>
                    </Link>
                </div>
            </div>
        );
    }

    const getStatusDisplay = (status: JobDetails['status']) => {
        switch (status) {
            case 'completed':
                return {
                    icon: <CheckCircle2 className="h-6 w-6 text-green-400" />,
                    label: "Completed",
                    color: "text-green-400",
                    bg: "bg-green-500/10"
                };
            case 'in_progress':
                return {
                    icon: <Wrench className="h-6 w-6 text-blue-400" />,
                    label: "In Progress",
                    color: "text-blue-400",
                    bg: "bg-blue-500/10"
                };
            case 'pending':
                return {
                    icon: <Clock className="h-6 w-6 text-yellow-400" />,
                    label: "Scheduled",
                    color: "text-yellow-400",
                    bg: "bg-yellow-500/10"
                };
            case 'cancelled':
                return {
                    icon: <AlertCircle className="h-6 w-6 text-gray-400" />,
                    label: "Cancelled",
                    color: "text-gray-400",
                    bg: "bg-gray-500/10"
                };
        }
    };

    const statusDisplay = getStatusDisplay(job.status);

    return (
        <div className="min-h-screen bg-gray-900 pb-8">
            {/* Header */}
            <div className="bg-gray-800 border-b border-gray-700 sticky top-0 z-10">
                <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
                    <Link href={`/client/${token}`}>
                        <button className="p-2 -ml-2 rounded-lg hover:bg-gray-700 text-gray-400">
                            <ArrowLeft className="h-5 w-5" />
                        </button>
                    </Link>
                    <div>
                        <h1 className="font-semibold text-white">Job Details</h1>
                        <p className="text-xs text-gray-400">#{job.id.substring(0, 8).toUpperCase()}</p>
                    </div>
                </div>
            </div>

            <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
                {/* Status Banner */}
                <div className={`${statusDisplay.bg} rounded-xl p-4 flex items-center gap-4`}>
                    {statusDisplay.icon}
                    <div>
                        <p className={`font-semibold ${statusDisplay.color}`}>{statusDisplay.label}</p>
                        {job.completedAt && (
                            <p className="text-sm text-gray-400">
                                Completed {formatDistanceToNow(new Date(job.completedAt), { addSuffix: true })}
                            </p>
                        )}
                    </div>
                </div>

                {/* Job Description */}
                <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                    <h2 className="text-sm font-medium text-gray-400 mb-2">Job Description</h2>
                    <p className="text-white">{job.description}</p>
                </div>

                {/* Schedule & Location */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <Calendar className="h-4 w-4 text-blue-400" />
                            <span className="text-sm text-gray-400">Scheduled</span>
                        </div>
                        <p className="text-white font-medium">
                            {job.scheduledDate
                                ? format(new Date(job.scheduledDate), "MMM d, yyyy")
                                : "TBD"
                            }
                        </p>
                        {job.scheduledStartTime && (
                            <p className="text-sm text-gray-400">{job.scheduledStartTime} - {job.scheduledEndTime || 'TBD'}</p>
                        )}
                    </div>
                    {job.location && (
                        <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <MapPin className="h-4 w-4 text-red-400" />
                                <span className="text-sm text-gray-400">Location</span>
                            </div>
                            <p className="text-white font-medium line-clamp-2">{job.location}</p>
                        </div>
                    )}
                </div>

                {/* Contractor */}
                {job.contractor && (
                    <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                        <h2 className="text-sm font-medium text-gray-400 mb-3">Your Tradesperson</h2>
                        <div className="flex items-center gap-3">
                            <div className="h-12 w-12 rounded-full bg-gray-700 flex items-center justify-center overflow-hidden">
                                {job.contractor.profileImageUrl ? (
                                    <img src={job.contractor.profileImageUrl} alt={job.contractor.name} className="h-full w-full object-cover" />
                                ) : (
                                    <span className="text-lg font-bold text-gray-400">
                                        {job.contractor.name.charAt(0).toUpperCase()}
                                    </span>
                                )}
                            </div>
                            <div>
                                <p className="text-white font-medium">{job.contractor.name}</p>
                                {job.contractor.phone && (
                                    <a href={`tel:${job.contractor.phone}`} className="text-sm text-yellow-400 hover:underline">
                                        {job.contractor.phone}
                                    </a>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Payment Summary */}
                <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                    <h2 className="text-sm font-medium text-gray-400 mb-3">Payment</h2>
                    <div className="space-y-2">
                        <div className="flex justify-between">
                            <span className="text-gray-400">Total</span>
                            <span className="text-white font-medium">{(job.totalAmount / 100).toFixed(2)}</span>
                        </div>
                        {job.depositPaid > 0 && (
                            <div className="flex justify-between">
                                <span className="text-gray-400">Deposit Paid</span>
                                <span className="text-green-400">-{(job.depositPaid / 100).toFixed(2)}</span>
                            </div>
                        )}
                        <div className="flex justify-between pt-2 border-t border-gray-700">
                            <span className="text-white font-medium">Balance Due</span>
                            <span className={job.paymentStatus === 'paid' ? 'text-green-400' : 'text-yellow-400'}>
                                {job.paymentStatus === 'paid' ? 'Paid' : `${(job.balanceDue / 100).toFixed(2)}`}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Evidence Photos */}
                {job.evidenceUrls && job.evidenceUrls.length > 0 && (
                    <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                        <h2 className="text-sm font-medium text-gray-400 mb-3">Completion Photos</h2>
                        <div className="grid grid-cols-3 gap-2">
                            {job.evidenceUrls.map((url, index) => (
                                <a
                                    key={index}
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="relative aspect-square bg-gray-700 rounded-lg overflow-hidden hover:ring-2 ring-yellow-400"
                                >
                                    <img
                                        src={url}
                                        alt={`Evidence ${index + 1}`}
                                        className="w-full h-full object-cover"
                                    />
                                    <div className="absolute bottom-0 left-0 right-0 bg-black/50 p-1">
                                        <ImageIcon className="w-3 h-3 text-white mx-auto" />
                                    </div>
                                </a>
                            ))}
                        </div>
                    </div>
                )}

                {/* Actions */}
                <div className="space-y-3">
                    {job.invoiceToken && (
                        <Link href={`/invoice/${job.invoiceToken}`}>
                            <button className="w-full p-4 bg-gray-800 hover:bg-gray-700 rounded-xl border border-gray-700 text-white font-medium flex items-center justify-center gap-2 transition-colors">
                                <FileText className="h-5 w-5 text-yellow-500" />
                                View Invoice
                            </button>
                        </Link>
                    )}
                    {job.balanceDue > 0 && job.paymentStatus !== 'paid' && (
                        <Link href={`/pay/${job.id}`}>
                            <button className="w-full p-4 bg-yellow-500 hover:bg-yellow-400 rounded-xl text-black font-semibold flex items-center justify-center gap-2 transition-colors">
                                <CreditCard className="h-5 w-5" />
                                Pay Now - {(job.balanceDue / 100).toFixed(2)}
                            </button>
                        </Link>
                    )}
                    {job.status === 'completed' && job.reviewToken && (
                        <Link href={`/review/${job.reviewToken}`}>
                            <button className="w-full p-4 bg-gray-800 hover:bg-gray-700 rounded-xl border border-gray-700 text-white font-medium flex items-center justify-center gap-2 transition-colors">
                                <Star className="h-5 w-5 text-yellow-500" />
                                Leave a Review
                            </button>
                        </Link>
                    )}
                </div>
            </div>
        </div>
    );
}
