/**
 * Grant (or clear) a contractor's launch bonus — "+X% on your first N jobs".
 * Shown as a separate expiring bonus line on their job offers; decremented on
 * each accept. See docs/TWO-SIDED-PRICING-LOOP-2026-07.md (Phase 2).
 *
 * Usage:
 *   npx tsx scripts/_grant-launch-boost.ts <name-or-id-fragment> [percent=10] [jobs=10]
 *   npx tsx scripts/_grant-launch-boost.ts <name-or-id-fragment> 0 0    # clear
 */
import { db } from '../server/db';
import { handymanProfiles, users } from '../shared/schema';
import { eq, sql } from 'drizzle-orm';
import { DEFAULT_ONBOARDING_BOOST } from '../server/revenue-share-tiers';

const frag = process.argv[2];
const percent = process.argv[3] !== undefined ? Number(process.argv[3]) : DEFAULT_ONBOARDING_BOOST.percent;
const jobs = process.argv[4] !== undefined ? Number(process.argv[4]) : DEFAULT_ONBOARDING_BOOST.jobs;
if (!frag) { console.log('usage: _grant-launch-boost.ts <name-or-id-fragment> [percent] [jobs]'); process.exit(1); }

const rows = await db.select({
  id: handymanProfiles.id, businessName: handymanProfiles.businessName,
  first: users.firstName, last: users.lastName,
  pct: handymanProfiles.onboardingBoostPercent, left: handymanProfiles.onboardingBoostJobsRemaining,
}).from(handymanProfiles).leftJoin(users, eq(handymanProfiles.userId, users.id));

const matches = rows.filter(r => {
  const name = `${r.businessName || ''} ${r.first || ''} ${r.last || ''} ${r.id}`.toLowerCase();
  return name.includes(frag.toLowerCase());
});
if (matches.length !== 1) {
  console.log(matches.length === 0 ? 'no match' : 'ambiguous — matches:');
  for (const m of matches.length ? matches : rows) console.log(` ${m.id} · ${m.businessName || `${m.first || ''} ${m.last || ''}`.trim()} · current boost: ${m.pct || 0}% × ${m.left || 0}`);
  process.exit(1);
}
const m = matches[0];
await db.update(handymanProfiles)
  .set({ onboardingBoostPercent: percent || null, onboardingBoostJobsRemaining: jobs || null })
  .where(eq(handymanProfiles.id, m.id));
console.log(`${m.businessName || `${m.first || ''} ${m.last || ''}`.trim()}: launch bonus ${percent ? `+${percent}% on next ${jobs} accepted jobs` : 'CLEARED'}`);
process.exit(0);
