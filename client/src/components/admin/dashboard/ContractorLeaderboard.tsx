import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { useState } from "react";
import {
    ChevronUp,
    ChevronDown,
    Star,
    ExternalLink,
    Loader2,
    Trophy,
    Medal,
    Award,
} from "lucide-react";
import { useLocation } from "wouter";

export interface ContractorStats {
    id: number;
    name: string;
    avatarUrl?: string;
    jobsCompleted: number;
    revenue: number;
    avgRating: number;
    ratingCount: number;
}

export interface ContractorLeaderboardProps {
    contractors: ContractorStats[];
    isLoading?: boolean;
    onContractorClick?: (id: number) => void;
}

type SortKey = "jobsCompleted" | "revenue" | "avgRating";
type SortDirection = "asc" | "desc";

const RankBadge = ({ rank }: { rank: number }) => {
    if (rank === 1) {
        return (
            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-500/20">
                <Trophy className="h-3.5 w-3.5 text-amber-500" />
            </div>
        );
    }
    if (rank === 2) {
        return (
            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-400/20">
                <Medal className="h-3.5 w-3.5 text-gray-400" />
            </div>
        );
    }
    if (rank === 3) {
        return (
            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-700/20">
                <Award className="h-3.5 w-3.5 text-amber-700" />
            </div>
        );
    }
    return (
        <div className="flex items-center justify-center w-6 h-6 text-xs text-muted-foreground font-medium">
            {rank}
        </div>
    );
};

export function ContractorLeaderboard({
    contractors,
    isLoading = false,
    onContractorClick,
}: ContractorLeaderboardProps) {
    const [, setLocation] = useLocation();
    const [sortKey, setSortKey] = useState<SortKey>("revenue");
    const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

    const handleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDirection(sortDirection === "asc" ? "desc" : "asc");
        } else {
            setSortKey(key);
            setSortDirection("desc");
        }
    };

    const sortedContractors = [...contractors].sort((a, b) => {
        const aVal = a[sortKey];
        const bVal = b[sortKey];
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
    });

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat("en-GB", {
            style: "currency",
            currency: "GBP",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(value);
    };

    const SortIndicator = ({ columnKey }: { columnKey: SortKey }) => {
        if (sortKey !== columnKey) {
            return <ChevronUp className="h-4 w-4 opacity-0 group-hover:opacity-30" />;
        }
        return sortDirection === "asc" ? (
            <ChevronUp className="h-4 w-4 text-primary" />
        ) : (
            <ChevronDown className="h-4 w-4 text-primary" />
        );
    };

    const handleContractorClick = (id: number) => {
        if (onContractorClick) {
            onContractorClick(id);
        } else {
            setLocation(`/admin/contractors?id=${id}`);
        }
    };

    return (
        <Card className="bg-card border-border shadow-sm backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-secondary">Top Contractors</CardTitle>
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setLocation("/admin/contractors")}
                >
                    View All
                    <ExternalLink className="h-3 w-3 ml-1" />
                </Button>
            </CardHeader>
            <CardContent className="p-0">
                {isLoading ? (
                    <div className="flex items-center justify-center h-64">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : contractors.length === 0 ? (
                    <div className="flex items-center justify-center h-32 text-muted-foreground">
                        No contractor data available
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-12">#</TableHead>
                                <TableHead>Contractor</TableHead>
                                <TableHead
                                    className="text-right cursor-pointer group"
                                    onClick={() => handleSort("jobsCompleted")}
                                >
                                    <div className="flex items-center justify-end gap-1">
                                        Jobs
                                        <SortIndicator columnKey="jobsCompleted" />
                                    </div>
                                </TableHead>
                                <TableHead
                                    className="text-right cursor-pointer group"
                                    onClick={() => handleSort("revenue")}
                                >
                                    <div className="flex items-center justify-end gap-1">
                                        Revenue
                                        <SortIndicator columnKey="revenue" />
                                    </div>
                                </TableHead>
                                <TableHead
                                    className="text-right cursor-pointer group"
                                    onClick={() => handleSort("avgRating")}
                                >
                                    <div className="flex items-center justify-end gap-1">
                                        Rating
                                        <SortIndicator columnKey="avgRating" />
                                    </div>
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sortedContractors.map((contractor, index) => (
                                <motion.tr
                                    key={contractor.id}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: index * 0.05 }}
                                    className={cn(
                                        "border-b transition-colors hover:bg-muted/50 cursor-pointer",
                                        index < 3 && "bg-muted/20"
                                    )}
                                    onClick={() => handleContractorClick(contractor.id)}
                                >
                                    <TableCell>
                                        <RankBadge rank={index + 1} />
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                            {contractor.avatarUrl ? (
                                                <img
                                                    src={contractor.avatarUrl}
                                                    alt={contractor.name}
                                                    className="h-8 w-8 rounded-full object-cover"
                                                />
                                            ) : (
                                                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                                                    <span className="text-xs font-medium text-primary">
                                                        {contractor.name
                                                            .split(" ")
                                                            .map((n) => n[0])
                                                            .join("")
                                                            .toUpperCase()}
                                                    </span>
                                                </div>
                                            )}
                                            <span className="font-medium">
                                                {contractor.name}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Badge variant="secondary" className="font-mono">
                                            {contractor.jobsCompleted}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right font-medium">
                                        {formatCurrency(contractor.revenue)}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                                            <span className="font-medium">
                                                {contractor.avgRating.toFixed(1)}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                                ({contractor.ratingCount})
                                            </span>
                                        </div>
                                    </TableCell>
                                </motion.tr>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
}

export default ContractorLeaderboard;
