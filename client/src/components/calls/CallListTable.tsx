import React from "react";
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
import { Phone, Clock, Calendar, ChevronRight, PoundSterling } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import { format } from "date-fns";
import { useLocation } from "wouter";

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
    metadataJson: any; // Added metadataJson
}

interface CallListTableProps {
    calls: CallSummary[];
    isLoading: boolean;
    onCallClick: (callId: string) => void;
}

export function CallListTable({ calls, isLoading, onCallClick }: CallListTableProps) {
    const [, setLocation] = useLocation();

    if (isLoading) {
        return <div className="p-8 text-center">Loading calls...</div>;
    }

    if (calls.length === 0) {
        return <div className="p-8 text-center text-muted-foreground">No calls found matching your filters.</div>;
    }

    return (
        <div className="rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Customer</TableHead>
                        <TableHead className="hidden sm:table-cell">Date & Time</TableHead>
                        <TableHead className="hidden md:table-cell">Job</TableHead>
                        <TableHead>Outcome</TableHead>
                        <TableHead className="hidden lg:table-cell">SKUs</TableHead>
                        <TableHead className="text-right">Total Value</TableHead>
                        <TableHead className="w-[40px]"></TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {calls.map((call) => (
                        <TableRow
                            key={call.id}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => onCallClick(call.id)}
                        >
                            <TableCell>
                                <div onClick={(e) => e.stopPropagation()}>
                                    <NameCorrection
                                        callId={call.id}
                                        currentName={call.customerName}
                                        metadataJson={call.metadataJson}
                                    />
                                </div>
                                <div className="text-sm text-muted-foreground flex items-center gap-1">
                                    <Phone className="h-3 w-3" />
                                    <span
                                        className="hover:text-green-600 hover:underline cursor-pointer flex items-center gap-1 transition-colors"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            const cleanNumber = call.phoneNumber.replace(/\D/g, '');
                                            setLocation(`/admin/whatsapp-intake?phone=${cleanNumber}`);
                                        }}
                                        title="Open in WhatsApp CRM"
                                    >
                                        {call.phoneNumber} <FaWhatsapp className="h-3 w-3" />
                                    </span>
                                </div>
                                {call.address && (
                                    <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                                        {call.address}
                                    </div>
                                )}
                            </TableCell>
                            <TableCell className="hidden sm:table-cell">
                                <div className="flex flex-col">
                                    <span className="text-sm">
                                        {format(new Date(call.startTime), "MMM d, yyyy")}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        {format(new Date(call.startTime), "h:mm a")}
                                    </span>
                                </div>
                            </TableCell>
                            <TableCell className="hidden md:table-cell">
                                <div className="text-sm truncate max-w-[150px]" title={call.jobSummary || "No summary"}>
                                    {call.jobSummary || <span className="text-muted-foreground italic">Pending...</span>}
                                </div>
                            </TableCell>
                            <TableCell>
                                {getOutcomeBadge(call.outcome, call.status, call.startTime)}
                            </TableCell>
                            <TableCell className="hidden lg:table-cell">
                                {call.skuCount > 0 ? (
                                    <Badge variant="secondary">
                                        {call.skuCount} SKU{call.skuCount !== 1 ? 's' : ''}
                                    </Badge>
                                ) : (
                                    <span className="text-muted-foreground text-sm">-</span>
                                )}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                                {call.totalPricePence > 0 ? (
                                    <span className="text-emerald-600">
                                        £{(call.totalPricePence / 100).toFixed(2)}
                                    </span>
                                ) : (
                                    <span className="text-muted-foreground">-</span>
                                )}
                            </TableCell>
                            <TableCell>
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

function getOutcomeBadge(outcome: string | null, status: string, startTime: string) {
    // Normalise to uppercase for comparison
    const upperOutcome = outcome?.toUpperCase();

    // 1. Check explicit outcomes first
    switch (upperOutcome) {
        case 'INSTANT_PRICE':
            return <Badge className="bg-emerald-500">Instant Price</Badge>;
        case 'VIDEO_QUOTE':
            return <Badge className="bg-blue-500">Video Quote</Badge>;
        case 'SITE_VISIT':
            return <Badge className="bg-purple-500">Site Visit</Badge>;

        // Missed / Dropped cases
        case 'NO_ANSWER':
        case 'NO-ANSWER':
        case 'VOICEMAIL':
        case 'BUSY':
        case 'FAILED':
        case 'CANCELED':
            return <Badge variant="outline" className="text-red-500 border-red-500 bg-red-50">Missed Call</Badge>;

        case 'DROPPED_EARLY':
            return <Badge variant="outline" className="text-orange-500 border-orange-500 bg-orange-50">Dropped Early</Badge>;

        case 'RECOVERED_FROM_TWILIO':
        case 'COMPLETED_BUT_MISSING':
            return <Badge variant="outline" className="text-slate-500 border-slate-500">Recovered</Badge>;
    }

    // 2. Handle cases where outcome is null/unknown (e.g. freshly created calls)
    if (status === 'ringing' || status === 'in-progress') {
        // Check if it's stale (older than 5 minutes)
        const isStale = new Date().getTime() - new Date(startTime).getTime() > 5 * 60 * 1000;

        if (isStale) {
            return <Badge variant="outline" className="text-orange-500 border-orange-500 bg-orange-50">Dropped Early</Badge>;
        }

        // Active call
        return <Badge className="bg-green-500 animate-pulse">Ringing...</Badge>;
    }

    return <Badge variant="secondary">{outcome || "Unknown"}</Badge>;
}
