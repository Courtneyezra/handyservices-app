import React from "react";
import { Link } from "wouter";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Phone,
    Loader2,
    Eye,
} from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { format } from "date-fns";

import { NameCorrection } from "@/components/NameCorrection";

export interface CallSummary {
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

interface CallListTableProps {
    calls: CallSummary[];
    isLoading: boolean;
    onCallClick: (callId: string) => void;
}

export function CallListTable({ calls, isLoading, onCallClick }: CallListTableProps) {

    if (isLoading) {
        return <div className="p-8 text-center flex justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div>;
    }

    if (calls.length === 0) {
        return <div className="p-8 text-center text-muted-foreground">No calls found matching your filters.</div>;
    }

    return (
        <div className="rounded-2xl border border-border bg-card backdrop-blur-sm overflow-hidden">
            <Table>
                <TableHeader>
                    <TableRow className="hover:bg-transparent border-border">
                        <TableHead className="w-[50px]">Status</TableHead>
                        <TableHead className="w-[200px]">Route Path</TableHead>
                        <TableHead>Lead Info</TableHead>
                        <TableHead>Outcome</TableHead>
                        <TableHead className="text-right">Time</TableHead>
                        <TableHead className="w-[120px] text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {calls.map((call) => (
                        <TableRow
                            key={call.id}
                            className="cursor-pointer hover:bg-muted/50 border-border transition-all"
                            onClick={() => onCallClick(call.id)}
                        >
                            {/* 1. Status Dot */}
                            <TableCell>
                                <div className="flex items-center justify-center">
                                    {getStatusIndicator(call)}
                                </div>
                            </TableCell>

                            {/* 2. Route Path (Badge) */}
                            <TableCell>
                                {getRouteBadge(call)}
                            </TableCell>

                            {/* 3. Lead Info (Name + Job) */}
                            <TableCell>
                                <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                        <NameCorrection
                                            callId={call.id}
                                            currentName={call.customerName}
                                            metadataJson={call.metadataJson}
                                        />
                                    </div>
                                    <div className="flex items-center text-xs text-muted-foreground gap-2">
                                        <span className="flex items-center gap-1">
                                            <Phone className="h-3 w-3" />
                                            {call.phoneNumber}
                                        </span>
                                        {call.jobSummary && (
                                            <span className="text-muted-foreground truncate max-w-[200px]" title={call.jobSummary}>
                                                • {call.jobSummary}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </TableCell>

                            {/* 4. Outcome */}
                            <TableCell>
                                {getOutcomeBadge(call)}
                            </TableCell>

                            {/* 5. Time */}
                            <TableCell className="text-right text-sm text-muted-foreground">
                                <div>{format(new Date(call.startTime), "MMM d")}</div>
                                <div className="text-xs text-muted-foreground">{format(new Date(call.startTime), "HH:mm")}</div>
                            </TableCell>

                            {/* 6. Actions - Review and WhatsApp buttons */}
                            <TableCell className="text-right">
                                <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                                    <Link href={`/admin/calls/${call.id}/review`}>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-8 px-3 gap-1.5"
                                            title="Review Call"
                                        >
                                            <Eye className="h-4 w-4" />
                                            <span className="text-xs font-medium">Review</span>
                                        </Button>
                                    </Link>
                                    <Button
                                        size="sm"
                                        className="h-8 px-3 bg-green-600 hover:bg-green-700 text-white border-0 shadow-sm gap-1.5"
                                        onClick={() => {
                                            const cleanNumber = call.phoneNumber.replace(/\D/g, '');
                                            const firstName = call.customerName?.split(' ')[0] || "there";
                                            let jobSummary = call.jobSummary?.toLowerCase() || "the work you need";

                                            // Ensure grammatical flow: "video of [the] leaking tap"
                                            if (!jobSummary.startsWith("the ") && !jobSummary.startsWith("my ") && !jobSummary.startsWith("our ")) {
                                                jobSummary = `the ${jobSummary}`;
                                            }

                                            const message = `Hi ${firstName}\n\nAs discussed please send us a video of ${jobSummary} for us to take a look straight away😊\n\nCourtnee\nHandy Services`;

                                            // Open in WhatsApp app (not web)
                                            window.open(`https://wa.me/${cleanNumber}?text=${encodeURIComponent(message)}`, '_blank');
                                        }}
                                        title="Send Video Request"
                                    >
                                        <FaWhatsapp className="h-4 w-4" />
                                        <span className="text-xs font-medium">Video Request</span>
                                    </Button>
                                </div>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

// --- Helper Functions ---

function getStatusIndicator(call: CallSummary) {
    if (call.status === 'in-progress' || call.status === 'ringing') {
        return <span className="flex h-3 w-3 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.5)]" title="Live Call" />;
    }

    // Recovered: Missed by VA but handled by AI or Recovered
    const isRecovered = (call.missedReason && call.outcome !== 'no-answer' && call.outcome !== 'voicemail') ||
        call.outcome === 'RECOVERED_FROM_TWILIO';

    if (isRecovered) {
        return <span className="flex h-3 w-3 rounded-full bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.3)]" title="Recovered by AI/System" />;
    }

    // Lost: Explicit failure states
    const isLost = call.outcome === 'NO_ANSWER' ||
        call.outcome === 'VOICEMAIL' ||
        call.outcome === 'FAILED' ||
        call.outcome === 'DROPPED_EARLY' ||
        (!call.outcome && call.status === 'failed'); // e.g. stale calls

    if (isLost) {
        return <span className="flex h-3 w-3 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.3)]" title="Lost / Voicemail" />;
    }

    // Success (Direct Answer or Completed successfully)
    return <span className="flex h-3 w-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]" title="Success / Completed" />;
}

function getRouteBadge(call: CallSummary) {
    // 1. Agent (AI/System) - If there was a missed reason (fallback triggered), 
    // or explicit AI outcome, or recovered status.
    const isAgent =
        call.outcome === 'ELEVEN_LABS' ||
        !!call.missedReason ||
        call.outcome === 'RECOVERED_FROM_TWILIO';

    if (isAgent) {
        if (call.missedReason === 'busy_agent') {
            return <Badge className="bg-amber-600 hover:bg-amber-700 border-amber-500">Agent (Busy)</Badge>;
        }
        if (call.missedReason === 'out_of_hours' || call.missedReason === 'out-of-hours') {
            return <Badge className="bg-indigo-600 hover:bg-indigo-700 border-indigo-500">Agent (OOH)</Badge>;
        }
        return <Badge className="bg-blue-600 hover:bg-blue-700 border-blue-500">Agent</Badge>;
    }

    // 2. Explicit Non-Answered States (Not Agent, Not VA)
    if (call.outcome === 'NO_ANSWER' || call.outcome === 'MISSED_CALL') {
        return <Badge variant="outline" className="text-red-500 border-red-500 bg-red-500/10">Missed</Badge>;
    }

    if (call.outcome === 'VOICEMAIL' || call.outcome === 'VOICEMAIL_LEFT') {
        return <Badge variant="outline" className="text-orange-500 border-orange-500 bg-orange-500/10">Voicemail</Badge>;
    }

    if (call.outcome === 'FAILED' || call.outcome === 'DROPPED_EARLY' || (!call.outcome && call.status === 'failed')) {
        return <Badge variant="outline" className="text-gray-500 border-gray-500 bg-gray-500/10">Failed</Badge>;
    }

    // 3. VA (Human) - Default for direct answers, forwarding, or if it stayed with VA (and was answered/active)
    return <Badge className="bg-green-600 hover:bg-green-700 border-green-500">VA</Badge>;
}

function getOutcomeBadge(call: CallSummary) {
    const outcome = call.outcome?.toUpperCase();

    switch (outcome) {
        case 'SITE_VISIT':
        case 'SITE_VISIT_BOOKED':
            return <Badge className="bg-emerald-500 text-white border-emerald-400 font-bold">Site Visit</Badge>;

        case 'QUOTE_REQUESTED':
        case 'VIDEO_QUOTE':
            return <Badge className="bg-blue-500 text-white border-blue-400 font-bold">Quote Requested</Badge>;

        case 'INSTANT_PRICE':
        case 'INSTANT_PRICE_GIVEN':
            return <Badge className="bg-purple-500 text-white border-purple-400">Instant Price</Badge>;

        case 'MSG_TAKEN':
        case 'MESSAGE_TAKEN':
            return <Badge variant="secondary" className="bg-secondary text-secondary-foreground">Message Taken</Badge>;

        case 'VOICEMAIL':
        case 'VOICEMAIL_LEFT':
            return <Badge variant="outline" className="text-red-400 border-red-500/50 bg-red-500/10">Voicemail</Badge>;

        case 'NO_ANSWER':
        case 'MISSED_CALL':
            return <Badge variant="outline" className="text-red-500 border-red-500 bg-red-500/10 font-bold">Missed</Badge>;

        default:
            return <span className="text-sm text-gray-500">{call.outcome ? call.outcome.replace(/_/g, ' ') : '-'}</span>;
    }
}
