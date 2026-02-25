/**
 * Pipeline Home - The main/only view for V6 Switchboard CRM
 *
 * Architecture:
 * - Header: Logo, notification bell, admin gear icon
 * - Alerts Bar: Exceptions needing human attention
 * - Tube Map: Live lead counts per station
 * - Live Feed: Recent system activity (fixed height)
 * - Slide-out Panel: Details when alert/lead clicked
 * - Admin Sidebar: Hidden by default, gear reveals it
 *
 * Must fit in 100vh - no scrolling on main page
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
    X,
    Video,
    Play,
    Eye,
    ExternalLink,
    Send,
    Settings,
    Bell,
    ChevronRight,
    CreditCard,
    AlertCircle,
    RefreshCw,
    Zap,
    ArrowRight,
    History,
    Quote,
    User,
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";
import { Link, useLocation } from "wouter";

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

// Alert types
type AlertType = 'sla_breach' | 'customer_reply' | 'payment_issue' | 'urgent_callback';

interface Alert {
    id: string;
    type: AlertType;
    severity: 'warning' | 'critical';
    leadId: string;
    customerName: string;
    message: string;
    timestamp: string;
    stage?: LeadStage;
}

// Live feed activity types
type ActivityType =
    | 'call_incoming'
    | 'call_ended'
    | 'video_request_sent'
    | 'video_requested'
    | 'video_received'
    | 'quote_viewed'
    | 'quote_sent'
    | 'payment_received'
    | 'whatsapp_sent'
    | 'whatsapp_received'
    | 'stage_change';

interface ActivityItem {
    id: string;
    type: ActivityType;
    timestamp: string;
    customerName: string;
    summary: string;
    leadId?: string;
    details?: Record<string, unknown>;
}

// Timeline event types
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

const ALERT_CONFIG: Record<AlertType, { icon: typeof AlertTriangle; color: string; bg: string }> = {
    sla_breach: { icon: Clock, color: 'text-red-500', bg: 'bg-red-500/10' },
    customer_reply: { icon: MessageSquare, color: 'text-blue-500', bg: 'bg-blue-500/10' },
    payment_issue: { icon: CreditCard, color: 'text-amber-500', bg: 'bg-amber-500/10' },
    urgent_callback: { icon: Phone, color: 'text-purple-500', bg: 'bg-purple-500/10' },
};

const ACTIVITY_CONFIG: Record<ActivityType, { icon: typeof Phone; color: string; bg: string }> = {
    call_incoming: { icon: Phone, color: 'text-green-500', bg: 'bg-green-500/10' },
    call_ended: { icon: Phone, color: 'text-blue-500', bg: 'bg-blue-500/10' },
    video_request_sent: { icon: Video, color: 'text-purple-500', bg: 'bg-purple-500/10' },
    video_requested: { icon: Video, color: 'text-purple-500', bg: 'bg-purple-500/10' },
    video_received: { icon: Video, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
    quote_viewed: { icon: Eye, color: 'text-cyan-500', bg: 'bg-cyan-500/10' },
    quote_sent: { icon: FileText, color: 'text-blue-500', bg: 'bg-blue-500/10' },
    payment_received: { icon: CreditCard, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
    whatsapp_sent: { icon: Send, color: 'text-green-600', bg: 'bg-green-600/10' },
    whatsapp_received: { icon: MessageSquare, color: 'text-green-600', bg: 'bg-green-600/10' },
    stage_change: { icon: ArrowRight, color: 'text-amber-500', bg: 'bg-amber-500/10' },
};

// ==========================================
// MOCK DATA GENERATORS
// ==========================================

function generateMockTubeMapData(): TubeMapData {
    const segments: SegmentType[] = ['EMERGENCY', 'BUSY_PRO', 'PROP_MGR', 'LANDLORD', 'SMALL_BIZ', 'TRUST_SEEKER', 'RENTER', 'DIY_DEFERRER'];
    const ROUTE_STATIONS: Record<RouteType, LeadStage[]> = {
        video: ['contacted', 'awaiting_video', 'video_received', 'quote_sent', 'quote_viewed', 'booked'],
        instant: ['contacted', 'quote_sent', 'quote_viewed', 'booked'],
        site_visit: ['contacted', 'quote_sent', 'quote_viewed', 'booked'],
    };

    const generateLeads = (route: RouteType, stage: LeadStage, count: number): TubeMapLead[] => {
        const leads: TubeMapLead[] = [];
        for (let i = 0; i < count; i++) {
            const segment = segments[Math.floor(Math.random() * segments.length)];
            const slaStatuses: ('ok' | 'warning' | 'overdue')[] = ['ok', 'ok', 'ok', 'warning', 'overdue'];
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
            });
        }
        return leads;
    };

    const buildRoute = (route: RouteType): RouteData => {
        const stationStages = ROUTE_STATIONS[route];
        const stations: StationData[] = stationStages.map(stage => {
            const leadCount = Math.floor(Math.random() * 6) + 1;
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
            calls: { today: 12, live: false },
            whatsapp: { today: 8, unread: 2 },
            webforms: { today: 5, needsChase: 1 },
        },
        totals: { active: 32, completed: 18, lost: 4 },
    };
}

function generateMockAlerts(): Alert[] {
    return [
        {
            id: 'alert_1',
            type: 'sla_breach',
            severity: 'critical',
            leadId: 'lead_1',
            customerName: 'John Smith',
            message: 'Stuck in "Awaiting Video" for 2h',
            timestamp: new Date(Date.now() - 7200000).toISOString(),
            stage: 'awaiting_video',
        },
        {
            id: 'alert_2',
            type: 'customer_reply',
            severity: 'warning',
            leadId: 'lead_2',
            customerName: 'Sarah Jones',
            message: '"Can you call me back please?"',
            timestamp: new Date(Date.now() - 1800000).toISOString(),
        },
    ];
}

function generateMockActivities(): ActivityItem[] {
    const activities: ActivityItem[] = [
        { id: '1', type: 'call_ended', timestamp: new Date(Date.now() - 120000).toISOString(), customerName: 'Sarah', summary: 'Call ended - tap repair' },
        { id: '2', type: 'video_request_sent', timestamp: new Date(Date.now() - 180000).toISOString(), customerName: 'Sarah', summary: 'Auto-sent video request' },
        { id: '3', type: 'quote_viewed', timestamp: new Date(Date.now() - 300000).toISOString(), customerName: 'Mike', summary: 'Viewed quote (2nd time)' },
        { id: '4', type: 'payment_received', timestamp: new Date(Date.now() - 600000).toISOString(), customerName: 'James', summary: 'Paid \u00A3340 - Job booked' },
        { id: '5', type: 'video_received', timestamp: new Date(Date.now() - 900000).toISOString(), customerName: 'Emma', summary: 'Received video of kitchen tap' },
        { id: '6', type: 'whatsapp_received', timestamp: new Date(Date.now() - 1200000).toISOString(), customerName: 'David', summary: '"Thanks, looks good!"' },
        { id: '7', type: 'call_incoming', timestamp: new Date(Date.now() - 1500000).toISOString(), customerName: 'Unknown', summary: 'New inquiry - door repair' },
        { id: '8', type: 'stage_change', timestamp: new Date(Date.now() - 1800000).toISOString(), customerName: 'Lisa', summary: 'Moved to Quote Sent' },
    ];
    return activities;
}

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
// COMPACT TUBE MAP SVG
// ==========================================

interface CompactTubeMapProps {
    data: TubeMapData;
    selectedStage: LeadStage | null;
    onStationClick: (stage: LeadStage) => void;
}

function CompactTubeMap({ data, selectedStage, onStationClick }: CompactTubeMapProps) {
    const STATION_RADIUS = 14;
    const STATION_SPACING_X = 100;
    const ROUTE_SPACING_Y = 50;
    const START_X = 70;
    const START_Y = 45;
    const LINE_THICKNESS = 5;

    const stationPositions = useMemo(() => {
        const positions: Record<string, { x: number; y: number; route: RouteType }> = {};
        positions['contacted'] = { x: START_X, y: START_Y + ROUTE_SPACING_Y, route: 'instant' };
        positions['video_awaiting_video'] = { x: START_X + STATION_SPACING_X, y: START_Y, route: 'video' };
        positions['video_video_received'] = { x: START_X + STATION_SPACING_X * 2, y: START_Y, route: 'video' };
        positions['quote_sent'] = { x: START_X + STATION_SPACING_X * 3, y: START_Y + ROUTE_SPACING_Y, route: 'instant' };
        positions['quote_viewed'] = { x: START_X + STATION_SPACING_X * 4, y: START_Y + ROUTE_SPACING_Y, route: 'instant' };
        positions['booked'] = { x: START_X + STATION_SPACING_X * 5, y: START_Y + ROUTE_SPACING_Y, route: 'instant' };
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
        const hasLeads = count > 0;

        return (
            <g className="cursor-pointer" onClick={() => onStationClick(stage)}>
                {isSelected && (
                    <circle cx={pos.x} cy={pos.y} r={STATION_RADIUS + 5} fill="none" stroke={ROUTE_COLORS[route].line} strokeWidth={2} className="animate-pulse" />
                )}
                <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={STATION_RADIUS}
                    fill={hasLeads ? ROUTE_COLORS[route].line : 'white'}
                    stroke={ROUTE_COLORS[route].line}
                    strokeWidth={isSelected ? 3 : 2}
                    className="transition-all hover:stroke-[4px]"
                />
                <text
                    x={pos.x}
                    y={pos.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={hasLeads ? 'white' : '#1f2937'}
                    className="font-bold text-[11px] pointer-events-none"
                >
                    {count}
                </text>
                <text x={pos.x} y={pos.y + STATION_RADIUS + 10} textAnchor="middle" fill="#94a3b8" className="text-[9px] font-medium pointer-events-none">
                    {label}
                </text>
            </g>
        );
    };

    return (
        <svg viewBox="0 0 660 160" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
            <rect width="100%" height="100%" className="fill-transparent" />

            {/* Video route path */}
            <path
                d={`M ${stationPositions['contacted'].x} ${stationPositions['contacted'].y}
                    Q ${stationPositions['contacted'].x + 35} ${stationPositions['contacted'].y} ${stationPositions['contacted'].x + 35} ${stationPositions['video_awaiting_video'].y + 18}
                    L ${stationPositions['video_awaiting_video'].x - 18} ${stationPositions['video_awaiting_video'].y}
                    L ${stationPositions['video_video_received'].x} ${stationPositions['video_video_received'].y}
                    Q ${stationPositions['video_video_received'].x + 35} ${stationPositions['video_video_received'].y} ${stationPositions['video_video_received'].x + 35} ${stationPositions['quote_sent'].y - 18}
                    L ${stationPositions['quote_sent'].x - 18} ${stationPositions['quote_sent'].y}`}
                fill="none" stroke={ROUTE_COLORS.video.line} strokeWidth={LINE_THICKNESS} strokeLinecap="round" strokeLinejoin="round" opacity={0.8}
            />

            {/* Golden path (instant) - glow + main line */}
            <line x1={stationPositions['contacted'].x} y1={stationPositions['contacted'].y} x2={stationPositions['booked'].x} y2={stationPositions['booked'].y} stroke="#10B981" strokeWidth={14} strokeLinecap="round" opacity={0.15} />
            <line x1={stationPositions['contacted'].x} y1={stationPositions['contacted'].y} x2={stationPositions['booked'].x} y2={stationPositions['booked'].y} stroke="#10B981" strokeWidth={6} strokeLinecap="round" />

            {/* Stations */}
            <Station stage="contacted" posKey="contacted" label="Contacted" route="instant" />
            <Station stage="awaiting_video" posKey="video_awaiting_video" label="Awaiting Video" route="video" />
            <Station stage="video_received" posKey="video_video_received" label="Video Rcvd" route="video" />
            <Station stage="quote_sent" posKey="quote_sent" label="Quote Sent" route="instant" />
            <Station stage="quote_viewed" posKey="quote_viewed" label="Quote Viewed" route="instant" />
            <Station stage="booked" posKey="booked" label="Booked" route="instant" />

            {/* Route legend - compact */}
            <g transform="translate(15, 8)">
                <line x1={0} y1={5} x2={15} y2={5} stroke={ROUTE_COLORS.video.line} strokeWidth={3} strokeLinecap="round" />
                <text x={20} y={8} fill="#a1a1aa" className="text-[8px] font-medium">Video</text>
                <line x1={60} y1={5} x2={75} y2={5} stroke={ROUTE_COLORS.instant.line} strokeWidth={3} strokeLinecap="round" />
                <text x={80} y={8} fill="#a1a1aa" className="text-[8px] font-medium">Instant</text>
            </g>
        </svg>
    );
}

// ==========================================
// ALERTS BAR
// ==========================================

interface AlertsBarProps {
    alerts: Alert[];
    onAlertClick: (alert: Alert) => void;
}

function AlertsBar({ alerts, onAlertClick }: AlertsBarProps) {
    if (alerts.length === 0) {
        return (
            <div className="flex items-center justify-center py-2 px-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mr-2" />
                <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">All clear - no exceptions</span>
            </div>
        );
    }

    return (
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide py-1">
            <div className="flex-shrink-0 flex items-center gap-1 text-red-500">
                <AlertCircle className="h-4 w-4" />
                <span className="text-xs font-bold">{alerts.length}</span>
            </div>
            {alerts.map((alert) => {
                const config = ALERT_CONFIG[alert.type];
                const Icon = config.icon;
                return (
                    <motion.button
                        key={alert.id}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        whileHover={{ scale: 1.02 }}
                        onClick={() => onAlertClick(alert)}
                        className={cn(
                            "flex items-center gap-2 px-3 py-1.5 rounded-lg border flex-shrink-0",
                            "transition-all hover:shadow-md cursor-pointer",
                            config.bg,
                            alert.severity === 'critical' ? 'border-red-500/50' : 'border-border'
                        )}
                    >
                        <Icon className={cn("h-3.5 w-3.5", config.color)} />
                        <span className="text-xs font-medium">{alert.customerName}</span>
                        <span className="text-xs text-muted-foreground max-w-[150px] truncate">
                            {alert.message}
                        </span>
                        {alert.severity === 'critical' && (
                            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                        )}
                    </motion.button>
                );
            })}
        </div>
    );
}

// ==========================================
// LIVE FEED
// ==========================================

interface LiveFeedProps {
    activities: ActivityItem[];
    onActivityClick: (activity: ActivityItem) => void;
}

function LiveFeed({ activities, onActivityClick }: LiveFeedProps) {
    return (
        <ScrollArea className="h-full">
            <div className="space-y-1 p-2">
                {activities.map((activity, index) => {
                    const config = ACTIVITY_CONFIG[activity.type];
                    if (!config) return null; // Skip unknown activity types
                    const Icon = config.icon;

                    return (
                        <motion.div
                            key={activity.id}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: index * 0.03 }}
                            onClick={() => onActivityClick(activity)}
                            className={cn(
                                "flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer",
                                "hover:bg-muted/50 transition-colors"
                            )}
                        >
                            <div className={cn("p-1.5 rounded-md flex-shrink-0", config.bg)}>
                                <Icon className={cn("h-3.5 w-3.5", config.color)} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium">{activity.customerName}</span>
                                    <span className="text-xs text-muted-foreground truncate">{activity.summary}</span>
                                </div>
                            </div>
                            <span className="text-[10px] text-muted-foreground flex-shrink-0">
                                {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: false })}
                            </span>
                        </motion.div>
                    );
                })}
            </div>
        </ScrollArea>
    );
}

// ==========================================
// SLIDE-OUT DETAIL PANEL
// ==========================================

interface DetailPanelProps {
    lead: TubeMapLead | null;
    alert: Alert | null;
    onClose: () => void;
    onStageChange: (leadId: string, newStage: LeadStage) => void;
}

function DetailPanel({ lead, alert, onClose, onStageChange }: DetailPanelProps) {
    const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
    const [isLoadingTimeline, setIsLoadingTimeline] = useState(false);

    const displayLead = lead;
    const displayName = lead?.customerName || alert?.customerName || 'Unknown';
    const displayPhone = lead?.phone || '';

    useEffect(() => {
        if (!lead) {
            setTimeline([]);
            return;
        }

        setIsLoadingTimeline(true);
        fetch(`/api/admin/leads/${lead.id}/timeline`)
            .then(res => {
                if (!res.ok) throw new Error('Not found');
                return res.json();
            })
            .then(data => {
                setTimeline(data.timeline || []);
            })
            .catch(() => {
                setTimeline(generateMockTimeline(lead));
            })
            .finally(() => setIsLoadingTimeline(false));
    }, [lead?.id]);

    const stages: LeadStage[] = [
        'new_lead', 'contacted', 'awaiting_video', 'video_received', 'quote_sent', 'quote_viewed',
        'awaiting_payment', 'booked', 'in_progress', 'completed', 'lost'
    ];

    const isOpen = !!(lead || alert);

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/20 z-40"
                        onClick={onClose}
                    />

                    {/* Panel */}
                    <motion.div
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                        className="fixed inset-y-0 right-0 w-full sm:w-[400px] bg-background border-l shadow-xl z-50 flex flex-col"
                    >
                        {/* Header */}
                        <div className="flex-shrink-0 p-4 border-b bg-muted/30">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-3">
                                    <div
                                        className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold"
                                        style={{ backgroundColor: displayLead?.segment ? SEGMENT_COLORS[displayLead.segment] : '#6B7280' }}
                                    >
                                        {displayName.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-lg">{displayName}</h3>
                                        {displayPhone && <p className="text-sm text-muted-foreground">{displayPhone}</p>}
                                    </div>
                                </div>
                                <Button variant="ghost" size="icon" onClick={onClose}>
                                    <X className="h-5 w-5" />
                                </Button>
                            </div>

                            {/* Alert message if from alert */}
                            {alert && (
                                <div className={cn("mt-3 p-2 rounded-lg", ALERT_CONFIG[alert.type].bg)}>
                                    <p className="text-sm font-medium">{alert.message}</p>
                                </div>
                            )}

                            {/* Status badges */}
                            {displayLead && (
                                <div className="flex flex-wrap gap-2 mt-3">
                                    <Badge className={cn(ROUTE_COLORS[displayLead.route].bg, "text-white")}>
                                        {ROUTE_NAMES[displayLead.route]}
                                    </Badge>
                                    <Badge variant="outline">
                                        {STAGE_DISPLAY_NAMES[displayLead.stage]}
                                    </Badge>
                                    <Badge
                                        variant={displayLead.slaStatus === 'ok' ? 'default' : displayLead.slaStatus === 'warning' ? 'secondary' : 'destructive'}
                                    >
                                        <Clock className="h-3 w-3 mr-1" />
                                        {displayLead.timeInStage}
                                    </Badge>
                                </div>
                            )}
                        </div>

                        {/* Scrollable content */}
                        <ScrollArea className="flex-1">
                            <div className="p-4 space-y-6">
                                {/* Job description */}
                                {displayLead?.jobDescription && (
                                    <div>
                                        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Job Description</h4>
                                        <p className="text-sm">{displayLead.jobDescription}</p>
                                    </div>
                                )}

                                {/* Timeline */}
                                {displayLead && (
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
                                            <div className="space-y-3">
                                                {timeline.slice(0, 6).map(event => {
                                                    const iconMap: Record<string, { icon: React.ReactNode; color: string }> = {
                                                        call: { icon: <Phone className="h-3 w-3" />, color: 'bg-blue-500' },
                                                        whatsapp_sent: { icon: <Send className="h-3 w-3" />, color: 'bg-green-500' },
                                                        whatsapp_received: { icon: <MessageSquare className="h-3 w-3" />, color: 'bg-green-600' },
                                                        video_received: { icon: <Video className="h-3 w-3" />, color: 'bg-purple-500' },
                                                        stage_change: { icon: <ArrowRight className="h-3 w-3" />, color: 'bg-amber-500' },
                                                        quote_sent: { icon: <FileText className="h-3 w-3" />, color: 'bg-indigo-500' },
                                                        quote_viewed: { icon: <Eye className="h-3 w-3" />, color: 'bg-cyan-500' },
                                                        payment: { icon: <CheckCircle2 className="h-3 w-3" />, color: 'bg-emerald-500' },
                                                        note: { icon: <FileText className="h-3 w-3" />, color: 'bg-slate-500' },
                                                    };
                                                    const { icon, color } = iconMap[event.type] || iconMap.note;

                                                    return (
                                                        <div key={event.id} className="flex gap-3">
                                                            <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-white flex-shrink-0", color)}>
                                                                {icon}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-sm">{event.summary}</p>
                                                                <span className="text-[10px] text-muted-foreground">
                                                                    {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Move Stage */}
                                {displayLead && (
                                    <div>
                                        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Move to Stage</h4>
                                        <Select
                                            value={displayLead.stage}
                                            onValueChange={(value) => onStageChange(displayLead.id, value as LeadStage)}
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
                                )}
                            </div>
                        </ScrollArea>

                        {/* Actions footer */}
                        {displayLead && (
                            <div className="flex-shrink-0 p-4 border-t bg-muted/30 space-y-3">
                                <div className="grid grid-cols-3 gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="text-xs"
                                        onClick={() => window.open(`tel:${displayLead.phone}`, '_blank')}
                                    >
                                        <Phone className="h-3.5 w-3.5 mr-1" />
                                        Call
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="text-xs text-green-600 hover:text-green-700"
                                        onClick={() => window.open(`https://wa.me/${displayLead.phone.replace(/[^0-9]/g, '')}`, '_blank')}
                                    >
                                        <MessageSquare className="h-3.5 w-3.5 mr-1" />
                                        WhatsApp
                                    </Button>
                                    {displayLead.quoteSlug ? (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="text-xs"
                                            onClick={() => window.open(`/q/${displayLead.quoteSlug}`, '_blank')}
                                        >
                                            <ExternalLink className="h-3.5 w-3.5 mr-1" />
                                            Quote
                                        </Button>
                                    ) : (
                                        <Button variant="default" size="sm" className="text-xs">
                                            <FileText className="h-3.5 w-3.5 mr-1" />
                                            Create
                                        </Button>
                                    )}
                                </div>

                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="flex-1 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                                        onClick={() => onStageChange(displayLead.id, 'lost')}
                                    >
                                        Mark Lost
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="flex-1 text-xs"
                                        onClick={() => onStageChange(displayLead.id, 'declined')}
                                    >
                                        Declined
                                    </Button>
                                </div>
                            </div>
                        )}
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}

// ==========================================
// ADMIN SIDEBAR (Hidden by default)
// ==========================================

interface AdminSidebarProps {
    isOpen: boolean;
    onClose: () => void;
}

function AdminSidebar({ isOpen, onClose }: AdminSidebarProps) {
    const [, setLocation] = useLocation();

    const menuItems = [
        { icon: Settings, label: 'Settings', href: '/admin/settings' },
        { icon: User, label: 'Contractors', href: '/admin/contractors' },
        { icon: FileText, label: 'Reports', href: '/admin/dashboard' },
        { icon: Quote, label: 'Quote Builder', href: '/admin/generate-quote' },
    ];

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/20 z-40"
                        onClick={onClose}
                    />
                    <motion.div
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                        className="fixed top-0 right-0 bottom-0 w-64 bg-background border-l shadow-xl z-50"
                    >
                        <div className="p-4 border-b flex items-center justify-between">
                            <h3 className="font-semibold">Admin Menu</h3>
                            <Button variant="ghost" size="icon" onClick={onClose}>
                                <X className="h-5 w-5" />
                            </Button>
                        </div>
                        <nav className="p-4 space-y-2">
                            {menuItems.map((item) => (
                                <Button
                                    key={item.href}
                                    variant="ghost"
                                    className="w-full justify-start"
                                    onClick={() => {
                                        setLocation(item.href);
                                        onClose();
                                    }}
                                >
                                    <item.icon className="h-4 w-4 mr-3" />
                                    {item.label}
                                </Button>
                            ))}
                        </nav>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function PipelineHomePage() {
    const [selectedLead, setSelectedLead] = useState<TubeMapLead | null>(null);
    const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
    const [selectedStage, setSelectedStage] = useState<LeadStage | null>(null);
    const [adminSidebarOpen, setAdminSidebarOpen] = useState(false);
    const wsRef = useRef<WebSocket | null>(null);
    const queryClient = useQueryClient();
    const { toast } = useToast();

    // Fetch tube map data
    const { data: tubeMapData, isLoading, refetch } = useQuery<TubeMapData>({
        queryKey: ["pipeline-home-tube-map"],
        queryFn: async () => {
            try {
                const res = await fetch("/api/admin/lead-tube-map");
                if (!res.ok) {
                    console.warn('[PipelineHome] API not available, using mock data');
                    return generateMockTubeMapData();
                }
                return res.json();
            } catch (error) {
                console.warn('[PipelineHome] API error, using mock data:', error);
                return generateMockTubeMapData();
            }
        },
        refetchInterval: 30000,
    });

    // Fetch alerts
    const { data: alerts = [] } = useQuery<Alert[]>({
        queryKey: ["pipeline-home-alerts"],
        queryFn: async () => {
            try {
                const res = await fetch("/api/admin/alerts");
                if (!res.ok) return generateMockAlerts();
                return res.json();
            } catch {
                return generateMockAlerts();
            }
        },
        refetchInterval: 15000,
    });

    // Fetch live activity
    const { data: activities = [] } = useQuery<ActivityItem[]>({
        queryKey: ["pipeline-home-activities"],
        queryFn: async () => {
            try {
                const res = await fetch("/api/admin/activity-stream?limit=20");
                if (!res.ok) return generateMockActivities();
                const data = await res.json();
                return data.activities || generateMockActivities();
            } catch {
                return generateMockActivities();
            }
        },
        refetchInterval: 10000,
    });

    // Flatten all leads from all routes
    const allLeads = useMemo(() => {
        if (!tubeMapData) return [];
        return tubeMapData.routes.flatMap(route =>
            route.stations.flatMap(station => station.leads)
        );
    }, [tubeMapData]);

    // WebSocket connection for real-time updates
    useEffect(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/ws/client`;

        try {
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);

                    if (msg.type === 'lead:stage_change' || msg.type === 'lead:created') {
                        queryClient.invalidateQueries({ queryKey: ["pipeline-home-tube-map"] });
                        queryClient.invalidateQueries({ queryKey: ["pipeline-home-activities"] });
                    }

                    if (msg.type === 'call:incoming' || msg.type === 'voice:call_started' || msg.type === 'whatsapp:incoming') {
                        queryClient.invalidateQueries({ queryKey: ["pipeline-home-tube-map"] });
                        queryClient.invalidateQueries({ queryKey: ["pipeline-home-activities"] });
                        queryClient.invalidateQueries({ queryKey: ["pipeline-home-alerts"] });
                    }
                } catch (e) {
                    console.error('[PipelineHome] WebSocket parse error:', e);
                }
            };

            return () => ws.close();
        } catch (e) {
            console.warn('[PipelineHome] WebSocket connection failed:', e);
        }
    }, [queryClient]);

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
            queryClient.invalidateQueries({ queryKey: ["pipeline-home-tube-map"] });
            setSelectedLead(null);
            setSelectedAlert(null);
        },
        onError: (error: Error) => {
            toast({ title: "Update Failed", description: error.message, variant: "destructive" });
        },
    });

    // Handlers
    const handleStationClick = useCallback((stage: LeadStage) => {
        setSelectedStage(prev => prev === stage ? null : stage);
    }, []);

    const handleAlertClick = useCallback((alert: Alert) => {
        setSelectedAlert(alert);
        // Try to find the associated lead
        const lead = allLeads.find(l => l.id === alert.leadId);
        if (lead) {
            setSelectedLead(lead);
        }
    }, [allLeads]);

    const handleActivityClick = useCallback((activity: ActivityItem) => {
        if (activity.leadId) {
            const lead = allLeads.find(l => l.id === activity.leadId);
            if (lead) {
                setSelectedLead(lead);
            }
        }
    }, [allLeads]);

    const handleStageChange = useCallback((leadId: string, newStage: LeadStage) => {
        updateStageMutation.mutate({ leadId, newStage });
    }, [updateStageMutation]);

    const handleClosePanel = useCallback(() => {
        setSelectedLead(null);
        setSelectedAlert(null);
    }, []);

    // Count notifications
    const notificationCount = alerts.length + (tubeMapData?.entryPoints.whatsapp.unread || 0);

    if (isLoading) {
        return (
            <div className="h-screen flex items-center justify-center bg-background">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!tubeMapData) {
        return (
            <div className="h-screen flex items-center justify-center text-muted-foreground bg-background">
                Failed to load pipeline data
            </div>
        );
    }

    return (
        <div className="h-screen flex flex-col overflow-hidden bg-background">
            {/* Header */}
            <header className="flex-shrink-0 h-14 border-b bg-background/95 backdrop-blur-sm flex items-center justify-between px-4">
                <div className="flex items-center gap-3">
                    <img src="/logo.png" alt="V6" className="h-8 w-8" />
                    <div>
                        <h1 className="text-lg font-bold tracking-tight">V6 SWITCHBOARD</h1>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* Entry point stats */}
                    <div className="hidden sm:flex items-center gap-3 text-xs mr-4">
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
                        </div>
                        <div className="flex items-center gap-1">
                            <Zap className="h-3 w-3 text-purple-500" />
                            <span>{tubeMapData.totals.active} active</span>
                        </div>
                    </div>

                    {/* Refresh button */}
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetch()}>
                        <RefreshCw className="h-4 w-4" />
                    </Button>

                    {/* Notification bell */}
                    <Button variant="ghost" size="icon" className="h-8 w-8 relative">
                        <Bell className="h-4 w-4" />
                        {notificationCount > 0 && (
                            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full text-[10px] text-white flex items-center justify-center font-bold">
                                {notificationCount}
                            </span>
                        )}
                    </Button>

                    {/* Admin gear */}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setAdminSidebarOpen(true)}
                    >
                        <Settings className="h-4 w-4" />
                    </Button>
                </div>
            </header>

            {/* Alerts Bar */}
            <div className="flex-shrink-0 px-4 py-2 border-b bg-muted/20">
                <AlertsBar alerts={alerts} onAlertClick={handleAlertClick} />
            </div>

            {/* Main Content - Tube Map + Live Feed */}
            <div className="flex-1 flex flex-col min-h-0">
                {/* Tube Map */}
                <div className="flex-shrink-0 h-[140px] px-4 py-2">
                    <Card className="h-full bg-card/50 border-muted">
                        <CardContent className="p-2 h-full">
                            <CompactTubeMap
                                data={tubeMapData}
                                selectedStage={selectedStage}
                                onStationClick={handleStationClick}
                            />
                        </CardContent>
                    </Card>
                </div>

                {/* Live Feed - Takes remaining space */}
                <div className="flex-1 px-4 pb-4 min-h-0">
                    <Card className="h-full bg-card/50 border-muted">
                        <div className="flex items-center justify-between px-4 py-2 border-b">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                <h3 className="text-sm font-medium">Live Activity</h3>
                            </div>
                            <Badge variant="secondary" className="text-xs">{activities.length}</Badge>
                        </div>
                        <div className="h-[calc(100%-40px)]">
                            <LiveFeed activities={activities} onActivityClick={handleActivityClick} />
                        </div>
                    </Card>
                </div>
            </div>

            {/* Compact Footer */}
            <div className="flex-shrink-0 h-8 border-t bg-muted/30 px-4 flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-4">
                    <span className="hidden sm:inline">Routes:</span>
                    {tubeMapData.routes.map(route => (
                        <div key={route.route} className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: ROUTE_COLORS[route.route].line }} />
                            <span>{route.totalLeads}</span>
                            <span className="text-emerald-600">({route.conversionRate}%)</span>
                        </div>
                    ))}
                </div>
                <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                        {tubeMapData.totals.completed} completed
                    </span>
                    <span className="flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 text-red-500" />
                        {tubeMapData.totals.lost} lost
                    </span>
                </div>
            </div>

            {/* Slide-out Detail Panel */}
            <DetailPanel
                lead={selectedLead}
                alert={selectedAlert}
                onClose={handleClosePanel}
                onStageChange={handleStageChange}
            />

            {/* Admin Sidebar */}
            <AdminSidebar
                isOpen={adminSidebarOpen}
                onClose={() => setAdminSidebarOpen(false)}
            />
        </div>
    );
}
