import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Phone, Globe, Mic, CheckCircle2, Loader2, Check, ChevronDown, MapPin, Play, Eye, PhoneCallback } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { openWhatsApp, getWhatsAppErrorMessage } from "@/lib/whatsapp-helper";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

// Types
interface InboxItem {
    id: string;
    itemType: 'call' | 'lead' | 'quote_views';
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

type TabFilter = 'all' | 'quote_views' | 'ai_calls' | 'web_forms';

const TABS: { key: TabFilter; label: string; icon: React.ReactNode; color: string }[] = [
    { key: 'all', label: 'All', icon: null, color: 'text-foreground' },
    { key: 'quote_views', label: 'Quote Views', icon: <Eye className="w-3.5 h-3.5" />, color: 'text-orange-400' },
    { key: 'ai_calls', label: 'AI Calls', icon: <Mic className="w-3.5 h-3.5" />, color: 'text-purple-400' },
    { key: 'web_forms', label: 'Web Forms', icon: <Globe className="w-3.5 h-3.5" />, color: 'text-blue-400' },
];

function getItemTab(item: InboxItem): TabFilter {
    if (item.itemType === 'quote_views') return 'quote_views';
    if (item.itemType === 'call' || item.source.includes('AI Agent')) return 'ai_calls';
    return 'web_forms';
}

// Card border accent by type
function getCardAccent(item: InboxItem): string {
    if (item.itemType === 'quote_views') return 'border-l-orange-500';
    if (item.itemType === 'call' || item.source.includes('AI Agent')) return 'border-l-purple-500';
    return 'border-l-blue-500';
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
    if (source.includes('Quote Views')) {
        return { bg: "bg-orange-500/15 text-orange-400", label: source };
    }
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
    if (source.includes('Quote Views')) {
        return <Eye className={cls} />;
    }
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
    if (item.itemType === 'quote_views') {
        return `Hi ${name}! I noticed you've been looking at your quote — happy to answer any questions or adjust anything. Just let me know!`;
    }
    // Extract first line of job summary for context (before any transcript)
    const jobContext = item.summary
        ? item.summary.split('\n')[0].substring(0, 100).trim()
        : '';
    if (jobContext && name !== 'Unknown' && name !== 'Website Visitor') {
        return `Hi ${name}, it's Handy Services. Are you still interested in a quote for ${jobContext.toLowerCase()}?`;
    }
    return `Hi ${name}, it's Handy Services. Are you still interested in getting a quote? Let us know and we'll get one across to you.`;
}

// Subscribe to Web Push via service worker (works even when app is backgrounded)
function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
}

async function subscribeToPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const registration = await navigator.serviceWorker.ready;

    // Fetch VAPID public key from server
    const res = await fetch('/api/push/vapid-public-key');
    const { publicKey } = await res.json();
    if (!publicKey) return;

    // Subscribe or get existing subscription
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
    }

    // Send subscription to server
    await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
    });
}

export default function InboxPage() {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());
    const [activeTab, setActiveTab] = useState<TabFilter>('all');
    const queryClient = useQueryClient();
    const { toast } = useToast();

    // Subscribe to web push on mount
    useEffect(() => {
        subscribeToPush().catch(() => {});
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

    // Tab counts
    const tabCounts = useMemo(() => {
        const counts: Record<TabFilter, number> = { all: 0, quote_views: 0, ai_calls: 0, web_forms: 0 };
        visibleItems.forEach(item => {
            counts.all++;
            counts[getItemTab(item)]++;
        });
        return counts;
    }, [visibleItems]);

    // Filtered items by active tab
    const filteredItems = useMemo(() => {
        if (activeTab === 'all') return visibleItems;
        return visibleItems.filter(item => getItemTab(item) === activeTab);
    }, [visibleItems, activeTab]);

    // WebSocket for real-time UI updates (push notifications handled by service worker)
    useEffect(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'inbox:new_item') {
                    queryClient.invalidateQueries({ queryKey: ['/api/contractor/inbox'] });
                }
                if (msg.type === 'inbox:item_updated' || msg.type === 'inbox:item_resolved') {
                    queryClient.invalidateQueries({ queryKey: ['/api/contractor/inbox'] });
                }
            } catch { /* ignore parse errors */ }
        };

        return () => ws.close();
    }, [queryClient]);

    // Resolve item with optimistic cache update + fade
    const handleResolve = useCallback(async (id: string) => {
        // Optimistic: add to resolving set (triggers fade-out in this component)
        setResolvingIds(prev => new Set(prev).add(id));
        if (expandedId === id) setExpandedId(null);

        // Optimistic cache update — removes item from shared cache so badge count drops instantly
        const previousItems = queryClient.getQueryData<InboxItem[]>(['/api/contractor/inbox']);
        queryClient.setQueryData<InboxItem[]>(
            ['/api/contractor/inbox'],
            (old) => old?.filter(item => item.id !== id) ?? []
        );

        try {
            const res = await fetch(`/api/contractor/inbox/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actionStatus: 'resolved' })
            });
            if (!res.ok) throw new Error('Failed to resolve');

            // After fade completes, clean up resolving set
            setTimeout(() => {
                setResolvingIds(prev => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                });
            }, 350);
            // No toast — the fade-out is sufficient feedback
        } catch {
            // Revert optimistic cache update
            if (previousItems) {
                queryClient.setQueryData(['/api/contractor/inbox'], previousItems);
            }
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

    // Call back + auto-resolve
    const handleCallBack = useCallback((item: InboxItem) => {
        window.open(`tel:${item.phone}`, '_blank');
        handleResolve(item.id);
    }, [handleResolve]);

    return (
        <div className="min-h-screen bg-background pb-20">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-card border-b border-border">
                <div className="flex items-center justify-between px-4 py-3">
                    <h1 className="text-lg font-bold text-foreground">Follow-Ups</h1>
                    {visibleItems.length > 0 && (
                        <span className="bg-amber-500/20 text-amber-400 text-xs font-bold px-2.5 py-1 rounded-full">
                            {visibleItems.length} pending
                        </span>
                    )}
                </div>

                {/* Filter Tabs */}
                <div className="flex px-2 pb-2 gap-1 overflow-x-auto">
                    {TABS.map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={cn(
                                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all",
                                activeTab === tab.key
                                    ? "bg-foreground text-background"
                                    : "bg-muted/50 text-muted-foreground hover:bg-muted"
                            )}
                        >
                            {tab.icon}
                            {tab.label}
                            {tabCounts[tab.key] > 0 && (
                                <span className={cn(
                                    "ml-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                                    activeTab === tab.key
                                        ? "bg-background/20 text-background"
                                        : "bg-muted text-muted-foreground"
                                )}>
                                    {tabCounts[tab.key]}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content */}
            <div className="px-4 py-3 space-y-3">
                {isLoading ? (
                    <div className="flex items-center justify-center py-20 text-muted-foreground">
                        <Loader2 className="w-6 h-6 animate-spin mr-2" />
                        Loading...
                    </div>
                ) : filteredItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                        <CheckCircle2 className="w-12 h-12 mb-3 opacity-30" />
                        <p className="font-medium">All caught up!</p>
                        <p className="text-sm mt-1">No pending follow-ups{activeTab !== 'all' ? ` in ${TABS.find(t => t.key === activeTab)?.label}` : ''}</p>
                    </div>
                ) : (
                    <AnimatePresence initial={false} mode="popLayout">
                        {filteredItems.map((item) => {
                            const isExpanded = expandedId === item.id;
                            const badge = getSourceBadge(item.source);
                            const isCall = item.itemType === 'call' || item.source.includes('AI Agent');
                            return (
                                <motion.div
                                    key={item.id}
                                    layout
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, x: -100, height: 0, marginBottom: 0 }}
                                    transition={{ duration: 0.3 }}
                                    className={cn(
                                        "bg-card rounded-xl border shadow-sm overflow-hidden border-l-4",
                                        getCardAccent(item)
                                    )}
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
                                        {isCall ? (
                                            <>
                                                <button
                                                    onClick={() => handleCallBack(item)}
                                                    className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold text-purple-400 bg-purple-500/10 active:bg-purple-500/20 transition-colors"
                                                >
                                                    <Phone className="w-4 h-4" />
                                                    Call Back
                                                </button>
                                                <div className="w-px bg-border" />
                                                <button
                                                    onClick={() => handleResolve(item.id)}
                                                    className="flex-[0.7] flex items-center justify-center gap-2 py-3 text-sm font-semibold text-muted-foreground active:bg-muted/50 transition-colors"
                                                >
                                                    <Check className="w-4 h-4" />
                                                    Done
                                                </button>
                                            </>
                                        ) : (
                                            <button
                                                onClick={() => handleResolve(item.id)}
                                                className="flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold text-muted-foreground active:bg-muted/50 transition-colors"
                                            >
                                                <Check className="w-4 h-4" />
                                                Dealt With
                                            </button>
                                        )}
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
