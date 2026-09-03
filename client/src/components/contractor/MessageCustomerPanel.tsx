/**
 * P15 part 2 — "Message the customer", on the contractor's accepted job.
 *
 * Three taps for the three phone calls he would otherwise make (arrived, running late, which door /
 * where to park) plus a free-text box for anything else. His words leave on the business number:
 * the customer never sees his mobile, and he never sees hers. Ben reads the exchange on the thread.
 *
 * The panel says out loud what it will not carry: money and dates go to the office. When a guard
 * holds a message the reply is not an error, it is "that one is with Ben" — his words still reached
 * the business, which is the point.
 *
 * Pure rendering plus its own fetches; mounted with one line from the job drawer.
 */
import { useCallback, useEffect, useState } from 'react';
import { MessageSquare, Send, Loader2, Check, Clock, DoorOpen, ShieldAlert } from 'lucide-react';

export interface RelayMessage { id: string; at: string; direction: 'in' | 'out'; body: string; heldForBen?: boolean }
export interface RelayPresetOption { id: 'arrived' | 'running_late' | 'access'; label: string }

export interface RelayThread {
    messages: RelayMessage[];
    presets: RelayPresetOption[];
    remaining: number;
    dailyLimit: number;
}

const PRESET_ICON: Record<string, any> = { arrived: Check, running_late: Clock, access: DoorOpen };

export function relayTime(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** Pure: minutes as typed, clamped once at send time so the box stays typeable. */
export function clampMinutes(raw: string | number): number {
    const n = Math.round(Number(raw));
    return Number.isFinite(n) && n > 0 ? Math.max(5, Math.min(120, n)) : 15;
}

/** Pure: what the send button does with the current box and preset. */
export function sendPayload(input: { preset: string | null; minutes: string | number; text: string }): { preset?: string; minutes?: number; text?: string } | null {
    if (input.preset === 'running_late') return { preset: 'running_late', minutes: clampMinutes(input.minutes) };
    if (input.preset) return { preset: input.preset };
    const text = input.text.replace(/\s+/g, ' ').trim();
    return text ? { text } : null;
}

export function MessageCustomerPanel({ token, bookingId, accepted }: { token: string; bookingId: string; accepted: boolean }) {
    const [open, setOpen] = useState(false);
    const [thread, setThread] = useState<RelayThread | null>(null);
    const [text, setText] = useState('');
    const [minutes, setMinutes] = useState('15');
    const [busy, setBusy] = useState<string | null>(null);
    const [note, setNote] = useState<{ kind: 'sent' | 'held' | 'error'; text: string } | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await fetch(`/api/contractor-app/${token}/jobs/${bookingId}/messages`);
            if (!res.ok) return;
            setThread(await res.json());
        } catch { /* the panel is optional */ }
    }, [token, bookingId]);

    useEffect(() => { if (open) void load(); }, [open, load]);

    async function send(preset: string | null) {
        const payload = sendPayload({ preset, minutes, text });
        if (!payload) return;
        setBusy(preset ?? 'text'); setNote(null);
        try {
            const res = await fetch(`/api/contractor-app/${token}/jobs/${bookingId}/message`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) setNote({ kind: 'error', text: json.error ?? 'That did not send.' });
            else if (json.held) setNote({ kind: 'held', text: json.message ?? 'That one has gone to the office.' });
            else { setNote({ kind: 'sent', text: 'Sent.' }); setText(''); }
            await load();
        } catch {
            setNote({ kind: 'error', text: 'That did not send. Try again, or ring the office.' });
        } finally {
            setBusy(null);
        }
    }

    if (!accepted) return null;

    const remaining = thread?.remaining ?? null;
    const spent = remaining === 0;

    return (
        <div className="mb-4 rounded-2xl border border-slate-700 bg-slate-800/40" data-testid="message-customer">
            <button
                type="button" onClick={() => setOpen((o) => !o)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                data-testid="message-customer-toggle" aria-expanded={open}
            >
                <MessageSquare size={14} className="text-sky-400" />
                <span className="text-[13px] font-bold text-slate-100">Message the customer</span>
                <span className="ml-auto text-[11px] text-slate-400">{open ? 'Hide' : 'Open'}</span>
            </button>

            {open && (
                <div className="border-t border-slate-700 px-3 py-3">
                    <div className="flex flex-wrap gap-1.5" data-testid="relay-presets">
                        {(thread?.presets ?? []).map((p) => {
                            const Icon = PRESET_ICON[p.id] ?? MessageSquare;
                            return (
                                <button
                                    key={p.id} type="button" disabled={!!busy || spent} onClick={() => void send(p.id)}
                                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-700/70 px-2.5 py-2 text-[12px] font-semibold text-slate-100 disabled:opacity-40"
                                    data-testid={`relay-preset-${p.id}`}
                                >
                                    {busy === p.id ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
                                    {p.label}
                                </button>
                            );
                        })}
                    </div>

                    <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-400" data-testid="relay-minutes">
                        Running late by
                        <input
                            type="number" min={5} max={120} step={5} value={minutes}
                            onChange={(e) => setMinutes(e.target.value)}
                            onBlur={() => setMinutes(String(clampMinutes(minutes)))}
                            className="w-16 rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-[12px] text-slate-100"
                            aria-label="Minutes late"
                        />
                        minutes
                    </label>

                    <div className="mt-2.5">
                        <textarea
                            value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={480}
                            placeholder="Anything else. No prices and no dates, those go through the office."
                            disabled={!!busy || spent}
                            className="w-full rounded-xl border border-slate-600 bg-slate-900 px-2.5 py-2 text-[13px] text-slate-100 placeholder:text-slate-500 disabled:opacity-40"
                            data-testid="relay-text"
                        />
                        <div className="mt-1.5 flex items-center gap-2">
                            <button
                                type="button" disabled={!!busy || spent || !text.trim()} onClick={() => void send(null)}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-sky-500 px-3 py-2 text-[12px] font-bold text-white disabled:opacity-40"
                                data-testid="relay-send"
                            >
                                {busy === 'text' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Send
                            </button>
                            {remaining != null && (
                                <span className="text-[11px] text-slate-400" data-testid="relay-remaining">
                                    {spent ? 'That is today\'s five. Ring the office.' : `${remaining} left today`}
                                </span>
                            )}
                        </div>
                    </div>

                    {note && (
                        <div
                            className={`mt-2 flex items-start gap-1.5 rounded-xl px-2.5 py-2 text-[12px] ${note.kind === 'sent' ? 'bg-emerald-500/15 text-emerald-300' : note.kind === 'held' ? 'bg-amber-500/15 text-amber-200' : 'bg-red-500/15 text-red-300'}`}
                            data-testid={`relay-note-${note.kind}`}
                        >
                            {note.kind === 'held' ? <ShieldAlert size={12} className="mt-0.5 shrink-0" /> : null}
                            <span>{note.text}</span>
                        </div>
                    )}

                    {thread && thread.messages.length > 0 && (
                        <div className="mt-3 space-y-1.5" data-testid="relay-thread">
                            {thread.messages.map((m) => (
                                <div key={m.id} className={m.direction === 'out' ? 'text-right' : 'text-left'} data-testid={`relay-message-${m.id}`}>
                                    <div className={`inline-block max-w-[85%] rounded-xl px-2.5 py-1.5 text-[12px] leading-snug ${m.direction === 'out' ? 'bg-sky-500/20 text-sky-100' : 'bg-slate-700/70 text-slate-100'}`}>
                                        {m.body}
                                    </div>
                                    <div className="mt-0.5 text-[10px] text-slate-500">{m.direction === 'out' ? 'You' : 'Customer'} · {relayTime(m.at)}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
