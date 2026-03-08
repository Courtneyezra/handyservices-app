import { useQuery } from "@tanstack/react-query";
import { Phone, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface RecentCaller {
  id: string;
  customerName: string;
  phone: string;
  address: string;
  postcode: string;
  jobSummary: string;
  calledAt: string | null;
}

interface RecentCallersProps {
  onSelect: (caller: RecentCaller) => void;
  selectedId?: string | null;
}

export function RecentCallers({ onSelect, selectedId }: RecentCallersProps) {
  const { data: callers, isLoading } = useQuery<RecentCaller[]>({
    queryKey: ["recent-callers"],
    queryFn: async () => {
      const token = localStorage.getItem("adminToken");
      const res = await fetch("/api/calls/recent-callers", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    staleTime: 30000,
  });

  if (isLoading) {
    return (
      <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 w-36 shrink-0 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (!callers?.length) return null;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <Phone className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">Recent Callers</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
        {callers.map((caller) => {
          const isSelected = selectedId === caller.id;
          return (
            <button
              key={caller.id}
              type="button"
              onClick={() => onSelect(caller)}
              className={`shrink-0 text-left rounded-xl border px-3 py-2 transition-all ${
                isSelected
                  ? "border-green-500/50 bg-green-500/10 ring-2 ring-green-500/20"
                  : "border-border bg-card hover:border-muted-foreground/30 hover:bg-muted"
              }`}
            >
              <div className="text-sm font-semibold text-foreground truncate max-w-[140px]">
                {caller.customerName}
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                <Clock className="w-3 h-3" />
                {caller.calledAt
                  ? formatDistanceToNow(new Date(caller.calledAt), { addSuffix: true })
                  : "Unknown"}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
