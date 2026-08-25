/**
 * Run the WhatsApp template approval poll by hand and print what moved.
 *
 * Same code path the hourly cron uses (server/whatsapp-template-sync.ts) — this is how you seed
 * the cache after the migration, or check straight after submitting a template to Meta.
 *
 *   npx tsx scripts/_wa-template-sync.ts
 */
import 'dotenv/config';
import { syncWhatsAppTemplates, getCachedTemplates } from '../server/whatsapp-template-sync';

async function main() {
    const outcome = await syncWhatsAppTemplates('script');

    for (const t of await getCachedTemplates()) {
        const mark = t.status === 'approved' ? '✓' : t.status === 'rejected' ? '✗' : '·';
        console.log(`${mark} ${t.status.padEnd(12)} ${(t.category || '-').padEnd(9)} ${t.name.padEnd(28)} ${t.contentSid}` +
            `${t.rejectionReason ? `  (${t.rejectionReason})` : ''}`);
    }

    console.log(`\nChecked ${outcome.checked}, ${outcome.new} newly cached, ${outcome.transitions.length} transitions, ${outcome.notified} alerts sent.`);
    for (const t of outcome.transitions) console.log(`  ${t.name}: ${t.from ?? 'new'} → ${t.to}${t.reason ? ` (${t.reason})` : ''}`);
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
