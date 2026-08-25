/**
 * Spam/junk audit of UNQUOTED call-origin leads (Apr 2026+).
 * Goal: split the "never got a quote" pool into spam vs real quotable leads
 * so the lead→quote coverage number is honest. Caches LLM verdicts to
 * scratchpad so reruns are free.
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import { claudeJson } from '../server/llm';
import * as fs from 'fs';

const SCRATCH = '/private/tmp/claude-501/-Users-courtneebonnick-v6-switchboard/ff9fd504-d482-4a10-8021-4353242d6353/scratchpad';
const CACHE_FILE = `${SCRATCH}/spam-audit-cache.json`;

type Verdict = {
  category: 'SPAM' | 'NOT_A_JOB' | 'HANDLED_ELSEWHERE' | 'QUOTABLE_DROPPED' | 'UNCLEAR';
  reason: string;
};

async function main() {
  const rows = (await db.execute(sql`
    WITH quoted_phones AS (
      SELECT DISTINCT right(regexp_replace(phone,'[^0-9]','','g'),10) AS np
      FROM personalized_quotes
      WHERE phone NOT LIKE '%7700900%' AND id NOT LIKE 'test_q_%'
    ),
    unquoted AS (
      SELECT l.id, l.customer_name, l.phone, l.source, l.created_at,
        to_char(l.created_at,'YYYY-MM') AS month,
        l.job_description, l.job_summary, l.eleven_labs_summary,
        right(regexp_replace(l.phone,'[^0-9]','','g'),10) AS np
      FROM leads l
      WHERE l.created_at >= '2026-04-01'
        AND l.source IN ('voice_monitor','eleven_labs_agent','whatsapp')
        AND l.phone NOT LIKE '%7700900%'
        AND l.customer_name !~* '(^|[^a-z])(test|qa|dummy|demo)([^a-z]|$)'
        AND NOT EXISTS (SELECT 1 FROM quoted_phones qp
          WHERE qp.np <> '' AND qp.np = right(regexp_replace(l.phone,'[^0-9]','','g'),10))
    )
    SELECT u.*, c.duration, c.missed_reason, c.handled_by, c.outcome,
      left(c.transcription, 1800) AS transcript_snip, c.job_summary AS call_job_summary
    FROM unquoted u
    LEFT JOIN LATERAL (
      SELECT duration, missed_reason, handled_by, outcome, transcription, job_summary
      FROM calls c
      WHERE c.lead_id = u.id
         OR right(regexp_replace(c.phone_number,'[^0-9]','','g'),10) = u.np
      ORDER BY COALESCE(length(c.transcription),0) DESC, c.duration DESC NULLS LAST
      LIMIT 1
    ) c ON true
    ORDER BY u.created_at
  `)).rows as any[];

  console.log(`Unquoted call-origin leads (Apr+): ${rows.length}`);

  const cache: Record<string, Verdict> = fs.existsSync(CACHE_FILE)
    ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {};

  const results: { row: any; v: Verdict }[] = [];
  const toClassify: any[] = [];

  for (const r of rows) {
    const content = [r.job_description, r.job_summary, r.eleven_labs_summary, r.call_job_summary, r.transcript_snip]
      .filter(Boolean).join(' ').trim();
    if (cache[r.id]) {
      results.push({ row: r, v: cache[r.id] });
    } else if (content.length < 25) {
      // Nothing to judge: hangup / missed / empty voicemail
      const v: Verdict = {
        category: 'UNCLEAR',
        reason: `no content (duration=${r.duration ?? '?'}s, missed=${r.missed_reason ?? '-'})`,
      };
      cache[r.id] = v;
      results.push({ row: r, v });
    } else {
      toClassify.push(r);
    }
  }
  console.log(`Cached/heuristic: ${results.length}, sending to Claude: ${toClassify.length}`);

  const SYSTEM = `You classify inbound phone leads for a Nottingham handyman business ("Handy Services").
Given call/lead data, output JSON: {"category": "...", "reason": "<max 12 words>"}.
Categories:
- SPAM: telemarketing, robocalls, SEO/ads sellers, recruiters, scams, silent auto-dials.
- NOT_A_JOB: suppliers, existing-customer admin (invoice/reschedule of a booked job), wrong number, job applicants, anything that is not a NEW work enquiry.
- HANDLED_ELSEWHERE: a real job enquiry where the transcript shows it was already resolved verbally — price given and declined, booked on the phone, referred out, or customer said they'd not proceed.
- QUOTABLE_DROPPED: a real NEW job enquiry (any home repair/improvement task) with no sign it was resolved — this lead should have received a quote.
- UNCLEAR: genuinely cannot tell.
Be strict: only QUOTABLE_DROPPED when there is a real job described.`;

  let done = 0;
  const POOL = 6;
  for (let i = 0; i < toClassify.length; i += POOL) {
    const batch = toClassify.slice(i, i + POOL);
    const verdicts = await Promise.all(batch.map(async (r) => {
      const user = JSON.stringify({
        caller_name: r.customer_name,
        source: r.source,
        call_duration_seconds: r.duration,
        missed_reason: r.missed_reason,
        call_outcome: r.outcome,
        job_description: r.job_description?.slice(0, 500),
        job_summary: r.job_summary?.slice(0, 500),
        ai_summary: r.eleven_labs_summary?.slice(0, 500),
        call_summary: r.call_job_summary?.slice(0, 500),
        transcript_excerpt: r.transcript_snip?.slice(0, 1500),
      });
      try {
        const v = await claudeJson<Verdict>({ system: SYSTEM, user, maxTokens: 150 });
        if (!['SPAM','NOT_A_JOB','HANDLED_ELSEWHERE','QUOTABLE_DROPPED','UNCLEAR'].includes(v.category)) {
          return { category: 'UNCLEAR', reason: 'bad model output' } as Verdict;
        }
        return v;
      } catch (e: any) {
        return { category: 'UNCLEAR', reason: `llm error: ${String(e.message).slice(0, 40)}` } as Verdict;
      }
    }));
    batch.forEach((r, j) => { cache[r.id] = verdicts[j]; results.push({ row: r, v: verdicts[j] }); });
    done += batch.length;
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));
    if (done % 60 === 0 || done === toClassify.length) console.log(`  classified ${done}/${toClassify.length}`);
  }

  // ---- Report ----
  const byCat: Record<string, number> = {};
  const byMonthCat: Record<string, Record<string, number>> = {};
  for (const { row, v } of results) {
    byCat[v.category] = (byCat[v.category] || 0) + 1;
    byMonthCat[row.month] = byMonthCat[row.month] || {};
    byMonthCat[row.month][v.category] = (byMonthCat[row.month][v.category] || 0) + 1;
  }
  console.log('\n=== UNQUOTED LEADS BY CATEGORY ===');
  console.table(byCat);
  console.log('\n=== BY MONTH ===');
  console.table(byMonthCat);

  // Recovery list: quotable-dropped, deduped by phone (keep latest)
  const dropped = results.filter(r => r.v.category === 'QUOTABLE_DROPPED')
    .sort((a, b) => a.row.created_at - b.row.created_at);
  const seen = new Map<string, any>();
  for (const { row, v } of dropped) seen.set(row.np || row.id, { row, v });
  const recovery = [...seen.values()].reverse();

  const csv = ['date,name,phone,source,job,reason'];
  for (const { row, v } of recovery) {
    const job = (row.job_description || row.job_summary || row.eleven_labs_summary || row.call_job_summary || '')
      .replace(/[\r\n,]+/g, ' ').slice(0, 140);
    csv.push([
      new Date(row.created_at).toISOString().slice(0, 10),
      String(row.customer_name || '').replace(/,/g, ' '),
      row.phone, row.source, job, v.reason.replace(/,/g, ' '),
    ].join(','));
  }
  fs.writeFileSync(`${SCRATCH}/quotable-dropped-recovery-list.csv`, csv.join('\n'));
  console.log(`\nRecovery list: ${recovery.length} unique quotable-dropped leads -> ${SCRATCH}/quotable-dropped-recovery-list.csv`);

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
