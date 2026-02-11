import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus, LucideIcon } from "lucide-react";

export interface StatCardProps {
    title: string;
    value: string | number;
    icon: LucideIcon;
    trend?: {
        value: number;
        label?: string;
    };
    variant?: "default" | "success" | "warning" | "danger";
    isLoading?: boolean;
}

const variantStyles = {
    default: {
        icon: "text-primary",
        trendUp: "text-emerald-500",
        trendDown: "text-red-500",
    },
    success: {
        icon: "text-emerald-500",
        trendUp: "text-emerald-500",
        trendDown: "text-red-500",
    },
    warning: {
        icon: "text-amber-500",
        trendUp: "text-emerald-500",
        trendDown: "text-red-500",
    },
    danger: {
        icon: "text-red-500",
        trendUp: "text-emerald-500",
        trendDown: "text-red-500",
    },
};

export function StatCard({
    title,
    value,
    icon: Icon,
    trend,
    variant = "default",
    isLoading = false,
}: StatCardProps) {
    const styles = variantStyles[variant];

    const getTrendIcon = () => {
        if (!trend) return null;
        if (trend.value > 0) return TrendingUp;
        if (trend.value < 0) return TrendingDown;
        return Minus;
    };

    const getTrendColor = () => {
        if (!trend) return "";
        if (trend.value > 0) return styles.trendUp;
        if (trend.value < 0) return styles.trendDown;
        return "text-muted-foreground";
    };

    const TrendIcon = getTrendIcon();

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
        >
            <Card className="bg-card border-border shadow-sm backdrop-blur-sm hover:shadow-md transition-shadow">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                        {title}
                    </CardTitle>
                    <Icon className={cn("h-4 w-4", styles.icon)} />
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="space-y-2">
                            <div className="h-8 w-24 bg-muted animate-pulse rounded" />
                            <div className="h-4 w-16 bg-muted animate-pulse rounded" />
                        </div>
                    ) : (
                        <>
                            <div className="text-2xl font-bold text-foreground">
                                {value}
                            </div>
                            {trend && (
                                <div className="flex items-center gap-1 mt-1">
                                    {TrendIcon && (
                                        <TrendIcon
                                            className={cn("h-3 w-3", getTrendColor())}
                                        />
                                    )}
                                    <span
                                        className={cn(
                                            "text-xs font-medium",
                                            getTrendColor()
                                        )}
                                    >
                                        {trend.value > 0 ? "+" : ""}
                                        {trend.value}%
                                    </span>
                                    {trend.label && (
                                        <span className="text-xs text-muted-foreground">
                                            {trend.label}
                                        </span>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </CardContent>
            </Card>
        </motion.div>
    );
}

export default StatCard;
