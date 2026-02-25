import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { useState } from "react";
import {
    FileWarning,
    ChevronLeft,
    AlertCircle,
    Loader2,
    Home,
    Clock,
    CheckCircle2,
    XCircle,
    AlertTriangle,
    Wrench,
    Image,
    Calendar,
    User,
    MapPin,
    MessageCircle,
    ChevronRight,
    ThumbsUp,
    ThumbsDown,
    Filter,
    X,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface TenantIssue {
    id: string;
    status: string;
    issueDescription: string | null;
    issueCategory: string | null;
    urgency: string | null;
    photos: string[] | null;
    tenantAvailability: string | null;
    aiResolutionAttempted: boolean;
    aiResolutionAccepted: boolean | null;
    createdAt: string;
    reportedToLandlordAt: string | null;
    resolvedAt: string | null;
    tenant: {
        id: string;
        name: string;
        phone: string;
    };
    property: {
        id: string;
        address: string;
        postcode: string;
        nickname: string | null;
    };
    quote?: {
        id: string;
        totalPence: number;
        status: string;
    } | null;
}

interface IssuesData {
    issues: TenantIssue[];
    stats: {
        total: number;
        open: number;
        resolved: number;
        diyResolved: number;
    };
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
    new: { label: "New", color: "text-blue-400 bg-blue-500/20", icon: Clock },
    ai_helping: { label: "AI Helping", color: "text-purple-400 bg-purple-500/20", icon: MessageCircle },
    awaiting_details: { label: "Awaiting Details", color: "text-yellow-400 bg-yellow-500/20", icon: Clock },
    reported: { label: "Reported", color: "text-orange-400 bg-orange-500/20", icon: AlertTriangle },
    quoted: { label: "Quoted", color: "text-cyan-400 bg-cyan-500/20", icon: FileWarning },
    approved: { label: "Approved", color: "text-green-400 bg-green-500/20", icon: ThumbsUp },
    scheduled: { label: "Scheduled", color: "text-indigo-400 bg-indigo-500/20", icon: Calendar },
    completed: { label: "Completed", color: "text-green-400 bg-green-500/20", icon: CheckCircle2 },
    resolved_diy: { label: "DIY Resolved", color: "text-teal-400 bg-teal-500/20", icon: Wrench },
    cancelled: { label: "Cancelled", color: "text-gray-400 bg-gray-500/20", icon: XCircle },
};

const URGENCY_CONFIG: Record<string, { label: string; color: string }> = {
    low: { label: "Low", color: "text-gray-400 bg-gray-500/20" },
    medium: { label: "Medium", color: "text-yellow-400 bg-yellow-500/20" },
    high: { label: "High", color: "text-orange-400 bg-orange-500/20" },
    emergency: { label: "Emergency", color: "text-red-400 bg-red-500/20" },
};

export default function IssuesPage() {
    const { token } = useParams<{ token: string }>();
    const queryClient = useQueryClient();
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [selectedIssue, setSelectedIssue] = useState<TenantIssue | null>(null);

    const { data, isLoading, error } = useQuery<IssuesData>({
        queryKey: ["landlord-issues", token],
        queryFn: async () => {
            const res = await fetch(`/api/landlord/${token}/issues`);
            if (!res.ok) throw new Error("Issues not found");
            return res.json();
        },
        enabled: !!token,
    });

    const approveMutation = useMutation({
        mutationFn: async (issueId: string) => {
            const res = await fetch(`/api/landlord/${token}/issues/${issueId}/approve`, {
                method: "POST",
            });
            if (!res.ok) throw new Error("Failed to approve");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["landlord-issues", token] });
            setSelectedIssue(null);
        },
    });

    const rejectMutation = useMutation({
        mutationFn: async ({ issueId, reason }: { issueId: string; reason: string }) => {
            const res = await fetch(`/api/landlord/${token}/issues/${issueId}/reject`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reason }),
            });
            if (!res.ok) throw new Error("Failed to reject");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["landlord-issues", token] });
            setSelectedIssue(null);
        },
    });

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gray-900 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500" />
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
                <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 max-w-md text-center">
                    <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                    <h1 className="text-xl font-semibold text-white mb-2">Issues Not Found</h1>
                    <p className="text-gray-400">Unable to load your issues.</p>
                </div>
            </div>
        );
    }

    const filteredIssues =
        statusFilter === "all"
            ? data.issues
            : statusFilter === "open"
            ? data.issues.filter((i) =>
                  ["new", "ai_helping", "awaiting_details", "reported", "quoted", "approved", "scheduled"].includes(
                      i.status
                  )
              )
            : data.issues.filter((i) => i.status === statusFilter);

    const getStatusBadge = (status: string) => {
        const config = STATUS_CONFIG[status] || STATUS_CONFIG.new;
        const Icon = config.icon;
        return (
            <span
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${config.color}`}
            >
                <Icon className="h-3 w-3" />
                {config.label}
            </span>
        );
    };

    const getUrgencyBadge = (urgency: string | null) => {
        if (!urgency) return null;
        const config = URGENCY_CONFIG[urgency] || URGENCY_CONFIG.medium;
        return (
            <span
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${config.color}`}
            >
                {config.label}
            </span>
        );
    };

    return (
        <div className="min-h-screen bg-gray-900 py-8 px-4">
            <div className="max-w-3xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <Link href={`/landlord/${token}/properties`}>
                            <button className="p-2 hover:bg-gray-800 rounded-lg transition-colors">
                                <ChevronLeft className="h-5 w-5 text-gray-400" />
                            </button>
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                                <FileWarning className="h-6 w-6 text-yellow-500" />
                                Tenant Issues
                            </h1>
                            <p className="text-gray-400 text-sm mt-1">
                                Review and approve maintenance requests
                            </p>
                        </div>
                    </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-4 gap-3 mb-6">
                    <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 text-center">
                        <p className="text-2xl font-bold text-white">{data.stats.total}</p>
                        <p className="text-xs text-gray-400">Total</p>
                    </div>
                    <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 text-center">
                        <p className="text-2xl font-bold text-yellow-400">{data.stats.open}</p>
                        <p className="text-xs text-gray-400">Open</p>
                    </div>
                    <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 text-center">
                        <p className="text-2xl font-bold text-green-400">{data.stats.resolved}</p>
                        <p className="text-xs text-gray-400">Resolved</p>
                    </div>
                    <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 text-center">
                        <p className="text-2xl font-bold text-teal-400">{data.stats.diyResolved}</p>
                        <p className="text-xs text-gray-400">DIY Fixed</p>
                    </div>
                </div>

                {/* Filter */}
                <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-2">
                    <Filter className="h-4 w-4 text-gray-500 flex-shrink-0" />
                    {["all", "open", "quoted", "approved", "completed", "resolved_diy"].map((filter) => (
                        <button
                            key={filter}
                            onClick={() => setStatusFilter(filter)}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                                statusFilter === filter
                                    ? "bg-yellow-500 text-black"
                                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                            }`}
                        >
                            {filter === "all"
                                ? "All"
                                : filter === "open"
                                ? "Open"
                                : STATUS_CONFIG[filter]?.label || filter}
                        </button>
                    ))}
                </div>

                {/* Issues List */}
                {filteredIssues.length === 0 ? (
                    <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 text-center">
                        <FileWarning className="h-12 w-12 text-gray-600 mx-auto mb-3" />
                        <p className="text-gray-400">No issues found</p>
                        <p className="text-sm text-gray-500 mt-1">
                            {statusFilter === "all"
                                ? "Your properties have no reported issues"
                                : `No ${STATUS_CONFIG[statusFilter]?.label || statusFilter} issues`}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {filteredIssues.map((issue) => (
                            <div
                                key={issue.id}
                                onClick={() => setSelectedIssue(issue)}
                                className="bg-gray-800 rounded-xl border border-gray-700 p-4 hover:border-gray-600 cursor-pointer transition-colors"
                            >
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <Home className="h-4 w-4 text-yellow-500" />
                                            <span className="text-white font-medium">
                                                {issue.property.nickname ||
                                                    issue.property.address.split(",")[0]}
                                            </span>
                                        </div>
                                        <p className="text-sm text-gray-400 line-clamp-2">
                                            {issue.issueDescription || "No description"}
                                        </p>
                                    </div>
                                    <ChevronRight className="h-5 w-5 text-gray-500 flex-shrink-0" />
                                </div>

                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        {getStatusBadge(issue.status)}
                                        {getUrgencyBadge(issue.urgency)}
                                    </div>
                                    <span className="text-xs text-gray-500">
                                        {formatDistanceToNow(new Date(issue.createdAt), {
                                            addSuffix: true,
                                        })}
                                    </span>
                                </div>

                                {issue.quote && issue.status === "quoted" && (
                                    <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                                        <p className="text-yellow-400 text-sm font-medium">
                                            Quote ready: £{(issue.quote.totalPence / 100).toFixed(2)}
                                        </p>
                                        <p className="text-xs text-gray-400 mt-1">
                                            Click to review and approve
                                        </p>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Issue Detail Modal */}
                {selectedIssue && (
                    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 overflow-y-auto">
                        <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-lg my-8">
                            {/* Modal Header */}
                            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
                                <h2 className="text-lg font-semibold text-white">Issue Details</h2>
                                <button
                                    onClick={() => setSelectedIssue(null)}
                                    className="p-1 hover:bg-gray-700 rounded"
                                >
                                    <X className="h-5 w-5 text-gray-400" />
                                </button>
                            </div>

                            {/* Modal Content */}
                            <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
                                {/* Property */}
                                <div>
                                    <h3 className="text-sm font-medium text-gray-400 mb-2">Property</h3>
                                    <div className="flex items-center gap-2">
                                        <Home className="h-4 w-4 text-yellow-500" />
                                        <span className="text-white">
                                            {selectedIssue.property.nickname ||
                                                selectedIssue.property.address}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-500 flex items-center gap-1 mt-1 ml-6">
                                        <MapPin className="h-3 w-3" />
                                        {selectedIssue.property.address},{" "}
                                        {selectedIssue.property.postcode}
                                    </p>
                                </div>

                                {/* Tenant */}
                                <div>
                                    <h3 className="text-sm font-medium text-gray-400 mb-2">Tenant</h3>
                                    <div className="flex items-center gap-2">
                                        <User className="h-4 w-4 text-gray-500" />
                                        <span className="text-white">{selectedIssue.tenant.name}</span>
                                        <span className="text-xs text-gray-500">
                                            {selectedIssue.tenant.phone}
                                        </span>
                                    </div>
                                </div>

                                {/* Issue Description */}
                                <div>
                                    <h3 className="text-sm font-medium text-gray-400 mb-2">Issue</h3>
                                    <p className="text-white">
                                        {selectedIssue.issueDescription || "No description provided"}
                                    </p>
                                    <div className="flex items-center gap-2 mt-2">
                                        {getStatusBadge(selectedIssue.status)}
                                        {getUrgencyBadge(selectedIssue.urgency)}
                                        {selectedIssue.issueCategory && (
                                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-700 text-gray-300 capitalize">
                                                {selectedIssue.issueCategory.replace("_", " ")}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Photos */}
                                {selectedIssue.photos && selectedIssue.photos.length > 0 && (
                                    <div>
                                        <h3 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-1">
                                            <Image className="h-4 w-4" />
                                            Photos ({selectedIssue.photos.length})
                                        </h3>
                                        <div className="flex gap-2 overflow-x-auto pb-2">
                                            {selectedIssue.photos.map((photo, idx) => (
                                                <img
                                                    key={idx}
                                                    src={photo}
                                                    alt={`Issue photo ${idx + 1}`}
                                                    className="h-24 w-24 object-cover rounded-lg flex-shrink-0"
                                                />
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Availability */}
                                {selectedIssue.tenantAvailability && (
                                    <div>
                                        <h3 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-1">
                                            <Calendar className="h-4 w-4" />
                                            Tenant Availability
                                        </h3>
                                        <p className="text-white text-sm">
                                            {selectedIssue.tenantAvailability}
                                        </p>
                                    </div>
                                )}

                                {/* AI Resolution */}
                                {selectedIssue.aiResolutionAttempted && (
                                    <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                                        <p className="text-purple-400 text-sm font-medium">
                                            AI Resolution Attempted
                                        </p>
                                        <p className="text-xs text-gray-400 mt-1">
                                            {selectedIssue.aiResolutionAccepted
                                                ? "Tenant resolved the issue with AI guidance"
                                                : "Tenant needed professional help"}
                                        </p>
                                    </div>
                                )}

                                {/* Quote */}
                                {selectedIssue.quote && (
                                    <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-yellow-400 font-medium">Quote Ready</span>
                                            <span className="text-2xl font-bold text-white">
                                                £{(selectedIssue.quote.totalPence / 100).toFixed(2)}
                                            </span>
                                        </div>
                                        <p className="text-xs text-gray-400">
                                            Status: {selectedIssue.quote.status}
                                        </p>
                                    </div>
                                )}

                                {/* Timestamps */}
                                <div className="text-xs text-gray-500 space-y-1">
                                    <p>
                                        Reported:{" "}
                                        {format(new Date(selectedIssue.createdAt), "MMM d, yyyy HH:mm")}
                                    </p>
                                    {selectedIssue.reportedToLandlordAt && (
                                        <p>
                                            Notified you:{" "}
                                            {format(
                                                new Date(selectedIssue.reportedToLandlordAt),
                                                "MMM d, yyyy HH:mm"
                                            )}
                                        </p>
                                    )}
                                    {selectedIssue.resolvedAt && (
                                        <p>
                                            Resolved:{" "}
                                            {format(
                                                new Date(selectedIssue.resolvedAt),
                                                "MMM d, yyyy HH:mm"
                                            )}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Modal Actions */}
                            {["quoted", "reported"].includes(selectedIssue.status) && (
                                <div className="p-4 border-t border-gray-700 flex gap-3">
                                    <button
                                        onClick={() => {
                                            const reason = prompt("Reason for rejecting (optional):");
                                            rejectMutation.mutate({
                                                issueId: selectedIssue.id,
                                                reason: reason || "",
                                            });
                                        }}
                                        disabled={rejectMutation.isPending}
                                        className="flex-1 px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-white font-medium flex items-center justify-center gap-2 transition-colors"
                                    >
                                        {rejectMutation.isPending ? (
                                            <Loader2 className="h-5 w-5 animate-spin" />
                                        ) : (
                                            <>
                                                <ThumbsDown className="h-5 w-5" />
                                                Reject
                                            </>
                                        )}
                                    </button>
                                    <button
                                        onClick={() => approveMutation.mutate(selectedIssue.id)}
                                        disabled={approveMutation.isPending}
                                        className="flex-1 px-4 py-3 bg-green-600 hover:bg-green-500 rounded-lg text-white font-medium flex items-center justify-center gap-2 transition-colors"
                                    >
                                        {approveMutation.isPending ? (
                                            <Loader2 className="h-5 w-5 animate-spin" />
                                        ) : (
                                            <>
                                                <ThumbsUp className="h-5 w-5" />
                                                Approve
                                            </>
                                        )}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Footer */}
                <div className="mt-8 text-center">
                    <p className="text-xs text-gray-500">
                        Issues are automatically reported when tenants contact us
                    </p>
                </div>
            </div>
        </div>
    );
}
