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

export interface CallSummary {
    id: string;
    callId: string;
    customerName: string;
    phoneNumber: string;
    address: string | null;
    startTime: string;
    duration: number | null;
    skuCount: number;
    totalPricePence: number;
    outcome: string | null;
    urgency: string | null;
    status: string;
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
                        <TableHead>Date & Time</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Outcome</TableHead>
                        <TableHead>SKUs</TableHead>
                        <TableHead className="text-right">Total Value</TableHead>
                        <TableHead className="w-[50px]"></TableHead>
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
                                <div className="font-medium">{call.customerName || "Unknown Caller"}</div>
                                <div className="text-sm text-muted-foreground flex items-center gap-1">
                                    <Phone className="h-3 w-3" />
                                    <span
                                        className="hover:text-green-600 hover:underline cursor-pointer flex items-center gap-1 transition-colors"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            const cleanNumber = call.phoneNumber.replace(/\D/g, '');
                                            setLocation(`/whatsapp-intake?phone=${cleanNumber}`);
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
                            <TableCell>
                                <div className="flex flex-col">
                                    <span className="text-sm">
                                        {format(new Date(call.startTime), "MMM d, yyyy")}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        {format(new Date(call.startTime), "h:mm a")}
                                    </span>
                                </div>
                            </TableCell>
                            <TableCell>
                                {call.duration ? (
                                    <div className="flex items-center gap-1 text-sm">
                                        <Clock className="h-3 w-3" />
                                        {Math.floor(call.duration / 60)}m {call.duration % 60}s
                                    </div>
                                ) : (
                                    <Badge variant="outline">On-going</Badge>
                                )}
                            </TableCell>
                            <TableCell>
                                {getOutcomeBadge(call.outcome)}
                            </TableCell>
                            <TableCell>
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

function getOutcomeBadge(outcome: string | null) {
    switch (outcome) {
        case 'INSTANT_PRICE':
            return <Badge className="bg-emerald-500">Instant Price</Badge>;
        case 'VIDEO_QUOTE':
            return <Badge className="bg-blue-500">Video Quote</Badge>;
        case 'SITE_VISIT':
            return <Badge className="bg-purple-500">Site Visit</Badge>;
        case 'NO_ANSWER':
        case 'VOICEMAIL':
            return <Badge variant="outline" className="text-yellow-600 border-yellow-600">Missed</Badge>;
        default:
            return <Badge variant="secondary">Unknown</Badge>;
    }
}
