import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import { users, personalizedQuotes } from '../shared/schema';
import { eq } from 'drizzle-orm';
const [ben] = await db.select({id:users.id}).from(users).where(eq(users.firstName,'Ben'));
const NT = sql`(id NOT LIKE 'test\_q\_%' AND (customer_name IS NULL OR customer_name !~* '\\b(test|qa|phase|debug|preview|dummy|sample)\\b'))`;
const dn = sql`EXTRACT(DOW FROM created_at AT TIME ZONE 'Europe/London')`;
const dow = sql`to_char(created_at AT TIME ZONE 'Europe/London','Dy')`;
const r = await db.execute(sql`
  SELECT ${dow} AS day, ${dn} AS dnn, count(*)::int AS quotes,
    count(*) FILTER (WHERE deposit_paid_at IS NOT NULL)::int AS paid
  FROM personalized_quotes WHERE created_by=${ben.id} AND ${NT} AND created_at >= now() - interval '60 days'
  GROUP BY 1,2 ORDER BY 2`);
console.log('=== Ben QUOTES BUILT by day of week (last 60d) ===');
for(const x of r.rows as any[]) console.log(`${x.day}  quotes built ${String(x.quotes).padStart(3)}   → paid ${x.paid}`);
process.exit(0);
