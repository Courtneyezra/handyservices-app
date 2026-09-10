/**
 * The two reports: judge-report.json (machine-readable, the whole JudgeResult) and
 * judge-report.md (readable), each with per-line pass, fail or error, the planned send and a
 * case-file snapshot as evidence. Written under server/comms-v2/reports/<stamp>/, which is
 * gitignored except for the one committed example.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARTEFACT_REASON, POST_SEND_DEPENDENT } from './expectations';
import type { JudgeResult, LineResult, ScenarioRunResult, TurnResult } from './runner';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPORTS_DIR = path.resolve(here, '..', 'reports');

/** design.md "Goal 1's stop condition, line by line", the Expected column, for the reader. */
export const CHECKLIST_TEXT: Record<string, string> = {
    '1.1': "The customer's first WhatsApp message gets one acknowledgement that quotes their enquiry back and offers a call, freeform.",
    '1.6': 'A customer who has said text-only is never asked for a call again.',
    '1.7': 'Photos arriving with the first message are acknowledged as photos, not as a bare enquiry.',
    '2.1': 'It replies to every customer turn, whether or not the reply is a question.',
    '2.2': 'It asks for a photo once. If they reply without sending one, it proceeds.',
    '2.3': 'It asks about the job one thing at a time, in its own words.',
    '2.4': 'A short pause ("one sec") does not stop it.',
    '2.5': 'A real promise ("I\'ll send photos tomorrow") gets one acknowledgement, then quiet until they write.',
    '2.6': 'A date question gets "dates come with your quote" and scoping continues. No lead-time guess.',
    '2.7': 'Anything about money goes to Ben, not answered.',
    '2.8': 'It never sends a second reply without the customer writing in between.',
};

export function reportStamp(d = new Date()): string {
    return d.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

export interface WrittenReports { dir: string; json: string; markdown: string }

export function writeReports(result: JudgeResult, dir: string): WrittenReports {
    fs.mkdirSync(dir, { recursive: true });
    const json = path.join(dir, 'judge-report.json');
    const markdown = path.join(dir, 'judge-report.md');
    fs.writeFileSync(json, JSON.stringify(result, null, 2) + '\n');
    fs.writeFileSync(markdown, renderMarkdown(result));
    return { dir, json, markdown };
}

// ---------------------------------------------------------------- markdown

const STATUS_MARK: Record<string, string> = { pass: 'PASS', fail: 'FAIL', error: 'ERROR' };

function fence(obj: unknown, lang = 'json'): string {
    return '```' + lang + '\n' + (typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)) + '\n```';
}

function esc(s: string): string {
    return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function renderMarkdown(r: JudgeResult): string {
    const out: string[] = [];
    out.push('# Comms v2 judge report');
    out.push('');
    out.push(`Generated ${r.generatedAt}. Desk: ${r.desk}. Door: ${r.door.mode} at ${r.door.host}. Runs: ${r.runs}.`);
    out.push('');
    out.push(`Lines: ${r.summary.pass} pass, ${r.summary.fail} fail, ${r.summary.error} error. Exit code ${r.exitCode} (non-zero only on an error; a fail is not an error).`);
    out.push('');
    out.push('A line passes only when every expectation on it passes in every run. Fails against the current desk are expected: Goal 0 proves the judge, not the desk.');
    out.push('');
    out.push(`Known limitation of the current door: it puts only the rules-layer first-contact ack on the thread, never a desk reply planned in dry run. On the turns after such a reply, the expectations that only hold when the desk has seen its own reply (${Array.from(POST_SEND_DEPENDENT).join(', ')}) are recorded as fail with the reason "${ARTEFACT_REASON}". Those verdicts judge the door, not the desk.`);
    out.push('');
    out.push('## Lines');
    out.push('');
    out.push('| Line | Expected | Result | ' + Array.from({ length: r.runs }, (_, i) => `Run ${i + 1}`).join(' | ') + ' |');
    out.push('|---|---|---|' + Array.from({ length: r.runs }, () => '---').join('|') + '|');
    for (const l of r.lines) {
        out.push(`| ${l.line} | ${esc(CHECKLIST_TEXT[l.line] ?? '')} | **${STATUS_MARK[l.status]}** | ${l.perRun.map((p) => STATUS_MARK[p.status]).join(' | ')} |`);
    }
    out.push('');
    for (const l of r.lines) out.push(...renderLine(l));
    out.push('## Scenarios, turn by turn');
    out.push('');
    for (const s of r.scenarios) out.push(...renderScenario(s));
    return out.join('\n') + '\n';
}

function renderLine(l: LineResult): string[] {
    const out: string[] = [];
    out.push(`### Line ${l.line}: ${STATUS_MARK[l.status]}`);
    out.push('');
    out.push(CHECKLIST_TEXT[l.line] ?? '');
    out.push('');
    for (const p of l.perRun) {
        out.push(`Run ${p.run}: ${STATUS_MARK[p.status]}`);
        out.push('');
        for (const reason of p.reasons) out.push(`- ${reason}`);
        out.push('');
    }
    return out;
}

function renderScenario(s: ScenarioRunResult): string[] {
    const out: string[] = [];
    out.push(`### ${s.scenarioId} run ${s.run}: ${s.title}`);
    out.push('');
    out.push(`Lines ${s.lines.join(', ')}. Started ${s.startedAt}, ${s.durationMs} ms.${s.error ? ` **Scenario error: ${s.error}**` : ''}`);
    out.push('');
    const seedBits = Object.entries(s.seed.plan.honoured).map(([k, v]) => `${k}: honoured (${v})`)
        .concat(Object.entries(s.seed.plan.unsupported).map(([k, v]) => `${k}: unsupported (${v})`));
    out.push(`Seed: customer ${s.seed.requested.customer}, name ${s.seed.requested.name ?? 'unknown'}, prefers text ${s.seed.requested.prefersText}, already rung ${s.seed.requested.alreadyRung}, window ${s.seed.requested.window}.${seedBits.length ? ' ' + seedBits.join('; ') + '.' : ''}`);
    out.push('');
    for (const t of s.turns) out.push(...renderTurn(t));
    return out;
}

function renderTurn(t: TurnResult): string[] {
    const out: string[] = [];
    out.push(`#### Turn ${t.index + 1} (${t.from}/${t.kind}): ${t.input}`);
    out.push('');
    if (t.error) { out.push(`**Error:** ${t.error}`); out.push(''); }
    const ps = t.plannedSend;
    if (ps) {
        out.push(`Planned send: ${ps.delivered ? `${ps.bubbles.length} bubble${ps.bubbles.length === 1 ? '' : 's'} (${ps.origin})` : 'nothing goes'}; decision ${ps.evidence.decision ?? 'none'}; intent ${ps.evidence.intent ?? '-'}; window ${ps.windowState}; template ${ps.templateId === null ? 'none' : ps.templateId}; approver ${ps.approver ?? 'none'}; hold ${ps.hold && ps.hold !== 'unavailable' ? `${ps.hold.approver} (${ps.hold.reason})` : ps.hold ?? 'none'}; run ${ps.runId}.${t.landed === false ? ' Not landed on the thread by the door.' : ''}`);
        out.push('');
        for (const b of ps.bubbles) out.push(`> ${b.replace(/\n/g, '\n> ')}`);
        if (ps.bubbles.length) out.push('');
    }
    if (t.expectations.length) {
        for (const e of t.expectations) {
            out.push(`- [${e.line}] ${e.kind}: **${STATUS_MARK[e.status]}** - ${e.reason}`);
            if (e.modelJudge) out.push(`  - model judge (beside, not instead): ${e.modelJudge.model}, prompt ${e.modelJudge.promptHash.slice(0, 12)}, verdict **${e.modelJudge.verdict}**${e.modelJudge.reason ? ` - ${e.modelJudge.reason}` : ''}`);
        }
        out.push('');
    }
    if (ps) {
        out.push('<details><summary>Planned send (full)</summary>');
        out.push('');
        out.push(fence(ps));
        out.push('');
        out.push('</details>');
        out.push('');
    }
    if (t.snapshot) {
        out.push('<details><summary>Case-file snapshot</summary>');
        out.push('');
        out.push(fence(t.snapshot));
        out.push('');
        out.push('</details>');
        out.push('');
    }
    return out;
}
