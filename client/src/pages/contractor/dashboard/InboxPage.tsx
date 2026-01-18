import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare, Phone, Globe, Mic, Calendar, DollarSign, Video, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";

// Mock Data for MVP (Will connect to API later)
const MOCK_INBOX_ITEMS = [
    {
        id: "lead_123",
        type: "form",
        source: "Web Form",
        customerName: "Alice Smith",
        summary: "Need a leaking tap fixed in the kitchen.",
        timestamp: new Date(Date.now() - 1000 * 60 * 30), // 30 mins ago
        status: "new",
        phone: "07700900123"
    },
    {
        id: "call_456",
        type: "call",
        source: "Missed Call",
        customerName: "Unknown Caller",
        summary: "No voicemail left.",
        timestamp: new Date(Date.now() - 1000 * 60 * 120), // 2 hours ago
        status: "new",
        phone: "07700900456"
    },
    {
        id: "wa_789",
        type: "whatsapp",
        source: "WhatsApp",
        customerName: "Bob Jones",
        summary: "Hi, do you do painting? I have a hallway that needs doing.",
        timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24), // 1 day ago
        status: "new",
        phone: "07700900789"
    }
];

export default function InboxPage() {
    const [, setLocation] = useLocation();
    const [selectedItem, setSelectedItem] = useState<any>(null);

    const inboxItems = MOCK_INBOX_ITEMS;

    const handleAction = (action: 'book' | 'quote' | 'video') => {
        if (!selectedItem) return;

        // Logic to carry-over data
        const queryParams = new URLSearchParams({
            customerName: selectedItem.customerName || '',
            phone: selectedItem.phone || '',
            description: selectedItem.summary || '',
            source: 'inbox'
        }).toString();

        if (action === 'book') {
            // Diagnostic Visit -> Quote Mode 'consultation'
            setLocation(`/contractor/dashboard/quotes/new?mode=consultation&${queryParams}`);
        } else if (action === 'quote') {
            // Instant Price -> Quote Mode 'simple' or 'hhh'
            setLocation(`/contractor/dashboard/quotes/new?mode=simple&${queryParams}`);
        } else if (action === 'video') {
            // Video Request - placeholder for now, maybe send a link
            console.log("Send video request to", selectedItem.phone);
        }
    };

    return (
        <div className="h-[calc(100vh-6rem)] grid grid-cols-12 gap-6">
            {/* LEFT PANE: Stream */}
            <div className="col-span-4 bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col">
                <div className="p-4 border-b border-slate-100 bg-slate-50">
                    <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                        <InboxIcon className="w-5 h-5" /> Inbox
                        <Badge variant="secondary" className="ml-auto bg-amber-100 text-amber-800">
                            {inboxItems.length} New
                        </Badge>
                    </h2>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {inboxItems.map((item) => (
                        <div
                            key={item.id}
                            onClick={() => setSelectedItem(item)}
                            className={`p-4 border-b border-slate-50 cursor-pointer hover:bg-slate-50 transition-colors ${selectedItem?.id === item.id ? "bg-amber-50 border-amber-200" : ""
                                }`}
                        >
                            <div className="flex justify-between items-start mb-1">
                                <span className="font-medium text-slate-900">{item.customerName}</span>
                                <span className="text-xs text-slate-400">
                                    {formatDistanceToNow(item.timestamp, { addSuffix: true })}
                                </span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                                <SourceIcon type={item.type} />
                                {item.source}
                            </div>
                            <p className="text-sm text-slate-600 line-clamp-2">
                                {item.summary}
                            </p>
                        </div>
                    ))}
                </div>
            </div>

            {/* RIGHT PANE: Context & Actions */}
            <div className="col-span-8 flex flex-col gap-6">
                {selectedItem ? (
                    <>
                        {/* Context Card */}
                        <Card className="flex-1 border-slate-200 shadow-sm">
                            <CardHeader className="bg-slate-50 border-b border-slate-100 pb-4">
                                <div className="flex justify-between items-center">
                                    <div>
                                        <CardTitle className="text-lg">{selectedItem.customerName}</CardTitle>
                                        <CardDescription className="flex items-center gap-2 mt-1">
                                            <Phone className="w-3 h-3" /> {selectedItem.phone}
                                        </CardDescription>
                                    </div>
                                    <Badge variant="outline" className="capitalize">{selectedItem.type}</Badge>
                                </div>
                            </CardHeader>
                            <CardContent className="p-6">
                                <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
                                    Summary / Transcript
                                </h3>
                                <div className="bg-slate-50 p-4 rounded-lg text-slate-700 leading-relaxed border border-slate-100">
                                    {selectedItem.summary}
                                </div>
                            </CardContent>
                        </Card>

                        {/* Action Triage Panel */}
                        <Card className="border-slate-200 bg-slate-900 text-white shadow-lg">
                            <CardHeader>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <CheckCircle2 className="w-5 h-5 text-green-400" />
                                    Triage Decision
                                </CardTitle>
                                <CardDescription className="text-slate-400">
                                    Choose the next step for this lead.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="grid grid-cols-3 gap-4">
                                <Button
                                    onClick={() => handleAction('book')}
                                    variant="outline"
                                    className="h-24 flex flex-col gap-2 border-slate-700 hover:bg-slate-800 hover:text-white"
                                >
                                    <Calendar className="w-8 h-8 text-amber-500" />
                                    <span>Book Visit</span>
                                    <span className="text-xs text-slate-400 font-normal">Send Diagnostic Link</span>
                                </Button>

                                <Button
                                    onClick={() => handleAction('quote')}
                                    variant="outline"
                                    className="h-24 flex flex-col gap-2 border-slate-700 hover:bg-slate-800 hover:text-white"
                                >
                                    <DollarSign className="w-8 h-8 text-emerald-500" />
                                    <span>Instant Price</span>
                                    <span className="text-xs text-slate-400 font-normal">Send Quote Link</span>
                                </Button>

                                <Button
                                    onClick={() => handleAction('video')}
                                    variant="outline"
                                    className="h-24 flex flex-col gap-2 border-slate-700 hover:bg-slate-800 hover:text-white"
                                >
                                    <Video className="w-8 h-8 text-blue-500" />
                                    <span>Request Video</span>
                                    <span className="text-xs text-slate-400 font-normal">Get more info</span>
                                </Button>
                            </CardContent>
                        </Card>
                    </>
                ) : (
                    <div className="h-full flex items-center justify-center text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                        <div className="text-center">
                            <InboxIcon className="w-12 h-12 mx-auto mb-3 opacity-20" />
                            <p>Select an item from the inbox to triage</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// Helper Components
function InboxIcon({ className }: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
            <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline>
            <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path>
        </svg>
    )
}

function SourceIcon({ type }: { type: string }) {
    const cn = "w-4 h-4";
    switch (type) {
        case 'whatsapp': return <MessageSquare className={cn + " text-green-600"} />;
        case 'call': return <Phone className={cn + " text-red-500"} />;
        case 'form': return <Globe className={cn + " text-blue-500"} />;
        case 'ai': return <Mic className={cn + " text-purple-600"} />;
        default: return <MessageSquare className={cn} />;
    }
}
