import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { useState, useEffect } from "react";
import {
    Settings,
    ChevronLeft,
    AlertCircle,
    Loader2,
    Save,
    Bell,
    DollarSign,
    Shield,
    Wrench,
    Zap,
    Droplets,
    Lock,
    Paintbrush,
    ArrowUpCircle,
    Home,
    Flame,
    CheckCircle2,
} from "lucide-react";

interface LandlordSettings {
    id: string;
    landlordLeadId: string;
    autoApproveUnderPence: number;
    requireApprovalAbovePence: number;
    autoApproveCategories: string[];
    alwaysRequireApprovalCategories: string[];
    monthlyBudgetPence: number | null;
    budgetAlertThreshold: number;
    notifyOnAutoApprove: boolean;
    notifyOnCompletion: boolean;
    preferredChannel: string;
}

interface SettingsData {
    settings: LandlordSettings;
    currentSpend: number;
    landlord: {
        name: string;
        email: string | null;
    };
}

const CATEGORIES = [
    { id: "plumbing", label: "Plumbing", icon: Droplets },
    { id: "plumbing_emergency", label: "Plumbing Emergency", icon: Droplets },
    { id: "electrical", label: "Electrical", icon: Zap },
    { id: "electrical_emergency", label: "Electrical Emergency", icon: Zap },
    { id: "heating", label: "Heating", icon: Flame },
    { id: "security", label: "Security", icon: Lock },
    { id: "water_leak", label: "Water Leak", icon: Droplets },
    { id: "carpentry", label: "Carpentry", icon: Wrench },
    { id: "appliance", label: "Appliance Repair", icon: Home },
    { id: "cosmetic", label: "Cosmetic", icon: Paintbrush },
    { id: "upgrade", label: "Upgrade", icon: ArrowUpCircle },
    { id: "general", label: "General Maintenance", icon: Wrench },
];

export default function SettingsPage() {
    const { token } = useParams<{ token: string }>();
    const queryClient = useQueryClient();
    const [hasChanges, setHasChanges] = useState(false);
    const [localSettings, setLocalSettings] = useState<LandlordSettings | null>(null);

    const { data, isLoading, error } = useQuery<SettingsData>({
        queryKey: ["landlord-settings", token],
        queryFn: async () => {
            const res = await fetch(`/api/landlord/${token}/settings`);
            if (!res.ok) throw new Error("Settings not found");
            return res.json();
        },
        enabled: !!token,
    });

    useEffect(() => {
        if (data?.settings && !localSettings) {
            setLocalSettings(data.settings);
        }
    }, [data?.settings, localSettings]);

    const saveMutation = useMutation({
        mutationFn: async (settings: Partial<LandlordSettings>) => {
            const res = await fetch(`/api/landlord/${token}/settings`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(settings),
            });
            if (!res.ok) throw new Error("Failed to save settings");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["landlord-settings", token] });
            setHasChanges(false);
        },
    });

    const updateSetting = <K extends keyof LandlordSettings>(
        key: K,
        value: LandlordSettings[K]
    ) => {
        if (!localSettings) return;
        setLocalSettings({ ...localSettings, [key]: value });
        setHasChanges(true);
    };

    const toggleCategory = (category: string, list: "auto" | "require") => {
        if (!localSettings) return;

        if (list === "auto") {
            const current = localSettings.autoApproveCategories || [];
            const updated = current.includes(category)
                ? current.filter((c) => c !== category)
                : [...current, category];
            updateSetting("autoApproveCategories", updated);
            // Remove from other list
            if (localSettings.alwaysRequireApprovalCategories?.includes(category)) {
                updateSetting(
                    "alwaysRequireApprovalCategories",
                    localSettings.alwaysRequireApprovalCategories.filter((c) => c !== category)
                );
            }
        } else {
            const current = localSettings.alwaysRequireApprovalCategories || [];
            const updated = current.includes(category)
                ? current.filter((c) => c !== category)
                : [...current, category];
            updateSetting("alwaysRequireApprovalCategories", updated);
            // Remove from other list
            if (localSettings.autoApproveCategories?.includes(category)) {
                updateSetting(
                    "autoApproveCategories",
                    localSettings.autoApproveCategories.filter((c) => c !== category)
                );
            }
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gray-900 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500" />
            </div>
        );
    }

    if (error || !data || !localSettings) {
        return (
            <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
                <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 max-w-md text-center">
                    <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                    <h1 className="text-xl font-semibold text-white mb-2">Settings Not Found</h1>
                    <p className="text-gray-400">Unable to load your settings.</p>
                </div>
            </div>
        );
    }

    const spendPercentage = data.settings.monthlyBudgetPence
        ? Math.round((data.currentSpend / data.settings.monthlyBudgetPence) * 100)
        : 0;

    return (
        <div className="min-h-screen bg-gray-900 py-8 px-4">
            <div className="max-w-2xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                        <Link href={`/landlord/${token}/properties`}>
                            <button className="p-2 hover:bg-gray-800 rounded-lg transition-colors">
                                <ChevronLeft className="h-5 w-5 text-gray-400" />
                            </button>
                        </Link>
                        <div>
                            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                                <Settings className="h-6 w-6 text-yellow-500" />
                                Auto-Approval Rules
                            </h1>
                            <p className="text-gray-400 text-sm mt-1">
                                Configure automatic repair approvals
                            </p>
                        </div>
                    </div>
                </div>

                {/* Save Button (Floating) */}
                {hasChanges && (
                    <div className="fixed bottom-6 right-6 z-50">
                        <button
                            onClick={() => saveMutation.mutate(localSettings)}
                            disabled={saveMutation.isPending}
                            className="px-6 py-3 bg-yellow-500 hover:bg-yellow-400 rounded-xl text-black font-medium flex items-center gap-2 shadow-lg transition-colors"
                        >
                            {saveMutation.isPending ? (
                                <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                                <Save className="h-5 w-5" />
                            )}
                            Save Changes
                        </button>
                    </div>
                )}

                {/* Success Message */}
                {saveMutation.isSuccess && !hasChanges && (
                    <div className="mb-6 p-4 bg-green-500/20 border border-green-500/30 rounded-xl flex items-center gap-3">
                        <CheckCircle2 className="h-5 w-5 text-green-400" />
                        <p className="text-green-400">Settings saved successfully</p>
                    </div>
                )}

                {/* Price Thresholds */}
                <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 mb-6">
                    <div className="flex items-center gap-2 mb-4">
                        <DollarSign className="h-5 w-5 text-yellow-500" />
                        <h2 className="text-lg font-semibold text-white">Price Thresholds</h2>
                    </div>

                    <div className="grid gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-2">
                                Auto-approve repairs under
                            </label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                                    £
                                </span>
                                <input
                                    type="number"
                                    value={localSettings.autoApproveUnderPence / 100}
                                    onChange={(e) =>
                                        updateSetting(
                                            "autoApproveUnderPence",
                                            Math.round(parseFloat(e.target.value) * 100)
                                        )
                                    }
                                    className="w-full pl-8 pr-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
                                />
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                                Repairs below this amount will be auto-approved (if category allows)
                            </p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-2">
                                Always require approval above
                            </label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                                    £
                                </span>
                                <input
                                    type="number"
                                    value={localSettings.requireApprovalAbovePence / 100}
                                    onChange={(e) =>
                                        updateSetting(
                                            "requireApprovalAbovePence",
                                            Math.round(parseFloat(e.target.value) * 100)
                                        )
                                    }
                                    className="w-full pl-8 pr-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white text-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
                                />
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                                Repairs above this amount will always require your approval
                            </p>
                        </div>
                    </div>
                </div>

                {/* Category Rules */}
                <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 mb-6">
                    <div className="flex items-center gap-2 mb-4">
                        <Shield className="h-5 w-5 text-yellow-500" />
                        <h2 className="text-lg font-semibold text-white">Category Rules</h2>
                    </div>

                    <div className="space-y-6">
                        {/* Auto-approve categories */}
                        <div>
                            <h3 className="text-sm font-medium text-green-400 mb-3">
                                Always Auto-Approve (when under threshold)
                            </h3>
                            <div className="flex flex-wrap gap-2">
                                {CATEGORIES.map((cat) => {
                                    const isSelected =
                                        localSettings.autoApproveCategories?.includes(cat.id);
                                    return (
                                        <button
                                            key={cat.id}
                                            onClick={() => toggleCategory(cat.id, "auto")}
                                            className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${
                                                isSelected
                                                    ? "bg-green-500/20 text-green-400 border border-green-500/30"
                                                    : "bg-gray-700 text-gray-400 border border-gray-600 hover:border-gray-500"
                                            }`}
                                        >
                                            <cat.icon className="h-4 w-4" />
                                            {cat.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Always require approval */}
                        <div>
                            <h3 className="text-sm font-medium text-red-400 mb-3">
                                Always Require Approval
                            </h3>
                            <div className="flex flex-wrap gap-2">
                                {CATEGORIES.map((cat) => {
                                    const isSelected =
                                        localSettings.alwaysRequireApprovalCategories?.includes(
                                            cat.id
                                        );
                                    return (
                                        <button
                                            key={cat.id}
                                            onClick={() => toggleCategory(cat.id, "require")}
                                            className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${
                                                isSelected
                                                    ? "bg-red-500/20 text-red-400 border border-red-500/30"
                                                    : "bg-gray-700 text-gray-400 border border-gray-600 hover:border-gray-500"
                                            }`}
                                        >
                                            <cat.icon className="h-4 w-4" />
                                            {cat.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Monthly Budget */}
                <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 mb-6">
                    <div className="flex items-center gap-2 mb-4">
                        <DollarSign className="h-5 w-5 text-yellow-500" />
                        <h2 className="text-lg font-semibold text-white">Monthly Budget</h2>
                        <span className="text-xs text-gray-500">(optional)</span>
                    </div>

                    <div className="grid gap-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-2">
                                    Budget
                                </label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                                        £
                                    </span>
                                    <input
                                        type="number"
                                        value={
                                            localSettings.monthlyBudgetPence
                                                ? localSettings.monthlyBudgetPence / 100
                                                : ""
                                        }
                                        onChange={(e) =>
                                            updateSetting(
                                                "monthlyBudgetPence",
                                                e.target.value
                                                    ? Math.round(parseFloat(e.target.value) * 100)
                                                    : null
                                            )
                                        }
                                        placeholder="No limit"
                                        className="w-full pl-8 pr-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-yellow-500"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-2">
                                    Alert at (%)
                                </label>
                                <input
                                    type="number"
                                    value={localSettings.budgetAlertThreshold}
                                    onChange={(e) =>
                                        updateSetting(
                                            "budgetAlertThreshold",
                                            parseInt(e.target.value)
                                        )
                                    }
                                    min={0}
                                    max={100}
                                    className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-yellow-500"
                                />
                            </div>
                        </div>

                        {localSettings.monthlyBudgetPence && (
                            <div>
                                <div className="flex items-center justify-between text-sm mb-2">
                                    <span className="text-gray-400">Current spend</span>
                                    <span className="text-white font-medium">
                                        £{(data.currentSpend / 100).toFixed(2)} / £
                                        {(localSettings.monthlyBudgetPence / 100).toFixed(2)}
                                    </span>
                                </div>
                                <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full transition-all ${
                                            spendPercentage >= localSettings.budgetAlertThreshold
                                                ? "bg-red-500"
                                                : spendPercentage >= 50
                                                ? "bg-yellow-500"
                                                : "bg-green-500"
                                        }`}
                                        style={{ width: `${Math.min(spendPercentage, 100)}%` }}
                                    />
                                </div>
                                <p className="text-xs text-gray-500 mt-1">
                                    {spendPercentage}% of monthly budget used
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Notifications */}
                <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <Bell className="h-5 w-5 text-yellow-500" />
                        <h2 className="text-lg font-semibold text-white">Notifications</h2>
                    </div>

                    <div className="space-y-4">
                        <label className="flex items-center justify-between p-3 bg-gray-700/50 rounded-lg cursor-pointer">
                            <div>
                                <p className="text-white font-medium">Auto-approval notifications</p>
                                <p className="text-xs text-gray-400">
                                    Get notified when repairs are auto-approved
                                </p>
                            </div>
                            <input
                                type="checkbox"
                                checked={localSettings.notifyOnAutoApprove}
                                onChange={(e) =>
                                    updateSetting("notifyOnAutoApprove", e.target.checked)
                                }
                                className="h-5 w-5 rounded bg-gray-600 border-gray-500 text-yellow-500 focus:ring-yellow-500"
                            />
                        </label>

                        <label className="flex items-center justify-between p-3 bg-gray-700/50 rounded-lg cursor-pointer">
                            <div>
                                <p className="text-white font-medium">Completion notifications</p>
                                <p className="text-xs text-gray-400">
                                    Get notified when jobs are completed
                                </p>
                            </div>
                            <input
                                type="checkbox"
                                checked={localSettings.notifyOnCompletion}
                                onChange={(e) =>
                                    updateSetting("notifyOnCompletion", e.target.checked)
                                }
                                className="h-5 w-5 rounded bg-gray-600 border-gray-500 text-yellow-500 focus:ring-yellow-500"
                            />
                        </label>

                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-2">
                                Preferred channel
                            </label>
                            <select
                                value={localSettings.preferredChannel}
                                onChange={(e) =>
                                    updateSetting("preferredChannel", e.target.value)
                                }
                                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-yellow-500"
                            >
                                <option value="whatsapp">WhatsApp</option>
                                <option value="email">Email</option>
                                <option value="dashboard">Dashboard only</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="mt-8 text-center">
                    <p className="text-xs text-gray-500">
                        Changes are saved automatically when you click Save
                    </p>
                </div>
            </div>
        </div>
    );
}
