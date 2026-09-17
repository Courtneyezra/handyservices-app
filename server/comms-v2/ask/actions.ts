/**
 * Handy Desk - the ask agent's proposals and the one place they run (ask-agent specification N1,
 * N15, N16).
 *
 * No ask tool writes. A tool that wants a change saves a proposal here (`proposeAction`): its kind,
 * its exact arguments, the exact preview Ben reads and a hash of it, and an expiry. The answer shows
 * the preview with a confirm that carries only the proposal's id. Nothing runs until the signed-in
 * person confirms it (`confirmAction`, POST /api/comms-v2/ask/actions/:id/confirm), which:
 *   - finds the proposal on one of that person's own sessions (anyone else's is not found);
 *   - refuses a session no approver slot lists, and a slot the file does not answer to;
 *   - refuses a proposal past its expiry: 15 minutes, or London midnight, whichever is first;
 *   - moves it proposed -> confirmed as a compare-and-set, so a second confirm never runs it twice
 *     and gets the first one's outcome back;
 *   - re-checks the kind's preconditions, and the preview (its text and each outgoing tile's address
 *     and channel) against its hash, so what runs is what Ben read; a change since is refused, never
 *     sent;
 *   - runs the kind's executor (action-kinds.ts) through the desk's one sender or the one function
 *     for that change, under `human:<person>` and a fresh run id;
 *   - records the outcome on the proposal, and on the case file: a send as its send record, any
 *     other change as a system turn carrying the action id (desk/case-file.ts `recordSystemTurn`).
 *
 * One open proposal per kind per case file: a second is refused while the first waits, unless the
 * first no longer matches what the file holds, when it is expired as superseded. There is no cap on
 * how many steps one ask chains (answer A5, "No limit"); the ask tools allow one new proposal per
 * run and stop at the first refusal (tools.ts), so each change is confirmed on its own.
 *
 * Money stays out: no kind here touches a price, an invoice or a payment.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { AskActionDTO, AskActionStatus, ConfirmKind, OpsOutgoing } from '@shared/ops-types';
import { approverLabel, recordSystemTurn, sameApprover, type ApproverSlot, type CaseFile } from '../desk/case-file';
import { approverFor } from '../desk/guards';
import { humanApprover } from '../../approver';
import { isProductionDatabaseUrl } from '../../worker-gate';
import type { BoardSource } from '../api/store';
import { ACTION_KINDS, type ActionKinds } from './action-kinds';

export const PROPOSAL_TTL_MS = 15 * 60_000;

/**
 * A shorter proposal window for a sandbox or branch run, in whole seconds, so a live check of the
 * expiry does not wait out 15 minutes. It can only shorten the window, and it is ignored on a
 * process whose DATABASE_URL is production.
 */
export const PROPOSAL_TTL_ENV = 'COMMS_V2_ASK_PROPOSAL_TTL_SECONDS';

/** The proposal window this process uses: 15 minutes, or the shorter non-production override. */
export function proposalTtlMs(env: NodeJS.ProcessEnv = process.env): number {
    const raw = env[PROPOSAL_TTL_ENV]?.trim();
    if (!raw || isProductionDatabaseUrl(env.DATABASE_URL)) return PROPOSAL_TTL_MS;
    if (!/^\d+$/.test(raw)) return PROPOSAL_TTL_MS;
    const ms = Number(raw) * 1000;
    return ms >= 1000 && ms < PROPOSAL_TTL_MS ? ms : PROPOSAL_TTL_MS;
}

/** The refusal when what a proposal would do is no longer what Ben was shown. */
export const PREVIEW_CHANGED = 'what this would do has changed since you saw it, so nothing was done; ask again for a fresh preview';

export interface AskAction {
    id: string;
    sessionId: string;
    /** The assistant message whose answer offered it, once that message is written. */
    messageId: string | null;
    /** The ask run that proposed it. */
    askRunId: string | null;
    kind: ConfirmKind;
    caseFileId: string | null;
    args: Record<string, unknown>;
    previewText: string;
    previewHash: string;
    /** The signed-in person the ask came from: their email or user id. */
    proposedBy: string;
    proposedAt: string;
    expiresAt: string;
    /** `human:<email or user id>` of the person who confirmed or cancelled it. */
    confirmedBy: string | null;
    confirmedAt: string | null;
    runId: string | null;
    result: Record<string, unknown> | null;
    status: AskActionStatus;
}

export type AskActionPatch = Partial<Pick<AskAction, 'status' | 'confirmedBy' | 'confirmedAt' | 'runId' | 'result' | 'askRunId' | 'messageId'>>;

export interface AskActionStore {
    insert(action: AskAction): Promise<AskAction>;
    get(id: string): Promise<AskAction | null>;
    /** Proposals of this kind on this case file still in status `proposed`, oldest first. */
    open(kind: ConfirmKind, caseFileId: string): Promise<AskAction[]>;
    forAskRun(askRunId: string): Promise<AskAction[]>;
    /** Applies the patch only while the status is one of `from`; null when it is not (someone else moved it first). */
    transition(id: string, from: AskActionStatus[], patch: AskActionPatch): Promise<AskAction | null>;
    /** Names the assistant message that offered the ask run's proposals. */
    attachMessage(askRunId: string, messageId: string): Promise<void>;
}

export function actionDTO(a: AskAction): AskActionDTO {
    return {
        id: a.id, sessionId: a.sessionId, kind: a.kind, caseFileId: a.caseFileId, previewText: a.previewText, status: a.status,
        proposedAt: a.proposedAt, expiresAt: a.expiresAt, confirmedBy: a.confirmedBy, confirmedAt: a.confirmedAt, runId: a.runId, result: a.result,
    };
}

/** JSON with object keys sorted, so one set of arguments always hashes the same. */
function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value as object).sort().filter((k) => (value as Record<string, unknown>)[k] !== undefined)
            .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}

/** The hash of what Ben is shown: the kind, its arguments, the preview text and where each outgoing tile goes, in order. */
export function previewHash(kind: ConfirmKind, args: Record<string, unknown>, preview: { text: string; outgoing?: OpsOutgoing[] }): string {
    const destinations = (preview.outgoing ?? []).map((o) => ({ to: o.to, channel: o.channel }));
    return createHash('sha256').update(stableJson({ kind, args, previewText: preview.text, destinations })).digest('hex');
}

const londonDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/** The first instant of the next London day. */
export function nextLondonMidnight(at: Date): Date {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(at);
    const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const sinceMidnight = ((n('hour') * 60 + n('minute')) * 60 + n('second')) * 1000 + at.getUTCMilliseconds();
    let next = new Date(at.getTime() - sinceMidnight + 24 * 3_600_000);
    // A clock change makes the day 23 or 25 hours long: step by the hour onto the day's first instant.
    const today = londonDay(at);
    while (londonDay(next) === today) next = new Date(next.getTime() + 3_600_000);
    while (londonDay(new Date(next.getTime() - 3_600_000)) !== today) next = new Date(next.getTime() - 3_600_000);
    return next;
}

/** When a proposal made now stops being confirmable: the window on (15 minutes, `proposalTtlMs`), or London midnight if sooner. */
export function expiryFor(at: Date, ttlMs: number = proposalTtlMs()): Date {
    const ttl = new Date(at.getTime() + ttlMs);
    const midnight = nextLondonMidnight(at);
    return ttl < midnight ? ttl : midnight;
}

/** The slot a change on this file answers to: its hold's approver when one stands, `approverFor`'s otherwise. */
export function fileOwner(file: CaseFile): ApproverSlot {
    return file.hold?.approver ?? approverFor(file, null);
}

export interface ActionDeps {
    store: AskActionStore;
    source: () => Promise<BoardSource>;
    kinds?: ActionKinds;
    now?: () => Date;
    newId?: () => string;
}

export interface ProposeInput {
    kind: ConfirmKind;
    args: unknown;
    sessionId: string;
    askRunId: string | null;
    /** The signed-in person: their email or user id. */
    person: string;
    /** Their approver slot; a session with none proposes nothing. */
    approver: ApproverSlot | null;
}

export type ProposeOutcome =
    | { ok: true; action: AskAction; label: string; outgoing: OpsOutgoing[]; reused: boolean }
    | { ok: false; reason: string };

function notYet(kind: ConfirmKind): string {
    return kind === 'booking.create'
        ? 'creating a booking is not on the Handy Desk until design-map Q8 is answered'
        : `the Handy Desk cannot propose ${kind} yet`;
}

/** Saves a proposal, after the same checks the confirm will make. Runs nothing. */
export async function proposeAction(input: ProposeInput, deps: ActionDeps): Promise<ProposeOutcome> {
    const kinds = deps.kinds ?? ACTION_KINDS;
    const now = (deps.now ?? (() => new Date()))();
    const refuse = (reason: string): ProposeOutcome => ({ ok: false, reason });
    const def = kinds[input.kind];
    if (!def) return refuse(notYet(input.kind));
    if (!input.approver) return refuse('no approver slot is assigned to this user, so nothing can be proposed from this session');
    const args = def.parseArgs(input.args);
    if (!args) return refuse(`the arguments do not fit a ${input.kind}`);

    const src = await deps.source();
    const caseFileId = def.caseFileOf(args);
    const file = caseFileId ? src.store.get(caseFileId) : null;
    if (caseFileId && !file) return refuse('no such case file');
    if (file && !sameApprover(fileOwner(file), input.approver)) return refuse(`only ${approverLabel(fileOwner(file))} may act on this file`);
    const ctx = { src, file, now, approver: input.approver, person: input.person };
    const blocked = await def.preconditions(ctx, args);
    if (blocked) return refuse(blocked);
    const preview = await def.preview(ctx, args);
    if (!preview.ok) return refuse(preview.reason);
    const hash = previewHash(input.kind, args, preview);

    if (caseFileId) {
        for (const open of await deps.store.open(input.kind, caseFileId)) {
            if (Date.parse(open.expiresAt) <= now.getTime()) {
                await deps.store.transition(open.id, ['proposed'], { status: 'expired', result: { reason: 'expired before it was confirmed' } });
                continue;
            }
            const openArgs = def.parseArgs(open.args);
            const current = openArgs ? await def.preview(ctx, openArgs) : null;
            if (!openArgs || !current?.ok || previewHash(open.kind, openArgs, current) !== open.previewHash) {
                await deps.store.transition(open.id, ['proposed'], { status: 'expired', result: { reason: 'superseded: what it would do changed before it was confirmed' } });
                continue;
            }
            if (open.previewHash === hash && open.sessionId === input.sessionId) {
                // The newest answer offering it is the one whose plan strip moves on its confirm.
                const reused = input.askRunId && input.askRunId !== open.askRunId
                    ? await deps.store.transition(open.id, ['proposed'], { askRunId: input.askRunId, messageId: null })
                    : open;
                if (!reused) return refuse(`a ${input.kind} on this file was settled while this one was being proposed (action ${open.id}); ask again`);
                return { ok: true, action: reused, label: def.label, outgoing: withAction(preview.outgoing, reused.id), reused: true };
            }
            return refuse(`a ${input.kind} on this file is already waiting for a confirm or a cancel (action ${open.id}); settle that one first`);
        }
    }

    const action = await deps.store.insert({
        id: (deps.newId ?? (() => `act_${randomUUID()}`))(),
        sessionId: input.sessionId,
        messageId: null,
        askRunId: input.askRunId,
        kind: input.kind,
        caseFileId,
        args: args as Record<string, unknown>,
        previewText: preview.text,
        previewHash: hash,
        proposedBy: input.person,
        proposedAt: now.toISOString(),
        expiresAt: expiryFor(now).toISOString(),
        confirmedBy: null,
        confirmedAt: null,
        runId: null,
        result: null,
        status: 'proposed',
    });
    return { ok: true, action, label: def.label, outgoing: withAction(preview.outgoing, action.id), reused: false };
}

function withAction(outgoing: OpsOutgoing[] | undefined, actionId: string): OpsOutgoing[] {
    return (outgoing ?? []).map((o) => ({ ...o, actionId }));
}

export interface SettleInput {
    id: string;
    /** The signed-in person: their email or user id. */
    person: string;
    /** Their approver slot, from the session (api/approvers.ts `slotOf`), never the body. */
    approver: ApproverSlot | null;
    /** Whether the session the proposal was made on belongs to this person. */
    ownsSession: (sessionId: string) => Promise<boolean>;
}

export type SettleCode = 'not_found' | 'no_slot' | 'wrong_slot' | 'expired' | 'closed' | 'in_progress' | 'refused';

export type SettleOutcome =
    | { ok: true; action: AskAction; repeat: boolean }
    | { ok: false; code: SettleCode; reason: string; action: AskAction | null };

function closedReason(a: AskAction): string {
    const why = typeof a.result?.reason === 'string' ? `: ${a.result.reason}` : '';
    return `this proposal was ${a.status}${why}`;
}

/** What a proposal that someone else already moved says now. */
function settled(a: AskAction): SettleOutcome {
    if (a.status === 'executed') return { ok: true, action: a, repeat: true };
    if (a.status === 'confirmed') return { ok: false, code: 'in_progress', reason: 'this proposal is already being carried out', action: a };
    if (a.status === 'expired') return { ok: false, code: 'expired', reason: closedReason(a), action: a };
    return { ok: false, code: a.status === 'refused' ? 'refused' : 'closed', reason: closedReason(a), action: a };
}

/** Ben's confirm: runs the proposal once, as the signed-in person, or says why not. */
export async function confirmAction(input: SettleInput, deps: ActionDeps): Promise<SettleOutcome> {
    const kinds = deps.kinds ?? ACTION_KINDS;
    const clock = deps.now ?? (() => new Date());
    const found = await deps.store.get(input.id);
    if (!found || !(await input.ownsSession(found.sessionId))) return { ok: false, code: 'not_found', reason: 'no such proposal', action: null };
    if (found.status !== 'proposed') return settled(found);
    if (!input.approver) return { ok: false, code: 'no_slot', reason: 'no approver slot is assigned to this user', action: found };

    const now = clock();
    if (Date.parse(found.expiresAt) <= now.getTime()) {
        const reason = `it expired at ${found.expiresAt}; ask again for a fresh one`;
        const moved = await deps.store.transition(found.id, ['proposed'], { status: 'expired', result: { reason } });
        return moved ? { ok: false, code: 'expired', reason: closedReason(moved), action: moved } : settled((await deps.store.get(found.id))!);
    }

    const refuseProposed = async (reason: string): Promise<SettleOutcome> => {
        const moved = await deps.store.transition(found.id, ['proposed'], { status: 'refused', result: { reason } });
        return moved ? { ok: false, code: 'refused', reason, action: moved } : settled((await deps.store.get(found.id))!);
    };
    const def = kinds[found.kind];
    if (!def) return refuseProposed(notYet(found.kind));
    const args = def.parseArgs(found.args);
    if (!args) return refuseProposed(`the arguments do not fit a ${found.kind}`);
    const src = await deps.source();
    const file = found.caseFileId ? src.store.get(found.caseFileId) : null;
    if (found.caseFileId && !file) return refuseProposed('the case file is no longer on the desk');
    if (file && !sameApprover(fileOwner(file), input.approver)) {
        // Not this person's to run; the proposal stays for the slot the file answers to.
        return { ok: false, code: 'wrong_slot', reason: `only ${approverLabel(fileOwner(file))} may act on this file`, action: found };
    }

    const person = humanApprover(input.person);
    const runId = `run_${randomUUID()}`;
    const confirmed = await deps.store.transition(found.id, ['proposed'], { status: 'confirmed', confirmedBy: person, confirmedAt: now.toISOString(), runId });
    if (!confirmed) return settled((await deps.store.get(found.id))!);

    const finish = async (status: 'executed' | 'refused', result: Record<string, unknown>): Promise<AskAction> => {
        const moved = await deps.store.transition(found.id, ['confirmed'], { status, result });
        return moved ?? { ...confirmed, status, result };
    };
    const refuseConfirmed = async (reason: string): Promise<SettleOutcome> => ({ ok: false, code: 'refused', reason, action: await finish('refused', { reason }) });

    try {
        const ctx = { src, file, now, approver: input.approver, person: input.person };
        const blocked = await def.preconditions(ctx, args);
        if (blocked) return refuseConfirmed(blocked);
        const preview = await def.preview(ctx, args);
        if (!preview.ok) return refuseConfirmed(preview.reason);
        if (previewHash(found.kind, args, preview) !== found.previewHash) return refuseConfirmed(PREVIEW_CHANGED);

        // The executor checks the preview once more where it reads the file, in the same tick as the change.
        const done = await def.execute({ ...ctx, runId, approverName: person, expectedPreview: found.previewText, mode: src.mode }, args);
        if (!done.ok) return refuseConfirmed(done.reason);
        const result: Record<string, unknown> = { ...done.result };
        if (file && !def.sends && done.audit) {
            const turn = recordSystemTurn(file, { body: `${done.audit} by ${person} (ask action ${found.id})`, approver: person, actionId: found.id, runId }, { now: () => now });
            if (turn.ok) result.audit = turn.value.body;
            else console.error(`[AskActions] ${found.id} ran but its system turn was refused: ${turn.reason}`);
        }
        if (file) src.store.put(file);
        return { ok: true, action: await finish('executed', result), repeat: false };
    } catch (error: any) {
        console.error(`[AskActions] ${found.id} (${found.kind}) failed while running:`, error);
        return refuseConfirmed(`it failed while running: ${String(error?.message ?? error).slice(0, 300)}`);
    }
}

/** Ben's cancel: the proposal will never run. A second cancel changes nothing. */
export async function cancelAction(input: SettleInput, deps: ActionDeps): Promise<SettleOutcome> {
    const found = await deps.store.get(input.id);
    if (!found || !(await input.ownsSession(found.sessionId))) return { ok: false, code: 'not_found', reason: 'no such proposal', action: null };
    if (found.status === 'cancelled') return { ok: true, action: found, repeat: true };
    if (found.status !== 'proposed') return settled(found);
    const by = humanApprover(input.person);
    const moved = await deps.store.transition(found.id, ['proposed'], { status: 'cancelled', confirmedBy: by, confirmedAt: (deps.now ?? (() => new Date()))().toISOString(), result: { reason: `cancelled by ${by}` } });
    if (moved) return { ok: true, action: moved, repeat: false };
    const now = (await deps.store.get(found.id))!;
    return now.status === 'cancelled' ? { ok: true, action: now, repeat: true } : settled(now);
}

// ---------------------------------------------------------------- stores

export class MemoryAskActionStore implements AskActionStore {
    readonly rows = new Map<string, AskAction>();
    async insert(a: AskAction) { this.rows.set(a.id, { ...a }); return { ...a }; }
    async get(id: string) { const a = this.rows.get(id); return a ? { ...a } : null; }
    async open(kind: ConfirmKind, caseFileId: string) {
        return Array.from(this.rows.values()).filter((a) => a.kind === kind && a.caseFileId === caseFileId && a.status === 'proposed').map((a) => ({ ...a }));
    }
    async forAskRun(askRunId: string) {
        return Array.from(this.rows.values()).filter((a) => a.askRunId === askRunId).map((a) => ({ ...a }));
    }
    async transition(id: string, from: AskActionStatus[], patch: AskActionPatch) {
        const a = this.rows.get(id);
        if (!a || !from.includes(a.status)) return null;
        Object.assign(a, patch);
        return { ...a };
    }
    async attachMessage(askRunId: string, messageId: string) {
        for (const a of Array.from(this.rows.values())) if (a.askRunId === askRunId) a.messageId = messageId;
    }
}

async function table() {
    const { db } = await import('../../db');
    const schema = await import('@shared/schema');
    const orm = await import('drizzle-orm');
    return { db, t: schema.commsV2AskActions, ...orm };
}

type Row = typeof import('@shared/schema').commsV2AskActions.$inferSelect;

function fromRow(r: Row): AskAction {
    return {
        id: r.id, sessionId: r.sessionId, messageId: r.messageId, askRunId: r.askRunId, kind: r.kind as ConfirmKind, caseFileId: r.caseFileId,
        args: (r.args as Record<string, unknown>) ?? {}, previewText: r.previewText, previewHash: r.previewHash, proposedBy: r.proposedBy,
        proposedAt: r.proposedAt.toISOString(), expiresAt: r.expiresAt.toISOString(), confirmedBy: r.confirmedBy,
        confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null, runId: r.runId, result: (r.result as Record<string, unknown> | null) ?? null,
        status: r.status as AskActionStatus,
    };
}

/** comms_v2_ask_actions (migrations/20260918_comms_v2_ask_actions.sql), on the app's database beside the ask sessions. */
export const databaseAskActionStore: AskActionStore = {
    async insert(a) {
        const { db, t } = await table();
        const [row] = await db.insert(t).values({
            id: a.id, sessionId: a.sessionId, messageId: a.messageId, askRunId: a.askRunId, kind: a.kind, caseFileId: a.caseFileId,
            args: a.args, previewText: a.previewText, previewHash: a.previewHash, proposedBy: a.proposedBy,
            proposedAt: new Date(a.proposedAt), expiresAt: new Date(a.expiresAt), status: a.status,
        }).returning();
        return fromRow(row);
    },
    async get(id) {
        const { db, t, eq } = await table();
        const [row] = await db.select().from(t).where(eq(t.id, id));
        return row ? fromRow(row) : null;
    },
    async open(kind, caseFileId) {
        const { db, t, and, eq, asc } = await table();
        const rows = await db.select().from(t).where(and(eq(t.kind, kind), eq(t.caseFileId, caseFileId), eq(t.status, 'proposed'))).orderBy(asc(t.proposedAt));
        return rows.map(fromRow);
    },
    async forAskRun(askRunId) {
        const { db, t, eq, asc } = await table();
        const rows = await db.select().from(t).where(eq(t.askRunId, askRunId)).orderBy(asc(t.proposedAt));
        return rows.map(fromRow);
    },
    async transition(id, from, patch) {
        const { db, t, and, eq, inArray } = await table();
        const set: Record<string, unknown> = { updatedAt: new Date() };
        if (patch.status !== undefined) set.status = patch.status;
        if (patch.confirmedBy !== undefined) set.confirmedBy = patch.confirmedBy;
        if (patch.confirmedAt !== undefined) set.confirmedAt = patch.confirmedAt ? new Date(patch.confirmedAt) : null;
        if (patch.runId !== undefined) set.runId = patch.runId;
        if (patch.result !== undefined) set.result = patch.result;
        if (patch.askRunId !== undefined) set.askRunId = patch.askRunId;
        if (patch.messageId !== undefined) set.messageId = patch.messageId;
        const [row] = await db.update(t).set(set).where(and(eq(t.id, id), inArray(t.status, from))).returning();
        return row ? fromRow(row) : null;
    },
    async attachMessage(askRunId, messageId) {
        const { db, t, eq } = await table();
        await db.update(t).set({ messageId, updatedAt: new Date() }).where(eq(t.askRunId, askRunId));
    },
};
