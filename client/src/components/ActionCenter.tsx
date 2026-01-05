
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Phone, CheckCircle, AlertTriangle, Play, MessageSquare, Clock } from "lucide-react";
import { formatDistanceToNow } from 'date-fns';
import { ScrollArea } from "@/components/ui/scroll-area";
import { queryClient } from '@/lib/queryClient';
import { useToast } from "@/hooks/use-toast";

interface ActionItem {
    id: string;
    phoneNumber: string;
    startTime: string;
    outcome: string;
    actionStatus: 'pending' | 'attempting' | 'resolved' | 'dismissed';
    actionUrgency: number;
    missedReason?: string;
    tags?: string[];
    recordingUrl?: string;
    transcription?: string;
    jobSummary?: string;
    leadId?: string;
    customerName?: string;
}

export default function ActionCenter() {
    const { toast } = useToast();

    // Poll for action items every 30 seconds
    const { data: actions = [], isLoading } = useQuery<ActionItem[]>({
        queryKey: ['/api/calls/actions'],
        queryFn: async () => {
            const res = await fetch('/api/calls/actions');
            if (!res.ok) throw new Error("Failed to fetch actions");
            return res.json();
        },
        refetchInterval: 30000
    });

    const handleCallback = (phoneNumber: string) => {
        window.location.href = `tel:${phoneNumber}`;
    };

    const markResolved = async (id: string) => {
        try {
            const res = await fetch(`/api/calls/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actionStatus: 'resolved' })
            });
            if (!res.ok) throw new Error("Failed to update");

            queryClient.invalidateQueries({ queryKey: ['/api/calls/actions'] });
            toast({ title: "Marked as resolved", duration: 2000 });
        } catch (e) {
            toast({ title: "Failed to update", variant: "destructive" });
        }
    };

    const getUrgencyColor = (urgency: number) => {
        switch (urgency) {
            case 1: return "border-l-4 border-l-red-500 bg-red-50/10"; // Critical
            case 2: return "border-l-4 border-l-orange-500"; // High
            case 3: return "border-l-4 border-l-green-500"; // Normal
            default: return "border-l-4 border-l-slate-200";
        }
    };

    if (isLoading) return <div className="h-48 flex items-center justify-center">Loading Action Center...</div>;

    return (
        <Card className="col-span-1 md:col-span-2 lg:col-span-3 border-l-4 border-l-amber-500 bg-amber-500/5">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xl font-bold flex items-center gap-2 text-white">
                    <AlertTriangle className="h-5 w-5 text-amber-500 animate-pulse" />
                    Action Required
                    {actions.length > 0 && (
                        <Badge variant="destructive" className="ml-2 animate-bounce">
                            {actions.length} Pending
                        </Badge>
                    )}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <ScrollArea className="h-[300px] pr-4">
                    <div className="space-y-3">
                        {actions.length === 0 ? (
                            <div className="text-center py-10 text-slate-500">
                                <CheckCircle className="h-10 w-10 mx-auto mb-2 text-green-500/20" />
                                <p>All caught up! No urgent actions.</p>
                            </div>
                        ) : (
                            actions.map(action => (
                                <div key={action.id} className={`p-3 rounded-lg border bg-black/40 flex flex-col sm:flex-row justify-between gap-4 ${getUrgencyColor(action.actionUrgency)}`}>
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <h3 className="font-bold text-lg text-white">
                                                {action.customerName || action.phoneNumber}
                                            </h3>
                                            {action.outcome === 'MISSED_CALL' && <Badge variant="destructive" className="uppercase text-[10px]">Missed Call</Badge>}
                                            <span className="text-xs text-slate-400 flex items-center gap-1">
                                                <Clock className="h-3 w-3" />
                                                {formatDistanceToNow(new Date(action.startTime), { addSuffix: true })}
                                            </span>
                                        </div>
                                        <p className="text-sm text-slate-300 line-clamp-2">
                                            {action.jobSummary || action.transcription || (
                                                <span className="italic text-slate-500">No details available.</span>
                                            )}
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-2 min-w-[240px]">
                                        <Button className="flex-1 gap-2 bg-green-600 hover:bg-green-700 text-white font-bold" onClick={() => handleCallback(action.phoneNumber)}>
                                            <Phone className="h-4 w-4" /> Call Back
                                        </Button>
                                        <Button variant="secondary" className="gap-2" size="sm" onClick={() => markResolved(action.id)}>
                                            <CheckCircle className="h-4 w-4" /> Done
                                        </Button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    );
}
