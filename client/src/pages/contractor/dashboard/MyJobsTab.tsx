import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2, Briefcase, Clock, Wrench, CheckCircle2, Calendar } from "lucide-react";
import { formatDistanceToNow, startOfWeek, startOfMonth, isAfter } from "date-fns";

interface Quote {
  id: string;
  shortSlug: string;
  customerName: string;
  jobDescription: string;
  quoteMode: "hhh" | "simple" | "pick_and_mix";
  basePricePence: number | null;
  baseJobPricePence: number | null;
  essentialPrice: number | null;
  bookedAt: string | null;
  createdAt: string;
  status: string | null;
  jobStatus?: "pending" | "in_progress" | "completed" | null;
}

function getPriceDisplay(quote: Quote): string {
  if (quote.quoteMode === "hhh") {
    if (quote.essentialPrice) return `£${(quote.essentialPrice / 100).toFixed(0)}`;
    if (quote.baseJobPricePence) return `£${(quote.baseJobPricePence / 100).toFixed(0)}`;
  }
  if (quote.basePricePence) return `£${(quote.basePricePence / 100).toFixed(0)}`;
  return "TBD";
}

function getPricePence(quote: Quote): number {
  if (quote.quoteMode === "hhh") {
    if (quote.essentialPrice) return quote.essentialPrice;
    if (quote.baseJobPricePence) return quote.baseJobPricePence;
  }
  if (quote.basePricePence) return quote.basePricePence;
  return 0;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return (
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
          <CheckCircle2 className="w-3 h-3" />
          <span className="text-[10px] font-bold uppercase">Completed</span>
        </div>
      );
    case "in_progress":
      return (
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
          <Wrench className="w-3 h-3" />
          <span className="text-[10px] font-bold uppercase">In Progress</span>
        </div>
      );
    default:
      return (
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
          <Clock className="w-3 h-3" />
          <span className="text-[10px] font-bold uppercase">Upcoming</span>
        </div>
      );
  }
}

function JobCard({ job }: { job: Quote }) {
  const [, setLocation] = useLocation();

  return (
    <button
      onClick={() => setLocation(`/contractor/dashboard/jobs/${job.shortSlug || job.id}`)}
      className="w-full text-left bg-slate-900 border border-slate-800 rounded-xl p-4 active:scale-[0.98] transition-all hover:border-slate-700 cursor-pointer"
    >
      <div className="flex justify-between items-start mb-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white text-sm truncate">{job.customerName}</p>
          <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
            <Calendar className="w-3 h-3" />
            Booked {formatDistanceToNow(new Date(job.bookedAt!), { addSuffix: true })}
          </p>
        </div>
        <StatusBadge status={job.jobStatus || "pending"} />
      </div>

      <p className="text-xs text-slate-400 line-clamp-1 mb-3">{job.jobDescription}</p>

      <div className="flex items-center justify-between pt-2 border-t border-slate-800">
        <span className="text-[10px] text-slate-500 uppercase tracking-wider">
          {job.quoteMode === "hhh" ? "Magic Quote" : job.quoteMode === "pick_and_mix" ? "Pick & Mix" : "Standard"}
        </span>
        <span className="font-bold text-sm text-white">{getPriceDisplay(job)}</span>
      </div>
    </button>
  );
}

export default function MyJobsTab() {
  const token = localStorage.getItem("contractorToken")?.trim().replace(/[^a-zA-Z0-9._-]/g, "");

  const { data: quotes, isLoading } = useQuery<Quote[]>({
    queryKey: ["contractor-quotes"],
    queryFn: async () => {
      const res = await fetch("/api/contractor/quotes", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const jobs = quotes?.filter((q) => q.bookedAt) || [];

  const upcoming = jobs.filter(
    (j) => j.jobStatus !== "in_progress" && j.jobStatus !== "completed"
  );
  const inProgress = jobs.filter((j) => j.jobStatus === "in_progress");
  const completed = jobs.filter((j) => j.jobStatus === "completed");

  // Earnings calculations
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const monthStart = startOfMonth(now);

  const completedJobs = jobs.filter((j) => j.jobStatus === "completed");

  const thisWeekEarnings = completedJobs
    .filter((j) => j.bookedAt && isAfter(new Date(j.bookedAt), weekStart))
    .reduce((sum, j) => sum + getPricePence(j), 0);

  const thisMonthEarnings = completedJobs
    .filter((j) => j.bookedAt && isAfter(new Date(j.bookedAt), monthStart))
    .reduce((sum, j) => sum + getPricePence(j), 0);

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
      <h1 className="text-2xl font-bold text-white mb-2">My Jobs</h1>

      {/* Earnings summary */}
      <div className="flex gap-3 mb-6">
        <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
          <div className="text-xs text-slate-400">This Week</div>
          <div className="text-lg font-bold text-emerald-400">
            £{(thisWeekEarnings / 100).toFixed(0)}
          </div>
        </div>
        <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
          <div className="text-xs text-slate-400">This Month</div>
          <div className="text-lg font-bold text-emerald-400">
            £{(thisMonthEarnings / 100).toFixed(0)}
          </div>
        </div>
      </div>

      {/* In Progress section */}
      {inProgress.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
            In Progress
          </h3>
          <div className="space-y-2">
            {inProgress.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        </div>
      )}

      {/* Upcoming section */}
      {upcoming.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Upcoming
          </h3>
          <div className="space-y-2">
            {upcoming.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        </div>
      )}

      {/* Completed section */}
      {completed.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Completed
          </h3>
          <div className="space-y-2">
            {completed.map((job) => (
              <JobCard key={job.id} job={job} />
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
