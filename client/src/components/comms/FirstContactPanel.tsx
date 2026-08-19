/**
 * FirstContactPanel — the control panel and audit log for the first-contact auto-responder.
 *
 * This is the ONE thing in the system that messages a stranger with no human in the loop. Its
 * settings used to live in a CLI script and its refusals only in server console output, which
 * meant the honest answer to "is it safe to turn on?" was "nobody can see what it does". This
 * panel is the answer to that, and the reason the feature can ever be enabled.
 *
 * Two halves, in the order an operator needs them:
 *
 *   SETTINGS — the master switch, which surfaces may auto-reply, and how long a thread must be
 *     quiet before a returning customer is greeted as one. Everything reads from the DB on open,
 *     so what is on screen is what is actually running, never a remembered default. The OFF
 *     switch is deliberately the biggest control on the page: the one action an operator needs at
 *     3am is "stop it", and it should never require reading anything first.
 *
 *   LOG — every decision, sent AND refused, newest first. The refusals are the point. A log of
 *     successes cannot answer the question this panel exists for ("that enquiry got no reply,
 *     why?"), so the refusal reason is rendered as the loudest thing on each row.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import {
    Loader2, Power, ShieldCheck, AlertTriangle, MessageCircle, Smartphone,
    Globe, Phone, Check, X, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';

function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

// ---------------------------------------------------------------- types

type Channel = 'whatsapp' | 'sms' | 'webform' | 'post_call';

interface FirstContactConfig {
    enabled: boolean;
    channels: Channel[];
    returningAfterDays: number;
}

interface LogRow {
    id: string;
    createdAt: string;
    conversationId: string | null;
    phone: string;
    contactName: string | null;
    channel: string;
    intent: string | null;
    contactClass: string | null;
    sent: boolean;
    reason: string;
    detail: string | null;
    mode: string | null;
    templateName: string | null;
    outOfHours: boolean | null;
    body: string | null;
    draftId: string | null;
}

const CHANNEL_META: Record<Channel, { label: string; blurb: string; icon: typeof MessageCircle }> = {
    whatsapp: { label: 'WhatsApp', blurb: 'A first message from a number we have never replied to', icon: MessageCircle },
    sms: { label: 'SMS', blurb: 'A first text. Answered by SMS, never by WhatsApp', icon: Smartphone },
    webform: { label: 'Web form', blurb: 'A first enquiry through the website', icon: Globe },
    post_call: { label: 'Missed call', blurb: 'A call that rang out. Tells them we will ring back', icon: Phone },
};

/**
 * How each outcome reads on a row. Tone is about what an operator should DO, not about whether
 * the code succeeded: a refusal that was correct (spam, out of area) is calm, a refusal that means
 * a real customer went unanswered (send refused, error, no template) is loud.
 */
const REASON_META: Record<string, { label: string; blurb: string; tone: 'sent' | 'quiet' | 'loud' }> = {
    SENT: { label: 'Sent', blurb: 'The acknowledgement reached them', tone: 'sent' },
    DISABLED: { label: 'Off', blurb: 'The auto-responder is switched off, so nothing was sent', tone: 'quiet' },
    CHANNEL_NOT_ENABLED: { label: 'Channel off', blurb: 'This surface is not enabled in the settings above', tone: 'quiet' },
    NOT_FIRST_CONTACT: { label: 'Not a first contact', blurb: 'We have messaged them recently, so the ordinary queue owns it', tone: 'quiet' },
    OUT_OF_AREA: { label: 'Out of area', blurb: 'Not a UK number', tone: 'quiet' },
    LOOKS_LIKE_SPAM: { label: 'Spam', blurb: 'Matched a marketing blast pattern', tone: 'quiet' },
    NO_PHONE: { label: 'No number', blurb: 'Nothing to reply to', tone: 'quiet' },
    QUEUED_NO_TEMPLATE: { label: 'Queued for a human', blurb: 'Window shut, no approved template, no SMS sender. It is waiting in drafts', tone: 'loud' },
    DUPLICATE_DRAFT: { label: 'Already queued', blurb: 'An unsent draft for this number already existed', tone: 'quiet' },
    ERROR: { label: 'Error', blurb: 'The lane failed. Check the server logs', tone: 'loud' },
};

function reasonMeta(reason: string) {
    if (reason.startsWith('SEND_REFUSED')) {
        return {
            label: 'Send refused',
            blurb: `The send was refused (${reason.split(':')[1] || 'no code'}). The draft is waiting for a human`,
            tone: 'loud' as const,
        };
    }
    return REASON_META[reason] ?? { label: reason, blurb: '', tone: 'loud' as const };
}

const TONE_CLASS = {
    sent: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    quiet: 'bg-slate-100 text-slate-600 border-slate-200',
    loud: 'bg-red-100 text-red-800 border-red-200',
};

function when(iso: string): string {
    const d = new Date(iso);
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (mins < 24 * 60) return `${Math.round(mins / 60)}h ago`;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------- the panel

export function FirstContactPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
    const qc = useQueryClient();
    const [saveError, setSaveError] = useState<string | null>(null);

    const { data: configData, isLoading: configLoading } = useQuery<{ config: FirstContactConfig; channels: Channel[] }>({
        queryKey: ['first-contact-config'],
        queryFn: async () => {
            const res = await fetch('/api/agents/first-contact/config', { headers: getAuthHeaders() });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not read the settings');
            return res.json();
        },
        // Only while the panel is open, and always fresh on open: a stale "ON" here would be a lie
        // about something that messages customers.
        enabled: open,
        staleTime: 0,
    });

    const { data: logData, isLoading: logLoading, refetch: refetchLog } = useQuery<{ rows: LogRow[]; summary: { reason: string; n: number }[] }>({
        queryKey: ['first-contact-log'],
        queryFn: async () => {
            const res = await fetch('/api/agents/first-contact/log?limit=100', { headers: getAuthHeaders() });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not read the log');
            return res.json();
        },
        enabled: open,
        staleTime: 0,
    });

    const save = useMutation({
        mutationFn: async (patch: Partial<FirstContactConfig>) => {
            const res = await fetch('/api/agents/first-contact/config', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify(patch),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.error || 'Could not save');
            return json as { config: FirstContactConfig };
        },
        // The server's answer replaces local state, so the panel can never show a change that did
        // not actually land in the database.
        onSuccess: (json) => {
            setSaveError(null);
            qc.setQueryData(['first-contact-config'], (old: any) => ({ ...(old ?? {}), config: json.config }));
        },
        onError: (e: Error) => setSaveError(e.message),
    });

    const config = configData?.config;
    const channels = configData?.channels ?? (['whatsapp', 'sms', 'webform', 'post_call'] as Channel[]);

    const toggleChannel = (c: Channel) => {
        if (!config) return;
        const next = config.channels.includes(c)
            ? config.channels.filter((x) => x !== c)
            : [...config.channels, c];
        save.mutate({ channels: next });
    };

    return (
        <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
            <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-2xl">
                <SheetTitle className="sr-only">First-contact auto-reply</SheetTitle>
                <SheetDescription className="sr-only">
                    Settings and audit log for the automatic reply to first-time enquiries.
                </SheetDescription>

                {/* ---------------------------------------------------------------- status */}
                {/* pt-12 clears the Sheet's own close X, which sits absolute at right-4 top-4. */}
                <div className={cn('px-6 pb-5 pt-12 text-white', config?.enabled ? 'bg-emerald-700' : 'bg-slate-800')}>
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <div className="text-[11px] uppercase tracking-wide text-white/70">Auto-reply to first-time enquiries</div>
                            <h2 className="mt-1 flex items-center gap-2 text-2xl font-bold">
                                {configLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : config?.enabled
                                    ? <><ShieldCheck className="h-6 w-6" /> ON</>
                                    : <><Power className="h-6 w-6" /> OFF</>}
                            </h2>
                            <p className="mt-1 max-w-md text-sm text-white/80">
                                {config?.enabled
                                    ? 'Strangers who message us for the first time get an instant reply, 24/7, with no approval. Everything else still waits for you.'
                                    : 'Nobody is being replied to automatically. Every message waits for a human.'}
                            </p>
                        </div>
                        {config && (
                            <button
                                onClick={() => save.mutate({ enabled: !config.enabled })}
                                disabled={save.isPending}
                                className={cn(
                                    'shrink-0 rounded-lg px-5 py-3 text-sm font-bold shadow-sm transition',
                                    config.enabled
                                        ? 'bg-white text-red-700 hover:bg-red-50'
                                        : 'bg-emerald-500 text-white hover:bg-emerald-400',
                                    save.isPending && 'opacity-60',
                                )}
                            >
                                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : config.enabled ? 'TURN IT OFF' : 'Turn it on'}
                            </button>
                        )}
                    </div>
                </div>

                {saveError && (
                    <div className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-6 py-3 text-sm text-red-800">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {saveError}
                    </div>
                )}

                {/* ---------------------------------------------------------------- settings */}
                <div className="border-b border-slate-200 px-6 py-5">
                    <h3 className="text-sm font-semibold text-slate-900">Which first touches may auto-reply</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                        Each surface is separate, so one can be trialled without the others.
                    </p>

                    <div className="mt-3 space-y-2">
                        {channels.map((c) => {
                            const meta = CHANNEL_META[c];
                            const on = !!config?.channels.includes(c);
                            const Icon = meta?.icon ?? MessageCircle;
                            return (
                                <button
                                    key={c}
                                    onClick={() => toggleChannel(c)}
                                    disabled={!config || save.isPending}
                                    className={cn(
                                        'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition',
                                        on ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white hover:border-slate-300',
                                        !config?.enabled && 'opacity-60',
                                    )}
                                >
                                    <Icon className={cn('h-4 w-4 shrink-0', on ? 'text-emerald-700' : 'text-slate-400')} />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm font-medium text-slate-900">{meta?.label ?? c}</div>
                                        <div className="truncate text-xs text-slate-500">{meta?.blurb}</div>
                                    </div>
                                    <span className={cn(
                                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                                        on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white text-slate-300',
                                    )}>
                                        {on ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {!config?.enabled && (
                        <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
                            These stay saved while the auto-responder is off. Nothing sends until the master switch is on.
                        </p>
                    )}

                    <div className="mt-5">
                        <label className="text-sm font-semibold text-slate-900" htmlFor="returning-days">
                            Greet a returning customer after
                        </label>
                        <p className="mt-0.5 text-xs text-slate-500">
                            A thread quieter than this gets the warmer "good to hear from you again" reply and goes up the board.
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                            <input
                                id="returning-days"
                                type="number"
                                min={1}
                                max={3650}
                                defaultValue={config?.returningAfterDays ?? 60}
                                key={config?.returningAfterDays}
                                onBlur={(e) => {
                                    const n = Number(e.target.value);
                                    if (config && Number.isInteger(n) && n !== config.returningAfterDays) {
                                        save.mutate({ returningAfterDays: n });
                                    }
                                }}
                                className="w-24 rounded-md border border-slate-300 px-3 py-1.5 text-sm tabular-nums focus:border-slate-500 focus:outline-none"
                            />
                            <span className="text-sm text-slate-600">days of silence</span>
                        </div>
                    </div>
                </div>

                {/* ---------------------------------------------------------------- log */}
                <div className="px-6 py-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-semibold text-slate-900">What it has done</h3>
                            <p className="mt-0.5 text-xs text-slate-500">
                                Every decision, sent and refused. Newest first.
                            </p>
                        </div>
                        <button
                            onClick={() => refetchLog()}
                            className="flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-400"
                        >
                            <RefreshCw className={cn('h-3.5 w-3.5', logLoading && 'animate-spin')} /> Refresh
                        </button>
                    </div>

                    {!!logData?.summary?.length && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                            {[...logData.summary].sort((a, b) => b.n - a.n).map((s) => {
                                const m = reasonMeta(s.reason);
                                return (
                                    <span key={s.reason} className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium', TONE_CLASS[m.tone])}>
                                        {m.label} {s.n}
                                    </span>
                                );
                            })}
                            <span className="px-1 py-0.5 text-[11px] text-slate-400">last 7 days</span>
                        </div>
                    )}

                    <div className="mt-3 space-y-2">
                        {logLoading && (
                            <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
                                <Loader2 className="h-4 w-4 animate-spin" /> Loading the log…
                            </div>
                        )}
                        {!logLoading && !logData?.rows?.length && (
                            <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                                Nothing logged yet. Every first contact from now on lands here, whether it was answered or not.
                            </div>
                        )}
                        {logData?.rows?.map((row) => <LogEntry key={row.id} row={row} />)}
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
}

/** One decision. The outcome leads, because "why" is the question this log exists to answer. */
function LogEntry({ row }: { row: LogRow }) {
    const [openBody, setOpenBody] = useState(false);
    const meta = reasonMeta(row.reason);

    return (
        <div className={cn('rounded-lg border px-3 py-2.5', row.sent ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50/60')}>
            <div className="flex flex-wrap items-center gap-2">
                <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-semibold', TONE_CLASS[meta.tone])}>
                    {meta.label}
                </span>
                <span className="text-sm font-medium text-slate-900">
                    {row.contactName || row.phone}
                </span>
                {row.contactName && <span className="text-xs text-slate-400">{row.phone}</span>}
                <span className="ml-auto text-xs text-slate-400">{when(row.createdAt)}</span>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">{row.channel}</span>
                {row.intent && <span>{row.intent}</span>}
                {row.contactClass && row.contactClass !== 'first' && <span>· {row.contactClass}</span>}
                {row.mode && <span>· via {row.mode}</span>}
                {row.templateName && <span>· template {row.templateName}</span>}
                {row.outOfHours && <span>· out of hours</span>}
            </div>

            {(meta.blurb || row.detail) && (
                <p className="mt-1 text-xs text-slate-600">
                    {meta.blurb}{row.detail ? ` (${row.detail})` : ''}
                </p>
            )}

            {row.body && (
                <>
                    <button
                        onClick={() => setOpenBody((v) => !v)}
                        className="mt-1.5 text-xs font-medium text-slate-500 underline underline-offset-2 hover:text-slate-800"
                    >
                        {openBody ? 'Hide the message' : row.sent ? 'Show what they got' : 'Show what was written'}
                    </button>
                    {openBody && (
                        <pre className="mt-1.5 whitespace-pre-wrap rounded-md bg-slate-900 px-3 py-2 text-[12px] leading-relaxed text-slate-100">
                            {row.body}
                        </pre>
                    )}
                </>
            )}
        </div>
    );
}
