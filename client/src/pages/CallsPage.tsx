import React, { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Phone, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { Badge } from "@/components/ui/badge";
import { subDays, format, isToday, isYesterday } from "date-fns";
import { CallDetailsModal } from "@/components/calls/CallDetailsModal";

interface CallSummary {
    id: string;
    callId: string;
    customerName: string;
    phoneNumber: string;
    address: string | null;
    startTime: string;
    jobSummary?: string;
    skuCount: number;
    totalPricePence: number;
    outcome: string | null;
    urgency: string | null;
    status: string;
    metadataJson: any;
    missedReason?: string;
    recordingUrl?: string;
    transcription?: string;
}

function formatCallTime(startTime: string) {
    const d = new Date(startTime);
    if (isToday(d)) return format(d, "'Today' HH:mm");
    if (isYesterday(d)) return format(d, "'Yesterday' HH:mm");
    return format(d, "d MMM HH:mm");
}

function getStatusColor(call: CallSummary) {
    if (call.status === 'in-progress' || call.status === 'ringing') return 'bg-blue-500 animate-pulse';
    const isRecovered = (call.missedReason && call.outcome !== 'no-answer' && call.outcome !== 'voicemail') || call.outcome === 'RECOVERED_FROM_TWILIO';
    if (isRecovered) return 'bg-yellow-400';
    const isLost = call.outcome === 'NO_ANSWER' || call.outcome === 'VOICEMAIL' || call.outcome === 'FAILED' || call.outcome === 'DROPPED_EARLY' || (!call.outcome && call.status === 'failed');
    if (isLost) return 'bg-red-500';
    return 'bg-emerald-500';
}

function getOutcomeBadge(call: CallSummary) {
    const outcome = call.outcome?.toUpperCase();
    switch (outcome) {
        case 'SITE_VISIT':
        case 'SITE_VISIT_BOOKED':
            return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px] px-1.5 py-0">Site Visit</Badge>;
        case 'QUOTE_REQUESTED':
        case 'VIDEO_QUOTE':
            return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px] px-1.5 py-0">Quote</Badge>;
        case 'INSTANT_PRICE':
        case 'INSTANT_PRICE_GIVEN':
            return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-[10px] px-1.5 py-0">Price Given</Badge>;
        case 'MSG_TAKEN':
        case 'MESSAGE_TAKEN':
            return <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30 text-[10px] px-1.5 py-0">Message</Badge>;
        case 'VOICEMAIL':
        case 'VOICEMAIL_LEFT':
            return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px] px-1.5 py-0">Voicemail</Badge>;
        case 'NO_ANSWER':
        case 'MISSED_CALL':
            return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px] px-1.5 py-0">Missed</Badge>;
        case 'ELEVEN_LABS':
            return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px] px-1.5 py-0">AI Agent</Badge>;
        default:
            return call.outcome ? <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">{call.outcome.replace(/_/g, ' ')}</Badge> : null;
    }
}

function getRouteBadge(call: CallSummary) {
    const isAgent = call.outcome === 'ELEVEN_LABS' || !!call.missedReason || call.outcome === 'RECOVERED_FROM_TWILIO';
    if (isAgent) {
        if (call.missedReason === 'out_of_hours' || call.missedReason === 'out-of-hours')
            return <Badge className="bg-indigo-500/20 text-indigo-400 border-indigo-500/30 text-[10px] px-1.5 py-0">OOH</Badge>;
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px] px-1.5 py-0">Agent</Badge>;
    }
    if (call.outcome === 'NO_ANSWER' || call.outcome === 'MISSED_CALL')
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px] px-1.5 py-0">Missed</Badge>;
    if (call.outcome === 'VOICEMAIL' || call.outcome === 'VOICEMAIL_LEFT')
        return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-[10px] px-1.5 py-0">VM</Badge>;
    return <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-[10px] px-1.5 py-0">VA</Badge>;
}

export default function CallsPage() {
    const [page, setPage] = useState(1);
    const [selectedCallId, setSelectedCallId] = useState<string | null>(null);

    const { data, isLoading } = useQuery({
        queryKey: ['calls', page],
        queryFn: async () => {
            const params = new URLSearchParams({
                page: page.toString(),
                limit: "30",
                startDate: subDays(new Date(), 30).toISOString(),
                endDate: new Date().toISOString(),
                vaOnly: "true",
            });
            const res = await fetch(`/api/calls?${params}`);
            if (!res.ok) throw new Error("Failed to fetch calls");
            return res.json() as Promise<{ calls: CallSummary[], pagination: any }>;
        },
        placeholderData: keepPreviousData,
    });

    const calls = data?.calls || [];
    const pagination = data?.pagination;

    return (
        <div className="flex flex-col h-full bg-background">
            {/* Compact header */}
            <div className="px-4 pt-3 pb-2">
                <h1 className="text-lg font-bold text-foreground">VA Answered Calls</h1>
                {pagination && (
                    <p className="text-xs text-muted-foreground">{pagination.total} VA calls in last 30 days</p>
                )}
            </div>

            {/* Call list */}
            <div className="flex-1 overflow-auto px-3 pb-20">
                {isLoading ? (
                    <div className="flex justify-center py-12">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                ) : calls.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground text-sm">No calls found</div>
                ) : (
                    <div className="space-y-1.5">
                        {calls.map((call) => (
                            <div
                                key={call.id}
                                className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border/50 active:bg-muted/70 transition-colors cursor-pointer"
                                onClick={() => setSelectedCallId(call.id)}
                            >
                                {/* Status dot */}
                                <div className="flex-shrink-0">
                                    <span className={`block w-2.5 h-2.5 rounded-full ${getStatusColor(call)}`} />
                                </div>

                                {/* Main content */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm text-foreground truncate">
                                            {call.customerName || 'Unknown'}
                                        </span>
                                        {/* Route badge removed - all calls are VA-answered */}
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                        <span className="text-[11px] text-muted-foreground">{formatCallTime(call.startTime)}</span>
                                        {call.jobSummary && (
                                            <span className="text-[11px] text-muted-foreground/70 truncate">
                                                · {call.jobSummary}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Right side: outcome + WhatsApp */}
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    {getOutcomeBadge(call)}
                                    <button
                                        className="p-1.5 rounded-lg bg-green-600/20 text-green-400 active:bg-green-600/40"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            const cleanNumber = call.phoneNumber.replace(/\D/g, '');
                                            const firstName = call.customerName?.split(' ')[0] || "there";
                                            let jobSummary = call.jobSummary?.toLowerCase() || "the work you need";
                                            if (!jobSummary.startsWith("the ") && !jobSummary.startsWith("my ") && !jobSummary.startsWith("our ")) {
                                                jobSummary = `the ${jobSummary}`;
                                            }
                                            const message = `Hi ${firstName}\n\nAs discussed please send us a video of ${jobSummary} for us to take a look straight away\u{1F60A}\n\nCourtnee\nHandy Services`;
                                            window.open(`https://wa.me/${cleanNumber}?text=${encodeURIComponent(message)}`, '_blank');
                                        }}
                                    >
                                        <FaWhatsapp className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Pagination */}
                {pagination && pagination.totalPages > 1 && (
                    <div className="flex items-center justify-between py-3 mt-2">
                        <button
                            disabled={page <= 1}
                            onClick={() => setPage(p => p - 1)}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-card border border-border disabled:opacity-30 text-muted-foreground"
                        >
                            <ChevronLeft className="w-3.5 h-3.5" /> Prev
                        </button>
                        <span className="text-xs text-muted-foreground">{page} / {pagination.totalPages}</span>
                        <button
                            disabled={page >= pagination.totalPages}
                            onClick={() => setPage(p => p + 1)}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-card border border-border disabled:opacity-30 text-muted-foreground"
                        >
                            Next <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}
            </div>

            {/* Modal */}
            <CallDetailsModal
                open={!!selectedCallId}
                callId={selectedCallId}
                onClose={() => setSelectedCallId(null)}
            />
        </div>
    );
}
