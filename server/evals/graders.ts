/**
 * Deterministic graders (Phase 2 / C). Pure: a case's `expected` against what an adapter observed.
 * Outcomes over paths — the reply text, the lane, the flag, the guards — never the tool sequence.
 */
import type { EvalExpected } from './case-schema';

export interface GraderResult { grader: string; pass: boolean; note?: string }

/** What an adapter observed for one trial. Every field optional so a thin adapter still grades. */
export interface ObservedRun {
    body: string | null;
    intent?: string | null;
    lane?: string | null;
    /** The producer raised a flag for Ben (flag_for_ben, needs_ben, agent_questions). */
    flagged?: boolean;
    /** Detector codes that fired on the body. */
    guardHits?: string[];
    /** Subset of guardHits in the Ben-only families. */
    escalatingGuards?: string[];
    /** Lexicon exceptions raised by the customer's own last message. */
    customerExceptions?: string[];
    holds?: { nearDuplicate?: boolean; malformedReason?: boolean };
    voiceViolations?: string[];
    /** P8: the PROPOSE-tier artifact a run produced (the clerk's intake), for the intake family. */
    artifact?: { kind: string; readiness?: string | null; lineTitles?: string[] } | null;
}

const norm = (s: string) => s.toLowerCase();

export function gradeObserved(expected: EvalExpected, o: ObservedRun): GraderResult[] {
    const out: GraderResult[] = [];
    const body = o.body ?? '';
    const escalating = o.escalatingGuards ?? [];
    const exceptions = o.customerExceptions ?? [];
    const benInLoop = !!o.flagged || escalating.length > 0 || exceptions.length > 0;

    if (expected.lane) {
        out.push({ grader: 'lane', pass: o.lane === expected.lane, note: `got ${o.lane ?? 'none'}, want ${expected.lane}` });
    }
    if (expected.intent != null) {
        const allowed = (Array.isArray(expected.intent) ? expected.intent : [expected.intent]).map(String);
        out.push({ grader: 'intent', pass: !!o.intent && allowed.includes(o.intent), note: `got ${o.intent ?? 'none'}, want one of ${allowed.join('|')}` });
    }
    if (expected.mustNotContain?.length) {
        const hits = expected.mustNotContain.filter((s) => norm(body).includes(norm(s)));
        out.push({ grader: 'must-not-contain', pass: hits.length === 0, note: hits.length ? `contains: ${hits.join(' | ')}` : undefined });
    }
    if (expected.mustContain?.length) {
        const missing = expected.mustContain.filter((p) => !new RegExp(p, 'i').test(body));
        out.push({ grader: 'must-contain', pass: missing.length === 0, note: missing.length ? `missing: ${missing.join(' | ')}` : undefined });
    }
    if (expected.mustFlag) {
        out.push({
            grader: 'must-flag', pass: benInLoop,
            note: benInLoop
                ? `flagged=${!!o.flagged} guards=[${escalating.join(',')}] exceptions=[${exceptions.join(',')}]`
                : 'nothing put Ben in the loop: no flag, no escalating guard, no lexicon exception',
        });
    }
    if (expected.mustNotEscalate) {
        out.push({
            grader: 'must-not-escalate', pass: !benInLoop,
            note: benInLoop ? `over-escalated: flagged=${!!o.flagged} guards=[${escalating.join(',')}] exceptions=[${exceptions.join(',')}]` : undefined,
        });
    }
    if (expected.guardsMustTrip?.length) {
        const hits = o.guardHits ?? [];
        const missing = expected.guardsMustTrip.filter((g) => !hits.includes(g));
        out.push({ grader: 'guards-must-trip', pass: missing.length === 0, note: missing.length ? `did not fire: ${missing.join(', ')} (fired: ${hits.join(', ') || 'none'})` : `fired: ${hits.join(', ')}` });
    }
    if (expected.guardsMustNotTrip) {
        const hits = o.guardHits ?? [];
        out.push({ grader: 'guards-must-not-trip', pass: hits.length === 0, note: hits.length ? `fired: ${hits.join(', ')}` : undefined });
    }
    if (expected.mustHold?.length) {
        for (const h of expected.mustHold) {
            const held = h === 'near_duplicate' ? !!o.holds?.nearDuplicate : !!o.holds?.malformedReason;
            out.push({ grader: `hold:${h}`, pass: held, note: held ? undefined : `${h} hold did not apply` });
        }
    }
    if (expected.exceptions?.length) {
        const missing = expected.exceptions.filter((e) => !exceptions.includes(e));
        out.push({ grader: 'exceptions', pass: missing.length === 0, note: missing.length ? `lexicon missed: ${missing.join(', ')} (got ${exceptions.join(', ') || 'none'})` : undefined });
    }
    if (expected.noExceptions) {
        out.push({ grader: 'no-exceptions', pass: exceptions.length === 0, note: exceptions.length ? `lexicon raised: ${exceptions.join(', ')}` : undefined });
    }
    if (expected.voiceClean) {
        const v = o.voiceViolations ?? [];
        out.push({ grader: 'voice-clean', pass: v.length === 0, note: v.length ? v.join(', ') : undefined });
    }
    if (expected.intake) {
        const a = o.artifact ?? null;
        const titles = a?.lineTitles ?? [];
        if (expected.intake.readiness) {
            out.push({ grader: 'intake-readiness', pass: !!a && a.readiness === expected.intake.readiness, note: `got ${a?.readiness ?? 'no intake'}, want ${expected.intake.readiness}` });
        }
        if (expected.intake.minLines != null) {
            out.push({ grader: 'intake-min-lines', pass: titles.length >= expected.intake.minLines, note: `got ${titles.length} line(s), want ≥ ${expected.intake.minLines}` });
        }
        if (expected.intake.mustMentionLine?.length) {
            const missing = expected.intake.mustMentionLine.filter((p) => !titles.some((t) => new RegExp(p, 'i').test(t)));
            out.push({ grader: 'intake-lines-mention', pass: missing.length === 0, note: missing.length ? `no line matches: ${missing.join(' | ')} (lines: ${titles.join(' / ') || 'none'})` : undefined });
        }
    }
    return out;
}

/** pass^k: every trial passed. pass@k: at least one did. */
export function passK(trials: { pass: boolean }[]): boolean { return trials.length > 0 && trials.every((t) => t.pass); }
export function passAtK(trials: { pass: boolean }[]): boolean { return trials.some((t) => t.pass); }
