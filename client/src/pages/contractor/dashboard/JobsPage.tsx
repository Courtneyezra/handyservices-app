import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import ContractorAppShell from "@/components/layout/ContractorAppShell";
import { ArrowLeft, Loader2, CheckCircle2, Calendar, Briefcase, Clock, Wrench, PoundSterling, MapPin, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { motion } from "framer-motion";

interface Booking {
    id: string;
    customerName: string;
    customerPhone: string | null;
    description: string | null;
    status: string;
    assignmentStatus: string;
    scheduledDate: string | null;
    scheduledSlot: string | null;
    requestedSlot: string | null;
    scheduledStartTime: string | null;
    address: string | null;
    postcode: string | null;
    acceptedAt: string | null;
    createdAt: string;
    quoteId: string | null;
    payoutPence?: number | null;
    estimatedDurationMinutes?: number | null;
}

function formatSlot(booking: Booking): string {
    if (booking.scheduledStartTime) return booking.scheduledStartTime;
    const slot = booking.scheduledSlot || booking.requestedSlot;
    if (slot === 'am') return 'Morning';
    if (slot === 'pm') return 'Afternoon';
    if (slot === 'full_day' || slot === 'full') return 'Full Day';
    return '';
}

function statusConfig(status: string) {
    switch (status) {
        case 'accepted':
            return { label: 'Confirmed', icon: CheckCircle2, bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', dot: 'bg-green-500' };
        case 'assigned':
            return { label: 'Action Needed', icon: Clock, bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500' };
        case 'in_progress':
            return { label: 'In Progress', icon: Wrench, bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500' };
        case 'completed':
            return { label: 'Completed', icon: CheckCircle2, bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', dot: 'bg-slate-400' };
        default:
            return { label: status, icon: Clock, bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', dot: 'bg-slate-400' };
    }
}

export default function JobsPage() {
    const { data: bookings, isLoading } = useQuery<Booking[]>({
        queryKey: ['contractor-bookings'],
        queryFn: async () => {
            const token = localStorage.getItem('contractorToken');
            const res = await fetch('/api/contractor/bookings', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to fetch jobs');
            return res.json();
        },
    });

    // Only show active jobs (not declined)
    const jobs = bookings?.filter(b => b.assignmentStatus !== 'rejected' && b.status !== 'declined') || [];

    // Split into upcoming and completed
    const upcoming = jobs.filter(j => j.assignmentStatus !== 'completed');
    const completed = jobs.filter(j => j.assignmentStatus === 'completed');

    // Weekly earnings
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const weekEarnings = jobs
        .filter(j => j.assignmentStatus === 'completed' && j.acceptedAt && new Date(j.acceptedAt) >= weekStart)
        .reduce((sum, j) => sum + (j.payoutPence || 0), 0);

    const monthEarnings = jobs
        .filter(j => j.assignmentStatus === 'completed' && j.acceptedAt && new Date(j.acceptedAt).getMonth() === now.getMonth())
        .reduce((sum, j) => sum + (j.payoutPence || 0), 0);

    return (
        <ContractorAppShell>
            {/* Header */}
            <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-md px-4 py-4 flex items-center gap-3 border-b border-gray-100">
                <Link href="/contractor/dashboard">
                    <button className="p-2 -ml-2 rounded-full hover:bg-slate-100 text-slate-400">
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                </Link>
                <div className="flex items-center gap-2 flex-1">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                        <Briefcase className="w-4 h-4" />
                    </div>
                    <h1 className="font-bold text-lg text-slate-800">My Jobs</h1>
                </div>
                {jobs.length > 0 && (
                    <span className="text-xs font-medium text-slate-400">{upcoming.length} active</span>
                )}
            </div>

            {/* Earnings Strip */}
            {jobs.length > 0 && (
                <div className="flex gap-3 px-5 pt-4">
                    <div className="flex-1 bg-emerald-50 rounded-xl p-3 border border-emerald-100">
                        <p className="text-[10px] font-medium text-emerald-500 uppercase">This Week</p>
                        <p className="text-lg font-bold text-emerald-800">£{(weekEarnings / 100).toFixed(0)}</p>
                    </div>
                    <div className="flex-1 bg-emerald-50 rounded-xl p-3 border border-emerald-100">
                        <p className="text-[10px] font-medium text-emerald-500 uppercase">This Month</p>
                        <p className="text-lg font-bold text-emerald-800">£{(monthEarnings / 100).toFixed(0)}</p>
                    </div>
                </div>
            )}

            {/* Content */}
            <div className="px-5 py-4 space-y-3">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-500 gap-3">
                        <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                        <p className="text-sm">Loading jobs...</p>
                    </div>
                ) : upcoming.length > 0 ? (
                    <>
                        {upcoming.map((job, i) => {
                            const sc = statusConfig(job.assignmentStatus);
                            return (
                                <Link key={job.id} href={`/contractor/dashboard/jobs/${job.id}`}>
                                    <motion.div
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: i * 0.05 }}
                                        className="bg-white border border-gray-100 rounded-xl p-4 active:scale-[0.98] transition-all hover:border-gray-200 cursor-pointer shadow-sm"
                                    >
                                        <div className="flex items-start justify-between mb-2">
                                            <div className="flex-1 min-w-0">
                                                <h3 className="font-bold text-base text-slate-800 truncate">{job.customerName}</h3>
                                                {job.scheduledDate && (
                                                    <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                                                        <Calendar className="w-3 h-3" />
                                                        <span>{format(new Date(job.scheduledDate), "EEE, MMM d")}</span>
                                                        {formatSlot(job) && <span className="text-slate-300">·</span>}
                                                        {formatSlot(job) && <span>{formatSlot(job)}</span>}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-bold border ${sc.bg} ${sc.text} ${sc.border}`}>
                                                    <div className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                                                    {sc.label}
                                                </div>
                                                <ChevronRight className="w-4 h-4 text-slate-300" />
                                            </div>
                                        </div>

                                        {job.description && (
                                            <p className="text-sm text-slate-500 line-clamp-1 mb-2">{job.description}</p>
                                        )}

                                        <div className="flex items-center justify-between pt-2 border-t border-gray-50">
                                            {(job.address || job.postcode) && (
                                                <span className="text-xs text-slate-400 flex items-center gap-1 truncate flex-1 mr-2">
                                                    <MapPin className="w-3 h-3 shrink-0" />
                                                    {job.postcode || job.address}
                                                </span>
                                            )}
                                            {job.payoutPence != null && job.payoutPence > 0 && (
                                                <span className="text-sm font-bold text-emerald-700 flex items-center gap-1 shrink-0">
                                                    <PoundSterling className="w-3.5 h-3.5" />
                                                    £{(job.payoutPence / 100).toFixed(2)}
                                                </span>
                                            )}
                                        </div>
                                    </motion.div>
                                </Link>
                            );
                        })}

                        {/* Completed section */}
                        {completed.length > 0 && (
                            <>
                                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider pt-4">Completed ({completed.length})</h3>
                                {completed.map((job) => (
                                    <Link key={job.id} href={`/contractor/dashboard/jobs/${job.id}`}>
                                        <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 opacity-75 hover:opacity-100 transition-opacity cursor-pointer">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <h3 className="font-medium text-sm text-slate-600">{job.customerName}</h3>
                                                    <span className="text-xs text-slate-400">
                                                        {job.scheduledDate ? format(new Date(job.scheduledDate), "MMM d") : ''}
                                                    </span>
                                                </div>
                                                {job.payoutPence != null && job.payoutPence > 0 && (
                                                    <span className="text-sm font-bold text-emerald-600">£{(job.payoutPence / 100).toFixed(2)}</span>
                                                )}
                                            </div>
                                        </div>
                                    </Link>
                                ))}
                            </>
                        )}
                    </>
                ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                        <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200">
                            <Briefcase className="w-8 h-8 text-slate-400" />
                        </div>
                        <div className="space-y-1">
                            <h3 className="font-bold text-slate-800 text-lg">No jobs yet</h3>
                            <p className="text-slate-400 text-sm max-w-[220px] mx-auto">
                                Keep your calendar updated and jobs will appear here automatically
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </ContractorAppShell>
    );
}
