/**
 * Backfill Script: Create Leads from Calls
 *
 * This script finds all calls that don't have an associated lead,
 * creates leads from the call data, and links them.
 *
 * Run with: npx tsx scripts/backfill-leads-from-calls.ts
 *
 * Options:
 *   --dry-run    Preview changes without making them
 *   --limit=N    Process only N calls (for testing)
 */

import { db } from '../server/db';
import { calls, leads } from '../shared/schema';
import { eq, isNull, desc, and, isNotNull } from 'drizzle-orm';
import { findDuplicateLead } from '../server/lead-deduplication';
import { normalizePhoneNumber } from '../server/phone-utils';

interface BackfillStats {
    totalCalls: number;
    callsWithoutLeads: number;
    leadsCreated: number;
    leadsLinkedExisting: number;
    errors: number;
    skipped: number;
}

async function backfillLeadsFromCalls(options: { dryRun?: boolean; limit?: number } = {}) {
    const { dryRun = false, limit } = options;

    console.log('='.repeat(60));
    console.log('BACKFILL: Create Leads from Calls');
    console.log('='.repeat(60));
    console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
    if (limit) console.log(`Limit: ${limit} calls`);
    console.log('');

    const stats: BackfillStats = {
        totalCalls: 0,
        callsWithoutLeads: 0,
        leadsCreated: 0,
        leadsLinkedExisting: 0,
        errors: 0,
        skipped: 0,
    };

    try {
        // 1. Get all calls
        const allCalls = await db.select().from(calls).orderBy(desc(calls.startTime));
        stats.totalCalls = allCalls.length;
        console.log(`Total calls in database: ${stats.totalCalls}`);

        // 2. Filter to calls without leadId
        const callsWithoutLeads = allCalls.filter(call => !call.leadId);
        stats.callsWithoutLeads = callsWithoutLeads.length;
        console.log(`Calls without leads: ${stats.callsWithoutLeads}`);
        console.log('');

        // Apply limit if specified
        const callsToProcess = limit ? callsWithoutLeads.slice(0, limit) : callsWithoutLeads;
        console.log(`Processing ${callsToProcess.length} calls...`);
        console.log('-'.repeat(60));

        // 3. Process each call
        for (const call of callsToProcess) {
            try {
                // Skip if no phone number
                if (!call.phoneNumber) {
                    console.log(`[SKIP] Call ${call.id}: No phone number`);
                    stats.skipped++;
                    continue;
                }

                const normalizedPhone = normalizePhoneNumber(call.phoneNumber);
                if (!normalizedPhone) {
                    console.log(`[SKIP] Call ${call.id}: Could not normalize phone ${call.phoneNumber}`);
                    stats.skipped++;
                    continue;
                }

                // Check for existing lead
                const duplicateCheck = await findDuplicateLead(normalizedPhone, {
                    customerName: call.customerName,
                    postcode: call.postcode,
                });

                let leadId: string;

                if (duplicateCheck.isDuplicate && duplicateCheck.existingLead) {
                    // Link to existing lead
                    leadId = duplicateCheck.existingLead.id;
                    console.log(`[LINK] Call ${call.id} → Existing Lead ${leadId} (${duplicateCheck.matchReason})`);
                    stats.leadsLinkedExisting++;
                } else {
                    // Create new lead
                    leadId = `lead_backfill_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                    const leadData = {
                        id: leadId,
                        customerName: call.customerName || 'Unknown Caller',
                        phone: normalizedPhone,
                        email: call.email || null,
                        source: 'call_backfill',
                        jobDescription: call.jobSummary || call.transcription?.substring(0, 500) || 'From call - no transcript',
                        postcode: call.postcode || null,
                        addressRaw: call.address || null,
                        status: call.outcome === 'completed' ? 'contacted' : 'new',
                    };

                    if (!dryRun) {
                        await db.insert(leads).values(leadData);
                    }

                    console.log(`[CREATE] Lead ${leadId} for Call ${call.id} (${call.customerName || 'Unknown'})`);
                    stats.leadsCreated++;
                }

                // Update call with leadId
                if (!dryRun) {
                    await db.update(calls)
                        .set({ leadId })
                        .where(eq(calls.id, call.id));
                }

            } catch (error: any) {
                console.error(`[ERROR] Call ${call.id}: ${error.message}`);
                stats.errors++;
            }
        }

        // 4. Summary
        console.log('');
        console.log('='.repeat(60));
        console.log('SUMMARY');
        console.log('='.repeat(60));
        console.log(`Total calls:           ${stats.totalCalls}`);
        console.log(`Calls without leads:   ${stats.callsWithoutLeads}`);
        console.log(`Leads created:         ${stats.leadsCreated}`);
        console.log(`Linked to existing:    ${stats.leadsLinkedExisting}`);
        console.log(`Skipped:               ${stats.skipped}`);
        console.log(`Errors:                ${stats.errors}`);
        console.log('');

        if (dryRun) {
            console.log('DRY RUN COMPLETE - No changes made');
            console.log('Run without --dry-run to apply changes');
        } else {
            console.log('BACKFILL COMPLETE');
        }

        return stats;

    } catch (error) {
        console.error('Fatal error during backfill:', error);
        throw error;
    }
}

// Also backfill quotes that don't have leads
async function backfillLeadsFromQuotes(options: { dryRun?: boolean; limit?: number } = {}) {
    const { dryRun = false, limit } = options;

    console.log('');
    console.log('='.repeat(60));
    console.log('BACKFILL: Link Orphaned Quotes to Leads');
    console.log('='.repeat(60));

    const { personalizedQuotes } = await import('../shared/schema');

    // Get quotes without leadId
    const orphanedQuotes = await db.select()
        .from(personalizedQuotes)
        .where(isNull(personalizedQuotes.leadId))
        .orderBy(desc(personalizedQuotes.createdAt));

    console.log(`Orphaned quotes found: ${orphanedQuotes.length}`);

    const quotesToProcess = limit ? orphanedQuotes.slice(0, limit) : orphanedQuotes;
    let linked = 0;
    let created = 0;
    let errors = 0;

    for (const quote of quotesToProcess) {
        try {
            if (!quote.phone) {
                console.log(`[SKIP] Quote ${quote.id}: No phone`);
                continue;
            }

            const normalizedPhone = normalizePhoneNumber(quote.phone);
            if (!normalizedPhone) {
                console.log(`[SKIP] Quote ${quote.id}: Could not normalize phone`);
                continue;
            }

            // Check for existing lead
            const duplicateCheck = await findDuplicateLead(normalizedPhone, {
                customerName: quote.customerName,
                postcode: quote.postcode,
            });

            let leadId: string;

            if (duplicateCheck.isDuplicate && duplicateCheck.existingLead) {
                leadId = duplicateCheck.existingLead.id;
                console.log(`[LINK] Quote ${quote.shortSlug} → Existing Lead ${leadId}`);
                linked++;
            } else {
                leadId = `lead_quote_backfill_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                if (!dryRun) {
                    await db.insert(leads).values({
                        id: leadId,
                        customerName: quote.customerName || 'Unknown',
                        phone: normalizedPhone,
                        email: quote.email || null,
                        source: 'quote_backfill',
                        jobDescription: quote.jobDescription || 'From quote',
                        postcode: quote.postcode || null,
                        addressRaw: quote.address || null,
                        status: quote.depositPaidAt ? 'converted' : 'quote_sent',
                    });
                }

                console.log(`[CREATE] Lead ${leadId} for Quote ${quote.shortSlug}`);
                created++;
            }

            // Update quote with leadId
            if (!dryRun) {
                await db.update(personalizedQuotes)
                    .set({ leadId })
                    .where(eq(personalizedQuotes.id, quote.id));
            }

        } catch (error: any) {
            console.error(`[ERROR] Quote ${quote.id}: ${error.message}`);
            errors++;
        }
    }

    console.log('');
    console.log('Quote Backfill Summary:');
    console.log(`  Linked to existing: ${linked}`);
    console.log(`  Leads created:      ${created}`);
    console.log(`  Errors:             ${errors}`);
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : undefined;

// Run the backfill
(async () => {
    try {
        await backfillLeadsFromCalls({ dryRun, limit });
        await backfillLeadsFromQuotes({ dryRun, limit });
        process.exit(0);
    } catch (error) {
        console.error('Backfill failed:', error);
        process.exit(1);
    }
})();
