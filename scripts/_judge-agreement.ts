/**
 * Judge calibration report (Phase 3 / C; COMMS_EVALS_PLAN §2.3 "calibration before trust").
 *
 *   npx tsx scripts/_judge-agreement.ts                 # prints the SQL plan and exits (no DB)
 *   ALLOW_PROD_DB_TESTS=1 EVAL_LIVE=1 npx tsx scripts/_judge-agreement.ts --limit 40
 *
 * Reads Ben's verdicts (draft_verdicts ⋈ message_drafts), runs voice-v1 over each draft's ORIGINAL
 * body (what the machine wrote, before any edit), and reports agreement: approve ⇔ judge fine,
 * edit/reject ⇔ judge not fine. The judge may gate nothing until agreement ≥ 85% (design §9).
 * Needs a database and the model, so it does nothing unless BOTH env flags are set; otherwise it
 * prints exactly what it would run. Writes eval-results/judge-agreement.json when it runs.
 */
import fs from 'node:fs';
import path from 'node:path';

const ARGS = process.argv.slice(2);
const arg = (n: string) => { const i = ARGS.indexOf(`--${n}`); return i >= 0 ? ARGS[i + 1] : null; };
const LIMIT = Math.min(200, Math.max(5, Number(arg('limit') ?? 40)));

const SQL = `
SELECT v.id, v.draft_id, v.verdict, v.reason, v."by", v.created_at,
       v.original_body, v.final_body,
       d.source, d.reason AS draft_reason, d.conversation_id
FROM draft_verdicts v
LEFT JOIN message_drafts d ON d.id = v.draft_id
WHERE v.verdict IN ('approve', 'edit', 'reject')
ORDER BY v.created_at DESC
LIMIT ${LIMIT};`;

async function main() {
    console.log(`judge-agreement: rubric voice-v1, last ${LIMIT} human verdicts\n`);
    console.log('SQL plan:' + SQL);
    if (!process.env.ALLOW_PROD_DB_TESTS || !process.env.EVAL_LIVE) {
        console.log('\nNot running: set ALLOW_PROD_DB_TESTS=1 (database) and EVAL_LIVE=1 (model) to execute. Nothing was read or called.');
        process.exit(0);
    }
    if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(2); }

    const { db } = await import('../server/db');
    const { sql } = await import('drizzle-orm');
    const { judgeVoiceV1, judgeAgrees, judgeSaysFine } = await import('../server/spine/judge');
    const res: any = await db.execute(sql.raw(SQL));
    const rows: any[] = res.rows ?? res;
    console.log(`\n${rows.length} verdict(s) loaded\n`);

    const out: any[] = [];
    let agreed = 0, counted = 0;
    for (const r of rows) {
        const body = String(r.original_body ?? '');
        const v = await judgeVoiceV1({ body, intent: /^\[([a-z_]+)\]/i.exec(r.draft_reason ?? '')?.[1] ?? null });
        const agree = judgeAgrees(v, { verdict: r.verdict, reason: r.reason });
        if (agree !== null) { counted += 1; if (agree) agreed += 1; }
        out.push({ verdictId: r.id, draftId: r.draft_id, human: { verdict: r.verdict, reason: r.reason, by: r.by, at: r.created_at }, judge: { overall: v.overall, fine: judgeSaysFine(v), call: v.call ?? null, cannotJudge: v.cannotJudge, notes: v.notes, deterministic: v.deterministic }, agree });
        console.log(`${agree === null ? '  ?' : agree ? ' ok' : 'DIS'}  ${String(r.verdict).padEnd(7)} ${String(r.reason ?? '').padEnd(12)} judge=${v.overall ?? 'n/a'} ${v.call ?? ''}  ${body.replace(/\s+/g, ' ').slice(0, 70)}`);
    }
    const rate = counted ? agreed / counted : null;
    console.log(`\nAgreement: ${agreed}/${counted}${rate == null ? '' : ` = ${Math.round(rate * 1000) / 10}%`} (gate to trust the judge: ≥ 85%, design §9)`);
    fs.mkdirSync(path.resolve('eval-results'), { recursive: true });
    fs.writeFileSync(path.resolve('eval-results', 'judge-agreement.json'), JSON.stringify({ at: new Date().toISOString(), rubric: 'voice-v1', limit: LIMIT, counted, agreed, rate, rows: out }, null, 2));
    console.log('Written eval-results/judge-agreement.json');
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
