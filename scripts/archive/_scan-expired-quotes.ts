import { db } from '../server/db';
import { personalizedQuotes } from '../shared/schema';
import { isNull, desc } from 'drizzle-orm';

const QUOTE_VALIDITY_MS = 48 * 60 * 60 * 1000;

function effectiveExpiry(q: any): Date | null {
  if (q.expiresAt) return new Date(q.expiresAt);
  if (q.createdAt) return new Date(new Date(q.createdAt).getTime() + QUOTE_VALIDITY_MS);
  return null;
}

async function main() {
  const now = Date.now();
  // Unbooked only (never renew a paid/booked quote's price-lock).
  const rows = await db.select().from(personalizedQuotes)
    .where(isNull(personalizedQuotes.depositPaidAt))
    .orderBy(desc(personalizedQuotes.createdAt));

  const unbooked = rows.filter((q: any) => !q.bookedAt);
  const expired = unbooked.filter((q: any) => {
    const e = effectiveExpiry(q);
    return e && e.getTime() < now;
  });

  const nullExpiryRegen = expired.filter((q: any) => q.expiresAt == null && (q.regenerationCount || 0) >= 1);
  const nullExpiryNoRegen = expired.filter((q: any) => q.expiresAt == null && (q.regenerationCount || 0) === 0);
  const pastExpiry = expired.filter((q: any) => q.expiresAt != null);

  const fmt = (q: any) => `  ${q.shortSlug}  ${(q.customerName || '').trim().padEnd(16)}  ${q.phone || q.email || ''}  created=${q.createdAt?.toISOString?.().slice(0,10)}  regen=${q.regenerationCount || 0}  £${((q.basePrice||0)/100).toFixed(2)}`;

  console.log(`Total unbooked quotes: ${unbooked.length}`);
  console.log(`Effectively EXPIRED unbooked: ${expired.length}\n`);

  console.log(`=== A. expiresAt NULL + regenerated (the old-regenerate bug — clear fix): ${nullExpiryRegen.length} ===`);
  nullExpiryRegen.forEach((q) => console.log(fmt(q)));

  console.log(`\n=== B. expiresAt NULL, never regenerated (legacy, predates expiresAt): ${nullExpiryNoRegen.length} ===`);
  nullExpiryNoRegen.slice(0, 15).forEach((q) => console.log(fmt(q)));
  if (nullExpiryNoRegen.length > 15) console.log(`  … and ${nullExpiryNoRegen.length - 15} more`);

  console.log(`\n=== C. expiresAt set but in the PAST (naturally expired): ${pastExpiry.length} ===`);
  pastExpiry.slice(0, 10).forEach((q) => console.log(fmt(q)));
  if (pastExpiry.length > 10) console.log(`  … and ${pastExpiry.length - 10} more`);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
