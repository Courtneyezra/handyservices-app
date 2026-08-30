/**
 * OpsDock — the Ops Manager chat dock (B-WP3).
 *
 * A floating Bot launcher (bottom-right) plus a fixed right slide-in panel.
 * Deliberately NOT a Radix Sheet/Dialog: no overlay, no focus trap — the page
 * behind stays fully usable while the dock is open, because the whole point
 * is chatting with the ops agent ABOUT the screen you are looking at.
 *
 * State model: React Query + SSE via useOpsSession (contracts frozen in
 * shared/ops-types.ts). The dock itself only owns UI state — open/closed and
 * which session is selected — both persisted to localStorage so a reload
 * lands you back in the same conversation.
 *
 * Mounted by SidebarLayout (B-WP4); this component renders nothing until the
 * operator interacts with it beyond the launcher button.
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, Bot, Loader2, Plus, Send, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    archiveOpsSession, createOpsSession, useOpsSession, useOpsSessions,
} from '@/hooks/useOpsSession';
import { OpsRunSteps } from './OpsRunSteps';

const OPEN_KEY = 'ops-dock-open';
const SESSION_KEY = 'ops-dock-session';

export default function OpsDock() {
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1');
    const [sessionId, setSessionId] = useState<string | null>(() => localStorage.getItem(SESSION_KEY) || null);
    const [input, setInput] = useState('');
    const [pendingSend, setPendingSend] = useState<string | null>(null);
    const [sendError, setSendError] = useState<string | null>(null);
    const [seenMessageId, setSeenMessageId] = useState<string | null>(null);

    const sessions = useOpsSessions(open);
    const { messages, liveRun, activeRunId, sending, sendMessage, isLoading } = useOpsSession(sessionId);

    const persistOpen = (next: boolean) => {
        setOpen(next);
        localStorage.setItem(OPEN_KEY, next ? '1' : '0');
    };
    const persistSession = (id: string | null) => {
        setSessionId(id);
        if (id) localStorage.setItem(SESSION_KEY, id);
        else localStorage.removeItem(SESSION_KEY);
    };

    // Stored session may have been archived elsewhere — fall back to the most
    // recent active session once the list loads (or clear if none exist).
    useEffect(() => {
        if (!sessions.data) return;
        if (sessionId && sessions.data.some((s) => s.id === sessionId)) return;
        persistSession(sessions.data[0]?.id ?? null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessions.data]);

    // Deferred send after auto-creating a session (sendMessage re-binds to the
    // new sessionId on the next render).
    useEffect(() => {
        if (!pendingSend || !sessionId) return;
        const text = pendingSend;
        setPendingSend(null);
        sendMessage(text).catch((err) => setSendError(err instanceof Error ? err.message : 'send failed'));
    }, [pendingSend, sessionId, sendMessage]);

    // Unseen-activity tracking: while open, the latest assistant message is
    // seen; while closed, a newer one lights the launcher dot.
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    useEffect(() => {
        if (open && lastAssistant) setSeenMessageId(lastAssistant.id);
    }, [open, lastAssistant?.id]); // eslint-disable-line react-hooks/exhaustive-deps
    const hasUnseen = !!lastAssistant && lastAssistant.id !== seenMessageId;
    const showActivityDot = !!activeRunId || (!open && hasUnseen);

    // Pin the scroll to the bottom as messages and live steps stream in.
    const scrollRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages.length, liveRun?.steps.length, open]);

    const composerDisabled = sending || !!activeRunId;

    const handleSend = async () => {
        const text = input.trim();
        if (!text || composerDisabled) return;
        setSendError(null);
        setInput('');
        try {
            if (!sessionId) {
                const created = await createOpsSession();
                queryClient.invalidateQueries({ queryKey: ['ops-sessions'] });
                persistSession(created.id);
                setPendingSend(text);
                return;
            }
            await sendMessage(text);
        } catch (err) {
            setSendError(err instanceof Error ? err.message : 'send failed');
            setInput(text); // give the operator their words back
        }
    };

    const handleNewSession = async () => {
        try {
            const created = await createOpsSession();
            queryClient.invalidateQueries({ queryKey: ['ops-sessions'] });
            persistSession(created.id);
        } catch (err) {
            setSendError(err instanceof Error ? err.message : 'could not create session');
        }
    };

    const handleArchive = async () => {
        if (!sessionId) return;
        try {
            await archiveOpsSession(sessionId);
            queryClient.invalidateQueries({ queryKey: ['ops-sessions'] });
            persistSession(null);
        } catch (err) {
            setSendError(err instanceof Error ? err.message : 'could not archive session');
        }
    };

    return (
        <>
            {/* Launcher */}
            {!open && (
                <button
                    type="button"
                    onClick={() => persistOpen(true)}
                    className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg transition-transform hover:scale-105"
                    aria-label="Open Ops Manager"
                    data-testid="ops-dock-launcher"
                >
                    <Bot className="h-6 w-6" />
                    {showActivityDot && (
                        <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5">
                            <span className={cn(
                                'absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75',
                                activeRunId && 'animate-ping',
                            )}
                            />
                            <span className="relative inline-flex h-3.5 w-3.5 rounded-full border-2 border-white bg-blue-500" />
                        </span>
                    )}
                </button>
            )}

            {/* Panel — fixed, no overlay, page behind stays interactive */}
            <div
                className={cn(
                    'fixed inset-y-0 right-0 z-40 flex w-[380px] max-w-full flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform duration-200',
                    open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
                )}
                data-testid="ops-dock-panel"
                aria-hidden={!open}
            >
                {/* Header */}
                <div className="border-b border-slate-100 px-3 pb-2 pt-3">
                    <div className="flex items-center gap-2">
                        <Bot className="h-5 w-5 text-slate-700" />
                        <span className="text-sm font-semibold text-slate-800">Ops Manager</span>
                        {activeRunId && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />}
                        <button
                            type="button"
                            onClick={() => persistOpen(false)}
                            className="ml-auto rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                            aria-label="Close"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                        <select
                            value={sessionId ?? ''}
                            onChange={(e) => persistSession(e.target.value || null)}
                            className="h-7 min-w-0 flex-1 truncate rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-300"
                            aria-label="Session"
                        >
                            {!sessionId && <option value="">No session</option>}
                            {(sessions.data ?? []).map((s) => (
                                <option key={s.id} value={s.id}>{s.title}</option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={handleNewSession}
                            title="New session"
                            className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50"
                        >
                            <Plus className="h-3.5 w-3.5" />
                        </button>
                        <button
                            type="button"
                            onClick={handleArchive}
                            disabled={!sessionId}
                            title="Archive session"
                            className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-40"
                        >
                            <Archive className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>

                {/* Messages */}
                <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
                    {!sessionId ? (
                        <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-slate-400">
                            <Bot className="h-8 w-8 text-slate-300" />
                            <p>Ask the ops agent about the board,<br />quotes, jobs or follow-ups.</p>
                            <p className="text-xs">Sending a message starts a session.</p>
                        </div>
                    ) : isLoading ? (
                        <div className="flex h-full items-center justify-center">
                            <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2.5">
                            {messages.length === 0 && !liveRun && (
                                <p className="py-8 text-center text-sm text-slate-400">No messages yet — say hello.</p>
                            )}
                            {messages.map((m) => (
                                <div key={m.id} className={cn('flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}>
                                    <div className={cn(
                                        'max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm',
                                        m.role === 'user'
                                            ? 'bg-slate-900 text-white'
                                            : 'bg-slate-100 text-slate-800',
                                    )}
                                    >
                                        {m.content}
                                    </div>
                                    {m.role === 'assistant' && m.transcript && m.transcript.length > 0 && (
                                        <div className="mt-1 w-full max-w-[85%]">
                                            <OpsRunSteps steps={m.transcript} collapsible />
                                        </div>
                                    )}
                                </div>
                            ))}
                            {liveRun && (
                                <div className="rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-2.5">
                                    <OpsRunSteps steps={liveRun.steps} live finished={liveRun.finished} />
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Composer */}
                <div className="border-t border-slate-100 p-3">
                    {sendError && <p className="mb-1.5 text-xs text-red-600">{sendError}</p>}
                    <div className="flex items-end gap-2">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    void handleSend();
                                }
                            }}
                            placeholder={activeRunId ? 'Agent is working…' : 'Message the ops agent…'}
                            rows={2}
                            disabled={composerDisabled}
                            className="min-h-[40px] flex-1 resize-none rounded-md border border-slate-200 px-2.5 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300 disabled:bg-slate-50"
                            data-testid="ops-dock-composer"
                        />
                        <button
                            type="button"
                            onClick={() => void handleSend()}
                            disabled={composerDisabled || !input.trim()}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white transition-colors hover:bg-slate-700 disabled:opacity-40"
                            aria-label="Send"
                        >
                            {sending || activeRunId
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <Send className="h-4 w-4" />}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
