/**
 * PROPERTIES BACKFILL — populate service_properties + link the spine.
 *
 * Builds a property row per distinct physical location from existing quote/lead
 * address data, then stamps property_id onto personalized_quotes and propagates
 * it down the spine to contractor_booking_requests (jobs) and invoices.
 *
 * Identity comes from server/properties.ts (the SAME key the live write paths
 * use), so history and new rows resolve to the same property.
 *
 *   npx tsx scripts/properties-backfill.ts           # dry-run (no writes)
 *   npx tsx scripts/properties-backfill.ts --apply    # write
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import { propertyDedupeKey, resolveOrCreateProperty } from '../server/properties';

const apply = process.argv.includes('--apply');
const rows = (r: any) => r.rows ?? r;

(async () => {
    const qs = rows(await db.execute(sql`
        SELECT q.id, q.phone, q.email, q.address, q.postcode, q.coordinates, q.property_id,
               l.address AS l_address, l.address_canonical AS l_addr_canon,
               l.postcode AS l_postcode, l.coordinates AS l_coords, l.place_id AS l_place
        FROM personalized_quotes q
        LEFT JOIN leads l ON q.lead_id = l.id`));

    const keyTypes: Record<string, number> = {};
    const keyset = new Set<string>();
    let resolvable = 0, skipped = 0, qUpd = 0;

    console.log(`=== PROPERTIES BACKFILL ${apply ? '(APPLY)' : '(DRY-RUN)'} ===`);
    console.log(`scanning ${qs.length} quotes…\n`);

    for (const q of qs) {
        const input = {
            placeId: q.l_place,
            address: q.address || q.l_addr_canon || q.l_address,
            coordinates: q.coordinates || q.l_coords,
            postcode: q.postcode || q.l_postcode,
            phone: q.phone,
            email: q.email,
        };
        const key = propertyDedupeKey(input);
        if (!key) { skipped++; continue; }
        resolvable++;
        keyset.add(key);
        const t = key.split(':')[0];
        keyTypes[t] = (keyTypes[t] || 0) + 1;

        if (apply) {
            const pid = await resolveOrCreateProperty(db, input);
            if (pid) {
                await db.execute(sql`UPDATE personalized_quotes SET property_id=${pid} WHERE id=${q.id} AND property_id IS NULL`);
                qUpd++;
            }
        }
    }

    console.log(`quotes resolvable = ${resolvable}, skipped (no address signal) = ${skipped}`);
    console.log(`distinct properties (by key) = ${keyset.size}`);
    console.log(`key types =`, keyTypes, '(addr=text, geo=coords@4dp, pc=postcode)\n');

    if (!apply) {
        console.log('DRY-RUN — nothing written. Re-run with --apply to commit.');
        process.exit(0);
    }

    const cbrRes = await db.execute(sql`
        UPDATE contractor_booking_requests cbr SET property_id = q.property_id
        FROM personalized_quotes q
        WHERE cbr.quote_id = q.id AND q.property_id IS NOT NULL AND cbr.property_id IS NULL`);
    const invRes = await db.execute(sql`
        UPDATE invoices i SET property_id = q.property_id
        FROM personalized_quotes q
        WHERE i.quote_id = q.id AND q.property_id IS NOT NULL AND i.property_id IS NULL`);

    const propN = rows(await db.execute(sql`SELECT count(*) n FROM service_properties`))[0]?.n;
    const qN = rows(await db.execute(sql`SELECT count(*) n FROM personalized_quotes WHERE property_id IS NOT NULL`))[0]?.n;
    const cbrN = rows(await db.execute(sql`SELECT count(*) n FROM contractor_booking_requests WHERE property_id IS NOT NULL`))[0]?.n;
    const invN = rows(await db.execute(sql`SELECT count(*) n FROM invoices WHERE property_id IS NOT NULL`))[0]?.n;

    console.log(`\nAPPLIED:`);
    console.log(`  service_properties rows = ${propN}`);
    console.log(`  quotes linked   = ${qN} (this run: ${qUpd})`);
    console.log(`  jobs (CBR) linked = ${cbrN} (this run: ${(cbrRes as any).rowCount ?? '?'})`);
    console.log(`  invoices linked = ${invN} (this run: ${(invRes as any).rowCount ?? '?'})`);
    process.exit(0);
})().catch((e) => { console.error('BACKFILL ERR', e?.stack || e?.message || e); process.exit(1); });
