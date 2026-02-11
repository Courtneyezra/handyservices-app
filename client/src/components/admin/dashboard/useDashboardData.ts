import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ContractorStats } from "./ContractorLeaderboard";
import type { RevenueDataPoint } from "./RevenueChart";
import type { ActivityItem, ActivityType } from "./RecentActivityFeed";

// ============================================================================
// Types
// ============================================================================

export interface DashboardStats {
    totalRevenue: number;
    revenueTrend: number;
    activeJobs: number;
    activeJobsTrend: number;
    pendingQuotes: number;
    pendingQuotesTrend: number;
    conversionRate: number;
    conversionRateTrend: number;
}

export interface DashboardData {
    stats: DashboardStats;
    revenueData: RevenueDataPoint[];
    contractors: ContractorStats[];
    activities: ActivityItem[];
}

// ============================================================================
// Mock Data Generator (for development before API is ready)
// ============================================================================

function generateMockStats(): DashboardStats {
    return {
        totalRevenue: 24680,
        revenueTrend: 12.5,
        activeJobs: 18,
        activeJobsTrend: 8,
        pendingQuotes: 23,
        pendingQuotesTrend: -5,
        conversionRate: 34.2,
        conversionRateTrend: 3.1,
    };
}

function generateMockRevenueData(period: "daily" | "weekly" | "monthly"): RevenueDataPoint[] {
    const segments = ["HOMEOWNER", "PROP_MGR", "LANDLORD", "BUSINESS"];

    if (period === "daily") {
        // Last 7 days
        return Array.from({ length: 7 }, (_, i) => {
            const date = new Date();
            date.setDate(date.getDate() - (6 - i));
            return {
                label: date.toLocaleDateString("en-GB", { weekday: "short" }),
                value: Math.floor(Math.random() * 3000) + 500,
                segment: segments[Math.floor(Math.random() * segments.length)],
            };
        });
    }

    if (period === "weekly") {
        // Last 4 weeks
        return Array.from({ length: 4 }, (_, i) => ({
            label: `Week ${i + 1}`,
            value: Math.floor(Math.random() * 8000) + 2000,
            segment: segments[Math.floor(Math.random() * segments.length)],
        }));
    }

    // Monthly - last 6 months
    return Array.from({ length: 6 }, (_, i) => {
        const date = new Date();
        date.setMonth(date.getMonth() - (5 - i));
        return {
            label: date.toLocaleDateString("en-GB", { month: "short" }),
            value: Math.floor(Math.random() * 20000) + 5000,
            segment: segments[Math.floor(Math.random() * segments.length)],
        };
    });
}

function generateMockContractors(): ContractorStats[] {
    const names = [
        "Richard M.",
        "James T.",
        "Michael B.",
        "David S.",
        "Andrew K.",
        "Peter L.",
        "Chris R.",
        "John H.",
    ];

    return names.map((name, index) => ({
        id: index + 1,
        name,
        jobsCompleted: Math.floor(Math.random() * 50) + 10,
        revenue: Math.floor(Math.random() * 15000) + 3000,
        avgRating: 4 + Math.random(),
        ratingCount: Math.floor(Math.random() * 30) + 5,
    })).sort((a, b) => b.revenue - a.revenue);
}

function generateMockActivities(): ActivityItem[] {
    const types: ActivityType[] = [
        "new_lead",
        "quote_sent",
        "payment_received",
        "job_completed",
        "call_received",
        "booking_confirmed",
    ];

    const customers = [
        "Sarah Johnson",
        "Mike Peters",
        "Emma Thompson",
        "David Wilson",
        "Lisa Brown",
        "James Smith",
        "Anna Davis",
        "Tom Harris",
    ];

    const descriptions: Record<ActivityType, string[]> = {
        new_lead: [
            "New enquiry for kitchen tap repair",
            "Lead from Google Ads - bathroom installation",
            "Referral from existing customer",
        ],
        quote_sent: [
            "Quote for bathroom renovation sent",
            "Kitchen fitting quote delivered",
            "Handyman day rate quote sent",
        ],
        payment_received: [
            "Full payment received for job",
            "Deposit payment received",
            "Final invoice payment cleared",
        ],
        job_completed: [
            "Boiler service completed successfully",
            "Kitchen installation finished",
            "Emergency plumbing repair done",
        ],
        call_received: [
            "Incoming call - new enquiry",
            "Customer callback about quote",
            "Follow-up call with property manager",
        ],
        booking_confirmed: [
            "Appointment confirmed for next week",
            "Emergency callout scheduled",
            "Recurring service booking confirmed",
        ],
    };

    return Array.from({ length: 12 }, (_, i) => {
        const type = types[Math.floor(Math.random() * types.length)];
        const customer = customers[Math.floor(Math.random() * customers.length)];
        const desc = descriptions[type][Math.floor(Math.random() * descriptions[type].length)];

        const timestamp = new Date();
        timestamp.setMinutes(timestamp.getMinutes() - i * 30 - Math.floor(Math.random() * 60));

        return {
            id: `activity-${i + 1}`,
            type,
            title: customer,
            description: desc,
            timestamp,
            metadata: {
                amount: type === "payment_received" ? Math.floor(Math.random() * 500) + 100 : undefined,
                customerName: customer,
                quoteId: type === "quote_sent" || type === "booking_confirmed" ? `QT-${1000 + i}` : undefined,
                jobId: type === "job_completed" || type === "payment_received" ? `JB-${2000 + i}` : undefined,
                leadId: type === "new_lead" ? `LD-${3000 + i}` : undefined,
                callId: type === "call_received" ? `CL-${4000 + i}` : undefined,
            },
        };
    });
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook for fetching dashboard statistics
 * Uses mock data if API endpoint is not available
 */
export function useDashboardStats() {
    return useQuery({
        queryKey: ["admin", "dashboard", "stats"],
        queryFn: async (): Promise<DashboardStats> => {
            try {
                const res = await fetch("/api/admin/dashboard/stats");
                if (!res.ok) {
                    // Fallback to mock data if API not ready
                    console.warn("[Dashboard] Stats API not available, using mock data");
                    return generateMockStats();
                }
                return res.json();
            } catch {
                // Network error - use mock data
                console.warn("[Dashboard] Stats API error, using mock data");
                return generateMockStats();
            }
        },
        refetchInterval: 30000, // Refresh every 30 seconds
        staleTime: 10000,
    });
}

/**
 * Hook for fetching revenue chart data
 * Supports period switching between daily/weekly/monthly
 */
export function useRevenueData() {
    const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("weekly");

    const query = useQuery({
        queryKey: ["admin", "dashboard", "revenue", period],
        queryFn: async (): Promise<RevenueDataPoint[]> => {
            try {
                const res = await fetch(`/api/admin/dashboard/revenue?period=${period}`);
                if (!res.ok) {
                    console.warn("[Dashboard] Revenue API not available, using mock data");
                    return generateMockRevenueData(period);
                }
                return res.json();
            } catch {
                console.warn("[Dashboard] Revenue API error, using mock data");
                return generateMockRevenueData(period);
            }
        },
        staleTime: 60000,
    });

    return {
        ...query,
        period,
        setPeriod,
    };
}

/**
 * Hook for fetching contractor leaderboard data
 */
export function useContractorLeaderboard() {
    return useQuery({
        queryKey: ["admin", "dashboard", "contractors"],
        queryFn: async (): Promise<ContractorStats[]> => {
            try {
                const res = await fetch("/api/admin/dashboard/contractors");
                if (!res.ok) {
                    console.warn("[Dashboard] Contractors API not available, using mock data");
                    return generateMockContractors();
                }
                return res.json();
            } catch {
                console.warn("[Dashboard] Contractors API error, using mock data");
                return generateMockContractors();
            }
        },
        staleTime: 60000,
    });
}

/**
 * Hook for fetching recent activity feed
 */
export function useRecentActivity() {
    return useQuery({
        queryKey: ["admin", "dashboard", "activity"],
        queryFn: async (): Promise<ActivityItem[]> => {
            try {
                const res = await fetch("/api/admin/dashboard/activity");
                if (!res.ok) {
                    console.warn("[Dashboard] Activity API not available, using mock data");
                    return generateMockActivities();
                }
                const data = await res.json();
                // Parse timestamps from API response
                return data.map((item: ActivityItem) => ({
                    ...item,
                    timestamp: new Date(item.timestamp),
                }));
            } catch {
                console.warn("[Dashboard] Activity API error, using mock data");
                return generateMockActivities();
            }
        },
        refetchInterval: 15000, // Refresh every 15 seconds
        staleTime: 5000,
    });
}

/**
 * Combined hook for all dashboard data
 * Useful when you need everything at once
 */
export function useDashboardData() {
    const stats = useDashboardStats();
    const revenue = useRevenueData();
    const contractors = useContractorLeaderboard();
    const activity = useRecentActivity();

    const isLoading = useMemo(
        () => stats.isLoading || revenue.isLoading || contractors.isLoading || activity.isLoading,
        [stats.isLoading, revenue.isLoading, contractors.isLoading, activity.isLoading]
    );

    const isError = useMemo(
        () => stats.isError || revenue.isError || contractors.isError || activity.isError,
        [stats.isError, revenue.isError, contractors.isError, activity.isError]
    );

    return {
        stats,
        revenue,
        contractors,
        activity,
        isLoading,
        isError,
    };
}

export default useDashboardData;
