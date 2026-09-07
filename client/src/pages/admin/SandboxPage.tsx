/**
 * SandboxPage — the comms sandbox (/admin/sandbox, T5).
 *
 * Type as a customer on the left; watch the spine think on the right (LiveRunPanel over the
 * shared SSE stream, kept on screen after the run finishes); read the pass underneath: triage,
 * pack, the proposed reply, guards, decision, cost — and, loudest of all, what the exit WOULD
 * have done, because it did not do it.
 *
 * Nothing here can send. The thread lives on the reserved Ofcom drama number, every pass is a
 * dry run (server/spine/sandbox.ts explains the three layers), and this page never names a
 * conversation id to the server — every call is "the sandbox thread", whichever row that is.
 *
 * T11: a message can carry photos or a video (the Attach control). They are stored the way a real
 * WhatsApp inbound is, so the case file, Gemini's describer and the Scoper see what they would see
 * for a customer; the pass then reports, per item, the description the Scoper read — or the one
 * reason it read nothing. That description is the Scoper's ONLY sight of a photo (it reads media
 * as text), so "What the desk saw" is the point of the exercise, and a missing one is red.
 *
 * Data: GET/POST /api/comms-sandbox (server/spine/sandbox-routes.ts).
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bot, Eye, FlaskConical, ImageIcon, Loader2, Paperclip, RotateCcw, Send, ShieldCheck, User, Video, X } from 'lucide-react';
import { LiveRunPanel } from '@/components/comms/LiveRunPanel';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------- api shapes (server/spine/sandbox-routes.ts)

interface SandboxMessage { id: string; direction: 'inbound' | 'outbound' | string; content: string | null; createdAt: string | null; senderName: string | null; type?: string | null; mediaUrl?: string | null; mediaType?: string | null }
/** T11: this server's description switch and key, read-only (server/spine/sandbox-routes.ts videoStatus). */
export interface SandboxVideoStatus { enabled: boolean; images: boolean; maxPerRun: number; keyPresent: boolean }
export type SandboxMediaStatus = 'described' | 'cached' | 'failed' | 'over_bound' | 'off' | 'images_off' | 'no_key' | 'unsupported' | 'missing';
/** T11: one media item on the case file — what the Scoper read of it, or why it read nothing (mediaReportFor). */
export interface SandboxMediaReport { id: string; kind: 'image' | 'video' | 'audio' | 'document'; url: string | null; description: string | null; status: SandboxMediaStatus; note: string; vision: { runId: string; costPence: number | null; error: string | null } | null }
interface SandboxQuote { id: string; slug: string; jobDescription: string; basePrice: number | null; expiresAt: string | null; createdAt: string | null; depositPaidAt: string | null; revokedAt: string | null }
interface SandboxRunRow { id: string; agent: string; decision: string | null; lane: string | null; costPence: number | null; model: string | null; durationMs: number | null; error: string | null; startedAt: string | null; sandbox: boolean; intent: string | null; bubbles: string[] }
export interface SandboxState {
    phone: { e164: string; wa: string };
    conversation: { id: string; stage: string | null; tags: string[]; contactName: string | null; createdAt: string | null; hasTrigger: boolean } | null;
    messages: SandboxMessage[];
    quote: SandboxQuote | null;
    runs: SandboxRunRow[];
    video?: SandboxVideoStatus;
}
export interface SandboxRun {
    runId: string;
    agent: string;
    pack: { id: string; version: number };
    triage: { lane: string; intent: string; exceptions: string[]; tags: string[]; reasons: string[]; source: string; model?: string | null };
    proposal: { intent: string; body: string[]; reasons: string[]; flag?: { exception: string; note: string } | null; tags?: string[]; artifact?: { kind: string; summary: string } | null } | null;
    guards: { ok: boolean; guardsHit: string[]; escalate: boolean; notes: string[] } | null;
    decision: { kind: string; approver?: string; reason?: string; exception?: string; dueAt?: string; note?: string };
    dryRun: boolean;
    sandbox: boolean;
    exitNote: string | null;
    skipped: string[];
    error: string | null;
    durationMs: number | null;
    costPence: number | null;
    model: string | null;
    caseFile: { stage: string; tags: string[]; quote: { slug: string; total?: number | null; paid: boolean } | null; window: { canFreeform: boolean; templateRequired: boolean } };
    benLaneClerk: { run: boolean; reason: string } | null;
    routeA: { ran: boolean; reason?: string } | null;
    /**
     * T6: set when the pass was first contact and the sandbox mirrored the rules layer's ack onto
     * the thread (server/spine/sandbox-routes.ts). Rides on the run so the detail can say why the
     * desk was quiet and what the customer would actually have received.
     */
    mirrored?: SandboxMirror | null;
    /** T11: per media item on the thread, the description the Scoper read or why there is none. */
    media?: SandboxMediaReport[] | null;
    video?: SandboxVideoStatus | null;
}
export interface SandboxMirror { kind: 'first_contact_ack'; intent: string; body: string; messageId: string; note: string }

/** T6: the mirrored rules-layer ack carries this sender name (server/spine/sandbox-routes.ts). */
export const RULES_ACK_SENDER_MARK = 'rules layer ack';
export function isMirroredAck(m: { direction: string; senderName: string | null }): boolean {
    return m.direction === 'outbound' && !!m.senderName && m.senderName.toLowerCase().includes(RULES_ACK_SENDER_MARK);
}

function authHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
    // T11: a FormData body sets its own multipart boundary — never force a content type on it.
    const multipart = typeof FormData !== 'undefined' && init?.body instanceof FormData;
    const res = await fetch(`/api/comms-sandbox${path}`, {
        ...init,
        headers: { ...(multipart ? {} : { 'Content-Type': 'application/json' }), ...authHeaders(), ...(init?.headers ?? {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
    return body as T;
}

// ---------------------------------------------------------------- pure helpers (tested)

/** Pence → "£4.80" / "£480.00"; null when the row has no cost yet. */
export function pounds(pence: number | null | undefined): string | null {
    if (pence == null || !Number.isFinite(pence)) return null;
    return `£${(pence / 100).toFixed(2)}`;
}

/** The decision, in the words the page shows. `send` is the one that must never read softly. */
export function decisionLabel(d: SandboxRun['decision']): { text: string; tone: 'send' | 'draft' | 'flag' | 'quiet' } {
    switch (d.kind) {
        case 'send': return { text: `SEND — would go to the customer with no approval (${d.approver ?? 'agent'})`, tone: 'send' };
        case 'pending': return { text: `DRAFT for Ben — ${d.reason ?? ''}`.trim(), tone: 'draft' };
        case 'flag': return { text: `FLAG for Ben — ${d.exception ?? ''}`.trim(), tone: 'flag' };
        case 'drop': return { text: `DROP — ${d.reason ?? ''}`.trim(), tone: 'quiet' };
        case 'none': return { text: `NOTHING — ${d.reason ?? ''}`.trim(), tone: 'quiet' };
        default: return { text: d.kind, tone: 'quiet' };
    }
}

/**
 * The five known wrong-move shapes (PRD §5, the 7 reject-`wrong_move` verdicts). These are
 * CUSTOMER lines to throw at the desk, not reply templates: the assistant's words stay its own.
 * Four of the five only exist with a live unpaid quote on the thread — seed one first.
 */
export const WRONG_MOVE_SHAPES: { label: string; needsQuote: boolean; text: string }[] = [
    { label: 'Objects on price', needsQuote: true, text: "That's a lot more than I was expecting to be honest. Is there any movement on that?" },
    { label: 'Quote too expensive', needsQuote: true, text: 'Sorry, the quote is too expensive for us. We will have to leave it.' },
    { label: 'Wants a call before paying', needsQuote: true, text: "Before I pay anything I'd like to speak to someone about it. Can someone give me a ring?" },
    { label: 'Skirts a negotiation', needsQuote: true, text: 'Hmm. What would it come to if I did the painting myself and you just did the fan?' },
    { label: 'Demands a price', needsQuote: false, text: 'Just tell me how much it is going to cost. I need a number before I go any further.' },
];

/** T11: the status pill on each media item. Anything but described/cached is a fault to look at. */
export function mediaStatusLabel(status: SandboxMediaStatus, maxPerRun?: number | null): { text: string; tone: 'ok' | 'warn' | 'bad' } {
    switch (status) {
        case 'described': return { text: 'Described — on the case file the Scoper read', tone: 'ok' };
        case 'cached': return { text: 'Described (from cache, no model call) — on the case file the Scoper read', tone: 'ok' };
        case 'over_bound': return { text: `NOT described — over the per-pass bound (only the last ${maxPerRun ?? 'N'} are described)`, tone: 'warn' };
        case 'failed': return { text: 'DESCRIPTION FAILED — the Scoper saw bare media', tone: 'bad' };
        case 'off': return { text: 'NOT described — description is OFF on this server (spine.video.enabled)', tone: 'bad' };
        case 'images_off': return { text: 'NOT described — photos are off on this server (spine.video.images)', tone: 'bad' };
        case 'no_key': return { text: 'NOT described — GEMINI_API_KEY is not set on this server', tone: 'bad' };
        case 'unsupported': return { text: 'NOT described — only photos and videos are described', tone: 'warn' };
        default: return { text: 'NOT described — no description and no vision row; check the server log', tone: 'bad' };
    }
}

/** T11: the banner over the composer, or null when description is on and the key is there. */
export function videoWarning(v: SandboxVideoStatus | null | undefined): string | null {
    if (!v) return null;
    if (!v.enabled) return 'Photo and video description is OFF on this server (spine.video.enabled is false). A photo will reach the desk as bare media with no description — that is what the Scoper sees live when the switch is off.';
    if (!v.keyPresent) return 'GEMINI_API_KEY is not set on this server, so every description will FAIL. The desk will see bare media. (Production has the key; your local .env needs it too.)';
    if (!v.images) return 'Photos are not described on this server (spine.video.images is false); only videos are. A photo will reach the desk as bare media.';
    return null;
}

/** T11: which of the pending attachments would be described, by the same last-N rule the case file uses. */
export function attachmentsOverBound(count: number, v: SandboxVideoStatus | null | undefined): number {
    if (!v || !v.enabled) return 0;
    return Math.max(0, count - Math.max(1, v.maxPerRun));
}

const MEDIA_TONE_CLASSES: Record<ReturnType<typeof mediaStatusLabel>['tone'], string> = {
    ok: 'bg-emerald-100 text-emerald-900',
    warn: 'bg-amber-100 text-amber-900',
    bad: 'bg-red-100 text-red-900',
};

/** T11: the server's bounds (SANDBOX_MAX_FILES / SANDBOX_MEDIA_TYPES in sandbox-routes.ts), mirrored for the picker. */
export const MAX_ATTACHMENTS = 8;
export const ACCEPT_MEDIA = 'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,video/mp4,video/quicktime,video/webm,video/3gpp';

const TONE_CLASSES: Record<ReturnType<typeof decisionLabel>['tone'], string> = {
    send: 'border-red-300 bg-red-50 text-red-900',
    draft: 'border-sky-200 bg-sky-50 text-sky-900',
    flag: 'border-violet-200 bg-violet-50 text-violet-900',
    quiet: 'border-slate-200 bg-slate-50 text-slate-800',
};

// ---------------------------------------------------------------- pieces

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="grid grid-cols-[7rem_1fr] gap-2 text-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="min-w-0 break-words">{children}</div>
        </div>
    );
}

function Chips({ items, empty = '—' }: { items: string[] | undefined | null; empty?: string }) {
    if (!items?.length) return <span className="text-muted-foreground">{empty}</span>;
    return (
        <span className="flex flex-wrap gap-1">
            {items.map((t) => <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">{t}</span>)}
        </span>
    );
}

function isVideoType(t: string | null | undefined): boolean {
    return (t ?? '').toLowerCase().startsWith('video');
}

/** A stored media item, rendered as CommsPage renders a customer's (img / video off /api/media). */
function MediaThumb({ url, video, className }: { url: string; video: boolean; className?: string }) {
    return video
        ? <video src={url} controls preload="metadata" className={cn('max-h-56 max-w-full rounded-lg', className)} />
        : <img src={url} alt="" loading="lazy" className={cn('max-h-56 max-w-full rounded-lg', className)} />;
}

/** T11: what the desk saw of each photo or video on the thread. The description is the whole point. */
export function MediaSeen({ media, video }: { media: SandboxMediaReport[]; video?: SandboxVideoStatus | null }) {
    const described = media.filter((m) => m.status === 'described' || m.status === 'cached').length;
    return (
        <div className="rounded-lg border p-3" data-testid="sandbox-media-seen">
            <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold"><Eye className="h-4 w-4 text-blue-600" /> What the desk saw</div>
                <span className={cn('rounded px-1.5 py-0.5 text-xs font-semibold', described === media.length ? 'bg-emerald-100 text-emerald-900' : 'bg-red-100 text-red-900')}>
                    {described} of {media.length} described
                </span>
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
                The Scoper reads media as text: the id, the kind, and Gemini's description if there is one. It never sees the pixels. Its case-file summary carries the first 160 characters of each description (the clip in scoper.ts), so the reply was written from the start of the text below, not all of it.
            </p>
            <ul className="space-y-2">
                {media.map((m) => {
                    const label = mediaStatusLabel(m.status, video?.maxPerRun);
                    return (
                        <li key={m.id} className="flex gap-3 rounded-lg border bg-white p-2" data-testid="sandbox-media-item" data-status={m.status}>
                            <div className="w-24 shrink-0">
                                {m.url && (m.kind === 'image' || m.kind === 'video')
                                    ? <MediaThumb url={m.url} video={m.kind === 'video'} className="h-24 w-24 object-cover" />
                                    : <div className="flex h-24 w-24 items-center justify-center rounded-lg bg-slate-100 text-xs text-muted-foreground">{m.kind}</div>}
                            </div>
                            <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                    {m.kind === 'video' ? <Video className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
                                    <span className="font-mono text-muted-foreground">{m.id}</span>
                                    <span className={cn('rounded px-1.5 py-0.5 font-semibold', MEDIA_TONE_CLASSES[label.tone])}>{label.text}</span>
                                </div>
                                {m.description
                                    ? <div className="whitespace-pre-wrap rounded border border-emerald-200 bg-emerald-50/60 px-2 py-1.5 text-sm text-slate-800" data-testid="sandbox-media-description">{m.description}</div>
                                    : <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-sm text-red-900" data-testid="sandbox-media-missing">No description. {m.note}</div>}
                                {m.description && m.status !== 'described' && m.status !== 'cached' && <div className="text-xs text-amber-800">{m.note}</div>}
                                {m.vision && (
                                    <div className="text-xs text-muted-foreground">
                                        vision run <span className="font-mono">{m.vision.runId}</span>{m.vision.costPence != null ? ` · ${pounds(m.vision.costPence)}` : ''}{m.vision.error ? <span className="text-red-700"> · {m.vision.error}</span> : null}
                                    </div>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

/** The whole pass, once it has come back. The exit line sits on top because it is the point. */
export function RunDetail({ run }: { run: SandboxRun }) {
    const d = decisionLabel(run.decision);
    return (
        <div className="space-y-4" data-testid="sandbox-run-detail">
            <div className={cn('rounded-lg border-2 border-dashed p-3', 'border-amber-400 bg-amber-50')} data-testid="sandbox-exit-note">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                    <ShieldCheck className="h-4 w-4" /> NOT SENT — dry run
                </div>
                <p className="mt-1 text-sm text-amber-900">{run.exitNote ?? 'DRY RUN — nothing sent.'}</p>
            </div>

            <div className={cn('rounded-lg border p-3 text-sm font-medium', TONE_CLASSES[d.tone])} data-testid="sandbox-decision">
                Decision: {d.text}
            </div>

            {run.mirrored && (
                <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900" data-testid="sandbox-mirrored">
                    <div className="font-semibold">First contact — the rules layer answers, not the desk</div>
                    <p className="mt-1">{run.mirrored.note}</p>
                    <div className="mt-2 whitespace-pre-wrap rounded-2xl rounded-tr-sm border border-dashed border-sky-300 bg-white px-3 py-2 text-sm text-slate-800">{run.mirrored.body}</div>
                </div>
            )}

            {run.proposal ? (
                <div className="rounded-lg border p-3">
                    <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-semibold">Proposed reply <span className="font-normal text-muted-foreground">(intent <span className="font-mono">{run.proposal.intent}</span>)</span></div>
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">not sent</span>
                    </div>
                    {run.proposal.body.length ? (
                        <div className="space-y-1.5">
                            {run.proposal.body.map((b, i) => (
                                <div key={i} className="whitespace-pre-wrap rounded-2xl rounded-tr-sm border border-dashed border-amber-300 bg-white px-3 py-2 text-sm">{b}</div>
                            ))}
                        </div>
                    ) : <div className="text-sm text-muted-foreground">No words — side effects only{run.proposal.flag ? ` (flag: ${run.proposal.flag.exception})` : ''}.</div>}
                    {run.proposal.reasons.length > 0 && (
                        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-600">
                            {run.proposal.reasons.map((r, i) => <li key={i}>{r}</li>)}
                        </ul>
                    )}
                    {run.proposal.flag && <div className="mt-2 text-xs text-violet-800">Flag for Ben: {run.proposal.flag.exception} — {run.proposal.flag.note}</div>}
                    {run.proposal.artifact && <div className="mt-2 text-xs text-slate-600">Artifact: {run.proposal.artifact.kind} — {run.proposal.artifact.summary}</div>}
                </div>
            ) : (
                <div className="rounded-lg border p-3 text-sm text-muted-foreground" data-testid="sandbox-no-proposal">
                    {run.error
                        ? <><span className="font-medium text-red-700">No proposal: the agent failed.</span> {run.error}</>
                        : run.triage.lane === 'rules'
                            ? 'No proposal from the desk: this pass landed on the rules lane, which runs no agent.'
                            : run.agent === 'triage'
                                ? `No proposal: lane ${run.triage.lane} runs no agent; triage decided alone.`
                                : 'No proposal: the agent chose to say nothing.'}
                </div>
            )}

            {run.media && run.media.length > 0 && <MediaSeen media={run.media} video={run.video ?? null} />}

            <div className="space-y-2 rounded-lg border p-3">
                <Field label="Triage">
                    lane <span className="font-mono">{run.triage.lane}</span>, intent <span className="font-mono">{run.triage.intent}</span>, by {run.triage.source}{run.triage.model ? ` (${run.triage.model})` : ''}
                </Field>
                <Field label="Exceptions"><Chips items={run.triage.exceptions} empty="none" /></Field>
                <Field label="Tags"><Chips items={[...run.caseFile.tags, ...run.triage.tags]} empty="none" /></Field>
                {run.triage.reasons.length > 0 && (
                    <Field label="Why">
                        <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-600">{run.triage.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                    </Field>
                )}
                <Field label="Pack">
                    <span className="font-mono">{run.pack.id} v{run.pack.version}</span> → agent <span className="font-mono">{run.agent}</span>
                    {run.benLaneClerk ? <span className="text-xs text-muted-foreground"> · Ben-lane clerk: {run.benLaneClerk.run ? 'prepared' : 'no'} ({run.benLaneClerk.reason})</span> : null}
                </Field>
                <Field label="Guards">
                    {run.guards
                        ? run.guards.ok
                            ? <span className="text-emerald-700">clear</span>
                            : <span className="text-red-700">{run.guards.guardsHit.join(', ')}{run.guards.escalate ? ' — escalates to Ben' : ''}{run.guards.notes.length ? ` · ${run.guards.notes.join('; ')}` : ''}</span>
                        : <span className="text-muted-foreground">not run (no proposal)</span>}
                </Field>
                <Field label="Quote seen">
                    {run.caseFile.quote ? <>{run.caseFile.quote.slug} · {run.caseFile.quote.paid ? 'paid' : 'unpaid'}{run.caseFile.quote.total != null ? ` · £${run.caseFile.quote.total}` : ''}</> : <span className="text-muted-foreground">none on the thread</span>}
                </Field>
                <Field label="Window">{run.caseFile.window.canFreeform ? 'open (freeform ok)' : 'shut (template required)'}</Field>
                <Field label="Cost">
                    {pounds(run.costPence) ?? <span className="text-muted-foreground">not recorded</span>}
                    {run.model ? <span className="text-xs text-muted-foreground"> · {run.model}</span> : null}
                    {run.durationMs != null ? <span className="text-xs text-muted-foreground"> · {(run.durationMs / 1000).toFixed(1)}s</span> : null}
                </Field>
                {run.skipped.length > 0 && (
                    <Field label="Skipped">
                        <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-600">{run.skipped.map((s, i) => <li key={i}>{s}</li>)}</ul>
                    </Field>
                )}
                {run.error && <Field label="Error"><span className="text-red-700">{run.error}</span></Field>}
                <Field label="Run id"><span className="font-mono text-xs">{run.runId}</span></Field>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------- the page

export default function SandboxPage() {
    const queryClient = useQueryClient();
    const [text, setText] = useState('');
    const [files, setFiles] = useState<File[]>([]);
    const [amount, setAmount] = useState('480');
    const [lastRun, setLastRun] = useState<SandboxRun | null>(null);
    const [error, setError] = useState<string | null>(null);
    const bottomRef = useRef<HTMLDivElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const state = useQuery<SandboxState>({
        queryKey: ['comms-sandbox'],
        queryFn: () => api<SandboxState>(''),
        refetchOnWindowFocus: false,
    });
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['comms-sandbox'] });
    /**
     * T6: every POST answers with the thread as it now stands. Paint that at once rather than
     * waiting for a refetch — seen live, the proposed-reply bubble landed before the customer's
     * own line was back, so the chat read out of order for a beat. A response without state
     * (an older server) falls back to the refetch.
     */
    const applyState = (next: SandboxState | undefined) => {
        if (next) queryClient.setQueryData(['comms-sandbox'], next);
        else refresh();
    };

    const reset = useMutation({
        mutationFn: () => api<{ ok: true; state?: SandboxState }>('/reset', { method: 'POST' }),
        onSuccess: (r) => { setLastRun(null); setError(null); setFiles([]); applyState(r.state); },
        onError: (e: Error) => setError(e.message),
    });
    const seedQuote = useMutation({
        mutationFn: () => api<{ ok: true; state?: SandboxState }>('/quote', { method: 'POST', body: JSON.stringify({ totalPence: Math.round(Number(amount) * 100) }) }),
        // T6: the previous pass's proposed bubble would otherwise sit under the new quote bubble.
        onSuccess: (r) => { setError(null); setLastRun(null); applyState(r.state); },
        onError: (e: Error) => setError(e.message),
    });
    type SendVars = { text: string; files: File[] };
    type SendReply = { ok: true; run: SandboxRun; mirrored?: SandboxMirror | null; media?: SandboxMediaReport[] | null; video?: SandboxVideoStatus | null; state?: SandboxState };
    const send = useMutation({
        // T11: with attachments the body is multipart (text + media files); without, the JSON body as before.
        mutationFn: (v: SendVars) => {
            if (!v.files.length) return api<SendReply>('/message', { method: 'POST', body: JSON.stringify({ text: v.text }) });
            const form = new FormData();
            form.append('text', v.text);
            for (const f of v.files) form.append('media', f, f.name);
            return api<SendReply>('/message', { method: 'POST', body: form });
        },
        onMutate: () => { setError(null); setLastRun(null); },
        onSuccess: (r) => { applyState(r.state); setLastRun({ ...r.run, mirrored: r.mirrored ?? null, media: r.media ?? null, video: r.video ?? null }); setText(''); setFiles([]); },
        onError: (e: Error) => setError(e.message),
    });

    const conv = state.data?.conversation ?? null;
    const msgs = state.data?.messages ?? [];
    const quote = state.data?.quote ?? null;
    const video = state.data?.video ?? null;
    const busy = send.isPending || reset.isPending || seedQuote.isPending;
    const amountOk = Number.isFinite(Number(amount)) && Number(amount) >= 1 && Number(amount) <= 20_000;
    const warning = videoWarning(video);
    const overBound = attachmentsOverBound(files.length, video);

    useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [msgs.length, lastRun?.runId, send.isPending]);

    // T11: object urls for the previews, revoked when the set changes (jsdom has no createObjectURL).
    const [previews, setPreviews] = useState<string[]>([]);
    useEffect(() => {
        const make = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
        const urls = files.map((f) => (make ? URL.createObjectURL(f) : ''));
        setPreviews(urls);
        return () => { if (make) for (const u of urls) if (u) URL.revokeObjectURL(u); };
    }, [files]);

    const submit = () => {
        const t = text.trim();
        if ((!t && !files.length) || busy) return;
        send.mutate({ text: t, files });
    };
    const addFiles = (list: FileList | null) => {
        if (!list) return;
        // T13: copy the FileList NOW, before anything else. A file input's FileList is live and
        // clearing the input's value (below, so the same photo can be picked twice) empties it;
        // React runs a state updater lazily whenever the component has another update pending,
        // which this page nearly always has. Reading the list inside the updater attached nothing
        // in the owner's browser — the file never left the page (T13).
        const picked = Array.from(list);
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (!picked.length) return;
        setFiles((prev) => [...prev, ...picked].slice(0, MAX_ATTACHMENTS));
    };
    const removeFile = (i: number) => setFiles((prev) => prev.filter((_, j) => j !== i));

    return (
        <div className="mx-auto max-w-6xl space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-bold"><FlaskConical className="h-6 w-6 text-amber-600" /> Comms sandbox</h1>
                    <p className="text-sm text-muted-foreground">Type as a customer. Watch the desk triage, think, and propose. Nothing is ever sent.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => reset.mutate()} disabled={busy} data-testid="sandbox-reset">
                        {reset.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1 h-4 w-4" />}
                        {conv ? 'Reset thread' : 'Start a clean thread'}
                    </Button>
                </div>
            </div>

            <div className="flex items-start gap-2 rounded-lg border-2 border-amber-400 bg-amber-50 p-3 text-sm text-amber-900" role="status" data-testid="sandbox-banner">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                    <span className="font-semibold">Dry run only.</span> This thread lives on the reserved test number <span className="font-mono">{state.data?.phone.e164 ?? '+447700900942'}</span> (no subscriber exists),
                    every pass skips the exit (the only sender), and no schedule can ever pick it up. Replies shown here would have gone out live — they did not.
                </div>
            </div>

            {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</div>}

            <div className="grid gap-4 lg:grid-cols-2">
                {/* ---------------- left: the conversation */}
                <section className="flex min-h-[32rem] flex-col rounded-lg border">
                    <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
                        <div className="flex items-center gap-2 font-medium"><User className="h-4 w-4" /> {conv?.contactName ?? 'No thread yet'}</div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {conv && <span>stage <span className="font-mono">{conv.stage ?? 'enquiry'}</span></span>}
                            {quote && !quote.depositPaidAt && !quote.revokedAt && <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">unpaid quote {quote.slug}{quote.basePrice != null ? ` · ${pounds(quote.basePrice)}` : ''}</span>}
                        </div>
                    </div>

                    <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50/60 p-3" data-testid="sandbox-thread">
                        {state.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
                        {!state.isLoading && !conv && (
                            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                                No sandbox thread yet. Press <span className="font-medium">Start a clean thread</span>, then type a message below as the customer would.
                            </div>
                        )}
                        {msgs.map((m) => {
                            const inbound = m.direction === 'inbound';
                            return (
                                <div key={m.id} className={cn('flex', inbound ? 'justify-start' : 'justify-end')}>
                                    <div className={cn('max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm shadow-sm', inbound ? 'rounded-tl-sm bg-white' : 'rounded-tr-sm bg-emerald-100')}>
                                        {!inbound && (
                                            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                                                {isMirroredAck(m) ? 'rules layer ack · mirrored · never sent' : 'synthetic · never sent'}
                                            </div>
                                        )}
                                        {m.mediaUrl && (
                                            <div className="mb-1" data-testid="sandbox-bubble-media">
                                                <MediaThumb url={m.mediaUrl} video={isVideoType(m.mediaType) || m.type === 'video'} />
                                            </div>
                                        )}
                                        {m.content}
                                    </div>
                                </div>
                            );
                        })}
                        {send.isPending && send.variables && (
                            // T6: the line just sent, shown at once — the row exists server-side before the pass starts.
                            <div className="flex justify-start" data-testid="sandbox-pending-inbound">
                                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-sm shadow-sm">
                                    {send.variables.files.length > 0 && (
                                        <div className="mb-1 flex flex-wrap gap-1">
                                            {send.variables.files.map((f, i) => (
                                                <span key={i} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">{f.type.startsWith('video') ? '🎬' : '📷'} {f.name}</span>
                                            ))}
                                        </div>
                                    )}
                                    {send.variables.text}
                                </div>
                            </div>
                        )}
                        {send.isPending && (
                            <div className="flex justify-end">
                                <div className="flex items-center gap-2 rounded-2xl rounded-tr-sm border border-dashed border-amber-300 bg-white px-3 py-2 text-sm text-muted-foreground">
                                    <Bot className="h-4 w-4 text-blue-600" /><Loader2 className="h-3 w-3 animate-spin" /> the desk is thinking…
                                </div>
                            </div>
                        )}
                        {lastRun && (
                            <div className="flex justify-end" data-testid="sandbox-proposed-bubble">
                                <div className="max-w-[85%]">
                                    <div className="mb-0.5 text-right text-[10px] font-semibold uppercase tracking-wide text-amber-800">proposed reply · NOT SENT · dry run</div>
                                    {lastRun.proposal?.body.length
                                        ? lastRun.proposal.body.map((b, i) => (
                                            <div key={i} className="mb-1 whitespace-pre-wrap rounded-2xl rounded-tr-sm border-2 border-dashed border-amber-400 bg-amber-50 px-3 py-2 text-sm">{b}</div>
                                        ))
                                        : lastRun.mirrored
                                            ? <div className="rounded-2xl rounded-tr-sm border-2 border-dashed border-slate-300 bg-white px-3 py-2 text-sm italic text-muted-foreground">(first contact: the rules layer's ack above is what the customer gets; the desk answers from the next message)</div>
                                            : <div className="rounded-2xl rounded-tr-sm border-2 border-dashed border-slate-300 bg-white px-3 py-2 text-sm italic text-muted-foreground">(no reply proposed — {decisionLabel(lastRun.decision).text})</div>}
                                </div>
                            </div>
                        )}
                        <div ref={bottomRef} />
                    </div>

                    <div className="space-y-2 border-t p-3">
                        <div className="flex flex-wrap gap-1.5">
                            {WRONG_MOVE_SHAPES.map((s) => (
                                <button
                                    key={s.label}
                                    type="button"
                                    onClick={() => setText(s.text)}
                                    disabled={busy}
                                    title={s.needsQuote && !quote ? 'Seed an unpaid quote first — this shape only exists once a quote is out' : s.text}
                                    className={cn('rounded-full border px-2 py-0.5 text-xs hover:bg-slate-100', s.needsQuote && !quote ? 'border-dashed text-muted-foreground' : 'text-slate-700')}
                                >
                                    {s.label}{s.needsQuote ? ' 💷' : ''}
                                </button>
                            ))}
                        </div>
                        {warning && (
                            <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-2 text-xs text-red-900" role="status" data-testid="sandbox-video-warning">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{warning}</span>
                            </div>
                        )}
                        <Textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
                            placeholder={conv ? 'Type as the customer… (Enter to send, Shift+Enter for a new line; attach a photo or video below)' : 'Start a clean thread first'}
                            rows={3}
                            disabled={!conv || busy}
                            data-testid="sandbox-input"
                        />
                        {files.length > 0 && (
                            <div className="space-y-1" data-testid="sandbox-attachments">
                                <div className="flex flex-wrap gap-1.5">
                                    {files.map((f, i) => (
                                        <span key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-full border bg-white px-2 py-0.5 text-xs" data-testid="sandbox-attachment">
                                            {previews[i] && !f.type.startsWith('video') ? <img src={previews[i]} alt="" className="h-5 w-5 rounded object-cover" /> : f.type.startsWith('video') ? <Video className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
                                            <span className="max-w-[10rem] truncate">{f.name}</span>
                                            <span className="text-muted-foreground">{(f.size / (1024 * 1024)).toFixed(1)} MB</span>
                                            <button type="button" onClick={() => removeFile(i)} disabled={busy} aria-label={`remove ${f.name}`} className="rounded hover:bg-slate-100"><X className="h-3 w-3" /></button>
                                        </span>
                                    ))}
                                </div>
                                {overBound > 0 && (
                                    <div className="text-xs text-amber-800" data-testid="sandbox-over-bound">
                                        Only the last {video?.maxPerRun} will be described (spine.video.maxPerRun): the first {overBound} will reach the desk as bare media. That is what happens live in a burst.
                                    </div>
                                )}
                            </div>
                        )}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-1 text-xs">
                                <span className="text-muted-foreground">Seed an unpaid quote for £</span>
                                <input
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    inputMode="decimal"
                                    className="w-16 rounded border px-1.5 py-0.5 text-xs"
                                    aria-label="quote amount in pounds"
                                />
                                <Button variant="outline" size="sm" onClick={() => seedQuote.mutate()} disabled={!conv || busy || !amountOk} data-testid="sandbox-seed-quote">
                                    {seedQuote.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}Seed quote
                                </Button>
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept={ACCEPT_MEDIA}
                                    multiple
                                    className="hidden"
                                    onChange={(e) => addFiles(e.target.files)}
                                    data-testid="sandbox-file-input"
                                />
                                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={!conv || busy || files.length >= MAX_ATTACHMENTS} data-testid="sandbox-attach" title="Attach a photo or video, as the customer would">
                                    <Paperclip className="mr-1 h-4 w-4" /> Attach
                                </Button>
                                <Button onClick={submit} disabled={!conv || busy || (!text.trim() && !files.length)} data-testid="sandbox-send">
                                    {send.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
                                    Send as customer
                                </Button>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ---------------- right: the desk thinking */}
                <section className="space-y-4">
                    <div className="rounded-lg border p-3">
                        <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Bot className="h-4 w-4 text-blue-600" /> Live: what the desk is doing</div>
                        {conv ? (
                            <>
                                <LiveRunPanel conversationId={conv.id} keepFinished />
                                {!send.isPending && !lastRun && <div className="text-sm text-muted-foreground">Send a message and the pass appears here step by step: case file (with how many media were described), triage, pack, each tool the Scoper calls, the proposal, guards, decision, exit.</div>}
                            </>
                        ) : <div className="text-sm text-muted-foreground">Start a thread to watch runs.</div>}
                    </div>

                    {lastRun
                        ? <RunDetail run={lastRun} />
                        : (
                            <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                                The last pass's detail lands here: the exit line (what would have happened), decision, proposed reply, triage, pack, guards and cost.
                            </div>
                        )}

                    {(state.data?.runs.length ?? 0) > 0 && (
                        <div className="rounded-lg border p-3">
                            <div className="mb-2 text-sm font-medium">Earlier passes on this thread</div>
                            <ul className="divide-y text-xs">
                                {state.data!.runs.map((r) => (
                                    <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5">
                                        <span className="font-mono text-muted-foreground">{r.startedAt ? new Date(r.startedAt).toLocaleTimeString('en-GB') : ''}</span>
                                        <span className="font-mono">{r.lane ?? '—'}</span>
                                        <span>→ <span className="font-medium">{r.decision ?? '—'}</span>{r.intent ? ` (${r.intent})` : ''}</span>
                                        <span className="text-muted-foreground">{pounds(r.costPence) ?? 'no cost'}</span>
                                        {!r.sandbox && <span className="rounded bg-red-100 px-1 text-red-800">not marked sandbox</span>}
                                        {r.error && <span className="text-red-700">{r.error}</span>}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
