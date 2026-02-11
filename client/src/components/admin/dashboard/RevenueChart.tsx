import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { useState, useMemo } from "react";
import { Loader2 } from "lucide-react";

export interface RevenueDataPoint {
    label: string;
    value: number;
    segment?: string;
}

export interface RevenueChartProps {
    data: RevenueDataPoint[];
    isLoading?: boolean;
    onPeriodChange?: (period: "daily" | "weekly" | "monthly") => void;
    currentPeriod?: "daily" | "weekly" | "monthly";
}

const SEGMENT_COLORS: Record<string, string> = {
    HOMEOWNER: "#22c55e", // green
    PROP_MGR: "#3b82f6", // blue
    LANDLORD: "#f59e0b", // amber
    BUSINESS: "#8b5cf6", // purple
    DEFAULT: "#e8b323", // brand yellow
};

export function RevenueChart({
    data,
    isLoading = false,
    onPeriodChange,
    currentPeriod = "weekly",
}: RevenueChartProps) {
    const [hoveredBar, setHoveredBar] = useState<number | null>(null);

    const { maxValue, chartData } = useMemo(() => {
        const max = Math.max(...data.map((d) => d.value), 1);
        return {
            maxValue: max,
            chartData: data.map((d) => ({
                ...d,
                heightPercent: (d.value / max) * 100,
                color: SEGMENT_COLORS[d.segment || "DEFAULT"] || SEGMENT_COLORS.DEFAULT,
            })),
        };
    }, [data]);

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat("en-GB", {
            style: "currency",
            currency: "GBP",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(value);
    };

    const totalRevenue = useMemo(() => {
        return data.reduce((sum, d) => sum + d.value, 0);
    }, [data]);

    return (
        <Card className="bg-card border-border shadow-sm backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                    <CardTitle className="text-secondary">Revenue</CardTitle>
                    <p className="text-2xl font-bold mt-1">
                        {formatCurrency(totalRevenue)}
                    </p>
                </div>
                <div className="flex gap-1">
                    {(["daily", "weekly", "monthly"] as const).map((period) => (
                        <Button
                            key={period}
                            variant={currentPeriod === period ? "default" : "ghost"}
                            size="sm"
                            onClick={() => onPeriodChange?.(period)}
                            className="text-xs capitalize"
                        >
                            {period}
                        </Button>
                    ))}
                </div>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="flex items-center justify-center h-64">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <div className="relative h-64">
                        {/* Y-axis labels */}
                        <div className="absolute left-0 top-0 bottom-8 w-12 flex flex-col justify-between text-xs text-muted-foreground">
                            <span>{formatCurrency(maxValue)}</span>
                            <span>{formatCurrency(maxValue * 0.75)}</span>
                            <span>{formatCurrency(maxValue * 0.5)}</span>
                            <span>{formatCurrency(maxValue * 0.25)}</span>
                            <span>{formatCurrency(0)}</span>
                        </div>

                        {/* Chart area */}
                        <div className="ml-14 h-full flex flex-col">
                            {/* Grid lines */}
                            <div className="relative flex-1">
                                {[0, 25, 50, 75, 100].map((percent) => (
                                    <div
                                        key={percent}
                                        className="absolute w-full border-t border-border/50"
                                        style={{ top: `${100 - percent}%` }}
                                    />
                                ))}

                                {/* Bars */}
                                <div className="absolute inset-0 flex items-end gap-1 pb-1">
                                    {chartData.map((point, index) => (
                                        <motion.div
                                            key={index}
                                            className="flex-1 relative group"
                                            initial={{ height: 0 }}
                                            animate={{ height: `${point.heightPercent}%` }}
                                            transition={{
                                                duration: 0.5,
                                                delay: index * 0.05,
                                            }}
                                            onMouseEnter={() => setHoveredBar(index)}
                                            onMouseLeave={() => setHoveredBar(null)}
                                        >
                                            <div
                                                className={cn(
                                                    "w-full h-full rounded-t-sm transition-opacity",
                                                    hoveredBar !== null &&
                                                        hoveredBar !== index
                                                        ? "opacity-50"
                                                        : "opacity-100"
                                                )}
                                                style={{ backgroundColor: point.color }}
                                            />

                                            {/* Tooltip */}
                                            {hoveredBar === index && (
                                                <motion.div
                                                    initial={{ opacity: 0, y: 10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-10"
                                                >
                                                    <div className="bg-popover border border-border rounded-md px-2 py-1 shadow-lg whitespace-nowrap">
                                                        <p className="text-xs font-medium">
                                                            {formatCurrency(point.value)}
                                                        </p>
                                                        {point.segment && (
                                                            <p className="text-xs text-muted-foreground">
                                                                {point.segment}
                                                            </p>
                                                        )}
                                                    </div>
                                                </motion.div>
                                            )}
                                        </motion.div>
                                    ))}
                                </div>
                            </div>

                            {/* X-axis labels */}
                            <div className="flex gap-1 h-8 pt-2">
                                {chartData.map((point, index) => (
                                    <div
                                        key={index}
                                        className="flex-1 text-center text-xs text-muted-foreground truncate"
                                    >
                                        {point.label}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Legend */}
                {!isLoading && data.some((d) => d.segment) && (
                    <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-border">
                        {Object.entries(SEGMENT_COLORS)
                            .filter(([key]) => key !== "DEFAULT")
                            .map(([segment, color]) => (
                                <div key={segment} className="flex items-center gap-2">
                                    <div
                                        className="w-3 h-3 rounded-sm"
                                        style={{ backgroundColor: color }}
                                    />
                                    <span className="text-xs text-muted-foreground">
                                        {segment.replace("_", " ")}
                                    </span>
                                </div>
                            ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

export default RevenueChart;
