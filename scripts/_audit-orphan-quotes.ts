/**
 * A-WP3 READ-ONLY audit:
 *   1. Orphan quotes — personalized_quotes with null lead_id, plus candidate
 *      lead matches by (normalized) phone.
 *   2. Stage drift — leads whose stored leads.stage diverges from the
 *      computed stage (lead-stage-engine.computeLeadStage).
 *
 * NO WRITES. Backfill is a separate manual decision.
 *
 * Run: npx tsx scripts/_audit-orphan-quotes.ts
 */

import { db } from '../server/db';
import { leads, personalizedQuotes } from '../shared/schema';
import { desc, isNull } from 'drizzle-orm';
import { computeLeadStage } from '../server/lead-stage-engine';
import { normalizePhoneNumber } from '../server/phone-utils';

// Cap the stage-drift pass — computeLeadStage runs ~5 queries per lead.
const STAGE_DRIFT_LEAD_LIMIT = 200;

function normPhone(p: string | null | undefined): string {
    if (!p) return '';
    try {
        return normalizePhoneNumber(p) || p.replace(/\D/g, '');
    } catch {
        return p.replace(/\D/g, '');
    }
}

async function auditOrphanQuotes() {
    console.log('=== 1. ORPHAN QUOTES (lead_id IS NULL) + phone-match lead candidates ===\n');

    const orphans = await db.select({
        id: personalizedQuotes.id,
        shortSlug: personalizedQuotes.shortSlug,
        customerName: personalizedQuotes.customerName,
        phone: personalizedQuotes.phone,
        createdAt: personalizedQuotes.createdAt,
        bookedAt: personalizedQuotes.bookedAt,
        depositPaidAt: personalizedQuotes.depositPaidAt,
    })
        .from(personalizedQuotes)
        .where(isNull(personalizedQuotes.leadId))
        .orderBy(desc(personalizedQuotes.createdAt));

    console.log(`Orphan quotes: ${orphans.length}\n`);
    if (orphans.length === 0) return;

    // One pass over all leads, indexed by normalized phone.
    const allLeads = await db.select({
        id: leads.id,
        customerName: leads.customerName,
        phone: leads.phone,
        status: leads.status,
        stage: leads.stage,
        createdAt: leads.createdAt,
    }).from(leads);

    const leadsByPhone = new Map<string, typeof allLeads>();
    for (const lead of allLeads) {
        const key = normPhone(lead.phone);
        if (!key) continue;
        const arr = leadsByPhone.get(key) || [];
        arr.push(lead);
        leadsByPhone.set(key, arr);
    }

    let withCandidates = 0;
    for (const q of orphans) {
        const key = normPhone(q.phone);
        const candidates = key ? (leadsByPhone.get(key) || []) : [];
        const booked = q.depositPaidAt || q.bookedAt ? ' [BOOKED]' : '';
        console.log(`quote ${q.id} (${q.shortSlug || 'no-slug'}) — ${q.customerName} / ${q.phone} — created ${q.createdAt?.toISOString().slice(0, 10)}${booked}`);
        if (candidates.length > 0) {
            withCandidates++;
            for (const c of candidates) {
                console.log(`    ↳ candidate lead ${c.id} — ${c.customerName} / ${c.phone} — status=${c.status} stage=${c.stage} created=${c.createdAt?.toISOString().slice(0, 10)}`);
            }
        } else {
            console.log('    ↳ no phone-match lead candidates');
        }
    }
    console.log(`\n${withCandidates}/${orphans.length} orphan quotes have at least one phone-match lead candidate.\n`);
}

async function auditStageDrift() {
    console.log(`=== 2. STAGE DRIFT (stored leads.stage vs computed stage, most recent ${STAGE_DRIFT_LEAD_LIMIT} leads) ===\n`);

    const recentLeads = await db.select({
        id: leads.id,
        customerName: leads.customerName,
        phone: leads.phone,
        status: leads.status,
        stage: leads.stage,
        createdAt: leads.createdAt,
    })
        .from(leads)
        .orderBy(desc(leads.createdAt))
        .limit(STAGE_DRIFT_LEAD_LIMIT);

    let drifted = 0;
    let errors = 0;
    for (const lead of recentLeads) {
        try {
            const computed = await computeLeadStage(lead.id);
            const stored = lead.stage || 'new_lead';
            if (stored !== computed.stage) {
                drifted++;
                console.log(`lead ${lead.id} — ${lead.customerName} / ${lead.phone}`);
                console.log(`    stored: stage=${stored} (legacy status=${lead.status}) | computed: ${computed.stage} — ${computed.reason} [${computed.dataSource}]`);
            }
        } catch (e) {
            errors++;
            console.error(`lead ${lead.id} — computeLeadStage failed:`, e instanceof Error ? e.message : e);
        }
    }

    console.log(`\n${drifted}/${recentLeads.length} recent leads drift from their computed stage (${errors} errors).`);
    console.log('READ-ONLY report — nothing was written. Backfill is a separate manual decision.');
}

async function main() {
    await auditOrphanQuotes();
    await auditStageDrift();
    process.exit(0);
}

main().catch((e) => {
    console.error('Audit failed:', e);
    process.exit(1);
});
