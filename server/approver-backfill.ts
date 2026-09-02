/**
 * APPROVER BACKFILL — the pure mapping (Phase 5 prep, design §10 Phase 5 row: "AUTOMATED_APPROVER regex").
 *
 * Before Phase 0 (2 Sep 2026) `message_drafts.approved_by` was a free string: `comms_agent:autosend`,
 * `hours_gate:morning_release`, `first_contact_ack:whatsapp`, `v2_pipeline:autosend`, a bare email.
 * Phase 0 made the approver an enum (server/approver.ts) and kept the legacy prefixes readable so
 * history still classified as automated. This module maps every historical value to its enum
 * value so the legacy prefixes in `isAutomatedApprover` can be deleted once the rows are rewritten.
 * scripts/_approver-backfill.ts runs it (dry run by default).
 *
 * Rules, in order:
 *   1. Already an enum value or `human:<id>`      → unchanged
 *   2. Known legacy prefix (+ known suffix)         → enum value (table below); a `v2_pipeline:*` value
 *                                                    becomes agent.comms.autosend WITH a note (it was the
 *                                                    deleted V2 path, not the comms agent, but it sent
 *                                                    under the same allowance)
 *   3. A rejection marker (`*:superseded`, `*:stale_by_morning`, `ack_hold:*`) → the rule that decided
 *   4. A bare email or 'admin'                       → human:<value>
 *   5. Anything else                                 → left alone, counted as `unmapped`
 */
import { isApprover, humanApprover, type Approver } from './approver';

export interface ApproverMapping {
    from: string;
    to: Approver | null;
    rule: 'unchanged' | 'legacy_prefix' | 'v2_pipeline' | 'rejection_marker' | 'bare_human' | 'unmapped';
    note?: string;
}

const EXACT: Record<string, Approver> = {
    'comms_agent:autosend': 'agent.comms.autosend',
    'comms_agent:sla_chase': 'agent.sla_chase',
    'comms_agent:first_contact': 'agent.comms',
    'comms_agent:superseded': 'agent.comms',
    'comms_agent:superseded_by_clerk_gaps': 'agent.comms',
    'hours_gate:morning_release': 'rules.hours_gate',
    'hours_gate:stale_by_morning': 'rules.hours_gate',
    'ack_hold:superseded': 'rules.first_contact',
};

const PREFIX: Array<{ prefix: string; to: Approver; rule: ApproverMapping['rule']; note?: string }> = [
    { prefix: 'first_contact_ack:', to: 'rules.first_contact', rule: 'legacy_prefix' },
    { prefix: 'hours_gate:', to: 'rules.hours_gate', rule: 'legacy_prefix' },
    { prefix: 'comms_agent:', to: 'agent.comms', rule: 'legacy_prefix' },
    { prefix: 'ack_hold:', to: 'rules.first_contact', rule: 'rejection_marker' },
    { prefix: 'v2_pipeline:', to: 'agent.comms.autosend', rule: 'v2_pipeline', note: 'V2 pipeline send (deleted Phase 0); mapped to the comms autosend allowance it ran under' },
];

const EMAIL_RE = /^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/;

export function mapApprover(raw: string | null | undefined): ApproverMapping {
    const from = (raw ?? '').trim();
    if (!from) return { from, to: null, rule: 'unmapped', note: 'empty' };
    if (isApprover(from)) return { from, to: from, rule: 'unchanged' };
    if (EXACT[from]) {
        const rule: ApproverMapping['rule'] = from.endsWith(':superseded') || from.endsWith(':stale_by_morning') || from.endsWith('_by_clerk_gaps') || from.startsWith('ack_hold:') ? 'rejection_marker' : 'legacy_prefix';
        return { from, to: EXACT[from], rule };
    }
    for (const p of PREFIX) {
        if (from.startsWith(p.prefix)) return { from, to: p.to, rule: p.rule, ...(p.note ? { note: p.note } : {}) };
    }
    if (EMAIL_RE.test(from) || from === 'admin') return { from, to: humanApprover(from), rule: 'bare_human' };
    return { from, to: null, rule: 'unmapped' };
}

export interface BackfillPlan {
    /** distinct legacy value → mapping + how many rows carry it */
    rows: Array<ApproverMapping & { count: number }>;
    totals: Record<ApproverMapping['rule'], number>;
    /** rows that will actually change (to != null && to != from) */
    toUpdate: number;
}

/** Pure: fold the (value, count) pairs from the database into a plan. */
export function planBackfill(distinct: Array<{ approvedBy: string | null; count: number }>): BackfillPlan {
    const rows = distinct.map((d) => ({ ...mapApprover(d.approvedBy), count: d.count }));
    const totals: BackfillPlan['totals'] = { unchanged: 0, legacy_prefix: 0, v2_pipeline: 0, rejection_marker: 0, bare_human: 0, unmapped: 0 };
    let toUpdate = 0;
    for (const r of rows) {
        totals[r.rule] += r.count;
        if (r.to && r.to !== r.from) toUpdate += r.count;
    }
    rows.sort((a, b) => b.count - a.count);
    return { rows, totals, toUpdate };
}

export function renderPlan(plan: BackfillPlan): string {
    const lines = ['| approved_by (legacy) | → | rule | rows |', '|---|---|---|---:|'];
    for (const r of plan.rows) lines.push(`| \`${r.from || '(empty)'}\` | ${r.to ?? '—'} | ${r.rule}${r.note ? ` (${r.note})` : ''} | ${r.count} |`);
    lines.push('', `Totals: ${Object.entries(plan.totals).map(([k, v]) => `${k}=${v}`).join(', ')}. Rows to update: ${plan.toUpdate}.`);
    return lines.join('\n');
}
