import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { useState } from "react";
import {
    Home,
    Bell,
    Settings,
    ChevronRight,
    AlertCircle,
    CheckCircle2,
    Clock,
    Wrench,
    TrendingUp,
    Shield,
    Star,
    Building2,
    MessageSquare,
    Zap,
    ArrowRight,
    Sparkles,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";

interface DashboardData {
    landlord: {
        customerName: string;
        email: string;
    };
    stats: {
        totalProperties: number;
        totalIssues: number;
        openIssues: number;
        resolvedThisMonth: number;
        diyResolved: number;
        avgResolutionDays: number;
    };
    recentIssues: Array<{
        id: string;
        status: string;
        issueDescription: string | null;
        urgency: string | null;
        createdAt: string;
        property: {
            nickname: string | null;
            address: string;
        };
        quote?: {
            totalPence: number;
        } | null;
    }>;
    properties: Array<{
        id: string;
        nickname: string | null;
        address: string;
        openIssueCount: number;
    }>;
}

const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: {
            staggerChildren: 0.08,
            delayChildren: 0.1,
        },
    },
};

const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] },
    },
};

const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
};

const getUrgencyColor = (urgency: string | null) => {
    switch (urgency) {
        case "emergency":
            return "bg-red-50 text-red-700 border-red-200";
        case "high":
            return "bg-amber-50 text-amber-700 border-amber-200";
        case "medium":
            return "bg-blue-50 text-blue-700 border-blue-200";
        default:
            return "bg-slate-50 text-slate-600 border-slate-200";
    }
};

const getStatusConfig = (status: string) => {
    const configs: Record<string, { label: string; color: string; icon: typeof Clock }> = {
        new: { label: "New", color: "text-blue-600", icon: Clock },
        ai_helping: { label: "AI Helping", color: "text-purple-600", icon: MessageSquare },
        quoted: { label: "Needs Approval", color: "text-amber-600", icon: AlertCircle },
        approved: { label: "Approved", color: "text-teal-600", icon: CheckCircle2 },
        completed: { label: "Completed", color: "text-green-600", icon: CheckCircle2 },
        resolved_diy: { label: "DIY Fixed", color: "text-emerald-600", icon: Wrench },
    };
    return configs[status] || configs.new;
};

export default function DashboardPage() {
    const { token } = useParams<{ token: string }>();
    const [hoveredProperty, setHoveredProperty] = useState<string | null>(null);

    const { data, isLoading, error } = useQuery<DashboardData>({
        queryKey: ["landlord-dashboard", token],
        queryFn: async () => {
            const [profileRes, issuesRes, propertiesRes] = await Promise.all([
                fetch(`/api/landlord/${token}/profile`),
                fetch(`/api/landlord/${token}/issues`),
                fetch(`/api/landlord/${token}/properties`),
            ]);

            const profile = await profileRes.json();
            const issuesData = await issuesRes.json();
            const propertiesData = await propertiesRes.json();

            return {
                landlord: profile,
                stats: {
                    totalProperties: propertiesData.properties?.length || 0,
                    totalIssues: issuesData.stats?.total || 0,
                    openIssues: issuesData.stats?.open || 0,
                    resolvedThisMonth: issuesData.stats?.resolved || 0,
                    diyResolved: issuesData.stats?.diyResolved || 0,
                    avgResolutionDays: 2.4,
                },
                recentIssues: issuesData.issues?.slice(0, 5) || [],
                properties: propertiesData.properties || [],
            };
        },
        enabled: !!token,
    });

    if (isLoading) {
        return (
            <div className="min-h-screen bg-stone-50 flex items-center justify-center">
                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col items-center gap-4"
                >
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center">
                        <Building2 className="h-6 w-6 text-white animate-pulse" />
                    </div>
                    <p className="text-slate-500 font-medium">Loading your dashboard...</p>
                </motion.div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-8 max-w-md text-center">
                    <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
                        <AlertCircle className="h-8 w-8 text-red-500" />
                    </div>
                    <h1 className="text-xl font-semibold text-slate-900 mb-2">Unable to Load Dashboard</h1>
                    <p className="text-slate-500">Please check your link and try again.</p>
                </div>
            </div>
        );
    }

    const firstName = data.landlord.customerName?.split(" ")[0] || "there";
    const needsAttention = data.recentIssues.filter(
        (i) => i.status === "quoted" || i.status === "reported"
    ).length;

    return (
        <div className="min-h-screen bg-stone-50 font-jakarta">
            {/* Subtle gradient header */}
            <div className="bg-gradient-to-b from-white to-stone-50 border-b border-stone-200/60">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
                    <div className="flex items-center justify-between">
                        {/* Logo */}
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center shadow-lg shadow-teal-500/25">
                                <Home className="h-5 w-5 text-white" />
                            </div>
                            <div className="hidden sm:block">
                                <p className="font-semibold text-slate-900">Handy Services</p>
                                <p className="text-xs text-slate-500">Property Portal</p>
                            </div>
                        </div>

                        {/* Trust badge */}
                        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-full border border-emerald-200">
                            <Shield className="h-4 w-4 text-emerald-600" />
                            <span className="text-xs font-medium text-emerald-700">£2M Insured</span>
                            <span className="text-emerald-300">•</span>
                            <Star className="h-3.5 w-3.5 text-emerald-600 fill-emerald-600" />
                            <span className="text-xs font-medium text-emerald-700">4.9 Rated</span>
                        </div>

                        {/* Nav */}
                        <div className="flex items-center gap-2">
                            <Link href={`/landlord/${token}/issues`}>
                                <button className="relative p-2.5 rounded-xl hover:bg-slate-100 transition-colors">
                                    <Bell className="h-5 w-5 text-slate-600" />
                                    {needsAttention > 0 && (
                                        <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-amber-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center">
                                            {needsAttention}
                                        </span>
                                    )}
                                </button>
                            </Link>
                            <Link href={`/landlord/${token}/settings`}>
                                <button className="p-2.5 rounded-xl hover:bg-slate-100 transition-colors">
                                    <Settings className="h-5 w-5 text-slate-600" />
                                </button>
                            </Link>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main content */}
            <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="max-w-6xl mx-auto px-4 sm:px-6 py-8"
            >
                {/* Welcome Section */}
                <motion.div variants={itemVariants} className="mb-8">
                    <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-1">
                        {getGreeting()}, {firstName} 👋
                    </h1>
                    <p className="text-slate-500">
                        {needsAttention > 0 ? (
                            <span>
                                You have{" "}
                                <span className="text-amber-600 font-medium">
                                    {needsAttention} issue{needsAttention > 1 ? "s" : ""}
                                </span>{" "}
                                waiting for your review
                            </span>
                        ) : (
                            "All your properties are running smoothly"
                        )}
                    </p>
                </motion.div>

                {/* Bento Stats Grid */}
                <motion.div
                    variants={itemVariants}
                    className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8"
                >
                    {/* Properties - Large card */}
                    <Link href={`/landlord/${token}/properties`} className="col-span-2 lg:col-span-1">
                        <motion.div
                            whileHover={{ y: -2, boxShadow: "0 20px 40px -12px rgba(0,0,0,0.1)" }}
                            className="h-full bg-gradient-to-br from-teal-500 to-teal-600 rounded-2xl p-5 text-white cursor-pointer transition-shadow"
                        >
                            <div className="flex items-start justify-between mb-4">
                                <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                                    <Building2 className="h-5 w-5 text-white" />
                                </div>
                                <ChevronRight className="h-5 w-5 text-white/60" />
                            </div>
                            <p className="text-4xl font-bold mb-1">{data.stats.totalProperties}</p>
                            <p className="text-teal-100 text-sm">Properties managed</p>
                        </motion.div>
                    </Link>

                    {/* Open Issues */}
                    <Link href={`/landlord/${token}/issues`}>
                        <motion.div
                            whileHover={{ y: -2 }}
                            className={`h-full rounded-2xl p-5 cursor-pointer transition-all ${
                                data.stats.openIssues > 0
                                    ? "bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-amber-200"
                                    : "bg-white border border-slate-200"
                            }`}
                        >
                            <div className="flex items-start justify-between mb-4">
                                <div
                                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                                        data.stats.openIssues > 0
                                            ? "bg-amber-500"
                                            : "bg-slate-100"
                                    }`}
                                >
                                    <AlertCircle
                                        className={`h-5 w-5 ${
                                            data.stats.openIssues > 0 ? "text-white" : "text-slate-400"
                                        }`}
                                    />
                                </div>
                                {data.stats.openIssues > 0 && (
                                    <span className="px-2 py-0.5 bg-amber-500 text-white text-xs font-medium rounded-full">
                                        Action needed
                                    </span>
                                )}
                            </div>
                            <p className="text-3xl font-bold text-slate-900 mb-1">
                                {data.stats.openIssues}
                            </p>
                            <p className="text-slate-500 text-sm">Open issues</p>
                        </motion.div>
                    </Link>

                    {/* Resolved This Month */}
                    <motion.div
                        whileHover={{ y: -2 }}
                        className="bg-white rounded-2xl border border-slate-200 p-5"
                    >
                        <div className="flex items-start justify-between mb-4">
                            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                            </div>
                            <div className="flex items-center gap-1 text-emerald-600 text-sm font-medium">
                                <TrendingUp className="h-4 w-4" />
                                +{data.stats.resolvedThisMonth}
                            </div>
                        </div>
                        <p className="text-3xl font-bold text-slate-900 mb-1">
                            {data.stats.resolvedThisMonth}
                        </p>
                        <p className="text-slate-500 text-sm">Resolved this month</p>
                    </motion.div>

                    {/* DIY Savings */}
                    <motion.div
                        whileHover={{ y: -2 }}
                        className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-2xl border border-purple-200 p-5"
                    >
                        <div className="flex items-start justify-between mb-4">
                            <div className="w-10 h-10 rounded-xl bg-purple-500 flex items-center justify-center">
                                <Sparkles className="h-5 w-5 text-white" />
                            </div>
                        </div>
                        <p className="text-3xl font-bold text-slate-900 mb-1">
                            {data.stats.diyResolved}
                        </p>
                        <p className="text-slate-500 text-sm">Fixed by AI guidance</p>
                        {data.stats.diyResolved > 0 && (
                            <p className="text-xs text-purple-600 mt-2 font-medium">
                                ~£{data.stats.diyResolved * 85} saved
                            </p>
                        )}
                    </motion.div>
                </motion.div>

                {/* Two Column Layout */}
                <div className="grid lg:grid-cols-5 gap-6">
                    {/* Recent Issues - Takes more space */}
                    <motion.div variants={itemVariants} className="lg:col-span-3">
                        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                                <div>
                                    <h2 className="font-semibold text-slate-900">Recent Issues</h2>
                                    <p className="text-sm text-slate-500">Latest maintenance requests</p>
                                </div>
                                <Link href={`/landlord/${token}/issues`}>
                                    <button className="text-sm text-teal-600 hover:text-teal-700 font-medium flex items-center gap-1">
                                        View all
                                        <ArrowRight className="h-4 w-4" />
                                    </button>
                                </Link>
                            </div>

                            <div className="divide-y divide-slate-100">
                                {data.recentIssues.length === 0 ? (
                                    <div className="p-8 text-center">
                                        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
                                            <CheckCircle2 className="h-6 w-6 text-slate-400" />
                                        </div>
                                        <p className="text-slate-500">No issues reported yet</p>
                                        <p className="text-sm text-slate-400 mt-1">
                                            When tenants report issues, they'll appear here
                                        </p>
                                    </div>
                                ) : (
                                    data.recentIssues.map((issue) => {
                                        const statusConfig = getStatusConfig(issue.status);
                                        const StatusIcon = statusConfig.icon;

                                        return (
                                            <Link
                                                key={issue.id}
                                                href={`/landlord/${token}/issues`}
                                            >
                                                <motion.div
                                                    whileHover={{ backgroundColor: "rgb(249 250 251)" }}
                                                    className="px-5 py-4 cursor-pointer transition-colors"
                                                >
                                                    <div className="flex items-start gap-4">
                                                        <div
                                                            className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                                                                issue.status === "quoted"
                                                                    ? "bg-amber-100"
                                                                    : "bg-slate-100"
                                                            }`}
                                                        >
                                                            <StatusIcon
                                                                className={`h-5 w-5 ${statusConfig.color}`}
                                                            />
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-start justify-between gap-2">
                                                                <div>
                                                                    <p className="font-medium text-slate-900 truncate">
                                                                        {issue.property.nickname ||
                                                                            issue.property.address.split(",")[0]}
                                                                    </p>
                                                                    <p className="text-sm text-slate-500 line-clamp-1 mt-0.5">
                                                                        {issue.issueDescription ||
                                                                            "No description"}
                                                                    </p>
                                                                </div>
                                                                {issue.quote && issue.status === "quoted" && (
                                                                    <span className="px-2.5 py-1 bg-amber-500 text-white text-xs font-medium rounded-lg flex-shrink-0">
                                                                        £{(issue.quote.totalPence / 100).toFixed(0)}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-3 mt-2">
                                                                <span
                                                                    className={`text-xs font-medium ${statusConfig.color}`}
                                                                >
                                                                    {statusConfig.label}
                                                                </span>
                                                                {issue.urgency && (
                                                                    <span
                                                                        className={`px-2 py-0.5 text-xs font-medium rounded-full border ${getUrgencyColor(
                                                                            issue.urgency
                                                                        )}`}
                                                                    >
                                                                        {issue.urgency}
                                                                    </span>
                                                                )}
                                                                <span className="text-xs text-slate-400">
                                                                    {formatDistanceToNow(
                                                                        new Date(issue.createdAt),
                                                                        { addSuffix: true }
                                                                    )}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <ChevronRight className="h-5 w-5 text-slate-300 flex-shrink-0" />
                                                    </div>
                                                </motion.div>
                                            </Link>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    </motion.div>

                    {/* Properties Sidebar */}
                    <motion.div variants={itemVariants} className="lg:col-span-2">
                        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                                <div>
                                    <h2 className="font-semibold text-slate-900">Your Properties</h2>
                                    <p className="text-sm text-slate-500">Quick overview</p>
                                </div>
                                <Link href={`/landlord/${token}/properties`}>
                                    <button className="text-sm text-teal-600 hover:text-teal-700 font-medium flex items-center gap-1">
                                        Manage
                                        <ArrowRight className="h-4 w-4" />
                                    </button>
                                </Link>
                            </div>

                            <div className="p-3 space-y-2">
                                {data.properties.length === 0 ? (
                                    <div className="p-6 text-center">
                                        <p className="text-slate-500 text-sm">No properties yet</p>
                                        <Link href={`/landlord/${token}/properties`}>
                                            <button className="mt-3 text-sm text-teal-600 hover:text-teal-700 font-medium">
                                                Add your first property →
                                            </button>
                                        </Link>
                                    </div>
                                ) : (
                                    data.properties.slice(0, 4).map((property) => (
                                        <motion.div
                                            key={property.id}
                                            onHoverStart={() => setHoveredProperty(property.id)}
                                            onHoverEnd={() => setHoveredProperty(null)}
                                            whileHover={{ scale: 1.01 }}
                                            className={`p-3 rounded-xl cursor-pointer transition-colors ${
                                                hoveredProperty === property.id
                                                    ? "bg-slate-50"
                                                    : "bg-white"
                                            }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center flex-shrink-0">
                                                    <Home className="h-5 w-5 text-slate-500" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-medium text-slate-900 truncate">
                                                        {property.nickname ||
                                                            property.address.split(",")[0]}
                                                    </p>
                                                    <div className="flex items-center gap-2 mt-0.5">
                                                        {property.openIssueCount > 0 ? (
                                                            <span className="text-xs text-amber-600 font-medium">
                                                                {property.openIssueCount} open issue
                                                                {property.openIssueCount > 1 ? "s" : ""}
                                                            </span>
                                                        ) : (
                                                            <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                                                                <CheckCircle2 className="h-3 w-3" />
                                                                All good
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </motion.div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Quick Actions */}
                        <motion.div
                            variants={itemVariants}
                            className="mt-4 bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-5 text-white"
                        >
                            <div className="flex items-start gap-3 mb-4">
                                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                                    <Zap className="h-5 w-5 text-amber-400" />
                                </div>
                                <div>
                                    <h3 className="font-semibold">Need Help?</h3>
                                    <p className="text-sm text-slate-400 mt-0.5">
                                        Our team responds within 24 hours
                                    </p>
                                </div>
                            </div>
                            <a
                                href="https://wa.me/447508744402"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <button className="w-full py-2.5 bg-white/10 hover:bg-white/20 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2">
                                    <MessageSquare className="h-4 w-4" />
                                    Message us on WhatsApp
                                </button>
                            </a>
                        </motion.div>
                    </motion.div>
                </div>

                {/* Footer */}
                <motion.div variants={itemVariants} className="mt-12 text-center">
                    <p className="text-sm text-slate-400">
                        Handy Services Property Portal • Keeping your properties maintained
                    </p>
                </motion.div>
            </motion.div>
        </div>
    );
}
