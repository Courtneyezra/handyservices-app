/**
 * Repro: "No single contractor can do this whole job" with contractors available.
 *
 * Replays the EXACT call the contextual quote builder makes for the 4-job quote
 * in the screenshot:
 *   Job 1 Pressure Washing, Job 2 Pressure Washing, Job 3 Garden Maintenance, Job 4 Garden Maintenance
 *
 * Frontend sends ONE slug per line item, no dedup:
 *   categories=pressure_washing,pressure_washing,garden_maintenance,garden_maintenance
 *
 * Hypothesis: coveragePercent = distinctCovered / rawSlugCount. With dupes the
 * denominator is 4, so a contractor covering BOTH distinct categories scores
 * 50%, fails the `=== 100` filter, and is dropped → 0 candidates.
 */
import 'dotenv/config';
import { findCandidateContractors } from '../server/contractor-matcher';
import { resolveQuoteCandidatePool } from '../server/lib/quote-fit';
import { db } from '../server/db';
import { handymanSkills, handymanProfiles, users } from '../shared/schema';
import { inArray, sql } from 'drizzle-orm';

const DUP = ['pressure_washing', 'pressure_washing', 'garden_maintenance', 'garden_maintenance'];
const DEDUP = ['pressure_washing', 'garden_maintenance'];

function dump(label: string, r: Awaited<ReturnType<typeof findCandidateContractors>>) {
  console.log(`\n  ${label}`);
  console.log(`    candidates=${r.candidates.length} full=${r.fullCoverageCandidates} partial=${r.partialCoverageCandidates} uncovered=[${r.uncoveredCategories.join(',')}]`);
  for (const c of r.candidates) {
    const tag = c.coveragePercent === 100 ? 'FULL' : `PARTIAL ${c.coveragePercent}%`;
    console.log(`      [${tag}] ${c.contractorName} covers=[${c.coveredCategories.join(',')}] dist=${c.distanceMiles ?? '—'}`);
  }
}

async function main() {
  console.log('═'.repeat(80));
  console.log('STEP 1 — distinct categorySlug values in handymanSkills');
  console.log('═'.repeat(80));
  const distinct = await db
    .select({ slug: handymanSkills.categorySlug, n: sql<number>`count(*)::int` })
    .from(handymanSkills)
    .groupBy(handymanSkills.categorySlug)
    .orderBy(handymanSkills.categorySlug);
  for (const d of distinct) console.log(`  ${d.slug}  (${d.n})`);

  console.log('\n' + '═'.repeat(80));
  console.log('STEP 2 — who has pressure_washing and/or garden_maintenance');
  console.log('═'.repeat(80));
  const rows = await db
    .select({ handymanId: handymanSkills.handymanId, slug: handymanSkills.categorySlug })
    .from(handymanSkills)
    .where(inArray(handymanSkills.categorySlug, DEDUP));
  const byContractor = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.slug) continue;
    (byContractor.get(r.handymanId) ?? byContractor.set(r.handymanId, new Set()).get(r.handymanId)!).add(r.slug);
  }
  const ids = [...byContractor.keys()];
  const profiles = ids.length
    ? await db.select({
        id: handymanProfiles.id, userId: handymanProfiles.userId,
        lat: handymanProfiles.latitude, lng: handymanProfiles.longitude,
        radius: handymanProfiles.radiusMiles, vs: handymanProfiles.verificationStatus,
        pub: handymanProfiles.publicProfileEnabled,
      }).from(handymanProfiles).where(inArray(handymanProfiles.id, ids))
    : [];
  const us = profiles.length
    ? await db.select({ id: users.id, fn: users.firstName, ln: users.lastName }).from(users).where(inArray(users.id, profiles.map(p => p.userId)))
    : [];
  const nameOf = new Map(us.map(u => [u.id, [u.fn, u.ln].filter(Boolean).join(' ') || 'Unknown']));
  const bothCount = [...byContractor.values()].filter(s => s.has('pressure_washing') && s.has('garden_maintenance')).length;
  console.log(`  contractors with ≥1 of the two skills: ${byContractor.size}`);
  console.log(`  contractors with BOTH skills: ${bothCount}`);
  for (const p of profiles) {
    const skills = [...(byContractor.get(p.id) ?? [])];
    const active = p.vs === 'verified' || p.pub === true;
    console.log(`    ${nameOf.get(p.userId) ?? p.id}: skills=[${skills.join(',')}] verified=${p.vs} public=${p.pub} active=${active} lat=${p.lat ?? '—'} lng=${p.lng ?? '—'} radius=${p.radius}`);
  }

  console.log('\n' + '═'.repeat(80));
  console.log('STEP 3 — findCandidateContractors: DUP (frontend) vs DEDUP, no coords');
  console.log('═'.repeat(80));
  dump('DUP (what the UI actually sends — 4 slugs):', await findCandidateContractors({ categorySlugs: DUP }));
  dump('DEDUP (2 distinct slugs):', await findCandidateContractors({ categorySlugs: DEDUP }));

  console.log('\n' + '═'.repeat(80));
  console.log('STEP 4 — resolveQuoteCandidatePool (the function the /fit endpoint calls)');
  console.log('═'.repeat(80));
  const poolDup = await resolveQuoteCandidatePool({ categorySlugs: DUP });
  const poolDedup = await resolveQuoteCandidatePool({ categorySlugs: DEDUP });
  console.log(`  DUP   → candidates=${poolDup.candidates.length} (this is what the panel shows)`);
  console.log(`  DEDUP → candidates=${poolDedup.candidates.length}`);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
