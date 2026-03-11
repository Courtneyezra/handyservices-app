import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Phone, Globe, Mic, CheckCircle2, Loader2, Check, ChevronDown } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { openWhatsApp, getWhatsAppErrorMessage } from "@/lib/whatsapp-helper";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

// Types
interface InboxItem {
    id: string;
    itemType: 'call' | 'lead';
    customerName: string;
    phone: string;
    summary: string | null;
    source: string;
    sourceType: string;
    urgency: number;
    actionStatus: string;
    address: string | null;
    recordingUrl: string | null;
    transcription: string | null;
    timestamp: string | null;
    tags: string[] | null;
    outcome: string | null;
}

function getUrgencyDot(urgency: number) {
    switch (urgency) {
        case 1: return "bg-red-500 animate-pulse";
        case 2: return "bg-amber-500";
        case 3: return "bg-green-500";
        default: return "bg-muted-foreground/50";
    }
}

function getSourceIcon(type: string, source: string) {
    const cls = "w-4 h-4";
    if (type === 'lead') {
        if (source.includes('AI')) return <Mic className={cls + " text-purple-400"} />;
        return <Globe className={cls + " text-blue-400"} />;
    }
    if (type === 'call') {
        if (source.includes('Missed')) return <Phone className={cls + " text-red-400"} />;
        if (source.includes('Out-of-Hours')) return <Phone className={cls + " text-amber-400"} />;
        return <Mic className={cls + " text-purple-400"} />;
    }
    return <MessageSquare className={cls} />;
}

function buildFollowUpMessage(item: InboxItem): string {
    const name = item.customerName?.split(' ')[0] || 'there';
    return `Hi ${name}, thanks for getting in touch with V6 Handyman Services! I'm following up on your enquiry. When's a good time to discuss?`;
}

export default function InboxPage() {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [resolvingId, setResolvingId] = useState<string | null>(null);
    const queryClient = useQueryClient();
    const { toast } = useToast();

    // Fetch real inbox data
    const { data: inboxItems = [], isLoading } = useQuery<InboxItem[]>({
        queryKey: ['/api/contractor/inbox'],
        queryFn: async () => {
            const res = await fetch('/api/contractor/inbox');
            if (!res.ok) throw new Error("Failed to fetch inbox");
            return res.json();
        },
        refetchInterval: 15000,
        retry: 1,
    });

    // WebSocket for real-time updates
    useEffect(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'inbox:new_item' || msg.type === 'inbox:item_updated' || msg.type === 'inbox:item_resolved') {
                    queryClient.invalidateQueries({ queryKey: ['/api/contractor/inbox'] });
                }
            } catch { /* ignore parse errors */ }
        };

        return () => ws.close();
    }, [queryClient]);

    // Resolve item
    const handleResolve = async (id: string) => {
        setResolvingId(id);
        try {
            const res = await fetch(`/api/contractor/inbox/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actionStatus: 'resolved' })
            });
            if (!res.ok) throw new Error('Failed to resolve');

            if (expandedId === id) setExpandedId(null);
            queryClient.invalidateQueries({ queryKey: ['/api/contractor/inbox'] });
            toast({ title: "Marked as dealt with", duration: 2000 });
        } catch {
            toast({ title: "Failed to update", variant: "destructive", duration: 3000 });
        } finally {
            setResolvingId(null);
        }
    };

    // WhatsApp + auto-resolve
    const handleWhatsApp = async (item: InboxItem) => {
        const message = buildFollowUpMessage(item);
        const result = await openWhatsApp(item.phone, message);

        if (result.success) {
            // Auto-resolve on successful WhatsApp open
            handleResolve(item.id);
        } else {
            const errorMsg = getWhatsAppErrorMessage(result);
            toast({ title: errorMsg.title, description: errorMsg.description, duration: 5000 });
        }
    };

    return (
        <div className="min-h-screen bg-background pb-20">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-card border-b border-border px-4 py-3">
                <div className="flex items-center justify-between">
                    <h1 className="text-lg font-bold text-foreground">Follow-Ups</h1>
                    {inboxItems.length > 0 && (
                        <span className="bg-amber-500/20 text-amber-400 text-xs font-bold px-2.5 py-1 rounded-full">
                            {inboxItems.length} pending
                        </span>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="px-4 py-3 space-y-3">
                {isLoading ? (
                    <div className="flex items-center justify-center py-20 text-muted-foreground">
                        <Loader2 className="w-6 h-6 animate-spin mr-2" />
                        Loading...
                    </div>
                ) : inboxItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                        <CheckCircle2 className="w-12 h-12 mb-3 opacity-30" />
                        <p className="font-medium">All caught up!</p>
                        <p className="text-sm mt-1">No pending follow-ups</p>
                    </div>
                ) : (
                    <AnimatePresence initial={false}>
                        {inboxItems.map((item) => {
                            const isExpanded = expandedId === item.id;
                            return (
                                <motion.div
                                    key={item.id}
                                    layout
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, x: -100 }}
                                    transition={{ duration: 0.2 }}
                                    className="bg-card rounded-xl border border-border shadow-sm overflow-hidden"
                                >
                                    {/* Card header — tap to expand */}
                                    <button
                                        onClick={() => setExpandedId(isExpanded ? null : item.id)}
                                        className="w-full text-left p-4 active:bg-muted/50"
                                    >
                                        <div className="flex items-start justify-between mb-1">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <div className={cn("w-2.5 h-2.5 rounded-full flex-shrink-0", getUrgencyDot(item.urgency))} />
                                                <span className="font-semibold text-foreground truncate">{item.customerName}</span>
                                            </div>
                                            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                                <span className="text-xs text-muted-foreground">
                                                    {item.timestamp ? formatDistanceToNow(new Date(item.timestamp), { addSuffix: true }) : ''}
                                                </span>
                                                <ChevronDown className={cn(
                                                    "w-4 h-4 text-muted-foreground transition-transform duration-200",
                                                    isExpanded && "rotate-180"
                                                )} />
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground ml-[18px]">
                                            {getSourceIcon(item.itemType, item.source)}
                                            <span>{item.source}</span>
                                        </div>
                                        <p className="text-sm text-muted-foreground mt-1.5 ml-[18px] line-clamp-1">
                                            {item.summary || 'No details available'}
                                        </p>
                                    </button>

                                    {/* Expanded details */}
                                    <AnimatePresence>
                                        {isExpanded && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: "auto", opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: 0.2 }}
                                                className="overflow-hidden"
                                            >
                                                <div className="px-4 pb-4 border-t border-border pt-3 space-y-3">
                                                    {/* Phone */}
                                                    <div className="flex items-center gap-2 text-sm text-foreground">
                                                        <Phone className="w-4 h-4 text-muted-foreground" />
                                                        {item.phone}
                                                    </div>

                                                    {/* Full summary */}
                                                    {item.summary && (
                                                        <div className="bg-muted rounded-lg p-3 text-sm text-foreground/80 leading-relaxed">
                                                            {item.summary}
                                                        </div>
                                                    )}
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    {/* Action buttons — always visible */}
                                    <div className="flex border-t border-border">
                                        <button
                                            onClick={() => handleWhatsApp(item)}
                                            className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold text-green-400 bg-green-500/10 active:bg-green-500/20 transition-colors"
                                        >
                                            <MessageSquare className="w-4 h-4" />
                                            WhatsApp
                                        </button>
                                        <div className="w-px bg-border" />
                                        <button
                                            onClick={() => handleResolve(item.id)}
                                            disabled={resolvingId === item.id}
                                            className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold text-muted-foreground active:bg-muted/50 transition-colors disabled:opacity-50"
                                        >
                                            {resolvingId === item.id ? (
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                            ) : (
                                                <Check className="w-4 h-4" />
                                            )}
                                            Dealt With
                                        </button>
                                    </div>
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                )}
            </div>
        </div>
    );
}
