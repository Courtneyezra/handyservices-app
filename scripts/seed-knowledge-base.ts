/**
 * Build plan v2, item 3.4: put the first draft of the knowledge base in front of Ben.
 *
 *   npx tsx scripts/seed-knowledge-base.ts            # insert what is missing, print the result
 *   npx tsx scripts/seed-knowledge-base.ts --dry-run  # print what it would do, write nothing
 *
 * Apply migrations/20260908_kb_entries.sql first (npx tsx scripts/_apply-migration.ts …).
 *
 * Every row lands UNREVIEWED, so nothing here can reach a customer until Ben opens
 * /admin/knowledge and reviews it one entry at a time. Re-running is safe: a row that already
 * exists is left exactly as it is, reviewed or not, because the seed is a first draft and Ben's
 * words beat ours the moment he types them.
 */
import 'dotenv/config';
import { KB_SEED } from '../server/spine/knowledge-base-seed';
import { insertSeedEntryIfMissing, validateDraft } from '../server/spine/knowledge-base';

async function main() {
    const dryRun = process.argv.slice(2).includes('--dry-run');

    const invalid = KB_SEED.map((s) => ({ s, v: validateDraft(s) })).filter((r) => !r.v.ok);
    if (invalid.length) {
        for (const { s, v } of invalid) console.error(`  INVALID ${s.id}: ${(v as { ok: false; errors: string[] }).errors.join('; ')}`);
        throw new Error(`${invalid.length} seed entries are invalid; nothing was written.`);
    }

    if (dryRun) {
        console.log(`${KB_SEED.length} seed entries, all unreviewed:`);
        for (const s of KB_SEED) console.log(`  ${s.kind === 'question' ? 'QUESTION' : 'answer  '}  ${s.id}  ${s.topic}`);
        console.log('\nDry run: nothing written.');
        return;
    }

    let inserted = 0, kept = 0;
    for (const seed of KB_SEED) {
        const result = await insertSeedEntryIfMissing(seed);
        if (result === 'inserted') { inserted++; console.log(`  + ${seed.id}`); }
        else { kept++; console.log(`  = ${seed.id} (already there, left alone)`); }
    }
    console.log(`\n${inserted} inserted, ${kept} left alone. All new rows are UNREVIEWED and invisible to customers.`);
    console.log('Ben reviews them at /admin/knowledge. The four "question-" rows are questions for him, not answers, and can never be sent.');
}

main().then(() => process.exit(0)).catch((error) => {
    console.error('[seed-knowledge-base] failed:', error?.message ?? error);
    process.exit(1);
});
