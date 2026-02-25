import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Link } from "wouter";
import {
    FileWarning,
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
    Filter,
    X,
    Send,
    FileText,
    Search,
    Building2,
    Phone,
    Zap,
    RefreshCw,
    ExternalLink,
    Bot,
    Video,
    Play,
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
    aiSuggestions: string | null;
    aiResolutionAccepted: boolean | null;
    additionalNotes: string | null;
    createdAt: string;
    reportedToLandlordAt: string | null;
    resolvedAt: string | null;
    tenant: {
        id: string;
        name: string;
        phone: string;
        email: string | null;
    };
    property: {
        id: string;
        address: string;
        postcode: string;
        nickname: string | null;
        propertyType: string | null;
    };
    landlord: {
        id: string;
        name: string;
        phone: string | null;
        email: string | null;
    };
    quote?: {
        id: string;
        shortSlug: string;
        totalPence: number;
        status: string;
    } | null;
}

interface ChatMessage {
    id: string;
    direction: 'inbound' | 'outbound';
    content: string | null;
    type: string;
    mediaUrl: string | null;
    mediaType: string | null;
    createdAt: string;
    senderName: string | null;
}

interface AdminIssuesData {
    issues: TenantIssue[];
    stats: {
        total: number;
        new: number;
        aiHelping: number;
        awaitingDetails: number;
        reported: number;
        quoted: number;
        approved: number;
        scheduled: number;
        completed: number;
        diyResolved: number;
    };
    landlords: { id: string; name: string }[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: typeof Clock }> = {
    new: { label: "New", color: "text-blue-400", bgColor: "bg-blue-500/20", icon: Clock },
    ai_helping: { label: "AI Helping", color: "text-purple-400", bgColor: "bg-purple-500/20", icon: Bot },
    awaiting_details: { label: "Awaiting Details", color: "text-yellow-400", bgColor: "bg-yellow-500/20", icon: Clock },
    reported: { label: "Reported", color: "text-orange-400", bgColor: "bg-orange-500/20", icon: AlertTriangle },
    quoted: { label: "Quoted", color: "text-cyan-400", bgColor: "bg-cyan-500/20", icon: FileText },
    approved: { label: "Approved", color: "text-green-400", bgColor: "bg-green-500/20", icon: CheckCircle2 },
    scheduled: { label: "Scheduled", color: "text-indigo-400", bgColor: "bg-indigo-500/20", icon: Calendar },
    completed: { label: "Completed", color: "text-green-400", bgColor: "bg-green-500/20", icon: CheckCircle2 },
    resolved_diy: { label: "DIY Resolved", color: "text-teal-400", bgColor: "bg-teal-500/20", icon: Wrench },
    cancelled: { label: "Cancelled", color: "text-gray-400", bgColor: "bg-gray-500/20", icon: XCircle },
};

const URGENCY_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
    low: { label: "Low", color: "text-gray-400", bgColor: "bg-gray-500/20" },
    medium: { label: "Medium", color: "text-yellow-400", bgColor: "bg-yellow-500/20" },
    high: { label: "High", color: "text-orange-400", bgColor: "bg-orange-500/20" },
    emergency: { label: "Emergency", color: "text-red-400", bgColor: "bg-red-500/20" },
};

export default function TenantIssuesPage() {
    const queryClient = useQueryClient();
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [landlordFilter, setLandlordFilter] = useState<string>("all");
    const [urgencyFilter, setUrgencyFilter] = useState<string>("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedIssue, setSelectedIssue] = useState<TenantIssue | null>(null);

    const { data, isLoading, error, refetch } = useQuery<AdminIssuesData>({
        queryKey: ["admin-tenant-issues"],
        queryFn: async () => {
            const res = await fetch("/api/admin/tenant-issues");
            if (!res.ok) throw new Error("Failed to load issues");
            return res.json();
        },
    });

    // Fetch messages for selected issue
    const { data: messagesData, isLoading: messagesLoading } = useQuery<{ messages: ChatMessage[] }>({
        queryKey: ["tenant-issue-messages", selectedIssue?.id],
        queryFn: async () => {
            if (!selectedIssue?.id) return { messages: [] };
            const res = await fetch(`/api/admin/tenant-issues/${selectedIssue.id}/messages`);
            if (!res.ok) return { messages: [] };
            return res.json();
        },
        enabled: !!selectedIssue,
    });

    const chaseMutation = useMutation({
        mutationFn: async (issueId: string) => {
            const res = await fetch(`/api/admin/tenant-issues/${issueId}/chase`, {
                method: "POST",
            });
            if (!res.ok) throw new Error("Failed to chase landlord");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["admin-tenant-issues"] });
        },
    });

    const convertToQuoteMutation = useMutation({
        mutationFn: async (issueId: string) => {
            const res = await fetch(`/api/admin/tenant-issues/${issueId}/convert`, {
                method: "POST",
            });
            if (!res.ok) throw new Error("Failed to convert to quote");
            return res.json();
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ["admin-tenant-issues"] });
            // Redirect to quote edit page
            if (data.quoteSlug) {
                window.location.href = `/admin/quotes/${data.quoteSlug}/edit`;
            }
        },
    });

    const updateStatusMutation = useMutation({
        mutationFn: async ({ issueId, status }: { issueId: string; status: string }) => {
            const res = await fetch(`/api/admin/tenant-issues/${issueId}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status }),
            });
            if (!res.ok) throw new Error("Failed to update status");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["admin-tenant-issues"] });
        },
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500" />
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-center">
                    <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                    <h2 className="text-xl font-semibold text-white mb-2">Failed to Load Issues</h2>
                    <p className="text-gray-400">Unable to load tenant issues.</p>
                </div>
            </div>
        );
    }

    // Filter issues
    let filteredIssues = data.issues;

    if (statusFilter !== "all") {
        if (statusFilter === "open") {
            filteredIssues = filteredIssues.filter((i) =>
                ["new", "ai_helping", "awaiting_details", "reported", "quoted", "approved", "scheduled"].includes(i.status)
            );
        } else if (statusFilter === "auto_dispatched") {
            // Auto-dispatched are approved without manual landlord approval
            filteredIssues = filteredIssues.filter((i) => i.status === "approved" || i.status === "scheduled");
        } else if (statusFilter === "needs_approval") {
            filteredIssues = filteredIssues.filter((i) => ["reported", "quoted"].includes(i.status));
        } else {
            filteredIssues = filteredIssues.filter((i) => i.status === statusFilter);
        }
    }

    if (landlordFilter !== "all") {
        filteredIssues = filteredIssues.filter((i) => i.landlord.id === landlordFilter);
    }

    if (urgencyFilter !== "all") {
        filteredIssues = filteredIssues.filter((i) => i.urgency === urgencyFilter);
    }

    if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        filteredIssues = filteredIssues.filter(
            (i) =>
                i.issueDescription?.toLowerCase().includes(q) ||
                i.property.address.toLowerCase().includes(q) ||
                i.tenant.name.toLowerCase().includes(q) ||
                i.landlord.name.toLowerCase().includes(q)
        );
    }

    const getStatusBadge = (status: string, size: "sm" | "md" = "sm") => {
        const config = STATUS_CONFIG[status] || STATUS_CONFIG.new;
        const Icon = config.icon;
        return (
            <span
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full font-medium ${config.color} ${config.bgColor} ${
                    size === "sm" ? "text-xs" : "text-sm"
                }`}
            >
                <Icon className={size === "sm" ? "h-3 w-3" : "h-4 w-4"} />
                {config.label}
            </span>
        );
    };

    const getUrgencyBadge = (urgency: string | null, size: "sm" | "md" = "sm") => {
        if (!urgency) return null;
        const config = URGENCY_CONFIG[urgency] || URGENCY_CONFIG.medium;
        return (
            <span
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-full font-medium ${config.color} ${config.bgColor} ${
                    size === "sm" ? "text-xs" : "text-sm"
                }`}
            >
                {config.label}
            </span>
        );
    };

    // Group issues by category for dashboard view
    const autoDispatched = data.issues.filter((i) => i.status === "scheduled" || i.status === "approved");
    const needsApproval = data.issues.filter((i) => ["reported", "quoted"].includes(i.status));
    const diyResolved = data.issues.filter((i) => i.status === "resolved_diy");
    const emergencies = data.issues.filter((i) => i.urgency === "emergency" && !["completed", "cancelled", "resolved_diy"].includes(i.status));

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                        <FileWarning className="h-7 w-7 text-yellow-500" />
                        Maintenance Hub
                    </h1>
                    <p className="text-gray-400 text-sm mt-1">
                        Manage tenant issues across all properties
                    </p>
                </div>
                <button
                    onClick={() => refetch()}
                    className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg border border-gray-700 transition-colors"
                >
                    <RefreshCw className="h-5 w-5 text-gray-400" />
                </button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                    <p className="text-3xl font-bold text-white">{data.stats.total}</p>
                    <p className="text-sm text-gray-400">Total Issues</p>
                </div>
                <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                    <p className="text-3xl font-bold text-green-400">{autoDispatched.length}</p>
                    <p className="text-sm text-gray-400">Auto-Dispatched</p>
                </div>
                <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                    <p className="text-3xl font-bold text-yellow-400">{needsApproval.length}</p>
                    <p className="text-sm text-gray-400">Awaiting Approval</p>
                </div>
                <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                    <p className="text-3xl font-bold text-teal-400">{diyResolved.length}</p>
                    <p className="text-sm text-gray-400">DIY Resolved</p>
                </div>
                <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                    <p className="text-3xl font-bold text-red-400">{emergencies.length}</p>
                    <p className="text-sm text-gray-400">Emergencies</p>
                </div>
            </div>

            {/* Emergencies Alert */}
            {emergencies.length > 0 && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
                    <h3 className="text-red-400 font-semibold flex items-center gap-2 mb-3">
                        <Zap className="h-5 w-5" />
                        Emergencies Requiring Attention ({emergencies.length})
                    </h3>
                    <div className="space-y-2">
                        {emergencies.slice(0, 3).map((issue) => (
                            <div
                                key={issue.id}
                                onClick={() => setSelectedIssue(issue)}
                                className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg hover:bg-gray-800 cursor-pointer transition-colors"
                            >
                                <div>
                                    <p className="text-white font-medium">
                                        {issue.property.nickname || issue.property.address.split(",")[0]}
                                    </p>
                                    <p className="text-sm text-gray-400 line-clamp-1">
                                        {issue.issueDescription}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    {getStatusBadge(issue.status)}
                                    <ChevronRight className="h-5 w-5 text-gray-500" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Filters */}
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <div className="flex flex-wrap items-center gap-4">
                    {/* Search */}
                    <div className="relative flex-1 min-w-[200px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search issues..."
                            className="w-full pl-10 pr-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
                        />
                    </div>

                    {/* Status Filter */}
                    <div className="flex items-center gap-2">
                        <Filter className="h-4 w-4 text-gray-500" />
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
                        >
                            <option value="all">All Status</option>
                            <option value="open">Open</option>
                            <option value="needs_approval">Needs Approval</option>
                            <option value="auto_dispatched">Auto-Dispatched</option>
                            <option value="completed">Completed</option>
                            <option value="resolved_diy">DIY Resolved</option>
                        </select>
                    </div>

                    {/* Landlord Filter */}
                    <select
                        value={landlordFilter}
                        onChange={(e) => setLandlordFilter(e.target.value)}
                        className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
                    >
                        <option value="all">All Landlords</option>
                        {data.landlords.map((ll) => (
                            <option key={ll.id} value={ll.id}>
                                {ll.name}
                            </option>
                        ))}
                    </select>

                    {/* Urgency Filter */}
                    <select
                        value={urgencyFilter}
                        onChange={(e) => setUrgencyFilter(e.target.value)}
                        className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
                    >
                        <option value="all">All Urgency</option>
                        <option value="emergency">Emergency</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                    </select>
                </div>
            </div>

            {/* Issues Table */}
            <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-gray-700/50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                                    Property
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                                    Issue
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                                    Tenant
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                                    Landlord
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                                    Status
                                </th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                                    Created
                                </th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700">
                            {filteredIssues.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-4 py-8 text-center">
                                        <FileWarning className="h-12 w-12 text-gray-600 mx-auto mb-3" />
                                        <p className="text-gray-400">No issues found</p>
                                    </td>
                                </tr>
                            ) : (
                                filteredIssues.map((issue) => (
                                    <tr
                                        key={issue.id}
                                        className="hover:bg-gray-700/50 cursor-pointer transition-colors"
                                        onClick={() => setSelectedIssue(issue)}
                                    >
                                        <td className="px-4 py-4">
                                            <div className="flex items-center gap-2">
                                                <Home className="h-4 w-4 text-yellow-500 flex-shrink-0" />
                                                <div>
                                                    <p className="text-white font-medium line-clamp-1">
                                                        {issue.property.nickname || issue.property.address.split(",")[0]}
                                                    </p>
                                                    <p className="text-xs text-gray-500">
                                                        {issue.property.postcode}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-4">
                                            <p className="text-gray-300 line-clamp-2 max-w-[200px]">
                                                {issue.issueDescription || "No description"}
                                            </p>
                                            <div className="flex items-center gap-2 mt-1">
                                                {issue.issueCategory && (
                                                    <span className="text-xs text-gray-500 capitalize">
                                                        {issue.issueCategory.replace("_", " ")}
                                                    </span>
                                                )}
                                                {getUrgencyBadge(issue.urgency)}
                                            </div>
                                        </td>
                                        <td className="px-4 py-4">
                                            <p className="text-white text-sm">{issue.tenant.name}</p>
                                            <p className="text-xs text-gray-500">{issue.tenant.phone}</p>
                                        </td>
                                        <td className="px-4 py-4">
                                            <p className="text-white text-sm">{issue.landlord.name}</p>
                                        </td>
                                        <td className="px-4 py-4">
                                            {getStatusBadge(issue.status)}
                                        </td>
                                        <td className="px-4 py-4">
                                            <p className="text-sm text-gray-400">
                                                {formatDistanceToNow(new Date(issue.createdAt), { addSuffix: true })}
                                            </p>
                                        </td>
                                        <td className="px-4 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                                                {["reported", "quoted"].includes(issue.status) && (
                                                    <button
                                                        onClick={() => chaseMutation.mutate(issue.id)}
                                                        disabled={chaseMutation.isPending}
                                                        className="p-1.5 hover:bg-gray-600 rounded text-gray-400 hover:text-yellow-400 transition-colors"
                                                        title="Chase landlord"
                                                    >
                                                        <Send className="h-4 w-4" />
                                                    </button>
                                                )}
                                                {!issue.quote && ["reported", "awaiting_details", "new"].includes(issue.status) && (
                                                    <button
                                                        onClick={() => convertToQuoteMutation.mutate(issue.id)}
                                                        disabled={convertToQuoteMutation.isPending}
                                                        className="p-1.5 hover:bg-gray-600 rounded text-gray-400 hover:text-green-400 transition-colors"
                                                        title="Convert to quote"
                                                    >
                                                        <FileText className="h-4 w-4" />
                                                    </button>
                                                )}
                                                {issue.quote && (
                                                    <Link href={`/admin/quotes/${issue.quote.shortSlug}/edit`}>
                                                        <button
                                                            className="p-1.5 hover:bg-gray-600 rounded text-gray-400 hover:text-blue-400 transition-colors"
                                                            title="View quote"
                                                        >
                                                            <ExternalLink className="h-4 w-4" />
                                                        </button>
                                                    </Link>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Issue Detail Modal */}
            {selectedIssue && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 overflow-y-auto">
                    <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-2xl my-8">
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
                        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                            {/* Property & Landlord */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-gray-700/50 rounded-lg p-4">
                                    <h3 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-1">
                                        <Building2 className="h-4 w-4" />
                                        Property
                                    </h3>
                                    <p className="text-white font-medium">
                                        {selectedIssue.property.nickname || selectedIssue.property.address.split(",")[0]}
                                    </p>
                                    <p className="text-sm text-gray-400">
                                        {selectedIssue.property.address}
                                    </p>
                                    <p className="text-xs text-gray-500 mt-1">
                                        {selectedIssue.property.postcode} · {selectedIssue.property.propertyType || "Property"}
                                    </p>
                                </div>
                                <div className="bg-gray-700/50 rounded-lg p-4">
                                    <h3 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-1">
                                        <User className="h-4 w-4" />
                                        Landlord
                                    </h3>
                                    <p className="text-white font-medium">{selectedIssue.landlord.name}</p>
                                    {selectedIssue.landlord.phone && (
                                        <p className="text-sm text-gray-400 flex items-center gap-1">
                                            <Phone className="h-3 w-3" />
                                            {selectedIssue.landlord.phone}
                                        </p>
                                    )}
                                    {selectedIssue.landlord.email && (
                                        <p className="text-xs text-gray-500 mt-1">
                                            {selectedIssue.landlord.email}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Tenant */}
                            <div className="bg-gray-700/50 rounded-lg p-4">
                                <h3 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-1">
                                    <User className="h-4 w-4" />
                                    Tenant
                                </h3>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-white font-medium">{selectedIssue.tenant.name}</p>
                                        <p className="text-sm text-gray-400">{selectedIssue.tenant.phone}</p>
                                    </div>
                                    <a
                                        href={`https://wa.me/${selectedIssue.tenant.phone.replace(/\D/g, "")}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded-lg text-white text-sm font-medium flex items-center gap-1"
                                    >
                                        <MessageCircle className="h-4 w-4" />
                                        WhatsApp
                                    </a>
                                </div>
                            </div>

                            {/* Issue Description */}
                            <div>
                                <h3 className="text-sm font-medium text-gray-400 mb-2">Issue Description</h3>
                                <p className="text-white bg-gray-700/50 rounded-lg p-4">
                                    {selectedIssue.issueDescription || "No description provided"}
                                </p>
                                <div className="flex items-center gap-3 mt-3">
                                    {getStatusBadge(selectedIssue.status, "md")}
                                    {getUrgencyBadge(selectedIssue.urgency, "md")}
                                    {selectedIssue.issueCategory && (
                                        <span className="px-3 py-1.5 rounded-full text-sm font-medium bg-gray-700 text-gray-300 capitalize">
                                            {selectedIssue.issueCategory.replace("_", " ")}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Media (Photos & Videos) */}
                            {selectedIssue.photos && selectedIssue.photos.length > 0 && (
                                <div>
                                    <h3 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-1">
                                        <Image className="h-4 w-4" />
                                        Media ({selectedIssue.photos.length})
                                    </h3>
                                    <div className="flex gap-3 overflow-x-auto pb-2">
                                        {selectedIssue.photos.map((media, idx) => {
                                            const isVideo = media.includes('.mp4') || media.includes('.mov') || media.includes('.webm') || media.includes('video');
                                            return isVideo ? (
                                                <a
                                                    key={idx}
                                                    href={media}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex-shrink-0 relative group"
                                                >
                                                    <div className="h-32 w-32 bg-gray-700 rounded-lg flex items-center justify-center group-hover:bg-gray-600 transition-colors">
                                                        <Play className="h-12 w-12 text-white" />
                                                    </div>
                                                    <span className="absolute bottom-1 left-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded flex items-center gap-1">
                                                        <Video className="h-3 w-3" /> Video
                                                    </span>
                                                </a>
                                            ) : (
                                                <a
                                                    key={idx}
                                                    href={media}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex-shrink-0"
                                                >
                                                    <img
                                                        src={media}
                                                        alt={`Issue photo ${idx + 1}`}
                                                        className="h-32 w-32 object-cover rounded-lg hover:opacity-80 transition-opacity"
                                                    />
                                                </a>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Chat Log */}
                            {messagesData && messagesData.messages.length > 0 && (
                                <div>
                                    <h3 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-1">
                                        <MessageCircle className="h-4 w-4" />
                                        Chat History ({messagesData.messages.length} messages)
                                    </h3>
                                    <div className="bg-gray-700/50 rounded-lg p-3 max-h-64 overflow-y-auto space-y-3">
                                        {messagesLoading ? (
                                            <div className="flex justify-center py-4">
                                                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                                            </div>
                                        ) : (
                                            messagesData.messages.map((msg) => (
                                                <div
                                                    key={msg.id}
                                                    className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                                                >
                                                    <div
                                                        className={`max-w-[80%] rounded-lg px-3 py-2 ${
                                                            msg.direction === 'outbound'
                                                                ? 'bg-yellow-500/20 text-yellow-100'
                                                                : 'bg-gray-600 text-white'
                                                        }`}
                                                    >
                                                        {msg.type === 'image' && msg.mediaUrl && (
                                                            <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer">
                                                                <img
                                                                    src={msg.mediaUrl}
                                                                    alt="Shared image"
                                                                    className="max-h-32 rounded mb-2 hover:opacity-80"
                                                                />
                                                            </a>
                                                        )}
                                                        {msg.type === 'video' && msg.mediaUrl && (
                                                            <a
                                                                href={msg.mediaUrl}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="flex items-center gap-2 mb-2 text-blue-400 hover:text-blue-300"
                                                            >
                                                                <Video className="h-4 w-4" />
                                                                View Video
                                                            </a>
                                                        )}
                                                        {msg.content && (
                                                            <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                                                        )}
                                                        <p className="text-[10px] text-gray-400 mt-1">
                                                            {format(new Date(msg.createdAt), "HH:mm")}
                                                            {msg.direction === 'outbound' && ' • AI'}
                                                        </p>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Tenant Availability */}
                            {selectedIssue.tenantAvailability && (
                                <div>
                                    <h3 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-1">
                                        <Calendar className="h-4 w-4" />
                                        Tenant Availability
                                    </h3>
                                    <p className="text-white bg-gray-700/50 rounded-lg p-3">
                                        {selectedIssue.tenantAvailability}
                                    </p>
                                </div>
                            )}

                            {/* AI Resolution */}
                            {selectedIssue.aiResolutionAttempted && (
                                <div className={`rounded-lg p-4 ${selectedIssue.aiResolutionAccepted ? "bg-teal-500/10 border border-teal-500/20" : "bg-purple-500/10 border border-purple-500/20"}`}>
                                    <h3 className={`text-sm font-medium mb-2 flex items-center gap-1 ${selectedIssue.aiResolutionAccepted ? "text-teal-400" : "text-purple-400"}`}>
                                        <Bot className="h-4 w-4" />
                                        AI Resolution Attempt
                                    </h3>
                                    {selectedIssue.aiSuggestions && (
                                        <p className="text-gray-300 text-sm mb-2">
                                            Suggestions: {selectedIssue.aiSuggestions}
                                        </p>
                                    )}
                                    <p className="text-xs text-gray-400">
                                        {selectedIssue.aiResolutionAccepted
                                            ? "Tenant resolved the issue with AI guidance"
                                            : "Tenant needed professional help"}
                                    </p>
                                </div>
                            )}

                            {/* Quote Info */}
                            {selectedIssue.quote && (
                                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="text-yellow-400 font-medium">Quote Generated</h3>
                                            <p className="text-2xl font-bold text-white mt-1">
                                                £{(selectedIssue.quote.totalPence / 100).toFixed(2)}
                                            </p>
                                            <p className="text-xs text-gray-400 mt-1">
                                                Status: {selectedIssue.quote.status}
                                            </p>
                                        </div>
                                        <Link href={`/admin/quotes/${selectedIssue.quote.shortSlug}/edit`}>
                                            <button className="px-4 py-2 bg-yellow-500 hover:bg-yellow-400 rounded-lg text-black font-medium flex items-center gap-2">
                                                <ExternalLink className="h-4 w-4" />
                                                View Quote
                                            </button>
                                        </Link>
                                    </div>
                                </div>
                            )}

                            {/* Timestamps */}
                            <div className="text-xs text-gray-500 space-y-1 border-t border-gray-700 pt-4">
                                <p>
                                    Created: {format(new Date(selectedIssue.createdAt), "MMM d, yyyy HH:mm")}
                                </p>
                                {selectedIssue.reportedToLandlordAt && (
                                    <p>
                                        Landlord notified: {format(new Date(selectedIssue.reportedToLandlordAt), "MMM d, yyyy HH:mm")}
                                    </p>
                                )}
                                {selectedIssue.resolvedAt && (
                                    <p>
                                        Resolved: {format(new Date(selectedIssue.resolvedAt), "MMM d, yyyy HH:mm")}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Modal Actions */}
                        <div className="p-4 border-t border-gray-700 flex flex-wrap gap-3">
                            {!selectedIssue.quote && ["reported", "awaiting_details", "new"].includes(selectedIssue.status) && (
                                <button
                                    onClick={() => convertToQuoteMutation.mutate(selectedIssue.id)}
                                    disabled={convertToQuoteMutation.isPending}
                                    className="px-4 py-2 bg-yellow-500 hover:bg-yellow-400 rounded-lg text-black font-medium flex items-center gap-2"
                                >
                                    {convertToQuoteMutation.isPending ? (
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                    ) : (
                                        <>
                                            <FileText className="h-5 w-5" />
                                            Convert to Quote
                                        </>
                                    )}
                                </button>
                            )}
                            {["reported", "quoted"].includes(selectedIssue.status) && (
                                <button
                                    onClick={() => chaseMutation.mutate(selectedIssue.id)}
                                    disabled={chaseMutation.isPending}
                                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white font-medium flex items-center gap-2"
                                >
                                    {chaseMutation.isPending ? (
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                    ) : (
                                        <>
                                            <Send className="h-5 w-5" />
                                            Chase Landlord
                                        </>
                                    )}
                                </button>
                            )}
                            <a
                                href={`https://wa.me/${selectedIssue.tenant.phone.replace(/\D/g, "")}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-white font-medium flex items-center gap-2"
                            >
                                <MessageCircle className="h-5 w-5" />
                                Message Tenant
                            </a>
                            {!["completed", "cancelled", "resolved_diy"].includes(selectedIssue.status) && (
                                <button
                                    onClick={() => {
                                        if (confirm("Mark this issue as resolved?")) {
                                            updateStatusMutation.mutate({ issueId: selectedIssue.id, status: "completed" });
                                            setSelectedIssue(null);
                                        }
                                    }}
                                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white font-medium flex items-center gap-2"
                                >
                                    <CheckCircle2 className="h-5 w-5" />
                                    Mark Resolved
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
