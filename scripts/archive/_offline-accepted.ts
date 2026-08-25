import { db } from '../server/db';
import { personalizedQuotes, users } from '../shared/schema';
import { inArray, eq } from 'drizzle-orm';

const slugs = ['23mi2kmb','9c6fp1mh','7x9y56z8','ofqxglfz'];
const materials = (q: any) => {
  let mat = 0;
  ((q.pricingLineItems as any[]) || []).forEach((it) => (mat += (it.materialsWithMarginPence ?? 0)));
  if (mat === 0 && q.materialsCostWithMarkupPence) mat = q.materialsCostWithMarkupPence;
  return mat / 100;
};

// try shortSlug then id
let rows: any[] = await db.select().from(personalizedQuotes).where(inArray(personalizedQuotes.shortSlug, slugs));
const found = new Set(rows.map(r => r.shortSlug));
const missing = slugs.filter(s => !found.has(s));
if (missing.length) {
  const byId = await db.select().from(personalizedQuotes).where(inArray(personalizedQuotes.id, missing));
  rows = rows.concat(byId);
}
const [ben] = await db.select({ id: users.id, name: users.firstName }).from(users).where(eq(users.firstName, 'Ben'));

console.log(`Found ${rows.length}/${slugs.length}\n`);
let totLabour = 0;
for (const s of slugs) {
  const q = rows.find(r => r.shortSlug === s || r.id === s);
  if (!q) { console.log(`  ${s}  — NOT FOUND`); continue; }
  const rev = (q.basePrice ?? 0) / 100;
  const mat = materials(q);
  const labour = rev - mat;
  totLabour += labour;
  console.log(`  ${s} | ${(q.customerName??'—').padEnd(18)} | createdBy=${q.createdBy===ben?.id?'Ben':q.createdBy} | created ${q.createdAt?.toISOString().slice(0,10)} | selectedAt=${q.selectedAt?q.selectedAt.toISOString().slice(0,10):'—'} | booked=${q.bookedAt?'Y':'N'} | rev £${rev.toFixed(2)} mat £${mat.toFixed(2)} labour £${labour.toFixed(2)} → 10% £${(labour*0.1).toFixed(2)}`);
}
console.log(`\nCombined labour £${totLabour.toFixed(2)} → commission £${(totLabour*0.1).toFixed(2)}`);
process.exit(0);
