import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Users, PhoneCall, PoundSterling, Loader2, ArrowRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import ActionCenter from "@/components/ActionCenter";
import { CallListTable, CallSummary } from "@/components/calls/CallListTable";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

export default function MainDashboard() {
    const [, setLocation] = useLocation();

    // 1. Fetch Stats
    const { data: stats, isLoading: statsLoading } = useQuery({
        queryKey: ['dashboard-stats'],
        queryFn: async () => {
            const res = await fetch('/api/dashboard/stats');
            if (!res.ok) throw new Error('Failed to fetch stats');
            return res.json();
        },
        refetchInterval: 5000 // Poll every 5s for "live" feel
    });

    // 2. Fetch Recent Activity (Limit 5)
    const { data: recentCallsData, isLoading: recentCallsLoading } = useQuery({
        queryKey: ['recent-calls-dashboard'],
        queryFn: async () => {
            const res = await fetch('/api/calls?limit=5');
            if (!res.ok) throw new Error('Failed to fetch recent calls');
            return res.json() as Promise<{ calls: CallSummary[], pagination: any }>;
        },
        refetchInterval: 10000
    });

    if (statsLoading) {
        return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-gray-400" /></div>;
    }

    // Default fallbacks
    const safeStats = stats || { leadsToday: 0, activeCalls: 0, pendingQuotes: 0, revenueWtd: 0 };

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight text-white">Dashboard</h1>

            {/* Stats Grid */}
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                <Card className="bg-black/40 border-gray-700 backdrop-blur-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-gray-300">Leads Today</CardTitle>
                        <Users className="h-4 w-4 text-handy-gold" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">{safeStats.leadsToday}</div>
                        <p className="text-xs text-gray-400">Total leads in database</p>
                    </CardContent>
                </Card>
                <Card className="bg-black/40 border-gray-700 backdrop-blur-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-gray-300">Active Calls</CardTitle>
                        <PhoneCall className="h-4 w-4 text-handy-gold" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">{safeStats.activeCalls}</div>
                        <p className="text-xs text-gray-400">Currently live</p>
                    </CardContent>
                </Card>
                <Card className="bg-black/40 border-gray-700 backdrop-blur-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-gray-300">Pending Quotes</CardTitle>
                        <Activity className="h-4 w-4 text-handy-gold" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">{safeStats.pendingQuotes}</div>
                        <p className="text-xs text-gray-400">Requires attention</p>
                    </CardContent>
                </Card>
                <Card className="bg-black/40 border-gray-700 backdrop-blur-sm">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-gray-300">Revenue (WTD)</CardTitle>
                        <PoundSterling className="h-4 w-4 text-handy-gold" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">£{safeStats.revenueWtd}</div>
                        <p className="text-xs text-gray-400">+12% from last week</p>
                    </CardContent>
                </Card>
            </div>

            {/* Action Center - Full Width of Main Column */}
            <ActionCenter />

            {/* Recent Activity Grid */}
            <div className="grid gap-4 grid-cols-1 lg:grid-cols-7">
                <Card className="col-span-1 lg:col-span-7 bg-black/40 border-gray-700 backdrop-blur-sm">
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="text-white">Recent Activity</CardTitle>
                        <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white gap-1" onClick={() => setLocation('/calls')}>
                            View All <ArrowRight className="h-4 w-4" />
                        </Button>
                    </CardHeader>
                    <CardContent className="p-0 sm:p-6 pt-0">
                        <CallListTable
                            calls={recentCallsData?.calls || []}
                            isLoading={recentCallsLoading}
                            onCallClick={(id) => setLocation(`/calls?id=${id}`)} // Or open modal? For dash, redirect to calls page is safer/simpler for now
                        />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
