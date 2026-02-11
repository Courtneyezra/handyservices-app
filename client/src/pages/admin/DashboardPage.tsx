import { motion } from "framer-motion";
import {
    PoundSterling,
    Briefcase,
    FileText,
    TrendingUp,
} from "lucide-react";
import {
    StatCard,
    RevenueChart,
    ContractorLeaderboard,
    QuickActions,
    RecentActivityFeed,
    useDashboardStats,
    useRevenueData,
    useContractorLeaderboard,
    useRecentActivity,
} from "@/components/admin/dashboard";

export default function DashboardPage() {
    // Fetch all dashboard data
    const { data: stats, isLoading: statsLoading } = useDashboardStats();
    const {
        data: revenueData,
        isLoading: revenueLoading,
        period,
        setPeriod,
    } = useRevenueData();
    const { data: contractors, isLoading: contractorsLoading } =
        useContractorLeaderboard();
    const { data: activities, isLoading: activitiesLoading } =
        useRecentActivity();

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat("en-GB", {
            style: "currency",
            currency: "GBP",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(value);
    };

    return (
        <div className="space-y-6 pb-8">
            {/* Header */}
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
            >
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-secondary">
                        Dashboard
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Overview of your handyman operations
                    </p>
                </div>
            </motion.div>

            {/* Stats Cards */}
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                    title="Total Revenue"
                    value={formatCurrency(stats?.totalRevenue ?? 0)}
                    icon={PoundSterling}
                    trend={
                        stats?.revenueTrend !== undefined
                            ? { value: stats.revenueTrend, label: "vs last period" }
                            : undefined
                    }
                    variant="success"
                    isLoading={statsLoading}
                />
                <StatCard
                    title="Active Jobs"
                    value={stats?.activeJobs ?? 0}
                    icon={Briefcase}
                    trend={
                        stats?.activeJobsTrend !== undefined
                            ? { value: stats.activeJobsTrend, label: "vs last week" }
                            : undefined
                    }
                    variant="default"
                    isLoading={statsLoading}
                />
                <StatCard
                    title="Pending Quotes"
                    value={stats?.pendingQuotes ?? 0}
                    icon={FileText}
                    trend={
                        stats?.pendingQuotesTrend !== undefined
                            ? { value: stats.pendingQuotesTrend, label: "vs last week" }
                            : undefined
                    }
                    variant="warning"
                    isLoading={statsLoading}
                />
                <StatCard
                    title="Conversion Rate"
                    value={`${(stats?.conversionRate ?? 0).toFixed(1)}%`}
                    icon={TrendingUp}
                    trend={
                        stats?.conversionRateTrend !== undefined
                            ? { value: stats.conversionRateTrend, label: "vs last month" }
                            : undefined
                    }
                    variant="default"
                    isLoading={statsLoading}
                />
            </div>

            {/* Quick Actions */}
            <QuickActions />

            {/* Main Content Grid */}
            <div className="grid gap-6 grid-cols-1 xl:grid-cols-3">
                {/* Revenue Chart - Takes 2 columns on XL screens */}
                <div className="xl:col-span-2">
                    <RevenueChart
                        data={revenueData ?? []}
                        isLoading={revenueLoading}
                        currentPeriod={period}
                        onPeriodChange={setPeriod}
                    />
                </div>

                {/* Recent Activity - Takes 1 column */}
                <div className="xl:col-span-1">
                    <RecentActivityFeed
                        activities={activities ?? []}
                        isLoading={activitiesLoading}
                        maxItems={10}
                    />
                </div>
            </div>

            {/* Contractor Leaderboard - Full Width */}
            <ContractorLeaderboard
                contractors={contractors ?? []}
                isLoading={contractorsLoading}
            />
        </div>
    );
}
