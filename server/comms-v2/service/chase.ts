/**
 * Ben's chase (checklist 7.5): a held thread Ben has not acted on is chased after one interval,
 * and escalated to the owner after a second. Both are desk-started template sends through the
 * sender's initiate path (desk/sender.ts): template only, approver and run id on each, nothing
 * freeform. The recipients are approvers, not parties, so the record lives here in the chase
 * ledger and not on the file's thread; the run id is still spent on the file.
 *
 * The intervals and the recipients are configuration: the sandbox door sets test values
 * (service-door.ts, POST /chase-intervals) and drama numbers for Ben and the owner, and the
 * production values land at cutover with the caller that reads them. A missing address is a
 * refusal that is recorded, never a silent skip.
 *
 * The chase runs on the desk's clock pass (desk.ts clockPass), the one pass that never messages a
 * customer. Ben's reply (return-to-automation.ts) clears the ledger for the file.
 */
import { randomUUID } from 'node:crypto';
import type { CaseFile } from '../desk/case-file';
import { DESK_APPROVER, initiate, liveTemplateStatus, type InitiatedSend, type InitiatePurpose, type SenderDeps, type TemplateDefinition, type TemplateStatusSource } from '../desk/sender';

export interface ChaseRecipient { address: string | null; name: string | null }

export interface ChaseConfig {
    /** How long a hold may stand before Ben is chased. */
    chaseAfterMs: number;
    /** How long after the chase before the owner is told. */
    escalateAfterMs: number;
    ben: ChaseRecipient;
    owner: ChaseRecipient;
}

export const DEFAULT_CHASE_AFTER_MS = 30 * 60_000;
export const DEFAULT_ESCALATE_AFTER_MS = 60 * 60_000;

/**
 * The desk's own templates for a desk-started send. Defined here (they go to an approver, never a
 * customer, so they are not customer window templates in server/window-templates.ts); approval
 * still comes only from the live sync by name, and the sandbox fixture marks them approved on the
 * branch database only. Bodies carry no date, time, duration, figure or commitment.
 */
export const CHASE_TEMPLATES: Record<InitiatePurpose, TemplateDefinition> = {
    approver_chase: { name: 'desk_approver_chase_v1', language: 'en_GB', body: 'Hi {{1}}, a customer thread is waiting on you: {{2}}. Open the desk to pick it up.', variables: { '1': 'Ben', '2': 'a complaint from Sam' } },
    owner_escalation: { name: 'desk_owner_escalation_v1', language: 'en_GB', body: 'Hi {{1}}, a customer thread has been waiting on Ben and he has not picked it up: {{2}}. It needs a look.', variables: { '1': 'there', '2': 'a complaint from Sam' } },
};

export interface ChaseRecord {
    caseId: string;
    /** How many releases the file had when this hold was raised: a later hold has more, and starts a fresh record. Timestamps are not the key because the sandbox ages them. */
    releasesBefore: number;
    chased: InitiatedSend | null;
    escalated: InitiatedSend | null;
    /** Every attempt, refused ones included, so a chase that could not go is on the record. */
    attempts: Array<{ purpose: InitiatePurpose; at: string; ok: boolean; reason: string | null; runId: string }>;
}

/** Per file, for the length of the process, like the case files themselves in Goal 1. */
export class ChaseLedger {
    private records = new Map<string, ChaseRecord>();
    get(caseId: string): ChaseRecord | null { return this.records.get(caseId) ?? null; }
    put(r: ChaseRecord): void { this.records.set(r.caseId, r); }
    clear(caseId?: string): void { if (caseId) this.records.delete(caseId); else this.records.clear(); }
    all(): ChaseRecord[] { return Array.from(this.records.values()); }
}

export interface ChaseState { config: ChaseConfig; ledger: ChaseLedger }

export function createChaseState(config: Partial<ChaseConfig> = {}): ChaseState {
    return { config: { chaseAfterMs: DEFAULT_CHASE_AFTER_MS, escalateAfterMs: DEFAULT_ESCALATE_AFTER_MS, ben: { address: null, name: 'Ben' }, owner: { address: null, name: null }, ...config }, ledger: new ChaseLedger() };
}

export type ChaseOutcome =
    | { action: 'none'; reason: string; record: ChaseRecord | null }
    | { action: 'chased' | 'escalated'; send: InitiatedSend; record: ChaseRecord }
    | { action: 'refused'; purpose: InitiatePurpose; reason: string; record: ChaseRecord };

export interface ChaseDeps {
    templates?: TemplateStatusSource;
    sender?: SenderDeps;
    mode?: 'dry_run' | 'live';
    now?: () => Date;
}

function topicOf(file: CaseFile): string {
    const name = file.parties[0]?.name ?? 'a customer';
    const why = file.hold?.exception ? file.hold.exception.replace(/_/g, ' ') : (file.hold?.reason ?? 'held');
    return `${why} from ${name}${file.job.type ? ` (${file.job.type})` : ''}`.slice(0, 120);
}

/**
 * One clock pass over one file: nothing when the file is not held; the chase to Ben once the
 * hold is older than the first interval; the escalation to the owner once it is older than both.
 * One action per pass. A hold that was released and raised again starts a fresh record; the
 * sandbox ageing the file's timestamps does not.
 */
export async function chaseIfDue(file: CaseFile, state: ChaseState, deps: ChaseDeps = {}): Promise<ChaseOutcome> {
    const now = deps.now ?? (() => new Date());
    if (!file.hold) { state.ledger.clear(file.id); return { action: 'none', reason: 'the file is not held', record: null }; }
    let record = state.ledger.get(file.id);
    if (!record || record.releasesBefore !== file.releases.length) { record = { caseId: file.id, releasesBefore: file.releases.length, chased: null, escalated: null, attempts: [] }; state.ledger.put(record); }
    const age = now().getTime() - Date.parse(file.hold.since);
    const cfg = state.config;
    const attempt = async (purpose: InitiatePurpose, to: { address: string | null; name: string | null }): Promise<ChaseOutcome> => {
        const runId = `chase_${randomUUID()}`;
        const template = CHASE_TEMPLATES[purpose];
        const out = await initiate({ file, to: { address: to.address ?? '', name: to.name }, purpose, template: { ...template, variables: { '1': to.name ?? 'there', '2': topicOf(file) } }, runId, approver: DESK_APPROVER, mode: deps.mode ?? 'dry_run' }, { ...deps.sender, now, templates: deps.templates ?? liveTemplateStatus });
        record!.attempts.push({ purpose, at: now().toISOString(), ok: out.ok, reason: out.ok ? null : out.reason, runId });
        if (!out.ok) return { action: 'refused', purpose, reason: out.reason, record: record! };
        if (purpose === 'approver_chase') record!.chased = out.send; else record!.escalated = out.send;
        return { action: purpose === 'approver_chase' ? 'chased' : 'escalated', send: out.send, record: record! };
    };
    if (!record.chased) {
        if (age < cfg.chaseAfterMs) return { action: 'none', reason: `held for ${Math.round(age / 60_000)} min; Ben is chased after ${Math.round(cfg.chaseAfterMs / 60_000)} min`, record };
        return attempt('approver_chase', cfg.ben);
    }
    if (!record.escalated) {
        if (age < cfg.chaseAfterMs + cfg.escalateAfterMs) return { action: 'none', reason: `Ben chased; the owner is told after a further ${Math.round(cfg.escalateAfterMs / 60_000)} min`, record };
        return attempt('owner_escalation', cfg.owner);
    }
    return { action: 'none', reason: 'Ben chased and the owner told; nothing further until Ben replies', record };
}
