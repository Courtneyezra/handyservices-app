import React, { useEffect, useState, useRef, useMemo } from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface WhatsAppMessage {
    id: string;
    from: string;
    to?: string;
    fromMe: boolean;
    senderName: string;
    body: string;
    timestamp: number;
    transcription?: string;
    analysis?: {
        sku: {
            name: string;
            id?: string;
        } | string;
        confidence: number;
    };
    type: string;
    media?: {
        data: string;
        mimetype: string;
    };
    avatarUrl?: string;
}

export default function WhatsAppIntake() {
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [isReady, setIsReady] = useState(false);
    const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
    const [status, setStatus] = useState<string>('Connecting...');

    const wsRef = useRef<WebSocket | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    type ChatRole = 'lead' | 'handyman';
    type FunnelStage = 'inbound' | 'ascertaining' | 'decision' | 'actioned';
    const [chatMetadata, setChatMetadata] = useState<Record<string, { role: ChatRole, stage: FunnelStage, name?: string, assignedHandymanId?: string }>>({});

    useEffect(() => {
        // Connect to WebSocket
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/ws/client`;

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            console.log('Connected to WhatsApp Backend WS');
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'whatsapp:initializing') {
                    setStatus('Initializing WhatsApp...');
                } else if (msg.type === 'whatsapp:qr') {
                    setQrCode(msg.data);
                    setIsReady(false);
                    setStatus('Waiting for Scan');
                } else if (msg.type === 'whatsapp:loading') {
                    setStatus(`Loading: ${msg.data.percent}%`);
                } else if (msg.type === 'whatsapp:ready') {
                    setIsReady(true);
                    setQrCode(null);
                    setStatus('Connected');
                } else if (msg.type === 'whatsapp:message') {
                    setMessages(prev => {
                        if (prev.find(m => m.id === msg.data.id)) return prev;
                        return [...prev, msg.data];
                    });
                } else if (msg.type === 'whatsapp:history') {
                    setMessages(msg.data);
                } else if (msg.type === 'whatsapp:metadata') {
                    setChatMetadata(msg.data);
                } else if (msg.type === 'whatsapp:diagnostic') {
                    if (msg.data.status) setStatus(msg.data.status);
                }
            } catch (e) {
                console.error('WS Parse Error', e);
            }
        };

        ws.onclose = () => {
            setStatus('Disconnected from Server');
        };

        return () => {
            ws.close();
        };
    }, []);

    const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'chat' | 'board'>('chat');
    const [inputText, setInputText] = useState('');
    const [dataChecklist, setDataChecklist] = useState<Record<string, { postcode: boolean, photos: boolean, sku: boolean }>>({});

    const updateStage = (chatId: string, stage: FunnelStage) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                type: 'whatsapp:set_metadata',
                data: { chatId, updates: { stage } }
            }));
        }
    };

    const updateRole = (chatId: string, role: ChatRole) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                type: 'whatsapp:set_metadata',
                data: { chatId, updates: { role } }
            }));
        }
    };

    const updateName = (chatId: string, name: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                type: 'whatsapp:set_metadata',
                data: { chatId, updates: { name } }
            }));
        }
    };

    const updateAssignment = (chatId: string, handymanId: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                type: 'whatsapp:set_metadata',
                data: { chatId, updates: { assignedHandymanId: handymanId } }
            }));
        }
    };

    const quickReplies = [
        "Hey! How can I help with your project today? 👋",
        "Could you please send over a few photos of the job? 📸",
        "What's your postcode for a site visit estimate? 📍",
        "I'm generating an instant price for you now... ⏳",
        "Just send us a short video and we can take a look straight away 🛠️"
    ];

    const sendMessage = (body: string) => {
        if (!selectedChatId || !wsRef.current || !body.trim()) return;

        const payload = JSON.stringify({
            type: 'whatsapp:send',
            data: { to: selectedChatId, body }
        });

        wsRef.current.send(payload);
        setInputText('');
    };

    const getWaitTime = (timestamp: number) => {
        const diffMs = Date.now() - (timestamp * 1000);
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 1) return 'now';
        if (diffMins < 60) return `${diffMins}m`;
        return `${Math.floor(diffMins / 60)}h`;
    };

    const chatGroups = messages.reduce((acc: Record<string, { id: string, name: string, lastMsg: string, time: number, unread?: boolean, avatarUrl?: string }>, msg) => {
        const chatId = msg.fromMe ? msg.to : msg.from;
        if (!chatId) return acc;

        if (!acc[chatId] || msg.timestamp > acc[chatId].time) {
            const metadata = chatMetadata[chatId];
            acc[chatId] = {
                id: chatId,
                name: metadata?.name || (msg.fromMe ? 'You' : (msg.senderName || chatId.split('@')[0])),
                lastMsg: msg.body?.substring(0, 40) || (msg.type === 'ptt' ? '🎤 Voice Note' : ''),
                time: msg.timestamp,
                avatarUrl: msg.avatarUrl
            };
        }
        return acc;
    }, {});

    const sortedChats = Object.values(chatGroups).sort((a, b) => b.time - a.time);
    const leadsList = useMemo(() => sortedChats.filter(c => (chatMetadata[c.id]?.role || 'lead') === 'lead'), [sortedChats, chatMetadata]);
    const handymenList = useMemo(() => sortedChats.filter(c => chatMetadata[c.id]?.role === 'handyman'), [sortedChats, chatMetadata]);

    const filteredMessages = selectedChatId
        ? messages.filter(m => (m.fromMe ? m.to : m.from) === selectedChatId)
        : [];
    const currentMetadata = selectedChatId ? (chatMetadata[selectedChatId] || { role: 'lead', stage: 'inbound' }) : { role: 'lead' as ChatRole, stage: 'inbound' as FunnelStage };
    const currentStage = currentMetadata.stage;
    const currentRole = currentMetadata.role;

    // Handle URL parameters for pre-filling message and selecting chat
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const phone = params.get('phone');
        const message = params.get('message');

        if (phone) {
            // Find the chat ID that matches the phone number
            const matchingChat = Object.values(chatGroups).find(chat =>
                chat.id.includes(phone.replace(/\+/g, '').replace(/@.*/, ''))
            );

            if (matchingChat) {
                setSelectedChatId(matchingChat.id);
                if (message) setInputText(decodeURIComponent(message));
                setViewMode('chat');
                // Clear URL parameters after processing
                window.history.replaceState({}, '', '/whatsapp-intake');
            } else {
                // If chat not found, construct a synthetic ID and select it
                const syntheticId = `${phone.replace(/\+/g, '')}@c.us`;
                setSelectedChatId(syntheticId);
                if (message) setInputText(decodeURIComponent(message));
                setViewMode('chat');
                // Clear URL parameters after processing
                window.history.replaceState({}, '', '/whatsapp-intake');
            }
        }
    }, [messages, chatGroups]);
    // Re-run when messages update to find the chat

    useEffect(() => {
        if (!selectedChatId && sortedChats.length > 0) {
            setSelectedChatId(sortedChats[0].id);
        }
    }, [sortedChats, selectedChatId]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [filteredMessages]);

    const formatTime = (ts: any) => {
        if (!ts) return '';
        return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="min-h-screen bg-gray-50 font-sans">
            <div className="max-w-[1600px] mx-auto h-screen flex flex-col p-4 md:p-6 lg:p-8">
                {/* Header Section */}
                <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center space-x-4">
                        <div className="bg-indigo-600 p-2 rounded-xl shadow-lg shadow-indigo-200">
                            <span className="text-white text-xl">⚡</span>
                        </div>
                        <div>
                            <h1 className="text-2xl font-black text-gray-900 tracking-tight uppercase">Switchboard CRM</h1>
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest leading-none">WhatsApp Live Intake</p>
                        </div>
                    </div>
                    <div className="flex items-center space-x-6">
                        {(isReady || sortedChats.length > 0) && (
                            <div className="flex bg-gray-100 p-1 rounded-xl border border-gray-200">
                                <button onClick={() => setViewMode('chat')} className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${viewMode === 'chat' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>💬 Chat</button>
                                <button onClick={() => setViewMode('board')} className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${viewMode === 'board' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>📊 Board</button>
                            </div>
                        )}
                        <div className="flex items-center space-x-2">
                            <div className={`w-2 h-2 rounded-full ${isReady ? 'bg-green-500 animate-pulse' : status.includes('Waiting') ? 'bg-amber-500' : 'bg-blue-500 animate-pulse'}`} />
                            <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 truncate max-w-[200px]">{status}</span>
                        </div>
                    </div>
                </div>

                {/* Main Content Area */}
                {!isReady && qrCode && sortedChats.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden border border-gray-100 p-1">
                            <div className="p-8 text-center text-gray-900">
                                <h3 className="text-2xl font-black uppercase tracking-tighter">Connection Required</h3>
                                <p className="text-sm text-gray-400 mt-2 font-medium">Link your WhatsApp account</p>
                            </div>
                            <div className="p-10 bg-gray-50/50 rounded-2xl flex flex-col items-center space-y-8">
                                <div className="bg-white p-8 rounded-[2rem] shadow-xl border border-gray-50">
                                    <QRCodeSVG value={qrCode} size={240} />
                                </div>
                                <div className="text-[10px] text-gray-400 font-black uppercase tracking-widest flex items-center space-x-2">
                                    <span className="w-2 h-2 rounded-full bg-indigo-500 animate-ping" />
                                    <span>Waiting for scan...</span>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (isReady || sortedChats.length > 0) ? (
                    viewMode === 'board' ? (
                        <div className="flex-1 grid grid-cols-4 gap-6 overflow-hidden pb-4">
                            {(['inbound', 'ascertaining', 'decision', 'actioned'] as FunnelStage[]).map(stageKey => {
                                const stageChats = leadsList.filter((c: any) => (chatMetadata[c.id]?.stage || 'inbound') === stageKey);
                                const stageMeta = {
                                    inbound: { label: 'Inbound', icon: '🚨' },
                                    ascertaining: { label: 'Ascertaining', icon: '💬' },
                                    decision: { label: 'Decision', icon: '⚖️' },
                                    actioned: { label: 'Actioned', icon: '✅' }
                                }[stageKey];

                                return (
                                    <div key={stageKey} className="flex flex-col space-y-4 min-w-0">
                                        <div className="flex items-baseline justify-between px-2">
                                            <div className="flex items-center space-x-2">
                                                <span className="text-sm">{stageMeta.icon}</span>
                                                <h3 className="text-xs font-black uppercase tracking-widest text-gray-900">{stageMeta.label}</h3>
                                            </div>
                                            <span className="text-[10px] font-black text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{stageChats.length}</span>
                                        </div>
                                        <div className="flex-1 bg-gray-100/50 rounded-3xl p-4 space-y-3 overflow-y-auto border border-gray-100">
                                            {stageChats.map(chat => (
                                                <div
                                                    key={chat.id}
                                                    onClick={() => { setSelectedChatId(chat.id); setViewMode('chat'); }}
                                                    className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 cursor-pointer hover:shadow-md hover:-translate-y-1 transition-all group"
                                                >
                                                    <div className="flex justify-between items-start mb-2">
                                                        <span className="font-bold text-sm text-gray-900 truncate pr-2">{chat.name}</span>
                                                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded uppercase bg-indigo-50 text-indigo-400">Lead</span>
                                                    </div>
                                                    <p className="text-[11px] text-gray-400 line-clamp-2 mb-3">{chat.lastMsg}</p>
                                                    <div className="flex items-center justify-between border-t border-gray-50 pt-2">
                                                        <div className="flex space-x-1">
                                                            <div className={`w-1.5 h-1.5 rounded-full ${dataChecklist[chat.id]?.postcode ? 'bg-green-500' : 'bg-gray-200'}`} />
                                                            <div className={`w-1.5 h-1.5 rounded-full ${dataChecklist[chat.id]?.photos ? 'bg-green-500' : 'bg-gray-200'}`} />
                                                            <div className={`w-1.5 h-1.5 rounded-full ${dataChecklist[chat.id]?.sku ? 'bg-green-500' : 'bg-gray-200'}`} />
                                                        </div>
                                                        <span className="text-[8px] font-black text-indigo-400 uppercase opacity-0 group-hover:opacity-100">Open →</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="flex-1 flex overflow-hidden bg-white rounded-3xl shadow-2xl border border-gray-100">
                            {/* Left Sidebar: Leads */}
                            <div className="w-64 lg:w-72 border-r border-gray-100 flex flex-col bg-gray-50/10">
                                <div className="p-4">
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
                                        <input type="text" placeholder="Leads..." className="w-full bg-gray-50 border border-gray-200 rounded-xl px-8 py-2 text-xs focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-gray-400" />
                                    </div>
                                </div>
                                <div className="flex-1 overflow-y-auto pb-4">
                                    <div className="px-4 mb-2">
                                        <h5 className="text-[9px] font-black uppercase tracking-widest text-indigo-400">Customers ({leadsList.length})</h5>
                                    </div>
                                    {leadsList.map((chat: any) => (
                                        <button
                                            key={chat.id}
                                            onClick={() => setSelectedChatId(chat.id)}
                                            className={`w-full p-3 flex items-center space-x-3 transition-all relative border-l-4 ${selectedChatId === chat.id ? 'bg-indigo-50/40 border-indigo-600' : 'border-transparent hover:bg-white/60'}`}
                                        >
                                            {chat.avatarUrl ? (
                                                <img src={chat.avatarUrl} className="w-10 h-10 rounded-xl object-cover border border-indigo-100" alt={chat.name} />
                                            ) : (
                                                <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 font-black text-xs">{chat.name.substring(0, 1)}</div>
                                            )}
                                            <div className="flex-1 text-left min-w-0">
                                                <div className="flex justify-between items-center mb-0.5">
                                                    <h4 className="font-bold text-[12px] text-gray-900 truncate">{chat.name}</h4>
                                                </div>
                                                <p className="text-[10px] text-gray-400 truncate">{chat.lastMsg}</p>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Center Column: Chat Content */}
                            <div className="flex-1 flex flex-col min-w-0 border-r border-gray-100">
                                {selectedChatId ? (
                                    <>
                                        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-white">
                                            <div className="flex items-center space-x-3">
                                                {sortedChats.find(c => c.id === selectedChatId)?.avatarUrl ? (
                                                    <img src={sortedChats.find(c => c.id === selectedChatId)?.avatarUrl} className="w-10 h-10 rounded-full object-cover border border-gray-100" alt="Avatar" />
                                                ) : (
                                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm ${currentRole === 'handyman' ? 'bg-amber-50 text-amber-600' : 'bg-indigo-50 text-indigo-600'}`}>
                                                        {(sortedChats.find(c => c.id === selectedChatId)?.name || '?').substring(0, 1)}
                                                    </div>
                                                )}
                                                <div>
                                                    <div className="flex items-center space-x-2">
                                                        <h3 className="font-bold text-sm text-gray-900">{sortedChats.find(c => c.id === selectedChatId)?.name}</h3>
                                                        {currentRole === 'handyman' && (
                                                            <button
                                                                onClick={() => {
                                                                    const n = prompt("Enter Handyman Nickname:", chatMetadata[selectedChatId]?.name || "");
                                                                    if (n !== null) updateName(selectedChatId, n);
                                                                }}
                                                                className="text-[10px] text-indigo-500 hover:underline font-bold"
                                                            >
                                                                ✎ Edit
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center space-x-2">
                                                        <p className="text-[9px] uppercase font-black tracking-widest text-indigo-400">{currentStage}</p>
                                                        <span className="w-1 h-1 rounded-full bg-gray-300" />
                                                        <p className={`text-[9px] uppercase font-black tracking-widest ${currentRole === 'handyman' ? 'text-amber-500' : 'text-indigo-300'}`}>{currentRole}</p>
                                                        {currentRole === 'lead' && (
                                                            <>
                                                                <span className="w-1 h-1 rounded-full bg-gray-300" />
                                                                <select
                                                                    className="text-[9px] font-black uppercase tracking-widest text-indigo-500 bg-transparent border-none outline-none cursor-pointer"
                                                                    value={chatMetadata[selectedChatId]?.assignedHandymanId || ""}
                                                                    onChange={(e) => updateAssignment(selectedChatId, e.target.value)}
                                                                >
                                                                    <option value="">Assign Handyman...</option>
                                                                    {handymenList.map((h: any) => (
                                                                        <option key={h.id} value={h.id}>{h.name}</option>
                                                                    ))}
                                                                </select>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex space-x-2">
                                                <button
                                                    onClick={() => updateRole(selectedChatId, currentRole === 'lead' ? 'handyman' : 'lead')}
                                                    className={`px-3 py-1.5 text-[9px] font-black uppercase rounded-lg border transition-all ${currentRole === 'handyman' ? 'bg-amber-50 border-amber-200 text-amber-600' : 'bg-gray-50 border-gray-100 text-gray-400 hover:border-amber-200 hover:text-amber-600'}`}
                                                >
                                                    {currentRole === 'handyman' ? '★ Handyman' : '☆ Mark Handyman'}
                                                </button>
                                                <button onClick={() => {
                                                    const stages: FunnelStage[] = ['inbound', 'ascertaining', 'decision', 'actioned'];
                                                    const next = stages[(stages.indexOf(currentStage) + 1) % 4];
                                                    updateStage(selectedChatId, next);
                                                }} className="px-3 py-1.5 bg-indigo-600 text-white text-[9px] font-black uppercase rounded-lg shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all">Next →</button>
                                            </div>
                                        </div>
                                        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6 bg-gray-50/20">
                                            {filteredMessages.map(msg => (
                                                <div key={msg.id} className={`flex flex-col ${msg.fromMe ? 'items-end' : 'items-start'}`}>
                                                    <div className={`max-w-[80%] rounded-3xl px-6 py-4 shadow-sm ${msg.fromMe ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-white border text-gray-800 rounded-tl-none'}`}>
                                                        {msg.media && (
                                                            <div className="mb-2 rounded-xl overflow-hidden shadow-sm border border-gray-100/20">
                                                                {msg.media.mimetype.startsWith('image/') ? (
                                                                    <img
                                                                        src={`data:${msg.media.mimetype};base64,${msg.media.data}`}
                                                                        alt="WhatsApp Media"
                                                                        className="max-h-[300px] w-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                                                                        onClick={() => window.open(`data:${msg.media?.mimetype};base64,${msg.media?.data}`, '_blank')}
                                                                    />
                                                                ) : msg.media.mimetype.startsWith('video/') ? (
                                                                    <video
                                                                        src={`data:${msg.media.mimetype};base64,${msg.media.data}`}
                                                                        controls
                                                                        className="max-h-[300px] w-full"
                                                                    />
                                                                ) : null}
                                                            </div>
                                                        )}
                                                        <p className="text-sm leading-relaxed">{msg.body}</p>
                                                        <p className={`mt-2 text-[9px] font-black uppercase opacity-40 ${msg.fromMe ? 'text-white' : 'text-gray-400'}`}>{formatTime(msg.timestamp)}</p>
                                                    </div>
                                                </div>
                                            ))}
                                            <div ref={scrollRef} />
                                        </div>
                                        <div className="p-6 bg-white border-t space-y-4">
                                            <div className="flex space-x-2 overflow-x-auto pb-2 no-scrollbar">
                                                {quickReplies.map((r, i) => (
                                                    <button key={i} onClick={() => sendMessage(r)} className="flex-shrink-0 px-4 py-2 bg-gray-50 border rounded-full text-[10px] font-bold text-gray-500 hover:border-indigo-500 hover:text-indigo-600 transition-all">{r}</button>
                                                ))}
                                            </div>
                                            <div className="flex space-x-2">
                                                <input
                                                    type="text"
                                                    className="flex-1 bg-gray-50 border-2 border-gray-100 rounded-2xl px-6 py-3 text-sm focus:border-indigo-500 outline-none"
                                                    placeholder="Type a reply..."
                                                    value={inputText}
                                                    onChange={e => setInputText(e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && sendMessage(inputText)}
                                                />
                                                <button onClick={() => sendMessage(inputText)} className="p-4 bg-indigo-600 rounded-2xl text-white shadow-lg shadow-indigo-100 hover:rotate-12 transition-all">✈️</button>
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex-1 flex flex-col items-center justify-center text-gray-300 opacity-50">
                                        <div className="text-6xl mb-4">💬</div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Select a lead or handyman to start</p>
                                    </div>
                                )}
                            </div>

                            {/* Right Sidebar: Handymen */}
                            <div className="w-64 lg:w-72 border-l border-gray-100 flex flex-col bg-gray-50/10">
                                <div className="p-4 border-b border-gray-100/50">
                                    <h5 className="text-[9px] font-black uppercase tracking-widest text-amber-500">Handymen ({handymenList.length})</h5>
                                </div>
                                <div className="flex-1 overflow-y-auto pt-2 pb-4">
                                    {handymenList.length > 0 ? (
                                        handymenList.map((chat: any) => {
                                            const isAssignedToCurrent = selectedChatId && chatMetadata[selectedChatId]?.assignedHandymanId === chat.id;
                                            return (
                                                <button
                                                    key={chat.id}
                                                    onClick={() => setSelectedChatId(chat.id)}
                                                    className={`w-full p-3 flex items-center space-x-3 transition-all relative border-r-4 ${selectedChatId === chat.id ? 'bg-amber-50/40 border-amber-500' : isAssignedToCurrent ? 'bg-indigo-50/30 border-indigo-400' : 'border-transparent hover:bg-white/60'}`}
                                                >
                                                    {chat.avatarUrl ? (
                                                        <img src={chat.avatarUrl} className="w-10 h-10 rounded-xl object-cover border border-amber-100" alt={chat.name} />
                                                    ) : (
                                                        <div className={`w-10 h-10 rounded-xl border flex items-center justify-center font-black text-xs ${isAssignedToCurrent ? 'bg-indigo-50 border-indigo-100 text-indigo-600' : 'bg-amber-50 border-amber-100 text-amber-600'}`}>
                                                            {chat.name.substring(0, 1)}
                                                        </div>
                                                    )}
                                                    <div className="flex-1 text-left min-w-0">
                                                        <div className="flex items-center justify-between">
                                                            <h4 className="font-bold text-[12px] text-gray-900 truncate">{chat.name}</h4>
                                                            {isAssignedToCurrent && <span className="text-[8px] font-black text-indigo-500 uppercase tracking-tighter">Assigned ★</span>}
                                                        </div>
                                                        <p className="text-[10px] text-gray-400 truncate">{chat.lastMsg}</p>
                                                    </div>
                                                </button>
                                            );
                                        })
                                    ) : (
                                        <div className="p-8 text-center opacity-20 filter grayscale">
                                            <p className="text-[10px] font-black uppercase tracking-widest">No Handymen Tagged</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center space-y-6">
                        <div className="w-16 h-16 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{status}</p>
                    </div>
                )}
            </div>
        </div>
    );
}
