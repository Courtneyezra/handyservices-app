// One-off additive migration for the Scriptable widget token (docs/PLAN_SCRIPTABLE_WIDGET.md).
// `npm run db:push` is blocked by pre-existing schema drift, so apply this directly:
//   npx tsx scripts/_migrate-users-widget-token.ts
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS widget_token varchar`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_widget_token ON users (widget_token)`);

  const cols = await db.execute(sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'widget_token'
  `);
  console.log('users.widget_token:', JSON.stringify(cols.rows, null, 2));

  const idx = await db.execute(sql`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename = 'users' AND indexname = 'idx_users_widget_token'
  `);
  console.log('index:', JSON.stringify(idx.rows, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
