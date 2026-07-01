/**
 * CLIENTS BACKFILL — populate service_clients + link the spine.
 *
 * Builds one client row per distinct CANONICAL contact (UK-phone-canonicalized,
 * else email) from existing leads/quotes/jobs/invoices, then stamps client_id
 * onto every spine row and onto service_properties.
 *
 * Identity comes from server/clients.ts (the SAME key the live write paths use),
 * so history and new rows resolve to the same client — and the old "07766 vs
 * 7766" split collapses into ONE client.
 *
 *   npx tsx scripts/clients-backfill.ts           # dry-run (no writes)
 *   npx tsx scripts/clients-backfill.ts --apply    # write
 */
import { db } from '../server/db';
import { sql } from 'drizzle-orm';
import { clientDedupeKey, resolveOrCreateClient } from '../server/clients';

const apply = process.argv.includes('--apply');
const rows = (r: any) => r.rows ?? r;

interface Contact { name?: string | null; phone?: string | null; email?: string | null; address?: string | null; }

(async () => {
    console.log(`=== CLIENTS BACKFILL ${apply ? '(APPLY)' : '(DRY-RUN)'} ===`);

    // 1. Gather every contact across the spine.
    const leadRows = rows(await db.execute(sql`SELECT id, customer_name AS name, phone, email, address FROM leads`));
    const quoteRows = rows(await db.execute(sql`SELECT id, customer_name AS name, phone, email, address FROM personalized_quotes`));
    const jobRows = rows(await db.execute(sql`SELECT id, customer_name AS name, customer_phone AS phone, customer_email AS email FROM contractor_booking_requests`));
    const invRows = rows(await db.execute(sql`SELECT id, customer_name AS name, customer_phone AS phone, customer_email AS email, customer_address AS address FROM invoices`));

    // 2. Resolve each table's rows to a client key + collect best contact per key.
    const byKey = new Map<string, Contact>();
    let skipped = 0;
    const tally = (c: Contact) => {
        const key = clientDedupeKey({ phone: c.phone, email: c.email });
        if (!key) { skipped++; return null; }
        const existing = byKey.get(key);
        if (!existing) byKey.set(key, { ...c });
        else {
            if (!existing.name && c.name) existing.name = c.name;
            if (!existing.email && c.email) existing.email = c.email;
            if (!existing.phone && c.phone) existing.phone = c.phone;
            if (!(existing as any).address && (c as any).address) (existing as any).address = (c as any).address;
        }
        return key;
    };
    for (const r of leadRows) tally(r);
    for (const r of quoteRows) tally(r);
    for (const r of jobRows) tally(r);
    for (const r of invRows) tally(r);

    console.log(`scanned ${leadRows.length} leads, ${quoteRows.length} quotes, ${jobRows.length} jobs, ${invRows.length} invoices`);
    console.log(`distinct clients (by canonical key) = ${byKey.size}, contacts skipped (no signal) = ${skipped}`);
    const phoneKeys = [...byKey.keys()].filter((k) => k.startsWith('phone:')).length;
    console.log(`key types = phone:${phoneKeys} email:${byKey.size - phoneKeys}\n`);

    if (!apply) {
        console.log('DRY-RUN — nothing written. Re-run with --apply to commit.');
        process.exit(0);
    }

    // 3. Create the client rows.
    const keyToId = new Map<string, string>();
    for (const [key, c] of byKey) {
        const id = await resolveOrCreateClient(db, {
            phone: c.phone, email: c.email, displayName: c.name, billingAddress: (c as any).address,
        });
        if (id) keyToId.set(key, id);
    }
    console.log(`service_clients rows created/resolved = ${keyToId.size}`);

    // 4. Stamp client_id onto each spine row (only where NULL).
    const stamp = async (table: string, contacts: any[]) => {
        let n = 0;
        for (const r of contacts) {
            const key = clientDedupeKey({ phone: r.phone, email: r.email });
            if (!key) continue;
            const cid = keyToId.get(key);
            if (!cid) continue;
            const res: any = await db.execute(sql`
                UPDATE ${sql.identifier(table)} SET client_id = ${cid}
                WHERE id = ${r.id} AND client_id IS NULL`);
            n += res.rowCount ?? 0;
        }
        return n;
    };
    const lUpd = await stamp('leads', leadRows);
    const qUpd = await stamp('personalized_quotes', quoteRows);
    const jUpd = await stamp('contractor_booking_requests', jobRows);
    const iUpd = await stamp('invoices', invRows);

    // 5. Link service_properties.client_id from its existing client_key (legacy
    //    heuristic) by re-resolving through the canonical client key. The
    //    property carries phone/email indirectly via client_key "phone:<digits>".
    const propRows = rows(await db.execute(sql`SELECT id, client_key FROM service_properties WHERE client_key IS NOT NULL`));
    let pUpd = 0;
    for (const p of propRows) {
        const ck: string = p.client_key;
        const phone = ck.startsWith('phone:') ? ck.slice(6) : null;
        const email = ck.startsWith('email:') ? ck.slice(6) : null;
        const key = clientDedupeKey({ phone, email });
        if (!key) continue;
        const cid = keyToId.get(key);
        if (!cid) continue;
        const res: any = await db.execute(sql`
            UPDATE service_properties SET client_id = ${cid}
            WHERE id = ${p.id} AND client_id IS NULL`);
        pUpd += res.rowCount ?? 0;
    }

    console.log(`\nAPPLIED:`);
    console.log(`  leads linked      = ${lUpd}`);
    console.log(`  quotes linked     = ${qUpd}`);
    console.log(`  jobs (CBR) linked = ${jUpd}`);
    console.log(`  invoices linked   = ${iUpd}`);
    console.log(`  properties linked = ${pUpd}`);
    process.exit(0);
})().catch((e) => { console.error('BACKFILL ERR', e?.stack || e?.message || e); process.exit(1); });
