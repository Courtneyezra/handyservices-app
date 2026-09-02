/**
 * SHADOW REPORT — the Phase 2 exit evidence (design §10, Phase 2 row: "guard-hit parity with
 * legacy on replayed bursts"). For the last N days, pair every spine shadow run (agent_runs with
 * shadow_decision) with the legacy run on the same thread nearest in time, and compare:
 *   decision   send | pending | flag | none   (legacy derived from what its run actually wrote)
 *   intent     spine proposal intent vs the legacy draft's [intent] prefix, mapped to spine vocabulary
 *   guards     did either side hit a guard (spine guards_hit; legacy hold markers on the draft)
 * The comparison is pure (`compareShadow`) so the fixture test proves the arithmetic; the loader
 * below reads the tables. Output is a markdown table + agreement %.
 */
import { intentFromReason } from '../verdict-stats';

export type SideDecision = 'send' | 'pending' | 'flag' | 'drop' | 'none';

export interface SpineShadowRun {
    runId: string;
    conversationId: string;
    at: Date;
    lane: string | null;
    decision: SideDecision;
    intent: string | null;
    guardsHit: string[];
}

export interface LegacyRun {
    runId: string;
    conversationId: string;
    at: Date;
    /** Derived: sent draft → send; pending/approved draft → pending; flag row → flag; else none. */
    decision: SideDecision;
    intent: string | null;      // legacy vocabulary, from the draft reason's [intent]
    guardsHit: string[];        // hold markers on the draft, e.g. near_duplicate_hold
}

/** Legacy DRAFT_INTENTS → the nearest spine intent. Approximate by design; the raw pair is kept too. */
export const LEGACY_INTENT_MAP: Record<string, string> = {
    ack_photos: 'confirm_received', ack_enquiry: 'confirm_received', ack_missed_call: 'confirm_received',
    chase_response: 'ask_gap', answer_question: 'faq_from_kb', scheduling: 'point_to_picker',
    quote_followup: 'point_to_quote_page', quote_question: 'answer_from_quote', price_objection: 'answer_from_quote',
    rescope_offer: 'answer_from_quote', timing_hold: 'closing', holding: 'holding',
};

export function mapLegacyIntent(intent: string | null): string | null {
    if (!intent) return null;
    return LEGACY_INTENT_MAP[intent] ?? intent;
}

export interface PairRow {
    conversationId: string;
    spineRunId: string;
    legacyRunId: string | null;
    minutesApart: number | null;
    lane: string | null;
    spineDecision: SideDecision;
    legacyDecision: SideDecision | null;
    spineIntent: string | null;
    legacyIntent: string | null;
    legacyIntentMapped: string | null;
    spineGuards: string[];
    legacyGuards: string[];
    decisionAgree: boolean | null;
    intentAgree: boolean | null;
    guardAgree: boolean | null;
}

export interface ShadowComparison {
    days: number;
    pairs: PairRow[];
    unpairedSpine: number;
    counts: { paired: number; decisionAgree: number; intentAgree: number; guardAgree: number };
    agreement: { decision: number | null; intent: number | null; guard: number | null };
    byDecision: Record<string, Record<string, number>>;
}

export const PAIR_WINDOW_MINUTES = 15;

function pct(n: number, d: number): number | null {
    return d ? Math.round((n / d) * 1000) / 10 : null;
}

/** Pure. Pairs each spine run with the closest legacy run on the same thread within the window. */
export function compareShadow(spine: SpineShadowRun[], legacy: LegacyRun[], days: number, windowMinutes = PAIR_WINDOW_MINUTES): ShadowComparison {
    const byConv = new Map<string, LegacyRun[]>();
    for (const l of legacy) {
        const list = byConv.get(l.conversationId) ?? [];
        list.push(l);
        byConv.set(l.conversationId, list);
    }
    const used = new Set<string>();
    const pairs: PairRow[] = [];
    let unpaired = 0;
    const byDecision: Record<string, Record<string, number>> = {};
    for (const s of spine) {
        const candidates = (byConv.get(s.conversationId) ?? [])
            .filter((l) => !used.has(l.runId) && Math.abs(l.at.getTime() - s.at.getTime()) <= windowMinutes * 60_000)
            .sort((a, b) => Math.abs(a.at.getTime() - s.at.getTime()) - Math.abs(b.at.getTime() - s.at.getTime()));
        const l = candidates[0] ?? null;
        if (l) used.add(l.runId); else unpaired++;
        const legacyMapped = l ? mapLegacyIntent(l.intent) : null;
        const row: PairRow = {
            conversationId: s.conversationId, spineRunId: s.runId, legacyRunId: l?.runId ?? null,
            minutesApart: l ? Math.round(Math.abs(l.at.getTime() - s.at.getTime()) / 60_000) : null,
            lane: s.lane, spineDecision: s.decision, legacyDecision: l?.decision ?? null,
            spineIntent: s.intent, legacyIntent: l?.intent ?? null, legacyIntentMapped: legacyMapped,
            spineGuards: s.guardsHit, legacyGuards: l?.guardsHit ?? [],
            decisionAgree: l ? s.decision === l.decision : null,
            intentAgree: l ? (s.intent == null && legacyMapped == null ? true : s.intent === legacyMapped) : null,
            guardAgree: l ? (s.guardsHit.length > 0) === (l.guardsHit.length > 0) : null,
        };
        pairs.push(row);
        if (l) {
            byDecision[s.decision] = byDecision[s.decision] ?? {};
            byDecision[s.decision][l.decision] = (byDecision[s.decision][l.decision] ?? 0) + 1;
        }
    }
    const paired = pairs.filter((p) => p.legacyRunId);
    const counts = {
        paired: paired.length,
        decisionAgree: paired.filter((p) => p.decisionAgree).length,
        intentAgree: paired.filter((p) => p.intentAgree).length,
        guardAgree: paired.filter((p) => p.guardAgree).length,
    };
    return {
        days, pairs, unpairedSpine: unpaired, counts,
        agreement: { decision: pct(counts.decisionAgree, paired.length), intent: pct(counts.intentAgree, paired.length), guard: pct(counts.guardAgree, paired.length) },
        byDecision,
    };
}

export function shadowReportMarkdown(c: ShadowComparison, limit = 60): string {
    const lines: string[] = [];
    lines.push(`# Shadow report, last ${c.days} day${c.days === 1 ? '' : 's'}`, '');
    lines.push(`Spine shadow runs: ${c.pairs.length} (${c.unpairedSpine} with no legacy run within ${PAIR_WINDOW_MINUTES} min). Paired: ${c.counts.paired}.`, '');
    lines.push('| Agreement | % | n |', '|---|---:|---:|');
    lines.push(`| decision (send / pending / flag / none) | ${c.agreement.decision ?? 'n/a'} | ${c.counts.decisionAgree}/${c.counts.paired} |`);
    lines.push(`| intent (legacy mapped to spine vocabulary) | ${c.agreement.intent ?? 'n/a'} | ${c.counts.intentAgree}/${c.counts.paired} |`);
    lines.push(`| guard hit (either side hit any guard) | ${c.agreement.guard ?? 'n/a'} | ${c.counts.guardAgree}/${c.counts.paired} |`, '');
    const decisions = Object.keys(c.byDecision).sort();
    if (decisions.length) {
        const legacyKinds = Array.from(new Set(decisions.flatMap((d) => Object.keys(c.byDecision[d])))).sort();
        lines.push('## Decision matrix (rows = spine would, columns = legacy did)', '');
        lines.push(`| spine \\ legacy | ${legacyKinds.join(' | ')} |`, `|---|${legacyKinds.map(() => '---:').join('|')}|`);
        for (const d of decisions) lines.push(`| ${d} | ${legacyKinds.map((k) => c.byDecision[d][k] ?? 0).join(' | ')} |`);
        lines.push('');
    }
    lines.push('## Pairs', '', '| thread | lane | spine | legacy | Δmin | spine intent | legacy intent (mapped) | guards spine / legacy | agree |', '|---|---|---|---|---:|---|---|---|---|');
    for (const p of c.pairs.slice(0, limit)) {
        const agree = p.legacyRunId ? [p.decisionAgree ? 'D' : 'd', p.intentAgree ? 'I' : 'i', p.guardAgree ? 'G' : 'g'].join('') : 'unpaired';
        lines.push(`| ${p.conversationId.slice(0, 8)} | ${p.lane ?? ''} | ${p.spineDecision} | ${p.legacyDecision ?? '—'} | ${p.minutesApart ?? ''} | ${p.spineIntent ?? ''} | ${p.legacyIntent ?? ''}${p.legacyIntentMapped && p.legacyIntentMapped !== p.legacyIntent ? ` (${p.legacyIntentMapped})` : ''} | ${p.spineGuards.join(',') || '-'} / ${p.legacyGuards.join(',') || '-'} | ${agree} |`);
    }
    if (c.pairs.length > limit) lines.push('', `… ${c.pairs.length - limit} more pairs not shown.`);
    lines.push('', 'Agree column: uppercase = agrees (D decision, I intent, G guard).');
    return lines.join('\n');
}

// ---------------------------------------------------------------- loaders (db)

const HOLD_MARKERS = ['near_duplicate_hold', 'malformed_reason_hold', 'due_expired'];

export async function loadShadowRuns(days: number): Promise<SpineShadowRun[]> {
    const { db } = await import('../db');
    const { agentRuns } = await import('@shared/schema');
    const { and, gte, isNotNull } = await import('drizzle-orm');
    const since = new Date(Date.now() - days * 24 * 3_600_000);
    const rows = await db.select().from(agentRuns).where(and(isNotNull(agentRuns.shadowDecision), gte(agentRuns.startedAt, since))).limit(5000);
    return rows.filter((r) => r.conversationId).map((r) => {
        const p = (r.proposal ?? {}) as any;
        return {
            runId: r.id, conversationId: r.conversationId!, at: new Date(r.startedAt), lane: r.lane ?? null,
            decision: (r.shadowDecision as SideDecision) ?? 'none', intent: p?.proposal?.intent ?? null, guardsHit: r.guardsHit ?? [],
        };
    });
}

export async function loadLegacyRuns(days: number): Promise<LegacyRun[]> {
    const { db } = await import('../db');
    const { agentRuns, messageDrafts, agentQuestions } = await import('@shared/schema');
    const { and, eq, gte, inArray } = await import('drizzle-orm');
    const since = new Date(Date.now() - days * 24 * 3_600_000);
    const runs = await db.select({ id: agentRuns.id, conversationId: agentRuns.conversationId, startedAt: agentRuns.startedAt })
        .from(agentRuns).where(and(eq(agentRuns.agent, 'comms'), gte(agentRuns.startedAt, since))).limit(5000);
    if (!runs.length) return [];
    const ids = runs.map((r) => r.id);
    const drafts = await db.select({ runId: messageDrafts.runId, status: messageDrafts.status, reason: messageDrafts.reason })
        .from(messageDrafts).where(inArray(messageDrafts.runId, ids));
    const flags = await db.select({ runId: agentQuestions.runId }).from(agentQuestions).where(inArray(agentQuestions.runId, ids));
    const draftsByRun = new Map<string, typeof drafts>();
    for (const d of drafts) if (d.runId) draftsByRun.set(d.runId, [...(draftsByRun.get(d.runId) ?? []), d]);
    const flagged = new Set(flags.map((f) => f.runId).filter(Boolean) as string[]);
    return runs.filter((r) => r.conversationId).map((r) => {
        const ds = draftsByRun.get(r.id) ?? [];
        const sent = ds.find((d) => d.status === 'sent');
        const pending = ds.find((d) => d.status === 'pending' || d.status === 'approved');
        const any = sent ?? pending ?? ds[0] ?? null;
        const decision: SideDecision = sent ? 'send' : pending ? 'pending' : flagged.has(r.id) ? 'flag' : 'none';
        const guards = any?.reason ? HOLD_MARKERS.filter((m) => any.reason!.includes(m)) : [];
        return { runId: r.id, conversationId: r.conversationId!, at: new Date(r.startedAt), decision, intent: intentFromReason(any?.reason ?? null), guardsHit: guards };
    });
}
