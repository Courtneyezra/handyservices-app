import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { useState } from "react";
import {
    Home,
    Plus,
    MapPin,
    User,
    Phone,
    ChevronRight,
    AlertCircle,
    Loader2,
    Settings,
    FileWarning,
    Edit,
    Trash2,
    MessageCircle,
    Building2,
    X,
    Copy,
    Check,
} from "lucide-react";
import { format } from "date-fns";

interface Tenant {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    isPrimary: boolean;
    isActive: boolean;
    whatsappOptIn: boolean;
    lastContactAt: string | null;
}

interface Property {
    id: string;
    address: string;
    postcode: string;
    propertyType: string | null;
    nickname: string | null;
    isActive: boolean;
    createdAt: string;
    tenants: Tenant[];
    openIssueCount: number;
}

interface LandlordProfile {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
}

interface PropertiesData {
    landlord: LandlordProfile;
    properties: Property[];
}

export default function PropertiesPage() {
    const { token } = useParams<{ token: string }>();
    const queryClient = useQueryClient();
    const [showAddProperty, setShowAddProperty] = useState(false);
    const [showAddTenant, setShowAddTenant] = useState<string | null>(null);
    const [copiedLink, setCopiedLink] = useState<string | null>(null);
    const [newProperty, setNewProperty] = useState({
        address: "",
        postcode: "",
        propertyType: "flat",
        nickname: "",
    });
    const [newTenant, setNewTenant] = useState({
        name: "",
        phone: "",
        email: "",
    });

    const { data, isLoading, error } = useQuery<PropertiesData>({
        queryKey: ["landlord-properties", token],
        queryFn: async () => {
            const res = await fetch(`/api/landlord/${token}/properties`);
            if (!res.ok) throw new Error("Portal not found");
            return res.json();
        },
        enabled: !!token,
    });

    const addPropertyMutation = useMutation({
        mutationFn: async (property: typeof newProperty) => {
            const res = await fetch(`/api/landlord/${token}/properties`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(property),
            });
            if (!res.ok) throw new Error("Failed to add property");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["landlord-properties", token] });
            setShowAddProperty(false);
            setNewProperty({ address: "", postcode: "", propertyType: "flat", nickname: "" });
        },
    });

    const addTenantMutation = useMutation({
        mutationFn: async ({ propertyId, tenant }: { propertyId: string; tenant: typeof newTenant }) => {
            const res = await fetch(`/api/landlord/${token}/properties/${propertyId}/tenants`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(tenant),
            });
            if (!res.ok) throw new Error("Failed to add tenant");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["landlord-properties", token] });
            setShowAddTenant(null);
            setNewTenant({ name: "", phone: "", email: "" });
        },
    });

    const deletePropertyMutation = useMutation({
        mutationFn: async (propertyId: string) => {
            const res = await fetch(`/api/landlord/${token}/properties/${propertyId}`, {
                method: "DELETE",
            });
            if (!res.ok) throw new Error("Failed to delete property");
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["landlord-properties", token] });
        },
    });

    const copyWhatsAppLink = (tenant: Tenant) => {
        const baseNumber = process.env.VITE_WHATSAPP_NUMBER || "447700900123";
        const link = `https://wa.me/${baseNumber}?text=Hi, I'm ${tenant.name} reporting an issue`;
        navigator.clipboard.writeText(link);
        setCopiedLink(tenant.id);
        setTimeout(() => setCopiedLink(null), 2000);
    };

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
                    <h1 className="text-xl font-semibold text-white mb-2">Portal Not Found</h1>
                    <p className="text-gray-400">This link may have expired or is invalid.</p>
                </div>
            </div>
        );
    }

    const { landlord, properties } = data;

    return (
        <div className="min-h-screen bg-gray-900 py-8 px-4">
            <div className="max-w-3xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-2xl font-bold text-white">Your Properties</h1>
                        <p className="text-gray-400 text-sm mt-1">
                            Manage properties and tenants
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Link href={`/landlord/${token}/settings`}>
                            <button className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg border border-gray-700 transition-colors">
                                <Settings className="h-5 w-5 text-gray-400" />
                            </button>
                        </Link>
                        <Link href={`/landlord/${token}/issues`}>
                            <button className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg border border-gray-700 transition-colors">
                                <FileWarning className="h-5 w-5 text-gray-400" />
                            </button>
                        </Link>
                    </div>
                </div>

                {/* Add Property Button */}
                <button
                    onClick={() => setShowAddProperty(true)}
                    className="w-full mb-6 p-4 bg-yellow-500 hover:bg-yellow-400 rounded-xl text-black font-medium flex items-center justify-center gap-2 transition-colors"
                >
                    <Plus className="h-5 w-5" />
                    Add Property
                </button>

                {/* Add Property Modal */}
                {showAddProperty && (
                    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
                        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 w-full max-w-md">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-semibold text-white">Add Property</h2>
                                <button
                                    onClick={() => setShowAddProperty(false)}
                                    className="p-1 hover:bg-gray-700 rounded"
                                >
                                    <X className="h-5 w-5 text-gray-400" />
                                </button>
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">
                                        Address
                                    </label>
                                    <input
                                        type="text"
                                        value={newProperty.address}
                                        onChange={(e) =>
                                            setNewProperty({ ...newProperty, address: e.target.value })
                                        }
                                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-yellow-500"
                                        placeholder="123 Main Street"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">
                                        Postcode
                                    </label>
                                    <input
                                        type="text"
                                        value={newProperty.postcode}
                                        onChange={(e) =>
                                            setNewProperty({ ...newProperty, postcode: e.target.value })
                                        }
                                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-yellow-500"
                                        placeholder="NW1 6XE"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">
                                        Property Type
                                    </label>
                                    <select
                                        value={newProperty.propertyType}
                                        onChange={(e) =>
                                            setNewProperty({ ...newProperty, propertyType: e.target.value })
                                        }
                                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-yellow-500"
                                    >
                                        <option value="flat">Flat</option>
                                        <option value="house">House</option>
                                        <option value="commercial">Commercial</option>
                                        <option value="hmo">HMO</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">
                                        Nickname (optional)
                                    </label>
                                    <input
                                        type="text"
                                        value={newProperty.nickname}
                                        onChange={(e) =>
                                            setNewProperty({ ...newProperty, nickname: e.target.value })
                                        }
                                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-yellow-500"
                                        placeholder="Baker Street Flat"
                                    />
                                </div>
                                <div className="flex gap-3 pt-2">
                                    <button
                                        onClick={() => setShowAddProperty(false)}
                                        className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => addPropertyMutation.mutate(newProperty)}
                                        disabled={!newProperty.address || !newProperty.postcode}
                                        className="flex-1 px-4 py-2 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-black font-medium transition-colors"
                                    >
                                        {addPropertyMutation.isPending ? (
                                            <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                                        ) : (
                                            "Add Property"
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Add Tenant Modal */}
                {showAddTenant && (
                    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
                        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 w-full max-w-md">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-semibold text-white">Add Tenant</h2>
                                <button
                                    onClick={() => setShowAddTenant(null)}
                                    className="p-1 hover:bg-gray-700 rounded"
                                >
                                    <X className="h-5 w-5 text-gray-400" />
                                </button>
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">
                                        Name
                                    </label>
                                    <input
                                        type="text"
                                        value={newTenant.name}
                                        onChange={(e) =>
                                            setNewTenant({ ...newTenant, name: e.target.value })
                                        }
                                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-yellow-500"
                                        placeholder="John Smith"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">
                                        Phone (WhatsApp)
                                    </label>
                                    <input
                                        type="tel"
                                        value={newTenant.phone}
                                        onChange={(e) =>
                                            setNewTenant({ ...newTenant, phone: e.target.value })
                                        }
                                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-yellow-500"
                                        placeholder="+447700900123"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">
                                        Email (optional)
                                    </label>
                                    <input
                                        type="email"
                                        value={newTenant.email}
                                        onChange={(e) =>
                                            setNewTenant({ ...newTenant, email: e.target.value })
                                        }
                                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-yellow-500"
                                        placeholder="tenant@email.com"
                                    />
                                </div>
                                <div className="flex gap-3 pt-2">
                                    <button
                                        onClick={() => setShowAddTenant(null)}
                                        className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() =>
                                            addTenantMutation.mutate({
                                                propertyId: showAddTenant,
                                                tenant: newTenant,
                                            })
                                        }
                                        disabled={!newTenant.name || !newTenant.phone}
                                        className="flex-1 px-4 py-2 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-black font-medium transition-colors"
                                    >
                                        {addTenantMutation.isPending ? (
                                            <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                                        ) : (
                                            "Add Tenant"
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Properties List */}
                {properties.length === 0 ? (
                    <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 text-center">
                        <Building2 className="h-12 w-12 text-gray-600 mx-auto mb-3" />
                        <p className="text-gray-400">No properties yet</p>
                        <p className="text-sm text-gray-500 mt-1">
                            Add your first property to get started
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {properties.map((property) => (
                            <div
                                key={property.id}
                                className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden"
                            >
                                {/* Property Header */}
                                <div className="p-4 border-b border-gray-700">
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <Home className="h-5 w-5 text-yellow-500" />
                                                <h3 className="text-lg font-semibold text-white">
                                                    {property.nickname || property.address.split(",")[0]}
                                                </h3>
                                            </div>
                                            <p className="text-sm text-gray-400 mt-1 flex items-center gap-1">
                                                <MapPin className="h-3 w-3" />
                                                {property.address}, {property.postcode}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {property.openIssueCount > 0 && (
                                                <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400">
                                                    {property.openIssueCount} open
                                                </span>
                                            )}
                                            <button
                                                onClick={() => {
                                                    if (confirm("Delete this property?")) {
                                                        deletePropertyMutation.mutate(property.id);
                                                    }
                                                }}
                                                className="p-1.5 hover:bg-gray-700 rounded text-gray-500 hover:text-red-400 transition-colors"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 mt-3">
                                        <span className="px-2 py-1 rounded text-xs font-medium bg-gray-700 text-gray-300 capitalize">
                                            {property.propertyType || "Property"}
                                        </span>
                                        <span className="text-xs text-gray-500">
                                            Added {format(new Date(property.createdAt), "MMM d, yyyy")}
                                        </span>
                                    </div>
                                </div>

                                {/* Tenants */}
                                <div className="p-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <h4 className="text-sm font-medium text-gray-400">Tenants</h4>
                                        <button
                                            onClick={() => setShowAddTenant(property.id)}
                                            className="text-xs text-yellow-500 hover:text-yellow-400 flex items-center gap-1"
                                        >
                                            <Plus className="h-3 w-3" />
                                            Add Tenant
                                        </button>
                                    </div>

                                    {property.tenants.length === 0 ? (
                                        <p className="text-sm text-gray-500 text-center py-3">
                                            No tenants added yet
                                        </p>
                                    ) : (
                                        <div className="space-y-2">
                                            {property.tenants.map((tenant) => (
                                                <div
                                                    key={tenant.id}
                                                    className="flex items-center justify-between p-3 bg-gray-700/50 rounded-lg"
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className="h-8 w-8 bg-gray-600 rounded-full flex items-center justify-center">
                                                            <User className="h-4 w-4 text-gray-300" />
                                                        </div>
                                                        <div>
                                                            <p className="text-sm font-medium text-white">
                                                                {tenant.name}
                                                                {tenant.isPrimary && (
                                                                    <span className="ml-2 text-xs text-gray-500">
                                                                        (Primary)
                                                                    </span>
                                                                )}
                                                            </p>
                                                            <p className="text-xs text-gray-400 flex items-center gap-1">
                                                                <Phone className="h-3 w-3" />
                                                                {tenant.phone}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        {tenant.whatsappOptIn && (
                                                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400">
                                                                WhatsApp Active
                                                            </span>
                                                        )}
                                                        <button
                                                            onClick={() => copyWhatsAppLink(tenant)}
                                                            className="p-1.5 hover:bg-gray-600 rounded text-gray-400 hover:text-white transition-colors"
                                                            title="Copy WhatsApp link for tenant"
                                                        >
                                                            {copiedLink === tenant.id ? (
                                                                <Check className="h-4 w-4 text-green-400" />
                                                            ) : (
                                                                <Copy className="h-4 w-4" />
                                                            )}
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Footer */}
                <div className="mt-8 text-center">
                    <p className="text-xs text-gray-500">
                        Logged in as {landlord.name} · {landlord.email || landlord.phone}
                    </p>
                </div>
            </div>
        </div>
    );
}
