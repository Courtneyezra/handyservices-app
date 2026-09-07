/**
 * T5: /api/comms-sandbox — type as a customer, watch the desk think, nothing sent.
 *
 * Mounted in server/index.ts behind requireAdmin (NOT dev-only: the owner uses it in production
 * to reproduce the wrong-move shapes by hand and watch the spine handle them). The page is
 * client/src/pages/admin/SandboxPage.tsx; the live feed it watches is the spine's own
 * run_started / run_event / run_finished stream (server/spine/run-events.ts).
 *
 *   GET  /            the sandbox thread as it stands: messages, quote, recent runs, the window,
 *                     the door it was opened through, the funnel's state, this server's gates
 *   POST /reset       delete everything on the sandbox number and start a clean thread
 *   POST /start       T16: { door, name?, text?, jobPhrase?, whatsappAgreed?, transcript? } → reset,
 *                     then open the thread through one of the four real front doors, shaped as the
 *                     live writer shapes it (server/spine/sandbox-scenarios.ts): a webform enquiry,
 *                     an answered call with WhatsApp agreed, an inbound SMS, or (T19) the customer's
 *                     own opening WhatsApp message, typed by the owner with no default: on that door
 *                     the customer starts the conversation, so the message IS the event (it creates
 *                     the thread and opens the 24 h window) and the ack is planned against it only
 *                     after the first pass lands on first contact, exactly as /message does. The
 *                     first thing the customer would receive (the ack ladder's rung, the
 *                     continuation template, the SMS, the freeform ack) is MIRRORED onto the thread
 *                     and reported with the reason, and the desk's first pass runs where the live
 *                     system would run one (inbound_message, or call_ended for a call).
 *   POST /message     { text, channel? } → inbound message on the thread, then runOnce(..., { dryRun, sandbox })
 *                     returns the whole pass (triage, pack, proposal, guards, decision, exit note, cost).
 *                     T16: `channel` 'whatsapp' (default) or 'sms'. An SMS never moves lastInboundAt
 *                     (it does not open the window, as live) and cannot carry a photo (a UK long
 *                     code cannot receive MMS).
 *                     T11: ALSO multipart/form-data with `text` and up to SANDBOX_MAX_FILES `media`
 *                     files (photos, videos). Each file becomes its own inbound row, written the
 *                     way server/conversation-engine.ts writes a real WhatsApp inbound: bytes in
 *                     MEDIA_DIR under a server-chosen name, mirrored to S3, `mediaUrl`
 *                     '/api/media/<file>', `mediaType` the MIME, `type` image|video, the typed text
 *                     as the caption on the first. The case file, the describer (Gemini) and the
 *                     Scoper then see exactly what they would see for a customer. The response adds
 *                     `media[]`: per item, the description the Scoper read or the one reason it did
 *                     not (off, images off, no key, over the per-pass bound, failed).
 *                     T6: when that pass was FIRST CONTACT (triage lane `rules`, the first-contact
 *                     pack), the rules layer — not the desk — answers it live, and its ack is the
 *                     outbound that makes the NEXT message the desk's. The sandbox has no rules layer
 *                     (inbounds are inserted, never ingested), so nothing ever wrote that outbound and
 *                     a clean thread stayed "first contact" forever: the Scoper was unreachable without
 *                     Seed quote. The ack the rules layer would have composed is MIRRORED onto the
 *                     thread as a synthetic outbound and reported as `mirrored`. T16: the mirror is
 *                     now the full plan (planFirstContactAck): the pipe, the ladder rung, the config
 *                     gate, so the page can say whether production would send it today.
 *   POST /age         T16: { hours } → every timestamp on the sandbox thread moves back by N hours
 *                     (messages, the conversation's clocks, calls, quotes including expiry, runs,
 *                     flags, estimates). The honest way to shut the 24 h window: the rows are what
 *                     the live database holds N hours later.
 *   POST /run         T16: { trigger: 'cadence' | 'manual' } → a pass with no new customer message,
 *                     what a clock does live. With the window shut this is where the template path
 *                     and the pending reasons show.
 *   POST /quote       { totalPence?, title? } → a synthetic UNPAID quote on the thread plus the
 *                     "here's your quote" outbound that would have carried it, so the post-quote
 *                     pack and the four quote-dependent wrong-move shapes are reachable
 *   POST /price       T16: { totalPence? } → Ben prices the waiting Route A draft and sends: the
 *                     draft becomes the sent quote (is_draft false, the total on it), and the quote
 *                     message is placed on the thread the way deliverQuoteLink would deliver it
 *                     (freeform / quote_ready_link template / queued until the window reopens).
 *   POST /accept      T16: the customer pays the deposit: depositPaidAt on the sandbox quote, the
 *                     thread to `won`, and the "Quote accepted" Pushover RECORDED, not sent.
 *   POST /call        T21: { transcript?, durationSeconds? } → Ben rings them: an ANSWERED outbound
 *                     call on the current thread, written as the live path writes one (the calls
 *                     row with the classifier's outbound-shaped verdict, then the LIVE ingestCallRow
 *                     with call-logger's own options: the card line, the clocks, the callback
 *                     settle and the ladder are the real code; its requestRun refuses the test
 *                     number, as it must). The ladder's verdict — whether live would hand the
 *                     thread to the desk, and the outreach rail that refused if not — is reported,
 *                     and the sandbox runs the call_ended pass itself either way, so the owner sees
 *                     what the Scoper composes from the call. A call never touches the window.
 *
 * HARD SAFETY RULE (the dev board demo's rule, inherited): every read and write here is keyed on
 * the sandbox number (server/spine/sandbox.ts) and NEVER on a conversation id, quote id or call id
 * from the client. There is no parameter that names a thread. The thread is created WITHOUT
 * metadata.nextTriageAt, so no scheduled pass can ever pick it up; runOnce itself refuses a
 * sandbox pass on any other number and never reaches the exit. Three layers, each independent —
 * see the brief. Nothing in this file calls the exit, queueDraft, approveAndSendDraft,
 * sendCustomerMessage, the first-contact ack, the post-call outreach, or Pushover.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { agentOutcomes, agentQuestions, agentRuns, calls, conversations, jobPacks, messageDrafts, messages, nudgeQueue, personalizedQuotes, quoteEstimates, systemEvents } from '@shared/schema';
import { MEDIA_DIR, mirrorMediaToS3 } from '../media-store';
import { DEFAULT_SPINE_CONFIG, getSpineConfig, type SpineConfig } from './config';
import { runOnce, type RunOnceResult } from './index';
import { explainMediaSelection } from './media-selection';
import { SANDBOX_DIGITS, SANDBOX_PHONE_E164, SANDBOX_PHONE_WA, isSandboxPhone, quoteAcceptedNotice, type SandboxBenNotice } from './sandbox';
import {
    DOOR_MEANING, validateStart, validateAge, validateClockTrigger, planFirstContactAck, planPostCallContinuation, planQuoteLinkDelivery,
    sandboxClassification, windowReport, nameSlot, looksLikeAName, enquirySnippet, validateCall, sandboxOutboundClassification, OUTBOUND_CALL_DEFAULT_TRANSCRIPT,
    type AckPlan, type PostCallPlan, type QuoteLinkPlan, type SandboxDoor, type StartInput, type TemplateRow, type WindowReport,
} from './sandbox-scenarios';
import type { MediaItem } from './types';
import type { LadderPlan } from '../post-call-ladder';
import type { CallThreadResult } from '../call-thread';

export const commsSandboxRouter = Router();

// ---------------------------------------------------------------- pure helpers (tested)

export const SANDBOX_CONTACT_NAME = 'Sandbox customer (not real)';
/** Sender name on the ordinary synthetic outbound (the "here's your quote" bubble). */
export const SANDBOX_SYNTHETIC_SENDER = 'Sandbox (synthetic, never sent)';
/** Sender name on a mirrored rules-layer ack — the page labels the bubble off this. */
export const SANDBOX_RULES_ACK_SENDER = 'Sandbox (rules layer ack, mirrored, never sent)';
export const SANDBOX_QUOTE_MARK = 'SANDBOX (synthetic quote, not a customer)';
export const SANDBOX_DEFAULT_TOTAL_PENCE = 48_000;
export const MAX_MESSAGE_CHARS = 2_000;
/** T16: the quote page's public address, the one the live message carries. */
export const SANDBOX_QUOTE_URL_BASE = 'https://www.handyservices.app/q/';

/** T16: the sender label on a mirrored outbound says which live path composed it and how it would have travelled. */
export function mirrorSender(kind: 'rules layer ack' | 'post-call continuation' | "Ben's send", plan: { mode: string; templateName?: string | null; channel?: string | null }): string {
    const how = plan.mode === 'template' && plan.templateName ? `template ${plan.templateName}` : plan.mode === 'sms' || plan.channel === 'sms' ? 'by SMS' : plan.mode;
    return `Sandbox (${kind} · ${how} · mirrored, never sent)`;
}

/** The one line the customer types, checked. Returns the clean text or the refusal. */
export function validateCustomerText(raw: unknown): { ok: true; text: string } | { ok: false; error: string } {
    if (typeof raw !== 'string') return { ok: false, error: 'text must be a string' };
    const text = raw.replace(/\r\n/g, '\n').trim();
    if (!text) return { ok: false, error: 'text is empty' };
    if (text.length > MAX_MESSAGE_CHARS) return { ok: false, error: `text is over ${MAX_MESSAGE_CHARS} characters` };
    return { ok: true, text };
}

/**
 * T11: the message with its attachments. With files, the text is the caption and may be empty
 * (a customer often sends the photo alone); without files it is the message and may not be.
 */
export function validateCustomerMessage(raw: unknown, fileCount: number): { ok: true; text: string } | { ok: false; error: string } {
    if (fileCount > SANDBOX_MAX_FILES) return { ok: false, error: `at most ${SANDBOX_MAX_FILES} files per message` };
    if (fileCount > 0 && (raw === undefined || raw === null || raw === '')) return { ok: true, text: '' };
    const v = validateCustomerText(raw);
    if (!v.ok && fileCount > 0 && v.error === 'text is empty') return { ok: true, text: '' };
    return v;
}

/** T16: which pipe the customer's message arrives on. Only the two Twilio inbound channels. */
export type InboundChannel = 'whatsapp' | 'sms';
export function validateInboundChannel(raw: unknown, fileCount: number): { ok: true; channel: InboundChannel } | { ok: false; error: string } {
    const c = raw === undefined || raw === null || raw === '' ? 'whatsapp' : raw;
    if (c !== 'whatsapp' && c !== 'sms') return { ok: false, error: "channel must be 'whatsapp' or 'sms'" };
    if (c === 'sms' && fileCount > 0) return { ok: false, error: 'an SMS cannot carry a photo or video: a UK long code cannot receive MMS. Send it on WhatsApp, or describe it in words as an SMS customer would.' };
    return { ok: true, channel: c };
}

// ---------------------------------------------------------------- T11: media bounds (pure, tested)

/** Files per sandbox message. Above `spine.video.maxPerRun` (6) on purpose: the over-bound case must be reachable. */
export const SANDBOX_MAX_FILES = 8;
/** WhatsApp's own media cap, the same limit server/voice-notes.ts uses. */
export const SANDBOX_MAX_FILE_BYTES = 16 * 1024 * 1024;
/** Declared MIME → stored extension. Anything else is refused before a byte is written. */
export const SANDBOX_MEDIA_TYPES: Readonly<Record<string, string>> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif',
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/3gpp': '3gp',
};
/** The stored file is named after its message id, as a real inbound is (`<MessageSid>.<ext>`). */
export const SANDBOX_MEDIA_ID_PREFIX = 'msg_sbx_';

export function validateSandboxMediaType(mime: unknown): { ok: true; ext: string; kind: 'image' | 'video' } | { ok: false; error: string } {
    const m = typeof mime === 'string' ? mime.toLowerCase().trim() : '';
    const ext = SANDBOX_MEDIA_TYPES[m];
    if (!ext) return { ok: false, error: `${m || 'unknown type'} is not accepted: photos (jpeg, png, webp, gif, heic) or videos (mp4, mov, webm, 3gp) only` };
    return { ok: true, ext, kind: m.startsWith('video/') ? 'video' : 'image' };
}

export function sandboxMediaId(): string {
    return `${SANDBOX_MEDIA_ID_PREFIX}${randomUUID().replace(/-/g, '').slice(0, 13)}`;
}

/** `<message id>.<ext>` — never the browser's filename, never a path. */
export function sandboxMediaFileName(id: string, mime: string): string {
    const t = validateSandboxMediaType(mime);
    if (!t.ok) throw new Error(t.error);
    if (!/^[a-z0-9_]+$/i.test(id)) throw new Error('bad media id');
    return `${id}.${t.ext}`;
}

/** The message id a stored sandbox file belongs to, or null when the name is not ours. */
export function sandboxMediaIdOf(fileName: string): string | null {
    const base = path.basename(fileName);
    if (base !== fileName) return null;
    const m = /^(msg_sbx_[a-f0-9]{13})\.[a-z0-9]{1,5}$/i.exec(base);
    return m ? m[1] : null;
}

/** multer's refusals, in words the page can show. */
export function describeUploadError(err: unknown): string {
    const e = err as { code?: string; message?: string; field?: string } | null;
    switch (e?.code) {
        case 'LIMIT_FILE_SIZE': return `a file is over ${SANDBOX_MAX_FILE_BYTES / (1024 * 1024)} MB (WhatsApp's own cap)`;
        case 'LIMIT_FILE_COUNT': case 'LIMIT_UNEXPECTED_FILE': return `at most ${SANDBOX_MAX_FILES} files per message, in the 'media' field`;
        default: return e?.message ?? 'upload refused';
    }
}

// ---------------------------------------------------------------- T11: what the desk saw (pure, tested)

export type SandboxMediaStatus = 'described' | 'cached' | 'failed' | 'over_bound' | 'off' | 'images_off' | 'no_key' | 'unsupported' | 'missing';

export interface SandboxMediaReport {
    id: string;
    kind: MediaItem['kind'];
    url: string | null;
    /** What the Scoper read, verbatim from the case file; null is the whole finding. */
    description: string | null;
    status: SandboxMediaStatus;
    /** One line for the page: why there is a description, or why not. */
    note: string;
    /** The vision row for THIS pass, when one was written (a cache hit writes none). */
    vision: { runId: string; costPence: number | null; error: string | null } | null;
}

/**
 * `spine.video` as this server reads it, plus whether GEMINI_API_KEY (or GOOGLE_API_KEY) is set on THIS
 * server — the one running the sandbox — and (T14) the describer's health from the newest vision rows.
 */
export type SandboxVideoStatus = SpineConfig['video'] & { keyPresent: boolean; health?: import('./vision-health').VisionHealth | null };

export const MEDIA_STATUS_NOTE: Record<SandboxMediaStatus, string> = {
    described: 'Described on this pass by Gemini. This is the description on the case file; the Scoper\'s case-file summary carries its first 160 characters (scoper.ts clip).',
    cached: 'Description came from the cache (identical bytes were described on an earlier pass). No model call, no cost. This is the description on the case file; the Scoper\'s case-file summary carries its first 160 characters (scoper.ts clip).',
    failed: 'Description FAILED on this pass: the Scoper saw this item as bare media with no description. The vision row records the error; the server log has the describe_video line.',
    over_bound: 'NOT described: outside the per-pass bound. Only the last maxPerRun eligible items on the thread are described; this earlier one was dropped. The Scoper saw bare media.',
    off: 'NOT described: spine.video.enabled is off on this server, so no media is described. The Scoper saw bare media.',
    images_off: 'NOT described: spine.video.images is off, so photos are skipped (videos are still described). The Scoper saw bare media.',
    no_key: 'NOT described: GEMINI_API_KEY is not set on this server, so the describer has nothing to call. The Scoper saw bare media.',
    unsupported: 'NOT described: only photos and videos are described. The Scoper saw bare media.',
    missing: 'NOT described and no vision row was written: the describer threw or was unavailable before it could record anything. Check the server log for [describe_video] / [Spine] describe_video. The Scoper saw bare media.',
};

/**
 * Per media item on the case file: the description the Scoper read, or the one reason there is
 * none. Reads the SAME selection rule buildCaseFile used (media-selection.ts), so the report
 * cannot say "described" of something that was dropped, or "dropped" of something described.
 */
export function mediaReportFor(
    media: readonly MediaItem[],
    video: SandboxVideoStatus,
    visionRows: readonly { id: string; mediaId: string | null; decision: string | null; error: string | null; costPence: number | null }[],
): SandboxMediaReport[] {
    const selection = explainMediaSelection(media, { images: !!video.images, maxPerRun: video.maxPerRun ?? DEFAULT_SPINE_CONFIG.video.maxPerRun });
    return media.map((m) => {
        const row = visionRows.find((r) => r.mediaId === m.id) ?? null;
        const vision = row ? { runId: row.id, costPence: row.costPence ?? null, error: row.error ?? null } : null;
        const description = m.description ?? null;
        let status: SandboxMediaStatus;
        if (description) status = row ? 'described' : 'cached';
        else if (!video.enabled) status = 'off';
        else {
            const why = selection.get(m.id) ?? 'unsupported';
            if (why === 'images_off') status = 'images_off';
            else if (why === 'unsupported' || why === 'no_url') status = 'unsupported';
            else if (why === 'over_bound') status = 'over_bound';
            else if (!video.keyPresent) status = 'no_key';
            else if (row && (row.decision === 'failed' || row.error)) status = 'failed';
            else status = 'missing';
        }
        const note = status === 'failed' && vision?.error ? `${MEDIA_STATUS_NOTE.failed} Error: ${vision.error}` : MEDIA_STATUS_NOTE[status];
        return { id: m.id, kind: m.kind, url: m.url ?? null, description, status, note, vision };
    });
}

export function geminiKeyPresent(env: NodeJS.ProcessEnv = process.env): boolean {
    return !!(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
}

/** A synthetic quote's numbers, checked: a whole number of pence between £1 and £20,000. */
export function validateQuoteSeed(body: unknown): { ok: true; totalPence: number; title: string } | { ok: false; error: string } {
    const b = (body && typeof body === 'object' ? body : {}) as { totalPence?: unknown; title?: unknown };
    const totalPence = b.totalPence === undefined ? SANDBOX_DEFAULT_TOTAL_PENCE : Number(b.totalPence);
    if (!Number.isInteger(totalPence) || totalPence < 100 || totalPence > 2_000_000) return { ok: false, error: 'totalPence must be a whole number of pence between 100 and 2000000' };
    const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim().slice(0, 120) : 'Replace bathroom extractor fan';
    return { ok: true, totalPence, title };
}

/** T16: Ben's total for the waiting draft — his number, else the engine's suggestion, else the seed's default. */
export function validatePriceTotal(body: unknown, suggestedPence: number | null | undefined): { ok: true; totalPence: number; source: 'ben' | 'suggested' } | { ok: false; error: string } {
    const b = (body && typeof body === 'object' ? body : {}) as { totalPence?: unknown };
    if (b.totalPence !== undefined && b.totalPence !== null && b.totalPence !== '') {
        const n = Number(b.totalPence);
        if (!Number.isInteger(n) || n < 100 || n > 2_000_000) return { ok: false, error: 'totalPence must be a whole number of pence between 100 and 2000000' };
        return { ok: true, totalPence: n, source: 'ben' };
    }
    if (suggestedPence != null && Number.isFinite(suggestedPence) && suggestedPence >= 100) return { ok: true, totalPence: Math.round(suggestedPence), source: 'suggested' };
    return { ok: false, error: 'no total: the draft has no suggested total, so type one (pence)' };
}

/**
 * T6: did this pass land on the rules layer's first-contact answer? If so the sandbox must do what
 * the rules layer does live — put the ack on the thread — or the desk never gets a turn. Pure:
 * reads the pass alone. Only the two intents the ack can carry on a message; a missed call or a
 * returning customer cannot arise from typing into the sandbox.
 */
export function firstContactMirrorFor(run: Pick<RunOnceResult, 'triage' | 'pack' | 'decision'>): { intent: 'ack_enquiry' | 'ack_photos' } | null {
    if (run.triage.lane !== 'rules') return null;
    if (run.pack.id !== 'rules.first_contact') return null;
    if (run.decision.kind !== 'none') return null;
    const intent = run.triage.intent;
    if (intent !== 'ack_enquiry' && intent !== 'ack_photos') return null;
    return { intent };
}

export interface SandboxMirror {
    kind: 'first_contact_ack';
    intent: 'ack_enquiry' | 'ack_photos';
    body: string;
    messageId: string | null;
    /** T19: the sender label the mirrored row carries (the page labels the bubble off it). */
    sender: string;
    note: string;
    /** T16: the whole plan — pipe, ladder rung, config gate — so the page can say what production would do. */
    plan: AckPlan;
}

export const MIRROR_NOTE = 'First contact is answered by the rules layer (the first-contact ack), not by the desk. Live, the customer would have received the line below. The sandbox has placed it on the thread so your next message reaches the desk, as it would live.';

/** T16: one line on the gate, for the mirrored box. */
export function ackGateNote(plan: Pick<AckPlan, 'gate' | 'mode' | 'holdSeconds' | 'door'>): string {
    const g = plan.gate;
    const live = g.liveWouldSend
        ? `On this server the first-contact ack is ON for ${plan.door === 'post_call' ? 'post_call' : plan.door}, so production would send exactly this, ${plan.holdSeconds[0]} to ${plan.holdSeconds[1]} seconds after the message (the realism hold).`
        : !g.enabled
            ? 'On this server the first-contact ack is OFF (comms_agent.firstContactAutoAck.enabled), so production would send NOTHING here today; the thread would sit as first contact until a person or the rules layer\'s asks answered it. The sandbox mirrors it anyway so the desk gets its turn.'
            : !g.channelOn
                ? `On this server the first-contact ack is on, but not for this door (channels excludes ${plan.door}), so production would send NOTHING here today. The sandbox mirrors it anyway so the desk gets its turn.`
                : 'On this server nothing can go: no template, no SMS sender. Live it queues for Ben.';
    return live;
}

/** The slug is 8 chars max on the column; `sbx` marks it at a glance. */
export function sandboxSlug(): string {
    return `sbx${randomUUID().replace(/-/g, '').slice(0, 5)}`;
}

/** What the page shows of a pass: everything the spine decided, none of the case file's bulk. */
export function summariseRun(run: RunOnceResult, cost: { costPence: number | null; model: string | null; turns: number | null } | null) {
    return {
        runId: run.runId,
        agent: run.agent,
        trigger: run.trigger,
        pack: run.pack,
        triage: run.triage,
        proposal: run.proposal ?? null,
        guards: run.guards ?? null,
        decision: run.decision,
        dryRun: run.dryRun ?? true,
        sandbox: run.sandbox ?? true,
        exitNote: run.exitNote ?? null,
        skipped: run.skipped ?? [],
        error: run.error ?? null,
        durationMs: run.durationMs ?? null,
        costPence: cost?.costPence ?? null,
        model: cost?.model ?? null,
        turns: cost?.turns ?? null,
        caseFile: {
            stage: run.caseFile.stage, tags: run.caseFile.tags, quote: run.caseFile.quote ?? null,
            window: run.caseFile.window, openFlags: run.caseFile.openFlags, openPromises: run.caseFile.openPromises,
            timelineItems: run.caseFile.timeline.length,
        },
        benLaneClerk: run.benLaneClerk ?? null,
        routeA: run.routeA ?? null,
    };
}

export type SandboxRunSummary = ReturnType<typeof summariseRun>;

// ---------------------------------------------------------------- T16: the thread's own record of what happened

export type SandboxEventKind = 'entry' | 'ack' | 'route_a' | 'quote_seeded' | 'quote_sent' | 'accepted' | 'aged' | 'clock' | 'tags' | 'call';
export interface SandboxEvent { at: string; kind: SandboxEventKind; summary: string; detail?: unknown }

/** What the sandbox keeps on conversations.metadata.sandbox. Never nextTriageAt. */
export interface SandboxMeta {
    door: SandboxDoor;
    name: string | null;
    startedAt: string;
    entry: EntryReport | null;
    events: SandboxEvent[];
    /** T21: the last call Ben made on this thread, as the live ingest reported it. */
    lastCall?: SandboxCallReport | null;
}

/** T21: Ben's call as the live ingest wrote and judged it, for the page and the event log. */
export interface SandboxCallReport {
    callId: string;
    /** The card line call-thread.ts wrote ("Outbound call (2m 5s): …"). */
    preview: string;
    durationSeconds: number;
    transcriptChars: number;
    startedAt: string;
    /** The ladder's plan for the transcript ingest: spineRun, spineRunReason (the outreach rail that refused, if one did), settleCallback. */
    ladder: LadderPlan | null;
    /** True when live would have asked the spine for the call_ended pass. The sandbox runs it either way. */
    liveWouldRun: boolean;
    /** What 3b settled: the callback tags that came off and whether T17's door released the thread. */
    callbackSettled: NonNullable<CallThreadResult['callbackSettled']> | null;
    tagsBefore: string[];
    tagsAfter: string[];
    /** The window after the call: unchanged, because a call never touches lastInboundAt. */
    window: WindowReport;
}

/** One line for the event log. Pure. */
export function callEventSummary(r: Pick<SandboxCallReport, 'durationSeconds' | 'transcriptChars' | 'ladder' | 'liveWouldRun' | 'callbackSettled' | 'window'>): string {
    const verdict = r.liveWouldRun
        ? 'live, the desk is handed the thread (call_ended)'
        : `live, the desk is NOT handed the thread: ${r.ladder?.spineRunReason ?? 'no ladder plan'}`;
    const settled = r.callbackSettled
        ? `; callback settled (${[...r.callbackSettled.tagsCleared.map((t) => `${t} cleared`), ...(r.callbackSettled.released ? [`released from Ben, ${r.callbackSettled.flagsDismissed} flag(s) dismissed`] : [])].join(', ')})`
        : '';
    return `Ben rang them: answered, ${r.durationSeconds}s, transcript ${r.transcriptChars} chars — ${verdict}${settled}. Window ${r.window.canFreeform ? 'still OPEN' : 'SHUT'} (a call never touches it).`;
}
export const SANDBOX_EVENTS_MAX = 60;

export interface EntryReport {
    door: SandboxDoor;
    meaning: (typeof DOOR_MEANING)[SandboxDoor];
    /** webform / sms: the first-contact ack ladder. whatsapp (T19): the freeform plan, filled in after the first pass lands on first contact. */
    ack: AckPlan | null;
    /** T19: whatsapp only — the customer's opening message, the event that created the thread. */
    firstMessage?: string | null;
    /** T19: true when the door's own event opened the 24 h window (only a customer WhatsApp does). */
    openedWindow?: boolean;
    /** post_call: the continuation plan and the seeded call. */
    postCall: (PostCallPlan & { call: { id: string; preview: string; durationSeconds: number; transcriptChars: number } }) | null;
    /** What the sandbox placed on the thread for the customer to "have received", or why nothing. */
    mirrored: { messageId: string; channel: 'whatsapp' | 'sms'; body: string; sender: string } | null;
    /** The desk's first pass, when the live path would run one. */
    firstRunTrigger: 'inbound_message' | 'call_ended' | null;
}

/** Pure: append one event, newest last, bounded. */
export function appendEvent(events: readonly SandboxEvent[] | undefined | null, e: SandboxEvent): SandboxEvent[] {
    return [...(events ?? []), e].slice(-SANDBOX_EVENTS_MAX);
}

// ---------------------------------------------------------------- the thread, by number only

async function findSandboxConversation() {
    const [row] = await db.select({
        id: conversations.id, phoneNumber: conversations.phoneNumber, stage: conversations.stage, tags: conversations.tags,
        contactName: conversations.contactName, createdAt: conversations.createdAt, metadata: conversations.metadata,
    }).from(conversations).where(eq(conversations.phoneNumber, SANDBOX_PHONE_WA)).orderBy(desc(conversations.createdAt)).limit(1);
    // Belt: the row we found by number IS on the sandbox number. It cannot not be; this is the
    // check that would fire if the constants above ever drifted apart.
    if (row && !isSandboxPhone(row.phoneNumber)) throw new Error('sandbox conversation is not on the sandbox number');
    return row ?? null;
}

function sandboxMetaOf(metadata: unknown): SandboxMeta | null {
    const m = (metadata as { sandbox?: SandboxMeta } | null)?.sandbox;
    return m && typeof m === 'object' && typeof m.door === 'string' ? m : null;
}

/** Merge onto conversations.metadata.sandbox (read-modify-write; one operator). Never touches nextTriageAt. */
async function patchSandboxMeta(conversationId: string, patch: Partial<SandboxMeta> | ((current: SandboxMeta | null) => SandboxMeta)): Promise<SandboxMeta> {
    const [row] = await db.select({ metadata: conversations.metadata }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    const current = sandboxMetaOf(row?.metadata);
    const next: SandboxMeta = typeof patch === 'function'
        ? patch(current)
        : { door: 'whatsapp', name: null, startedAt: new Date().toISOString(), entry: null, events: [], ...(current ?? {}), ...patch };
    await db.update(conversations).set({
        metadata: sql`coalesce(${conversations.metadata}, '{}'::jsonb) || jsonb_build_object('sandbox', ${JSON.stringify(next)}::jsonb)`,
        updatedAt: new Date(),
    }).where(eq(conversations.id, conversationId));
    return next;
}

async function recordEvent(conversationId: string, e: Omit<SandboxEvent, 'at'>): Promise<void> {
    await patchSandboxMeta(conversationId, (cur) => ({
        door: cur?.door ?? 'whatsapp', name: cur?.name ?? null, startedAt: cur?.startedAt ?? new Date().toISOString(), entry: cur?.entry ?? null,
        events: appendEvent(cur?.events, { at: new Date().toISOString(), ...e }),
    })).catch((err: any) => console.warn('[Sandbox] event not recorded:', err?.message ?? err));
}

/** T16: the window as the case file will read it: canSendFreeform + the last customer WhatsApp. */
async function windowOf(conversationId: string | null): Promise<WindowReport> {
    let lastWa: Date | null = null;
    let channelLastUsed: WindowReport['channelLastUsed'] = null;
    if (conversationId) {
        const [wa] = await db.select({ at: messages.createdAt }).from(messages)
            .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, 'inbound'), eq(messages.channel, 'whatsapp')))
            .orderBy(desc(messages.createdAt)).limit(1);
        lastWa = wa?.at ?? null;
        const [last] = await db.select({ channel: messages.channel }).from(messages)
            .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, 'inbound')))
            .orderBy(desc(messages.createdAt)).limit(1);
        channelLastUsed = (last?.channel as WindowReport['channelLastUsed']) ?? null;
    }
    const report = windowReport({ lastWhatsAppInboundAt: lastWa, channelLastUsed });
    // Belt: the live check itself, on the sandbox number. If it disagrees with the row-derived
    // read (a clock skew, a lastInboundAt someone set by hand), the live answer wins and says so.
    try {
        const { canSendFreeform } = await import('../meta-whatsapp');
        const live = await canSendFreeform(SANDBOX_PHONE_E164);
        if (live !== report.canFreeform) {
            return { ...report, canFreeform: live, summary: `${live ? 'OPEN' : 'SHUT'} — canSendFreeform says so (conversations.lastInboundAt); the message rows say ${report.summary}` };
        }
    } catch { /* the row-derived read stands */ }
    return report;
}

/** T16: this server's switches, read-only, so the door cards can say what production would do. */
async function gatesOf() {
    const out = {
        firstContactAck: { enabled: false, channels: [] as string[], askForMedia: false },
        postCallContinuation: { enabled: false },
        spineEnabled: false,
        smsSenderConfigured: false,
        templates: [] as Array<{ name: string; status: string }>,
    };
    try { const { getCommsAgentConfig } = await import('../agents/comms'); const c = (await getCommsAgentConfig()).firstContactAutoAck; out.firstContactAck = { enabled: !!c.enabled, channels: c.channels ?? [], askForMedia: !!c.askForMedia }; } catch { /* off */ }
    try { const { getContinuationConfig } = await import('../post-call-outreach'); out.postCallContinuation = { enabled: !!(await getContinuationConfig()).enabled }; } catch { /* off */ }
    try { const { isSpineEnabled } = await import('./config'); out.spineEnabled = await isSpineEnabled(); } catch { /* off */ }
    try { const { isSmsSenderConfigured } = await import('../whatsapp-sender'); out.smsSenderConfigured = isSmsSenderConfigured(); } catch { /* off */ }
    try { out.templates = (await templateCache()).map((t) => ({ name: t.name, status: t.status })); } catch { /* none */ }
    return out;
}

/** The Meta template cache as rows (whatsapp_templates), read once per plan. */
async function templateCache(): Promise<TemplateRow[]> {
    const { getCachedTemplates } = await import('../whatsapp-template-sync');
    const rows = await getCachedTemplates();
    return rows.map((r) => ({ name: r.name, status: r.status, body: r.body ?? null, contentSid: r.contentSid }));
}

async function ackConfig() {
    const { DEFAULT_FIRST_CONTACT_ACK } = await import('../first-contact-ack');
    try { const { getCommsAgentConfig } = await import('../agents/comms'); return (await getCommsAgentConfig()).firstContactAutoAck; } catch { return { ...DEFAULT_FIRST_CONTACT_ACK, enabled: false }; }
}

/** T16: the Route A draft waiting on the sandbox number (the one the price queue would show if it did not exclude us). */
async function waitingDraft() {
    const [q] = await db.select({
        id: personalizedQuotes.id, slug: personalizedQuotes.shortSlug, customerName: personalizedQuotes.customerName, jobDescription: personalizedQuotes.jobDescription,
        pricingLineItems: personalizedQuotes.pricingLineItems, pricingSuggestions: personalizedQuotes.pricingSuggestions, createdAt: personalizedQuotes.createdAt,
        estimateId: personalizedQuotes.estimateId, sourceChannel: personalizedQuotes.sourceChannel, isDraft: personalizedQuotes.isDraft, basePrice: personalizedQuotes.basePrice, depositPaidAt: personalizedQuotes.depositPaidAt,
    }).from(personalizedQuotes)
        .where(and(sql`regexp_replace(${personalizedQuotes.phone}, '[^0-9]', '', 'g') = ${SANDBOX_DIGITS}`, isNull(personalizedQuotes.supersededAt), isNull(personalizedQuotes.revokedAt)))
        .orderBy(desc(personalizedQuotes.createdAt)).limit(1);
    if (!q) return null;
    const sug = (q.pricingSuggestions ?? null) as { totals?: { suggestedPence?: number | null }; lines?: Array<{ checkThis?: boolean }> } | null;
    const lines = Array.isArray(q.pricingLineItems) ? (q.pricingLineItems as Array<{ description?: string; label?: string; title?: string }>) : [];
    return {
        id: q.id, slug: q.slug, isDraft: !!q.isDraft, basePrice: q.basePrice ?? null, depositPaidAt: q.depositPaidAt ?? null, createdAt: q.createdAt, sourceChannel: q.sourceChannel ?? null, estimateId: q.estimateId ?? null,
        customerName: q.customerName, lines: lines.map((l) => String(l.title ?? l.description ?? l.label ?? '')).filter(Boolean),
        suggestedTotalPence: sug?.totals?.suggestedPence ?? null, checkThis: (sug?.lines ?? []).filter((l) => l.checkThis).length,
    };
}

async function loadState() {
    const conv = await findSandboxConversation();
    const msgs = conv ? await db.select({
        id: messages.id, direction: messages.direction, content: messages.content, createdAt: messages.createdAt,
        senderName: messages.senderName, channel: messages.channel,
        type: messages.type, mediaUrl: messages.mediaUrl, mediaType: messages.mediaType,
    }).from(messages).where(eq(messages.conversationId, conv.id)).orderBy(messages.createdAt).limit(200) : [];
    const quotes = await db.select({
        id: personalizedQuotes.id, slug: personalizedQuotes.shortSlug, jobDescription: personalizedQuotes.jobDescription,
        basePrice: personalizedQuotes.basePrice, expiresAt: personalizedQuotes.expiresAt, createdAt: personalizedQuotes.createdAt,
        depositPaidAt: personalizedQuotes.depositPaidAt, revokedAt: personalizedQuotes.revokedAt, isDraft: personalizedQuotes.isDraft, supersededAt: personalizedQuotes.supersededAt,
    }).from(personalizedQuotes)
        .where(sql`regexp_replace(${personalizedQuotes.phone}, '[^0-9]', '', 'g') = ${SANDBOX_DIGITS}`)
        .orderBy(desc(personalizedQuotes.createdAt)).limit(5);
    const runs = conv ? await db.select({
        id: agentRuns.id, agent: agentRuns.agent, trigger: agentRuns.trigger, decision: agentRuns.decision, lane: agentRuns.lane,
        costPence: agentRuns.costPence, model: agentRuns.model, durationMs: agentRuns.durationMs, error: agentRuns.error,
        startedAt: agentRuns.startedAt, finishedAt: agentRuns.finishedAt, proposal: agentRuns.proposal, parentRunId: agentRuns.parentRunId,
    }).from(agentRuns).where(and(eq(agentRuns.conversationId, conv.id), sql`${agentRuns.parentRunId} IS NULL`))
        .orderBy(desc(agentRuns.startedAt)).limit(20) : [];
    const meta = conv ? sandboxMetaOf(conv.metadata) : null;
    const sentQuote = quotes.find((q) => !q.isDraft && !q.revokedAt && !q.supersededAt) ?? null;
    const delivered = !!sentQuote?.slug && msgs.some((m) => m.direction === 'outbound' && (m.content ?? '').includes(sentQuote.slug!));
    const draft = await waitingDraft().catch(() => null);
    return {
        phone: { e164: SANDBOX_PHONE_E164, wa: SANDBOX_PHONE_WA },
        video: await videoStatus(),
        conversation: conv ? { id: conv.id, stage: conv.stage, tags: conv.tags ?? [], contactName: conv.contactName, createdAt: conv.createdAt, hasTrigger: !!(conv.metadata as any)?.nextTriageAt } : null,
        messages: msgs,
        quote: sentQuote ?? quotes[0] ?? null,
        // T16
        door: meta?.door ?? (conv ? 'whatsapp' : null),
        entry: meta?.entry ?? null,
        events: meta?.events ?? [],
        // T21
        lastCall: meta?.lastCall ?? null,
        callDefaults: { transcript: OUTBOUND_CALL_DEFAULT_TRANSCRIPT },
        window: await windowOf(conv?.id ?? null),
        gates: await gatesOf(),
        funnel: {
            stage: conv?.stage ?? null,
            draft: draft && draft.isDraft ? draft : null,
            quote: sentQuote ? { slug: sentQuote.slug, basePrice: sentQuote.basePrice, delivered, accepted: !!sentQuote.depositPaidAt, expiresAt: sentQuote.expiresAt } : null,
        },
        runs: runs.map((r) => {
            const p = (r.proposal ?? {}) as any;
            return {
                id: r.id, agent: r.agent, trigger: r.trigger, decision: r.decision, lane: r.lane, costPence: r.costPence, model: r.model,
                durationMs: r.durationMs, error: r.error, startedAt: r.startedAt, finishedAt: r.finishedAt,
                sandbox: p?.sandbox === true, intent: p?.proposal?.intent ?? null, bubbles: Array.isArray(p?.proposal?.body) ? p.proposal.body : [],
            };
        }),
    };
}

/** T11: the sandbox's read of this server's description switch and key — read-only, never changed here. */
async function videoStatus(): Promise<SandboxVideoStatus> {
    const cfg = await getSpineConfig().catch(() => DEFAULT_SPINE_CONFIG);
    const video = { ...DEFAULT_SPINE_CONFIG.video, ...(cfg.video ?? {}) };
    // T14: the same verdict the sidebar badge and the staff card read, so the banner names the reason.
    const health = await import('./vision-health').then((m) => m.visionHealth()).catch(() => null);
    return { ...video, keyPresent: geminiKeyPresent(), health };
}

interface InboundMedia { id: string; url: string; mimeType: string; kind: 'image' | 'video' }
type InboundRowChannel = 'whatsapp' | 'sms' | 'webform';

/**
 * One inbound row. With `media`, the row is shaped exactly as server/conversation-engine.ts
 * shapes a real WhatsApp media inbound (id = the file's stem, type image|video, mediaUrl
 * '/api/media/<file>', mediaType the MIME, content the caption or '').
 * T16: `channel` decides the window: only a WhatsApp inbound moves lastInboundAt (the one column
 * canSendFreeform reads); an SMS or a webform moves the customer clock only, as live.
 */
async function insertInbound(conversationId: string, content: string, media?: InboundMedia, opts: { channel?: InboundRowChannel; senderName?: string | null } = {}): Promise<string> {
    const id = media?.id ?? `msg_sbx_${randomUUID().slice(0, 13)}`;
    const now = new Date();
    const channel = opts.channel ?? 'whatsapp';
    await db.insert(messages).values({
        id, conversationId, direction: 'inbound', channel, content, status: channel === 'whatsapp' ? 'received' : 'delivered',
        senderName: opts.senderName ?? SANDBOX_CONTACT_NAME, createdAt: now,
        type: media ? media.kind : 'text',
        mediaUrl: media?.url ?? null,
        mediaType: media?.mimeType ?? null,
    });
    await db.update(conversations).set({
        lastMessageAt: now, lastMessagePreview: (content || (media ? 'Media received' : '')).slice(0, 200), lastCustomerContactAt: now,
        // Only a WhatsApp inbound opens Meta's 24 h window (conversation-engine.ts windowFields).
        ...(channel === 'whatsapp' ? { lastInboundAt: now, canSendFreeform: true, templateRequired: false } : {}),
        unreadCount: sql`coalesce(${conversations.unreadCount}, 0) + 1`, updatedAt: now,
    }).where(eq(conversations.id, conversationId));
    return id;
}

async function insertOutbound(conversationId: string, content: string, senderName: string = SANDBOX_SYNTHETIC_SENDER, channel: 'whatsapp' | 'sms' = 'whatsapp'): Promise<string> {
    const id = `msg_sbx_${randomUUID().slice(0, 13)}`;
    const now = new Date();
    await db.insert(messages).values({
        id, conversationId, direction: 'outbound', channel, content, status: 'sent',
        senderName, createdAt: now,
    });
    await db.update(conversations).set({ lastMessageAt: now, lastMessagePreview: content.slice(0, 200), updatedAt: now })
        .where(eq(conversations.id, conversationId));
    return id;
}

/** Everything on the sandbox number, gone. The dev board demo's cleanup, on the sandbox number. */
async function cleanupSandbox(): Promise<{ conversations: number; quotes: number; files: number; calls: number; estimates: number }> {
    const convs = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.phoneNumber, SANDBOX_PHONE_WA));
    const ids = convs.map((c) => c.id);
    let files = 0;
    let estimates = 0;
    if (ids.length) {
        // T11: the uploaded bytes go too — only files named as ours (msg_sbx_<id>.<ext>), only from
        // MEDIA_DIR, so a row that somehow pointed elsewhere could never delete a customer's photo.
        const mediaRows = await db.select({ mediaUrl: messages.mediaUrl }).from(messages)
            .where(and(inArray(messages.conversationId, ids), sql`${messages.mediaUrl} IS NOT NULL`));
        for (const r of mediaRows) {
            const file = path.basename(r.mediaUrl ?? '');
            if (!sandboxMediaIdOf(file)) continue;
            try { fs.unlinkSync(path.join(MEDIA_DIR, file)); files++; } catch { /* already gone */ }
        }
        await db.delete(messages).where(inArray(messages.conversationId, ids));
        await db.delete(agentQuestions).where(inArray(agentQuestions.conversationId, ids));
        await db.delete(agentOutcomes).where(inArray(agentOutcomes.conversationId, ids));
        await db.delete(agentRuns).where(inArray(agentRuns.conversationId, ids));
        // T16: what a sandbox Route A pass writes on this conversation (a job pack is never written; the delete is a belt).
        try { estimates = (await db.delete(quoteEstimates).where(inArray(quoteEstimates.conversationId, ids)).returning({ id: quoteEstimates.id })).length; } catch (e: any) { if (!/quote_estimates/.test(String(e?.message))) throw e; }
        try { await db.delete(jobPacks).where(inArray(jobPacks.conversationId, ids)); } catch (e: any) { if (!/job_packs/.test(String(e?.message))) throw e; }
        try { await db.delete(systemEvents).where(inArray(systemEvents.conversationId, ids)); } catch (e: any) { console.warn('[Sandbox] system_events cleanup skipped:', e?.message ?? e); }
        await db.delete(conversations).where(inArray(conversations.id, ids));
    }
    await db.delete(messageDrafts).where(eq(messageDrafts.phone, SANDBOX_PHONE_E164));
    await db.delete(nudgeQueue).where(eq(nudgeQueue.phone, SANDBOX_PHONE_E164));
    const quotes = await db.delete(personalizedQuotes)
        .where(sql`regexp_replace(${personalizedQuotes.phone}, '[^0-9]', '', 'g') = ${SANDBOX_DIGITS}`)
        .returning({ id: personalizedQuotes.id });
    // T16: the seeded call rows (post_call door), by number.
    const callRows = await db.delete(calls)
        .where(sql`regexp_replace(${calls.phoneNumber}, '[^0-9]', '', 'g') = ${SANDBOX_DIGITS}`)
        .returning({ id: calls.id });
    return { conversations: ids.length, quotes: quotes.length, files, calls: callRows.length, estimates };
}

async function createSandboxConversation(opts: { contactName?: string | null; door?: SandboxDoor; startedName?: string | null } = {}): Promise<string> {
    const id = randomUUID();
    const now = new Date();
    // Same shape as the dev board demo's new-card, WITHOUT metadata.nextTriageAt: nothing must
    // ever arm the triage ticker on this row. T16: metadata.sandbox records the door.
    const meta: SandboxMeta = { door: opts.door ?? 'whatsapp', name: opts.startedName ?? null, startedAt: now.toISOString(), entry: null, events: [] };
    await db.insert(conversations).values({
        id, phoneNumber: SANDBOX_PHONE_WA, contactName: opts.contactName ?? SANDBOX_CONTACT_NAME, stage: 'enquiry',
        tags: ['sandbox'], lastMessageAt: now, lastCustomerContactAt: now,
        notes: 'COMMS SANDBOX — a play thread on the Ofcom drama number. Not a customer. Nothing here is ever sent.',
        metadata: { sandbox: meta },
    });
    return id;
}

async function ensureSandboxConversation(): Promise<string> {
    const conv = await findSandboxConversation();
    return conv?.id ?? createSandboxConversation();
}

/** The row's own cost (B2 records it; turns live on the ledger only, so they are not read here). */
async function costOf(runId: string) {
    const [row] = await db.select({ costPence: agentRuns.costPence, model: agentRuns.model })
        .from(agentRuns).where(eq(agentRuns.id, runId));
    return row ? { costPence: row.costPence ?? null, model: row.model ?? null, turns: null } : null;
}

/**
 * T16: the ONE exit step the sandbox mirrors — the agent's proposal tags onto the thread. Live,
 * exit.ts writes these (PROPOSAL_TAG_ALLOWLIST, additive) whatever the decision but drop, and a
 * new needs_quote asks for the clerk's run. It is bookkeeping on this thread alone (no send, no
 * ping), and without it a Scoper's needs_quote is lost here and the clerk is unreachable: the
 * funnel would stop at scoping. Kept equal to exit.ts's list by test (sandbox-routes.test.ts).
 */
export const MIRRORED_PROPOSAL_TAGS: readonly string[] = ['needs_quote', 'trust_concern', 'rescope'];

/** Pure: which of the proposal's tags the exit would write. */
export function proposalTagsToMirror(run: Pick<RunOnceResult, 'proposal' | 'decision'>): string[] {
    if (run.decision.kind === 'drop') return [];
    return (run.proposal?.tags ?? []).map((t) => String(t).toLowerCase()).filter((t) => MIRRORED_PROPOSAL_TAGS.includes(t));
}

/** One sandbox pass, summarised, with what the desk saw of the media. */
async function passOn(conversationId: string, trigger: 'inbound_message' | 'call_ended' | 'cadence' | 'manual') {
    // Layer 1 at the call site AND inside runOnce (sandbox implies dryRun): the exit never runs.
    const run = await runOnce(conversationId, trigger, undefined, { dryRun: true, sandbox: true });
    const summary = summariseRun(run, await costOf(run.runId));
    const video = await videoStatus();
    const media = mediaReportFor(run.caseFile.media, video, await visionRowsOf(run.runId).catch(() => []));
    if (run.routeA?.sandbox?.benNotice) {
        await recordEvent(conversationId, { kind: 'route_a', summary: `Route A: draft ${run.routeA.draftSlug ?? '?'} priced by the engine; Ben would have been pinged "${run.routeA.sandbox.benNotice.title}" (not sent)`, detail: { runId: run.runId, routeA: run.routeA } });
    }
    const wanted = proposalTagsToMirror(run);
    let tagsAdded: string[] = [];
    if (wanted.length) {
        const [row] = await db.select({ tags: conversations.tags }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);
        const current = (row?.tags as string[] | null) ?? [];
        tagsAdded = wanted.filter((t) => !current.includes(t));
        if (tagsAdded.length) {
            await db.update(conversations).set({ tags: [...current, ...tagsAdded], updatedAt: new Date() }).where(eq(conversations.id, conversationId));
            await recordEvent(conversationId, { kind: 'tags', summary: `Tags ${tagsAdded.join(', ')} put on the thread (the exit's bookkeeping, mirrored)${tagsAdded.includes('needs_quote') ? ' — live, the clerk\'s pass is asked for at once; here, press Run a clock pass or send a message' : ''}`, detail: { runId: run.runId, tagsAdded } });
        }
    }
    return { run, summary: { ...summary, tagsAdded }, media, video };
}

// ---------------------------------------------------------------- routes

commsSandboxRouter.get('/', async (_req, res) => {
    try {
        res.json(await loadState());
    } catch (error: any) {
        console.error('[Sandbox] state failed:', error);
        res.status(500).json({ error: error?.message ?? 'sandbox state failed' });
    }
});

commsSandboxRouter.post('/reset', async (_req, res) => {
    try {
        const deleted = await cleanupSandbox();
        const conversationId = await createSandboxConversation();
        res.json({ ok: true, deleted, conversationId, state: await loadState() });
    } catch (error: any) {
        console.error('[Sandbox] reset failed:', error);
        res.status(500).json({ error: error?.message ?? 'sandbox reset failed' });
    }
});

/**
 * T6 / T16 / T19: if the pass landed on the rules layer's first contact, plan the ack for the
 * channel the message came on (the window is open only when that channel is WhatsApp), place it
 * on the thread as a synthetic outbound, record the event, and return the mirror for the page.
 * Null when the pass did not land there (the desk answered, or the screen refused). Shared by
 * /message and the WhatsApp door of /start, so both doors into first contact behave identically.
 */
async function mirrorFirstContactAck(conversationId: string, run: RunOnceResult, input: { channel: 'whatsapp' | 'sms'; name: string | null; text: string; hasMedia: boolean }): Promise<SandboxMirror | null> {
    const mirror = firstContactMirrorFor(run);
    if (!mirror) return null;
    const templates = await templateCache().catch(() => [] as TemplateRow[]);
    const config = await ackConfig();
    let smsSenderConfigured = false;
    try { const { isSmsSenderConfigured } = await import('../whatsapp-sender'); smsSenderConfigured = isSmsSenderConfigured(); } catch { /* off */ }
    const plan = planFirstContactAck({
        door: input.channel, intent: mirror.intent, name: input.name, text: input.text,
        hasMedia: input.hasMedia, windowOpen: input.channel === 'whatsapp', config, templates, smsSenderConfigured,
    });
    const sender = plan.mode === 'freeform' ? SANDBOX_RULES_ACK_SENDER : mirrorSender('rules layer ack', plan);
    let ackId: string | null = null;
    if (plan.body && plan.channel) ackId = await insertOutbound(conversationId, plan.body, sender, plan.channel);
    await recordEvent(conversationId, { kind: 'ack', summary: `First-contact ack (${mirror.intent}): ${plan.mode}${plan.templateName ? ` (${plan.templateName})` : ''} — ${plan.reason}`, detail: { gate: plan.gate } });
    return { kind: 'first_contact_ack', intent: mirror.intent, body: plan.body ?? '', messageId: ackId, sender, note: `${MIRROR_NOTE} ${ackGateNote(plan)}`, plan };
}

// ---------------------------------------------------------------- T16: the four doors

commsSandboxRouter.post('/start', async (req, res) => {
    try {
        const v = validateStart(req.body);
        if (!v.ok) { res.status(400).json({ error: v.error }); return; }
        const input = v.input;
        const deleted = await cleanupSandbox();
        // The name the door would know: the WhatsApp pushname, the form field, the call's customer_name.
        const conversationId = await createSandboxConversation({ contactName: input.name ?? SANDBOX_CONTACT_NAME, door: input.door, startedName: input.name });
        const entry = await openDoor(conversationId, input);
        await patchSandboxMeta(conversationId, (cur) => ({
            door: input.door, name: input.name, startedAt: cur?.startedAt ?? new Date().toISOString(), entry,
            events: appendEvent(cur?.events, { at: new Date().toISOString(), kind: 'entry', summary: entrySummary(entry), detail: { door: input.door } }),
        }));
        let pass: Awaited<ReturnType<typeof passOn>> | null = null;
        if (entry.firstRunTrigger) pass = await passOn(conversationId, entry.firstRunTrigger);
        // T19: on the WhatsApp door the ack answers the customer's message, so it can only be
        // planned once the pass has said this is first contact (the T6 rule, firstContactMirrorFor).
        let mirrored: SandboxMirror | null = null;
        let finalEntry = entry;
        if (input.door === 'whatsapp' && pass) {
            mirrored = await mirrorFirstContactAck(conversationId, pass.run, { channel: 'whatsapp', name: looksLikeAName(input.name) ? input.name : null, text: input.text, hasMedia: false });
            finalEntry = {
                ...entry,
                ack: mirrored?.plan ?? null,
                mirrored: mirrored?.messageId && mirrored.plan.channel ? { messageId: mirrored.messageId, channel: mirrored.plan.channel, body: mirrored.body, sender: mirrored.sender } : null,
            };
            await patchSandboxMeta(conversationId, { entry: finalEntry });
        }
        res.json({ ok: true, deleted, door: input.door, entry: finalEntry, run: pass?.summary ?? null, mirrored, media: pass?.media ?? null, video: pass?.video ?? null, state: await loadState() });
    } catch (error: any) {
        console.error('[Sandbox] start failed:', error);
        res.status(500).json({ error: error?.message ?? 'sandbox start failed' });
    }
});

/** One line for the event log. */
export function entrySummary(entry: EntryReport): string {
    const meaning = DOOR_MEANING[entry.door].label;
    if (entry.door === 'whatsapp') return `Opened through ${meaning}: the customer's message "${enquirySnippet(entry.firstMessage)}" created the thread and opened the 24 h window; first contact`;
    if (entry.postCall) return `Opened through ${meaning}: call ${entry.postCall.call.preview}; continuation ${entry.postCall.outcome === 'template' ? `template ${entry.postCall.templateName}` : entry.postCall.reason}`;
    if (entry.ack) return `Opened through ${meaning}: ack ${entry.ack.mode}${entry.ack.templateName ? ` (${entry.ack.templateName})` : ''}${entry.ack.channel ? ` by ${entry.ack.channel}` : ''} — ${entry.ack.reason}`;
    return `Opened through ${meaning}`;
}

/** Seed the door's shape onto the (fresh) sandbox thread and mirror the first thing the customer would receive. */
async function openDoor(conversationId: string, input: StartInput): Promise<EntryReport> {
    const meaning = DOOR_MEANING[input.door];
    const base: EntryReport = { door: input.door, meaning, ack: null, postCall: null, mirrored: null, firstRunTrigger: null };
    if (input.door === 'whatsapp') {
        // T19: the live writer (conversation-engine.ts) — one WhatsApp inbound row, which is what
        // opens the window (insertInbound sets lastInboundAt for this channel only). No ack yet:
        // live, the rules layer answers only once the pass has landed on first contact, and the
        // /start handler mirrors it after the pass through the same helper /message uses.
        await insertInbound(conversationId, input.text, undefined, { channel: 'whatsapp', senderName: input.name ?? SANDBOX_CONTACT_NAME });
        return { ...base, firstMessage: input.text, openedWindow: true, firstRunTrigger: 'inbound_message' };
    }

    const templates = await templateCache().catch(() => [] as TemplateRow[]);
    const config = await ackConfig();
    const { isSmsSenderConfigured } = await import('../whatsapp-sender');
    const smsSenderConfigured = (() => { try { return isSmsSenderConfigured(); } catch { return false; } })();

    if (input.door === 'webform' || input.door === 'sms') {
        // The live writers (leads.ts / conversation-engine.ts): one inbound row on the channel, no lastInboundAt.
        await insertInbound(conversationId, input.text, undefined, { channel: input.door, senderName: input.name ?? SANDBOX_CONTACT_NAME });
        const ack = planFirstContactAck({ door: input.door, name: input.name, text: input.text, windowOpen: false, config, templates, smsSenderConfigured });
        let mirrored: EntryReport['mirrored'] = null;
        if (ack.body && ack.channel) {
            const sender = mirrorSender('rules layer ack', ack);
            const messageId = await insertOutbound(conversationId, ack.body, sender, ack.channel);
            mirrored = { messageId, channel: ack.channel, body: ack.body, sender };
        }
        await recordEvent(conversationId, { kind: 'ack', summary: `First-contact ack: ${ack.mode}${ack.templateName ? ` (${ack.templateName})` : ''} — ${ack.reason}`, detail: { gate: ack.gate, rungs: ack.rungs } });
        return { ...base, ack, mirrored, firstRunTrigger: 'inbound_message' };
    }

    // post_call: the calls row and its message row, as call-thread.ts writes them; then the ladder.
    const { describeCall, callMessageId } = await import('../call-thread');
    const now = new Date();
    const durationSeconds = Math.max(45, Math.min(900, Math.round(input.transcript.length / 12)));
    const startTime = new Date(now.getTime() - durationSeconds * 1000);
    const classification = sandboxClassification(input, now);
    const callId = `sbx_call_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const callRow = {
        id: callId, callId, phoneNumber: SANDBOX_PHONE_E164, startTime, endTime: now, direction: 'inbound', status: 'completed',
        duration: durationSeconds, customerName: input.name, transcription: input.transcript, jobSummary: classification.jobSummary,
        classification, outcome: null as string | null, handledBy: null as string | null, ringSeconds: 6,
    };
    await db.insert(calls).values(callRow as any);
    const info = describeCall(callRow as any);
    const content = info.summary && !info.preview.includes(info.summary) ? `${info.preview}\n${info.summary}` : info.preview;
    await db.insert(messages).values({
        id: callMessageId(callId), conversationId, direction: 'inbound', content, type: 'text', channel: 'call', status: 'delivered',
        senderName: input.name ?? null, createdAt: now,
    });
    // A call does NOT open the window: lastInboundAt untouched (call-thread.ts rule 1).
    await db.update(conversations).set({ lastMessageAt: now, lastMessagePreview: info.preview, lastCustomerContactAt: now, unreadCount: sql`coalesce(${conversations.unreadCount}, 0) + 1`, updatedAt: now }).where(eq(conversations.id, conversationId));

    let continuationEnabled = false;
    try { const { getContinuationConfig } = await import('../post-call-outreach'); continuationEnabled = !!(await getContinuationConfig()).enabled; } catch { /* off */ }
    let spineEnabled = false;
    try { const { isSpineEnabled } = await import('./config'); spineEnabled = await isSpineEnabled(); } catch { /* off */ }
    const plan = planPostCallContinuation({ classification, customerName: input.name, transcript: input.transcript, templates, continuation: { enabled: continuationEnabled }, ack: config, spineEnabled });
    let mirrored: EntryReport['mirrored'] = null;
    if (plan.body) {
        const sender = mirrorSender('post-call continuation', { mode: 'template', templateName: plan.templateName });
        const messageId = await insertOutbound(conversationId, plan.body, sender, 'whatsapp');
        mirrored = { messageId, channel: 'whatsapp', body: plan.body, sender };
    }
    await recordEvent(conversationId, { kind: 'ack', summary: `Post-call continuation: ${plan.outcome} — ${plan.reason}`, detail: { gate: plan.gate, rungs: plan.rungs, route: plan.route } });
    return {
        ...base,
        postCall: { ...plan, call: { id: callId, preview: info.preview, durationSeconds, transcriptChars: input.transcript.length } },
        mirrored,
        // The ladder asks for call_ended only when the spine is on; the sandbox runs it regardless
        // (the transcript is long enough by validation) and the plan says what live would do.
        firstRunTrigger: 'call_ended',
    };
}

// ---------------------------------------------------------------- T16: the window as a control

commsSandboxRouter.post('/age', async (req, res) => {
    try {
        const v = validateAge(req.body);
        if (!v.ok) { res.status(400).json({ error: v.error }); return; }
        const conv = await findSandboxConversation();
        if (!conv) { res.status(409).json({ error: 'no sandbox thread: start one first' }); return; }
        const secs = Math.round(v.hours * 3600);
        const back = sql`make_interval(secs => ${secs})`;
        await db.update(messages).set({ createdAt: sql`${messages.createdAt} - ${back}` }).where(eq(messages.conversationId, conv.id));
        await db.update(conversations).set({
            lastInboundAt: sql`${conversations.lastInboundAt} - ${back}`,
            lastMessageAt: sql`${conversations.lastMessageAt} - ${back}`,
            lastCustomerContactAt: sql`${conversations.lastCustomerContactAt} - ${back}`,
            createdAt: sql`${conversations.createdAt} - ${back}`,
            updatedAt: new Date(),
        }).where(eq(conversations.id, conv.id));
        await db.update(calls).set({ startTime: sql`${calls.startTime} - ${back}`, endTime: sql`${calls.endTime} - ${back}` })
            .where(sql`regexp_replace(${calls.phoneNumber}, '[^0-9]', '', 'g') = ${SANDBOX_DIGITS}`);
        await db.update(personalizedQuotes).set({ createdAt: sql`${personalizedQuotes.createdAt} - ${back}`, expiresAt: sql`${personalizedQuotes.expiresAt} - ${back}`, depositPaidAt: sql`${personalizedQuotes.depositPaidAt} - ${back}` } as any)
            .where(sql`regexp_replace(${personalizedQuotes.phone}, '[^0-9]', '', 'g') = ${SANDBOX_DIGITS}`);
        await db.update(agentRuns).set({ startedAt: sql`${agentRuns.startedAt} - ${back}`, finishedAt: sql`${agentRuns.finishedAt} - ${back}` }).where(eq(agentRuns.conversationId, conv.id));
        await db.update(agentQuestions).set({ createdAt: sql`${agentQuestions.createdAt} - ${back}`, dueAt: sql`${agentQuestions.dueAt} - ${back}` } as any).where(eq(agentQuestions.conversationId, conv.id));
        try { await db.update(quoteEstimates).set({ createdAt: sql`${quoteEstimates.createdAt} - ${back}`, finishedAt: sql`${quoteEstimates.finishedAt} - ${back}` } as any).where(eq(quoteEstimates.conversationId, conv.id)); } catch { /* table absent */ }
        const window = await windowOf(conv.id);
        await recordEvent(conv.id, { kind: 'aged', summary: `Moved the thread back ${v.hours} h. Window now ${window.summary}`, detail: { hours: v.hours, window } });
        res.json({ ok: true, hours: v.hours, window, state: await loadState() });
    } catch (error: any) {
        console.error('[Sandbox] age failed:', error);
        res.status(500).json({ error: error?.message ?? 'sandbox age failed' });
    }
});

commsSandboxRouter.post('/run', async (req, res) => {
    try {
        const v = validateClockTrigger(req.body);
        if (!v.ok) { res.status(400).json({ error: v.error }); return; }
        const conv = await findSandboxConversation();
        if (!conv) { res.status(409).json({ error: 'no sandbox thread: start one first' }); return; }
        const pass = await passOn(conv.id, v.trigger);
        await recordEvent(conv.id, { kind: 'clock', summary: `Clock pass (${v.trigger}): lane ${pass.run.triage.lane} → ${pass.run.decision.kind}`, detail: { runId: pass.run.runId } });
        res.json({ ok: true, trigger: v.trigger, run: pass.summary, media: pass.media, video: pass.video, mirrored: null, state: await loadState() });
    } catch (error: any) {
        console.error('[Sandbox] run failed:', error);
        res.status(500).json({ error: error?.message ?? 'sandbox run failed' });
    }
});

// ---------------------------------------------------------------- T21: Ben rings them

/**
 * The captain's flow: the customer wrote first (the window is open), said yes to a call, and Ben
 * rang them from Groundwire and asked for photos. This writes that call as the live path does and
 * lets the LIVE ingest judge it, so what the page shows is call-thread.ts's own verdict:
 *
 *   1. the `calls` row: direction outbound, OUTBOUND_ANSWERED (index.ts sip-outbound-status), the
 *      real talk time, the transcript, and the verdict the classifier writes for a call we made
 *      (kind outbound_call, consent fields neutral; sandboxOutboundClassification). The call starts
 *      AFTER the newest message on the thread, as it does live (Ben rings after they wrote), so the
 *      send preconditions see the call as the newest turn, exactly as they would live.
 *   2. ingestCallRow with call-logger.ts finalizeCall's own options: the card line, the clocks (never
 *      lastInboundAt), 3b's callback settle, the ladder behind the outreach rails. Its requestRun
 *      refuses the sandbox number ('test number'), so no scheduled pass is ever armed here.
 *   3. the call_ended pass, run by the sandbox whatever the ladder said (the plan says what live
 *      would have done), so the Scoper's follow-up is on the page.
 */
commsSandboxRouter.post('/call', async (req, res) => {
    try {
        const v = validateCall(req.body);
        if (!v.ok) { res.status(400).json({ error: v.error }); return; }
        const conv = await findSandboxConversation();
        if (!conv) { res.status(409).json({ error: 'no sandbox thread: start one first' }); return; }
        const { transcript, durationSeconds } = v.input;
        const now = new Date();
        // Ben rings after the customer's last word: the call starts strictly after the newest row.
        const [newest] = await db.select({ at: sql<string | null>`max(${messages.createdAt})` }).from(messages).where(eq(messages.conversationId, conv.id));
        const newestAt = newest?.at ? new Date(newest.at).getTime() : 0;
        const startTime = new Date(Math.max(now.getTime() - durationSeconds * 1000, newestAt + 1000));
        const endTime = new Date(Math.max(now.getTime(), startTime.getTime() + durationSeconds * 1000));
        const classification = sandboxOutboundClassification(transcript, now);
        const callId = `sbx_call_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const customerName = looksLikeAName(conv.contactName) ? conv.contactName : null;
        await db.insert(calls).values({
            id: callId, callId, phoneNumber: SANDBOX_PHONE_E164, startTime, endTime, direction: 'outbound', status: 'completed',
            outcome: 'OUTBOUND_ANSWERED', handledBy: 'va', duration: durationSeconds, ringSeconds: 8, customerName,
            transcription: transcript, jobSummary: classification.jobSummary, classification,
        } as any);
        const [row] = await db.select().from(calls).where(eq(calls.id, callId)).limit(1);
        if (!row) throw new Error('the sandbox call row was not written');
        const tagsBefore = ((conv.tags as string[] | null) ?? []).slice();
        const { ingestCallRow } = await import('../call-thread');
        // call-logger.ts finalizeCall's options, verbatim: the live path for a call that just ended.
        const ingest = await ingestCallRow(row, { markUnread: true, ack: true, outboundOpensCard: true, continuation: true });
        if (ingest.status === 'skipped') throw new Error(`the live ingest refused the call: ${ingest.reason}`);
        const [after] = await db.select({ tags: conversations.tags }).from(conversations).where(eq(conversations.id, conv.id)).limit(1);
        const window = await windowOf(conv.id);
        const report: SandboxCallReport = {
            callId, preview: ingest.preview ?? '', durationSeconds, transcriptChars: transcript.length, startedAt: startTime.toISOString(),
            ladder: ingest.ladder ?? null, liveWouldRun: ingest.ladder?.spineRun === 'call_ended',
            callbackSettled: ingest.callbackSettled ?? null, tagsBefore, tagsAfter: ((after?.tags as string[] | null) ?? []).slice(), window,
        };
        await recordEvent(conv.id, { kind: 'call', summary: callEventSummary(report), detail: { callId, ladder: report.ladder, callbackSettled: report.callbackSettled } });
        await patchSandboxMeta(conv.id, { lastCall: report });
        const pass = await passOn(conv.id, 'call_ended');
        res.json({ ok: true, call: report, run: pass.summary, media: pass.media, video: pass.video, mirrored: null, state: await loadState() });
    } catch (error: any) {
        console.error('[Sandbox] call failed:', error);
        res.status(500).json({ error: error?.message ?? 'sandbox call failed' });
    }
});

// ---------------------------------------------------------------- the quote seed (T5)

commsSandboxRouter.post('/quote', async (req, res) => {
    try {
        const seed = validateQuoteSeed(req.body);
        if (!seed.ok) { res.status(400).json({ error: seed.error }); return; }
        const conversationId = await ensureSandboxConversation();
        const slug = sandboxSlug();
        const now = new Date();
        await db.insert(personalizedQuotes).values({
            id: `sbx_${randomUUID()}`,
            shortSlug: slug,
            customerName: SANDBOX_CONTACT_NAME,
            phone: SANDBOX_PHONE_E164,
            jobDescription: `${SANDBOX_QUOTE_MARK}: ${seed.title}`,
            basePrice: seed.totalPence,
            pricingLineItems: [{ description: seed.title, pricePence: seed.totalPence, sandbox: true }],
            expiresAt: new Date(now.getTime() + 48 * 3_600_000),
            isDraft: false,
            createdAt: now,
        } as any);
        // The message that would have carried the link (quote-context dates the quote from it).
        const outboundId = await insertOutbound(conversationId, `Hi! Here's your quote for £${(seed.totalPence / 100).toFixed(2)}. Click to view and book: ${SANDBOX_QUOTE_URL_BASE}${slug}`);
        await db.update(conversations).set({ stage: 'quote_sent', updatedAt: new Date() }).where(eq(conversations.id, conversationId));
        await recordEvent(conversationId, { kind: 'quote_seeded', summary: `Seeded an unpaid quote ${slug} for £${(seed.totalPence / 100).toFixed(2)} (synthetic, no clerk, no Route A)`, detail: { slug } });
        res.json({ ok: true, slug, outboundId, state: await loadState() });
    } catch (error: any) {
        console.error('[Sandbox] quote seed failed:', error);
        res.status(500).json({ error: error?.message ?? 'sandbox quote seed failed' });
    }
});

// ---------------------------------------------------------------- T16: the funnel

commsSandboxRouter.post('/price', async (req, res) => {
    try {
        const conv = await findSandboxConversation();
        if (!conv) { res.status(409).json({ error: 'no sandbox thread: start one first' }); return; }
        const draft = await waitingDraft();
        if (!draft) { res.status(409).json({ error: 'no quote on the thread: the clerk has not produced a draft yet (or Seed quote instead)' }); return; }
        if (draft.depositPaidAt) { res.status(409).json({ error: `quote ${draft.slug} is already accepted` }); return; }
        const [already] = await db.select({ id: messages.id }).from(messages)
            .where(and(eq(messages.conversationId, conv.id), eq(messages.direction, 'outbound'), sql`${messages.content} ILIKE ${'%' + draft.slug + '%'}`)).limit(1);
        if (!draft.isDraft && already) { res.status(409).json({ error: `quote ${draft.slug} is already with the customer` }); return; }
        const total = validatePriceTotal(req.body, draft.basePrice ?? draft.suggestedTotalPence);
        if (!total.ok) { res.status(400).json({ error: total.error }); return; }
        const now = new Date();
        // What confirmPrices leaves on the row: out of draft, the total on it, a fresh expiry. The
        // sandbox prices the TOTAL only (live, Ben prices each line on the price screen).
        if (draft.isDraft) {
            await db.update(personalizedQuotes).set({ isDraft: false, basePrice: total.totalPence, expiresAt: new Date(now.getTime() + 48 * 3_600_000) } as any).where(eq(personalizedQuotes.id, draft.id));
        }
        const window = await windowOf(conv.id);
        const templates = await templateCache().catch(() => [] as TemplateRow[]);
        const firstName = looksLikeAName(conv.contactName) ? nameSlot(conv.contactName) : null;
        const delivery: QuoteLinkPlan = planQuoteLinkDelivery({ windowOpen: window.canFreeform, firstName, totalPence: total.totalPence, quoteUrl: `${SANDBOX_QUOTE_URL_BASE}${draft.slug}`, templates });
        let messageId: string | null = null;
        if (delivery.body) {
            messageId = await insertOutbound(conv.id, delivery.body, mirrorSender("Ben's send", delivery), 'whatsapp');
            // agent-staff markQuoteSent: stage quote_sent, tag quote_sent.
            await db.update(conversations).set({ stage: 'quote_sent', tags: Array.from(new Set([...((conv.tags as string[] | null) ?? []), 'quote_sent'])), updatedAt: new Date() }).where(eq(conversations.id, conv.id));
        }
        await recordEvent(conv.id, { kind: 'quote_sent', summary: `Ben priced ${draft.slug} at £${(total.totalPence / 100).toFixed(2)} (${total.source === 'ben' ? "Ben's number" : 'the engine\'s suggestion'}); delivery ${delivery.mode} — ${delivery.reason}`, detail: { slug: draft.slug, totalPence: total.totalPence, delivery } });
        res.json({ ok: true, slug: draft.slug, totalPence: total.totalPence, source: total.source, delivery, messageId, window, state: await loadState() });
    } catch (error: any) {
        console.error('[Sandbox] price failed:', error);
        res.status(500).json({ error: error?.message ?? 'sandbox price failed' });
    }
});

commsSandboxRouter.post('/accept', async (req, res) => {
    try {
        const conv = await findSandboxConversation();
        if (!conv) { res.status(409).json({ error: 'no sandbox thread: start one first' }); return; }
        const q = await waitingDraft();
        if (!q || q.isDraft) { res.status(409).json({ error: 'no sent quote on the thread to accept (Ben prices and sends first, or Seed quote)' }); return; }
        if (q.depositPaidAt) { res.status(409).json({ error: `quote ${q.slug} is already accepted` }); return; }
        const [delivered] = await db.select({ id: messages.id }).from(messages)
            .where(and(eq(messages.conversationId, conv.id), eq(messages.direction, 'outbound'), sql`${messages.content} ILIKE ${'%' + q.slug + '%'}`)).limit(1);
        if (!delivered) { res.status(409).json({ error: `quote ${q.slug} is priced but not with the customer yet (the window was shut). Send a customer WhatsApp message to reopen it, then press Ben prices and sends again.` }); return; }
        const total = q.basePrice ?? 0;
        // The deposit the quote page would take: the live settings' percentage (read-only), on labour, rounded as depositFor does.
        let depositPercent = 25;
        try { const { getPricingSettings } = await import('../pricing-settings'); depositPercent = Number((await getPricingSettings() as any).depositPercent ?? depositPercent); } catch { /* the shared default */ }
        const { depositFor } = await import('@shared/pricing-settings');
        const depositPence = depositFor(total, 0, depositPercent);
        const now = new Date();
        await db.update(personalizedQuotes).set({ depositPaidAt: now, depositAmountPence: depositPence, paymentType: 'deposit' } as any).where(eq(personalizedQuotes.id, q.id));
        // markConversationWonByPhone's effect, on this row only.
        await db.update(conversations).set({ stage: 'won', updatedAt: now }).where(eq(conversations.id, conv.id));
        const notice: SandboxBenNotice = quoteAcceptedNotice({ customerName: q.customerName, phoneNumber: SANDBOX_PHONE_E164, jobSummary: q.lines.join('; ') || null, amountPaidPence: depositPence, paymentType: 'deposit' });
        const next = 'Live, the Stripe webhook does exactly this: depositPaidAt on the quote, the thread to won, the "Quote accepted" push on Ben\'s phone (recorded here, never sent), and the delivery questions (job-pack asks: access, who is home, parking, pets) start from the slow sweep in proactive hours, one per day. The sandbox is skipped by every sweep, so press Run a clock pass to see the desk on this thread now.';
        await recordEvent(conv.id, { kind: 'accepted', summary: `Customer accepted ${q.slug}: deposit £${(depositPence / 100).toFixed(2)} paid; thread → won; Ben would have been pinged "${notice.title}" (not sent)`, detail: { slug: q.slug, depositPence, notice } });
        res.json({ ok: true, slug: q.slug, depositPence, depositPercent, notice, next, state: await loadState() });
    } catch (error: any) {
        console.error('[Sandbox] accept failed:', error);
        res.status(500).json({ error: error?.message ?? 'sandbox accept failed' });
    }
});

// ---------------------------------------------------------------- T11: the upload

/**
 * multer, bounded: the declared type must be in SANDBOX_MEDIA_TYPES (checked in fileFilter before
 * a byte is written), SANDBOX_MAX_FILE_BYTES per file, SANDBOX_MAX_FILES per message. The bytes
 * land in MEDIA_DIR — the same directory a real inbound is written to and /api/media serves — under
 * a name this server chose (sandboxMediaFileName); the browser's filename is never used. A JSON
 * body passes straight through: multer only parses multipart.
 */
const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
            try { fs.mkdirSync(MEDIA_DIR, { recursive: true }); cb(null, MEDIA_DIR); } catch (e) { cb(e as Error, MEDIA_DIR); }
        },
        filename: (_req, file, cb) => {
            try { cb(null, sandboxMediaFileName(sandboxMediaId(), file.mimetype)); } catch (e) { cb(e as Error, ''); }
        },
    }),
    limits: { fileSize: SANDBOX_MAX_FILE_BYTES, files: SANDBOX_MAX_FILES, fields: 5 },
    fileFilter: (_req, file, cb) => {
        const t = validateSandboxMediaType(file.mimetype);
        if (t.ok) cb(null, true); else cb(new Error(t.error));
    },
});

function removeUploaded(files: readonly { path: string }[] | undefined): void {
    for (const f of files ?? []) { try { fs.unlinkSync(f.path); } catch { /* already gone */ } }
}

function parseSandboxUpload(req: Request, res: Response, next: NextFunction): void {
    if (!req.is('multipart/form-data')) { next(); return; }
    upload.array('media', SANDBOX_MAX_FILES)(req, res, (err: unknown) => {
        if (err) {
            removeUploaded(req.files as Express.Multer.File[] | undefined);
            res.status(400).json({ error: describeUploadError(err) });
            return;
        }
        next();
    });
}

/** The vision rows this pass wrote (one per model call; a cache hit writes none). */
async function visionRowsOf(runId: string) {
    const rows = await db.select({ id: agentRuns.id, decision: agentRuns.decision, error: agentRuns.error, costPence: agentRuns.costPence, proposal: agentRuns.proposal })
        .from(agentRuns).where(and(eq(agentRuns.parentRunId, runId), eq(agentRuns.agent, 'vision')));
    return rows.map((r) => ({ id: r.id, decision: r.decision ?? null, error: r.error ?? null, costPence: r.costPence ?? null, mediaId: ((r.proposal ?? {}) as { mediaId?: string }).mediaId ?? null }));
}

commsSandboxRouter.post('/message', parseSandboxUpload, async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    try {
        const v = validateCustomerMessage(req.body?.text, files.length);
        if (!v.ok) { removeUploaded(files); res.status(400).json({ error: v.error }); return; }
        const ch = validateInboundChannel(req.body?.channel, files.length);
        if (!ch.ok) { removeUploaded(files); res.status(400).json({ error: ch.error }); return; }
        const conversationId = await ensureSandboxConversation();
        const conv = await findSandboxConversation();
        const senderName = conv?.contactName && looksLikeAName(conv.contactName) ? conv.contactName : SANDBOX_CONTACT_NAME;
        const messageIds: string[] = [];
        if (!files.length) {
            messageIds.push(await insertInbound(conversationId, v.text, undefined, { channel: ch.channel, senderName }));
        } else {
            // One row per file, in the order attached, the text as the first one's caption — the
            // Twilio shape (Body + MediaUrl0). Mirrored to S3 like a real inbound: never throws.
            for (let i = 0; i < files.length; i++) {
                const f = files[i];
                const id = sandboxMediaIdOf(f.filename);
                const t = validateSandboxMediaType(f.mimetype);
                if (!id || !t.ok) throw new Error(`stored file ${f.filename} is not a sandbox media file`);
                await mirrorMediaToS3(f.filename, fs.readFileSync(f.path), f.mimetype);
                messageIds.push(await insertInbound(conversationId, i === 0 ? v.text : '', { id, url: `/api/media/${f.filename}`, mimeType: f.mimetype, kind: t.kind }, { channel: 'whatsapp', senderName }));
            }
        }
        const messageId = messageIds[0];
        const pass = await passOn(conversationId, 'inbound_message');
        const { run, summary, media, video } = pass;
        // T6: first contact — mirror the rules layer's ack so the thread can leave the rules lane.
        // T16: the mirror is the whole plan (pipe, ladder, gate), for the door the message came through.
        const mirrored = await mirrorFirstContactAck(conversationId, run, {
            channel: ch.channel, name: looksLikeAName(conv?.contactName) ? conv!.contactName : null, text: v.text, hasMedia: files.length > 0,
        });
        res.json({ ok: true, messageId, messageIds, channel: ch.channel, run: summary, mirrored, media, video, state: await loadState() });
    } catch (error: any) {
        console.error('[Sandbox] message failed:', error);
        removeUploaded(files);
        res.status(500).json({ error: error?.message ?? 'sandbox message failed' });
    }
});
