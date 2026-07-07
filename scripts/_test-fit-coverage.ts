/**
 * Phase 22 — test "Who fits this job" skill coverage.
 *
 * User requirement: a contractor should ONLY appear in the fit panel if
 * they cover ALL line-item categories of the quote. Anything less = they
 * can't complete the full job, so they shouldn't be offered.
 *
 * This script picks a few realistic category combinations and reports
 * which contractors the matcher returns with FULL vs PARTIAL coverage.
 */
import 'dotenv/config';
import { findCandidateContractors } from '../server/contractor-matcher';

async function main() {
  const scenarios: { name: string; categories: string[] }[] = [
    { name: 'Single category — plumbing only', categories: ['plumbing_minor'] },
    { name: 'Two categories — plumbing + tiling', categories: ['plumbing_minor', 'tiling'] },
    { name: 'Three categories — plumbing + tiling + painting', categories: ['plumbing_minor', 'tiling', 'painting'] },
    { name: 'Four categories — bathroom refurb mix', categories: ['plumbing_minor', 'tiling', 'painting', 'silicone_sealant'] },
    { name: 'Multi-trade rare combo — electrical + plastering + fencing', categories: ['electrical_minor', 'plastering', 'fencing'] },
  ];

  for (const s of scenarios) {
    console.log('\n' + '═'.repeat(80));
    console.log(`Scenario: ${s.name}`);
    console.log(`Categories: [${s.categories.join(', ')}]`);
    console.log('─'.repeat(80));

    const result = await findCandidateContractors({ categorySlugs: s.categories });

    if (result.candidates.length === 0) {
      console.log('  ❌ NO candidates returned.');
      continue;
    }

    console.log(`  Total candidates returned: ${result.candidates.length}`);
    console.log(`    fullCoverage:    ${result.fullCoverageCandidates}`);
    console.log(`    partialCoverage: ${result.partialCoverageCandidates}`);
    if (result.uncoveredCategories.length > 0) {
      console.log(`    UNCOVERED categories: [${result.uncoveredCategories.join(', ')}]`);
    }

    console.log('\n  Per-candidate breakdown:');
    for (const c of result.candidates) {
      const tag = c.coveragePercent === 100 ? '✅ FULL' : `⚠ PARTIAL ${c.coveragePercent}%`;
      const missing = s.categories.filter((cat) => !c.coveredCategories.includes(cat));
      console.log(
        `    ${tag.padEnd(18)} ${c.contractorName.padEnd(25)} ` +
        `covers=[${c.coveredCategories.join(',')}]` +
        (missing.length > 0 ? ` MISSING=[${missing.join(',')}]` : ''),
      );
    }

    console.log('\n  → Per user requirement, only the FULL candidates should be shown.');
    if (result.partialCoverageCandidates > 0) {
      console.log(`  ⚠ Currently ${result.partialCoverageCandidates} partial candidates are leaked through (UI shows them with "% skills" badge).`);
    } else {
      console.log('  ✓ No partials leaked through.');
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
