import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Edit2, Trash2, Tag, Clock, Coins, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

// Define schema locally to avoid import issues for now, or use shared if sure
const skuSchema = z.object({
    skuCode: z.string().min(3),
    name: z.string().min(3),
    description: z.string(),
    pricePence: z.number().min(0),
    timeEstimateMinutes: z.number().min(5),
    category: z.string().min(1),
    keywords: z.string().transform(str => str.split(',').map(s => s.trim()).filter(Boolean)),
    aiPromptHint: z.string().optional(),
});

type SKUFormData = z.infer<typeof skuSchema>;

interface SKU extends SKUFormData {
    id: string;
    isActive: boolean;
    keywords: string[]; // Override for array type
}

export default function SKUPage() {
    const queryClient = useQueryClient();
    const [searchTerm, setSearchTerm] = useState("");
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSku, setEditingSku] = useState<SKU | null>(null);

    // Fetch SKUs
    const { data: skus = [], isLoading } = useQuery<SKU[]>({
        queryKey: ["skus"],
        queryFn: async () => {
            const res = await fetch("/api/skus");
            if (!res.ok) throw new Error("Failed to fetch SKUs");
            return res.json();
        },
    });

    // Create Mutation
    const createMutation = useMutation({
        mutationFn: async (data: SKUFormData) => {
            const res = await fetch("/api/skus", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });
            if (!res.ok) throw new Error("Failed to create SKU");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["skus"] });
            setIsModalOpen(false);
            reset();
        },
    });

    // Update Mutation
    const updateMutation = useMutation({
        mutationFn: async (data: SKUFormData & { id: string }) => {
            const { id, ...rest } = data;
            const res = await fetch(`/api/skus/${id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(rest),
            });
            if (!res.ok) throw new Error("Failed to update SKU");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["skus"] });
            setIsModalOpen(false);
            setEditingSku(null);
            reset();
        },
    });

    // Delete Mutation
    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const res = await fetch(`/api/skus/${id}`, { method: "DELETE" });
            if (!res.ok) throw new Error("Failed to delete SKU");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["skus"] });
        },
    });

    const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<SKUFormData>({
        resolver: zodResolver(skuSchema),
    });

    const onSubmit = (data: SKUFormData) => {
        if (editingSku) {
            updateMutation.mutate({ ...data, id: editingSku.id });
        } else {
            createMutation.mutate(data);
        }
    };

    const handleEdit = (sku: SKU) => {
        setEditingSku(sku);
        setValue("skuCode", sku.skuCode);
        setValue("name", sku.name);
        setValue("description", sku.description);
        setValue("pricePence", sku.pricePence);
        setValue("timeEstimateMinutes", sku.timeEstimateMinutes);
        setValue("category", sku.category || "");
        // @ts-ignore - formatting for input
        setValue("keywords", sku.keywords.join(", "));
        setValue("aiPromptHint", sku.aiPromptHint || "");
        setIsModalOpen(true);
    };

    const handleAddNew = () => {
        setEditingSku(null);
        reset();
        setIsModalOpen(true);
    };

    const sortedSkus = skus
        .filter(sku =>
            sku.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            sku.skuCode.toLowerCase().includes(searchTerm.toLowerCase())
        );

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900">Productized Services</h1>
                    <p className="text-slate-500 mt-1">Manage the &lsquo;Brain&rsquo; knowledge base for automated quoting.</p>
                </div>
                <button
                    onClick={handleAddNew}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition shadow-sm shadow-blue-200"
                >
                    <Plus className="w-4 h-4" />
                    Add Service
                </button>
            </div>

            {/* Search */}
            <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                    type="text"
                    placeholder="Search services..."
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            {/* Grid */}
            {isLoading ? (
                <div className="text-center py-12 text-slate-400">Loading services...</div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {sortedSkus.map((sku) => (
                        <div key={sku.id} className="group bg-white rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition-all duration-300 p-5 flex flex-col relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-blue-500 to-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity"></div>

                            <div className="flex justify-between items-start mb-3">
                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                                    {sku.category}
                                </span>
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={() => handleEdit(sku)}
                                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                                    >
                                        <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (confirm('Are you sure you want to delete this SKU?')) {
                                                deleteMutation.mutate(sku.id);
                                            }
                                        }}
                                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>

                            <h3 className="font-semibold text-slate-900 mb-1">{sku.name}</h3>
                            <div className="text-xs font-mono text-slate-400 mb-4">{sku.skuCode}</div>

                            <p className="text-sm text-slate-600 mb-4 line-clamp-2 flex-grow">{sku.description}</p>

                            <div className="pt-4 border-t border-slate-50 mt-auto flex items-center justify-between text-sm">
                                <div className="flex items-center gap-1.5 text-slate-600 font-medium">
                                    <Coins className="w-4 h-4 text-emerald-500" />
                                    £{(sku.pricePence / 100).toFixed(2)}
                                </div>
                                <div className="flex items-center gap-1.5 text-slate-500">
                                    <Clock className="w-4 h-4" />
                                    {sku.timeEstimateMinutes}m
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center sticky top-0 bg-white z-10">
                            <h2 className="text-lg font-bold text-slate-900">
                                {editingSku ? "Edit Service" : "New Service"}
                            </h2>
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-slate-700">SKU Code</label>
                                    <input {...register("skuCode")} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition" placeholder="PLUMB-TAP-01" />
                                    {errors.skuCode && <span className="text-xs text-red-500">{errors.skuCode.message}</span>}
                                </div>

                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-slate-700">Category</label>
                                    <input {...register("category")} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition" placeholder="Plumbing" />
                                    {errors.category && <span className="text-xs text-red-500">{errors.category.message}</span>}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-700">Service Name</label>
                                <input {...register("name")} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition" placeholder="Tap Replacement" />
                                {errors.name && <span className="text-xs text-red-500">{errors.name.message}</span>}
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-700">Description</label>
                                <textarea {...register("description")} rows={3} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition" placeholder="Detailed description of the service..." />
                                {errors.description && <span className="text-xs text-red-500">{errors.description.message}</span>}
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-slate-700">Price (Pence)</label>
                                    <input type="number" {...register("pricePence", { valueAsNumber: true })} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition" placeholder="9500" />
                                    {errors.pricePence && <span className="text-xs text-red-500">{errors.pricePence.message}</span>}
                                </div>

                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-slate-700">Est. Time (Minutes)</label>
                                    <input type="number" {...register("timeEstimateMinutes", { valueAsNumber: true })} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition" placeholder="60" />
                                    {errors.timeEstimateMinutes && <span className="text-xs text-red-500">{errors.timeEstimateMinutes.message}</span>}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-700">Keywords (comma separated)</label>
                                <input {...register("keywords")} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition" placeholder="tap, faucet, drip" />
                                {errors.keywords && <span className="text-xs text-red-500">{errors.keywords.message}</span>}
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-700">AI Prompt Hint</label>
                                <textarea {...register("aiPromptHint")} rows={2} className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition" placeholder="Instructions for the AI..." />
                            </div>

                            <div className="pt-4 flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={createMutation.isPending || updateMutation.isPending}
                                    className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition shadow-sm shadow-blue-200 disabled:opacity-50"
                                >
                                    {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save Service"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
