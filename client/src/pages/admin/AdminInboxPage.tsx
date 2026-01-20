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

// Types for People-Centric Threads
interface InboxEvent {
    id: string;
    type: 'call' | 'whatsapp' | 'lead' | 'note';
    summary: string;
    receivedAt: string;
    priority: string;
    suggestion?: string;
    payload?: any;
}

interface InboxThread {
    threadId: string;
    customerName: string;
    phone: string;
    lastActivityAt: string;
    status: 'active' | 'archived';
    items: InboxEvent[];
    suggestion?: string;
    actionPayload?: any; // The "Draft" Action for the thread
}

export default function AdminInboxPage() {
    const [selectedThread, setSelectedThread] = useState<InboxThread | null>(null);
    const [, setLocation] = useLocation();
    const { toast } = useToast();

    // Fix: State for expand/collapse
    const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

    const toggleExpand = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setExpandedItems(prev => ({ ...prev, [id]: !prev[id] }));
    };

    // Fetch Real Data 
    const { data: threads, isLoading } = useQuery({
        queryKey: ['admin-inbox-threads'],
        queryFn: async () => {
            const token = localStorage.getItem('adminToken');
            const headers: Record<string, string> = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const res = await fetch('/api/dashboard/inbox', { headers });

            if (res.status === 401) {
                setLocation('/admin/login');
                throw new Error("Unauthorized");
            }

            if (!res.ok) throw new Error("Failed to fetch inbox");
            return res.json() as Promise<InboxThread[]>;
        },
    });

    const handleAction = (actionType: 'quote' | 'visit' | 'video') => {
        if (!selectedThread) return;

        // Prioritize the Thread's "Top Level" Action Payload
        const payload = selectedThread.actionPayload || {};

        const params = new URLSearchParams({
            customerName: payload.customerName || selectedThread.customerName,
            phone: payload.phone || selectedThread.phone,
            description: payload.description || selectedThread.items[0]?.summary,
            source: payload.source || 'inbox_thread',
            leadId: payload.leadId,
            mode: payload.mode || 'simple'
        });

        // Pass Agentic Tasks if available
        if (payload.tasks) {
            params.set('tasks', JSON.stringify(payload.tasks));
        }

        if (actionType === 'quote') {
            setLocation(`/admin/generate-quote?${params.toString()}`);
        } else if (actionType === 'visit') {
            params.set('mode', 'consultation');
            setLocation(`/admin/generate-quote?${params.toString()}`);
        } else if (actionType === 'video') {
            toast({
                title: "Video Request Sent",
                description: `Request sent to ${selectedThread.phone} via WhatsApp.`
            });
        }
    };

    return (
        <div className="h-[calc(100vh-64px)] flex bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">

            {/* LEFT: The Customers (Threads) */}
            <div className="w-1/3 border-r border-slate-200 flex flex-col">
                <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                    <h2 className="font-bold text-slate-700 flex items-center gap-2">
                        <Inbox className="w-5 h-5" /> All Inbox
                        <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full text-xs">{threads?.length || 0}</span>
                    </h2>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {threads?.map((thread) => (
                        <div
                            key={thread.threadId}
                            onClick={() => setSelectedThread(thread)}
                            className={cn(
                                "p-4 border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors",
                                selectedThread?.threadId === thread.threadId ? "bg-amber-50 border-amber-200" : ""
                            )}
                        >
                            <div className="flex justify-between items-start mb-1">
                                <span className="font-bold text-slate-800 text-sm">{thread.customerName}</span>
                                <span className="text-xs text-slate-400">{format(new Date(thread.lastActivityAt), 'HH:mm')}</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                                {thread.items.length > 1 && <span className="bg-slate-200 px-1.5 rounded">{thread.items.length} events</span>}
                                {thread.suggestion && <span className="text-indigo-600 font-medium">{thread.suggestion}</span>}
                            </div>
                            <p className="text-xs text-slate-400 truncate">{thread.items[0]?.summary}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* RIGHT: The Timeline (Stream) */}
            <div className="flex-1 flex flex-col bg-slate-50/50">
                {selectedThread ? (
                    <div className="flex flex-col h-full">
                        {/* Header */}
                        <div className="p-4 border-b border-slate-200 bg-white flex justify-between items-center">
                            <div>
                                <h1 className="text-xl font-bold text-slate-900">{selectedThread.customerName}</h1>
                                <p className="text-sm text-slate-500">{selectedThread.phone}</p>
                            </div>
                            <button className="text-sm bg-white border border-slate-200 px-3 py-1 rounded hover:bg-slate-50">
                                Log Note
                            </button>
                        </div>

                        {/* Stream Body */}
                        <div className="flex-1 p-6 overflow-y-auto space-y-6">
                            {/* Co-pilot Insight at Top */}
                            {selectedThread.suggestion && (
                                <div className="bg-indigo-50 border border-indigo-100 p-3 rounded-lg flex gap-3 text-sm">
                                    <div className="text-xl">🤖</div>
                                    <div>
                                        <p className="font-bold text-indigo-800">{selectedThread.suggestion}</p>
                                        <p className="text-indigo-600">Based on {selectedThread.items.length} recent interactions.</p>
                                    </div>
                                </div>
                            )}

                            {selectedThread.items.map((item, idx) => (
                                <div key={item.id} className="relative pl-8">
                                    {/* Timeline Line */}
                                    {idx !== selectedThread.items.length - 1 && (
                                        <div className="absolute left-3 top-8 bottom-[-24px] w-0.5 bg-slate-200"></div>
                                    )}

                                    {/* Icon Bubble */}
                                    <div className={`absolute left-0 top-0 w-6 h-6 rounded-full flex items-center justify-center border-2 border-white shadow-sm z-10
                                        ${item.type === 'call' ? 'bg-blue-100 text-blue-600' :
                                            item.type === 'lead' ? 'bg-purple-100 text-purple-600' :
                                                'bg-green-100 text-green-600'}`}>
                                        {item.type === 'call' && <Phone className="w-3 h-3" />}
                                        {item.type === 'lead' && <Globe className="w-3 h-3" />}
                                        {item.type === 'whatsapp' && <MessageSquare className="w-3 h-3" />}
                                    </div>

                                    {/* Content Card */}
                                    <div className="bg-white border border-slate-200 p-3 rounded-lg shadow-sm">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="font-bold text-xs uppercase text-slate-400">{item.type}</span>
                                            <span className="text-xs text-slate-400">{format(new Date(item.receivedAt), 'MMM d, HH:mm')}</span>
                                        </div>
                                        <div className="text-slate-800 text-sm">
                                            {item.type === 'call' && item.payload?.description ? (
                                                <>
                                                    <p className={`${expandedItems[item.id] ? '' : 'line-clamp-3'}`}>
                                                        {item.payload.description}
                                                    </p>
                                                    {item.payload.description.length > 150 && (
                                                        <button
                                                            onClick={(e) => toggleExpand(item.id, e)}
                                                            className="text-xs text-blue-500 hover:text-blue-700 mt-1 font-medium"
                                                        >
                                                            {expandedItems[item.id] ? 'Show Less' : 'Show More'}
                                                        </button>
                                                    )}
                                                </>
                                            ) : (
                                                <p>{item.summary}</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {/* --- AGENT DRAFT IN THE THREAD --- */}
                            {selectedThread.actionPayload?.draftReply && (
                                <div className="relative pl-8 animate-in slide-in-from-bottom-2 duration-300">
                                    <div className="absolute left-3 top-[-24px] bottom-8 w-0.5 bg-dashed bg-emerald-200"></div>
                                    <div className="absolute left-0 top-0 w-6 h-6 rounded-full flex items-center justify-center border-2 border-white shadow-sm z-10 bg-emerald-100 text-emerald-600 animate-pulse">
                                        <div className="text-xs">🤖</div>
                                    </div>

                                    <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-lg shadow-sm">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="font-bold text-xs uppercase text-emerald-600">Proposed Action</span>
                                            <span className="text-xs text-emerald-500">Ready to Send</span>
                                        </div>
                                        <div className="bg-white p-3 rounded border border-emerald-100 italic text-slate-600 text-sm mb-3">
                                            "{selectedThread.actionPayload.draftReply}"
                                        </div>

                                        <button
                                            onClick={() => {
                                                const phone = selectedThread.phone;
                                                const text = selectedThread.actionPayload?.draftReply;
                                                const cleanNumber = phone.replace(/\D/g, '');
                                                const url = `https://web.whatsapp.com/send?phone=${cleanNumber}&text=${encodeURIComponent(text || '')}`;
                                                window.open(url, '_blank');
                                            }}
                                            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 rounded flex items-center justify-center gap-2 transition-colors"
                                        >
                                            <MessageSquare className="w-4 h-4" /> Send Message
                                        </button>
                                    </div>
                                </div>
                            )}

                        </div>

                        <div className="p-4 bg-white border-t border-slate-200 grid grid-cols-2 gap-4">
                            {/* Draft Action moved to thread. Show generics or nothing here? 
                                User asked for "Action as part of thread". 
                                We'll keep generic actions just in case the draft is wrong. */}
                            <button
                                onClick={() => handleAction('quote')}
                                className="bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 font-bold py-3 rounded-lg flex items-center justify-center gap-2"
                            >
                                <DollarSign className="w-5 h-5" /> Quote
                            </button>
                            <button
                                onClick={() => handleAction('visit')}
                                className="bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 font-bold py-3 rounded-lg flex items-center justify-center gap-2"
                            >
                                <Calendar className="w-5 h-5" /> Visit
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400">
                        <User className="w-16 h-16 mb-4 opacity-20" />
                        <p>Select a Thread</p>
                    </div>
                )}
            </div>
        </div>
    );
}
