import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
    Loader2,
    Phone,
    CheckCircle2,
    XCircle,
    RefreshCw,
    ChevronDown,
    Users,
    AlertTriangle,
    Trash2,
    Check,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

// Lead interface for review queue
interface ReviewLead {
    id: string;
    customerName: string;
    phone: string;
    email: string | null;
    segment: string | null;
    segmentConfidence: number | null;
    segmentSignals: string[];
    jobDescription: string | null;
    jobSummary: string | null;
    transcriptSnippet: string | null;
    source: string | null;
    createdAt: string;
}

// Segment configuration for display
const SEGMENT_CONFIG: Record<string, { name: string; color: string; bgColor: string }> = {
    EMERGENCY: { name: "Emergency", color: "text-red-400", bgColor: "bg-red-500/20" },
    BUSY_PRO: { name: "Busy Pro", color: "text-blue-400", bgColor: "bg-blue-500/20" },
    PROP_MGR: { name: "Property Manager", color: "text-purple-400", bgColor: "bg-purple-500/20" },
    LANDLORD: { name: "Landlord", color: "text-amber-400", bgColor: "bg-amber-500/20" },
    SMALL_BIZ: { name: "Small Business", color: "text-green-400", bgColor: "bg-green-500/20" },
    TRUST_SEEKER: { name: "Trust Seeker", color: "text-cyan-400", bgColor: "bg-cyan-500/20" },
    RENTER: { name: "Renter", color: "text-pink-400", bgColor: "bg-pink-500/20" },
    DIY_DEFERRER: { name: "DIY Deferrer", color: "text-orange-400", bgColor: "bg-orange-500/20" },
    BUDGET: { name: "Budget", color: "text-gray-400", bgColor: "bg-gray-500/20" },
    DEFAULT: { name: "Default", color: "text-slate-400", bgColor: "bg-slate-500/20" },
};

const SEGMENT_OPTIONS = Object.keys(SEGMENT_CONFIG);

export default function LeadReviewPage() {
    const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
    const [changeSegmentLead, setChangeSegmentLead] = useState<ReviewLead | null>(null);
    const [newSegment, setNewSegment] = useState<string>("");
    const [junkReason, setJunkReason] = useState("");
    const [showBulkJunkDialog, setShowBulkJunkDialog] = useState(false);

    const { toast } = useToast();
    const queryClient = useQueryClient();

    // Fetch leads needing review
    const { data, isLoading, refetch } = useQuery<{ leads: ReviewLead[]; count: number }>({
        queryKey: ["leads-needs-review"],
        queryFn: async () => {
            const res = await fetch("/api/admin/leads/needs-review");
            if (!res.ok) throw new Error("Failed to fetch leads");
            return res.json();
        },
        refetchInterval: 30000,
    });

    // Approve single lead mutation
    const approveMutation = useMutation({
        mutationFn: async (leadId: string) => {
            const res = await fetch(`/api/admin/leads/${leadId}/approve-segment`, {
                method: "PUT",
            });
            if (!res.ok) throw new Error("Failed to approve");
            return res.json();
        },
        onSuccess: (_, leadId) => {
            toast({
                title: "Segment Approved",
                description: "Lead has been moved to ready status.",
            });
            queryClient.invalidateQueries({ queryKey: ["leads-needs-review"] });
            setSelectedLeads((prev) => {
                const next = new Set(prev);
                next.delete(leadId);
                return next;
            });
        },
        onError: () => {
            toast({
                title: "Error",
                description: "Failed to approve segment.",
                variant: "destructive",
            });
        },
    });

    // Change segment mutation
    const changeSegmentMutation = useMutation({
        mutationFn: async ({ leadId, segment }: { leadId: string; segment: string }) => {
            const res = await fetch(`/api/admin/leads/${leadId}/segment`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ segment }),
            });
            if (!res.ok) throw new Error("Failed to change segment");
            return res.json();
        },
        onSuccess: () => {
            toast({
                title: "Segment Changed",
                description: "Segment has been updated and lead moved to ready.",
            });
            queryClient.invalidateQueries({ queryKey: ["leads-needs-review"] });
            setChangeSegmentLead(null);
            setNewSegment("");
        },
        onError: () => {
            toast({
                title: "Error",
                description: "Failed to change segment.",
                variant: "destructive",
            });
        },
    });

    // Mark as junk mutation
    const junkMutation = useMutation({
        mutationFn: async ({ leadId, reason }: { leadId: string; reason?: string }) => {
            const res = await fetch(`/api/admin/leads/${leadId}/mark-junk`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reason }),
            });
            if (!res.ok) throw new Error("Failed to mark as junk");
            return res.json();
        },
        onSuccess: (_, variables) => {
            toast({
                title: "Marked as Junk",
                description: "Lead has been marked as junk.",
            });
            queryClient.invalidateQueries({ queryKey: ["leads-needs-review"] });
            setSelectedLeads((prev) => {
                const next = new Set(prev);
                next.delete(variables.leadId);
                return next;
            });
        },
        onError: () => {
            toast({
                title: "Error",
                description: "Failed to mark as junk.",
                variant: "destructive",
            });
        },
    });

    // Bulk approve mutation
    const bulkApproveMutation = useMutation({
        mutationFn: async (leadIds: string[]) => {
            const res = await fetch("/api/admin/leads/bulk-approve", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leadIds }),
            });
            if (!res.ok) throw new Error("Failed to bulk approve");
            return res.json();
        },
        onSuccess: (data) => {
            toast({
                title: "Bulk Approved",
                description: `${data.approvedCount} leads have been approved.`,
            });
            queryClient.invalidateQueries({ queryKey: ["leads-needs-review"] });
            setSelectedLeads(new Set());
        },
        onError: () => {
            toast({
                title: "Error",
                description: "Failed to bulk approve leads.",
                variant: "destructive",
            });
        },
    });

    // Bulk junk mutation
    const bulkJunkMutation = useMutation({
        mutationFn: async ({ leadIds, reason }: { leadIds: string[]; reason?: string }) => {
            const res = await fetch("/api/admin/leads/bulk-junk", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ leadIds, reason }),
            });
            if (!res.ok) throw new Error("Failed to bulk junk");
            return res.json();
        },
        onSuccess: (data) => {
            toast({
                title: "Bulk Marked as Junk",
                description: `${data.junkedCount} leads have been marked as junk.`,
            });
            queryClient.invalidateQueries({ queryKey: ["leads-needs-review"] });
            setSelectedLeads(new Set());
            setShowBulkJunkDialog(false);
            setJunkReason("");
        },
        onError: () => {
            toast({
                title: "Error",
                description: "Failed to bulk mark as junk.",
                variant: "destructive",
            });
        },
    });

    const leads = data?.leads || [];

    // Toggle lead selection
    const toggleSelect = (leadId: string) => {
        setSelectedLeads((prev) => {
            const next = new Set(prev);
            if (next.has(leadId)) {
                next.delete(leadId);
            } else {
                next.add(leadId);
            }
            return next;
        });
    };

    // Select/deselect all
    const toggleSelectAll = () => {
        if (selectedLeads.size === leads.length) {
            setSelectedLeads(new Set());
        } else {
            setSelectedLeads(new Set(leads.map((l) => l.id)));
        }
    };

    // Get confidence badge color
    const getConfidenceBadge = (confidence: number | null) => {
        if (confidence === null) return { color: "bg-gray-500/20 text-gray-400", label: "?" };
        if (confidence >= 80) return { color: "bg-green-500/20 text-green-400", label: `${confidence}%` };
        if (confidence >= 60) return { color: "bg-yellow-500/20 text-yellow-400", label: `${confidence}%` };
        return { color: "bg-red-500/20 text-red-400", label: `${confidence}%` };
    };

    if (isLoading) {
        return (
            <div className="flex h-96 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-6 p-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
                        <Users className="h-8 w-8 text-amber-500" />
                        Segment Review Queue
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Review and approve AI-detected segments for leads captured without VA presence
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-lg px-3 py-1">
                        {data?.count || 0} pending
                    </Badge>
                    <Button onClick={() => refetch()} variant="outline" size="sm">
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Bulk Actions Bar */}
            {selectedLeads.size > 0 && (
                <Card className="bg-amber-500/10 border-amber-500/30">
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <span className="text-amber-400 font-medium">
                                    {selectedLeads.size} lead{selectedLeads.size > 1 ? "s" : ""} selected
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => bulkApproveMutation.mutate(Array.from(selectedLeads))}
                                    disabled={bulkApproveMutation.isPending}
                                    className="border-green-500/50 text-green-400 hover:bg-green-500/20"
                                >
                                    {bulkApproveMutation.isPending ? (
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    ) : (
                                        <CheckCircle2 className="h-4 w-4 mr-2" />
                                    )}
                                    Bulk Approve
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowBulkJunkDialog(true)}
                                    className="border-red-500/50 text-red-400 hover:bg-red-500/20"
                                >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Bulk Junk
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setSelectedLeads(new Set())}
                                >
                                    Clear
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Main Content */}
            <Card className="bg-card border-border shadow-sm">
                <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>Leads Needing Review</CardTitle>
                            <CardDescription>
                                Approve detected segments or change them before proceeding
                            </CardDescription>
                        </div>
                        {leads.length > 0 && (
                            <Button variant="ghost" size="sm" onClick={toggleSelectAll}>
                                {selectedLeads.size === leads.length ? "Deselect All" : "Select All"}
                            </Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent>
                    {!leads.length ? (
                        <div className="text-center py-16">
                            <CheckCircle2 className="h-16 w-16 mx-auto text-green-500 mb-4" />
                            <h3 className="text-lg font-medium text-foreground">All caught up!</h3>
                            <p className="text-muted-foreground mt-2">
                                No leads are waiting for segment review.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {leads.map((lead) => {
                                const segmentInfo = lead.segment
                                    ? SEGMENT_CONFIG[lead.segment] || SEGMENT_CONFIG.DEFAULT
                                    : SEGMENT_CONFIG.DEFAULT;
                                const confidenceBadge = getConfidenceBadge(lead.segmentConfidence);

                                return (
                                    <div
                                        key={lead.id}
                                        className={`rounded-lg border p-4 transition-colors ${
                                            selectedLeads.has(lead.id)
                                                ? "border-amber-500/50 bg-amber-500/5"
                                                : "border-border hover:border-muted-foreground/30"
                                        }`}
                                    >
                                        <div className="flex items-start gap-4">
                                            {/* Checkbox */}
                                            <div className="pt-1">
                                                <Checkbox
                                                    checked={selectedLeads.has(lead.id)}
                                                    onCheckedChange={() => toggleSelect(lead.id)}
                                                />
                                            </div>

                                            {/* Main Content */}
                                            <div className="flex-1 min-w-0">
                                                {/* Top Row: Name, Phone, Segment */}
                                                <div className="flex items-center gap-3 flex-wrap">
                                                    <span className="font-semibold text-foreground">
                                                        {lead.customerName}
                                                    </span>
                                                    <a
                                                        href={`tel:${lead.phone}`}
                                                        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
                                                    >
                                                        <Phone className="h-3 w-3" />
                                                        {lead.phone}
                                                    </a>
                                                    <span className="text-muted-foreground text-sm">
                                                        {format(new Date(lead.createdAt), "MMM d, h:mm a")}
                                                    </span>
                                                </div>

                                                {/* Segment Badge Row */}
                                                <div className="flex items-center gap-2 mt-2">
                                                    <Badge className={`${segmentInfo.bgColor} ${segmentInfo.color} border-0`}>
                                                        {segmentInfo.name}
                                                    </Badge>
                                                    <Badge className={`${confidenceBadge.color} border-0`}>
                                                        {confidenceBadge.label}
                                                    </Badge>
                                                    {lead.source && (
                                                        <Badge variant="outline" className="text-xs">
                                                            {lead.source.replace(/_/g, " ")}
                                                        </Badge>
                                                    )}
                                                </div>

                                                {/* Segment Signals */}
                                                {lead.segmentSignals && lead.segmentSignals.length > 0 && (
                                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                                        {lead.segmentSignals.map((signal, idx) => (
                                                            <span
                                                                key={idx}
                                                                className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground"
                                                            >
                                                                {signal}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Job Description */}
                                                {(lead.jobDescription || lead.jobSummary) && (
                                                    <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                                                        {lead.jobSummary || lead.jobDescription}
                                                    </p>
                                                )}

                                                {/* Transcript Snippet */}
                                                {lead.transcriptSnippet && (
                                                    <div className="mt-2 p-2 rounded bg-muted/50 text-xs text-muted-foreground italic">
                                                        "{lead.transcriptSnippet}..."
                                                    </div>
                                                )}
                                            </div>

                                            {/* Actions */}
                                            <div className="flex flex-col gap-2 shrink-0">
                                                <Button
                                                    size="sm"
                                                    onClick={() => approveMutation.mutate(lead.id)}
                                                    disabled={approveMutation.isPending}
                                                    className="bg-green-600 hover:bg-green-700"
                                                >
                                                    {approveMutation.isPending ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <>
                                                            <Check className="h-4 w-4 mr-1" />
                                                            Approve
                                                        </>
                                                    )}
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => {
                                                        setChangeSegmentLead(lead);
                                                        setNewSegment(lead.segment || "");
                                                    }}
                                                >
                                                    <ChevronDown className="h-4 w-4 mr-1" />
                                                    Change
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => junkMutation.mutate({ leadId: lead.id })}
                                                    disabled={junkMutation.isPending}
                                                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                                >
                                                    <XCircle className="h-4 w-4 mr-1" />
                                                    Junk
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Change Segment Dialog */}
            <Dialog open={!!changeSegmentLead} onOpenChange={() => setChangeSegmentLead(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Change Segment</DialogTitle>
                        <DialogDescription>
                            Select the correct segment for {changeSegmentLead?.customerName}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <Select value={newSegment} onValueChange={setNewSegment}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select segment" />
                            </SelectTrigger>
                            <SelectContent>
                                {SEGMENT_OPTIONS.map((seg) => (
                                    <SelectItem key={seg} value={seg}>
                                        <span className={SEGMENT_CONFIG[seg].color}>
                                            {SEGMENT_CONFIG[seg].name}
                                        </span>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {changeSegmentLead?.segmentSignals && changeSegmentLead.segmentSignals.length > 0 && (
                            <div className="mt-4">
                                <p className="text-sm text-muted-foreground mb-2">Detected signals:</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {changeSegmentLead.segmentSignals.map((signal, idx) => (
                                        <span
                                            key={idx}
                                            className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground"
                                        >
                                            {signal}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setChangeSegmentLead(null)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={() => {
                                if (changeSegmentLead && newSegment) {
                                    changeSegmentMutation.mutate({
                                        leadId: changeSegmentLead.id,
                                        segment: newSegment,
                                    });
                                }
                            }}
                            disabled={!newSegment || changeSegmentMutation.isPending}
                        >
                            {changeSegmentMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : null}
                            Save & Approve
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Bulk Junk Dialog */}
            <Dialog open={showBulkJunkDialog} onOpenChange={setShowBulkJunkDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-red-500" />
                            Mark {selectedLeads.size} Lead{selectedLeads.size > 1 ? "s" : ""} as Junk
                        </DialogTitle>
                        <DialogDescription>
                            This will mark the selected leads as junk/spam. This action can be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <label className="text-sm font-medium text-foreground">
                            Reason (optional)
                        </label>
                        <input
                            type="text"
                            value={junkReason}
                            onChange={(e) => setJunkReason(e.target.value)}
                            placeholder="e.g., Spam call, Wrong number"
                            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowBulkJunkDialog(false)}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => {
                                bulkJunkMutation.mutate({
                                    leadIds: Array.from(selectedLeads),
                                    reason: junkReason || undefined,
                                });
                            }}
                            disabled={bulkJunkMutation.isPending}
                        >
                            {bulkJunkMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <Trash2 className="h-4 w-4 mr-2" />
                            )}
                            Mark as Junk
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
