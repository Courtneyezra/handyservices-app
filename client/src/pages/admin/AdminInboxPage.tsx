import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
    Inbox,
    Phone,
    MessageSquare,
    Globe,
    Clock,
    CheckCircle,
    XCircle,
    ArrowRight,
    User,
    Calendar,
    DollarSign,
    Video
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

// Types for our unified inbox items
interface InboxItem {
    id: string;
    type: 'call' | 'whatsapp' | 'web_form' | 'ai_lead';
    customerName: string;
    phone: string;
    summary: string;
    receivedAt: string;
    status: 'new' | 'triaged' | 'archived';
    priority: 'high' | 'normal' | 'low';
    suggestion?: string;
    transcription?: string;
    recordingUrl?: string;
}

// Mock Data for Prototype (Will replace with real API call next)
const MOCK_INBOX_ITEMS: InboxItem[] = [
    {
        id: '1',
        type: 'web_form',
        customerName: 'Sarah Jenkins',
        phone: '+44 7700 900123',
        summary: 'Inquiry about bathroom tiling. Needs quote ASAP.',
        receivedAt: new Date().toISOString(),
        status: 'new',
        priority: 'high'
    },
    {
        id: '2',
        type: 'whatsapp',
        customerName: 'Mike Ross',
        phone: '+44 7700 900456',
        summary: 'Can you fix a leaking tap in Derby?',
        receivedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 mins ago
        status: 'new',
        priority: 'normal'
    },
    {
        id: '3',
        type: 'call',
        customerName: 'Unknown Caller',
        phone: '+44 7700 900789',
        summary: 'Missed call. Voicemail transcript: "Hi, looking for someone to assemble ikea furniture."',
        receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2 hours ago
        status: 'new',
        priority: 'low'
    }
];

export default function AdminInboxPage() {
    const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
    const [, setLocation] = useLocation();
    const { toast } = useToast();

    // Fetch Real Data from our new Orchestration Endpoint
    const { data: inboxItems, isLoading } = useQuery({
        queryKey: ['admin-inbox'],
        queryFn: async () => {
            const res = await fetch('/api/dashboard/inbox');
            if (!res.ok) throw new Error("Failed to fetch inbox");
            return res.json() as Promise<InboxItem[]>;
        },
    });

    const handleAction = (action: 'quote' | 'visit' | 'video') => {
        if (!selectedItem) return;

        // Carry data over to the next step
        const params = new URLSearchParams({
            customerName: selectedItem.customerName,
            phone: selectedItem.phone,
            description: selectedItem.summary,
            source: 'inbox_triage',
            leadId: selectedItem.id
        });

        if (action === 'quote') {
            setLocation(`/admin/generate-quote?${params.toString()}`);
        } else if (action === 'visit') {
            // For admin, booking a visit usually means sending a link or assigning.
            // For now, let's route to Generate Quote with consultation mode? 
            // Or maybe a dedicated booking modal. 
            // Integrating with existing "Generate Link" flow for now.
            params.set('mode', 'consultation');
            setLocation(`/admin/generate-quote?${params.toString()}`);
        } else if (action === 'video') {
            // Placeholder for video request
            toast({
                title: "Video Request Sent",
                description: `Request sent to ${selectedItem.phone} via WhatsApp.`
            });
        }
    };

    return (
        <div className="h-[calc(100vh-64px)] flex bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">

            {/* Left Panel: The Stream */}
            <div className="w-1/3 border-r border-slate-200 flex flex-col">
                <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                    <h2 className="font-bold text-slate-700 flex items-center gap-2">
                        <Inbox className="w-5 h-5" /> Inbox
                        <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full text-xs">{inboxItems?.length || 0}</span>
                    </h2>
                    {/* Filter controls could go here */}
                </div>
                <div className="flex-1 overflow-y-auto">
                    {inboxItems?.map((item) => (
                        <div
                            key={item.id}
                            onClick={() => setSelectedItem(item)}
                            className={cn(
                                "p-4 border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors",
                                selectedItem?.id === item.id ? "bg-amber-50 border-amber-200" : ""
                            )}
                        >
                            <div className="flex justify-between items-start mb-1">
                                <div className="flex items-center gap-2">
                                    {item.type === 'call' && <div className="bg-blue-100 p-1 rounded"><Phone className="w-3 h-3 text-blue-600" /></div>}
                                    {item.type === 'whatsapp' && <MessageSquare className="w-3 h-3 text-green-600" />}
                                    {item.type === 'web_form' && <Globe className="w-3 h-3 text-purple-600" />}
                                    <span className="font-bold text-slate-800 text-sm">{item.customerName}</span>
                                </div>
                                <span className="text-xs text-slate-400">{format(new Date(item.receivedAt), 'HH:mm')}</span>
                            </div>
                            <p className="text-sm text-slate-600 line-clamp-2">{item.summary}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Middle & Right: Context & Action (Unified for now due to space, or split 2/3) */}
            <div className="flex-1 flex flex-col bg-slate-50/50">
                {selectedItem ? (
                    <div className="flex flex-col h-full">
                        {/* Header */}
                        <div className="p-6 border-b border-slate-200 bg-white">
                            <div className="flex justify-between items-start">
                                <div>
                                    <h1 className="text-2xl font-bold text-slate-900 mb-1">{selectedItem.customerName}</h1>
                                    <div className="flex items-center gap-4 text-sm text-slate-500">
                                        <span className="flex items-center gap-1"><Phone className="w-4 h-4" /> {selectedItem.phone}</span>
                                        <span className="flex items-center gap-1"><Clock className="w-4 h-4" /> Received {format(new Date(selectedItem.receivedAt), 'PPp')}</span>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button className="px-3 py-1.5 border border-slate-200 rounded text-sm font-medium hover:bg-slate-50">Archive</button>
                                </div>
                            </div>
                        </div>

                        {/* Content Body */}
                        <div className="flex-1 p-6 overflow-y-auto">
                            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm mb-6">
                                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Request Summary</h3>
                                <p className="text-lg text-slate-800 leading-relaxed">
                                    {selectedItem.summary}
                                </p>
                            </div>

                            {/* AI Analysis (Mock) */}
                            {/* Co-pilot Analysis (D.O.E Orchestration) */}
                            {selectedItem.suggestion && (
                                <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-100 flex gap-3 text-sm text-indigo-800">
                                    <div className="mt-0.5">✨</div>
                                    <div>
                                        <span className="font-bold">Co-pilot Suggestion:</span> {selectedItem.suggestion}
                                        <div className="mt-1 text-xs opacity-75">
                                            Based on analysis of {selectedItem.type === 'call' ? 'call transcript' : 'submission'}.
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Action Bar (Bottom) */}
                        <div className="p-6 bg-white border-t border-slate-200">
                            <h3 className="text-sm font-bold text-slate-900 mb-3">Triage Action</h3>
                            <div className="grid grid-cols-3 gap-4">
                                <button
                                    onClick={() => handleAction('visit')}
                                    className="flex flex-col items-center justify-center p-4 rounded-xl border-2 border-slate-100 hover:border-amber-400 hover:bg-amber-50 transition-all group"
                                >
                                    <Calendar className="w-6 h-6 text-slate-400 group-hover:text-amber-600 mb-2" />
                                    <span className="font-bold text-slate-700 group-hover:text-amber-700">Book Visit</span>
                                    <span className="text-xs text-slate-400 text-center mt-1">Send booking link for diagnostic</span>
                                </button>

                                <button
                                    onClick={() => handleAction('quote')}
                                    className="flex flex-col items-center justify-center p-4 rounded-xl border-2 border-slate-100 hover:border-emerald-400 hover:bg-emerald-50 transition-all group"
                                >
                                    <DollarSign className="w-6 h-6 text-slate-400 group-hover:text-emerald-600 mb-2" />
                                    <span className="font-bold text-slate-700 group-hover:text-emerald-700">Create Quote</span>
                                    <span className="text-xs text-slate-400 text-center mt-1">Send instant price estimator</span>
                                </button>

                                <button
                                    onClick={() => handleAction('video')}
                                    className="flex flex-col items-center justify-center p-4 rounded-xl border-2 border-slate-100 hover:border-blue-400 hover:bg-blue-50 transition-all group"
                                >
                                    <Video className="w-6 h-6 text-slate-400 group-hover:text-blue-600 mb-2" />
                                    <span className="font-bold text-slate-700 group-hover:text-blue-700">Request Video</span>
                                    <span className="text-xs text-slate-400 text-center mt-1">Ask customer for a video</span>
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400">
                        <Inbox className="w-16 h-16 mb-4 opacity-20" />
                        <p>Select an item from the inbox to triage</p>
                    </div>
                )}
            </div>
        </div>
    );
}
