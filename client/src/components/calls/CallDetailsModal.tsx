import React, { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
    Phone, Clock, User, MapPin, Mail, AlertTriangle, FileText, ShoppingBag, Plus, Trash2, Edit2, Save
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { SkuSelectorDropdown } from "./SkuSelectorDropdown"; // Assuming in same folder
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

interface CallDetailsModalProps {
    open: boolean;
    onClose: () => void;
    callId: string | null;
}

export function CallDetailsModal({ open, onClose, callId }: CallDetailsModalProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState("details");

    // Fetch call details
    const { data: call, isLoading } = useQuery({
        queryKey: ['call', callId],
        queryFn: async () => {
            if (!callId) return null;
            const res = await fetch(`/api/calls/${callId}`);
            if (!res.ok) throw new Error("Failed to fetch call details");
            return res.json();
        },
        enabled: !!callId,
    });

    // Mutations
    const updateCallMutation = useMutation({
        mutationFn: async (data: any) => {
            const res = await fetch(`/api/calls/${callId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!res.ok) throw new Error("Failed to update call");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['call', callId] });
            queryClient.invalidateQueries({ queryKey: ['calls'] }); // Refresh list
            toast({ title: "Success", description: "Call details updated" });
            setIsEditing(false);
        },
    });

    const addSkuMutation = useMutation({
        mutationFn: async (skuId: string) => {
            const res = await fetch(`/api/calls/${callId}/skus`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ skuId, quantity: 1, source: 'manual' }),
            });
            if (!res.ok) throw new Error("Failed to add SKU");
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['call', callId] });
            toast({ title: "Added SKU", description: "SKU added to call" });
        },
    });

    const removeSkuMutation = useMutation({
        mutationFn: async (skuId: string) => {
            const res = await fetch(`/api/calls/${callId}/skus/${skuId}`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error("Failed to remove SKU");
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['call', callId] });
            toast({ title: "Removed SKU", description: "SKU removed from call" });
        },
    });

    const updateSkuQuantityMutation = useMutation({
        mutationFn: async ({ skuId, quantity }: { skuId: string, quantity: number }) => {
            const res = await fetch(`/api/calls/${callId}/skus/${skuId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ quantity }),
            });
            if (!res.ok) throw new Error("Failed to update quantity");
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['call', callId] });
        },
    });

    // Local state for editing
    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState<any>({});

    React.useEffect(() => {
        if (call) {
            setEditForm({
                customerName: call.customerName || "",
                email: call.email || "",
                address: call.address || "",
                postcode: call.postcode || "",
                notes: call.notes || "",
                urgency: call.urgency || "Standard",
                leadType: call.leadType || "Unknown",
                outcome: call.outcome || "Unknown",
            });
        }
    }, [call]);

    const handleSave = () => {
        updateCallMutation.mutate(editForm);
    };

    if (!callId) return null;

    return (
        <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
            <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 bg-white dark:bg-slate-950 text-foreground border shadow-xl sm:rounded-xl overflow-hidden">
                <DialogHeader className="px-6 py-4 border-b">
                    <div className="flex justify-between items-center pr-8">
                        <div>
                            <DialogTitle className="text-xl flex items-center gap-2">
                                {isLoading ? "Loading..." : (
                                    <>
                                        Call from {call?.customerName || "Unknown"}
                                        <Badge variant="outline" className="ml-2 font-normal">
                                            {format(new Date(call?.startTime || new Date()), "PP p")}
                                        </Badge>
                                    </>
                                )}
                            </DialogTitle>
                            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-4">
                                <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {call?.phoneNumber}</span>
                                <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {call?.duration ? `${Math.floor(call.duration / 60)}m ${call.duration % 60}s` : "On-going"}</span>
                            </p>
                        </div>
                        <div className="flex gap-2">
                            {!isEditing ? (
                                <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                                    <Edit2 className="h-4 w-4 mr-2" />
                                    Edit Details
                                </Button>
                            ) : (
                                <div className="flex gap-2">
                                    <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>Cancel</Button>
                                    <Button size="sm" onClick={handleSave} disabled={updateCallMutation.isPending}>
                                        <Save className="h-4 w-4 mr-2" />
                                        Save
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-auto">
                    {isLoading ? (
                        <div className="p-12 text-center text-muted-foreground">Loading call details...</div>
                    ) : !call ? (
                        <div className="p-12 text-center text-muted-foreground bg-white dark:bg-slate-950">
                            <p className="text-lg font-semibold mb-2">Call not found</p>
                            <p className="text-sm">Unable to load call details. The call may have been deleted.</p>
                        </div>
                    ) : (
                        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
                            <div className="px-6 py-2 border-b bg-muted/30">
                                <TabsList>
                                    <TabsTrigger value="details">Details & Notes</TabsTrigger>
                                    <TabsTrigger value="transcript">Transcript</TabsTrigger>
                                    <TabsTrigger value="skus">SKUs & Services</TabsTrigger>
                                </TabsList>
                            </div>

                            <div className="flex-1 p-6 overflow-auto">
                                <TabsContent value="details" className="mt-0 space-y-6">
                                    {/* Customer Info */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-4">
                                            <h3 className="font-semibold flex items-center gap-2"><User className="h-4 w-4" /> Customer Information</h3>
                                            <div className="grid grid-cols-[100px_1fr] gap-2 text-sm">
                                                <Label className="mt-2">Name:</Label>
                                                {isEditing ? (
                                                    <Input value={editForm.customerName} onChange={e => setEditForm({ ...editForm, customerName: e.target.value })} />
                                                ) : (
                                                    <div className="py-2">{call?.customerName || "-"}</div>
                                                )}

                                                <Label className="mt-2">Phone:</Label>
                                                <div className="py-2">{call?.phoneNumber || "-"}</div>

                                                <Label className="mt-2">Email:</Label>
                                                {isEditing ? (
                                                    <Input value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} />
                                                ) : (
                                                    <div className="py-2">{call?.email || "-"}</div>
                                                )}

                                                <Label className="mt-2">Address:</Label>
                                                {isEditing ? (
                                                    <Input value={editForm.address} onChange={e => setEditForm({ ...editForm, address: e.target.value })} />
                                                ) : (
                                                    <div className="py-2">{call?.address || "-"}</div>
                                                )}

                                                <Label className="mt-2">Postcode:</Label>
                                                {isEditing ? (
                                                    <Input value={editForm.postcode} onChange={e => setEditForm({ ...editForm, postcode: e.target.value })} />
                                                ) : (
                                                    <div className="py-2">{call?.postcode || "-"}</div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <h3 className="font-semibold flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Call Metadata</h3>
                                            <div className="grid grid-cols-[100px_1fr] gap-2 text-sm">
                                                <Label className="mt-2">Urgency:</Label>
                                                {isEditing ? (
                                                    <Select value={editForm.urgency} onValueChange={v => setEditForm({ ...editForm, urgency: v })}>
                                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="Critical">Critical</SelectItem>
                                                            <SelectItem value="High">High</SelectItem>
                                                            <SelectItem value="Standard">Standard</SelectItem>
                                                            <SelectItem value="Low">Low</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                ) : (
                                                    <Badge variant={call?.urgency === 'Critical' ? 'destructive' : 'secondary'} className="w-fit my-1">
                                                        {call?.urgency || "Standard"}
                                                    </Badge>
                                                )}

                                                <Label className="mt-2">Lead Type:</Label>
                                                {isEditing ? (
                                                    <Select value={editForm.leadType} onValueChange={v => setEditForm({ ...editForm, leadType: v })}>
                                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="Homeowner">Homeowner</SelectItem>
                                                            <SelectItem value="Landlord">Landlord</SelectItem>
                                                            <SelectItem value="Property Manager">Property Manager</SelectItem>
                                                            <SelectItem value="Tenant">Tenant</SelectItem>
                                                            <SelectItem value="Unknown">Unknown</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                ) : (
                                                    <div className="py-2">{call?.leadType || "-"}</div>
                                                )}

                                                <Label className="mt-2">Outcome:</Label>
                                                {isEditing ? (
                                                    <Select value={editForm.outcome} onValueChange={v => setEditForm({ ...editForm, outcome: v })}>
                                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="INSTANT_PRICE">Instant Price</SelectItem>
                                                            <SelectItem value="VIDEO_QUOTE">Video Quote</SelectItem>
                                                            <SelectItem value="SITE_VISIT">Site Visit</SelectItem>
                                                            <SelectItem value="NO_ANSWER">No Answer</SelectItem>
                                                            <SelectItem value="VOICEMAIL">Voicemail</SelectItem>
                                                            <SelectItem value="Unknown">Unknown</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                ) : (
                                                    <div className="py-2">{call?.outcome || "Unknown"}</div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <Separator />

                                    {/* Notes */}
                                    <div className="space-y-2">
                                        <Label>Notes</Label>
                                        {isEditing ? (
                                            <Textarea
                                                value={editForm.notes}
                                                onChange={e => setEditForm({ ...editForm, notes: e.target.value })}
                                                className="min-h-[100px]"
                                            />
                                        ) : (
                                            <div className="bg-muted/30 p-4 rounded-md min-h-[100px] text-sm whitespace-pre-wrap">
                                                {call?.notes || "No notes added."}
                                            </div>
                                        )}
                                    </div>
                                </TabsContent>

                                <TabsContent value="transcript" className="mt-0 h-full">
                                    <div className="space-y-4 h-full flex flex-col">
                                        <div className="bg-muted p-4 rounded-md whitespace-pre-wrap font-mono text-sm leading-relaxed overflow-auto flex-1 border">
                                            {call?.transcription || "No transcription available."}
                                        </div>
                                    </div>
                                </TabsContent>

                                <TabsContent value="skus" className="mt-0 space-y-6">
                                    <div className="flex justify-between items-center bg-muted/30 p-4 rounded-lg border">
                                        <div>
                                            <h3 className="font-semibold text-lg">Detected Services</h3>
                                            <p className="text-sm text-muted-foreground">
                                                Total Value: <span className="font-bold text-foreground">£{((call?.totalPricePence || 0) / 100).toFixed(2)}</span>
                                            </p>
                                        </div>
                                        <div className="w-[300px]">
                                            <SkuSelectorDropdown onSkuSelected={(sku) => addSkuMutation.mutate(sku.id)} />
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        {call?.allSkus && call.allSkus.length > 0 ? (
                                            <div className="grid grid-cols-1 gap-3">
                                                {call.allSkus.map((item: any) => (
                                                    <div key={item.id} className="flex items-center justify-between p-3 border rounded-lg bg-card hover:bg-muted/20 transition-colors">
                                                        <div className="flex items-start gap-3">
                                                            <div className={cn("p-2 rounded-full", item.source === 'detected' ? "bg-purple-100 text-purple-600" : "bg-blue-100 text-blue-600")}>
                                                                <ShoppingBag className="h-4 w-4" />
                                                            </div>
                                                            <div>
                                                                <div className="font-medium flex items-center gap-2">
                                                                    {item.sku.name}
                                                                    {item.source === 'detected' && (
                                                                        <Badge variant="secondary" className="text-[10px] h-5">AI Detected ({item.confidence}%)</Badge>
                                                                    )}
                                                                </div>
                                                                <p className="text-sm text-muted-foreground">{item.sku.skuCode}</p>
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center gap-4">
                                                            <div className="flex items-center gap-2">
                                                                <div className="text-sm font-medium w-[80px] text-right">
                                                                    £{((item.pricePence * item.quantity) / 100).toFixed(2)}
                                                                </div>
                                                                <div className="flex items-center border rounded-md">
                                                                    <button
                                                                        disabled={item.quantity <= 1}
                                                                        onClick={() => updateSkuQuantityMutation.mutate({ skuId: item.id, quantity: item.quantity - 1 })}
                                                                        className="px-2 py-1 hover:bg-muted disabled:opacity-50"
                                                                    >-</button>
                                                                    <div className="px-2 text-sm">{item.quantity}</div>
                                                                    <button
                                                                        onClick={() => updateSkuQuantityMutation.mutate({ skuId: item.id, quantity: item.quantity + 1 })}
                                                                        className="px-2 py-1 hover:bg-muted"
                                                                    >+</button>
                                                                </div>
                                                            </div>
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                                                onClick={() => removeSkuMutation.mutate(item.id)}
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
                                                No SKUs detected or added for this call.
                                            </div>
                                        )}
                                    </div>
                                </TabsContent>
                            </div>
                        </Tabs>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
