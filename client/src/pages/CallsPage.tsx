import React, { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { CallsFilterBar } from "@/components/calls/CallsFilterBar";
import { CallListTable, CallSummary } from "@/components/calls/CallListTable";
import { startOfMonth, endOfMonth, subDays } from "date-fns";
import { CallDetailsModal } from "@/components/calls/CallDetailsModal";
import { ConnectionStatus } from "@/components/calls/ConnectionStatus";
import { useToast } from "@/hooks/use-toast";

// Simple DateRange interface since we removed react-day-picker
interface DateRange {
    from: Date | undefined;
    to?: Date | undefined;
}

export default function CallsPage() {
    // URL State for deep linking? Maybe later.
    const [dateRange, setDateRange] = useState<DateRange | undefined>({
        from: subDays(new Date(), 30),
        to: new Date(),
    });
    const [searchTerm, setSearchTerm] = useState("");
    const [outcomeFilter, setOutcomeFilter] = useState("ALL");
    const [hasSkusOnly, setHasSkusOnly] = useState(false);
    const [page, setPage] = useState(1);
    const [selectedCallId, setSelectedCallId] = useState<string | null>(null);

    const { toast } = useToast();

    // Fetch calls
    const { data, isLoading, error, refetch, isRefetching } = useQuery({
        queryKey: ['calls', page, dateRange, searchTerm, outcomeFilter, hasSkusOnly],
        queryFn: async () => {
            const params = new URLSearchParams({
                page: page.toString(),
                limit: "25",
            });

            if (dateRange?.from) params.append('startDate', dateRange.from.toISOString());
            if (dateRange?.to) params.append('endDate', dateRange.to.toISOString());
            if (searchTerm) params.append('search', searchTerm);
            if (outcomeFilter !== 'ALL') params.append('outcome', outcomeFilter);
            if (hasSkusOnly) params.append('hasSkus', 'true');

            const res = await fetch(`/api/calls?${params}`);
            if (!res.ok) throw new Error("Failed to fetch calls");
            return res.json() as Promise<{ calls: CallSummary[], pagination: any }>;
        },
        placeholderData: keepPreviousData,
    });

    const handleClearFilters = () => {
        setSearchTerm("");
        setOutcomeFilter("ALL");
        setHasSkusOnly(false);
        setDateRange({ from: subDays(new Date(), 30), to: new Date() });
        setPage(1);
    };

    return (
        <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden font-sans transition-colors duration-300">
            <div className="p-6 border-b border-border bg-muted/30 backdrop-blur-sm transition-colors duration-300">
                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground">Call Logs</h1>
                        <p className="text-muted-foreground mt-1">
                            View and manage inbound calls, transcripts, and detected SKUs.
                        </p>
                    </div>
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => {
                                console.log("Manually refreshing call logs...");
                                refetch();
                            }}
                            disabled={isRefetching}
                            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-all duration-200 disabled:opacity-50"
                            title="Refresh logs"
                        >
                            <RefreshCw className={`w-5 h-5 ${isRefetching ? "animate-spin" : ""}`} />
                        </button>
                        <ConnectionStatus />
                    </div>
                </div>
            </div>

            <div className="p-6 border-b border-border">
                <CallsFilterBar
                    dateRange={dateRange}
                    setDateRange={setDateRange}
                    searchTerm={searchTerm}
                    setSearchTerm={setSearchTerm}
                    outcomeFilter={outcomeFilter}
                    setOutcomeFilter={setOutcomeFilter}
                    hasSkusOnly={hasSkusOnly}
                    setHasSkusOnly={setHasSkusOnly}
                    onClearFilters={handleClearFilters}
                />
            </div>

            <div className="flex-1 overflow-auto p-6">
                <CallListTable
                    calls={data?.calls || []}
                    isLoading={isLoading}
                    onCallClick={setSelectedCallId}
                />
            </div>

            {/* Pagination controls */}
            {data?.pagination && (
                <div className="p-6 border-t border-border flex justify-between items-center bg-muted/20 backdrop-blur-sm">
                    <div className="text-sm text-muted-foreground">
                        Page {data.pagination.page} of {data.pagination.totalPages} ({data.pagination.total} total)
                    </div>
                    <div className="space-x-2">
                        <button
                            disabled={page <= 1}
                            onClick={() => setPage(p => p - 1)}
                            className="px-3 py-1 border border-border rounded bg-card text-card-foreground disabled:opacity-50 hover:bg-muted transition-colors"
                        >
                            Previous
                        </button>
                        <button
                            disabled={page >= data.pagination.totalPages}
                            onClick={() => setPage(p => p + 1)}
                            className="px-3 py-1 border border-border rounded bg-card text-card-foreground disabled:opacity-50 hover:bg-muted transition-colors"
                        >
                            Next
                        </button>
                    </div>
                </div>
            )}

            {/* Modal */}
            <CallDetailsModal
                open={!!selectedCallId}
                callId={selectedCallId}
                onClose={() => setSelectedCallId(null)}
            />
        </div>
    );
}
