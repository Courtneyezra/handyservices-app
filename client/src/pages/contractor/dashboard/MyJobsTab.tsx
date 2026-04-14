import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2, Briefcase, Clock, Wrench, CheckCircle2, Calendar, MapPin, PoundSterling, ChevronRight, CreditCard, Banknote, TrendingUp } from "lucide-react";
import { format, startOfWeek, startOfMonth, subWeeks } from "date-fns";

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
  completedAt: string | null;
  createdAt: string;
  quoteId: string | null;
  payoutPence?: number | null;
  customerPaidAt?: string | null;
  payoutStatus?: string | null; // 'pending' | 'processing' | 'paid' | 'failed' | 'held'
  payoutPaidAt?: string | null;
  payoutNetPence?: number | null;
}

type JobDisplayStatus = 'payment_pending' | 'confirmed' | 'in_progress' | 'completed_unpaid' | 'completed_paid';

function getDisplayStatus(b: Booking): JobDisplayStatus {
  // Customer hasn't paid yet
  if (!b.customerPaidAt && b.assignmentStatus !== 'completed') {
    return 'payment_pending';
  }
  if (b.assignmentStatus === 'completed') {
    return b.payoutStatus === 'paid' ? 'completed_paid' : 'completed_unpaid';
  }
  if (b.assignmentStatus === 'in_progress') return 'in_progress';
  // accepted or assigned with payment = confirmed
  return 'confirmed';
}

function formatSlot(booking: Booking): string {
  if (booking.scheduledStartTime) return booking.scheduledStartTime;
  const slot = booking.scheduledSlot || booking.requestedSlot;
  if (slot === "am") return "Morning";
  if (slot === "pm") return "Afternoon";
  if (slot === "full_day" || slot === "full") return "Full Day";
  return "";
}

function StatusBadge({ status }: { status: JobDisplayStatus }) {
  const configs: Record<JobDisplayStatus, { icon: typeof Clock; label: string; className: string }> = {
    payment_pending: {
      icon: CreditCard,
      label: "Awaiting Payment",
      className: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    },
    confirmed: {
      icon: CheckCircle2,
      label: "Confirmed",
      className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    },
    in_progress: {
      icon: Wrench,
      label: "In Progress",
      className: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    },
    completed_unpaid: {
      icon: Clock,
      label: "Payout Pending",
      className: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    },
    completed_paid: {
      icon: Banknote,
      label: "Paid",
      className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    },
  };

  const config = configs[status];
  const Icon = config.icon;

  return (
    <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full border ${config.className}`}>
      <Icon className="w-3 h-3" />
      <span className="text-[10px] font-bold uppercase">{config.label}</span>
    </div>
  );
}

function JobCard({ job, displayStatus }: { job: Booking; displayStatus: JobDisplayStatus }) {
  const [, setLocation] = useLocation();

  return (
    <button
      onClick={() => setLocation(`/contractor/dashboard/jobs/${job.id}`)}
      className="w-full text-left bg-slate-900 border border-slate-800 rounded-xl p-4 active:scale-[0.98] transition-all hover:border-slate-700 cursor-pointer"
    >
      <div className="flex justify-between items-start mb-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white text-sm truncate">{job.customerName}</p>
          {job.scheduledDate && (
            <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
              <Calendar className="w-3 h-3" />
              {format(new Date(job.scheduledDate), "EEE, MMM d")}
              {formatSlot(job) && (
                <span className="text-slate-600">· {formatSlot(job)}</span>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={displayStatus} />
          <ChevronRight className="w-4 h-4 text-slate-600" />
        </div>
      </div>

      {job.description && (
        <p className="text-xs text-slate-400 line-clamp-1 mb-3">{job.description}</p>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-slate-800">
        {(job.postcode || job.address) ? (
          <span className="text-[10px] text-slate-500 flex items-center gap-1 truncate">
            <MapPin className="w-3 h-3 shrink-0" />
            {job.postcode || job.address}
          </span>
        ) : (
          <span />
        )}
        {job.payoutPence != null && job.payoutPence > 0 ? (
          <span className="font-bold text-sm text-emerald-400 flex items-center gap-1">
            <PoundSterling className="w-3 h-3" />
            £{(job.payoutPence / 100).toFixed(2)}
          </span>
        ) : null}
      </div>
    </button>
  );
}

export default function MyJobsTab() {
  const token = localStorage.getItem("contractorToken")?.trim().replace(/[^a-zA-Z0-9._-]/g, "");

  const { data: bookings, isLoading } = useQuery<Booking[]>({
    queryKey: ["contractor-bookings"],
    queryFn: async () => {
      const res = await fetch("/api/contractor/bookings", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  // Filter out declined jobs
  const jobs = bookings?.filter(
    (b) => b.assignmentStatus !== "rejected" && b.status !== "declined"
  ) || [];

  // Categorise by display status
  const jobsWithStatus = jobs.map(j => ({ job: j, displayStatus: getDisplayStatus(j) }));

  const paymentPending = jobsWithStatus.filter(j => j.displayStatus === 'payment_pending');
  const confirmed = jobsWithStatus.filter(j => j.displayStatus === 'confirmed');
  const inProgress = jobsWithStatus.filter(j => j.displayStatus === 'in_progress');
  const completedUnpaid = jobsWithStatus.filter(j => j.displayStatus === 'completed_unpaid');
  const completedPaid = jobsWithStatus.filter(j => j.displayStatus === 'completed_paid');

  // Earnings calculations
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 }); // Monday
  const monthStart = startOfMonth(now);
  const lastWeekStart = subWeeks(weekStart, 1);

  const completedJobs = jobs.filter(j => j.assignmentStatus === 'completed');

  const thisWeekEarnings = completedJobs
    .filter(j => j.completedAt && new Date(j.completedAt) >= weekStart)
    .reduce((sum, j) => sum + (j.payoutPence || 0), 0);

  const lastWeekEarnings = completedJobs
    .filter(j => j.completedAt && new Date(j.completedAt) >= lastWeekStart && new Date(j.completedAt) < weekStart)
    .reduce((sum, j) => sum + (j.payoutPence || 0), 0);

  const thisMonthEarnings = completedJobs
    .filter(j => j.completedAt && new Date(j.completedAt) >= monthStart)
    .reduce((sum, j) => sum + (j.payoutPence || 0), 0);

  const pendingPayouts = completedJobs
    .filter(j => !j.payoutPaidAt && j.payoutStatus !== 'paid')
    .reduce((sum, j) => sum + (j.payoutPence || 0), 0);

  const activeCount = paymentPending.length + confirmed.length + inProgress.length;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
        <p className="text-sm text-slate-500 mt-3">Loading jobs...</p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-6 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold text-white">My Jobs</h1>
        {jobs.length > 0 && (
          <span className="text-xs text-slate-500">{activeCount} active</span>
        )}
      </div>

      {/* Earnings summary */}
      <div className="grid grid-cols-3 gap-2 mb-2">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
          <div className="text-[10px] text-slate-500 uppercase">This Week</div>
          <div className="text-lg font-bold text-emerald-400">
            £{(thisWeekEarnings / 100).toFixed(0)}
          </div>
          {lastWeekEarnings > 0 && (
            <div className="flex items-center justify-center gap-0.5 mt-0.5">
              <TrendingUp className={`w-3 h-3 ${thisWeekEarnings >= lastWeekEarnings ? 'text-emerald-500' : 'text-red-400'}`} />
              <span className={`text-[10px] ${thisWeekEarnings >= lastWeekEarnings ? 'text-emerald-500' : 'text-red-400'}`}>
                {lastWeekEarnings > 0 ? `${thisWeekEarnings >= lastWeekEarnings ? '+' : ''}${Math.round(((thisWeekEarnings - lastWeekEarnings) / lastWeekEarnings) * 100)}%` : ''}
              </span>
            </div>
          )}
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
          <div className="text-[10px] text-slate-500 uppercase">This Month</div>
          <div className="text-lg font-bold text-emerald-400">
            £{(thisMonthEarnings / 100).toFixed(0)}
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
          <div className="text-[10px] text-slate-500 uppercase">Pending</div>
          <div className="text-lg font-bold text-amber-400">
            £{(pendingPayouts / 100).toFixed(0)}
          </div>
        </div>
      </div>

      {/* Completed jobs count */}
      {completedJobs.length > 0 && (
        <p className="text-[10px] text-slate-600 text-center mb-4">
          {completedJobs.length} job{completedJobs.length !== 1 ? 's' : ''} completed
          {completedPaid.length > 0 && ` · ${completedPaid.length} paid out`}
        </p>
      )}

      {/* Payment Pending section */}
      {paymentPending.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-3">
            Awaiting Payment
          </h3>
          <div className="space-y-2">
            {paymentPending.map(({ job, displayStatus }) => (
              <JobCard key={job.id} job={job} displayStatus={displayStatus} />
            ))}
          </div>
        </div>
      )}

      {/* In Progress section */}
      {inProgress.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-blue-400 uppercase tracking-wider mb-3">
            In Progress
          </h3>
          <div className="space-y-2">
            {inProgress.map(({ job, displayStatus }) => (
              <JobCard key={job.id} job={job} displayStatus={displayStatus} />
            ))}
          </div>
        </div>
      )}

      {/* Confirmed / Upcoming section */}
      {confirmed.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-emerald-400 uppercase tracking-wider mb-3">
            Confirmed
          </h3>
          <div className="space-y-2">
            {confirmed.map(({ job, displayStatus }) => (
              <JobCard key={job.id} job={job} displayStatus={displayStatus} />
            ))}
          </div>
        </div>
      )}

      {/* Completed - Payout Pending section */}
      {completedUnpaid.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-amber-400 uppercase tracking-wider mb-3">
            Payout Pending
          </h3>
          <div className="space-y-2">
            {completedUnpaid.map(({ job, displayStatus }) => (
              <JobCard key={job.id} job={job} displayStatus={displayStatus} />
            ))}
          </div>
        </div>
      )}

      {/* Completed + Paid section */}
      {completedPaid.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Paid Out
          </h3>
          <div className="space-y-2">
            {completedPaid.map(({ job, displayStatus }) => (
              <JobCard key={job.id} job={job} displayStatus={displayStatus} />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {jobs.length === 0 && (
        <div className="text-center py-16">
          <Briefcase className="w-12 h-12 text-slate-700 mx-auto mb-4" />
          <p className="text-slate-400 text-sm">No jobs yet</p>
          <p className="text-slate-500 text-xs mt-1">
            Keep your calendar updated and jobs will appear here automatically
          </p>
        </div>
      )}
    </div>
  );
}
