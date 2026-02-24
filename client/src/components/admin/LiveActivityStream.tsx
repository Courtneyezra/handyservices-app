/**
 * Live Activity Stream Component
 *
 * Compact horizontal scrolling strip showing recent activity:
 * - Incoming/ended calls
 * - WhatsApp messages received
 * - Video requests sent/received
 *
 * Auto-updates via polling (future: WebSocket)
 */

import { useQuery } from "@tanstack/react-query";
import {
    Phone,
    PhoneOff,
    MessageSquare,
    Video,
    Camera,
    Loader2,
    ChevronLeft,
    ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState, useRef, useEffect } from "react";

// Activity types
type ActivityType =
    | "call_incoming"
    | "call_ended"
    | "whatsapp_received"
    | "video_requested"
    | "video_received";

interface ActivityItem {
    id: string;
    type: ActivityType;
    timestamp: string;
    customerName: string;
    customerPhone: string;
    summary: string;
    leadId?: string;
}

interface ActivityStreamData {
    activities: ActivityItem[];
    total: number;
}

// Activity type config
const ACTIVITY_CONFIG: Record<
    ActivityType,
    { icon: typeof Phone; color: string; bg: string; label: string }
> = {
    call_incoming: {
        icon: Phone,
        color: "text-green-600",
        bg: "bg-green-50 dark:bg-green-950",
        label: "Call",
    },
    call_ended: {
        icon: PhoneOff,
        color: "text-blue-600",
        bg: "bg-blue-50 dark:bg-blue-950",
        label: "Call Ended",
    },
    whatsapp_received: {
        icon: MessageSquare,
        color: "text-emerald-600",
        bg: "bg-emerald-50 dark:bg-emerald-950",
        label: "WhatsApp",
    },
    video_requested: {
        icon: Video,
        color: "text-purple-600",
        bg: "bg-purple-50 dark:bg-purple-950",
        label: "Video Req",
    },
    video_received: {
        icon: Camera,
        color: "text-indigo-600",
        bg: "bg-indigo-50 dark:bg-indigo-950",
        label: "Video Rcvd",
    },
};

// Format relative time
function formatRelativeTime(timestamp: string): string {
    const now = Date.now();
    const time = new Date(timestamp).getTime();
    const diffMs = now - time;

    const minutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(minutes / 60);

    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return new Date(timestamp).toLocaleDateString();
}

// Activity Chip Component
function ActivityChip({
    activity,
    onClick,
}: {
    activity: ActivityItem;
    onClick?: () => void;
}) {
    const config = ACTIVITY_CONFIG[activity.type];
    const Icon = config.icon;
    const firstName = activity.customerName.split(" ")[0];

    return (
        <button
            onClick={onClick}
            className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full",
                "border transition-all hover:shadow-md hover:scale-105",
                "cursor-pointer whitespace-nowrap flex-shrink-0",
                config.bg,
                "border-border hover:border-primary/50"
            )}
        >
            <Icon className={cn("h-3.5 w-3.5", config.color)} />
            <span className="text-xs font-medium">{firstName}</span>
            <span className="text-xs text-muted-foreground hidden sm:inline">
                {activity.summary.length > 20
                    ? activity.summary.substring(0, 20) + "..."
                    : activity.summary}
            </span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {formatRelativeTime(activity.timestamp)}
            </Badge>
        </button>
    );
}

// Main Component
export default function LiveActivityStream({
    onActivityClick,
    className,
}: {
    onActivityClick?: (activity: ActivityItem) => void;
    className?: string;
}) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);

    // Fetch activity stream
    const { data, isLoading, error } = useQuery<ActivityStreamData>({
        queryKey: ["activity-stream"],
        queryFn: async () => {
            const res = await fetch("/api/admin/activity-stream?limit=30");
            if (!res.ok) throw new Error("Failed to fetch activity stream");
            return res.json();
        },
        refetchInterval: 15000, // Refresh every 15 seconds
    });

    // Check scroll state
    const checkScroll = () => {
        if (!scrollRef.current) return;
        const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
        setCanScrollLeft(scrollLeft > 0);
        setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 10);
    };

    useEffect(() => {
        checkScroll();
        window.addEventListener("resize", checkScroll);
        return () => window.removeEventListener("resize", checkScroll);
    }, [data]);

    // Scroll handlers
    const scroll = (direction: "left" | "right") => {
        if (!scrollRef.current) return;
        const amount = 300;
        scrollRef.current.scrollBy({
            left: direction === "left" ? -amount : amount,
            behavior: "smooth",
        });
        setTimeout(checkScroll, 300);
    };

    if (error) {
        return null; // Silently fail - non-critical component
    }

    if (isLoading) {
        return (
            <div className={cn("flex items-center justify-center py-2", className)}>
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const activities = data?.activities || [];

    if (activities.length === 0) {
        return (
            <div className={cn("flex items-center justify-center py-2 text-xs text-muted-foreground", className)}>
                No recent activity
            </div>
        );
    }

    return (
        <div className={cn("relative flex items-center gap-2", className)}>
            {/* Label */}
            <div className="flex-shrink-0 text-xs font-medium text-muted-foreground px-2">
                Live
            </div>

            {/* Left scroll button */}
            {canScrollLeft && (
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 absolute left-8 z-10 bg-background/80 backdrop-blur-sm"
                    onClick={() => scroll("left")}
                >
                    <ChevronLeft className="h-4 w-4" />
                </Button>
            )}

            {/* Scrollable container */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-x-auto scrollbar-hide"
                onScroll={checkScroll}
            >
                <div className="flex items-center gap-2 py-1">
                    {activities.map((activity) => (
                        <ActivityChip
                            key={activity.id}
                            activity={activity}
                            onClick={() => onActivityClick?.(activity)}
                        />
                    ))}
                </div>
            </div>

            {/* Right scroll button */}
            {canScrollRight && (
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 absolute right-0 z-10 bg-background/80 backdrop-blur-sm"
                    onClick={() => scroll("right")}
                >
                    <ChevronRight className="h-4 w-4" />
                </Button>
            )}

            {/* Total count */}
            <Badge variant="secondary" className="flex-shrink-0 text-xs">
                {data?.total || 0}
            </Badge>
        </div>
    );
}

// Export types for parent components
export type { ActivityItem, ActivityType };
