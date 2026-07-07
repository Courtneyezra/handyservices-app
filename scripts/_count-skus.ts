import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
const r = await db.execute(sql`SELECT count(*)::int AS n FROM service_catalog`);
const s = await db.execute(sql`SELECT shape, count(*)::int AS n FROM service_catalog GROUP BY shape`);
console.log('Rows in service_catalog:', (r.rows as any[])[0].n);
console.log('By shape:');
(s.rows as any[]).forEach(r => console.log(`  ${r.shape.padEnd(10)} ${r.n}`));
process.exit(0);
