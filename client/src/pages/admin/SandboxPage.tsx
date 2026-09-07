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
 * T16: the thread is opened through one of the four real front doors (inbound WhatsApp, post-call
 * with WhatsApp agreed, webform, inbound SMS), each seeded the way the live writer seeds it and each
 * reporting the first thing the customer would receive and by which rung of which ladder. The 24 h
 * messaging window is shown as the case file will read it and can be shut honestly (move the thread
 * back in time) and observed (a clock pass with no new message). The funnel runs to the end: the
 * clerk's draft priced by the engine, "Ben would have been pinged" recorded rather than sent, Ben's
 * send, questions before and after, the customer's acceptance. Nothing on this page can send.
 *
 * Data: GET/POST /api/comms-sandbox (server/spine/sandbox-routes.ts).
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BellRing, Bot, Clock, DoorOpen, Eye, FlaskConical, ImageIcon, Loader2, MessageSquare, Paperclip, Phone, RotateCcw, Send, ShieldCheck, Smartphone, User, Video, X } from 'lucide-react';
import { LiveRunPanel } from '@/components/comms/LiveRunPanel';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------- api shapes (server/spine/sandbox-routes.ts)

interface SandboxMessage { id: string; direction: 'inbound' | 'outbound' | string; content: string | null; createdAt: string | null; senderName: string | null; channel?: string | null; type?: string | null; mediaUrl?: string | null; mediaType?: string | null }
/** T11: this server's description switch and key, read-only (server/spine/sandbox-routes.ts videoStatus). */
/** T14: the describer's verdict from the newest vision rows (server/spine/vision-health.ts), the same one the sidebar badge shows. */
export interface SandboxVisionHealth { status: 'ok' | 'failing' | 'idle' | 'unknown'; failing: boolean; permanent: boolean; reason: string | null; since: string | null; lastAt: string | null; window: { runs: number; failed: number; described: number } }
export interface SandboxVideoStatus { enabled: boolean; images: boolean; maxPerRun: number; keyPresent: boolean; health?: SandboxVisionHealth | null }
export type SandboxMediaStatus = 'described' | 'cached' | 'failed' | 'over_bound' | 'off' | 'images_off' | 'no_key' | 'unsupported' | 'missing';
/** T11: one media item on the case file — what the Scoper read of it, or why it read nothing (mediaReportFor). */
export interface SandboxMediaReport { id: string; kind: 'image' | 'video' | 'audio' | 'document'; url: string | null; description: string | null; status: SandboxMediaStatus; note: string; vision: { runId: string; costPence: number | null; error: string | null } | null }
interface SandboxQuote { id: string; slug: string; jobDescription: string; basePrice: number | null; expiresAt: string | null; createdAt: string | null; depositPaidAt: string | null; revokedAt: string | null }
interface SandboxRunRow { id: string; agent: string; trigger?: string | null; decision: string | null; lane: string | null; costPence: number | null; model: string | null; durationMs: number | null; error: string | null; startedAt: string | null; sandbox: boolean; intent: string | null; bubbles: string[] }
/** T16: the four front doors (server/spine/sandbox-scenarios.ts). */
export type SandboxDoor = 'whatsapp' | 'post_call' | 'webform' | 'sms';
export const SANDBOX_DOORS: readonly SandboxDoor[] = ['whatsapp', 'post_call', 'webform', 'sms'];
export interface LadderRung { name: string; status: string; picked: boolean; note: string }
export interface AckPlan { door: SandboxDoor; intent: string; mode: 'freeform' | 'template' | 'sms' | 'queued' | 'refused'; channel: 'whatsapp' | 'sms' | null; body: string | null; templateName: string | null; rungs: LadderRung[]; outOfHours: boolean; gate: { enabled: boolean; channelOn: boolean; askForMedia: boolean; liveWouldSend: boolean }; reason: string; holdSeconds: [number, number] }
export interface PostCallPlan { route: { send: boolean; reason: string; callbackDue: boolean; tagNoAutoMessages: boolean; complaintAlert: boolean }; body: string | null; templateName: string | null; rungs: LadderRung[]; outcome: 'template' | 'no_approved_template' | 'not_agreed'; reason: string; approval: 'auto_first_contact' | 'queued_for_approval'; gate: { continuationEnabled: boolean; ackEnabled: boolean; ackChannelOn: boolean; liveWouldSend: boolean }; spineRun: 'call_ended' | null; spineRunReason: string; call: { id: string; preview: string; durationSeconds: number; transcriptChars: number } }
export interface EntryReport { door: SandboxDoor; meaning: { label: string; window: string; firstReply: string }; ack: AckPlan | null; postCall: PostCallPlan | null; mirrored: { messageId: string; channel: 'whatsapp' | 'sms'; body: string; sender: string } | null; firstRunTrigger: 'inbound_message' | 'call_ended' | null }
export interface WindowReport { canFreeform: boolean; lastWhatsAppInboundAt: string | null; hoursSince: number | null; channelLastUsed: string | null; summary: string; permits: string }
export interface SandboxGates { firstContactAck: { enabled: boolean; channels: string[]; askForMedia: boolean }; postCallContinuation: { enabled: boolean }; spineEnabled: boolean; smsSenderConfigured: boolean; templates: Array<{ name: string; status: string }> }
export interface SandboxEvent { at: string; kind: string; summary: string; detail?: unknown }
export interface BenNotice { event: string; title: string; message: string; link: string | null }
export interface SandboxFunnel { stage: string | null; draft: { id: string; slug: string; lines: string[]; suggestedTotalPence: number | null; checkThis: number; createdAt: string | null; customerName: string | null } | null; quote: { slug: string; basePrice: number | null; delivered: boolean; accepted: boolean; expiresAt: string | null } | null }
export interface SandboxState {
    phone: { e164: string; wa: string };
    conversation: { id: string; stage: string | null; tags: string[]; contactName: string | null; createdAt: string | null; hasTrigger: boolean } | null;
    messages: SandboxMessage[];
    quote: SandboxQuote | null;
    runs: SandboxRunRow[];
    video?: SandboxVideoStatus;
    /** T16 */
    door?: SandboxDoor | null;
    entry?: EntryReport | null;
    events?: SandboxEvent[];
    window?: WindowReport | null;
    gates?: SandboxGates | null;
    funnel?: SandboxFunnel | null;
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
    /** T16: the proposal tags the pass put on the thread (the exit's bookkeeping, mirrored); needs_quote means the clerk runs next. */
    tagsAdded?: string[];
    /** T16: the chain's outcome; on a sandbox pass `sandbox` carries what Ben's phone and the job pack would have got. */
    routeA: { ran: boolean; reason?: string; draftSlug?: string; estimateId?: string; checkThis?: number; fallback?: boolean; sandbox?: { benNotice: BenNotice | null; jobPack: { lines: number; estimateLines: number; quoteId: string } | null; logs: string[] } | null } | null;
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
export interface SandboxMirror { kind: 'first_contact_ack'; intent: string; body: string; messageId: string | null; note: string; plan?: AckPlan | null }

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
    // T14: the describer is failing on every item, and this is why. Same verdict as the sidebar badge.
    const h = v.health;
    if (h?.failing) {
        const since = h.since ? ` since ${new Date(h.since).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : '';
        const kind = h.permanent ? 'a configuration failure that will not clear on its own' : `${h.window.failed} of the last ${h.window.runs} vision runs failed`;
        return `Every description is FAILING${since}: ${kind}. Reason: ${h.reason ?? 'no reason recorded'}. A photo attached now reaches the desk as bare media until this is fixed; a pass that describes it clears this banner.`;
    }
    if (!v.images) return 'Photos are not described on this server (spine.video.images is false); only videos are. A photo will reach the desk as bare media.';
    return null;
}

/** T11: which of the pending attachments would be described, by the same last-N rule the case file uses. */
export function attachmentsOverBound(count: number, v: SandboxVideoStatus | null | undefined): number {
    if (!v || !v.enabled) return 0;
    return Math.max(0, count - Math.max(1, v.maxPerRun));
}

// ---------------------------------------------------------------- T16 pure helpers (tested)

/** The funnel's steps, in order. `won` is what the live webhook writes on a paid deposit. */
export const FUNNEL_STEPS = ['enquiry', 'scoping', 'clerk', 'priced_draft', 'quote_sent', 'accepted'] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];
export const FUNNEL_LABEL: Record<FunnelStep, string> = { enquiry: 'Enquiry', scoping: 'Scoping', clerk: 'Clerk intake', priced_draft: 'Priced draft · Ben pinged', quote_sent: 'Quote sent', accepted: 'Accepted' };

/** Where the thread is on the funnel, from the state alone. */
export function funnelStep(state: Pick<SandboxState, 'conversation' | 'funnel' | 'runs'> | null | undefined): FunnelStep {
    const f = state?.funnel ?? null;
    if (f?.quote?.accepted) return 'accepted';
    if (f?.quote) return 'quote_sent';
    if (f?.draft) return 'priced_draft';
    if ((state?.runs ?? []).some((r) => r.lane === 'quote_clerk' || r.agent === 'quote_clerk')) return 'clerk';
    const stage = state?.conversation?.stage ?? 'enquiry';
    if (stage === 'won' || stage === 'booked') return 'accepted';
    if (stage === 'quote_sent' || stage === 'quoted') return 'quote_sent';
    if (stage === 'scoping' || stage === 'active' || stage === 'waiting') return 'scoping';
    return 'enquiry';
}

/** One line per door on what THIS server would do live, from the gates. */
export function doorGateNote(door: SandboxDoor, gates: SandboxGates | null | undefined): { text: string; tone: 'ok' | 'warn' } {
    if (!gates) return { text: 'Server switches not read yet.', tone: 'warn' };
    const ack = gates.firstContactAck;
    const tpl = (name: string) => gates.templates.find((t) => t.name === name)?.status ?? 'missing';
    switch (door) {
        case 'whatsapp':
            return ack.enabled && ack.channels.includes('whatsapp')
                ? { text: 'First-contact ack ON for WhatsApp: production sends the ack you will see mirrored.', tone: 'ok' }
                : { text: 'First-contact ack OFF for WhatsApp on this server: production would send nothing at first contact; the sandbox mirrors it anyway.', tone: 'warn' };
        case 'webform': {
            const t = tpl('web_enquiry_ack_context');
            const on = ack.enabled && ack.channels.includes('webform');
            return { text: `${on ? 'Ack ON for webform' : 'Ack OFF for webform on this server'} · web_enquiry_ack_context is ${t}${t !== 'approved' ? (gates.smsSenderConfigured ? ' → falls to the next rung, then SMS' : ' → falls to the next rung; no SMS sender, so it may queue for Ben') : ''}.`, tone: on && t === 'approved' ? 'ok' : 'warn' };
        }
        case 'post_call': {
            const t = tpl('post_call_continuation'); const g = tpl('post_call_continuation_generic');
            const on = gates.postCallContinuation.enabled;
            return { text: `${on ? 'Post-call continuation ON' : 'Post-call continuation OFF on this server (nothing would go live)'} · post_call_continuation is ${t}, generic is ${g}${t !== 'approved' && g !== 'approved' ? ' → NO_APPROVED_TEMPLATE: nothing can send' : ''} · spine ${gates.spineEnabled ? 'on: the clerk reads the transcript' : 'off: live, no call_ended pass'}.`, tone: on && (t === 'approved' || g === 'approved') ? 'ok' : 'warn' };
        }
        case 'sms': {
            const on = ack.enabled && ack.channels.includes('sms');
            return { text: `${on ? 'Ack ON for SMS' : 'Ack OFF for SMS on this server'} · SMS sender ${gates.smsSenderConfigured ? 'configured' : 'NOT configured (live, no SMS could go at all)'}.`, tone: on && gates.smsSenderConfigured ? 'ok' : 'warn' };
        }
    }
}

/** The bubble label for an outbound row: the mirror's own sender name, else the two T5/T6 labels. */
export function outboundLabel(m: { senderName: string | null }): string {
    const s = (m.senderName ?? '').trim();
    const inner = /^Sandbox \((.+)\)$/.exec(s)?.[1];
    if (inner) return inner.replace(/,\s*/g, ' · ');
    if (isMirroredAck({ direction: 'outbound', senderName: s })) return 'rules layer ack · mirrored · never sent';
    return 'synthetic · never sent';
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

/** T16: the Pushover Ben WOULD have received. Red-amber on purpose: this is the one thing the sandbox refuses to do. */
export function BenNoticeBox({ notice, when }: { notice: BenNotice; when?: string }) {
    return (
        <div className="rounded-lg border-2 border-dashed border-rose-400 bg-rose-50 p-3 text-sm text-rose-900" data-testid="sandbox-ben-notice">
            <div className="flex items-center gap-2 font-semibold"><BellRing className="h-4 w-4" /> Ben's phone would have buzzed — NOT sent{when ? <span className="font-normal text-rose-700"> · {when}</span> : null}</div>
            <div className="mt-1 font-medium">{notice.title}</div>
            <pre className="mt-1 whitespace-pre-wrap font-sans text-sm">{notice.message}</pre>
            {notice.link && <div className="mt-1 text-xs text-rose-800">Tap would open <span className="font-mono">{notice.link}</span> (that screen refuses to send a sandbox quote; price it here instead).</div>}
        </div>
    );
}

/** T16: the ladder as a table: which template names were tried, their Meta status, which was picked. */
export function LadderTable({ rungs }: { rungs: LadderRung[] }) {
    if (!rungs.length) return null;
    return (
        <table className="mt-2 w-full text-xs" data-testid="sandbox-ladder">
            <thead><tr className="text-left text-muted-foreground"><th className="pr-2 font-medium">Template</th><th className="pr-2 font-medium">Meta status</th><th className="font-medium">Outcome</th></tr></thead>
            <tbody>
                {rungs.map((r) => (
                    <tr key={r.name} className={cn(r.picked ? 'font-semibold text-emerald-900' : 'text-slate-700')}>
                        <td className="pr-2 font-mono">{r.name}</td>
                        <td className="pr-2">{r.status}</td>
                        <td>{r.picked ? '✓ ' : ''}{r.note}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

/** T16: what the door did — the seed, the first thing the customer would receive, the ladder, the gate. */
export function EntryDetail({ entry }: { entry: EntryReport }) {
    const ack = entry.ack;
    const pc = entry.postCall;
    return (
        <div className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 text-sm" data-testid="sandbox-entry">
            <div className="flex items-center gap-2 font-semibold text-indigo-900"><DoorOpen className="h-4 w-4" /> Door: {entry.meaning.label}</div>
            <p className="text-indigo-900">{entry.meaning.window}</p>
            <p className="text-slate-700">{entry.meaning.firstReply}</p>
            {pc && (
                <div className="rounded border bg-white p-2" data-testid="sandbox-entry-call">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">The call, as call-thread.ts writes it</div>
                    <div className="font-mono text-xs">{pc.call.preview}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{pc.call.durationSeconds}s · transcript {pc.call.transcriptChars} chars · {pc.spineRunReason}</div>
                    <div className="mt-2 text-xs"><span className="font-medium">Continuation:</span> <span className="font-mono">{pc.route.reason}</span> → {pc.outcome === 'template' ? `template ${pc.templateName}` : pc.outcome === 'no_approved_template' ? 'NO APPROVED TEMPLATE — nothing can send' : 'not sent'}. {pc.reason}</div>
                    <LadderTable rungs={pc.rungs} />
                    <div className={cn('mt-2 rounded px-2 py-1 text-xs', pc.gate.liveWouldSend ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900')} data-testid="sandbox-entry-gate">
                        {pc.gate.liveWouldSend ? 'On this server production would send this.' : pc.gate.continuationEnabled ? 'On this server nothing would go live (see the reason above).' : 'On this server post_call_continuation is OFF: production would send nothing after this call.'}
                        {' '}{pc.approval === 'auto_first_contact' ? 'It auto-sends under the first-contact exception (held 60 to 150 s).' : 'It would wait in Ben\'s queue for approval (first-contact auto-send is off for post_call).'}
                    </div>
                </div>
            )}
            {ack && (
                <div className="rounded border bg-white p-2" data-testid="sandbox-entry-ack">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">The first-contact ack ladder (first-contact-ack.ts)</div>
                    <div className="mt-1 text-xs"><span className="font-medium">{ack.mode.toUpperCase()}</span>{ack.channel ? ` by ${ack.channel}` : ''}{ack.templateName ? ` · ${ack.templateName}` : ''}{ack.outOfHours ? ' · out of hours wording' : ''} — {ack.reason}</div>
                    <LadderTable rungs={ack.rungs} />
                    <div className={cn('mt-2 rounded px-2 py-1 text-xs', ack.gate.liveWouldSend ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900')} data-testid="sandbox-entry-gate">
                        {ack.gate.liveWouldSend
                            ? `On this server the first-contact ack is ON for ${ack.door}: production sends exactly this, ${ack.holdSeconds[0]} to ${ack.holdSeconds[1]} s after the message.`
                            : ack.gate.enabled && !ack.gate.channelOn
                                ? `On this server the ack is on, but not for ${ack.door}: production would send nothing here. The sandbox mirrored it so the desk gets its turn.`
                                : !ack.gate.enabled
                                    ? 'On this server the first-contact ack is OFF: production would send nothing here. The sandbox mirrored it so the desk gets its turn.'
                                    : 'Live this would queue for Ben; the customer gets nothing until he acts.'}
                    </div>
                </div>
            )}
            {entry.mirrored
                ? <div className="text-xs text-muted-foreground">Placed on the thread as <span className="font-mono">{entry.mirrored.sender}</span>, on {entry.mirrored.channel}.</div>
                : entry.door !== 'whatsapp' && <div className="text-xs font-medium text-amber-900" data-testid="sandbox-entry-nothing">Nothing placed on the thread: the customer would have received nothing.</div>}
            {entry.firstRunTrigger && <div className="text-xs text-muted-foreground">The desk's first pass ran with trigger <span className="font-mono">{entry.firstRunTrigger}</span> (below).</div>}
        </div>
    );
}

/** The whole pass, once it has come back. The exit line sits on top because it is the point. */
export function RunDetail({ run }: { run: SandboxRun }) {
    const d = decisionLabel(run.decision);
    const ra = run.routeA;
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

            {ra?.sandbox?.benNotice && <BenNoticeBox notice={ra.sandbox.benNotice} when="Route A, after the clerk" />}

            {run.mirrored && (
                <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900" data-testid="sandbox-mirrored">
                    <div className="font-semibold">First contact — the rules layer answers, not the desk</div>
                    <p className="mt-1">{run.mirrored.note}</p>
                    {run.mirrored.plan && (
                        <div className="mt-1 text-xs" data-testid="sandbox-mirrored-plan">
                            <span className="font-medium">{run.mirrored.plan.mode.toUpperCase()}</span>{run.mirrored.plan.channel ? ` by ${run.mirrored.plan.channel}` : ''}{run.mirrored.plan.templateName ? ` · ${run.mirrored.plan.templateName}` : ''} — {run.mirrored.plan.reason}
                            <LadderTable rungs={run.mirrored.plan.rungs} />
                        </div>
                    )}
                    {run.mirrored.body
                        ? <div className="mt-2 whitespace-pre-wrap rounded-2xl rounded-tr-sm border border-dashed border-sky-300 bg-white px-3 py-2 text-sm text-slate-800">{run.mirrored.body}</div>
                        : <div className="mt-2 text-xs font-medium text-amber-900">Nothing would reach the customer here (see the reason above).</div>}
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

            {run.tagsAdded && run.tagsAdded.length > 0 && (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900" data-testid="sandbox-tags-added">
                    Tags put on the thread by this pass (the exit's bookkeeping, mirrored): <span className="font-mono">{run.tagsAdded.join(', ')}</span>.
                    {run.tagsAdded.includes('needs_quote') && <> Live, the clerk's pass is asked for at once. Here, press <span className="font-medium">Run a clock pass</span> (or send a message) and the Quote clerk runs.</>}
                </div>
            )}
            {ra && (
                <div className="rounded-lg border p-3 text-sm" data-testid="sandbox-route-a">
                    <div className="font-semibold">Route A — the clerk's intake to a priced draft</div>
                    {ra.ran
                        ? (
                            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate-700">
                                {ra.draftSlug && <li>Draft <span className="font-mono">{ra.draftSlug}</span> written on the sandbox number, every customer-visible price null (the engine's suggestions on it){ra.checkThis != null ? `, ${ra.checkThis} line(s) marked check this` : ''}.</li>}
                                {ra.estimateId && <li>Estimate <span className="font-mono">{ra.estimateId}</span>{ra.fallback ? ' — the estimator FAILED; the draft was priced from reference rates' : ''}.</li>}
                                {ra.reason && !ra.draftSlug && <li>{ra.reason}</li>}
                                {ra.sandbox?.jobPack && <li>Job pack: would have been written for quote <span className="font-mono">{ra.sandbox.jobPack.quoteId}</span> ({ra.sandbox.jobPack.lines} clerk line(s), {ra.sandbox.jobPack.estimateLines} estimated) — recorded, not written.</li>}
                                {ra.sandbox && !ra.sandbox.benNotice && <li className="text-amber-900">No Pushover would have gone (the chain produced no draft).</li>}
                                {ra.sandbox?.logs.map((l, i) => <li key={i} className="text-muted-foreground">{l}</li>)}
                            </ul>
                        )
                        : <div className="mt-1 text-xs text-slate-700">Did not run: {ra.reason ?? 'no reason recorded'}</div>}
                    {ra.ran && ra.draftSlug && <div className="mt-2 text-xs text-slate-700">Next: <span className="font-medium">Ben prices and sends</span> (the strip above the composer) does what /admin/price/{ra.draftSlug} would do, minus the send.</div>}
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
                <Field label="Window">{run.caseFile.window.canFreeform ? 'open (freeform ok)' : 'shut (template required)'}{(run.caseFile.window as { channelLastUsed?: string }).channelLastUsed ? <span className="text-xs text-muted-foreground"> · channel last used {(run.caseFile.window as { channelLastUsed?: string }).channelLastUsed}</span> : null}</Field>
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

// ---------------------------------------------------------------- T16: the door picker

const DOOR_ICON: Record<SandboxDoor, typeof MessageSquare> = { whatsapp: MessageSquare, post_call: Phone, webform: DoorOpen, sms: Smartphone };
const DOOR_TITLE: Record<SandboxDoor, string> = { whatsapp: 'Inbound WhatsApp', post_call: 'Post-call (WhatsApp agreed)', webform: 'Webform', sms: 'Inbound SMS' };
const DOOR_BLURB: Record<SandboxDoor, string> = {
    whatsapp: 'A customer messages the business number on WhatsApp. Window OPEN. Freeform allowed. First contact gets the rules layer\'s ack; the desk answers from the second message.',
    post_call: 'They rang, WhatsApp was agreed on the phone. Window SHUT (a call never opens it). The first WhatsApp must be an approved template with the job from the call; the clerk reads the transcript.',
    webform: 'They filled in the website form. Window SHUT. The ack goes as the first approved template on the ladder (web_enquiry_ack_context quotes them back), else by SMS, else it waits for Ben.',
    sms: 'They texted the business number. No window, no templates: everything goes back by SMS. A photo cannot arrive by SMS; the desk asks them to describe it, and may invite a switch to WhatsApp once.',
};
const DEFAULTS: Record<SandboxDoor, { name: string; text: string; jobPhrase: string }> = {
    whatsapp: { name: 'Sam', text: '', jobPhrase: '' },
    webform: { name: 'Priya Shah', text: 'Hi, the extractor fan in our bathroom has stopped working and the ceiling is getting damp. Can you replace it? We are in NG7.', jobPhrase: '' },
    sms: { name: 'Dave', text: 'Hi do you do gutters? Mine is overflowing at the back, Beeston', jobPhrase: '' },
    post_call: { name: 'Alex Morgan', text: '', jobPhrase: 'the bathroom extractor fan' },
};

export interface StartVars { door: SandboxDoor; name: string; text: string; jobPhrase: string; whatsappAgreed: 'agreed' | 'declined' | 'not_discussed'; transcript?: string }

export function DoorPicker({ gates, busy, onStart, hasThread }: { gates: SandboxGates | null | undefined; busy: boolean; onStart: (v: StartVars) => void; hasThread: boolean }) {
    const [door, setDoor] = useState<SandboxDoor>('whatsapp');
    const [name, setName] = useState(DEFAULTS.whatsapp.name);
    const [text, setText] = useState(DEFAULTS.whatsapp.text);
    const [jobPhrase, setJobPhrase] = useState(DEFAULTS.whatsapp.jobPhrase);
    const [agreed, setAgreed] = useState<StartVars['whatsappAgreed']>('agreed');
    const [transcript, setTranscript] = useState('');
    const pick = (d: SandboxDoor) => { setDoor(d); setName(DEFAULTS[d].name); setText(DEFAULTS[d].text); setJobPhrase(DEFAULTS[d].jobPhrase); };
    const gate = doorGateNote(door, gates);
    const needsText = door === 'webform' || door === 'sms';
    return (
        <div className="space-y-3 rounded-lg border p-3" data-testid="sandbox-doors">
            <div className="flex items-center gap-2 text-sm font-semibold"><DoorOpen className="h-4 w-4 text-indigo-600" /> {hasThread ? 'Open a new thread through a door (resets this one)' : 'Open a thread through one of the four front doors'}</div>
            <div className="grid gap-2 sm:grid-cols-2">
                {SANDBOX_DOORS.map((d) => {
                    const Icon = DOOR_ICON[d];
                    const g = doorGateNote(d, gates);
                    return (
                        <button key={d} type="button" onClick={() => pick(d)} disabled={busy} data-testid={`sandbox-door-${d}`} aria-pressed={door === d}
                            className={cn('rounded-lg border p-2 text-left text-xs hover:bg-slate-50', door === d ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-300' : 'border-slate-200')}>
                            <div className="flex items-center gap-1.5 text-sm font-semibold"><Icon className="h-4 w-4" /> {DOOR_TITLE[d]}</div>
                            <div className="mt-1 text-slate-700">{DOOR_BLURB[d]}</div>
                            <div className={cn('mt-1 rounded px-1.5 py-0.5', g.tone === 'ok' ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900')}>{g.text}</div>
                        </button>
                    );
                })}
            </div>
            <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
                <label className="text-xs">
                    <span className="text-muted-foreground">Customer's name{door === 'whatsapp' ? ' (pushname)' : door === 'post_call' ? ' (as given on the call)' : ''}</span>
                    <input value={name} onChange={(e) => setName(e.target.value)} className="mt-0.5 w-full rounded border px-1.5 py-1 text-xs" data-testid="sandbox-start-name" />
                </label>
                {needsText && (
                    <label className="text-xs">
                        <span className="text-muted-foreground">{door === 'webform' ? 'The enquiry, as typed into the form' : 'Their first text'}</span>
                        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className="mt-0.5 text-xs" data-testid="sandbox-start-text" />
                    </label>
                )}
                {door === 'post_call' && (
                    <div className="space-y-1 text-xs">
                        <label className="block">
                            <span className="text-muted-foreground">Job phrase the classifier would write (goes into "good to speak just now about …")</span>
                            <input value={jobPhrase} onChange={(e) => setJobPhrase(e.target.value)} className="mt-0.5 w-full rounded border px-1.5 py-1 text-xs" data-testid="sandbox-start-jobphrase" />
                        </label>
                        <label className="block">
                            <span className="text-muted-foreground">WhatsApp on the call</span>
                            <select value={agreed} onChange={(e) => setAgreed(e.target.value as StartVars['whatsappAgreed'])} className="mt-0.5 w-full rounded border px-1.5 py-1 text-xs" data-testid="sandbox-start-agreed">
                                <option value="agreed">agreed (the customer said yes)</option>
                                <option value="not_discussed">not discussed</option>
                                <option value="declined">declined ("just ring me")</option>
                            </select>
                        </label>
                        <label className="block">
                            <span className="text-muted-foreground">Transcript (leave empty for the built-in one)</span>
                            <Textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={2} className="mt-0.5 text-xs" placeholder="Customer: … Agent: …" data-testid="sandbox-start-transcript" />
                        </label>
                    </div>
                )}
                {door === 'whatsapp' && <div className="self-end text-xs text-muted-foreground">A clean thread. Type the first message below as the customer; it is first contact.</div>}
            </div>
            <div className={cn('rounded px-2 py-1 text-xs', gate.tone === 'ok' ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900')} data-testid="sandbox-door-gate">{gate.text}</div>
            <Button onClick={() => onStart({ door, name, text, jobPhrase, whatsappAgreed: agreed, ...(transcript.trim() ? { transcript: transcript.trim() } : {}) })} disabled={busy || (needsText && !text.trim())} data-testid="sandbox-start">
                {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <DoorOpen className="mr-1 h-4 w-4" />} Open through this door
            </Button>
        </div>
    );
}

/** T16: the window as the case file will read it, with the two controls that change it honestly. */
export function WindowStrip({ window, busy, onAge, onClock }: { window: WindowReport | null | undefined; busy: boolean; onAge: (hours: number) => void; onClock: () => void }) {
    const [hours, setHours] = useState('25');
    const h = Number(hours);
    const ok = Number.isFinite(h) && h > 0 && h <= 720;
    if (!window) return null;
    return (
        <div className={cn('flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-xs', window.canFreeform ? 'bg-emerald-50' : 'bg-amber-50')} data-testid="sandbox-window">
            <div className="min-w-0">
                <div className={cn('font-semibold', window.canFreeform ? 'text-emerald-900' : 'text-amber-900')}>WhatsApp window: {window.summary}</div>
                <div className="text-slate-700">{window.permits}{window.channelLastUsed ? ` Channel last used: ${window.channelLastUsed}.` : ''}</div>
            </div>
            <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Move the thread back</span>
                <input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" className="w-12 rounded border px-1 py-0.5 text-xs" aria-label="hours to move the thread back" data-testid="sandbox-age-hours" />
                <span className="text-muted-foreground">h</span>
                <Button variant="outline" size="sm" onClick={() => onAge(h)} disabled={busy || !ok} title="Every timestamp on the thread moves back; with 25 h the window shuts, as it would live" data-testid="sandbox-age"><Clock className="mr-1 h-3.5 w-3.5" /> Fast-forward</Button>
                <Button variant="outline" size="sm" onClick={onClock} disabled={busy} title="A pass with no new customer message — what a sweep does" data-testid="sandbox-clock"><Bot className="mr-1 h-3.5 w-3.5" /> Run a clock pass</Button>
            </div>
        </div>
    );
}

/** T16: where the thread is on the funnel and the two actions that move it (Ben's, the customer's). */
export function FunnelStrip({ state, busy, onPrice, onAccept, amount, setAmount }: { state: SandboxState | null | undefined; busy: boolean; onPrice: () => void; onAccept: () => void; amount: string; setAmount: (v: string) => void }) {
    const step = funnelStep(state);
    const idx = FUNNEL_STEPS.indexOf(step);
    const f = state?.funnel ?? null;
    const canPrice = !!f?.draft || (!!f?.quote && !f.quote.delivered && !f.quote.accepted);
    const canAccept = !!f?.quote && f.quote.delivered && !f.quote.accepted;
    return (
        <div className="space-y-2 rounded-lg border p-3" data-testid="sandbox-funnel">
            <div className="flex flex-wrap items-center gap-1 text-xs">
                {FUNNEL_STEPS.map((s, i) => (
                    <span key={s} className="flex items-center gap-1">
                        <span className={cn('rounded-full px-2 py-0.5', i < idx ? 'bg-slate-200 text-slate-700' : i === idx ? 'bg-indigo-600 font-semibold text-white' : 'bg-slate-100 text-muted-foreground')} data-testid={`sandbox-funnel-${s}`} aria-current={i === idx ? 'step' : undefined}>{FUNNEL_LABEL[s]}</span>
                        {i < FUNNEL_STEPS.length - 1 && <span className="text-muted-foreground">›</span>}
                    </span>
                ))}
            </div>
            {f?.draft && (
                <div className="text-xs text-slate-700" data-testid="sandbox-funnel-draft">
                    Waiting draft <span className="font-mono">{f.draft.slug}</span>: {f.draft.lines.length} line(s){f.draft.lines.length ? ` (${f.draft.lines.slice(0, 3).join('; ')}${f.draft.lines.length > 3 ? '…' : ''})` : ''}{f.draft.suggestedTotalPence != null ? `, engine suggests ${pounds(f.draft.suggestedTotalPence)}` : ', no suggested total'}{f.draft.checkThis ? `, ${f.draft.checkThis} check this` : ''}. It is NOT in Ben's price queue (the sandbox number is excluded) and the real price screen refuses it.
                </div>
            )}
            {f?.quote && !f.quote.delivered && !f.quote.accepted && <div className="text-xs text-amber-900" data-testid="sandbox-funnel-undelivered">Quote <span className="font-mono">{f.quote.slug}</span> is priced but NOT with the customer: the window was shut. A customer WhatsApp reopens it; then press Ben prices and sends again.</div>}
            <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 text-xs">
                    <span className="text-muted-foreground">Ben's total £</span>
                    <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="w-16 rounded border px-1.5 py-0.5 text-xs" aria-label="Ben's total in pounds" placeholder="engine's" data-testid="sandbox-price-amount" />
                </div>
                <Button size="sm" variant="outline" onClick={onPrice} disabled={busy || !canPrice} title={canPrice ? 'Does what /admin/price/<slug> does, minus the send: prices the draft, places the quote message on the thread the way it would travel' : 'Nothing waiting: the clerk has not produced a draft (or Seed quote)'} data-testid="sandbox-price">Ben prices and sends</Button>
                <Button size="sm" variant="outline" onClick={onAccept} disabled={busy || !canAccept} title={canAccept ? 'The customer pays the deposit on the quote page: stamps the quote, moves the thread to won, records the Pushover Ben would have got' : 'No sent quote to accept yet'} data-testid="sandbox-accept">Customer accepts (pays deposit)</Button>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------- the page

export default function SandboxPage() {
    const queryClient = useQueryClient();
    const [text, setText] = useState('');
    const [channel, setChannel] = useState<'whatsapp' | 'sms'>('whatsapp');
    const [files, setFiles] = useState<File[]>([]);
    const [amount, setAmount] = useState('480');
    const [benAmount, setBenAmount] = useState('');
    const [lastRun, setLastRun] = useState<SandboxRun | null>(null);
    const [lastNotice, setLastNotice] = useState<{ notice: BenNotice; when: string } | null>(null);
    const [lastAction, setLastAction] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showDoors, setShowDoors] = useState(false);
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

    type SendReply = { ok: true; run: SandboxRun; mirrored?: SandboxMirror | null; media?: SandboxMediaReport[] | null; video?: SandboxVideoStatus | null; state?: SandboxState };
    const paintRun = (r: SendReply) => setLastRun({ ...r.run, mirrored: r.mirrored ?? null, media: r.media ?? null, video: r.video ?? null });

    const reset = useMutation({
        mutationFn: () => api<{ ok: true; state?: SandboxState }>('/reset', { method: 'POST' }),
        onSuccess: (r) => { setLastRun(null); setLastNotice(null); setLastAction(null); setError(null); setFiles([]); setShowDoors(false); applyState(r.state); },
        onError: (e: Error) => setError(e.message),
    });
    const start = useMutation({
        mutationFn: (v: StartVars) => api<SendReply & { run: SandboxRun | null; entry: EntryReport; door: SandboxDoor }>('/start', { method: 'POST', body: JSON.stringify(v) }),
        onMutate: () => { setError(null); setLastRun(null); setLastNotice(null); setLastAction(null); },
        onSuccess: (r) => { setFiles([]); setShowDoors(false); setChannel(r.door === 'sms' ? 'sms' : 'whatsapp'); applyState(r.state); if (r.run) paintRun({ ...r, run: r.run }); },
        onError: (e: Error) => setError(e.message),
    });
    const seedQuote = useMutation({
        mutationFn: () => api<{ ok: true; state?: SandboxState }>('/quote', { method: 'POST', body: JSON.stringify({ totalPence: Math.round(Number(amount) * 100) }) }),
        // T6: the previous pass's proposed bubble would otherwise sit under the new quote bubble.
        onSuccess: (r) => { setError(null); setLastRun(null); applyState(r.state); },
        onError: (e: Error) => setError(e.message),
    });
    const age = useMutation({
        mutationFn: (hours: number) => api<{ ok: true; hours: number; window: WindowReport; state?: SandboxState }>('/age', { method: 'POST', body: JSON.stringify({ hours }) }),
        onSuccess: (r) => { setError(null); setLastAction(`Moved the thread back ${r.hours} h. Window now ${r.window.summary}.`); applyState(r.state); },
        onError: (e: Error) => setError(e.message),
    });
    const clock = useMutation({
        mutationFn: () => api<SendReply>('/run', { method: 'POST', body: JSON.stringify({ trigger: 'cadence' }) }),
        onMutate: () => { setError(null); setLastRun(null); },
        onSuccess: (r) => { applyState(r.state); paintRun(r); },
        onError: (e: Error) => setError(e.message),
    });
    const price = useMutation({
        mutationFn: () => api<{ ok: true; slug: string; totalPence: number; source: string; delivery: { mode: string; body: string | null; templateName: string | null; reason: string }; state?: SandboxState }>('/price', { method: 'POST', body: JSON.stringify(benAmount.trim() ? { totalPence: Math.round(Number(benAmount) * 100) } : {}) }),
        onSuccess: (r) => { setError(null); setLastRun(null); setLastAction(`Ben priced ${r.slug} at ${pounds(r.totalPence)} (${r.source === 'ben' ? 'his number' : "the engine's suggestion"}). Delivery: ${r.delivery.mode.toUpperCase()}${r.delivery.templateName ? ` via ${r.delivery.templateName}` : ''} — ${r.delivery.reason}`); applyState(r.state); },
        onError: (e: Error) => setError(e.message),
    });
    const accept = useMutation({
        mutationFn: () => api<{ ok: true; slug: string; depositPence: number; notice: BenNotice; next: string; state?: SandboxState }>('/accept', { method: 'POST' }),
        onSuccess: (r) => { setError(null); setLastRun(null); setLastNotice({ notice: r.notice, when: 'the deposit webhook' }); setLastAction(`Customer accepted ${r.slug}: deposit ${pounds(r.depositPence)}. ${r.next}`); applyState(r.state); },
        onError: (e: Error) => setError(e.message),
    });
    type SendVars = { text: string; files: File[]; channel: 'whatsapp' | 'sms' };
    const send = useMutation({
        // T11: with attachments the body is multipart (text + media files); without, the JSON body as before.
        mutationFn: (v: SendVars) => {
            if (!v.files.length) return api<SendReply>('/message', { method: 'POST', body: JSON.stringify({ text: v.text, channel: v.channel }) });
            const form = new FormData();
            form.append('text', v.text);
            form.append('channel', v.channel);
            for (const f of v.files) form.append('media', f, f.name);
            return api<SendReply>('/message', { method: 'POST', body: form });
        },
        onMutate: () => { setError(null); setLastRun(null); },
        onSuccess: (r) => { applyState(r.state); paintRun(r); setText(''); setFiles([]); },
        onError: (e: Error) => setError(e.message),
    });

    const conv = state.data?.conversation ?? null;
    const msgs = state.data?.messages ?? [];
    const quote = state.data?.quote ?? null;
    const video = state.data?.video ?? null;
    const gates = state.data?.gates ?? null;
    const entry = state.data?.entry ?? null;
    const events = state.data?.events ?? [];
    const busy = send.isPending || reset.isPending || seedQuote.isPending || start.isPending || age.isPending || clock.isPending || price.isPending || accept.isPending;
    const amountOk = Number.isFinite(Number(amount)) && Number(amount) >= 1 && Number(amount) <= 20_000;
    const warning = videoWarning(video);
    const overBound = attachmentsOverBound(files.length, video);
    const smsMode = channel === 'sms';

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
        send.mutate({ text: t, files: smsMode ? [] : files, channel });
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
                    <p className="text-sm text-muted-foreground">Open a thread through one of the four real front doors, type as the customer, watch the desk triage, think and propose, carry it through to a priced quote and an acceptance. Nothing is ever sent.</p>
                </div>
                <div className="flex items-center gap-2">
                    {conv && (
                        <Button variant="outline" size="sm" onClick={() => setShowDoors((v) => !v)} disabled={busy} data-testid="sandbox-new-scenario">
                            <DoorOpen className="mr-1 h-4 w-4" /> {showDoors ? 'Hide doors' : 'New scenario'}
                        </Button>
                    )}
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
                    every pass skips the exit (the only sender), and no schedule can ever pick it up. Replies shown here would have gone out live — they did not. Ben's phone is never pinged from here: what it would have shown is recorded and painted red.
                </div>
            </div>

            {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</div>}

            {(!state.isLoading && (!conv || showDoors)) && <DoorPicker gates={gates} busy={busy} hasThread={!!conv} onStart={(v) => start.mutate(v)} />}

            <div className="grid gap-4 lg:grid-cols-2">
                {/* ---------------- left: the conversation */}
                <section className="flex min-h-[32rem] flex-col rounded-lg border">
                    <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
                        <div className="flex items-center gap-2 font-medium"><User className="h-4 w-4" /> {conv?.contactName ?? 'No thread yet'}{conv && state.data?.door ? <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-800" data-testid="sandbox-door-pill">{DOOR_TITLE[state.data.door]}</span> : null}</div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {conv && <span>stage <span className="font-mono">{conv.stage ?? 'enquiry'}</span></span>}
                            {quote && !quote.depositPaidAt && !quote.revokedAt && <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">unpaid quote {quote.slug}{quote.basePrice != null ? ` · ${pounds(quote.basePrice)}` : ''}</span>}
                            {quote && quote.depositPaidAt && <span className="rounded bg-emerald-600 px-1.5 py-0.5 font-medium text-white">accepted {quote.slug}</span>}
                        </div>
                    </div>
                    {conv && <WindowStrip window={state.data?.window} busy={busy} onAge={(h) => age.mutate(h)} onClock={() => clock.mutate()} />}

                    <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50/60 p-3" data-testid="sandbox-thread">
                        {state.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
                        {!state.isLoading && !conv && (
                            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                                No sandbox thread yet. Pick a door above and press <span className="font-medium">Open through this door</span>, or <span className="font-medium">Start a clean thread</span> for a bare WhatsApp thread.
                            </div>
                        )}
                        {msgs.map((m) => {
                            const inbound = m.direction === 'inbound';
                            const call = m.channel === 'call';
                            return (
                                <div key={m.id} className={cn('flex', inbound ? 'justify-start' : 'justify-end')}>
                                    <div className={cn('max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm shadow-sm', inbound ? (call ? 'rounded-tl-sm border border-slate-300 bg-slate-100' : 'rounded-tl-sm bg-white') : 'rounded-tr-sm bg-emerald-100')}>
                                        {inbound && m.channel && m.channel !== 'whatsapp' && (
                                            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600" data-testid="sandbox-inbound-channel">{call ? '📞 phone call' : m.channel === 'sms' ? '💬 SMS' : m.channel === 'webform' ? '📝 webform' : m.channel}</div>
                                        )}
                                        {!inbound && (
                                            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                                                {outboundLabel(m)}{m.channel === 'sms' ? ' · SMS' : ''}
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
                        {(send.isPending || clock.isPending || start.isPending) && (
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
                        {conv && <FunnelStrip state={state.data} busy={busy} onPrice={() => price.mutate()} onAccept={() => accept.mutate()} amount={benAmount} setAmount={setBenAmount} />}
                        {lastAction && <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-2 text-xs text-indigo-900" data-testid="sandbox-last-action">{lastAction}</div>}
                        {lastNotice && <BenNoticeBox notice={lastNotice.notice} when={lastNotice.when} />}
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
                        {warning && !smsMode && (
                            <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-2 text-xs text-red-900" role="status" data-testid="sandbox-video-warning">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{warning}</span>
                            </div>
                        )}
                        <div className="flex items-center gap-1 text-xs" role="radiogroup" aria-label="channel the customer writes on" data-testid="sandbox-channel">
                            <span className="text-muted-foreground">The customer writes on</span>
                            {(['whatsapp', 'sms'] as const).map((c) => (
                                <button key={c} type="button" role="radio" aria-checked={channel === c} onClick={() => { setChannel(c); if (c === 'sms') setFiles([]); }} disabled={busy}
                                    className={cn('rounded-full border px-2 py-0.5', channel === c ? 'border-indigo-500 bg-indigo-50 font-semibold text-indigo-900' : 'text-slate-700 hover:bg-slate-100')} data-testid={`sandbox-channel-${c}`}>
                                    {c === 'whatsapp' ? 'WhatsApp' : 'SMS'}
                                </button>
                            ))}
                            <span className="text-muted-foreground">{smsMode ? '— an SMS does not open the window and cannot carry a photo' : '— opens the 24 h window'}</span>
                        </div>
                        <Textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
                            placeholder={conv ? (smsMode ? 'Type as the customer, by SMS… (Enter to send)' : 'Type as the customer… (Enter to send, Shift+Enter for a new line; attach a photo or video below)') : 'Open a door first'}
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
                                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={!conv || busy || smsMode || files.length >= MAX_ATTACHMENTS} data-testid="sandbox-attach" title={smsMode ? 'A UK long code cannot receive a photo by SMS' : 'Attach a photo or video, as the customer would'}>
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
                    {entry && conv && <EntryDetail entry={entry} />}

                    <div className="rounded-lg border p-3">
                        <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Bot className="h-4 w-4 text-blue-600" /> Live: what the desk is doing</div>
                        {conv ? (
                            <>
                                <LiveRunPanel conversationId={conv.id} keepFinished />
                                {!send.isPending && !lastRun && <div className="text-sm text-muted-foreground">Send a message and the pass appears here step by step: case file (with how many media were described), triage, pack, each tool the Scoper calls, the proposal, guards, decision, exit.</div>}
                            </>
                        ) : <div className="text-sm text-muted-foreground">Open a door to watch runs.</div>}
                    </div>

                    {lastRun
                        ? <RunDetail run={lastRun} />
                        : (
                            <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                                The last pass's detail lands here: the exit line (what would have happened), decision, proposed reply, triage, pack, guards and cost.
                            </div>
                        )}

                    {events.length > 0 && (
                        <div className="rounded-lg border p-3" data-testid="sandbox-events">
                            <div className="mb-2 text-sm font-medium">What happened on this thread</div>
                            <ul className="space-y-1 text-xs">
                                {events.slice().reverse().map((e, i) => (
                                    <li key={`${e.at}-${i}`} className="flex gap-2">
                                        <span className="shrink-0 font-mono text-muted-foreground">{new Date(e.at).toLocaleTimeString('en-GB')}</span>
                                        <span className={cn('shrink-0 rounded px-1 font-mono', e.kind === 'route_a' || e.kind === 'accepted' ? 'bg-rose-100 text-rose-900' : 'bg-slate-100 text-slate-700')}>{e.kind}</span>
                                        <span className="text-slate-700">{e.summary}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {(state.data?.runs.length ?? 0) > 0 && (
                        <div className="rounded-lg border p-3">
                            <div className="mb-2 text-sm font-medium">Earlier passes on this thread</div>
                            <ul className="divide-y text-xs">
                                {state.data!.runs.map((r) => (
                                    <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5">
                                        <span className="font-mono text-muted-foreground">{r.startedAt ? new Date(r.startedAt).toLocaleTimeString('en-GB') : ''}</span>
                                        <span className="font-mono">{r.trigger ?? ''}</span>
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
