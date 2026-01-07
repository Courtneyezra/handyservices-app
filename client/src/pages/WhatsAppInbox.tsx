/**
 * WhatsApp Inbox - Enterprise-grade agent inbox
 * 
 * Features:
 * - Real-time WebSocket updates
 * - Proper state management with refs
 * - 24h window indicator
 * - Loading/error states
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, Send, Search, Clock, CheckCheck, AlertCircle, Loader2, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// Types
interface Conversation {
    id: string;
    phoneNumber: string;
    contactName: string | null;
    lastMessagePreview: string | null;
    lastMessageAt: string | null;
    unreadCount: number;
    canSendFreeform: boolean;
    stage: string;
}

interface Message {
    id: string;
    direction: 'inbound' | 'outbound';
    content: string;
    type: string;
    status: string;
    mediaUrl?: string;
    mediaType?: string;
    senderName?: string;
    createdAt: string;
}

export default function WhatsAppInbox() {
    // State
    const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [inputText, setInputText] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [sending, setSending] = useState(false);

    // Refs
    const wsRef = useRef<WebSocket | null>(null);
    const selectedConversationRef = useRef<Conversation | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Keep ref in sync with state
    useEffect(() => {
        selectedConversationRef.current = selectedConversation;
    }, [selectedConversation]);

    // Scroll to bottom
    const scrollToBottom = useCallback(() => {
        scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    // WebSocket message handler
    const handleMessage = useCallback((event: MessageEvent) => {
        try {
            const msg = JSON.parse(event.data);
            console.log('[Inbox] Received:', msg.type);

            switch (msg.type) {
                case 'inbox:ready':
                    console.log('[Inbox] Connected and ready');
                    wsRef.current?.send(JSON.stringify({ type: 'inbox:get_conversations' }));
                    break;

                case 'inbox:conversations':
                    setConversations(msg.data);
                    break;

                case 'inbox:messages':
                    const currentConv = selectedConversationRef.current;
                    if (currentConv && msg.conversationId === currentConv.phoneNumber) {
                        setMessages(msg.data);
                        setLoadingMessages(false);
                        setTimeout(scrollToBottom, 50);
                    }
                    break;

                case 'inbox:message':
                    // Update conversation list
                    setConversations(prev => {
                        const { conversationId, message } = msg.data;
                        const idx = prev.findIndex(c => c.phoneNumber === conversationId);

                        if (idx >= 0) {
                            const updated = [...prev];
                            updated[idx] = {
                                ...updated[idx],
                                lastMessagePreview: message.content || 'Media',
                                lastMessageAt: message.createdAt,
                                unreadCount: message.direction === 'inbound'
                                    ? (selectedConversationRef.current?.phoneNumber === conversationId ? 0 : updated[idx].unreadCount + 1)
                                    : updated[idx].unreadCount,
                            };
                            // Move to top
                            return [updated[idx], ...updated.slice(0, idx), ...updated.slice(idx + 1)];
                        }
                        return prev;
                    });

                    // Append to current chat
                    const currentConv2 = selectedConversationRef.current;
                    if (currentConv2 && msg.data.conversationId === currentConv2.phoneNumber) {
                        setMessages(prev => {
                            if (prev.find(m => m.id === msg.data.message.id)) return prev;
                            return [...prev, msg.data.message];
                        });
                        setTimeout(scrollToBottom, 50);
                    }
                    break;

                case 'inbox:conversation_update':
                    setConversations(prev => prev.map(c =>
                        c.phoneNumber === msg.data.conversationId
                            ? { ...c, ...msg.data.updates }
                            : c
                    ));
                    break;

                case 'inbox:error':
                    console.error('[Inbox] Error:', msg.error);
                    setLoadingMessages(false);
                    break;
            }
        } catch (e) {
            console.error('[Inbox] Message parse error:', e);
        }
    }, [scrollToBottom]);

    // WebSocket connection
    useEffect(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/ws/client`;

        console.log('[Inbox] Connecting to:', wsUrl);
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            console.log('[Inbox] Connected');
            setStatus('connected');
        };

        ws.onclose = () => {
            console.log('[Inbox] Disconnected');
            setStatus('disconnected');
        };

        ws.onerror = (e) => console.error('[Inbox] Error:', e);
        ws.onmessage = handleMessage;

        return () => ws.close();
    }, [handleMessage]);

    // Select conversation
    const selectConversation = useCallback((conv: Conversation) => {
        setSelectedConversation(conv);
        setMessages([]);
        setLoadingMessages(true);

        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
                type: 'inbox:get_messages',
                data: { conversationId: conv.phoneNumber }
            }));

            // Mark as read
            wsRef.current.send(JSON.stringify({
                type: 'inbox:mark_read',
                data: { conversationId: conv.phoneNumber }
            }));
        }

        // Clear unread locally
        setConversations(prev => prev.map(c =>
            c.phoneNumber === conv.phoneNumber ? { ...c, unreadCount: 0 } : c
        ));
    }, []);

    // Send message
    const sendMessage = useCallback(async () => {
        if (!inputText.trim() || !selectedConversation || sending) return;

        setSending(true);
        try {
            const response = await fetch('/api/whatsapp/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: selectedConversation.phoneNumber,
                    body: inputText.trim()
                })
            });

            if (!response.ok) throw new Error('Send failed');
            setInputText('');
        } catch (e) {
            console.error('[Inbox] Send error:', e);
            alert('Failed to send message');
        } finally {
            setSending(false);
        }
    }, [inputText, selectedConversation, sending]);

    // Filter conversations
    const filteredConversations = conversations.filter(c =>
        !searchQuery ||
        c.contactName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.phoneNumber.includes(searchQuery)
    );

    // Format time
    const formatTime = (dateStr: string | null) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        const now = new Date();
        const diffHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

        if (diffHours < 24) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (diffHours < 48) {
            return 'Yesterday';
        } else {
            return date.toLocaleDateString();
        }
    };

    return (
        <div className="flex-1 flex bg-background h-[calc(100vh-theme(spacing.16))] lg:h-screen text-foreground overflow-hidden relative font-sans transition-colors duration-300">
            {/* Sidebar / Conversation List */}
            <div className={cn(
                "w-full lg:w-80 border-r border-border flex flex-col absolute inset-0 z-10 bg-card/80 backdrop-blur-xl transition-transform duration-300 lg:relative lg:translate-x-0",
                selectedConversation && "translate-x-[-100%] lg:translate-x-0"
            )}>
                {/* Header */}
                <div className="p-4 border-b border-border bg-muted/30 transition-colors">
                    <div className="flex items-center justify-between mb-4">
                        <h1 className="text-xl font-bold flex items-center gap-2 text-secondary">
                            <div className="p-2 bg-primary/10 rounded-lg">
                                <MessageSquare className="w-5 h-5 text-primary" />
                            </div>
                            WhatsApp Inbox
                        </h1>
                        <div className={`w-2 h-2 rounded-full shadow-[0_0_8px] ${status === 'connected' ? 'bg-primary shadow-primary/50' : status === 'connecting' ? 'bg-amber-500 animate-pulse shadow-amber-500/50' : 'bg-red-500 shadow-red-500/50'}`} />
                    </div>

                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search conversations..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-background border border-input rounded-xl pl-10 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all"
                        />
                    </div>
                </div>

                {/* Conversation List */}
                <div className="flex-1 overflow-y-auto">
                    {filteredConversations.length === 0 ? (
                        <div className="p-8 text-center text-muted-foreground">
                            <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-50" />
                            <p>No conversations</p>
                        </div>
                    ) : (
                        filteredConversations.map(conv => (
                            <div
                                key={conv.phoneNumber}
                                onClick={() => selectConversation(conv)}
                                className={`p-4 border-b border-border cursor-pointer transition-all ${selectedConversation?.phoneNumber === conv.phoneNumber
                                    ? 'bg-muted border-l-2 border-l-primary'
                                    : 'hover:bg-muted/50'
                                    }`}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium truncate text-foreground">
                                                {conv.contactName || conv.phoneNumber.replace('@c.us', '')}
                                            </span>
                                            {!conv.canSendFreeform && (
                                                <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded-md font-medium">
                                                    Template
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-sm text-muted-foreground truncate">
                                            {conv.lastMessagePreview || 'No messages'}
                                        </p>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        <span className="text-xs text-muted-foreground">
                                            {formatTime(conv.lastMessageAt)}
                                        </span>
                                        {conv.unreadCount > 0 && (
                                            <span className="bg-primary text-primary-foreground text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center shadow-lg shadow-primary/20">
                                                {conv.unreadCount}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Chat Area */}
            <div className={cn(
                "flex-1 flex flex-col absolute inset-0 z-0 bg-background transition-transform duration-300 lg:relative lg:translate-x-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-100",
                !selectedConversation && "translate-x-[100%] lg:translate-x-0"
            )}>
                {!selectedConversation ? (
                    /* No chat selected */
                    <div className="flex-1 flex items-center justify-center text-muted-foreground">
                        <div className="text-center">
                            <MessageSquare className="w-16 h-16 mx-auto mb-4 opacity-50" />
                            <p className="text-lg">Select a conversation</p>
                            <p className="text-sm">Choose from the list on the left</p>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Chat Header */}
                        <div className="p-4 border-b border-border bg-card/50 backdrop-blur-md">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => setSelectedConversation(null)}
                                        className="p-2 -ml-2 text-muted-foreground hover:text-foreground lg:hidden"
                                    >
                                        <ArrowRight className="w-5 h-5 rotate-180" />
                                    </button>
                                    <div>
                                        <h2 className="font-semibold text-sm lg:text-base truncate max-w-[150px] lg:max-w-none text-foreground">
                                            {selectedConversation.contactName || selectedConversation.phoneNumber.replace('@c.us', '')}
                                        </h2>
                                        <p className="text-xs text-muted-foreground">
                                            {selectedConversation.phoneNumber.replace('@c.us', '')}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {selectedConversation.canSendFreeform ? (
                                        <span className="text-xs px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg flex items-center gap-1.5 font-medium">
                                            <CheckCheck className="w-3 h-3" />
                                            24h Active
                                        </span>
                                    ) : (
                                        <span className="text-xs px-2 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg flex items-center gap-1.5 font-medium">
                                            <Clock className="w-3 h-3" />
                                            Template Mode
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            {loadingMessages ? (
                                <div className="flex items-center justify-center h-full">
                                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                                </div>
                            ) : messages.length === 0 ? (
                                <div className="flex items-center justify-center h-full text-muted-foreground">
                                    <div className="text-center">
                                        <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                        <p>No messages yet</p>
                                    </div>
                                </div>
                            ) : (
                                messages.map(msg => (
                                    <div
                                        key={msg.id}
                                        className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                                    >
                                        <div className={`max-w-[70%] rounded-2xl px-5 py-3 shadow-md ${msg.direction === 'outbound'
                                            ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white rounded-br-sm border border-emerald-500/20'
                                            : 'bg-card text-card-foreground rounded-bl-sm border border-border backdrop-blur-sm'
                                            }`}>
                                            {msg.mediaUrl && (
                                                <div className="mb-2">
                                                    <img
                                                        src={msg.mediaUrl}
                                                        alt="Media"
                                                        className="max-w-full rounded-lg"
                                                    />
                                                </div>
                                            )}
                                            <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                                            <div className="flex items-center justify-end gap-1 mt-1 opacity-70">
                                                <span className="text-[10px]">
                                                    {formatTime(msg.createdAt)}
                                                </span>
                                                {msg.direction === 'outbound' && (
                                                    <CheckCheck className="w-3 h-3" />
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                            <div ref={scrollRef} />
                        </div>

                        {/* Input */}
                        <div className="p-4 border-t border-border bg-card/80 backdrop-blur-md">
                            {!selectedConversation.canSendFreeform && (
                                <div className="mb-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-500 text-sm flex items-center gap-2">
                                    <AlertCircle className="w-4 h-4" />
                                    Outside 24h window. Message will be sent as template.
                                </div>
                            )}
                            <div className="flex gap-3">
                                <input
                                    type="text"
                                    value={inputText}
                                    onChange={(e) => setInputText(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                                    placeholder="Type a message..."
                                    className="flex-1 bg-muted/50 border border-input rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-all placeholder:text-muted-foreground text-foreground"
                                    disabled={sending}
                                />
                                <button
                                    onClick={sendMessage}
                                    disabled={!inputText.trim() || sending}
                                    className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white disabled:opacity-50 disabled:cursor-not-allowed px-5 rounded-xl transition-all shadow-lg shadow-emerald-500/20"
                                >
                                    {sending ? (
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                    ) : (
                                        <Send className="w-5 h-5" />
                                    )}
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div >
    );
}
