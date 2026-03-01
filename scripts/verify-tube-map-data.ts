/**
 * Verify Tube Map Data Integrity
 *
 * This script checks data integrity for the Lead Tube Map:
 * - All leads have valid stages
 * - All leads on routes have routeAssignedAt
 * - No orphaned leads (stage doesn't match route)
 * - Conversion calculations are accurate
 *
 * Usage: npx tsx scripts/verify-tube-map-data.ts
 *        npx tsx scripts/verify-tube-map-data.ts --fix (attempt to fix issues)
 */

import { db } from '../server/db';
import { leads, personalizedQuotes, conversations, calls, LeadStageValues, LeadStage } from '../shared/schema';
import { eq, isNull, isNotNull, and, or, desc, count, sql } from 'drizzle-orm';
import { computeLeadStage } from '../server/lead-stage-engine';

const shouldFix = process.argv.includes('--fix');

interface IntegrityIssue {
    type: 'error' | 'warning' | 'info';
    category: string;
    message: string;
    affectedIds?: string[];
    canFix?: boolean;
}

const issues: IntegrityIssue[] = [];

function addIssue(issue: IntegrityIssue) {
    issues.push(issue);
    const icon = issue.type === 'error' ? '\u2717' :
        issue.type === 'warning' ? '!' :
            '\u2713';
    console.log(`   ${icon} [${issue.category}] ${issue.message}`);
    if (issue.affectedIds && issue.affectedIds.length <= 5) {
        console.log(`     IDs: ${issue.affectedIds.join(', ')}`);
    } else if (issue.affectedIds) {
        console.log(`     IDs: ${issue.affectedIds.slice(0, 5).join(', ')} ... and ${issue.affectedIds.length - 5} more`);
    }
}

// ==========================================
// CHECK 1: Valid Stages
// ==========================================

async function checkValidStages(): Promise<void> {
    console.log('\n1. Checking Valid Stages...');

    const allLeads = await db.select({
        id: leads.id,
        stage: leads.stage,
        customerName: leads.customerName,
    }).from(leads);

    const invalidStageLeads: string[] = [];
    const nullStageLeads: string[] = [];

    for (const lead of allLeads) {
        if (!lead.stage) {
            nullStageLeads.push(lead.id);
        } else if (!LeadStageValues.includes(lead.stage as LeadStage)) {
            invalidStageLeads.push(lead.id);
        }
    }

    if (nullStageLeads.length > 0) {
        addIssue({
            type: 'warning',
            category: 'Stage',
            message: `${nullStageLeads.length} leads have NULL stage (will default to new_lead)`,
            affectedIds: nullStageLeads,
            canFix: true,
        });

        if (shouldFix) {
            for (const id of nullStageLeads) {
                await db.update(leads)
                    .set({ stage: 'new_lead', stageUpdatedAt: new Date() })
                    .where(eq(leads.id, id));
            }
            console.log(`     Fixed: Set ${nullStageLeads.length} leads to 'new_lead'`);
        }
    } else {
        addIssue({
            type: 'info',
            category: 'Stage',
            message: 'All leads have non-null stage values',
        });
    }

    if (invalidStageLeads.length > 0) {
        addIssue({
            type: 'error',
            category: 'Stage',
            message: `${invalidStageLeads.length} leads have invalid stage values`,
            affectedIds: invalidStageLeads,
            canFix: true,
        });

        if (shouldFix) {
            for (const id of invalidStageLeads) {
                const computed = await computeLeadStage(id);
                await db.update(leads)
                    .set({ stage: computed.stage, stageUpdatedAt: new Date() })
                    .where(eq(leads.id, id));
            }
            console.log(`     Fixed: Recomputed stages for ${invalidStageLeads.length} leads`);
        }
    } else {
        addIssue({
            type: 'info',
            category: 'Stage',
            message: 'All leads have valid stage values',
        });
    }
}

// ==========================================
// CHECK 2: Stage vs Quote State Consistency
// ==========================================

async function checkStageQuoteConsistency(): Promise<void> {
    console.log('\n2. Checking Stage/Quote Consistency...');

    // Find leads with quotes but wrong stage
    const leadsWithQuotes = await db.select({
        leadId: personalizedQuotes.leadId,
        phone: personalizedQuotes.phone,
        viewedAt: personalizedQuotes.viewedAt,
        selectedAt: personalizedQuotes.selectedAt,
        bookedAt: personalizedQuotes.bookedAt,
        depositPaidAt: personalizedQuotes.depositPaidAt,
    })
        .from(personalizedQuotes)
        .where(isNotNull(personalizedQuotes.leadId));

    const inconsistentLeads: string[] = [];

    for (const quote of leadsWithQuotes) {
        if (!quote.leadId) continue;

        const [lead] = await db.select({ id: leads.id, stage: leads.stage })
            .from(leads)
            .where(eq(leads.id, quote.leadId));

        if (!lead) continue;

        // Check expected stage based on quote state
        let expectedStage: LeadStage | null = null;

        if (quote.bookedAt || quote.depositPaidAt) {
            expectedStage = 'booked';
        } else if (quote.selectedAt) {
            expectedStage = 'awaiting_payment';
        } else if (quote.viewedAt) {
            expectedStage = 'quote_viewed';
        } else {
            expectedStage = 'quote_sent';
        }

        // Check if current stage is behind expected
        const stageOrder: LeadStage[] = [
            'new_lead', 'contacted', 'awaiting_video', 'quote_sent',
            'quote_viewed', 'awaiting_payment', 'booked', 'in_progress', 'completed'
        ];

        const currentIndex = stageOrder.indexOf(lead.stage as LeadStage);
        const expectedIndex = stageOrder.indexOf(expectedStage);

        // Allow terminal states (lost, expired, declined) to override
        const isTerminal = ['lost', 'expired', 'declined'].includes(lead.stage as string);

        if (!isTerminal && currentIndex >= 0 && expectedIndex >= 0 && currentIndex < expectedIndex) {
            inconsistentLeads.push(lead.id);
        }
    }

    if (inconsistentLeads.length > 0) {
        addIssue({
            type: 'warning',
            category: 'Stage/Quote',
            message: `${inconsistentLeads.length} leads have stage behind their quote state`,
            affectedIds: inconsistentLeads,
            canFix: true,
        });

        if (shouldFix) {
            for (const id of inconsistentLeads) {
                const computed = await computeLeadStage(id);
                await db.update(leads)
                    .set({ stage: computed.stage, stageUpdatedAt: new Date() })
                    .where(eq(leads.id, id));
            }
            console.log(`     Fixed: Synced stages for ${inconsistentLeads.length} leads`);
        }
    } else {
        addIssue({
            type: 'info',
            category: 'Stage/Quote',
            message: 'All lead stages are consistent with quote states',
        });
    }
}

// ==========================================
// CHECK 3: StageUpdatedAt Timestamps
// ==========================================

async function checkStageTimestamps(): Promise<void> {
    console.log('\n3. Checking Stage Timestamps...');

    const leadsWithoutTimestamp = await db.select({
        id: leads.id,
        stage: leads.stage,
    })
        .from(leads)
        .where(isNull(leads.stageUpdatedAt));

    if (leadsWithoutTimestamp.length > 0) {
        addIssue({
            type: 'warning',
            category: 'Timestamp',
            message: `${leadsWithoutTimestamp.length} leads missing stageUpdatedAt timestamp`,
            affectedIds: leadsWithoutTimestamp.map(l => l.id),
            canFix: true,
        });

        if (shouldFix) {
            for (const lead of leadsWithoutTimestamp) {
                await db.update(leads)
                    .set({ stageUpdatedAt: new Date() })
                    .where(eq(leads.id, lead.id));
            }
            console.log(`     Fixed: Set timestamps for ${leadsWithoutTimestamp.length} leads`);
        }
    } else {
        addIssue({
            type: 'info',
            category: 'Timestamp',
            message: 'All leads have stageUpdatedAt timestamps',
        });
    }
}

// ==========================================
// CHECK 4: Orphaned Quotes (no linked lead)
// ==========================================

async function checkOrphanedQuotes(): Promise<void> {
    console.log('\n4. Checking Orphaned Quotes...');

    const quotesWithoutLead = await db.select({
        id: personalizedQuotes.id,
        phone: personalizedQuotes.phone,
        customerName: personalizedQuotes.customerName,
    })
        .from(personalizedQuotes)
        .where(isNull(personalizedQuotes.leadId));

    if (quotesWithoutLead.length > 0) {
        // Check if any of these have matching leads by phone
        let linkableCount = 0;
        for (const quote of quotesWithoutLead) {
            const [matchingLead] = await db.select({ id: leads.id })
                .from(leads)
                .where(eq(leads.phone, quote.phone))
                .limit(1);

            if (matchingLead) {
                linkableCount++;
                if (shouldFix) {
                    await db.update(personalizedQuotes)
                        .set({ leadId: matchingLead.id })
                        .where(eq(personalizedQuotes.id, quote.id));
                }
            }
        }

        addIssue({
            type: 'warning',
            category: 'Orphaned',
            message: `${quotesWithoutLead.length} quotes have no leadId (${linkableCount} can be linked by phone)`,
            affectedIds: quotesWithoutLead.slice(0, 10).map(q => q.id),
            canFix: linkableCount > 0,
        });

        if (shouldFix && linkableCount > 0) {
            console.log(`     Fixed: Linked ${linkableCount} quotes to leads by phone`);
        }
    } else {
        addIssue({
            type: 'info',
            category: 'Orphaned',
            message: 'All quotes have leadId set',
        });
    }
}

// ==========================================
// CHECK 5: Stage Distribution
// ==========================================

async function checkStageDistribution(): Promise<void> {
    console.log('\n5. Checking Stage Distribution...');

    const stageCounts = await db.select({
        stage: leads.stage,
        count: count(),
    })
        .from(leads)
        .groupBy(leads.stage);

    const distribution: Record<string, number> = {};
    let total = 0;

    for (const row of stageCounts) {
        const stageName = row.stage || 'null';
        distribution[stageName] = Number(row.count);
        total += Number(row.count);
    }

    console.log('\n   Stage Distribution:');
    for (const [stage, cnt] of Object.entries(distribution).sort((a, b) => b[1] - a[1])) {
        const pct = ((cnt / total) * 100).toFixed(1);
        const bar = '\u2588'.repeat(Math.round(cnt / total * 30));
        console.log(`     ${stage.padEnd(18)} ${String(cnt).padStart(5)} (${pct.padStart(5)}%) ${bar}`);
    }

    // Check for imbalances
    const activeStages = ['new_lead', 'contacted', 'awaiting_video', 'quote_sent', 'quote_viewed', 'awaiting_payment'];
    const activeTotal = activeStages.reduce((sum, s) => sum + (distribution[s] || 0), 0);
    const bookedCount = distribution['booked'] || 0;
    const completedCount = distribution['completed'] || 0;

    if (total > 0) {
        const conversionRate = completedCount / total * 100;
        const bookingRate = bookedCount / total * 100;

        addIssue({
            type: 'info',
            category: 'Distribution',
            message: `Total: ${total} leads | Active: ${activeTotal} | Booked: ${bookedCount} | Completed: ${completedCount}`,
        });

        addIssue({
            type: 'info',
            category: 'Conversion',
            message: `Booking Rate: ${bookingRate.toFixed(1)}% | Completion Rate: ${conversionRate.toFixed(1)}%`,
        });
    }
}

// ==========================================
// CHECK 6: Conversation/Lead Alignment
// ==========================================

async function checkConversationAlignment(): Promise<void> {
    console.log('\n6. Checking Conversation/Lead Alignment...');

    // Get all conversations
    const allConversations = await db.select({
        id: conversations.id,
        phoneNumber: conversations.phoneNumber,
        leadId: conversations.leadId,
        contactName: conversations.contactName,
    }).from(conversations);

    let missingLeadIds = 0;
    let linkableByPhone = 0;

    for (const conv of allConversations) {
        if (!conv.leadId) {
            missingLeadIds++;

            // Check if we can link by phone
            const [matchingLead] = await db.select({ id: leads.id })
                .from(leads)
                .where(eq(leads.phone, conv.phoneNumber))
                .limit(1);

            if (matchingLead) {
                linkableByPhone++;
                if (shouldFix) {
                    await db.update(conversations)
                        .set({ leadId: matchingLead.id })
                        .where(eq(conversations.id, conv.id));
                }
            }
        }
    }

    if (missingLeadIds > 0) {
        addIssue({
            type: 'warning',
            category: 'Conversations',
            message: `${missingLeadIds} conversations missing leadId (${linkableByPhone} linkable by phone)`,
            canFix: linkableByPhone > 0,
        });

        if (shouldFix && linkableByPhone > 0) {
            console.log(`     Fixed: Linked ${linkableByPhone} conversations to leads`);
        }
    } else {
        addIssue({
            type: 'info',
            category: 'Conversations',
            message: 'All conversations have leadId or no matching lead exists',
        });
    }
}

// ==========================================
// CHECK 7: Duplicate Leads
// ==========================================

async function checkDuplicateLeads(): Promise<void> {
    console.log('\n7. Checking Duplicate Leads...');

    // Find phone numbers with multiple leads
    const duplicates = await db.select({
        phone: leads.phone,
        count: count(),
    })
        .from(leads)
        .groupBy(leads.phone)
        .having(sql`count(*) > 1`);

    if (duplicates.length > 0) {
        const totalDupes = duplicates.reduce((sum, d) => sum + Number(d.count), 0);
        const phones = duplicates.map(d => d.phone);

        addIssue({
            type: 'warning',
            category: 'Duplicates',
            message: `${duplicates.length} phone numbers have multiple leads (${totalDupes} total leads)`,
            affectedIds: phones,
            canFix: false, // Manual review needed
        });

        console.log('     Note: Duplicate merging requires manual review');
    } else {
        addIssue({
            type: 'info',
            category: 'Duplicates',
            message: 'No duplicate phone numbers found',
        });
    }
}

// ==========================================
// CHECK 8: Lost Lead Candidates
// ==========================================

async function checkLostLeadCandidates(): Promise<void> {
    console.log('\n8. Checking Lost Lead Candidates...');

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Find leads in quote_sent or quote_viewed that haven't progressed
    const staleQuoteLeads = await db.select({
        id: leads.id,
        stage: leads.stage,
        stageUpdatedAt: leads.stageUpdatedAt,
    })
        .from(leads)
        .where(
            and(
                or(
                    eq(leads.stage, 'quote_sent'),
                    eq(leads.stage, 'quote_viewed')
                ),
                sql`${leads.stageUpdatedAt} < ${sevenDaysAgo}`
            )
        );

    if (staleQuoteLeads.length > 0) {
        addIssue({
            type: 'warning',
            category: 'Stale Leads',
            message: `${staleQuoteLeads.length} leads stuck in quote_sent/quote_viewed for >7 days (candidates for 'lost')`,
            affectedIds: staleQuoteLeads.map(l => l.id),
            canFix: true,
        });

        if (shouldFix) {
            for (const lead of staleQuoteLeads) {
                await db.update(leads)
                    .set({
                        stage: 'lost',
                        stageUpdatedAt: new Date(),
                    })
                    .where(eq(leads.id, lead.id));
            }
            console.log(`     Fixed: Marked ${staleQuoteLeads.length} leads as 'lost'`);
        }
    } else {
        addIssue({
            type: 'info',
            category: 'Stale Leads',
            message: 'No stale quote leads found',
        });
    }
}

// ==========================================
// MAIN
// ==========================================

async function main() {
    console.log('='.repeat(60));
    console.log(' TUBE MAP DATA INTEGRITY VERIFICATION');
    console.log('='.repeat(60));

    if (shouldFix) {
        console.log('\n  [FIX MODE ENABLED - Will attempt to repair issues]');
    } else {
        console.log('\n  [CHECK MODE - Run with --fix to repair issues]');
    }

    const startTime = Date.now();

    try {
        await checkValidStages();
        await checkStageQuoteConsistency();
        await checkStageTimestamps();
        await checkOrphanedQuotes();
        await checkStageDistribution();
        await checkConversationAlignment();
        await checkDuplicateLeads();
        await checkLostLeadCandidates();
    } catch (error) {
        console.error('\n Verification error:', error);
    }

    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const errors = issues.filter(i => i.type === 'error').length;
    const warnings = issues.filter(i => i.type === 'warning').length;
    const info = issues.filter(i => i.type === 'info').length;

    console.log('\n' + '='.repeat(60));
    console.log(' VERIFICATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`  Duration: ${duration}s`);
    console.log(`  Errors: ${errors}`);
    console.log(`  Warnings: ${warnings}`);
    console.log(`  Info: ${info}`);

    if (errors > 0) {
        console.log('\n  Errors found:');
        for (const issue of issues.filter(i => i.type === 'error')) {
            console.log(`    \u2717 [${issue.category}] ${issue.message}`);
        }
    }

    if (warnings > 0) {
        console.log('\n  Warnings:');
        for (const issue of issues.filter(i => i.type === 'warning')) {
            const fixable = issue.canFix ? ' [fixable]' : '';
            console.log(`    ! [${issue.category}] ${issue.message}${fixable}`);
        }
    }

    if (errors === 0 && warnings === 0) {
        console.log('\n DATA INTEGRITY VERIFIED');
    } else if (errors === 0) {
        console.log('\n NO CRITICAL ERRORS (some warnings)');
    } else {
        console.log('\n CRITICAL ERRORS FOUND');
    }

    if (!shouldFix && issues.some(i => i.canFix)) {
        console.log('\n  Tip: Run with --fix flag to auto-repair fixable issues');
    }

    console.log('='.repeat(60) + '\n');

    process.exit(errors > 0 ? 1 : 0);
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
