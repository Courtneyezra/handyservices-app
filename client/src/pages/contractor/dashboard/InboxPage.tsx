import { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Phone, Globe, Mic, CheckCircle2, Loader2, Check, ChevronDown, MapPin, Play } from "lucide-react";
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

function getSourceBadge(source: string) {
    if (source.includes('Missed') || source.includes('Hung Up') || source.includes('Busy')) {
        return { bg: "bg-red-500/15 text-red-400", label: source };
    }
    if (source.includes('Out-of-Hours')) {
        return { bg: "bg-amber-500/15 text-amber-400", label: source };
    }
    if (source.includes('AI Agent')) {
        return { bg: "bg-purple-500/15 text-purple-400", label: source };
    }
    if (source.includes('Web')) {
        return { bg: "bg-blue-500/15 text-blue-400", label: source };
    }
    return { bg: "bg-muted text-muted-foreground", label: source };
}

function getSourceIcon(source: string) {
    const cls = "w-3.5 h-3.5";
    if (source.includes('Missed') || source.includes('Out-of-Hours') || source.includes('Hung Up') || source.includes('Busy')) {
        return <Phone className={cls} />;
    }
    if (source.includes('AI Agent')) {
        return <Mic className={cls} />;
    }
    if (source.includes('Web')) {
        return <Globe className={cls} />;
    }
    return <MessageSquare className={cls} />;
}

function buildFollowUpMessage(item: InboxItem): string {
    const name = item.customerName?.split(' ')[0] || 'there';
    return `Hi ${name}, thanks for getting in touch with V6 Handyman Services! I'm following up on your enquiry. When's a good time to discuss?`;
}

// Request push notification permission
async function requestPushPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
}

function showPushNotification(item: { customerName: string; summary: string | null; source: string }) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const notification = new Notification(`New follow-up from ${item.customerName}`, {
        body: item.summary || item.source,
        icon: '/logo.png',
        tag: 'follow-up',
    } as NotificationOptions);
    notification.onclick = () => {
        window.focus();
        notification.close();
    };
}

export default function InboxPage() {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());
    const queryClient = useQueryClient();
    const { toast } = useToast();

    // Request push permission on mount
    useEffect(() => {
        requestPushPermission();
    }, []);

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

    // Filter out items being resolved (optimistic removal)
    const visibleItems = inboxItems.filter(item => !resolvingIds.has(item.id));

    // WebSocket for real-time updates + push notifications
    useEffect(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'inbox:new_item') {
                    queryClient.invalidateQueries({ queryKey: ['/api/contractor/inbox'] });
                    // Push notification for new items
                    if (msg.data) {
                        showPushNotification(msg.data);
                    }
                }
                if (msg.type === 'inbox:item_updated' || msg.type === 'inbox:item_resolved') {
                    queryClient.invalidateQueries({ queryKey: ['/api/contractor/inbox'] });
                }
            } catch { /* ignore parse errors */ }
        };

        return () => ws.close();
    }, [queryClient]);

    // Resolve item with optimistic removal + fade
    const handleResolve = useCallback(async (id: string) => {
        // Optimistic: add to resolving set (triggers fade-out)
        setResolvingIds(prev => new Set(prev).add(id));
        if (expandedId === id) setExpandedId(null);

        try {
            const res = await fetch(`/api/contractor/inbox/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actionStatus: 'resolved' })
            });
            if (!res.ok) throw new Error('Failed to resolve');

            // After fade completes, refetch to sync
            setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: ['/api/contractor/inbox'] });
                setResolvingIds(prev => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                });
            }, 350);
            toast({ title: "Marked as dealt with", duration: 2000 });
        } catch {
            // Revert optimistic removal
            setResolvingIds(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
            toast({ title: "Failed to update", variant: "destructive", duration: 3000 });
        }
    }, [expandedId, queryClient, toast]);

    // WhatsApp + auto-resolve
    const handleWhatsApp = useCallback(async (item: InboxItem) => {
        const message = buildFollowUpMessage(item);
        const result = await openWhatsApp(item.phone, message);

        if (result.success) {
            handleResolve(item.id);
        } else {
            const errorMsg = getWhatsAppErrorMessage(result);
            toast({ title: errorMsg.title, description: errorMsg.description, duration: 5000 });
        }
    }, [handleResolve, toast]);

    return (
        <div className="min-h-screen bg-background pb-20">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-card border-b border-border px-4 py-3">
                <div className="flex items-center justify-between">
                    <h1 className="text-lg font-bold text-foreground">Follow-Ups</h1>
                    {visibleItems.length > 0 && (
                        <span className="bg-amber-500/20 text-amber-400 text-xs font-bold px-2.5 py-1 rounded-full">
                            {visibleItems.length} pending
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
                ) : visibleItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                        <CheckCircle2 className="w-12 h-12 mb-3 opacity-30" />
                        <p className="font-medium">All caught up!</p>
                        <p className="text-sm mt-1">No pending follow-ups</p>
                    </div>
                ) : (
                    <AnimatePresence initial={false} mode="popLayout">
                        {visibleItems.map((item) => {
                            const isExpanded = expandedId === item.id;
                            const badge = getSourceBadge(item.source);
                            return (
                                <motion.div
                                    key={item.id}
                                    layout
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, x: -100, height: 0, marginBottom: 0 }}
                                    transition={{ duration: 0.3 }}
                                    className="bg-card rounded-xl border border-border shadow-sm overflow-hidden"
                                >
                                    {/* Card header — tap to expand */}
                                    <button
                                        onClick={() => setExpandedId(isExpanded ? null : item.id)}
                                        className="w-full text-left p-4 active:bg-muted/50"
                                    >
                                        {/* Row 1: Name + time */}
                                        <div className="flex items-start justify-between mb-1.5">
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

                                        {/* Row 2: Source badge + phone */}
                                        <div className="flex items-center gap-2 ml-[18px] mb-1.5">
                                            <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full", badge.bg)}>
                                                {getSourceIcon(item.source)}
                                                {badge.label}
                                            </span>
                                            {item.phone && (
                                                <span className="text-xs text-muted-foreground">{item.phone}</span>
                                            )}
                                        </div>

                                        {/* Row 3: Job summary preview */}
                                        <p className="text-sm text-muted-foreground ml-[18px] line-clamp-2">
                                            {item.summary || 'No details available'}
                                        </p>

                                        {/* Row 4: Address if present */}
                                        {item.address && (
                                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1.5 ml-[18px]">
                                                <MapPin className="w-3 h-3" />
                                                <span className="truncate">{item.address}</span>
                                            </div>
                                        )}
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
                                                    {/* Full summary */}
                                                    {item.summary && (
                                                        <div className="bg-muted rounded-lg p-3 text-sm text-foreground/80 leading-relaxed">
                                                            {item.summary}
                                                        </div>
                                                    )}

                                                    {/* Audio player for call recordings */}
                                                    {item.recordingUrl && item.itemType === 'call' && (
                                                        <div className="space-y-1.5">
                                                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                                <Play className="w-3 h-3" />
                                                                <span>Call Recording</span>
                                                            </div>
                                                            <audio
                                                                controls
                                                                preload="none"
                                                                className="w-full h-10 rounded-lg"
                                                                src={`/api/calls/${item.id}/recording`}
                                                            />
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
                                            className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold text-muted-foreground active:bg-muted/50 transition-colors"
                                        >
                                            <Check className="w-4 h-4" />
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
