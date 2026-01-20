import { useState } from "react";
import ContractorAppShell from "@/components/layout/ContractorAppShell";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useContractorAuth } from "@/hooks/use-contractor-auth";
import { useToast } from "@/hooks/use-toast";
import {
    ArrowLeft, Plus, Trash2, Calendar,
    User, Mail, Phone, MapPin, CheckCircle,
    CreditCard, Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { FileText } from "lucide-react";

export default function CreateInvoicePage() {
    const [, setLocation] = useLocation();
    const { toast } = useToast();
    const { contractor } = useContractorAuth();

    // Form State
    const [customerName, setCustomerName] = useState("");
    const [customerEmail, setCustomerEmail] = useState("");
    const [customerPhone, setCustomerPhone] = useState("");
    const [customerAddress, setCustomerAddress] = useState("");
    const [dueDate, setDueDate] = useState<string>(
        new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    );
    const [notes, setNotes] = useState("");

    // Line Items State
    const [lineItems, setLineItems] = useState([
        { id: 1, description: "", quantity: 1, unitPrice: 0 }
    ]);

    // Computed Totals
    const subtotal = lineItems.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    // Optional: Add tax logic later if needed
    const total = subtotal;

    // Handlers
    const addLineItem = () => {
        setLineItems([...lineItems, { id: Date.now(), description: "", quantity: 1, unitPrice: 0 }]);
    };

    const removeLineItem = (id: number) => {
        if (lineItems.length > 1) {
            setLineItems(lineItems.filter(item => item.id !== id));
        }
    };

    const updateLineItem = (id: number, field: string, value: any) => {
        setLineItems(lineItems.map(item =>
            item.id === id ? { ...item, [field]: value } : item
        ));
    };

    // Mutation
    const createInvoiceMutation = useMutation({
        mutationFn: async () => {
            if (!contractor?.user?.id) throw new Error("Contractor not authenticated");

            const payload = {
                contractorId: contractor.user.id,
                customerName,
                customerEmail,
                customerPhone,
                customerAddress,
                dueDate,
                notes,
                lineItems: lineItems.map(({ description, quantity, unitPrice }) => ({
                    description,
                    quantity: Number(quantity),
                    unitPrice: Number(unitPrice)
                }))
            };

            const res = await fetch("/api/invoices", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "Failed to create invoice");
            }

            return res.json();
        },
        onSuccess: (data) => {
            toast({
                title: "Invoice Created",
                description: `Invoice ${data.invoice.invoiceNumber} has been generated.`,
            });
            // Redirect to invoice details/preview (future impl) or dashboard
            // For now, go back to dashboard
            setTimeout(() => setLocation("/contractor/dashboard"), 1000);
        },
        onError: (err) => {
            toast({
                title: "Error",
                description: err.message,
                variant: "destructive"
            });
        }
    });

    const isFormValid = customerName && lineItems.length > 0 && lineItems.every(i => i.description && i.unitPrice > 0);

    return (
        <ContractorAppShell>
            {/* Header */}
            <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-100 px-4 py-3 flex items-center gap-3">
                <button
                    onClick={() => setLocation("/contractor/dashboard")}
                    className="p-2 -ml-2 hover:bg-slate-100 rounded-full text-slate-500"
                >
                    <ArrowLeft size={20} />
                </button>
                <h1 className="font-bold text-lg text-slate-800">New Invoice</h1>
            </div>

            <div className="p-4 space-y-6 pb-32">

                {/* 1. Customer Details */}
                <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm space-y-4">
                    <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                        <User size={14} /> Customer Info
                    </h2>

                    <div className="space-y-3">
                        <div>
                            <label className="text-sm font-semibold text-slate-700">Name *</label>
                            <input
                                value={customerName}
                                onChange={(e) => setCustomerName(e.target.value)}
                                placeholder="e.g. John Doe"
                                className="w-full mt-1 p-3 bg-slate-50 border-none rounded-xl text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-sm font-semibold text-slate-700">Email</label>
                                <div className="relative">
                                    <Mail size={16} className="absolute left-3 top-3.5 text-slate-400" />
                                    <input
                                        value={customerEmail}
                                        onChange={(e) => setCustomerEmail(e.target.value)}
                                        placeholder="email@example.com"
                                        type="email"
                                        className="w-full mt-1 pl-10 pr-3 py-3 bg-slate-50 border-none rounded-xl text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-sm font-semibold text-slate-700">Phone</label>
                                <div className="relative">
                                    <Phone size={16} className="absolute left-3 top-3.5 text-slate-400" />
                                    <input
                                        value={customerPhone}
                                        onChange={(e) => setCustomerPhone(e.target.value)}
                                        placeholder="07700 900000"
                                        type="tel"
                                        className="w-full mt-1 pl-10 pr-3 py-3 bg-slate-50 border-none rounded-xl text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className="text-sm font-semibold text-slate-700">Address</label>
                            <div className="relative">
                                <MapPin size={16} className="absolute left-3 top-3.5 text-slate-400" />
                                <input
                                    value={customerAddress}
                                    onChange={(e) => setCustomerAddress(e.target.value)}
                                    placeholder="123 High St, London"
                                    className="w-full mt-1 pl-10 pr-3 py-3 bg-slate-50 border-none rounded-xl text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* 2. Line Items */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between px-1">
                        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                            <FileText size={14} /> Line Items
                        </h2>
                    </div>

                    {lineItems.map((item, index) => (
                        <div key={item.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm relative group animate-in slide-in-from-bottom-2 duration-300">
                            <div className="absolute -right-2 -top-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={() => removeLineItem(item.id)}
                                    className="bg-red-100 text-red-500 p-1.5 rounded-full shadow-sm hover:bg-red-200"
                                    disabled={lineItems.length === 1}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>

                            <div className="space-y-3">
                                <input
                                    value={item.description}
                                    onChange={(e) => updateLineItem(item.id, "description", e.target.value)}
                                    placeholder="Description of work..."
                                    className="w-full font-medium text-slate-800 placeholder:text-slate-300 border-none bg-transparent p-0 focus:ring-0 text-base"
                                />

                                <div className="flex gap-4 pt-2 border-t border-slate-50">
                                    <div className="flex-1">
                                        <label className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Price (£)</label>
                                        <input
                                            type="number"
                                            value={item.unitPrice || ""}
                                            onChange={(e) => updateLineItem(item.id, "unitPrice", parseFloat(e.target.value))}
                                            placeholder="0.00"
                                            className="w-full mt-1 bg-slate-50 rounded-lg p-2 text-slate-800 font-mono font-bold"
                                        />
                                    </div>
                                    <div className="w-20">
                                        <label className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Qty</label>
                                        <input
                                            type="number"
                                            value={item.quantity}
                                            onChange={(e) => updateLineItem(item.id, "quantity", parseFloat(e.target.value))}
                                            placeholder="1"
                                            className="w-full mt-1 bg-slate-50 rounded-lg p-2 text-slate-800 font-mono text-center"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}

                    <button
                        onClick={addLineItem}
                        className="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 font-bold hover:bg-slate-50 hover:border-slate-300 transition-all flex items-center justify-center gap-2"
                    >
                        <Plus size={18} /> Add Item
                    </button>
                </div>

                {/* 3. Invoice Settings */}
                <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm space-y-4">
                    <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                        <Calendar size={14} /> Details
                    </h2>

                    <div className="grid grid-cols-1 gap-4">
                        <div>
                            <label className="text-sm font-semibold text-slate-700">Due Date</label>
                            <input
                                type="date"
                                value={dueDate}
                                onChange={(e) => setDueDate(e.target.value)}
                                className="w-full mt-1 p-3 bg-slate-50 border-none rounded-xl text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="text-sm font-semibold text-slate-700">Notes (Optional)</label>
                            <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Thank you for your business..."
                                rows={2}
                                className="w-full mt-1 p-3 bg-slate-50 border-none rounded-xl text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                            />
                        </div>
                    </div>
                </div>

            </div>

            {/* Footer Actions */}
            <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-100 p-4 pb-8 z-20 shadow-[0_-5px_20px_rgba(0,0,0,0.05)]">
                <div className="max-w-md mx-auto flex items-center gap-4">
                    <div className="flex-1">
                        <div className="text-xs font-bold text-slate-400 uppercase">Total Due</div>
                        <div className="text-2xl font-bold text-slate-900">£{total.toFixed(2)}</div>
                    </div>
                    <button
                        onClick={() => createInvoiceMutation.mutate()}
                        disabled={!isFormValid || createInvoiceMutation.isPending}
                        className={cn(
                            "px-8 py-3.5 rounded-xl font-bold text-white shadow-lg transition-all flex items-center gap-2",
                            isFormValid ? "bg-blue-600 hover:bg-blue-500 shadow-blue-500/30 active:scale-95" : "bg-slate-300 text-slate-500 cursor-not-allowed"
                        )}
                    >
                        {createInvoiceMutation.isPending ? (
                            <Loader2 className="animate-spin" />
                        ) : (
                            <>
                                Create Invoice <CreditCard size={18} />
                            </>
                        )}
                    </button>
                </div>
            </div>

        </ContractorAppShell>
    );
}
