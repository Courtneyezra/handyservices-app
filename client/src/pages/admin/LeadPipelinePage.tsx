import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    Phone,
    MessageSquare,
    FileText,
    Clock,
    AlertTriangle,
    CheckCircle2,
    Loader2,
    TrendingUp,
    Users,
    RefreshCw,
    ChevronDown,
    ChevronUp,
    Zap,
    Layers,
    ClipboardCheck,
    HelpCircle,
    Video,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import LiveActivityStream, { type ActivityItem } from "@/components/admin/LiveActivityStream";

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

type QuotePath = 'instant' | 'tiered' | 'assessment' | 'no_quote';

interface PipelineItem {
    id: string;
    customerName: string;
    phone: string;
    jobDescription: string | null;
    source: string | null;
    segment: string | null;
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

interface StageData {
    stage: LeadStage;
    title: string;
    count: number;
    items: PipelineItem[];
}

interface Swimlane {
    path: QuotePath;
    title: string;
    stages: StageData[];
    stats: {
        total: number;
        active: number;
        completed: number;
        conversionRate: number;
    };
}

interface PipelineData {
    swimlanes: Swimlane[];
    totals: {
        active: number;
        completed: number;
        lost: number;
        total: number;
    };
    stageOrder: LeadStage[];
}

// Path icons
const PATH_ICONS: Record<QuotePath, React.ReactNode> = {
    'instant': <Zap className="h-4 w-4" />,
    'tiered': <Layers className="h-4 w-4" />,
    'assessment': <ClipboardCheck className="h-4 w-4" />,
    'no_quote': <HelpCircle className="h-4 w-4" />,
};

// Path colors
const PATH_COLORS: Record<QuotePath, string> = {
    'instant': 'bg-emerald-500',
    'tiered': 'bg-blue-500',
    'assessment': 'bg-purple-500',
    'no_quote': 'bg-gray-500',
};

// Stage colors (for row headers)
const STAGE_COLORS: Record<LeadStage, string> = {
    'new_lead': 'text-blue-500',
    'contacted': 'text-cyan-500',
    'awaiting_video': 'text-violet-500',
    'quote_sent': 'text-indigo-500',
    'quote_viewed': 'text-purple-500',
    'awaiting_payment': 'text-amber-500',
    'booked': 'text-green-500',
    'in_progress': 'text-emerald-500',
    'completed': 'text-teal-500',
    'lost': 'text-red-500',
    'expired': 'text-gray-500',
    'declined': 'text-rose-500',
};

// Compact Lead Chip
function LeadChip({ item, onClick }: { item: PipelineItem; onClick: () => void }) {
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        onClick={onClick}
                        className={cn(
                            "flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium",
                            "bg-background border transition-all hover:shadow-md hover:scale-105",
                            "max-w-full truncate cursor-pointer",
                            item.slaStatus === 'overdue' && "border-red-400 bg-red-50 dark:bg-red-950",
                            item.slaStatus === 'warning' && "border-yellow-400 bg-yellow-50 dark:bg-yellow-950",
                            item.slaStatus === 'ok' && "border-border hover:border-primary"
                        )}
                    >
                        {item.slaStatus === 'overdue' && <AlertTriangle className="h-3 w-3 text-red-500 flex-shrink-0" />}
                        {item.slaStatus === 'warning' && <Clock className="h-3 w-3 text-yellow-500 flex-shrink-0" />}
                        <span className="truncate">{item.customerName.split(' ')[0]}</span>
                    </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                    <div className="space-y-1">
                        <p className="font-semibold">{item.customerName}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{item.jobDescription}</p>
                        <div className="flex items-center gap-2 text-xs">
                            <Clock className="h-3 w-3" />
                            <span>{item.timeInStage} in stage</span>
                        </div>
                        <p className="text-xs text-primary">{item.nextAction}</p>
                    </div>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}

// Lead Detail Panel (slides in from right)
function LeadDetailPanel({
    item,
    onClose,
    onStageChange,
}: {
    item: PipelineItem | null;
    onClose: () => void;
    onStageChange: (leadId: string, newStage: LeadStage) => void;
}) {
    if (!item) return null;

    const stages: LeadStage[] = [
        'new_lead', 'contacted', 'quote_sent', 'quote_viewed',
        'awaiting_payment', 'booked', 'in_progress', 'completed'
    ];

    return (
        <div className="fixed inset-y-0 right-0 w-80 bg-background border-l shadow-xl z-50 flex flex-col">
            {/* Header */}
            <div className="p-4 border-b flex items-center justify-between">
                <h3 className="font-semibold truncate">{item.customerName}</h3>
                <Button variant="ghost" size="sm" onClick={onClose}>×</Button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Contact */}
                <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Contact</p>
                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            className="flex-1"
                            onClick={() => window.open(`tel:${item.phone}`, '_blank')}
                        >
                            <Phone className="h-4 w-4 mr-1" />
                            Call
                        </Button>
                        {item.hasWhatsAppWindow && (
                            <Button
                                size="sm"
                                variant="outline"
                                className="flex-1 text-green-600"
                                onClick={() => window.location.href = `/admin/inbox?phone=${item.phone}`}
                            >
                                <MessageSquare className="h-4 w-4 mr-1" />
                                WhatsApp
                            </Button>
                        )}
                    </div>
                </div>

                {/* Job */}
                <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Job Description</p>
                    <p className="text-sm">{item.jobDescription || "No description"}</p>
                </div>

                {/* Status */}
                <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Status</p>
                    <div className="flex items-center gap-2">
                        <Badge variant={item.slaStatus === 'ok' ? 'default' : item.slaStatus === 'warning' ? 'secondary' : 'destructive'}>
                            {item.timeInStage} in stage
                        </Badge>
                        {item.segment && <Badge variant="outline">{item.segment}</Badge>}
                    </div>
                </div>

                {/* Quote */}
                {item.quoteSlug && (
                    <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">Quote</p>
                        <Button
                            size="sm"
                            variant="outline"
                            className="w-full"
                            onClick={() => window.open(`/q/${item.quoteSlug}`, '_blank')}
                        >
                            <FileText className="h-4 w-4 mr-1" />
                            View Quote
                        </Button>
                    </div>
                )}

                {/* Move to Stage */}
                <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Move to Stage</p>
                    <div className="grid grid-cols-2 gap-1">
                        {stages.map(stage => (
                            <Button
                                key={stage}
                                size="sm"
                                variant={stage === item.stage ? "default" : "ghost"}
                                className="text-xs justify-start"
                                disabled={stage === item.stage}
                                onClick={() => onStageChange(item.id, stage)}
                            >
                                {stage.replace(/_/g, ' ')}
                            </Button>
                        ))}
                    </div>
                </div>

                {/* Terminal Actions */}
                <div className="space-y-2 pt-4 border-t">
                    <p className="text-sm text-muted-foreground">Terminal Actions</p>
                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 text-red-600"
                            onClick={() => onStageChange(item.id, 'lost')}
                        >
                            Mark Lost
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 text-gray-600"
                            onClick={() => onStageChange(item.id, 'declined')}
                        >
                            Declined
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Pipeline Cell
function PipelineCell({
    stageData,
    pathColor,
    onLeadClick,
}: {
    stageData: StageData;
    pathColor: string;
    onLeadClick: (item: PipelineItem) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const MAX_VISIBLE = 3;

    const visibleItems = expanded ? stageData.items : stageData.items.slice(0, MAX_VISIBLE);
    const hiddenCount = stageData.items.length - MAX_VISIBLE;

    if (stageData.count === 0) {
        return (
            <div className="h-full flex items-center justify-center text-muted-foreground/30 text-xs">
                —
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col p-1.5 gap-1">
            {/* Count badge */}
            <div className="flex items-center justify-center mb-1">
                <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full text-white", pathColor)}>
                    {stageData.count}
                </span>
            </div>

            {/* Lead chips */}
            <div className="flex-1 flex flex-col gap-1 overflow-hidden">
                {visibleItems.map(item => (
                    <LeadChip key={item.id} item={item} onClick={() => onLeadClick(item)} />
                ))}

                {/* Expand/Collapse */}
                {hiddenCount > 0 && !expanded && (
                    <button
                        onClick={() => setExpanded(true)}
                        className="text-xs text-muted-foreground hover:text-primary flex items-center justify-center gap-1"
                    >
                        <ChevronDown className="h-3 w-3" />
                        +{hiddenCount} more
                    </button>
                )}
                {expanded && stageData.items.length > MAX_VISIBLE && (
                    <button
                        onClick={() => setExpanded(false)}
                        className="text-xs text-muted-foreground hover:text-primary flex items-center justify-center gap-1"
                    >
                        <ChevronUp className="h-3 w-3" />
                        Show less
                    </button>
                )}
            </div>
        </div>
    );
}

// Main Pipeline Page
export default function LeadPipelinePage() {
    const [selectedLead, setSelectedLead] = useState<PipelineItem | null>(null);
    const queryClient = useQueryClient();
    const { toast } = useToast();

    // Fetch pipeline data
    const { data: pipelineData, isLoading, refetch } = useQuery<PipelineData>({
        queryKey: ["lead-pipeline"],
        queryFn: async () => {
            const res = await fetch("/api/admin/lead-pipeline");
            if (!res.ok) throw new Error("Failed to fetch pipeline data");
            return res.json();
        },
        refetchInterval: 30000,
    });

    // Mutation to update stage
    const updateStageMutation = useMutation({
        mutationFn: async ({ leadId, newStage }: { leadId: string; newStage: LeadStage }) => {
            const res = await fetch(`/api/admin/leads/${leadId}/stage`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stage: newStage, force: true }),
            });
            if (!res.ok) throw new Error('Failed to update stage');
            return res.json();
        },
        onSuccess: (data) => {
            toast({
                title: "Stage Updated",
                description: `Lead moved to ${data.newStage.replace(/_/g, ' ')}`,
            });
            queryClient.invalidateQueries({ queryKey: ["lead-pipeline"] });
            setSelectedLead(null);
        },
        onError: (error: Error) => {
            toast({
                title: "Update Failed",
                description: error.message,
                variant: "destructive",
            });
        },
    });

    // Build stage lookup for grid
    const stageMap = useMemo(() => {
        if (!pipelineData) return new Map<string, StageData>();

        const map = new Map<string, StageData>();
        for (const lane of pipelineData.swimlanes) {
            for (const stage of lane.stages) {
                map.set(`${lane.path}-${stage.stage}`, stage);
            }
        }
        return map;
    }, [pipelineData]);

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!pipelineData) {
        return (
            <div className="flex h-full items-center justify-center text-muted-foreground">
                Failed to load pipeline data
            </div>
        );
    }

    // Filter out empty lanes for cleaner view
    const activeLanes = pipelineData.swimlanes.filter(lane => lane.stats.total > 0 || lane.path !== 'no_quote');

    // Handle activity click - navigate to lead
    const handleActivityClick = (activity: ActivityItem) => {
        if (activity.leadId) {
            // Could open lead detail panel or navigate
            console.log('Activity clicked:', activity);
        }
    };

    return (
        <div className="h-[calc(100vh-64px)] flex flex-col overflow-hidden">
            {/* Live Activity Stream */}
            <div className="flex-shrink-0 border-b bg-muted/20 px-2 py-1">
                <LiveActivityStream
                    onActivityClick={handleActivityClick}
                    className="max-w-full"
                />
            </div>

            {/* Header */}
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b bg-background">
                <div>
                    <h1 className="text-xl font-bold tracking-tight">Lead Pipeline</h1>
                    <p className="text-xs text-muted-foreground">
                        {pipelineData.totals.total} leads · {pipelineData.totals.active} active
                    </p>
                </div>

                <div className="flex items-center gap-4">
                    {/* Path Stats */}
                    {activeLanes.slice(0, 3).map(lane => (
                        <div key={lane.path} className="flex items-center gap-2 text-xs">
                            <div className={cn("w-2 h-2 rounded-full", PATH_COLORS[lane.path])} />
                            <span className="text-muted-foreground hidden sm:inline">{lane.title}:</span>
                            <span className="font-semibold">{lane.stats.total}</span>
                            <span className="text-green-600 hidden md:inline">({lane.stats.conversionRate}%)</span>
                        </div>
                    ))}

                    <Button variant="outline" size="sm" onClick={() => refetch()}>
                        <RefreshCw className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {/* Pipeline Grid - Fixed viewport */}
            <div className="flex-1 overflow-hidden p-2">
                <div className="h-full grid" style={{
                    gridTemplateColumns: `80px repeat(${activeLanes.length}, 1fr)`,
                    gridTemplateRows: `48px repeat(${pipelineData.stageOrder.length}, 1fr)`,
                    gap: '2px',
                }}>
                    {/* Empty corner cell */}
                    <div className="bg-muted/30 rounded flex items-center justify-center">
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </div>

                    {/* Path headers (columns) */}
                    {activeLanes.map(lane => (
                        <div
                            key={lane.path}
                            className={cn(
                                "rounded flex items-center justify-center gap-2 text-white font-semibold text-sm",
                                PATH_COLORS[lane.path]
                            )}
                        >
                            {PATH_ICONS[lane.path]}
                            <span className="hidden sm:inline">{lane.title}</span>
                            <Badge variant="secondary" className="bg-white/20 text-white text-xs">
                                {lane.stats.total}
                            </Badge>
                        </div>
                    ))}

                    {/* Stage rows */}
                    {pipelineData.stageOrder.map((stage) => (
                        <>
                            {/* Stage label (row header) */}
                            <div
                                key={`label-${stage}`}
                                className="bg-muted/30 rounded flex items-center justify-center"
                            >
                                <span className={cn("text-xs font-medium text-center leading-tight", STAGE_COLORS[stage])}>
                                    {stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                </span>
                            </div>

                            {/* Cells for each path */}
                            {activeLanes.map(lane => {
                                const cellKey = `${lane.path}-${stage}`;
                                const stageData = stageMap.get(cellKey) || { stage, title: '', count: 0, items: [] };

                                return (
                                    <div
                                        key={cellKey}
                                        className={cn(
                                            "bg-muted/20 rounded border border-transparent hover:border-border/50 transition-colors",
                                            stageData.count > 0 && "bg-muted/40"
                                        )}
                                    >
                                        <PipelineCell
                                            stageData={stageData}
                                            pathColor={PATH_COLORS[lane.path]}
                                            onLeadClick={setSelectedLead}
                                        />
                                    </div>
                                );
                            })}
                        </>
                    ))}
                </div>
            </div>

            {/* Conversion Stats Footer */}
            <div className="flex-shrink-0 border-t bg-muted/30 px-4 py-2 flex items-center justify-between text-xs">
                <div className="flex items-center gap-6">
                    {activeLanes.map(lane => (
                        <div key={lane.path} className="flex items-center gap-2">
                            <div className={cn("w-2 h-2 rounded-full", PATH_COLORS[lane.path])} />
                            <span className="text-muted-foreground">{lane.title}:</span>
                            <span className="font-medium">{lane.stats.completed} completed</span>
                            <span className="text-green-600">({lane.stats.conversionRate}% conversion)</span>
                        </div>
                    ))}
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                        <span>Completed: {pipelineData.totals.completed}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 text-red-500" />
                        <span>Lost: {pipelineData.totals.lost}</span>
                    </div>
                </div>
            </div>

            {/* Lead Detail Panel */}
            <LeadDetailPanel
                item={selectedLead}
                onClose={() => setSelectedLead(null)}
                onStageChange={(leadId, newStage) => updateStageMutation.mutate({ leadId, newStage })}
            />

            {/* Overlay when panel is open */}
            {selectedLead && (
                <div
                    className="fixed inset-0 bg-black/20 z-40"
                    onClick={() => setSelectedLead(null)}
                />
            )}
        </div>
    );
}
