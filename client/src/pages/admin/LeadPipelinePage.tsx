import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    DndContext,
    DragOverlay,
    PointerSensor,
    useSensor,
    useSensors,
    useDroppable,
    closestCorners,
    type DragStartEvent,
    type DragEndEvent,
} from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type KanbanStage = 'new' | 'pending' | 'complete' | 'lost';

// Old stages that may still appear in stale data — mapped client-side as a
// safety net. Backend migration should handle most of this already.
type AnyStage = string;

interface ApiLead {
    id: string;
    customerName: string;
    phone: string;
    jobDescription: string | null;
    stage: AnyStage;
    lastMessagePreview?: string | null;
    // ...other fields we don't care about here
    [key: string]: any;
}

interface KanbanLead {
    id: string;
    customerName: string;
    phone: string;
    jobDescription: string | null;
    lastMessagePreview: string | null;
    stage: KanbanStage;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const COLUMNS: { id: KanbanStage; label: string; color: string }[] = [
    { id: 'new', label: 'New', color: '#0ea5e9' },
    { id: 'pending', label: 'Pending', color: '#f59e0b' },
    { id: 'complete', label: 'Complete', color: '#22c55e' },
    { id: 'lost', label: 'Lost', color: '#64748b' },
];

const OLD_TO_NEW: Record<string, KanbanStage> = {
    // new
    new_lead: 'new',
    contacted: 'new',
    awaiting_video: 'new',
    video_received: 'new',
    // pending
    visit_scheduled: 'pending',
    visit_done: 'pending',
    quote_sent: 'pending',
    quote_viewed: 'pending',
    awaiting_payment: 'pending',
    in_progress: 'pending',
    // complete
    booked: 'complete',
    completed: 'complete',
    // lost
    lost: 'lost',
    expired: 'lost',
    declined: 'lost',
    // identity (new stages passed through)
    new: 'new',
    pending: 'pending',
    complete: 'complete',
};

function normaliseStage(stage: AnyStage | null | undefined): KanbanStage {
    if (!stage) return 'new';
    return OLD_TO_NEW[stage] ?? 'new';
}

function truncate(s: string | null | undefined, n: number): string {
    if (!s) return '';
    return s.length > n ? s.slice(0, n).trimEnd() + '…' : s;
}

// ---------------------------------------------------------------------------
// Draggable card
// ---------------------------------------------------------------------------

function LeadCardView({
    lead,
    isDragging,
    onClick,
}: {
    lead: KanbanLead;
    isDragging?: boolean;
    onClick?: () => void;
}) {
    return (
        <div
            onClick={onClick}
            className={cn(
                "select-none rounded-md border bg-background p-3 shadow-sm transition-all",
                "hover:border-primary/50 hover:shadow-md cursor-pointer",
                isDragging && "opacity-60 rotate-1 shadow-lg",
            )}
        >
            <div className="font-semibold text-sm truncate">{lead.customerName || 'Unknown'}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{lead.phone}</div>
            {(lead.lastMessagePreview || lead.jobDescription) && (
                <div className="text-xs italic text-muted-foreground mt-2 line-clamp-2">
                    {lead.lastMessagePreview || truncate(lead.jobDescription, 60)}
                </div>
            )}
        </div>
    );
}

function DraggableLeadCard({
    lead,
    onClick,
}: {
    lead: KanbanLead;
    onClick: () => void;
}) {
    const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({
        id: lead.id,
    });

    const style: React.CSSProperties = transform
        ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
        : {};

    // Track whether we actually moved (drag vs click)
    const [downPos, setDownPos] = useState<{ x: number; y: number } | null>(null);

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            onPointerDown={(e) => setDownPos({ x: e.clientX, y: e.clientY })}
            onClickCapture={(e) => {
                // Suppress click when this was actually a drag.
                if (downPos) {
                    const dx = Math.abs(e.clientX - downPos.x);
                    const dy = Math.abs(e.clientY - downPos.y);
                    if (dx > 6 || dy > 6) {
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                }
                onClick();
            }}
            className="mb-2"
        >
            <LeadCardView lead={lead} isDragging={isDragging} />
        </div>
    );
}

// ---------------------------------------------------------------------------
// Droppable column
// ---------------------------------------------------------------------------

function KanbanColumn({
    col,
    leads,
    onCardClick,
}: {
    col: typeof COLUMNS[number];
    leads: KanbanLead[];
    onCardClick: (lead: KanbanLead) => void;
}) {
    const { setNodeRef, isOver } = useDroppable({ id: col.id });

    return (
        <div
            ref={setNodeRef}
            className={cn(
                "flex-1 min-w-[260px] max-w-[400px] flex flex-col rounded-lg bg-muted/40 p-3",
                "border-2 border-transparent transition-colors",
                isOver && "border-primary/60 bg-muted/70",
            )}
        >
            {/* Header */}
            <div className="flex items-center gap-2 mb-3 pb-2 border-b">
                <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: col.color }}
                />
                <h3 className="font-semibold text-sm">{col.label}</h3>
                <span className="ml-auto text-xs text-muted-foreground bg-background px-2 py-0.5 rounded-full">
                    {leads.length}
                </span>
            </div>

            {/* Cards */}
            <div className="flex-1 overflow-y-auto pr-1 -mr-1">
                {leads.length === 0 ? (
                    <div className="text-center text-xs text-muted-foreground/60 py-8">
                        Drop leads here
                    </div>
                ) : (
                    leads.map(lead => (
                        <DraggableLeadCard
                            key={lead.id}
                            lead={lead}
                            onClick={() => onCardClick(lead)}
                        />
                    ))
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function LeadPipelinePage() {
    const queryClient = useQueryClient();
    const { toast } = useToast();

    const isEmbed = typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('embed') === '1';

    // Handshake ping for embed parent
    useEffect(() => {
        if (isEmbed && typeof window !== 'undefined' && window.parent !== window) {
            try {
                window.parent.postMessage({ kind: 'handy-wa:hello', at: Date.now() }, '*');
            } catch {}
        }
    }, [isEmbed]);

    // Local optimistic state layered over the fetched data
    const [localLeads, setLocalLeads] = useState<KanbanLead[] | null>(null);
    const [activeDragId, setActiveDragId] = useState<string | null>(null);

    // Fetch leads. We re-use the existing /api/admin/lead-pipeline endpoint and
    // flatten the swimlane/stage structure down to a simple list.
    const { data, isLoading, refetch, isFetching } = useQuery<KanbanLead[]>({
        queryKey: ["lead-kanban"],
        queryFn: async () => {
            const res = await fetch("/api/admin/lead-pipeline");
            if (!res.ok) throw new Error("Failed to fetch leads");
            const json = await res.json();

            // The pipeline endpoint returns { swimlanes: [{ stages: [{ items: [...] }]}] }.
            // Fall back to other shapes defensively.
            const rawItems: ApiLead[] = [];
            if (Array.isArray(json?.swimlanes)) {
                for (const lane of json.swimlanes) {
                    for (const stage of lane.stages ?? []) {
                        for (const item of stage.items ?? []) {
                            rawItems.push({ ...item, stage: item.stage ?? stage.stage });
                        }
                    }
                }
            } else if (Array.isArray(json?.columns)) {
                for (const col of json.columns) {
                    for (const item of col.items ?? []) {
                        rawItems.push({ ...item, stage: item.stage ?? col.id });
                    }
                }
            } else if (Array.isArray(json?.leads)) {
                rawItems.push(...json.leads);
            } else if (Array.isArray(json)) {
                rawItems.push(...json);
            }

            return rawItems.map((r): KanbanLead => ({
                id: r.id,
                customerName: r.customerName ?? 'Unknown',
                phone: r.phone ?? '',
                jobDescription: r.jobDescription ?? null,
                lastMessagePreview: r.lastMessagePreview ?? null,
                stage: normaliseStage(r.stage),
            }));
        },
        refetchInterval: 30000,
    });

    // Keep local state in sync with server data (unless we're mid-drag)
    useEffect(() => {
        if (data && activeDragId === null) {
            setLocalLeads(data);
        }
    }, [data, activeDragId]);

    const leads = localLeads ?? data ?? [];

    const byColumn = useMemo(() => {
        const map: Record<KanbanStage, KanbanLead[]> = {
            new: [], pending: [], complete: [], lost: [],
        };
        for (const lead of leads) {
            map[lead.stage].push(lead);
        }
        return map;
    }, [leads]);

    // Mutation: PATCH stage
    const updateStage = useMutation({
        mutationFn: async ({ leadId, newStage }: { leadId: string; newStage: KanbanStage }) => {
            const res = await fetch(`/api/admin/leads/${leadId}/stage`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stage: newStage }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `Failed to update stage (${res.status})`);
            }
            return res.json();
        },
        onError: (error: Error) => {
            toast({
                title: "Could not move lead",
                description: error.message,
                variant: "destructive",
            });
            // Revert by re-syncing from server
            queryClient.invalidateQueries({ queryKey: ["lead-kanban"] });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["lead-kanban"] });
        },
    });

    // Drag sensors
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    );

    const handleDragStart = (e: DragStartEvent) => {
        setActiveDragId(e.active.id as string);
    };

    const handleDragEnd = (e: DragEndEvent) => {
        const { active, over } = e;
        setActiveDragId(null);
        if (!over) return;

        const leadId = active.id as string;
        const overId = over.id as string;

        // over.id is the column id (we only make columns droppable)
        const targetColumn = COLUMNS.find(c => c.id === overId);
        if (!targetColumn) return;

        const lead = leads.find(l => l.id === leadId);
        if (!lead || lead.stage === targetColumn.id) return;

        // Optimistic update
        setLocalLeads(prev => {
            const base = prev ?? leads;
            return base.map(l => (l.id === leadId ? { ...l, stage: targetColumn.id } : l));
        });

        updateStage.mutate({ leadId, newStage: targetColumn.id });

        toast({
            title: "Moved",
            description: `${lead.customerName} → ${targetColumn.label}`,
        });
    };

    // Card click → open WA chat via parent postMessage (embed) + local nothing
    const handleCardClick = (lead: KanbanLead) => {
        if (isEmbed && typeof window !== 'undefined' && window.parent !== window) {
            try {
                window.parent.postMessage(
                    { kind: 'handy-wa:open-chat', phone: lead.phone, leadId: lead.id },
                    '*',
                );
            } catch (err) {
                console.warn('[embed] postMessage failed', err);
            }
        }
    };

    const activeLead = activeDragId ? leads.find(l => l.id === activeDragId) ?? null : null;

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className={cn(
            "flex flex-col overflow-hidden",
            isEmbed ? "h-screen" : "h-[calc(100vh-64px)]",
        )}>
            {/* Header */}
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b bg-background">
                <div>
                    <h1 className="text-xl font-bold tracking-tight">Lead Pipeline</h1>
                    <p className="text-xs text-muted-foreground">
                        {leads.length} lead{leads.length === 1 ? '' : 's'} total
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetch()}
                    disabled={isFetching}
                >
                    <RefreshCw className={cn("h-4 w-4 mr-2", isFetching && "animate-spin")} />
                    Refresh
                </Button>
            </div>

            {/* Board */}
            <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCorners}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                >
                    <div className="h-full flex gap-4">
                        {COLUMNS.map(col => (
                            <KanbanColumn
                                key={col.id}
                                col={col}
                                leads={byColumn[col.id]}
                                onCardClick={handleCardClick}
                            />
                        ))}
                    </div>

                    <DragOverlay>
                        {activeLead && <LeadCardView lead={activeLead} isDragging />}
                    </DragOverlay>
                </DndContext>
            </div>
        </div>
    );
}
