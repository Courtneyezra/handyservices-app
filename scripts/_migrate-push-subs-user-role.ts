import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function main() {
  await db.execute(sql`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS user_id varchar`);
  await db.execute(sql`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS role varchar(20)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions (user_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_push_subs_role ON push_subscriptions (role)`);

  const cols = await db.execute(sql`
    SELECT column_name, data_type, character_maximum_length, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'push_subscriptions'
    ORDER BY ordinal_position
  `);
  console.log('push_subscriptions columns:', JSON.stringify(cols.rows, null, 2));

  const count = await db.execute(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE user_id IS NULL)::int AS legacy_null_user
    FROM push_subscriptions
  `);
  console.log('rows:', JSON.stringify(count.rows, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
