import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import {
    Activity,
    Phone,
    FileText,
    CreditCard,
    CheckCircle2,
    User,
    ArrowRight,
    Loader2,
} from "lucide-react";

export type ActivityType =
    | "new_lead"
    | "quote_sent"
    | "payment_received"
    | "job_completed"
    | "call_received"
    | "booking_confirmed";

export interface ActivityItem {
    id: string;
    type: ActivityType;
    title: string;
    description: string;
    timestamp: Date;
    metadata?: {
        amount?: number;
        customerName?: string;
        quoteId?: string;
        jobId?: string;
        leadId?: string;
        callId?: string;
    };
}

export interface RecentActivityFeedProps {
    activities: ActivityItem[];
    isLoading?: boolean;
    maxItems?: number;
}

const activityConfig: Record<
    ActivityType,
    {
        icon: React.ElementType;
        color: string;
        bgColor: string;
        label: string;
    }
> = {
    new_lead: {
        icon: User,
        color: "text-blue-500",
        bgColor: "bg-blue-500/10",
        label: "New Lead",
    },
    quote_sent: {
        icon: FileText,
        color: "text-amber-500",
        bgColor: "bg-amber-500/10",
        label: "Quote Sent",
    },
    payment_received: {
        icon: CreditCard,
        color: "text-emerald-500",
        bgColor: "bg-emerald-500/10",
        label: "Payment",
    },
    job_completed: {
        icon: CheckCircle2,
        color: "text-green-500",
        bgColor: "bg-green-500/10",
        label: "Completed",
    },
    call_received: {
        icon: Phone,
        color: "text-purple-500",
        bgColor: "bg-purple-500/10",
        label: "Call",
    },
    booking_confirmed: {
        icon: CheckCircle2,
        color: "text-cyan-500",
        bgColor: "bg-cyan-500/10",
        label: "Booked",
    },
};

export function RecentActivityFeed({
    activities,
    isLoading = false,
    maxItems = 10,
}: RecentActivityFeedProps) {
    const [, setLocation] = useLocation();

    const handleActivityClick = (activity: ActivityItem) => {
        const { metadata, type } = activity;
        if (!metadata) return;

        switch (type) {
            case "quote_sent":
            case "booking_confirmed":
                if (metadata.quoteId) {
                    setLocation(`/admin/quotes?id=${metadata.quoteId}`);
                }
                break;
            case "payment_received":
            case "job_completed":
                if (metadata.jobId) {
                    setLocation(`/admin/dispatch?id=${metadata.jobId}`);
                }
                break;
            case "new_lead":
                if (metadata.leadId) {
                    setLocation(`/admin/leads?id=${metadata.leadId}`);
                }
                break;
            case "call_received":
                if (metadata.callId) {
                    setLocation(`/admin/calls?id=${metadata.callId}`);
                }
                break;
        }
    };

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat("en-GB", {
            style: "currency",
            currency: "GBP",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(value);
    };

    const displayedActivities = activities.slice(0, maxItems);

    return (
        <Card className="bg-card border-border shadow-sm backdrop-blur-sm h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-secondary flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    Recent Activity
                </CardTitle>
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setLocation("/admin/calls")}
                >
                    View All
                    <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
            </CardHeader>
            <CardContent className="p-0">
                {isLoading ? (
                    <div className="flex items-center justify-center h-64">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : activities.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-muted-foreground px-4">
                        <Activity className="h-8 w-8 mb-2 opacity-50" />
                        <p className="text-sm">No recent activity</p>
                    </div>
                ) : (
                    <ScrollArea className="h-[400px]">
                        <div className="space-y-0">
                            {displayedActivities.map((activity, index) => {
                                const config = activityConfig[activity.type];
                                const Icon = config.icon;

                                return (
                                    <motion.div
                                        key={activity.id}
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: index * 0.05 }}
                                        className={cn(
                                            "flex items-start gap-3 px-6 py-4 hover:bg-muted/50 cursor-pointer transition-colors",
                                            index !== displayedActivities.length - 1 &&
                                                "border-b border-border"
                                        )}
                                        onClick={() => handleActivityClick(activity)}
                                    >
                                        <div
                                            className={cn(
                                                "p-2 rounded-lg shrink-0",
                                                config.bgColor
                                            )}
                                        >
                                            <Icon
                                                className={cn("h-4 w-4", config.color)}
                                            />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="font-medium text-sm truncate">
                                                    {activity.title}
                                                </span>
                                                <Badge
                                                    variant="secondary"
                                                    className={cn(
                                                        "text-xs shrink-0",
                                                        config.bgColor,
                                                        config.color
                                                    )}
                                                >
                                                    {config.label}
                                                </Badge>
                                            </div>
                                            <p className="text-xs text-muted-foreground line-clamp-2">
                                                {activity.description}
                                            </p>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-xs text-muted-foreground">
                                                    {formatDistanceToNow(
                                                        activity.timestamp,
                                                        { addSuffix: true }
                                                    )}
                                                </span>
                                                {activity.metadata?.amount && (
                                                    <Badge
                                                        variant="outline"
                                                        className="text-xs"
                                                    >
                                                        {formatCurrency(
                                                            activity.metadata.amount
                                                        )}
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </div>
                    </ScrollArea>
                )}
            </CardContent>
        </Card>
    );
}

export default RecentActivityFeed;
