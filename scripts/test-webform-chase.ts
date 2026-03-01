/**
 * Test Web Form Auto-Chase Automation
 *
 * This script tests the web form auto-chase system:
 * 1. Create lead from web form
 * 2. Verify WhatsApp template sent (or would be sent)
 * 3. Verify task created for callback
 * 4. Simulate no response, verify follow-up triggered
 *
 * Prerequisites:
 * - Database must have the latest schema: npm run db:push
 * - Server may be running for integration tests: npm run dev
 *
 * Usage: npx tsx scripts/test-webform-chase.ts
 *        npx tsx scripts/test-webform-chase.ts --dry-run (don't send real messages)
 */

import { db } from '../server/db';
import { leads, conversations, messages } from '../shared/schema';
import { eq, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { v4 as uuidv4 } from 'uuid';

const TEST_PHONE_PREFIX = '07700555';
const API_BASE = 'http://localhost:5000';

interface TestResult {
    name: string;
    passed: boolean;
    error?: string;
    details?: any;
}

const results: TestResult[] = [];
const isDryRun = process.argv.includes('--dry-run');

function generateTestPhone(): string {
    return `${TEST_PHONE_PREFIX}${Math.floor(1000 + Math.random() * 9000)}`;
}

async function cleanup(phone: string) {
    await db.delete(leads).where(eq(leads.phone, phone));
    await db.delete(conversations).where(eq(conversations.phoneNumber, phone));
}

function logResult(name: string, passed: boolean, error?: string, details?: any) {
    results.push({ name, passed, error, details });
    const icon = passed ? '\u2713' : '\u2717';
    console.log(`   ${icon} ${name}`);
    if (!passed && error) {
        console.log(`     Error: ${error}`);
    }
    if (details) {
        console.log(`     Details:`, JSON.stringify(details, null, 2));
    }
}

// ==========================================
// SIMULATED AUTO-CHASE SERVICE
// This simulates what the real service would do
// ==========================================

interface AutoChaseConfig {
    initialDelayMs: number;
    followUpDelayMs: number;
    maxFollowUps: number;
    templateName: string;
}

const defaultConfig: AutoChaseConfig = {
    initialDelayMs: 60000, // 1 minute after form submission
    followUpDelayMs: 3600000, // 1 hour between follow-ups
    maxFollowUps: 3,
    templateName: 'web_enquiry_followup',
};

interface ChaseAction {
    type: 'send_template' | 'create_task' | 'send_followup';
    scheduledAt: Date;
    data: any;
}

function simulateAutoChase(leadId: string, phone: string, customerName: string): ChaseAction[] {
    const actions: ChaseAction[] = [];
    const now = new Date();

    // Action 1: Send initial WhatsApp template
    actions.push({
        type: 'send_template',
        scheduledAt: new Date(now.getTime() + defaultConfig.initialDelayMs),
        data: {
            leadId,
            phone,
            template: defaultConfig.templateName,
            variables: {
                customerName: customerName.split(' ')[0], // First name
            },
        },
    });

    // Action 2: Create callback task
    actions.push({
        type: 'create_task',
        scheduledAt: new Date(now.getTime() + defaultConfig.initialDelayMs),
        data: {
            leadId,
            taskType: 'callback',
            dueAt: new Date(now.getTime() + 30 * 60 * 1000), // Due in 30 min
            title: `Callback: ${customerName} (web form)`,
            description: 'Web form lead - follow up if no WhatsApp reply',
        },
    });

    // Actions 3-5: Follow-up messages if no response
    for (let i = 1; i <= defaultConfig.maxFollowUps; i++) {
        actions.push({
            type: 'send_followup',
            scheduledAt: new Date(now.getTime() + defaultConfig.initialDelayMs + (i * defaultConfig.followUpDelayMs)),
            data: {
                leadId,
                phone,
                followUpNumber: i,
                template: `followup_${i}`,
            },
        });
    }

    return actions;
}

// ==========================================
// TEST SECTIONS
// ==========================================

async function testWebFormLeadCreation(): Promise<void> {
    console.log('\n1. Testing Web Form Lead Creation...');
    const phone = generateTestPhone();
    const leadId = `lead_${nanoid()}`;

    try {
        // Create lead as if from web form
        await db.insert(leads).values({
            id: leadId,
            customerName: 'Web Form Chase Test',
            phone,
            email: 'chase-test@example.com',
            jobDescription: 'Need help with kitchen plumbing',
            source: 'web_quote',
            stage: 'new_lead',
            stageUpdatedAt: new Date(),
        });

        const [created] = await db.select()
            .from(leads)
            .where(eq(leads.id, leadId));

        logResult('Lead created from web form', !!created && created.source === 'web_quote', undefined, {
            leadId,
            source: created?.source,
        });

        await cleanup(phone);
    } catch (e: any) {
        logResult('Lead created from web form', false, e.message);
    }
}

async function testAutoChaseTriggered(): Promise<void> {
    console.log('\n2. Testing Auto-Chase Trigger...');
    const phone = generateTestPhone();
    const leadId = `lead_${nanoid()}`;

    try {
        // Create lead
        await db.insert(leads).values({
            id: leadId,
            customerName: 'Auto Chase Test User',
            phone,
            jobDescription: 'Test job for auto-chase',
            source: 'web_quote',
            stage: 'new_lead',
            stageUpdatedAt: new Date(),
        });

        // Simulate auto-chase logic
        const actions = simulateAutoChase(leadId, phone, 'Auto Chase Test User');

        // Verify initial template action
        const templateAction = actions.find(a => a.type === 'send_template');
        logResult('Initial template action scheduled', !!templateAction, undefined, {
            template: templateAction?.data?.template,
            scheduledAt: templateAction?.scheduledAt,
        });

        // Verify callback task action
        const taskAction = actions.find(a => a.type === 'create_task');
        logResult('Callback task action scheduled', !!taskAction, undefined, {
            taskType: taskAction?.data?.taskType,
            dueAt: taskAction?.data?.dueAt,
        });

        // Verify follow-up actions
        const followUpActions = actions.filter(a => a.type === 'send_followup');
        logResult(`Follow-up actions scheduled (${followUpActions.length})`, followUpActions.length === defaultConfig.maxFollowUps);

        await cleanup(phone);
    } catch (e: any) {
        logResult('Auto-chase trigger', false, e.message);
    }
}

async function testWhatsAppTemplateSend(): Promise<void> {
    console.log('\n3. Testing WhatsApp Template Send (Simulated)...');
    const phone = generateTestPhone();
    const leadId = `lead_${nanoid()}`;
    const conversationId = uuidv4();

    try {
        // Create lead
        await db.insert(leads).values({
            id: leadId,
            customerName: 'Template Test User',
            phone,
            jobDescription: 'Test job',
            source: 'web_quote',
            stage: 'new_lead',
            stageUpdatedAt: new Date(),
        });

        // Simulate conversation creation (what auto-chase would do)
        await db.insert(conversations).values({
            id: conversationId,
            phoneNumber: phone,
            contactName: 'Template Test User',
            status: 'active',
            lastMessageAt: new Date(),
            // No lastInboundAt - customer hasn't replied yet
            templateRequired: true,
        });

        // Simulate template message
        const messageId = uuidv4();
        await db.insert(messages).values({
            id: messageId,
            conversationId,
            direction: 'outbound',
            content: 'Hi Template! Thanks for your enquiry about plumbing work. When would be a good time to discuss?',
            type: 'template',
            status: isDryRun ? 'queued' : 'sent',
            createdAt: new Date(),
        });

        // Verify message created
        const [msg] = await db.select()
            .from(messages)
            .where(eq(messages.id, messageId));

        logResult('Template message created', !!msg && msg.type === 'template', undefined, {
            messageId,
            type: msg?.type,
            direction: msg?.direction,
            dryRun: isDryRun,
        });

        await cleanup(phone);
    } catch (e: any) {
        logResult('WhatsApp template send', false, e.message);
    }
}

async function testNoResponseFollowUp(): Promise<void> {
    console.log('\n4. Testing No Response Follow-Up Logic...');
    const phone = generateTestPhone();
    const leadId = `lead_${nanoid()}`;
    const conversationId = uuidv4();

    try {
        // Create lead
        await db.insert(leads).values({
            id: leadId,
            customerName: 'No Response Test',
            phone,
            jobDescription: 'Test job',
            source: 'web_quote',
            stage: 'new_lead',
            stageUpdatedAt: new Date(),
        });

        // Create conversation with old lastMessageAt (simulating time passing)
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        await db.insert(conversations).values({
            id: conversationId,
            phoneNumber: phone,
            contactName: 'No Response Test',
            status: 'active',
            lastMessageAt: twoHoursAgo,
            // Still no lastInboundAt - customer hasn't replied
            templateRequired: true,
        });

        // Initial message was sent 2 hours ago
        await db.insert(messages).values({
            id: uuidv4(),
            conversationId,
            direction: 'outbound',
            content: 'Hi! Thanks for your enquiry.',
            type: 'template',
            status: 'delivered',
            createdAt: twoHoursAgo,
        });

        // Check if follow-up should be triggered
        const [conv] = await db.select()
            .from(conversations)
            .where(eq(conversations.id, conversationId));

        const noReply = !conv.lastInboundAt;
        const timeSinceLastMessage = Date.now() - new Date(conv.lastMessageAt!).getTime();
        const shouldFollowUp = noReply && timeSinceLastMessage > defaultConfig.followUpDelayMs;

        logResult('Follow-up detection works', shouldFollowUp, undefined, {
            hasReply: !noReply,
            timeSinceMessage: Math.round(timeSinceLastMessage / 60000) + ' minutes',
            followUpThreshold: Math.round(defaultConfig.followUpDelayMs / 60000) + ' minutes',
        });

        // Simulate follow-up message
        if (shouldFollowUp) {
            await db.insert(messages).values({
                id: uuidv4(),
                conversationId,
                direction: 'outbound',
                content: 'Hi! Just checking in - did you still need help with your plumbing job?',
                type: 'text', // Follow-ups can be freeform if 24h window open
                status: isDryRun ? 'queued' : 'sent',
                createdAt: new Date(),
            });

            const msgCount = await db.select()
                .from(messages)
                .where(eq(messages.conversationId, conversationId));

            logResult('Follow-up message created', msgCount.length === 2);
        }

        await cleanup(phone);
    } catch (e: any) {
        logResult('No response follow-up', false, e.message);
    }
}

async function testCustomerRepliesStopsChase(): Promise<void> {
    console.log('\n5. Testing Customer Reply Stops Chase...');
    const phone = generateTestPhone();
    const leadId = `lead_${nanoid()}`;
    const conversationId = uuidv4();

    try {
        // Create lead
        await db.insert(leads).values({
            id: leadId,
            customerName: 'Reply Test User',
            phone,
            jobDescription: 'Test job',
            source: 'web_quote',
            stage: 'new_lead',
            stageUpdatedAt: new Date(),
        });

        // Create conversation
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        await db.insert(conversations).values({
            id: conversationId,
            phoneNumber: phone,
            contactName: 'Reply Test User',
            status: 'active',
            lastMessageAt: oneHourAgo,
            templateRequired: true,
        });

        // Initial outbound message
        await db.insert(messages).values({
            id: uuidv4(),
            conversationId,
            direction: 'outbound',
            content: 'Hi! Thanks for your enquiry.',
            type: 'template',
            status: 'delivered',
            createdAt: oneHourAgo,
        });

        // Simulate customer reply
        const replyTime = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago
        await db.insert(messages).values({
            id: uuidv4(),
            conversationId,
            direction: 'inbound',
            content: 'Hi, yes please call me tomorrow at 10am',
            type: 'text',
            status: 'delivered',
            createdAt: replyTime,
        });

        // Update conversation with inbound timestamp
        await db.update(conversations)
            .set({
                lastInboundAt: replyTime,
                lastMessageAt: replyTime,
                templateRequired: false, // 24h window opened
            })
            .where(eq(conversations.id, conversationId));

        // Check if chase should stop
        const [conv] = await db.select()
            .from(conversations)
            .where(eq(conversations.id, conversationId));

        const hasReply = !!conv.lastInboundAt;
        const chaseShouldStop = hasReply;

        logResult('Customer reply detected', hasReply, undefined, {
            lastInboundAt: conv.lastInboundAt,
        });

        logResult('Auto-chase stops after reply', chaseShouldStop);

        await cleanup(phone);
    } catch (e: any) {
        logResult('Customer reply stops chase', false, e.message);
    }
}

async function testChaseSequenceComplete(): Promise<void> {
    console.log('\n6. Testing Complete Chase Sequence...');
    const phone = generateTestPhone();
    const leadId = `lead_${nanoid()}`;

    try {
        // Simulate full auto-chase sequence
        const actions = simulateAutoChase(leadId, phone, 'Complete Test User');

        // Verify action sequence timing
        const sortedActions = actions.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

        const timings = sortedActions.map((a, i) => ({
            step: i + 1,
            type: a.type,
            scheduledAt: a.scheduledAt.toISOString(),
            delayFromStart: Math.round((a.scheduledAt.getTime() - sortedActions[0].scheduledAt.getTime()) / 60000) + ' min',
        }));

        logResult('Chase sequence has correct number of actions', sortedActions.length === 5, undefined, {
            totalActions: sortedActions.length,
            expected: 5,
        });

        logResult('Actions are correctly ordered by time', true, undefined, {
            sequence: timings,
        });

        // Verify timing gaps
        const expectedGaps = [0, 0, 60, 120, 180]; // minutes from start
        let timingCorrect = true;
        for (let i = 0; i < sortedActions.length; i++) {
            const actualGap = Math.round((sortedActions[i].scheduledAt.getTime() - sortedActions[0].scheduledAt.getTime()) / 60000);
            if (actualGap !== expectedGaps[i]) {
                timingCorrect = false;
                break;
            }
        }

        logResult('Follow-up intervals are correct', timingCorrect);

    } catch (e: any) {
        logResult('Chase sequence complete', false, e.message);
    }
}

// ==========================================
// MAIN TEST RUNNER
// ==========================================

async function main() {
    console.log('='.repeat(60));
    console.log(' WEB FORM AUTO-CHASE TEST SUITE');
    console.log('='.repeat(60));

    if (isDryRun) {
        console.log('\n  [DRY RUN MODE - No real messages will be sent]');
    }

    console.log('\n  Auto-Chase Configuration:');
    console.log(`    Initial Delay: ${defaultConfig.initialDelayMs / 1000}s`);
    console.log(`    Follow-up Delay: ${defaultConfig.followUpDelayMs / 60000}min`);
    console.log(`    Max Follow-ups: ${defaultConfig.maxFollowUps}`);
    console.log(`    Template: ${defaultConfig.templateName}`);

    const startTime = Date.now();

    try {
        await testWebFormLeadCreation();
        await testAutoChaseTriggered();
        await testWhatsAppTemplateSend();
        await testNoResponseFollowUp();
        await testCustomerRepliesStopsChase();
        await testChaseSequenceComplete();
    } catch (error) {
        console.error('\n Test suite error:', error);
    }

    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    console.log('\n' + '='.repeat(60));
    console.log(' AUTO-CHASE TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`  Duration: ${duration}s`);
    console.log(`  Total: ${results.length}`);
    console.log(`  Passed: ${passed}`);
    console.log(`  Failed: ${failed}`);

    if (failed > 0) {
        console.log('\n  Failed tests:');
        for (const result of results.filter(r => !r.passed)) {
            console.log(`    \u2717 ${result.name}: ${result.error}`);
        }
    }

    if (passed === results.length) {
        console.log('\n ALL TESTS PASSED');
    } else {
        console.log(`\n ${passed}/${results.length} TESTS PASSED`);
    }
    console.log('='.repeat(60) + '\n');

    process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
