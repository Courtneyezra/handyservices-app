// Apply one idempotent SQL migration file to DATABASE_URL, statement by statement, skipping comment lines.
// Usage: npx tsx scripts/_apply-migration.ts migrations/<file>.sql   (never db:push against the shared prod DB)
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import fs from 'fs';
(async () => {
  const file = process.argv[2];
  const text = fs.readFileSync(file, 'utf8');
  const stmts = text.split('\n').filter(l => !l.trim().startsWith('--')).join('\n').split(/;\s*\n/).map(s => s.trim()).filter(Boolean);
  for (const s of stmts) { await db.execute(sql.raw(s)); console.log('OK:', s.split('\n')[0].slice(0, 90)); }
  const r: any = await db.execute(sql`select column_name from information_schema.columns where table_name='message_drafts' and column_name in ('due_at','held_reason') union all select column_name from information_schema.columns where table_name='agent_questions' and column_name in ('due_at','expired_at')`);
  console.log('columns present:', (r.rows ?? r).map((x: any) => x.column_name).join(', '));
  process.exit(0);
})().catch(e => { console.error('MIGRATION FAILED', e.message); process.exit(1); });
