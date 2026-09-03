/**
 * P13b: back-fill a job pack for a quote that was booked before the pack existed
 * (docs/comms-build/BRIEF-P13b-backfill-mj.md).
 *
 *   npx tsx scripts/_backfill-job-pack.ts <slug|quote_id>                 # dry run: prints the pack it WOULD write
 *   npx tsx scripts/_backfill-job-pack.ts <slug> --apply                  # upserts job_packs (unique on quote_id), locks when the booking is accepted
 *   npx tsx scripts/_backfill-job-pack.ts <slug> --apply --notify         # + the job_pack_ready contractor notice (window / template / Ben's queue)
 *   npx tsx scripts/_backfill-job-pack.ts <slug> --conversation <id> --booking <id> --by <name>
 *
 * Read-only until --apply. Sources: the quote's pricing_line_items, quote_estimates (if any), the
 * thread (evidence + photos per line, the delivery answers by the P13 filing rules over every
 * inbound), the booking (lock) and the dispatch if one exists. Nothing is invented: a field with no
 * source stays empty and lands in `missing`. Idempotent: a second --apply updates the same row and
 * appends one change-log row. Never touches app_settings, never sends without --notify.
 */
import 'dotenv/config';
import { buildBackfillPack, loadBackfillSources, notifyJobPackReadyForBooking, renderBackfillReport } from '../server/spine/job-pack-backfill';

function flag(argv: string[], name: string): string | null {
    const i = argv.indexOf(name);
    return i >= 0 ? String(argv[i + 1] ?? '') || null : null;
}

async function main() {
    const argv = process.argv.slice(2);
    const slug = argv.find((a) => !a.startsWith('--') && !['--conversation', '--booking', '--by'].includes(argv[argv.indexOf(a) - 1] ?? ''));
    if (!slug) {
        console.error('usage: npx tsx scripts/_backfill-job-pack.ts <slug|quote_id> [--apply] [--notify] [--conversation <id>] [--booking <id>] [--by <name>]');
        process.exit(2);
    }
    const apply = argv.includes('--apply');
    const notify = argv.includes('--notify');
    if (notify && !apply) { console.error('--notify needs --apply: the link would open an empty page.'); process.exit(2); }
    const by = `script:backfill:${flag(argv, '--by') ?? process.env.USER ?? 'unknown'}`;
    const now = new Date();

    const src = await loadBackfillSources(slug, { conversationId: flag(argv, '--conversation'), bookingId: flag(argv, '--booking') });
    console.log(`quote ${src.quote.slug} (${src.quote.id}) · ${src.quote.customerName} · ${src.quote.postcode ?? 'no postcode'} · deposit ${src.quote.depositPaidAt ?? 'unpaid'}`);
    console.log(`conversation ${src.conversationId ?? 'NONE (no customer thread matched the quote phone)'} · ${src.thread.messages.length} messages (${src.thread.messages.filter((m) => m.direction === 'in').length} in, ${src.thread.messages.filter((m) => m.media).length} media)`);
    console.log(`estimate ${src.estimate ? `${src.estimate.id} (${src.estimate.status})` : 'none (quote predates Route A)'}`);
    console.log(`booking ${src.booking ? `${src.booking.id} · ${src.booking.status} / ${src.booking.assignmentStatus ?? 'unassigned'} · ${src.booking.scheduledDate ?? 'no date'} · contractor ${src.contractor?.name ?? src.booking.contractorId ?? 'none'} (${src.contractor?.phone ?? 'no phone'})` : 'NONE'}`);
    console.log(`dispatch ${src.dispatch ? `${src.dispatch.id} (${src.dispatch.linkTokens.length} links)` : 'none'} · existing pack ${src.existing ? src.existing.id : 'none'}`);
    if (!src.packTablePresent) {
        console.log('\n⚠ job_packs table is NOT present here: apply migrations/20260906_job_packs.sql first (npx tsx scripts/_apply-migration.ts migrations/20260906_job_packs.sql).');
        if (apply) { console.error('Refusing --apply without the table.'); process.exit(2); }
    }
    console.log('');

    const result = buildBackfillPack({ ...src, by, now });
    console.log(renderBackfillReport(result, { mode: apply ? 'apply' : 'dry-run' }));

    if (!apply) {
        console.log('\n(dry run: nothing written. Re-run with --apply to write it.)');
        process.exit(0);
    }

    const { savePack } = await import('../server/spine/job-pack');
    await savePack(result.pack);
    console.log(`\nwritten: job_packs ${result.pack.id} for quote ${result.pack.quoteId} (${result.created ? 'inserted' : 'updated'}, ${result.appended.length} change-log row${result.appended.length === 1 ? '' : 's'} appended${result.locked ? `, locked: ${result.lockRef}` : ''})`);
    if (result.frozenConflicts.length) console.log(`NOT written (locked line fields): ${result.frozenConflicts.join(', ')} — use the variation path`);

    if (notify) {
        if (!src.booking) { console.log('notify: no booking, nothing to send'); }
        else if (src.dispatch) {
            const { notifyJobPackReady } = await import('../server/spine/job-pack-notify');
            const out = await notifyJobPackReady({ dispatchId: src.dispatch.id, title: src.dispatch.title, postcode: src.dispatch.postcode, scheduledDate: src.dispatch.scheduledDate, customer: { firstName: src.quote.customerName.split(/\s+/)[0], fullName: src.quote.customerName } });
            console.log(`notify (dispatch ${src.dispatch.id}): ${out.map((o) => `${o.phone || '?'} ${o.mode} ${o.reason}${o.draftId ? ` draft ${o.draftId}` : ''}`).join('; ') || 'no contractors on the dispatch'}`);
        } else if (!src.contractor) { console.log('notify: the booking has no contractor profile, nothing to send'); }
        else {
            const { liveNotifyDeps } = await import('../server/spine/job-pack-notify');
            const out = await notifyJobPackReadyForBooking({
                bookingId: src.booking.id, contractor: src.contractor, lines: result.pack.lines, postcode: src.quote.postcode, scheduledDate: src.booking.scheduledDate,
                customer: { firstName: src.quote.customerName.split(/\s+/)[0], fullName: src.quote.customerName },
            }, await liveNotifyDeps());
            console.log(`notify (booking ${src.booking.id} → ${src.contractor.name ?? src.contractor.id}): ${out.mode} ${out.reason}${out.draftId ? ` draft ${out.draftId}` : ''}`);
        }
    }

    console.log(`\n${result.summary}`);
    if (result.urls.length) console.log(`open: ${result.urls.join('  ')}`);
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
