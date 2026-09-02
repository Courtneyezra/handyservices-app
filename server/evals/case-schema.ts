/**
 * Phase 2 eval case schema + loader (COMMS_EVALS_PLAN §2.1, BRIEF-P2-evals). Cases are DATA under
 * eval-cases/<family>/*.json and are self-contained: a `context` thread (or a full spine CaseFile),
 * an optional recorded `candidate` reply to grade offline, and `expected`. No database anywhere.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { CaseFile, ExceptionKind, Intent, Lane } from '../spine/types';

export interface EvalContextMessage {
    direction: 'inbound' | 'outbound';
    body: string;
    at?: string;
    channel?: 'whatsapp' | 'sms' | 'call' | 'webform' | 'email';
}

/** A recorded or written reply, graded by the `replay` adapter without any model call. */
export interface EvalCandidate {
    body: string;
    intent?: string | null;
    lane?: string | null;
    /** The producer raised a flag / escalated (agent_questions row, needs_ben tag). */
    flagged?: boolean;
    reason?: string | null;
    source?: string | null;
    approver?: string | null;
    sentAt?: string | null;
    /** Earlier outbound sends in the same window, for the near-duplicate hold. */
    priorSends?: { body: string; at?: string }[];
}

export type HoldKind = 'near_duplicate' | 'malformed_reason';

export interface EvalExpected {
    lane?: Lane;
    intent?: Intent | string | Array<Intent | string>;
    /** Substrings (case-insensitive) the reply must not contain. */
    mustNotContain?: string[];
    /** Regexes (source, 'i') the reply must match. */
    mustContain?: string[];
    /** The run must end with Ben in the loop: a flag, an escalating guard, or a lexicon exception. */
    mustFlag?: boolean;
    /** An ordinary scoping reply: no flag, no escalating guard, no exception in the customer text. */
    mustNotEscalate?: boolean;
    /** Detector codes that must fire on the candidate body (regression pin). */
    guardsMustTrip?: string[];
    /** No detector may fire at all (voice included). */
    guardsMustNotTrip?: boolean;
    /** Queue-exit holds that must apply (27 Aug James incident). */
    mustHold?: HoldKind[];
    /** Exceptions the customer text must (not) raise in the lexicon. */
    exceptions?: ExceptionKind[];
    noExceptions?: boolean;
    /** The reply must pass chatVoiceViolations. */
    voiceClean?: boolean;
    /**
     * P8 (intake family): what the Quote clerk's artifact must say. Graded only by adapters that
     * run the clerk (spine). `readiness` is the shared vocabulary (shared/intake-readiness.ts);
     * `minLines` = at least this many job lines; `mustMentionLine` = regexes (source, 'i') that
     * must each match at least one line title — "a new intake supersedes" is proved by the new
     * scope being on the new intake.
     */
    intake?: { readiness?: string; minLines?: number; mustMentionLine?: string[] };
    /** Human label for the owner review (fine | tone | wrong_move | unsafe | missing_info | unguarded_but_fine …). */
    label?: string | null;
    notes?: string;
}

export interface EvalCaseV2 {
    id: string;
    family: string;
    /** regression = pass^k must hold; capability = pass@k, improvement target. Default regression. */
    kind?: 'regression' | 'capability';
    trials?: number;
    caseFile?: CaseFile;
    context?: EvalContextMessage[];
    customer?: { firstName?: string | null; ref?: string | null };
    quote?: { seen?: boolean; viewCount?: number; totalPence?: number | null; offeredDates?: string[]; slug?: string; /** paid quotes are booked jobs: scoper lane, not post_quote */ paid?: boolean };
    firstContact?: boolean;
    /** Thread tags on the case file (e.g. 'needs_quote' routes triage to the clerk without a model). */
    tags?: string[];
    candidate?: EvalCandidate;
    expected: EvalExpected;
    provenance?: string;
    reference?: string;
}

export const CASE_DIR_EXCLUDES = new Set(['seed', 'node_modules']);

export function validateCase(c: unknown, file: string): string[] {
    const errs: string[] = [];
    if (!c || typeof c !== 'object') return [`${file}: case is not an object`];
    const k = c as Record<string, unknown>;
    if (typeof k.id !== 'string' || !k.id) errs.push(`${file}: missing id`);
    if (typeof k.family !== 'string' || !k.family) errs.push(`${file}: ${k.id ?? '?'} missing family`);
    if (!k.caseFile && !Array.isArray(k.context)) errs.push(`${file}: ${k.id ?? '?'} needs caseFile or context`);
    if (!k.expected || typeof k.expected !== 'object') errs.push(`${file}: ${k.id ?? '?'} missing expected`);
    if (k.kind && k.kind !== 'regression' && k.kind !== 'capability') errs.push(`${file}: ${k.id} bad kind`);
    return errs;
}

function casesInFile(file: string): unknown[] {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.cases)) return raw.cases;
    return [raw];
}

/** Every case under root/<family>/*.json, family taken from the directory when the case omits it. */
export function loadCases(root: string, opts: { family?: string | null; only?: string | null } = {}): { cases: EvalCaseV2[]; errors: string[] } {
    const cases: EvalCaseV2[] = [];
    const errors: string[] = [];
    if (!fs.existsSync(root)) return { cases, errors: [`no such directory: ${root}`] };
    for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
        if (!dir.isDirectory() || CASE_DIR_EXCLUDES.has(dir.name)) continue;
        if (opts.family && dir.name !== opts.family) continue;
        const dirPath = path.join(root, dir.name);
        for (const f of fs.readdirSync(dirPath).filter((n) => n.endsWith('.json')).sort()) {
            const file = path.join(dirPath, f);
            let raw: unknown[];
            try { raw = casesInFile(file); } catch (e: any) { errors.push(`${file}: ${e?.message}`); continue; }
            for (const r of raw) {
                const withFamily = (r && typeof r === 'object' && !(r as any).family) ? { ...(r as object), family: dir.name } : r;
                const errs = validateCase(withFamily, path.relative(root, file));
                if (errs.length) { errors.push(...errs); continue; }
                const c = withFamily as EvalCaseV2;
                if (opts.only && c.id !== opts.only) continue;
                cases.push(c);
            }
        }
    }
    const ids = new Map<string, number>();
    for (const c of cases) ids.set(c.id, (ids.get(c.id) ?? 0) + 1);
    for (const [id, n] of Array.from(ids.entries())) if (n > 1) errors.push(`duplicate case id ${id} (${n}×)`);
    return { cases, errors };
}

/** The customer's last inbound message in a context thread. */
export function lastInbound(context: EvalContextMessage[] | undefined): string | null {
    if (!context) return null;
    for (let i = context.length - 1; i >= 0; i--) if (context[i].direction === 'inbound') return context[i].body;
    return null;
}
