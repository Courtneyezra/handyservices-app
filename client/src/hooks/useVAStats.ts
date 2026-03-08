import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

export type TimePeriod = "today" | "week" | "month" | "all";

export interface SegmentBreakdown {
  segment: string;
  sent: number;
  accepted: number;
  conversionRate: number;
}

export interface RecentQuote {
  id: string;
  shortSlug: string;
  customerName: string;
  segment: string;
  status: "sent" | "viewed" | "accepted" | "booked" | "rejected" | "expired";
  basePrice: number | null;
  essentialPrice: number | null;
  createdAt: string;
}

export interface VAStats {
  callsHandled: number;
  quotesSent: number;
  quotesAccepted: number;
  conversionRate: number;
  segmentBreakdown: SegmentBreakdown[];
  recentQuotes: RecentQuote[];
}

export function useVAStats() {
  const [period, setPeriod] = useState<TimePeriod>("week");

  const query = useQuery<VAStats>({
    queryKey: ["va", "stats", period],
    queryFn: async () => {
      const token = localStorage.getItem("adminToken");
      const res = await fetch(`/api/va/stats?period=${period}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Failed to fetch VA stats");
      return res.json();
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });

  return { ...query, period, setPeriod };
}
