import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { useState, Fragment } from "react";
import {
    AlertCircle,
    Loader2,
    Home,
    Clock,
    CheckCircle2,
    XCircle,
    AlertTriangle,
    Wrench,
    Image as ImageIcon,
    Calendar,
    User,
    MapPin,
    MessageCircle,
    ChevronRight,
    ChevronLeft,
    ThumbsUp,
    ThumbsDown,
    X,
    Video,
    Play,
    Filter,
    Sparkles,
    Phone,
    ArrowLeft,
    Check,
    Building2,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";

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

interface ChatMessage {
    id: string;
    direction: "inbound" | "outbound";
    content: string | null;
    type: string;
    mediaUrl: string | null;
    mediaType: string | null;
    createdAt: string;
    senderName: string | null;
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

const STATUS_CONFIG: Record<
    string,
    { label: string; color: string; bgColor: string; icon: typeof Clock }
> = {
    new: {
        label: "New",
        color: "text-blue-600",
        bgColor: "bg-blue-50 border-blue-200",
        icon: Clock,
    },
    ai_helping: {
        label: "AI Helping",
        color: "text-purple-600",
        bgColor: "bg-purple-50 border-purple-200",
        icon: MessageCircle,
    },
    awaiting_details: {
        label: "Awaiting Details",
        color: "text-amber-600",
        bgColor: "bg-amber-50 border-amber-200",
        icon: Clock,
    },
    reported: {
        label: "Reported",
        color: "text-orange-600",
        bgColor: "bg-orange-50 border-orange-200",
        icon: AlertTriangle,
    },
    quoted: {
        label: "Quote Ready",
        color: "text-amber-700",
        bgColor: "bg-amber-50 border-amber-300",
        icon: AlertCircle,
    },
    approved: {
        label: "Approved",
        color: "text-teal-600",
        bgColor: "bg-teal-50 border-teal-200",
        icon: ThumbsUp,
    },
    scheduled: {
        label: "Scheduled",
        color: "text-indigo-600",
        bgColor: "bg-indigo-50 border-indigo-200",
        icon: Calendar,
    },
    completed: {
        label: "Completed",
        color: "text-emerald-600",
        bgColor: "bg-emerald-50 border-emerald-200",
        icon: CheckCircle2,
    },
    resolved_diy: {
        label: "DIY Fixed",
        color: "text-green-600",
        bgColor: "bg-green-50 border-green-200",
        icon: Wrench,
    },
    cancelled: {
        label: "Cancelled",
        color: "text-slate-500",
        bgColor: "bg-slate-50 border-slate-200",
        icon: XCircle,
    },
};

const URGENCY_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
    low: { label: "Low", color: "text-slate-600", bgColor: "bg-slate-100" },
    medium: { label: "Medium", color: "text-blue-600", bgColor: "bg-blue-100" },
    high: { label: "High", color: "text-orange-600", bgColor: "bg-orange-100" },
    emergency: { label: "Emergency", color: "text-red-600", bgColor: "bg-red-100" },
};

const FILTER_TABS = [
    { id: "all", label: "All Issues" },
    { id: "action", label: "Needs Action", badge: true },
    { id: "open", label: "In Progress" },
    { id: "completed", label: "Completed" },
];

export default function IssuesPageNew() {
    const { token } = useParams<{ token: string }>();
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState("all");
    const [selectedIssue, setSelectedIssue] = useState<TenantIssue | null>(null);
    const [showRejectModal, setShowRejectModal] = useState(false);
    const [rejectReason, setRejectReason] = useState("");

    const { data, isLoading, error } = useQuery<IssuesData>({
        queryKey: ["landlord-issues", token],
        queryFn: async () => {
            const res = await fetch(`/api/landlord/${token}/issues`);
            if (!res.ok) throw new Error("Issues not found");
            return res.json();
        },
        enabled: !!token,
    });

    const { data: messagesData, isLoading: messagesLoading } = useQuery<{
        messages: ChatMessage[];
    }>({
        queryKey: ["landlord-issue-messages", selectedIssue?.id],
        queryFn: async () => {
            if (!selectedIssue?.id) return { messages: [] };
            const res = await fetch(
                `/api/landlord/${token}/issues/${selectedIssue.id}/messages`
            );
            if (!res.ok) return { messages: [] };
            return res.json();
        },
        enabled: !!selectedIssue && !!token,
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
            setShowRejectModal(false);
            setRejectReason("");
        },
    });

    if (isLoading) {
        return (
            <div className="min-h-screen bg-stone-50 flex items-center justify-center">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center gap-3"
                >
                    <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
                    <p className="text-slate-500">Loading issues...</p>
                </motion.div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md text-center">
                    <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                    <h1 className="text-xl font-semibold text-slate-900 mb-2">
                        Unable to Load Issues
                    </h1>
                    <p className="text-slate-500">Please try refreshing the page.</p>
                </div>
            </div>
        );
    }

    const needsActionCount = data.issues.filter((i) =>
        ["quoted", "reported"].includes(i.status)
    ).length;

    const filteredIssues = data.issues.filter((issue) => {
        switch (activeTab) {
            case "action":
                return ["quoted", "reported"].includes(issue.status);
            case "open":
                return ["new", "ai_helping", "awaiting_details", "approved", "scheduled"].includes(
                    issue.status
                );
            case "completed":
                return ["completed", "resolved_diy", "cancelled"].includes(issue.status);
            default:
                return true;
        }
    });

    const getStatusBadge = (status: string) => {
        const config = STATUS_CONFIG[status] || STATUS_CONFIG.new;
        const Icon = config.icon;
        return (
            <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${config.bgColor} ${config.color}`}
            >
                <Icon className="h-3.5 w-3.5" />
                {config.label}
            </span>
        );
    };

    return (
        <div className="min-h-screen bg-stone-50 font-jakarta">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 sticky top-0 z-40">
                <div className="max-w-4xl mx-auto px-4 py-4">
                    <div className="flex items-center gap-4">
                        <Link href={`/landlord/${token}`}>
                            <button className="p-2 -ml-2 hover:bg-slate-100 rounded-xl transition-colors">
                                <ArrowLeft className="h-5 w-5 text-slate-600" />
                            </button>
                        </Link>
                        <div className="flex-1">
                            <h1 className="text-xl font-bold text-slate-900">Maintenance Issues</h1>
                            <p className="text-sm text-slate-500">
                                {data.stats.total} total • {data.stats.open} open
                            </p>
                        </div>
                    </div>

                    {/* Filter Tabs */}
                    <div className="flex gap-2 mt-4 overflow-x-auto pb-1">
                        {FILTER_TABS.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                                    activeTab === tab.id
                                        ? "bg-slate-900 text-white shadow-lg"
                                        : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
                                }`}
                            >
                                {tab.label}
                                {tab.badge && needsActionCount > 0 && (
                                    <span
                                        className={`ml-2 px-1.5 py-0.5 rounded-full text-xs ${
                                            activeTab === tab.id
                                                ? "bg-amber-400 text-amber-900"
                                                : "bg-amber-100 text-amber-700"
                                        }`}
                                    >
                                        {needsActionCount}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Issues List */}
            <div className="max-w-4xl mx-auto px-4 py-6">
                <AnimatePresence mode="wait">
                    {filteredIssues.length === 0 ? (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            className="bg-white rounded-2xl border border-slate-200 p-12 text-center"
                        >
                            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                                <CheckCircle2 className="h-8 w-8 text-slate-400" />
                            </div>
                            <h3 className="text-lg font-semibold text-slate-900 mb-2">
                                {activeTab === "action"
                                    ? "Nothing needs your attention"
                                    : "No issues found"}
                            </h3>
                            <p className="text-slate-500">
                                {activeTab === "action"
                                    ? "You're all caught up! Check back later."
                                    : "Issues will appear here when tenants report them."}
                            </p>
                        </motion.div>
                    ) : (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="space-y-3"
                        >
                            {filteredIssues.map((issue, index) => {
                                const config = STATUS_CONFIG[issue.status] || STATUS_CONFIG.new;
                                const StatusIcon = config.icon;
                                const isActionable = ["quoted", "reported"].includes(issue.status);

                                return (
                                    <motion.div
                                        key={issue.id}
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: index * 0.05 }}
                                        onClick={() => setSelectedIssue(issue)}
                                        className={`bg-white rounded-2xl border cursor-pointer transition-all hover:shadow-lg hover:shadow-slate-200/50 ${
                                            isActionable
                                                ? "border-amber-200 ring-1 ring-amber-100"
                                                : "border-slate-200"
                                        }`}
                                    >
                                        <div className="p-4 sm:p-5">
                                            <div className="flex items-start gap-4">
                                                {/* Status Icon */}
                                                <div
                                                    className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                                                        isActionable ? "bg-amber-100" : "bg-slate-100"
                                                    }`}
                                                >
                                                    <StatusIcon
                                                        className={`h-6 w-6 ${
                                                            isActionable ? "text-amber-600" : config.color
                                                        }`}
                                                    />
                                                </div>

                                                {/* Content */}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div>
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <Building2 className="h-4 w-4 text-slate-400" />
                                                                <span className="font-semibold text-slate-900">
                                                                    {issue.property.nickname ||
                                                                        issue.property.address.split(",")[0]}
                                                                </span>
                                                            </div>
                                                            <p className="text-slate-600 line-clamp-2">
                                                                {issue.issueDescription || "No description"}
                                                            </p>
                                                        </div>
                                                        <ChevronRight className="h-5 w-5 text-slate-300 flex-shrink-0 mt-1" />
                                                    </div>

                                                    <div className="flex flex-wrap items-center gap-2 mt-3">
                                                        {getStatusBadge(issue.status)}
                                                        {issue.urgency && (
                                                            <span
                                                                className={`px-2 py-1 rounded-lg text-xs font-medium ${
                                                                    URGENCY_CONFIG[issue.urgency]?.bgColor
                                                                } ${URGENCY_CONFIG[issue.urgency]?.color}`}
                                                            >
                                                                {URGENCY_CONFIG[issue.urgency]?.label}
                                                            </span>
                                                        )}
                                                        {issue.photos && issue.photos.length > 0 && (
                                                            <span className="flex items-center gap-1 text-xs text-slate-500">
                                                                <ImageIcon className="h-3.5 w-3.5" />
                                                                {issue.photos.length} photo
                                                                {issue.photos.length > 1 ? "s" : ""}
                                                            </span>
                                                        )}
                                                        <span className="text-xs text-slate-400 ml-auto">
                                                            {formatDistanceToNow(new Date(issue.createdAt), {
                                                                addSuffix: true,
                                                            })}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Quote Banner */}
                                            {issue.quote && isActionable && (
                                                <div className="mt-4 p-4 bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border border-amber-200">
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <p className="text-sm font-medium text-amber-800">
                                                                Quote ready for approval
                                                            </p>
                                                            <p className="text-2xl font-bold text-slate-900 mt-1">
                                                                £{(issue.quote.totalPence / 100).toFixed(2)}
                                                            </p>
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setSelectedIssue(issue);
                                                                    setShowRejectModal(true);
                                                                }}
                                                                className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
                                                            >
                                                                Decline
                                                            </button>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    approveMutation.mutate(issue.id);
                                                                }}
                                                                disabled={approveMutation.isPending}
                                                                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-xl text-white text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
                                                            >
                                                                {approveMutation.isPending ? (
                                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                                ) : (
                                                                    <Check className="h-4 w-4" />
                                                                )}
                                                                Approve
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Issue Detail Sheet */}
            <AnimatePresence>
                {selectedIssue && !showRejectModal && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setSelectedIssue(null)}
                            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
                        />
                        <motion.div
                            initial={{ opacity: 0, y: "100%" }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: "100%" }}
                            transition={{ type: "spring", damping: 25, stiffness: 300 }}
                            className="fixed inset-x-0 bottom-0 top-12 sm:top-auto sm:max-h-[85vh] bg-white rounded-t-3xl z-50 overflow-hidden flex flex-col"
                        >
                            {/* Sheet Header */}
                            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
                                <div>
                                    <h2 className="text-lg font-bold text-slate-900">Issue Details</h2>
                                    <p className="text-sm text-slate-500">
                                        {selectedIssue.property.nickname ||
                                            selectedIssue.property.address.split(",")[0]}
                                    </p>
                                </div>
                                <button
                                    onClick={() => setSelectedIssue(null)}
                                    className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
                                >
                                    <X className="h-5 w-5 text-slate-500" />
                                </button>
                            </div>

                            {/* Sheet Content */}
                            <div className="flex-1 overflow-y-auto p-5 space-y-6">
                                {/* Status & Urgency */}
                                <div className="flex flex-wrap gap-2">
                                    {getStatusBadge(selectedIssue.status)}
                                    {selectedIssue.urgency && (
                                        <span
                                            className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                                                URGENCY_CONFIG[selectedIssue.urgency]?.bgColor
                                            } ${URGENCY_CONFIG[selectedIssue.urgency]?.color}`}
                                        >
                                            {URGENCY_CONFIG[selectedIssue.urgency]?.label} priority
                                        </span>
                                    )}
                                    {selectedIssue.issueCategory && (
                                        <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 capitalize">
                                            {selectedIssue.issueCategory.replace("_", " ")}
                                        </span>
                                    )}
                                </div>

                                {/* Property & Tenant Info */}
                                <div className="grid sm:grid-cols-2 gap-4">
                                    <div className="p-4 bg-slate-50 rounded-xl">
                                        <div className="flex items-center gap-2 text-slate-500 text-sm mb-2">
                                            <Home className="h-4 w-4" />
                                            Property
                                        </div>
                                        <p className="font-medium text-slate-900">
                                            {selectedIssue.property.nickname ||
                                                selectedIssue.property.address.split(",")[0]}
                                        </p>
                                        <p className="text-sm text-slate-500 mt-0.5">
                                            {selectedIssue.property.address},{" "}
                                            {selectedIssue.property.postcode}
                                        </p>
                                    </div>
                                    <div className="p-4 bg-slate-50 rounded-xl">
                                        <div className="flex items-center gap-2 text-slate-500 text-sm mb-2">
                                            <User className="h-4 w-4" />
                                            Tenant
                                        </div>
                                        <p className="font-medium text-slate-900">
                                            {selectedIssue.tenant.name}
                                        </p>
                                        <a
                                            href={`tel:${selectedIssue.tenant.phone}`}
                                            className="text-sm text-teal-600 hover:text-teal-700 flex items-center gap-1 mt-0.5"
                                        >
                                            <Phone className="h-3.5 w-3.5" />
                                            {selectedIssue.tenant.phone}
                                        </a>
                                    </div>
                                </div>

                                {/* Issue Description */}
                                <div>
                                    <h3 className="text-sm font-medium text-slate-500 mb-2">
                                        Issue Description
                                    </h3>
                                    <p className="text-slate-900">
                                        {selectedIssue.issueDescription || "No description provided"}
                                    </p>
                                </div>

                                {/* Photos */}
                                {selectedIssue.photos && selectedIssue.photos.length > 0 && (
                                    <div>
                                        <h3 className="text-sm font-medium text-slate-500 mb-3 flex items-center gap-2">
                                            <ImageIcon className="h-4 w-4" />
                                            Photos & Media ({selectedIssue.photos.length})
                                        </h3>
                                        <div className="flex gap-2 overflow-x-auto pb-2">
                                            {selectedIssue.photos.map((media, idx) => {
                                                const isVideo =
                                                    media.includes(".mp4") ||
                                                    media.includes(".mov") ||
                                                    media.includes(".webm");
                                                return isVideo ? (
                                                    <a
                                                        key={idx}
                                                        href={media}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex-shrink-0 relative group"
                                                    >
                                                        <div className="h-24 w-24 bg-slate-200 rounded-xl flex items-center justify-center group-hover:bg-slate-300 transition-colors">
                                                            <Play className="h-8 w-8 text-slate-600" />
                                                        </div>
                                                        <span className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1">
                                                            <Video className="h-2.5 w-2.5" /> Video
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
                                                            className="h-24 w-24 object-cover rounded-xl hover:opacity-90 transition-opacity"
                                                        />
                                                    </a>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* Chat History */}
                                {messagesData && messagesData.messages.length > 0 && (
                                    <div>
                                        <h3 className="text-sm font-medium text-slate-500 mb-3 flex items-center gap-2">
                                            <MessageCircle className="h-4 w-4" />
                                            Conversation
                                        </h3>
                                        <div className="bg-slate-50 rounded-xl p-4 max-h-64 overflow-y-auto space-y-3">
                                            {messagesLoading ? (
                                                <div className="flex justify-center py-4">
                                                    <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                                                </div>
                                            ) : (
                                                messagesData.messages.map((msg) => (
                                                    <div
                                                        key={msg.id}
                                                        className={`flex ${
                                                            msg.direction === "outbound"
                                                                ? "justify-end"
                                                                : "justify-start"
                                                        }`}
                                                    >
                                                        <div
                                                            className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                                                                msg.direction === "outbound"
                                                                    ? "bg-teal-600 text-white rounded-br-md"
                                                                    : "bg-white text-slate-900 border border-slate-200 rounded-bl-md"
                                                            }`}
                                                        >
                                                            {msg.type === "image" && msg.mediaUrl && (
                                                                <a
                                                                    href={msg.mediaUrl}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                >
                                                                    <img
                                                                        src={msg.mediaUrl}
                                                                        alt="Shared"
                                                                        className="max-h-32 rounded-lg mb-2"
                                                                    />
                                                                </a>
                                                            )}
                                                            {msg.content && (
                                                                <p className="text-sm whitespace-pre-wrap">
                                                                    {msg.content}
                                                                </p>
                                                            )}
                                                            <p
                                                                className={`text-[10px] mt-1 ${
                                                                    msg.direction === "outbound"
                                                                        ? "text-teal-200"
                                                                        : "text-slate-400"
                                                                }`}
                                                            >
                                                                {format(new Date(msg.createdAt), "HH:mm")}
                                                                {msg.direction === "outbound" && " • AI"}
                                                            </p>
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* AI Resolution Banner */}
                                {selectedIssue.aiResolutionAttempted && (
                                    <div className="p-4 bg-purple-50 rounded-xl border border-purple-200">
                                        <div className="flex items-start gap-3">
                                            <Sparkles className="h-5 w-5 text-purple-600 flex-shrink-0 mt-0.5" />
                                            <div>
                                                <p className="font-medium text-purple-900">
                                                    AI Troubleshooting{" "}
                                                    {selectedIssue.aiResolutionAccepted
                                                        ? "Successful"
                                                        : "Attempted"}
                                                </p>
                                                <p className="text-sm text-purple-700 mt-0.5">
                                                    {selectedIssue.aiResolutionAccepted
                                                        ? "The tenant resolved this issue with our AI guidance"
                                                        : "Our AI tried to help, but professional assistance is needed"}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Quote */}
                                {selectedIssue.quote && (
                                    <div className="p-5 bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border border-amber-200">
                                        <div className="flex items-center justify-between mb-3">
                                            <span className="text-sm font-medium text-amber-800">
                                                Quoted Amount
                                            </span>
                                            <span className="text-xs text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">
                                                {selectedIssue.quote.status}
                                            </span>
                                        </div>
                                        <p className="text-3xl font-bold text-slate-900">
                                            £{(selectedIssue.quote.totalPence / 100).toFixed(2)}
                                        </p>
                                        <p className="text-xs text-amber-700 mt-2">
                                            Includes all labour, parts, and VAT
                                        </p>
                                    </div>
                                )}

                                {/* Timestamps */}
                                <div className="text-xs text-slate-500 space-y-1 pt-4 border-t border-slate-100">
                                    <p>
                                        Reported:{" "}
                                        {format(new Date(selectedIssue.createdAt), "PPP 'at' p")}
                                    </p>
                                    {selectedIssue.resolvedAt && (
                                        <p>
                                            Resolved:{" "}
                                            {format(new Date(selectedIssue.resolvedAt), "PPP 'at' p")}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Action Buttons */}
                            {["quoted", "reported"].includes(selectedIssue.status) && (
                                <div className="p-5 border-t border-slate-100 flex gap-3 flex-shrink-0 bg-white">
                                    <button
                                        onClick={() => setShowRejectModal(true)}
                                        disabled={rejectMutation.isPending}
                                        className="flex-1 px-5 py-3.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-700 font-semibold flex items-center justify-center gap-2 transition-colors"
                                    >
                                        <ThumbsDown className="h-5 w-5" />
                                        Decline
                                    </button>
                                    <button
                                        onClick={() => approveMutation.mutate(selectedIssue.id)}
                                        disabled={approveMutation.isPending}
                                        className="flex-1 px-5 py-3.5 bg-emerald-600 hover:bg-emerald-700 rounded-xl text-white font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
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
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* Reject Modal */}
            <AnimatePresence>
                {showRejectModal && selectedIssue && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => {
                                setShowRejectModal(false);
                                setRejectReason("");
                            }}
                            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60]"
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="fixed inset-x-4 top-1/2 -translate-y-1/2 max-w-md mx-auto bg-white rounded-2xl p-6 z-[60] shadow-2xl"
                        >
                            <h3 className="text-lg font-bold text-slate-900 mb-2">Decline Quote</h3>
                            <p className="text-sm text-slate-500 mb-4">
                                Please let us know why you're declining this quote.
                            </p>
                            <textarea
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                                placeholder="e.g., Too expensive, will fix myself, getting other quotes..."
                                className="w-full h-24 px-4 py-3 border border-slate-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                            />
                            <div className="flex gap-3 mt-4">
                                <button
                                    onClick={() => {
                                        setShowRejectModal(false);
                                        setRejectReason("");
                                    }}
                                    className="flex-1 px-4 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-700 font-medium transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() =>
                                        rejectMutation.mutate({
                                            issueId: selectedIssue.id,
                                            reason: rejectReason,
                                        })
                                    }
                                    disabled={rejectMutation.isPending}
                                    className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 rounded-xl text-white font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                                >
                                    {rejectMutation.isPending ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        "Decline Quote"
                                    )}
                                </button>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
