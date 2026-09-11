/**
 * Return to automation (checklist 7.4): a thread comes back to automation when any human replies,
 * from any surface. The event is on the case file: the human's reply lands on the thread as an
 * outbound turn carrying a human approver and a run id, the send is recorded, the hold is released
 * with the human's words as the approver's words (Contract 2: release only with words, only by the
 * named approver), and a fact records the surface it came from. The next customer turn is then
 * routed as any other. The kanban (Goal 2), the sandbox door ("Ben replies") and, later, a handset
 * or email surface all call this one function.
 */
import { randomUUID } from 'node:crypto';
import { appendTurn, recordFact, recordSend, release, type ApproverSlot, type CaseFile, type CaseFileDeps, type HoldRelease, type Turn } from '../desk/case-file';
import { BEN } from '../desk/guards';
import type { Approver } from '../../approver';

export type HumanSurface = 'kanban' | 'admin' | 'handset' | 'email' | 'sandbox';

export interface HumanReply {
    /** Who replied: `ben`, or another staff id. */
    by: string;
    surface: HumanSurface;
    text: string;
    /** The party the reply went to; the file's first party when omitted. */
    partyId?: string | null;
    at?: string;
}

export type HumanReplyOutcome =
    | { ok: true; turn: Turn; approver: Approver; released: HoldRelease | null; stillHeldBy: string | null }
    | { ok: false; reason: string };

/**
 * Lands a human's reply on the file and brings the thread back to automation. Refuses empty
 * words and a party not on the file. A hold for a different approver (a landlord's rules, later)
 * is not released by Ben's reply: the turn lands, the hold stands, and the outcome says so.
 */
export function humanReply(file: CaseFile, input: HumanReply, deps: CaseFileDeps = {}): HumanReplyOutcome {
    const now = deps.now ?? (() => new Date());
    const text = input.text.trim();
    if (!text) return { ok: false, reason: 'a human reply needs words' };
    const by = input.by.trim().toLowerCase();
    if (!by) return { ok: false, reason: 'a human reply names who replied' };
    const party = input.partyId ? file.parties.find((p) => p.personId === input.partyId) : file.parties[0];
    if (!party) return { ok: false, reason: 'the party is not on the file' };
    const approver: Approver = `human:${by}`;
    const runId = `human_${randomUUID()}`;
    const last = file.turns[file.turns.length - 1];
    const at = input.at ?? new Date(Math.max(now().getTime(), last ? Date.parse(last.at) + 1 : 0)).toISOString();
    const turn = appendTurn(file, { at, channel: 'whatsapp', direction: 'outbound', partyId: party.personId, kind: 'text', body: text, media: [], runId, approver }, deps);
    if (!turn.ok) return { ok: false, reason: turn.reason };
    recordSend(file, { runId, approver, partyId: party.personId, channel: 'whatsapp', windowState: 'open', templateId: null, bubbles: [{ text, gapMs: 0 }], factIds: [], kbIds: [], calls: [], at, mode: 'dry_run', partial: false, turnId: turn.value.id });
    recordFact(file, { key: 'human_reply', value: `${by} replied from ${input.surface}`, source: { kind: 'thread', turnId: turn.value.id }, by: `human:${by}` }, deps);
    let released: HoldRelease | null = null;
    let stillHeldBy: string | null = null;
    if (file.hold) {
        const slot: ApproverSlot = by === BEN.id ? BEN : { kind: 'human', id: by };
        const rel = release(file, slot, text, deps);
        if (rel.ok) released = rel.value;
        else stillHeldBy = file.hold.approver.kind === 'human' ? file.hold.approver.id : `rules:${file.hold.approver.id}`;
    }
    return { ok: true, turn: turn.value, approver, released, stillHeldBy };
}

/** Where the thread is, for a board or the door's state. */
export function automationState(file: CaseFile): { state: 'automated' | 'with_approver'; approver: string | null; reason: string | null; since: string | null; releases: number } {
    if (!file.hold) return { state: 'automated', approver: null, reason: null, since: null, releases: file.releases.length };
    return { state: 'with_approver', approver: file.hold.approver.kind === 'human' ? file.hold.approver.id : `rules:${file.hold.approver.id}`, reason: file.hold.reason, since: file.hold.since, releases: file.releases.length };
}
