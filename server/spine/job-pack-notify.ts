/**
 * P13 part 4 — the contractor's WhatsApp for the job pack. Two fixed messages, no model:
 *
 *   job_pack_ready     "Job pack for <title>, <postcode>, <date>: <link>"  when the dispatch is
 *                      created (every contractor it was sent to) and when a contractor accepts
 *   job_pack_changed   "Update on <title> <date>: <fields> changed. <link>"  when a day-relevant
 *                      field changes after acceptance; at most one an hour per job, batched
 *
 * Both leave through sendCustomerMessage (the ONE exit: approver `rules.job_pack`, a run id, the
 * ledger's message_out under the contractor's role profile). Guards: the body never carries the
 * customer's surname, address, phone or any money, and the link is the contractor's own portal
 * page. Business-initiated, so outside a 24 h window they need APPROVED Meta templates
 * (docs/comms-build/TEMPLATES-JOB-PACK.md); until approved, an in-window send goes freeform and
 * an out-of-window one queues for Ben with the reason, exactly as the holding line did before
 * its template was approved.
 */
import { newRunId, type Approver } from '../approver';
import type { ChangeLogEntry, JobPack } from './job-pack';
import { dayRelevantChanges } from './job-pack-readers';
import { fieldLabel } from './job-pack';

export const JOB_PACK_APPROVER: Approver = 'rules.job_pack';
export const READY_TEMPLATE_NAMES = ['job_pack_ready_v1', 'job_pack_ready'];
export const CHANGED_TEMPLATE_NAMES = ['job_pack_changed_v1', 'job_pack_changed'];
export const CHANGED_BATCH_MS = 60 * 60_000;

// ---------------------------------------------------------------- bodies (pure)

export function dateWords(iso: string | Date | null | undefined): string {
    if (!iso) return 'date to be confirmed';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'date to be confirmed';
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });
}

/** Outward postcode only ("NG2"), never the full one: the address unlocks on accept, on the page. */
export function outwardPostcode(postcode: string | null | undefined): string {
    const p = String(postcode ?? '').trim().toUpperCase();
    if (!p) return '';
    return p.split(/\s+/)[0].replace(/\d[A-Z]{2}$/, '') || p;
}

export interface ReadyInput { title: string; postcode: string | null; date: string | Date | null; link: string }
export function readyBody(i: ReadyInput): string {
    const where = outwardPostcode(i.postcode);
    return `Job pack for ${i.title}${where ? `, ${where}` : ''}, ${dateWords(i.date)}: ${i.link}`;
}

export interface ChangedInput { title: string; date: string | Date | null; fields: string[]; link: string }
export function changedBody(i: ChangedInput): string {
    const list = Array.from(new Set(i.fields)).slice(0, 4);
    const what = list.length === 1 ? `${list[0]} changed` : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]} changed`;
    return `Update on ${i.title} ${dateWords(i.date)}: ${what}. ${i.link}`;
}

/** Template variables, in placeholder order ({{1}}…{{4}} for ready, {{1}}…{{4}} for changed). */
export function readyVariables(i: ReadyInput): string[] { return [i.title, outwardPostcode(i.postcode) || 'TBC', dateWords(i.date), i.link]; }
export function changedVariables(i: ChangedInput): string[] { return [i.title, dateWords(i.date), Array.from(new Set(i.fields)).slice(0, 4).join(', '), i.link]; }

// ---------------------------------------------------------------- guard (pure)

const MONEY = /£|\bpounds?\b|\bquid\b|\bdeposit\b|\bpay\b|\bpaid\b|\bprice\b|\bcost\b/i;
const PHONE = /(?:\+44\s?7\d{3}|\(?07\d{3}\)?)\s?\d{3}\s?\d{3}|\b0\d{2,4}\s?\d{3}\s?\d{3,4}\b/;
const FULL_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i;
const STREET = /\b\d{1,4}[a-z]?\s+[A-Z][a-z]+\s+(Road|Rd|Street|St|Lane|Ln|Avenue|Ave|Close|Cl|Drive|Dr|Way|Crescent|Cres|Grove|Place|Pl|Terrace|Court|Ct|Gardens)\b/;

/**
 * Pure: what a contractor message may never carry. `customer` is the customer's name parts so a
 * surname slipping in through a title is caught; the first name alone is allowed.
 */
export function guardContractorBody(body: string, customer: { firstName?: string | null; fullName?: string | null } = {}): string[] {
    const out: string[] = [];
    if (MONEY.test(body)) out.push('money');
    if (PHONE.test(body)) out.push('a phone number');
    if (FULL_POSTCODE.test(body)) out.push('a full postcode');
    if (STREET.test(body)) out.push('a street address');
    const first = (customer.firstName ?? '').trim().toLowerCase();
    const parts = (customer.fullName ?? '').trim().split(/\s+/).filter((p) => p.length > 2 && p.toLowerCase() !== first);
    for (const p of parts) if (new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(body)) { out.push('the customer\'s surname'); break; }
    if (/[—–]/.test(body)) out.push('a dash');
    return out;
}

// ---------------------------------------------------------------- batching (pure)

/** Pure: the changed notice is due when the last one for this job is older than an hour (or none). */
export function changedNoticeDue(lastSentAt: Date | null, now: Date): boolean {
    return !lastSentAt || now.getTime() - lastSentAt.getTime() >= CHANGED_BATCH_MS;
}

/** Pure: the fields to name, from the change-log rows since the last notice (day-relevant only). */
export function fieldsToName(pack: Pick<JobPack, 'lines'>, entries: ChangeLogEntry[], sinceIso: string | null): string[] {
    const rows = dayRelevantChanges(entries.filter((e) => !sinceIso || e.at > sinceIso));
    return Array.from(new Set(rows.map((e) => fieldLabel(e.field, pack.lines))));
}

// ---------------------------------------------------------------- the send

export interface ContractorTarget { contractorId: string; name: string | null; phone: string | null; link: string }
export type ContractorSendOutcome = { phone: string; sent: boolean; mode: 'freeform' | 'template' | 'queued' | 'skipped'; reason: string; draftId?: string | null };

export interface NotifyDeps {
    windowOpen: (phone: string) => Promise<boolean>;
    template: (names: string[], values: string[]) => Promise<{ sid: string; body: string; variables: Record<string, string>; name: string } | null>;
    send: (input: { to: string; body: string; contentSid?: string; contentVariables?: Record<string, string>; runId: string; context: string; contactName: string | null }) => Promise<{ ok: boolean; channel?: string; error?: string }>;
    queue: (input: { phone: string; body: string; reason: string }) => Promise<string | null>;
    log: (e: { kind: 'send' | 'hold'; summary: string; detail?: Record<string, unknown>; phone?: string | null; source: string }) => Promise<void>;
    now: () => Date;
}

/** One contractor, one message, the pipe decided here: window → freeform; template → template; else queued for Ben. */
export async function sendToContractor(kind: 'job_pack_ready' | 'job_pack_changed', target: ContractorTarget, body: string, templateNames: string[], variables: string[], jobRef: string, deps: NotifyDeps): Promise<ContractorSendOutcome> {
    if (!target.phone) return { phone: '', sent: false, mode: 'skipped', reason: 'no phone' };
    const runId = newRunId('sys');
    const tag = `[${kind}:${jobRef}]`;
    try {
        const open = await deps.windowOpen(target.phone).catch(() => false);
        if (open) {
            const r = await deps.send({ to: target.phone, body, runId, context: `${kind}:whatsapp`, contactName: target.name });
            if (r.ok) { await deps.log({ kind: 'send', phone: target.phone, source: 'job-pack-notify', summary: `${tag} sent freeform to ${target.name ?? target.phone}`, detail: { runId, channel: r.channel } }).catch(() => undefined); return { phone: target.phone, sent: true, mode: 'freeform', reason: 'SENT' }; }
        }
        const t = await deps.template(templateNames, variables).catch(() => null);
        if (t) {
            const r = await deps.send({ to: target.phone, body: t.body, contentSid: t.sid, contentVariables: t.variables, runId, context: `${kind}:template`, contactName: target.name });
            if (r.ok) { await deps.log({ kind: 'send', phone: target.phone, source: 'job-pack-notify', summary: `${tag} sent by template ${t.name} to ${target.name ?? target.phone}`, detail: { runId, template: t.name } }).catch(() => undefined); return { phone: target.phone, sent: true, mode: 'template', reason: 'SENT' }; }
        }
        // No window, no approved template: queue for Ben with the reason, never silent.
        const draftId = await deps.queue({ phone: target.phone, body, reason: `${tag} Contractor notice. Window shut and no approved template (submit ${templateNames[0]}, see docs/comms-build/TEMPLATES-JOB-PACK.md). Needs a human.` });
        await deps.log({ kind: 'hold', phone: target.phone, source: 'job-pack-notify', summary: `${tag} queued for Ben (${draftId ?? 'duplicate'}): no window, no template`, detail: { runId, draftId } }).catch(() => undefined);
        return { phone: target.phone, sent: false, mode: 'queued', reason: 'QUEUED_NO_CHANNEL', draftId };
    } catch (error: any) {
        return { phone: target.phone, sent: false, mode: 'skipped', reason: `error: ${error?.message ?? error}` };
    }
}

export async function liveNotifyDeps(): Promise<NotifyDeps> {
    return {
        windowOpen: async (phone) => (await import('../meta-whatsapp')).canSendFreeform(phone),
        template: async (names, values) => {
            const { findApprovedTemplateWithValues } = await import('../whatsapp-template-sync');
            const t = await findApprovedTemplateWithValues(names, values);
            return t ? { sid: t.template.sid, body: t.body, variables: t.variables, name: t.template.name } : null;
        },
        send: async (input) => {
            const { sendCustomerMessage } = await import('../outbound');
            const r = await sendCustomerMessage({ approver: JOB_PACK_APPROVER, runId: input.runId, to: input.to, body: input.body, contentSid: input.contentSid, contentVariables: input.contentVariables, context: input.context, contactName: input.contactName, purpose: 'service_reply' });
            return { ok: r.ok, channel: r.channel, error: r.error };
        },
        queue: async (input) => (await import('../message-drafts')).queueDraft({ phone: input.phone, body: input.body, source: 'rules_layer', reason: input.reason, dedupe: true, purpose: 'service_reply' }),
        log: async (e) => { const { logSystemEvent } = await import('../system-events'); await logSystemEvent(e as any); },
        now: () => new Date(),
    };
}

// ---------------------------------------------------------------- reads and the two entry points

const BASE = () => (process.env.PUBLIC_BASE_URL || 'https://handyservices.app').replace(/\/$/, '');

/** The contractors on a dispatch with their WhatsApp number (handyman_profiles.whatsapp_number first) and private link. */
export async function contractorsForDispatch(dispatchId: string, opts: { acceptedOnly?: boolean } = {}): Promise<ContractorTarget[]> {
    const { db } = await import('../db');
    const { contractorJobLinks, handymanProfiles, users } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    const links = await db.select().from(contractorJobLinks).where(eq(contractorJobLinks.dispatchId, dispatchId));
    const out: ContractorTarget[] = [];
    for (const l of links) {
        if (opts.acceptedOnly && l.status !== 'accepted') continue;
        const [p] = await db.select({ whatsappNumber: handymanProfiles.whatsappNumber, userPhone: users.phone }).from(handymanProfiles).leftJoin(users, eq(handymanProfiles.userId, users.id)).where(eq(handymanProfiles.id, l.contractorId)).limit(1);
        const phone = p?.whatsappNumber || l.contractorPhone || p?.userPhone || null;
        out.push({ contractorId: l.contractorId, name: l.contractorName, phone, link: `${BASE()}/contractor-job/${l.token}` });
    }
    return out;
}

/** When the last `job_pack_changed` for this job went to this number (sent or still queued), for the hourly batch. */
export async function lastChangedNotice(phone: string, jobRef: string): Promise<Date | null> {
    const { db } = await import('../db');
    const { messageDrafts, messages } = await import('@shared/schema');
    const { and, desc, eq, gte, sql, like } = await import('drizzle-orm');
    const digits = phone.replace(/\D/g, '');
    const since = new Date(Date.now() - CHANGED_BATCH_MS);
    const [draft] = await db.select({ at: messageDrafts.createdAt }).from(messageDrafts)
        .where(and(eq(messageDrafts.source, 'rules_layer'), like(messageDrafts.reason, `[job_pack_changed:${jobRef}]%`), sql`regexp_replace(${messageDrafts.phone}, '[^0-9]', '', 'g') = ${digits}`, gte(messageDrafts.createdAt, since)))
        .orderBy(desc(messageDrafts.createdAt)).limit(1);
    if (draft?.at) return new Date(draft.at);
    // A freeform / template send has no draft: the ledger's message_out body carries the title; the cheap proxy is any outbound to this number in the hour that names the job.
    const [sent] = await db.select({ at: messages.createdAt }).from(messages)
        .where(and(eq(messages.direction, 'outbound'), like(messages.content, 'Update on %'), gte(messages.createdAt, since), sql`exists (select 1 from conversations c where c.id = ${messages.conversationId} and regexp_replace(c.phone_number, '[^0-9]', '', 'g') = ${digits})`))
        .orderBy(desc(messages.createdAt)).limit(1);
    return sent?.at ? new Date(sent.at) : null;
}

/** Dispatch created / a contractor accepted: the pack is ready. */
export async function notifyJobPackReady(input: { dispatchId: string; title: string; postcode: string | null; scheduledDate: string | Date | null; customer?: { firstName?: string | null; fullName?: string | null }; onlyContractorId?: string | null }, deps?: NotifyDeps): Promise<ContractorSendOutcome[]> {
    const d = deps ?? await liveNotifyDeps();
    const targets = (await contractorsForDispatch(input.dispatchId)).filter((t) => !input.onlyContractorId || t.contractorId === input.onlyContractorId);
    const out: ContractorSendOutcome[] = [];
    for (const t of targets) {
        const i: ReadyInput = { title: input.title, postcode: input.postcode, date: input.scheduledDate, link: t.link };
        const body = readyBody(i);
        const bad = guardContractorBody(body, input.customer ?? {});
        if (bad.length) { out.push({ phone: t.phone ?? '', sent: false, mode: 'skipped', reason: `guard: ${bad.join(', ')}` }); continue; }
        out.push(await sendToContractor('job_pack_ready', t, body, READY_TEMPLATE_NAMES, readyVariables(i), input.dispatchId, d));
    }
    return out;
}

/** A day-relevant field changed after acceptance: tell the accepted contractor(s), at most once an hour, batched. */
export async function notifyJobPackChanged(input: { pack: JobPack; title: string; scheduledDate: string | Date | null; customer?: { firstName?: string | null; fullName?: string | null } }, deps?: NotifyDeps): Promise<ContractorSendOutcome[]> {
    if (!input.pack.dispatchId) return [];
    const d = deps ?? await liveNotifyDeps();
    const targets = await contractorsForDispatch(input.pack.dispatchId, { acceptedOnly: true });
    const out: ContractorSendOutcome[] = [];
    for (const t of targets) {
        if (!t.phone) { out.push({ phone: '', sent: false, mode: 'skipped', reason: 'no phone' }); continue; }
        const last = await lastChangedNotice(t.phone, input.pack.dispatchId).catch(() => null);
        if (!changedNoticeDue(last, d.now())) { out.push({ phone: t.phone, sent: false, mode: 'skipped', reason: 'batched: one an hour' }); continue; }
        const fields = fieldsToName(input.pack, input.pack.changeLog, last ? last.toISOString() : input.pack.lockedAt);
        if (!fields.length) { out.push({ phone: t.phone, sent: false, mode: 'skipped', reason: 'nothing day-relevant changed' }); continue; }
        const i: ChangedInput = { title: input.title, date: input.scheduledDate, fields, link: t.link };
        const body = changedBody(i);
        const bad = guardContractorBody(body, input.customer ?? {});
        if (bad.length) { out.push({ phone: t.phone, sent: false, mode: 'skipped', reason: `guard: ${bad.join(', ')}` }); continue; }
        out.push(await sendToContractor('job_pack_changed', t, body, CHANGED_TEMPLATE_NAMES, changedVariables(i), input.pack.dispatchId, d));
    }
    return out;
}

/** After any pack save: if it is dispatched and something day-relevant changed, notify (never throws). */
export async function afterPackChange(pack: JobPack): Promise<void> {
    if (!pack.dispatchId) return;
    try {
        const { db } = await import('../db');
        const { jobDispatches } = await import('@shared/schema');
        const { eq } = await import('drizzle-orm');
        const [disp] = await db.select({ title: jobDispatches.title, scheduledDate: jobDispatches.scheduledDate, customerFirstName: jobDispatches.customerFirstName, customerFullName: jobDispatches.customerFullName }).from(jobDispatches).where(eq(jobDispatches.id, pack.dispatchId)).limit(1);
        if (!disp) return;
        await notifyJobPackChanged({ pack, title: disp.title, scheduledDate: disp.scheduledDate, customer: { firstName: disp.customerFirstName, fullName: disp.customerFullName } });
    } catch (e: any) {
        console.warn('[JobPackNotify] after-change notice failed:', e?.message ?? e);
    }
}
