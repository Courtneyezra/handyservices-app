/**
 * Lead Pipeline Home - Unified View
 *
 * London Underground-style visualization of the lead pipeline with:
 * - Tube map SVG at top (compact view)
 * - Lead cards grid below the map (filtered by selected station)
 * - Slide-out detail panel for lead interactions and timeline
 * - Video player modal for media attachments
 *
 * Real-time updates via WebSocket.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
    Phone,
    MessageSquare,
    FileText,
    Clock,
    AlertTriangle,
    CheckCircle2,
    Loader2,
    RefreshCw,
    X,
    ChevronDown,
    Video,
    Play,
    Pause,
    Volume2,
    VolumeX,
    ArrowRight,
    Eye,
    ExternalLink,
    Send,
    Calendar,
    User,
    MapPin,
    Maximize2,
    Image as ImageIcon,
    History,
    Quote,
    Activity,
    TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";

// ==========================================
// TYPES
// ==========================================

type LeadStage =
    | 'new_lead'
    | 'contacted'
    | 'awaiting_video'
    | 'video_received'
    | 'quote_sent'
    | 'quote_viewed'
    | 'awaiting_payment'
    | 'booked'
    | 'in_progress'
    | 'completed'
    | 'lost'
    | 'expired'
    | 'declined';

type RouteType = 'video' | 'instant' | 'site_visit';

type SegmentType = 'EMERGENCY' | 'BUSY_PRO' | 'PROP_MGR' | 'LANDLORD' | 'SMALL_BIZ' | 'TRUST_SEEKER' | 'RENTER' | 'DIY_DEFERRER';

interface TubeMapLead {
    id: string;
    customerName: string;
    phone: string;
    jobDescription: string | null;
    source: string | null;
    segment: SegmentType | null;
    stage: LeadStage;
    route: RouteType;
    stageUpdatedAt: string | null;
    timeInStage: string;
    slaStatus: 'ok' | 'warning' | 'overdue';
    nextAction: string;
    hasWhatsAppWindow: boolean;
    quoteId?: string;
    quoteSlug?: string;
    createdAt: string | null;
    qualificationScore: number | null;
    qualificationGrade: 'HOT' | 'WARM' | 'COLD' | null;
}

interface StationData {
    id: string;
    stage: LeadStage;
    name: string;
    count: number;
    leads: TubeMapLead[];
    segmentBreakdown: Record<SegmentType, number>;
    hasBottleneck: boolean;
}

interface RouteData {
    route: RouteType;
    name: string;
    color: string;
    stations: StationData[];
    conversionRate: number;
    totalLeads: number;
}

interface TubeMapData {
    routes: RouteData[];
    entryPoints: {
        calls: { today: number; live: boolean };
        whatsapp: { today: number; unread: number };
        webforms: { today: number; needsChase: number };
    };
    totals: {
        active: number;
        completed: number;
        lost: number;
    };
}

// Timeline event types (matches backend response from /api/admin/leads/:id/timeline)
interface TimelineEvent {
    id: string;
    type: 'call' | 'whatsapp_sent' | 'whatsapp_received' | 'video_received' | 'stage_change' | 'quote_sent' | 'quote_viewed' | 'payment' | 'note';
    timestamp: string;
    summary: string;
    details?: {
        recordingUrl?: string;
        mediaUrl?: string;
        thumbnailUrl?: string;
        duration?: number;
        from?: string | null;
        to?: string;
        slug?: string;
        quoteId?: string;
        amount?: number;
        transcript?: string;
        outcome?: string;
        message?: string;
        direction?: string;
        viewCount?: number;
        reason?: string;
        caption?: string;
    };
}

// ==========================================
// CONSTANTS
// ==========================================

const ROUTE_COLORS: Record<RouteType, { bg: string; line: string; text: string; fill: string }> = {
    video: { bg: 'bg-purple-500', line: '#8B5CF6', text: 'text-purple-500', fill: '#A78BFA' },
    instant: { bg: 'bg-emerald-500', line: '#10B981', text: 'text-emerald-500', fill: '#34D399' },
    site_visit: { bg: 'bg-orange-500', line: '#F97316', text: 'text-orange-500', fill: '#FB923C' },
};

const ROUTE_NAMES: Record<RouteType, string> = {
    video: 'Video Quote',
    instant: 'Instant Quote',
    site_visit: 'Site Visit',
};

const SEGMENT_COLORS: Record<SegmentType, string> = {
    BUSY_PRO: '#EF4444',
    PROP_MGR: '#3B82F6',
    LANDLORD: '#22C55E',
    SMALL_BIZ: '#F59E0B',
    DIY_DEFERRER: '#8B5CF6',
    EMERGENCY: '#EF4444',
    TRUST_SEEKER: '#EC4899',
    RENTER: '#6B7280',
};

const STAGE_DISPLAY_NAMES: Record<LeadStage, string> = {
    new_lead: 'New Lead',
    contacted: 'Contacted',
    awaiting_video: 'Awaiting Video',
    video_received: 'Video Received',
    quote_sent: 'Quote Sent',
    quote_viewed: 'Quote Viewed',
    awaiting_payment: 'Awaiting Payment',
    booked: 'Booked',
    in_progress: 'In Progress',
    completed: 'Completed',
    lost: 'Lost',
    expired: 'Expired',
    declined: 'Declined',
};

const ROUTE_STATIONS: Record<RouteType, LeadStage[]> = {
    video: ['contacted', 'awaiting_video', 'video_received', 'quote_sent', 'quote_viewed', 'booked'],
    instant: ['contacted', 'quote_sent', 'quote_viewed', 'booked'],
    site_visit: ['contacted', 'quote_sent', 'quote_viewed', 'booked'],
};

// ==========================================
// MOCK DATA GENERATOR
// ==========================================

function generateMockTubeMapData(): TubeMapData {
    const segments: SegmentType[] = ['EMERGENCY', 'BUSY_PRO', 'PROP_MGR', 'LANDLORD', 'SMALL_BIZ', 'TRUST_SEEKER', 'RENTER', 'DIY_DEFERRER'];

    const generateLeads = (route: RouteType, stage: LeadStage, count: number): TubeMapLead[] => {
        const leads: TubeMapLead[] = [];
        const grades: ('HOT' | 'WARM' | 'COLD')[] = ['HOT', 'WARM', 'WARM', 'COLD', 'COLD'];
        for (let i = 0; i < count; i++) {
            const segment = segments[Math.floor(Math.random() * segments.length)];
            const slaStatuses: ('ok' | 'warning' | 'overdue')[] = ['ok', 'ok', 'ok', 'warning', 'overdue'];
            const grade = grades[Math.floor(Math.random() * grades.length)];
            const score = grade === 'HOT' ? 80 + Math.floor(Math.random() * 20) :
                          grade === 'WARM' ? 50 + Math.floor(Math.random() * 30) :
                          20 + Math.floor(Math.random() * 30);
            leads.push({
                id: `lead_${route}_${stage}_${i}`,
                customerName: ['John Smith', 'Sarah Jones', 'Mike Brown', 'Emma Wilson', 'David Lee'][Math.floor(Math.random() * 5)],
                phone: '+447' + Math.floor(Math.random() * 1000000000).toString().padStart(9, '0'),
                jobDescription: ['TV mounting', 'Leaking tap', 'Door repair', 'Painting', 'Shelf installation'][Math.floor(Math.random() * 5)],
                source: ['call', 'whatsapp', 'web'][Math.floor(Math.random() * 3)],
                segment,
                stage,
                route,
                stageUpdatedAt: new Date(Date.now() - Math.random() * 86400000).toISOString(),
                timeInStage: ['2h', '4h', '1d', '2d', '30m'][Math.floor(Math.random() * 5)],
                slaStatus: slaStatuses[Math.floor(Math.random() * slaStatuses.length)],
                nextAction: 'Follow up required',
                hasWhatsAppWindow: Math.random() > 0.5,
                quoteSlug: stage !== 'new_lead' && stage !== 'contacted' ? 'abc123' : undefined,
                createdAt: new Date().toISOString(),
                qualificationScore: score,
                qualificationGrade: grade,
            });
        }
        return leads;
    };

    const buildRoute = (route: RouteType): RouteData => {
        const stationStages = ROUTE_STATIONS[route];
        const stations: StationData[] = stationStages.map(stage => {
            const leadCount = Math.floor(Math.random() * 8) + 1;
            const leads = generateLeads(route, stage, leadCount);

            const segmentBreakdown: Record<SegmentType, number> = {
                EMERGENCY: 0, BUSY_PRO: 0, PROP_MGR: 0, LANDLORD: 0, SMALL_BIZ: 0, TRUST_SEEKER: 0, RENTER: 0, DIY_DEFERRER: 0,
            };
            leads.forEach(l => { if (l.segment) segmentBreakdown[l.segment]++; });

            return {
                id: `${route}_${stage}`,
                stage,
                name: STAGE_DISPLAY_NAMES[stage],
                count: leads.length,
                leads,
                segmentBreakdown,
                hasBottleneck: leads.length > 10,
            };
        });

        const totalLeads = stations.reduce((sum, s) => sum + s.count, 0);
        const bookedCount = stations.find(s => s.stage === 'booked')?.count || 0;

        return {
            route,
            name: ROUTE_NAMES[route],
            color: ROUTE_COLORS[route].line,
            stations,
            conversionRate: totalLeads > 0 ? Math.round((bookedCount / totalLeads) * 100) : 0,
            totalLeads,
        };
    };

    return {
        routes: [buildRoute('video'), buildRoute('instant'), buildRoute('site_visit')],
        entryPoints: {
            calls: { today: 12, live: true },
            whatsapp: { today: 8, unread: 3 },
            webforms: { today: 5, needsChase: 2 },
        },
        totals: { active: 45, completed: 23, lost: 7 },
    };
}

// Mock timeline data generator (matches backend response format)
function generateMockTimeline(lead: TubeMapLead): TimelineEvent[] {
    const events: TimelineEvent[] = [];
    const baseTime = new Date(lead.createdAt || Date.now());

    events.push({
        id: '1',
        type: 'call',
        timestamp: baseTime.toISOString(),
        summary: `Incoming call - ${lead.jobDescription || 'General inquiry'}`,
        details: { recordingUrl: '/api/calls/test/recording', duration: 245, outcome: 'VIDEO_QUOTE' },
    });

    if (lead.stage !== 'new_lead' && lead.stage !== 'contacted') {
        events.push({
            id: '2',
            type: 'whatsapp_sent',
            timestamp: new Date(baseTime.getTime() + 300000).toISOString(),
            summary: 'Video request sent via WhatsApp',
            details: { message: 'Hi! Could you send a quick video of the job so we can give you an accurate quote?' },
        });
    }

    if (['video_received', 'quote_sent', 'quote_viewed', 'booked'].includes(lead.stage)) {
        events.push({
            id: '3',
            type: 'video_received',
            timestamp: new Date(baseTime.getTime() + 3600000).toISOString(),
            summary: 'Customer sent video/image',
            details: { mediaUrl: 'https://placehold.co/400x300/333/fff?text=Video', thumbnailUrl: 'https://placehold.co/200x150/333/fff?text=Video' },
        });
    }

    if (['quote_sent', 'quote_viewed', 'booked'].includes(lead.stage)) {
        events.push({
            id: '4',
            type: 'quote_sent',
            timestamp: new Date(baseTime.getTime() + 7200000).toISOString(),
            summary: 'Quote sent - HHH package',
            details: { slug: lead.quoteSlug, quoteId: 'q_123', amount: 15000 },
        });
    }

    if (['quote_viewed', 'booked'].includes(lead.stage)) {
        events.push({
            id: '5',
            type: 'quote_viewed',
            timestamp: new Date(baseTime.getTime() + 10800000).toISOString(),
            summary: 'Quote viewed',
            details: { viewCount: 2, slug: lead.quoteSlug },
        });
    }

    if (lead.stage === 'booked') {
        events.push({
            id: '6',
            type: 'payment',
            timestamp: new Date(baseTime.getTime() + 14400000).toISOString(),
            summary: 'Payment received - Booking confirmed',
            details: { amount: 15000 },
        });
    }

    // Add lead creation event
    events.push({
        id: '0',
        type: 'stage_change',
        timestamp: new Date(baseTime.getTime() - 60000).toISOString(),
        summary: `Lead created from ${lead.source || 'unknown source'}`,
        details: { from: null, to: 'new_lead', reason: `Lead captured via ${lead.source}` },
    });

    return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

// ==========================================
// TUBE MAP SVG COMPONENT
// ==========================================

interface TubeMapSVGProps {
    data: TubeMapData;
    selectedStage: LeadStage | null;
    onStationClick: (stage: LeadStage) => void;
}

function TubeMapSVG({ data, selectedStage, onStationClick }: TubeMapSVGProps) {
    const [hoveredStation, setHoveredStation] = useState<LeadStage | null>(null);
    const STATION_RADIUS = 20;
    const STATION_SPACING_X = 140;
    const ROUTE_SPACING_Y = 80;
    const START_X = 100;
    const START_Y = 70;
    const LINE_THICKNESS = 8;

    const stationPositions = useMemo(() => {
        const positions: Record<string, { x: number; y: number; route: RouteType }> = {};
        positions['contacted'] = { x: START_X, y: START_Y + ROUTE_SPACING_Y, route: 'instant' };
        positions['video_awaiting_video'] = { x: START_X + STATION_SPACING_X, y: START_Y, route: 'video' };
        positions['video_video_received'] = { x: START_X + STATION_SPACING_X * 2, y: START_Y, route: 'video' };
        positions['quote_sent'] = { x: START_X + STATION_SPACING_X * 3, y: START_Y + ROUTE_SPACING_Y, route: 'instant' };
        positions['quote_viewed'] = { x: START_X + STATION_SPACING_X * 4, y: START_Y + ROUTE_SPACING_Y, route: 'instant' };
        positions['booked'] = { x: START_X + STATION_SPACING_X * 5, y: START_Y + ROUTE_SPACING_Y, route: 'instant' };
        positions['site_visit_booked'] = { x: START_X + STATION_SPACING_X, y: START_Y + ROUTE_SPACING_Y * 2, route: 'site_visit' };
        positions['site_visit_done'] = { x: START_X + STATION_SPACING_X * 2, y: START_Y + ROUTE_SPACING_Y * 2, route: 'site_visit' };
        return positions;
    }, []);

    const getLeadsForStation = (stage: LeadStage): number => {
        return data.routes.reduce((sum, r) => sum + (r.stations.find(s => s.stage === stage)?.count || 0), 0);
    };

    const Station = ({ stage, posKey, label, route }: { stage: LeadStage; posKey: string; label: string; route: RouteType }) => {
        const pos = stationPositions[posKey];
        if (!pos) return null;
        const count = getLeadsForStation(stage);
        const isSelected = selectedStage === stage;
        const isHovered = hoveredStation === stage;

        return (
            <g
                className="cursor-pointer"
                onClick={() => onStationClick(stage)}
                onMouseEnter={() => setHoveredStation(stage)}
                onMouseLeave={() => setHoveredStation(null)}
            >
                {/* Selection ring */}
                {isSelected && (
                    <circle cx={pos.x} cy={pos.y} r={STATION_RADIUS + 8} fill="none" stroke={ROUTE_COLORS[route].line} strokeWidth={2} className="animate-pulse" />
                )}
                {/* Hover glow effect */}
                {isHovered && !isSelected && (
                    <circle cx={pos.x} cy={pos.y} r={STATION_RADIUS + 4} fill={ROUTE_COLORS[route].line} opacity={0.2} />
                )}
                {/* Click pulse animation */}
                {isSelected && (
                    <circle cx={pos.x} cy={pos.y} r={STATION_RADIUS + 12} fill="none" stroke={ROUTE_COLORS[route].line} strokeWidth={1} opacity={0.5}>
                        <animate attributeName="r" from={String(STATION_RADIUS + 8)} to={String(STATION_RADIUS + 20)} dur="1s" repeatCount="indefinite" />
                        <animate attributeName="opacity" from="0.5" to="0" dur="1s" repeatCount="indefinite" />
                    </circle>
                )}
                {/* Station circle */}
                <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={isHovered ? STATION_RADIUS + 2 : STATION_RADIUS}
                    fill="white"
                    stroke={ROUTE_COLORS[route].line}
                    strokeWidth={isSelected ? 5 : isHovered ? 4 : 3}
                    className="transition-all duration-150"
                />
                {/* Count text */}
                <text x={pos.x} y={pos.y} textAnchor="middle" dominantBaseline="central" fill="#1f2937" className="font-bold text-sm pointer-events-none">
                    {count}
                </text>
                {/* Station label */}
                <text x={pos.x} y={pos.y + STATION_RADIUS + 16} textAnchor="middle" fill="#64748b" className="text-xs font-medium pointer-events-none">
                    {label}
                </text>
                {/* Tooltip on hover */}
                {isHovered && (
                    <g>
                        <rect
                            x={pos.x - 50}
                            y={pos.y - STATION_RADIUS - 35}
                            width={100}
                            height={24}
                            rx={4}
                            fill="#1e293b"
                            opacity={0.9}
                        />
                        <text
                            x={pos.x}
                            y={pos.y - STATION_RADIUS - 19}
                            textAnchor="middle"
                            fill="white"
                            className="text-xs font-medium"
                        >
                            {label}: {count} leads
                        </text>
                    </g>
                )}
            </g>
        );
    };

    return (
        <svg viewBox="0 0 900 300" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
            <rect width="100%" height="100%" className="fill-background" />

            {/* Video route path */}
            <path
                d={`M ${stationPositions['contacted'].x} ${stationPositions['contacted'].y}
                    Q ${stationPositions['contacted'].x + 40} ${stationPositions['contacted'].y} ${stationPositions['contacted'].x + 40} ${stationPositions['video_awaiting_video'].y + 20}
                    L ${stationPositions['video_awaiting_video'].x - 20} ${stationPositions['video_awaiting_video'].y}
                    L ${stationPositions['video_video_received'].x} ${stationPositions['video_video_received'].y}
                    Q ${stationPositions['video_video_received'].x + 40} ${stationPositions['video_video_received'].y} ${stationPositions['video_video_received'].x + 40} ${stationPositions['quote_sent'].y - 20}
                    L ${stationPositions['quote_sent'].x - 20} ${stationPositions['quote_sent'].y}`}
                fill="none" stroke={ROUTE_COLORS.video.line} strokeWidth={LINE_THICKNESS} strokeLinecap="round" strokeLinejoin="round" opacity={0.85}
            />

            {/* Site visit route path */}
            <path
                d={`M ${stationPositions['contacted'].x} ${stationPositions['contacted'].y}
                    Q ${stationPositions['contacted'].x + 40} ${stationPositions['contacted'].y} ${stationPositions['contacted'].x + 40} ${stationPositions['site_visit_booked'].y - 20}
                    L ${stationPositions['site_visit_booked'].x - 20} ${stationPositions['site_visit_booked'].y}
                    L ${stationPositions['site_visit_done'].x} ${stationPositions['site_visit_done'].y}
                    Q ${stationPositions['site_visit_done'].x + 40} ${stationPositions['site_visit_done'].y} ${stationPositions['site_visit_done'].x + 40} ${stationPositions['quote_sent'].y + 20}
                    L ${stationPositions['quote_sent'].x - 20} ${stationPositions['quote_sent'].y}`}
                fill="none" stroke={ROUTE_COLORS.site_visit.line} strokeWidth={LINE_THICKNESS} strokeLinecap="round" strokeLinejoin="round" opacity={0.85}
            />

            {/* Golden path (instant) - glow + main line */}
            <line x1={stationPositions['contacted'].x} y1={stationPositions['contacted'].y} x2={stationPositions['booked'].x} y2={stationPositions['booked'].y} stroke="#10B981" strokeWidth={18} strokeLinecap="round" opacity={0.2} />
            <line x1={stationPositions['contacted'].x} y1={stationPositions['contacted'].y} x2={stationPositions['booked'].x} y2={stationPositions['booked'].y} stroke="#10B981" strokeWidth={8} strokeLinecap="round" />

            {/* Stations */}
            <Station stage="contacted" posKey="contacted" label="Contacted" route="instant" />
            <Station stage="awaiting_video" posKey="video_awaiting_video" label="Awaiting Video" route="video" />
            <Station stage="video_received" posKey="video_video_received" label="Video Received" route="video" />
            <Station stage="quote_sent" posKey="quote_sent" label="Quote Sent" route="instant" />
            <Station stage="quote_viewed" posKey="quote_viewed" label="Quote Viewed" route="instant" />
            <Station stage="booked" posKey="booked" label="Booked" route="instant" />

            {/* Route legend */}
            <g transform="translate(30, 20)">
                {data.routes.map((route, i) => (
                    <g key={route.route} transform={`translate(${i * 130}, 0)`}>
                        <line x1={0} y1={8} x2={30} y2={8} stroke={ROUTE_COLORS[route.route].line} strokeWidth={4} strokeLinecap="round" />
                        <text x={38} y={12} fill="#94a3b8" className="text-xs font-medium">{route.name}</text>
                    </g>
                ))}
            </g>
        </svg>
    );
}

// ==========================================
// LEAD CARD COMPONENT
// ==========================================

interface LeadCardProps {
    lead: TubeMapLead;
    onClick: () => void;
}

function LeadCard({ lead, onClick }: LeadCardProps) {
    const slaColors = {
        ok: 'border-l-emerald-500',
        warning: 'border-l-amber-500',
        overdue: 'border-l-red-500',
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            whileHover={{ scale: 1.02 }}
            transition={{ duration: 0.15 }}
        >
            <Card
                className={cn(
                    "cursor-pointer border-l-4 transition-all hover:shadow-lg hover:bg-muted/50",
                    "bg-card dark:bg-zinc-900/50",
                    slaColors[lead.slaStatus]
                )}
                onClick={onClick}
            >
                <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                                <div
                                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: lead.segment ? SEGMENT_COLORS[lead.segment] : '#6B7280' }}
                                />
                                <h4 className="font-semibold text-sm truncate">{lead.customerName}</h4>
                            </div>
                            <p className="text-xs text-muted-foreground truncate mb-2">
                                {lead.jobDescription || 'No description'}
                            </p>
                            <div className="flex items-center gap-2 flex-wrap">
                                {lead.qualificationGrade && (
                                    <Badge
                                        className={cn(
                                            "text-[10px] h-5 text-white",
                                            lead.qualificationGrade === 'HOT' && "bg-rose-500",
                                            lead.qualificationGrade === 'WARM' && "bg-amber-500",
                                            lead.qualificationGrade === 'COLD' && "bg-slate-500"
                                        )}
                                    >
                                        {lead.qualificationGrade} ({lead.qualificationScore})
                                    </Badge>
                                )}
                                <Badge variant="outline" className="text-[10px] h-5">
                                    <Clock className="h-2.5 w-2.5 mr-1" />
                                    {lead.timeInStage}
                                </Badge>
                                {lead.hasWhatsAppWindow && (
                                    <Badge variant="outline" className="text-[10px] h-5 text-green-600 border-green-300">
                                        <MessageSquare className="h-2.5 w-2.5 mr-1" />
                                        24h
                                    </Badge>
                                )}
                                {lead.quoteSlug && (
                                    <Badge variant="outline" className="text-[10px] h-5 text-purple-600 border-purple-300">
                                        <Quote className="h-2.5 w-2.5 mr-1" />
                                        Quote
                                    </Badge>
                                )}
                            </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                            <Badge className={cn("text-[10px]", ROUTE_COLORS[lead.route].bg, "text-white")}>
                                {ROUTE_NAMES[lead.route].split(' ')[0]}
                            </Badge>
                            {lead.source && (
                                <span className="text-[10px] text-muted-foreground capitalize">{lead.source}</span>
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>
        </motion.div>
    );
}

// ==========================================
// LEAD CARDS GRID
// ==========================================

interface LeadCardsGridProps {
    leads: TubeMapLead[];
    selectedStage: LeadStage | null;
    onLeadClick: (lead: TubeMapLead) => void;
    onClearFilter: () => void;
}

function LeadCardsGrid({ leads, selectedStage, onLeadClick, onClearFilter }: LeadCardsGridProps) {
    const filteredLeads = useMemo(() => {
        if (!selectedStage) return leads;
        return leads.filter(l => l.stage === selectedStage);
    }, [leads, selectedStage]);

    return (
        <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                <div className="flex items-center gap-2">
                    <h2 className="text-sm font-medium">
                        {selectedStage ? STAGE_DISPLAY_NAMES[selectedStage] : 'All Leads'}
                    </h2>
                    <Badge variant="secondary" className="text-xs">{filteredLeads.length}</Badge>
                </div>
                {selectedStage && (
                    <Button variant="ghost" size="sm" className="text-xs h-7" onClick={onClearFilter}>
                        Clear filter
                    </Button>
                )}
            </div>
            <ScrollArea className="flex-1 p-4">
                {filteredLeads.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                        <User className="h-8 w-8 mb-2 opacity-50" />
                        <p className="text-sm">No leads in this stage</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        <AnimatePresence mode="popLayout">
                            {filteredLeads.map(lead => (
                                <LeadCard key={lead.id} lead={lead} onClick={() => onLeadClick(lead)} />
                            ))}
                        </AnimatePresence>
                    </div>
                )}
            </ScrollArea>
        </div>
    );
}

// ==========================================
// TIMELINE EVENT COMPONENT
// ==========================================

interface TimelineEventItemProps {
    event: TimelineEvent;
    onPlayVideo?: (url: string) => void;
    onPlayAudio?: (url: string) => void;
}

function TimelineEventItem({ event, onPlayVideo, onPlayAudio }: TimelineEventItemProps) {
    const iconMap: Record<string, { icon: React.ReactNode; color: string }> = {
        call: { icon: <Phone className="h-3.5 w-3.5" />, color: 'bg-blue-500' },
        whatsapp_sent: { icon: <Send className="h-3.5 w-3.5" />, color: 'bg-green-500' },
        whatsapp_received: { icon: <MessageSquare className="h-3.5 w-3.5" />, color: 'bg-green-600' },
        video_received: { icon: <Video className="h-3.5 w-3.5" />, color: 'bg-purple-500' },
        stage_change: { icon: <ArrowRight className="h-3.5 w-3.5" />, color: 'bg-amber-500' },
        quote_sent: { icon: <FileText className="h-3.5 w-3.5" />, color: 'bg-indigo-500' },
        quote_viewed: { icon: <Eye className="h-3.5 w-3.5" />, color: 'bg-cyan-500' },
        payment: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: 'bg-emerald-500' },
        note: { icon: <FileText className="h-3.5 w-3.5" />, color: 'bg-slate-500' },
    };

    const { icon, color } = iconMap[event.type] || iconMap.note;

    // Format duration if available
    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="flex gap-3 pb-4 last:pb-0">
            <div className="flex flex-col items-center">
                <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-white", color)}>
                    {icon}
                </div>
                <div className="w-px flex-1 bg-border mt-2" />
            </div>
            <div className="flex-1 min-w-0 pb-2">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{event.summary}</p>
                        {event.details?.reason && (
                            <p className="text-xs text-muted-foreground mt-0.5">{event.details.reason}</p>
                        )}
                        {event.details?.message && event.type !== 'whatsapp_sent' && event.type !== 'whatsapp_received' && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">{event.details.message}</p>
                        )}
                    </div>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">
                        {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                    </span>
                </div>

                {/* Call recording */}
                {event.type === 'call' && event.details?.recordingUrl && (
                    <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 h-7 text-xs"
                        onClick={() => onPlayAudio?.(event.details!.recordingUrl!)}
                    >
                        <Play className="h-3 w-3 mr-1" />
                        Play Recording
                        {event.details?.duration && (
                            <span className="ml-1 text-muted-foreground">
                                ({formatDuration(event.details.duration)})
                            </span>
                        )}
                    </Button>
                )}

                {/* Video/image received */}
                {event.type === 'video_received' && event.details?.mediaUrl && (
                    <div className="mt-2">
                        <button
                            onClick={() => onPlayVideo?.(event.details!.mediaUrl!)}
                            className="relative group rounded-lg overflow-hidden"
                        >
                            <img
                                src={event.details?.thumbnailUrl || event.details?.mediaUrl || 'https://placehold.co/200x150/333/fff?text=Video'}
                                alt="Video thumbnail"
                                className="w-32 h-24 object-cover rounded-lg bg-muted"
                            />
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center group-hover:bg-black/50 transition-colors">
                                <Play className="h-8 w-8 text-white" />
                            </div>
                        </button>
                        {event.details?.caption && (
                            <p className="text-xs text-muted-foreground mt-1">{event.details.caption}</p>
                        )}
                    </div>
                )}

                {/* Quote link */}
                {event.type === 'quote_sent' && event.details?.slug && (
                    <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 h-7 text-xs"
                        onClick={() => window.open(`/q/${event.details!.slug}`, '_blank')}
                    >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        View Quote
                    </Button>
                )}

                {/* Quote viewed badge */}
                {event.type === 'quote_viewed' && event.details?.viewCount && event.details.viewCount > 1 && (
                    <Badge variant="secondary" className="mt-2 text-xs">
                        Viewed {event.details.viewCount} times
                    </Badge>
                )}

                {/* Payment amount */}
                {event.type === 'payment' && event.details?.amount && (
                    <Badge variant="secondary" className="mt-2">
                        {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(event.details.amount / 100)}
                    </Badge>
                )}

                {/* Stage change details */}
                {event.type === 'stage_change' && event.details?.from && event.details?.to && (
                    <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px] h-5">
                            {STAGE_DISPLAY_NAMES[event.details.from as LeadStage] || event.details.from}
                        </Badge>
                        <ArrowRight className="h-3 w-3" />
                        <Badge variant="outline" className="text-[10px] h-5">
                            {STAGE_DISPLAY_NAMES[event.details.to as LeadStage] || event.details.to}
                        </Badge>
                    </div>
                )}
            </div>
        </div>
    );
}

// ==========================================
// SLIDE-OUT DETAIL PANEL
// ==========================================

interface LeadDetailPanelProps {
    lead: TubeMapLead | null;
    onClose: () => void;
    onStageChange: (leadId: string, newStage: LeadStage) => void;
    onPlayVideo: (url: string) => void;
    onPlayAudio: (url: string) => void;
}

function LeadDetailPanel({ lead, onClose, onStageChange, onPlayVideo, onPlayAudio }: LeadDetailPanelProps) {
    const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
    const [isLoadingTimeline, setIsLoadingTimeline] = useState(false);

    // Fetch timeline when lead changes
    useEffect(() => {
        if (!lead) return;

        setIsLoadingTimeline(true);

        // Fetch timeline data from backend
        fetch(`/api/admin/leads/${lead.id}/timeline`)
            .then(res => {
                if (!res.ok) throw new Error('Not found');
                return res.json();
            })
            .then(data => {
                // Backend returns { lead, timeline } - use timeline array
                setTimeline(data.timeline || []);
            })
            .catch(() => {
                // Use mock data if API doesn't exist or fails
                setTimeline(generateMockTimeline(lead));
            })
            .finally(() => setIsLoadingTimeline(false));
    }, [lead?.id]);

    const stages: LeadStage[] = [
        'new_lead', 'contacted', 'awaiting_video', 'video_received', 'quote_sent', 'quote_viewed',
        'awaiting_payment', 'booked', 'in_progress', 'completed', 'lost'
    ];

    return (
        <AnimatePresence>
            {lead && (
                <motion.div
                    initial={{ x: '100%' }}
                    animate={{ x: 0 }}
                    exit={{ x: '100%' }}
                    transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                    className="fixed inset-y-0 right-0 w-full sm:w-[420px] bg-background border-l shadow-xl z-50 flex flex-col"
                >
                    {/* Header */}
                    <div className="flex-shrink-0 p-4 border-b bg-muted/30">
                        <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                                <div
                                    className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold"
                                    style={{ backgroundColor: lead.segment ? SEGMENT_COLORS[lead.segment] : '#6B7280' }}
                                >
                                    {lead.customerName.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <h3 className="font-semibold text-lg">{lead.customerName}</h3>
                                    <p className="text-sm text-muted-foreground">{lead.phone}</p>
                                </div>
                            </div>
                            <Button variant="ghost" size="icon" onClick={onClose}>
                                <X className="h-5 w-5" />
                            </Button>
                        </div>

                        {/* Status badges */}
                        <div className="flex flex-wrap gap-2 mt-3">
                            <Badge className={cn(ROUTE_COLORS[lead.route].bg, "text-white")}>
                                {ROUTE_NAMES[lead.route]}
                            </Badge>
                            <Badge variant="outline">
                                {STAGE_DISPLAY_NAMES[lead.stage]}
                            </Badge>
                            <Badge
                                variant={lead.slaStatus === 'ok' ? 'default' : lead.slaStatus === 'warning' ? 'secondary' : 'destructive'}
                            >
                                <Clock className="h-3 w-3 mr-1" />
                                {lead.timeInStage}
                            </Badge>
                        </div>
                    </div>

                    {/* Scrollable content */}
                    <ScrollArea className="flex-1">
                        <div className="p-4 space-y-6">
                            {/* Job description */}
                            <div>
                                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Job Description</h4>
                                <p className="text-sm">{lead.jobDescription || 'No description provided'}</p>
                            </div>

                            {/* Timeline */}
                            <div>
                                <div className="flex items-center gap-2 mb-3">
                                    <History className="h-4 w-4 text-muted-foreground" />
                                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Activity Timeline</h4>
                                </div>
                                {isLoadingTimeline ? (
                                    <div className="flex items-center justify-center py-8">
                                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                                    </div>
                                ) : timeline.length === 0 ? (
                                    <p className="text-sm text-muted-foreground py-4">No activity recorded yet</p>
                                ) : (
                                    <div className="space-y-1">
                                        {timeline.map(event => (
                                            <TimelineEventItem
                                                key={event.id}
                                                event={event}
                                                onPlayVideo={onPlayVideo}
                                                onPlayAudio={onPlayAudio}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Move Stage */}
                            <div>
                                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Move to Stage</h4>
                                <Select
                                    value={lead.stage}
                                    onValueChange={(value) => onStageChange(lead.id, value as LeadStage)}
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {stages.map(stage => (
                                            <SelectItem key={stage} value={stage}>
                                                {STAGE_DISPLAY_NAMES[stage]}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </ScrollArea>

                    {/* Actions footer */}
                    <div className="flex-shrink-0 p-4 border-t bg-muted/30 space-y-3">
                        {/* Quick actions */}
                        <div className="grid grid-cols-3 gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="text-xs"
                                onClick={() => window.open(`tel:${lead.phone}`, '_blank')}
                            >
                                <Phone className="h-3.5 w-3.5 mr-1" />
                                Call
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="text-xs text-green-600 hover:text-green-700"
                                onClick={() => window.open(`https://wa.me/${lead.phone.replace(/[^0-9]/g, '')}`, '_blank')}
                            >
                                <MessageSquare className="h-3.5 w-3.5 mr-1" />
                                WhatsApp
                            </Button>
                            {lead.quoteSlug ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-xs"
                                    onClick={() => window.open(`/q/${lead.quoteSlug}`, '_blank')}
                                >
                                    <ExternalLink className="h-3.5 w-3.5 mr-1" />
                                    View Quote
                                </Button>
                            ) : (
                                <Button variant="default" size="sm" className="text-xs">
                                    <FileText className="h-3.5 w-3.5 mr-1" />
                                    Create Quote
                                </Button>
                            )}
                        </div>

                        {/* Terminal actions */}
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="flex-1 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                                onClick={() => onStageChange(lead.id, 'lost')}
                            >
                                Mark Lost
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="flex-1 text-xs"
                                onClick={() => onStageChange(lead.id, 'declined')}
                            >
                                Declined
                            </Button>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

// ==========================================
// VIDEO PLAYER MODAL
// ==========================================

interface VideoPlayerModalProps {
    videoUrl: string | null;
    onClose: () => void;
}

function VideoPlayerModal({ videoUrl, onClose }: VideoPlayerModalProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);

    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleEsc);
        return () => document.removeEventListener('keydown', handleEsc);
    }, [onClose]);

    const togglePlay = () => {
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.pause();
            } else {
                videoRef.current.play();
            }
        }
    };

    const toggleFullscreen = () => {
        if (videoRef.current) {
            if (!isFullscreen) {
                videoRef.current.requestFullscreen?.();
            } else {
                document.exitFullscreen?.();
            }
            setIsFullscreen(!isFullscreen);
        }
    };

    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <Dialog open={!!videoUrl} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-3xl p-0 bg-black border-none">
                <div className="relative">
                    <video
                        ref={videoRef}
                        src={videoUrl || ''}
                        className="w-full aspect-video"
                        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                        onPlay={() => setIsPlaying(true)}
                        onPause={() => setIsPlaying(false)}
                        onEnded={() => setIsPlaying(false)}
                        onClick={togglePlay}
                    />

                    {/* Video controls overlay */}
                    <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
                        {/* Progress bar */}
                        <input
                            type="range"
                            min={0}
                            max={duration || 100}
                            value={currentTime}
                            onChange={(e) => {
                                const time = parseFloat(e.target.value);
                                setCurrentTime(time);
                                if (videoRef.current) videoRef.current.currentTime = time;
                            }}
                            className="w-full h-1 bg-white/30 rounded-lg appearance-none cursor-pointer accent-white mb-2"
                        />

                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-10 w-10 rounded-full text-white hover:bg-white/20"
                                    onClick={togglePlay}
                                >
                                    {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
                                </Button>
                                <span className="text-white text-sm">
                                    {formatTime(currentTime)} / {formatTime(duration)}
                                </span>
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-white hover:bg-white/20"
                                onClick={toggleFullscreen}
                            >
                                <Maximize2 className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ==========================================
// AUDIO PLAYER MODAL
// ==========================================

interface AudioPlayerModalProps {
    audioUrl: string | null;
    onClose: () => void;
}

function AudioPlayerModal({ audioUrl, onClose }: AudioPlayerModalProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);

    useEffect(() => {
        if (audioUrl && audioRef.current) {
            audioRef.current.play();
        }
    }, [audioUrl]);

    const togglePlay = () => {
        if (audioRef.current) {
            if (isPlaying) {
                audioRef.current.pause();
            } else {
                audioRef.current.play();
            }
        }
    };

    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <Dialog open={!!audioUrl} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-md">
                <div className="p-4">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center">
                            <Phone className="h-6 w-6 text-white" />
                        </div>
                        <div>
                            <h3 className="font-semibold">Call Recording</h3>
                            <p className="text-sm text-muted-foreground">Listen to the conversation</p>
                        </div>
                    </div>

                    <audio
                        ref={audioRef}
                        src={audioUrl || ''}
                        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                        onPlay={() => setIsPlaying(true)}
                        onPause={() => setIsPlaying(false)}
                        onEnded={() => setIsPlaying(false)}
                    />

                    {/* Progress bar */}
                    <div className="mb-4">
                        <input
                            type="range"
                            min={0}
                            max={duration || 100}
                            value={currentTime}
                            onChange={(e) => {
                                const time = parseFloat(e.target.value);
                                setCurrentTime(time);
                                if (audioRef.current) audioRef.current.currentTime = time;
                            }}
                            className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-blue-500"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span>{formatTime(currentTime)}</span>
                            <span>{formatTime(duration)}</span>
                        </div>
                    </div>

                    {/* Controls */}
                    <div className="flex justify-center">
                        <Button
                            size="lg"
                            className="h-14 w-14 rounded-full"
                            onClick={togglePlay}
                        >
                            {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 ml-0.5" />}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function LeadTubeMapPage() {
    const [selectedLead, setSelectedLead] = useState<TubeMapLead | null>(null);
    const [selectedStage, setSelectedStage] = useState<LeadStage | null>(null);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const queryClient = useQueryClient();
    const { toast } = useToast();

    // Fetch tube map data
    const { data: tubeMapData, isLoading, refetch } = useQuery<TubeMapData>({
        queryKey: ["lead-tube-map"],
        queryFn: async () => {
            try {
                const res = await fetch("/api/admin/lead-tube-map");
                if (!res.ok) {
                    console.warn('[TubeMap] API not available, using mock data');
                    return generateMockTubeMapData();
                }
                return res.json();
            } catch (error) {
                console.warn('[TubeMap] API error, using mock data:', error);
                return generateMockTubeMapData();
            }
        },
        refetchInterval: 30000,
    });

    // Flatten all leads from all routes
    const allLeads = useMemo(() => {
        if (!tubeMapData) return [];
        return tubeMapData.routes.flatMap(route =>
            route.stations.flatMap(station => station.leads)
        );
    }, [tubeMapData]);

    // Filter to show only priority leads (max 8)
    const priorityLeads = useMemo(() => {
        if (!tubeMapData?.routes) return [];

        const allLeads: TubeMapLead[] = [];
        tubeMapData.routes.forEach(route => {
            route.stations.forEach(station => {
                station.leads.forEach(lead => allLeads.push(lead));
            });
        });

        // Sort by priority: HOT first, then overdue SLA, then by time in stage
        return allLeads
            .sort((a, b) => {
                // HOT leads first
                if (a.qualificationGrade === 'HOT' && b.qualificationGrade !== 'HOT') return -1;
                if (b.qualificationGrade === 'HOT' && a.qualificationGrade !== 'HOT') return 1;
                // Then overdue SLA
                if (a.slaStatus === 'overdue' && b.slaStatus !== 'overdue') return -1;
                if (b.slaStatus === 'overdue' && a.slaStatus !== 'overdue') return 1;
                // Then warning SLA
                if (a.slaStatus === 'warning' && b.slaStatus === 'ok') return -1;
                if (b.slaStatus === 'warning' && a.slaStatus === 'ok') return 1;
                return 0;
            })
            .slice(0, 8); // Only show top 8 priority leads
    }, [tubeMapData]);

    // Count leads by qualification grade (HOT/WARM/COLD)
    const qualificationCounts = useMemo(() => {
        if (!tubeMapData?.routes) return { hot: 0, warm: 0, cold: 0 };

        let hot = 0, warm = 0, cold = 0;

        tubeMapData.routes.forEach(route => {
            route.stations.forEach(station => {
                station.leads.forEach(lead => {
                    if (lead.qualificationGrade === 'HOT') hot++;
                    else if (lead.qualificationGrade === 'WARM') warm++;
                    else if (lead.qualificationGrade === 'COLD') cold++;
                });
            });
        });

        return { hot, warm, cold };
    }, [tubeMapData]);

    // Calculate conversion rates
    const conversionRates = useMemo(() => {
        if (!tubeMapData) return { leadToQuote: 0, quoteToPaid: 0, overall: 0 };

        const totalLeads = tubeMapData.totals.active + tubeMapData.totals.completed + tubeMapData.totals.lost;

        // Count leads that have reached quote stages
        let quoteSentOrBeyond = 0;
        let bookedOrCompleted = 0;

        tubeMapData.routes.forEach(route => {
            route.stations.forEach(station => {
                const stagesWithQuote: LeadStage[] = ['quote_sent', 'quote_viewed', 'awaiting_payment', 'booked', 'in_progress', 'completed'];
                const stagesBooked: LeadStage[] = ['booked', 'in_progress', 'completed'];

                if (stagesWithQuote.includes(station.stage)) {
                    quoteSentOrBeyond += station.count;
                }
                if (stagesBooked.includes(station.stage)) {
                    bookedOrCompleted += station.count;
                }
            });
        });

        // Add completed from totals
        bookedOrCompleted += tubeMapData.totals.completed;

        const leadToQuote = totalLeads > 0 ? Math.round((quoteSentOrBeyond / totalLeads) * 100) : 0;
        const quoteToPaid = quoteSentOrBeyond > 0 ? Math.round((bookedOrCompleted / quoteSentOrBeyond) * 100) : 0;
        const overall = totalLeads > 0 ? Math.round((bookedOrCompleted / totalLeads) * 100) : 0;

        return { leadToQuote, quoteToPaid, overall };
    }, [tubeMapData]);

    // Count quotes sent today (approximation based on today's activity)
    const quotesToday = useMemo(() => {
        if (!tubeMapData?.routes) return 0;

        // Count leads in quote_sent stage that were updated recently
        let count = 0;
        tubeMapData.routes.forEach(route => {
            const quoteSentStation = route.stations.find(s => s.stage === 'quote_sent');
            if (quoteSentStation) {
                count += quoteSentStation.leads.filter(lead => {
                    if (!lead.stageUpdatedAt) return false;
                    const updatedDate = new Date(lead.stageUpdatedAt);
                    const today = new Date();
                    return updatedDate.toDateString() === today.toDateString();
                }).length;
            }
        });
        return count;
    }, [tubeMapData]);

    // WebSocket connection for real-time updates
    useEffect(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/ws/client`;

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);

                if (msg.type === 'lead:stage_change' || msg.type === 'lead:created') {
                    queryClient.invalidateQueries({ queryKey: ["lead-tube-map"] });
                    toast({
                        title: msg.type === 'lead:created' ? "New Lead" : "Lead Updated",
                        description: msg.data?.customerName || 'Lead data changed',
                    });
                }

                if (msg.type === 'call:incoming' || msg.type === 'voice:call_started' || msg.type === 'whatsapp:incoming') {
                    queryClient.invalidateQueries({ queryKey: ["lead-tube-map"] });
                }
            } catch (e) {
                console.error('[TubeMap] WebSocket parse error:', e);
            }
        };

        return () => ws.close();
    }, [queryClient, toast]);

    // Stage update mutation
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
                description: `Lead moved to ${STAGE_DISPLAY_NAMES[data.newStage as LeadStage]}`,
            });
            queryClient.invalidateQueries({ queryKey: ["lead-tube-map"] });
            setSelectedLead(null);
        },
        onError: (error: Error) => {
            toast({ title: "Update Failed", description: error.message, variant: "destructive" });
        },
    });

    // Handlers
    const handleStationClick = useCallback((stage: LeadStage) => {
        setSelectedStage(prev => prev === stage ? null : stage);
    }, []);

    const handleLeadClick = useCallback((lead: TubeMapLead) => {
        setSelectedLead(lead);
    }, []);

    const handleStageChange = useCallback((leadId: string, newStage: LeadStage) => {
        updateStageMutation.mutate({ leadId, newStage });
    }, [updateStageMutation]);

    const handleClearStageFilter = useCallback(() => {
        setSelectedStage(null);
    }, []);

    if (isLoading) {
        return (
            <div className="flex h-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!tubeMapData) {
        return (
            <div className="flex h-full items-center justify-center text-muted-foreground">
                Failed to load pipeline data
            </div>
        );
    }

    return (
        <div className="h-[calc(100vh-64px)] flex flex-col overflow-hidden">
            {/* Compact Header */}
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b bg-background">
                <div className="flex items-center gap-4">
                    <div>
                        <h1 className="text-lg font-bold tracking-tight">Pipeline Home</h1>
                        <p className="text-xs text-muted-foreground">
                            {tubeMapData.totals.active} active leads
                        </p>
                    </div>

                    {/* Route stats */}
                    <div className="hidden md:flex items-center gap-3 ml-4 pl-4 border-l">
                        {tubeMapData.routes.map(route => (
                            <div key={route.route} className="flex items-center gap-1.5 text-xs">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: ROUTE_COLORS[route.route].line }} />
                                <span className="font-medium">{route.totalLeads}</span>
                                <span className="text-emerald-600">({route.conversionRate}%)</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* Entry point mini stats */}
                    <div className="hidden sm:flex items-center gap-3 text-xs mr-2">
                        <div className="flex items-center gap-1">
                            <Phone className="h-3 w-3 text-blue-500" />
                            <span>{tubeMapData.entryPoints.calls.today}</span>
                            {tubeMapData.entryPoints.calls.live && (
                                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                            )}
                        </div>
                        <div className="flex items-center gap-1">
                            <MessageSquare className="h-3 w-3 text-green-500" />
                            <span>{tubeMapData.entryPoints.whatsapp.today}</span>
                            {tubeMapData.entryPoints.whatsapp.unread > 0 && (
                                <Badge variant="secondary" className="h-4 px-1 text-[10px]">{tubeMapData.entryPoints.whatsapp.unread}</Badge>
                            )}
                        </div>
                        <div className="flex items-center gap-1">
                            <FileText className="h-3 w-3 text-purple-500" />
                            <span>{tubeMapData.entryPoints.webforms.today}</span>
                        </div>
                    </div>
                    <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => refetch()}>
                        <RefreshCw className="h-3 w-3" />
                    </Button>
                </div>
            </div>

            {/* Tube Map SVG - Responsive height */}
            <div className="flex-shrink-0 p-3 border-b bg-muted/20">
                <Card>
                    <CardContent className="p-3">
                        <TubeMapSVG
                            data={tubeMapData}
                            selectedStage={selectedStage}
                            onStationClick={handleStationClick}
                        />
                    </CardContent>
                </Card>
            </div>

            {/* Vitals Grid - 3 stat cards */}
            <div className="flex-shrink-0 grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border-b bg-background">
                {/* Pipeline Card */}
                <Card className="bg-card">
                    <CardContent className="p-4">
                        <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                            <Activity className="h-4 w-4" />
                            Pipeline
                        </h3>
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <span className="text-2xl font-bold">{tubeMapData?.totals?.active || 0}</span>
                                <span className="text-sm text-muted-foreground">Active</span>
                            </div>
                            <div className="flex gap-3 text-sm">
                                <span className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                                    HOT: {qualificationCounts.hot}
                                </span>
                                <span className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                                    WARM: {qualificationCounts.warm}
                                </span>
                                <span className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-slate-500"></span>
                                    COLD: {qualificationCounts.cold}
                                </span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Today Card */}
                <Card className="bg-card">
                    <CardContent className="p-4">
                        <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                            <Calendar className="h-4 w-4" />
                            Today
                        </h3>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                            <div className="flex items-center gap-2">
                                <Phone className="h-3.5 w-3.5 text-blue-500" />
                                <span>Calls: {tubeMapData?.entryPoints?.calls?.today || 0}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <MessageSquare className="h-3.5 w-3.5 text-green-500" />
                                <span>WhatsApp: {tubeMapData?.entryPoints?.whatsapp?.today || 0}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <FileText className="h-3.5 w-3.5 text-purple-500" />
                                <span>Webforms: {tubeMapData?.entryPoints?.webforms?.today || 0}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Quote className="h-3.5 w-3.5 text-indigo-500" />
                                <span>Quotes: {quotesToday}</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Conversion Card */}
                <Card className="bg-card">
                    <CardContent className="p-4">
                        <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                            <TrendingUp className="h-4 w-4" />
                            Conversion
                        </h3>
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span>Lead to Quote</span>
                                <span className="font-medium">{conversionRates.leadToQuote}%</span>
                            </div>
                            <div className="flex justify-between">
                                <span>Quote to Paid</span>
                                <span className="font-medium">{conversionRates.quoteToPaid}%</span>
                            </div>
                            <div className="flex justify-between border-t pt-2 mt-2">
                                <span>Overall</span>
                                <span className="font-medium text-emerald-500">{conversionRates.overall}%</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Priority Leads Section */}
            <div className="flex-1 overflow-auto p-4">
                <div className="mb-4">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4" />
                            Priority Leads
                        </h3>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                                {priorityLeads.length} needs attention
                            </span>
                            {selectedStage && (
                                <Button variant="ghost" size="sm" className="text-xs h-6" onClick={handleClearStageFilter}>
                                    Clear filter
                                </Button>
                            )}
                        </div>
                    </div>

                    {priorityLeads.length === 0 ? (
                        <div className="text-center py-6 text-muted-foreground text-sm">
                            No priority leads right now
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                            <AnimatePresence mode="popLayout">
                                {(selectedStage
                                    ? priorityLeads.filter(l => l.stage === selectedStage)
                                    : priorityLeads
                                ).map(lead => (
                                    <LeadCard key={lead.id} lead={lead} onClick={() => handleLeadClick(lead)} />
                                ))}
                            </AnimatePresence>
                        </div>
                    )}
                </div>

                {/* Live Activity - Compact */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                            Live Activity
                        </h3>
                        <Button variant="ghost" size="sm" className="text-xs h-6">
                            View all
                        </Button>
                    </div>
                    <div className="space-y-2">
                        {/* Show last 5 activities based on most recent leads */}
                        {allLeads.slice(0, 5).map(lead => (
                            <div
                                key={`activity-${lead.id}`}
                                className="flex items-center justify-between text-sm py-2 px-3 rounded-md bg-muted/30 hover:bg-muted/50 cursor-pointer transition-colors"
                                onClick={() => handleLeadClick(lead)}
                            >
                                <div className="flex items-center gap-2">
                                    {lead.source === 'call' && <Phone className="h-3.5 w-3.5 text-blue-500" />}
                                    {lead.source === 'whatsapp' && <MessageSquare className="h-3.5 w-3.5 text-green-500" />}
                                    {lead.source === 'web' && <FileText className="h-3.5 w-3.5 text-purple-500" />}
                                    {!lead.source && <User className="h-3.5 w-3.5 text-muted-foreground" />}
                                    <span className="font-medium">{lead.customerName}</span>
                                    <span className="text-muted-foreground">- {lead.jobDescription || 'New inquiry'}</span>
                                </div>
                                <span className="text-xs text-muted-foreground">
                                    {lead.stageUpdatedAt
                                        ? formatDistanceToNow(new Date(lead.stageUpdatedAt), { addSuffix: true })
                                        : 'recently'}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Compact Footer */}
            <div className="flex-shrink-0 border-t bg-muted/30 px-4 py-1.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                    <span className="text-muted-foreground hidden sm:inline">Segments:</span>
                    {Object.entries(SEGMENT_COLORS).slice(0, 6).map(([segment, color]) => (
                        <div key={segment} className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                            <span className="text-[10px] text-muted-foreground hidden lg:inline">{segment.replace(/_/g, ' ')}</span>
                        </div>
                    ))}
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        <span>Completed: {tubeMapData.totals.completed}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                        <span>Lost: {tubeMapData.totals.lost}</span>
                    </div>
                </div>
            </div>

            {/* Slide-out Detail Panel */}
            <LeadDetailPanel
                lead={selectedLead}
                onClose={() => setSelectedLead(null)}
                onStageChange={handleStageChange}
                onPlayVideo={setVideoUrl}
                onPlayAudio={setAudioUrl}
            />

            {/* Overlay when panel is open */}
            {selectedLead && (
                <div
                    className="fixed inset-0 bg-black/20 z-40"
                    onClick={() => setSelectedLead(null)}
                />
            )}

            {/* Video Player Modal */}
            <VideoPlayerModal videoUrl={videoUrl} onClose={() => setVideoUrl(null)} />

            {/* Audio Player Modal */}
            <AudioPlayerModal audioUrl={audioUrl} onClose={() => setAudioUrl(null)} />
        </div>
    );
}
