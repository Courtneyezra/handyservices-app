
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Users, PhoneCall, PoundSterling, AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export default function MainDashboard() {
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

    // 2. Fetch Actions
    const { data: actionItems, isLoading: actionsLoading } = useQuery({
        queryKey: ['dashboard-actions'],
        queryFn: async () => {
            const res = await fetch('/api/dashboard/actions');
            if (!res.ok) throw new Error('Failed to fetch actions');
            return res.json();
        },
        refetchInterval: 10000
    });

    if (statsLoading || actionsLoading) {
        return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-gray-400" /></div>;
    }

    // Default fallbacks
    const safeStats = stats || { leadsToday: 0, activeCalls: 0, pendingQuotes: 0, revenueWtd: 0 };
    const safeActions = actionItems || [];

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

            {/* Action Feed */}
            <div className="grid gap-4 grid-cols-1 lg:grid-cols-7">
                <Card className="col-span-1 lg:col-span-4 bg-black/40 border-gray-700 backdrop-blur-sm">
                    <CardHeader>
                        <CardTitle className="text-white">Action Required</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {safeActions.length === 0 ? (
                                <p className="text-sm text-gray-400 italic">No urgent actions required.</p>
                            ) : (
                                safeActions.map((item: any) => (
                                    <div key={item.id} className="flex items-center justify-between p-4 border border-gray-700 rounded-lg hover:bg-white/5 transition-colors cursor-pointer">
                                        <div className="flex items-center gap-4">
                                            <div className={`p-2 rounded-full ${item.type === 'Urgent' ? 'bg-red-500/20 text-red-400' : 'bg-handy-gold/20 text-handy-gold'}`}>
                                                <AlertCircle className="w-4 h-4" />
                                            </div>
                                            <div>
                                                <p className="font-medium text-sm text-white">{item.message}</p>
                                                <p className="text-xs text-gray-400">{item.time}</p>
                                            </div>
                                        </div>
                                        <ArrowRight className="w-4 h-4 text-gray-500" />
                                    </div>
                                ))
                            )}
                        </div>
                    </CardContent>
                </Card>
                <Card className="col-span-1 lg:col-span-3 bg-black/40 border-gray-700 backdrop-blur-sm">
                    <CardHeader>
                        <CardTitle className="text-white">Recent Activity</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-gray-400">No recent activity recorded.</p>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
