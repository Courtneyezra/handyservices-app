
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
        return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-slate-300" /></div>;
    }

    // Default fallbacks
    const safeStats = stats || { leadsToday: 0, activeCalls: 0, pendingQuotes: 0, revenueWtd: 0 };
    const safeActions = actionItems || [];

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Dashboard</h1>

            {/* Stats Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Leads Today</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{safeStats.leadsToday}</div>
                        <p className="text-xs text-muted-foreground">Total leads in database</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Active Calls</CardTitle>
                        <PhoneCall className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{safeStats.activeCalls}</div>
                        <p className="text-xs text-muted-foreground">Currently live</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Pending Quotes</CardTitle>
                        <Activity className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{safeStats.pendingQuotes}</div>
                        <p className="text-xs text-muted-foreground">Requires attention</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Revenue (WTD)</CardTitle>
                        <PoundSterling className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">£{safeStats.revenueWtd}</div>
                        <p className="text-xs text-muted-foreground">+12% from last week</p>
                    </CardContent>
                </Card>
            </div>

            {/* Action Feed */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Card className="col-span-4">
                    <CardHeader>
                        <CardTitle>Action Required</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {safeActions.length === 0 ? (
                                <p className="text-sm text-muted-foreground italic">No urgent actions required.</p>
                            ) : (
                                safeActions.map((item: any) => (
                                    <div key={item.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-slate-50 transition-colors cursor-pointer">
                                        <div className="flex items-center gap-4">
                                            <div className={`p-2 rounded-full ${item.type === 'Urgent' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                                                <AlertCircle className="w-4 h-4" />
                                            </div>
                                            <div>
                                                <p className="font-medium text-sm">{item.message}</p>
                                                <p className="text-xs text-muted-foreground">{item.time}</p>
                                            </div>
                                        </div>
                                        <ArrowRight className="w-4 h-4 text-slate-400" />
                                    </div>
                                ))
                            )}
                        </div>
                    </CardContent>
                </Card>
                <Card className="col-span-3">
                    <CardHeader>
                        <CardTitle>Recent Activity</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground">No recent activity recorded.</p>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
