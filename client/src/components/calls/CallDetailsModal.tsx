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
    Phone, Clock, User, MapPin, Mail, AlertTriangle, FileText, ShoppingBag, Plus, Trash2, Edit2, Save, Play, Pause, Volume2, VolumeX
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

// Helper function to format time in mm:ss
function formatTime(seconds: number): string {
    if (!seconds || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function CallDetailsModal({ open, onClose, callId }: CallDetailsModalProps) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState("details");
    const audioRef = React.useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);

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
            <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-50 border border-slate-200 dark:border-slate-800 shadow-xl sm:rounded-xl overflow-hidden transition-colors duration-300">
                <DialogHeader className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
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
                        <div className="p-12 text-center text-muted-foreground bg-slate-950">
                            <p className="text-lg font-semibold mb-2">Call not found</p>
                            <p className="text-sm">Unable to load call details. The call may have been deleted.</p>
                        </div>
                    ) : (
                        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
                            <div className="px-6 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                                <TabsList>
                                    <TabsTrigger value="details">Details & Notes</TabsTrigger>
                                    <TabsTrigger value="transcript">Transcript</TabsTrigger>
                                    <TabsTrigger value="recording">Recording</TabsTrigger>
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
                                                className="min-h-[100px] bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 focus:bg-white dark:focus:bg-slate-950"
                                            />
                                        ) : (
                                            <div className="bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 p-4 rounded-md min-h-[100px] text-sm whitespace-pre-wrap">
                                                {call?.notes || "No notes added."}
                                            </div>
                                        )}
                                    </div>
                                </TabsContent>

                                <TabsContent value="transcript" className="mt-0 h-full">
                                    <div className="space-y-4 h-full flex flex-col">
                                        <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-4 rounded-md whitespace-pre-wrap font-mono text-sm leading-relaxed overflow-auto flex-1">
                                            {call?.transcription || "No transcription available."}
                                        </div>
                                    </div>
                                </TabsContent>

                                <TabsContent value="recording" className="mt-0">
                                    <div className="space-y-6">
                                        {call?.recordingUrl ? (
                                            <div className="bg-gradient-to-br from-slate-900 to-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
                                                <audio
                                                    ref={audioRef}
                                                    src={`/api/calls/${call.id}/recording`}
                                                    onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                                                    onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                                                    onEnded={() => setIsPlaying(false)}
                                                    onPlay={() => setIsPlaying(true)}
                                                    onPause={() => setIsPlaying(false)}
                                                />

                                                <div className="flex items-center justify-between mb-4">
                                                    <h3 className="text-white font-semibold flex items-center gap-2">
                                                        <Volume2 className="h-5 w-5 text-emerald-400" />
                                                        Call Recording
                                                    </h3>
                                                    <span className="text-xs text-slate-400">
                                                        {format(new Date(call.startTime), "PPP 'at' p")}
                                                    </span>
                                                </div>

                                                {/* Progress Bar */}
                                                <div className="mb-4">
                                                    <input
                                                        type="range"
                                                        min={0}
                                                        max={duration || 100}
                                                        value={currentTime}
                                                        onChange={(e) => {
                                                            const time = parseFloat(e.target.value);
                                                            setCurrentTime(time);
                                                            if (audioRef.current) {
                                                                audioRef.current.currentTime = time;
                                                            }
                                                        }}
                                                        className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                                                    />
                                                    <div className="flex justify-between text-xs text-slate-400 mt-1">
                                                        <span>{formatTime(currentTime)}</span>
                                                        <span>{formatTime(duration)}</span>
                                                    </div>
                                                </div>

                                                {/* Controls */}
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-12 w-12 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white"
                                                            onClick={() => {
                                                                if (audioRef.current) {
                                                                    if (isPlaying) {
                                                                        audioRef.current.pause();
                                                                    } else {
                                                                        audioRef.current.play();
                                                                    }
                                                                }
                                                            }}
                                                        >
                                                            {isPlaying ? (
                                                                <Pause className="h-6 w-6" />
                                                            ) : (
                                                                <Play className="h-6 w-6 ml-0.5" />
                                                            )}
                                                        </Button>
                                                    </div>

                                                    {/* Volume Control */}
                                                    <div className="flex items-center gap-2">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 text-slate-400 hover:text-white"
                                                            onClick={() => {
                                                                setIsMuted(!isMuted);
                                                                if (audioRef.current) {
                                                                    audioRef.current.muted = !isMuted;
                                                                }
                                                            }}
                                                        >
                                                            {isMuted ? (
                                                                <VolumeX className="h-4 w-4" />
                                                            ) : (
                                                                <Volume2 className="h-4 w-4" />
                                                            )}
                                                        </Button>
                                                        <input
                                                            type="range"
                                                            min={0}
                                                            max={1}
                                                            step={0.1}
                                                            value={isMuted ? 0 : volume}
                                                            onChange={(e) => {
                                                                const vol = parseFloat(e.target.value);
                                                                setVolume(vol);
                                                                setIsMuted(vol === 0);
                                                                if (audioRef.current) {
                                                                    audioRef.current.volume = vol;
                                                                    audioRef.current.muted = vol === 0;
                                                                }
                                                            }}
                                                            className="w-20 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-center py-12 text-muted-foreground border-2 border-dashed border-slate-800 rounded-lg bg-slate-900/20">
                                                <Volume2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                                                <p className="text-lg font-medium">No Recording Available</p>
                                                <p className="text-sm mt-1">This call does not have an associated recording.</p>
                                            </div>
                                        )}
                                    </div>
                                </TabsContent>

                                <TabsContent value="skus" className="mt-0 space-y-6">
                                    <div className="flex justify-between items-center bg-slate-900/50 p-4 rounded-lg border border-slate-800">
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
                                                    <div key={item.id} className="flex items-center justify-between p-3 border border-slate-800 rounded-lg bg-slate-900/50 hover:bg-slate-800/50 transition-colors">
                                                        <div className="flex items-start gap-3">
                                                            <div className={cn("p-2 rounded-full", item.source === 'detected' ? "bg-purple-500/10 text-purple-400" : "bg-blue-500/10 text-blue-400")}>
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
