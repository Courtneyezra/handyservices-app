import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    DndContext,
    DragOverlay,
    closestCorners,
    useSensor,
    useSensors,
    PointerSensor,
    DragStartEvent,
    DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
    Phone,
    MessageSquare,
    FileText,
    Clock,
    AlertTriangle,
    CheckCircle2,
    Loader2,
    ArrowRight,
    User,
    RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// Types
type LeadStage =
    | 'new_lead'
    | 'contacted'
    | 'awaiting_video'
    | 'quote_sent'
    | 'quote_viewed'
    | 'awaiting_payment'
    | 'booked'
    | 'in_progress'
    | 'completed'
    | 'lost'
    | 'expired'
    | 'declined';

interface FunnelItem {
    id: string;
    customerName: string;
    phone: string;
    jobDescription: string | null;
    source: string | null;
    stage: LeadStage;
    stageUpdatedAt: string | null;
    timeInStage: string;
    slaStatus: 'ok' | 'warning' | 'overdue';
    nextAction: string;
    hasWhatsAppWindow: boolean;
    quoteId?: string;
    quoteSlug?: string;
    createdAt: string | null;
}

interface FunnelColumn {
    id: LeadStage;
    title: string;
    count: number;
    items: FunnelItem[];
}

interface FunnelData {
    columns: FunnelColumn[];
    totals: {
        active: number;
        completed: number;
        lost: number;
    };
}

// SLA Status Badge Component
function SLABadge({ status }: { status: 'ok' | 'warning' | 'overdue' }) {
    if (status === 'ok') {
        return (
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                On Track
            </Badge>
        );
    }
    if (status === 'warning') {
        return (
            <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 text-xs">
                <Clock className="h-3 w-3 mr-1" />
                Hurry
            </Badge>
        );
    }
    return (
        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Overdue
        </Badge>
    );
}

// Draggable Lead Card Component
function LeadCard({ item, isDragging }: { item: FunnelItem; isDragging?: boolean }) {
    return (
        <Card
            className={cn(
                "mb-2 cursor-grab active:cursor-grabbing transition-all",
                "border-border hover:border-primary/50 hover:shadow-md",
                isDragging && "shadow-lg border-primary rotate-2",
                item.slaStatus === 'overdue' && "border-red-300 bg-red-50/50",
                item.slaStatus === 'warning' && "border-yellow-300 bg-yellow-50/30"
            )}
        >
            <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span className="font-medium text-sm truncate">
                                {item.customerName}
                            </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {item.jobDescription || "No description"}
                        </p>
                    </div>
                    <SLABadge status={item.slaStatus} />
                </div>

                {/* Time in stage */}
                <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{item.timeInStage} in stage</span>
                </div>

                {/* Quick Actions */}
                <div className="flex items-center gap-1 mt-2">
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={(e) => {
                            e.stopPropagation();
                            window.open(`tel:${item.phone}`, '_blank');
                        }}
                    >
                        <Phone className="h-3 w-3 mr-1" />
                        Call
                    </Button>

                    {item.hasWhatsAppWindow && (
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-green-600"
                            onClick={(e) => {
                                e.stopPropagation();
                                window.location.href = `/admin/inbox?phone=${item.phone}`;
                            }}
                        >
                            <MessageSquare className="h-3 w-3 mr-1" />
                            WhatsApp
                        </Button>
                    )}

                    {item.quoteSlug && (
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={(e) => {
                                e.stopPropagation();
                                window.open(`/q/${item.quoteSlug}`, '_blank');
                            }}
                        >
                            <FileText className="h-3 w-3 mr-1" />
                            Quote
                        </Button>
                    )}
                </div>

                {/* Next Action */}
                <div className="flex items-center gap-1 mt-2 text-xs">
                    <ArrowRight className="h-3 w-3 text-primary" />
                    <span className="text-primary font-medium">{item.nextAction}</span>
                </div>
            </CardContent>
        </Card>
    );
}

// Sortable Lead Card Wrapper
function SortableLeadCard({ item }: { item: FunnelItem }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: item.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
            <LeadCard item={item} isDragging={isDragging} />
        </div>
    );
}

// Column Component
function FunnelColumnComponent({
    column,
    isActiveColumn,
}: {
    column: FunnelColumn;
    isActiveColumn: boolean;
}) {
    const columnColors: Record<LeadStage, string> = {
        'new_lead': 'bg-blue-500',
        'contacted': 'bg-cyan-500',
        'awaiting_video': 'bg-violet-500',
        'quote_sent': 'bg-indigo-500',
        'quote_viewed': 'bg-purple-500',
        'awaiting_payment': 'bg-amber-500',
        'booked': 'bg-green-500',
        'in_progress': 'bg-emerald-500',
        'completed': 'bg-teal-500',
        'lost': 'bg-red-500',
        'expired': 'bg-gray-500',
        'declined': 'bg-rose-500',
    };

    return (
        <div
            className={cn(
                "flex-shrink-0 w-72 bg-muted/50 rounded-lg p-3",
                "min-h-[500px] max-h-[calc(100vh-220px)] overflow-y-auto",
                !isActiveColumn && "opacity-60"
            )}
        >
            {/* Column Header */}
            <div className="flex items-center gap-2 mb-3 sticky top-0 bg-muted/80 backdrop-blur-sm py-1 z-10">
                <div className={cn("w-3 h-3 rounded-full", columnColors[column.id])} />
                <h3 className="font-semibold text-sm">{column.title}</h3>
                <Badge variant="secondary" className="ml-auto text-xs">
                    {column.count}
                </Badge>
            </div>

            {/* Column Items */}
            <SortableContext
                items={column.items.map(item => item.id)}
                strategy={verticalListSortingStrategy}
            >
                <div className="space-y-2">
                    {column.items.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground text-sm">
                            No leads
                        </div>
                    ) : (
                        column.items.map(item => (
                            <SortableLeadCard key={item.id} item={item} />
                        ))
                    )}
                </div>
            </SortableContext>
        </div>
    );
}

// Main Page Component
export default function LeadFunnelPage() {
    const [activeId, setActiveId] = useState<string | null>(null);
    const [activeItem, setActiveItem] = useState<FunnelItem | null>(null);
    const queryClient = useQueryClient();
    const { toast } = useToast();

    // Sensors for drag detection
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        })
    );

    // Fetch funnel data
    const { data: funnelData, isLoading, refetch } = useQuery<FunnelData>({
        queryKey: ["lead-funnel"],
        queryFn: async () => {
            const res = await fetch("/api/admin/lead-funnel");
            if (!res.ok) throw new Error("Failed to fetch funnel data");
            return res.json();
        },
        refetchInterval: 30000, // Refresh every 30 seconds
    });

    // Mutation to update lead stage
    const updateStageMutation = useMutation({
        mutationFn: async ({ leadId, newStage }: { leadId: string; newStage: LeadStage }) => {
            const res = await fetch(`/api/admin/leads/${leadId}/stage`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stage: newStage }),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Failed to update stage');
            }
            return res.json();
        },
        onSuccess: (data) => {
            toast({
                title: "Stage Updated",
                description: `Lead moved to ${data.newStage.replace(/_/g, ' ')}`,
            });
            queryClient.invalidateQueries({ queryKey: ["lead-funnel"] });
        },
        onError: (error: Error) => {
            toast({
                title: "Update Failed",
                description: error.message,
                variant: "destructive",
            });
            // Refetch to restore correct state
            queryClient.invalidateQueries({ queryKey: ["lead-funnel"] });
        },
    });

    // Find item in columns
    const findItemById = useCallback((id: string): FunnelItem | null => {
        if (!funnelData) return null;
        for (const column of funnelData.columns) {
            const item = column.items.find(i => i.id === id);
            if (item) return item;
        }
        return null;
    }, [funnelData]);

    // Find column containing an item
    const findColumnByItemId = useCallback((id: string): LeadStage | null => {
        if (!funnelData) return null;
        for (const column of funnelData.columns) {
            if (column.items.some(i => i.id === id)) {
                return column.id;
            }
        }
        return null;
    }, [funnelData]);

    // Drag handlers
    const handleDragStart = (event: DragStartEvent) => {
        const { active } = event;
        setActiveId(active.id as string);
        setActiveItem(findItemById(active.id as string));
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        setActiveId(null);
        setActiveItem(null);

        if (!over) return;

        const activeColumn = findColumnByItemId(active.id as string);

        // Determine target column - could be dropped on a column or on another item
        let targetColumn: LeadStage | null = null;

        // Check if dropped on a column header/container
        if (funnelData?.columns.some(c => c.id === over.id)) {
            targetColumn = over.id as LeadStage;
        } else {
            // Dropped on another item - find its column
            targetColumn = findColumnByItemId(over.id as string);
        }

        if (!targetColumn || activeColumn === targetColumn) return;

        // Update the stage
        updateStageMutation.mutate({
            leadId: active.id as string,
            newStage: targetColumn,
        });
    };

    // Active columns (main funnel stages)
    const activeStages: LeadStage[] = [
        'new_lead', 'contacted', 'awaiting_video', 'quote_sent', 'quote_viewed',
        'awaiting_payment', 'booked', 'in_progress'
    ];

    if (isLoading) {
        return (
            <div className="flex h-96 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!funnelData) {
        return (
            <div className="flex h-96 items-center justify-center text-muted-foreground">
                Failed to load funnel data
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Lead Funnel</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Drag leads between stages to update their status
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    {/* Totals */}
                    <div className="flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-blue-500" />
                            <span className="text-muted-foreground">Active:</span>
                            <span className="font-semibold">{funnelData.totals.active}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-green-500" />
                            <span className="text-muted-foreground">Completed:</span>
                            <span className="font-semibold">{funnelData.totals.completed}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-red-500" />
                            <span className="text-muted-foreground">Lost:</span>
                            <span className="font-semibold">{funnelData.totals.lost}</span>
                        </div>
                    </div>

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => refetch()}
                        disabled={isLoading}
                    >
                        <RefreshCw className={cn("h-4 w-4 mr-2", isLoading && "animate-spin")} />
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Kanban Board */}
            <div className="flex-1 overflow-x-auto p-4">
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCorners}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                >
                    <div className="flex gap-4">
                        {funnelData.columns
                            .filter(col => activeStages.includes(col.id))
                            .map(column => (
                                <FunnelColumnComponent
                                    key={column.id}
                                    column={column}
                                    isActiveColumn={true}
                                />
                            ))}

                        {/* Terminal States - Collapsed */}
                        <div className="flex-shrink-0 w-72 space-y-4">
                            {funnelData.columns
                                .filter(col => !activeStages.includes(col.id))
                                .map(column => (
                                    <FunnelColumnComponent
                                        key={column.id}
                                        column={column}
                                        isActiveColumn={false}
                                    />
                                ))}
                        </div>
                    </div>

                    {/* Drag Overlay */}
                    <DragOverlay>
                        {activeItem && <LeadCard item={activeItem} isDragging />}
                    </DragOverlay>
                </DndContext>
            </div>
        </div>
    );
}
