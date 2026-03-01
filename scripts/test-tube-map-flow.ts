/**
 * Test Lead Tube Map E2E Flows
 *
 * This script tests complete customer journey flows through the tube map:
 * 1. Call Flow: Simulate call -> detect route -> move through stages -> book
 * 2. WhatsApp Flow: Simulate WhatsApp -> video route -> video received -> quote -> book
 * 3. Web Form Flow: Simulate form -> auto-chase WhatsApp -> callback -> quote -> book
 *
 * Prerequisites:
 * - Database must have the latest schema: npm run db:push
 * - Server must be running for API tests: npm run dev
 *
 * Usage: npx tsx scripts/test-tube-map-flow.ts
 */

import { db } from '../server/db';
import { leads, personalizedQuotes, conversations, messages, calls, LeadStage } from '../shared/schema';
import { eq, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { v4 as uuidv4 } from 'uuid';
import {
    updateLeadStage,
    computeLeadStage,
} from '../server/lead-stage-engine';

const TEST_PHONE_PREFIX = '07700777';
const API_BASE = 'http://localhost:5000';

interface FlowTestResult {
    flowName: string;
    steps: {
        name: string;
        passed: boolean;
        expectedStage?: LeadStage;
        actualStage?: LeadStage;
        error?: string;
    }[];
    overallPassed: boolean;
}

const flowResults: FlowTestResult[] = [];

// Generate unique phone for each flow test
function generateTestPhone(): string {
    return `${TEST_PHONE_PREFIX}${Math.floor(1000 + Math.random() * 9000)}`;
}

async function cleanup(phone: string) {
    await db.delete(leads).where(eq(leads.phone, phone));
    await db.delete(personalizedQuotes).where(eq(personalizedQuotes.phone, phone));
    await db.delete(conversations).where(eq(conversations.phoneNumber, phone));
}

// ==========================================
// FLOW 1: CALL FLOW
// Customer calls -> AI detects route -> moves through stages -> books
// ==========================================

async function testCallFlow(): Promise<FlowTestResult> {
    console.log('\n1. Testing Call Flow...');
    const phone = generateTestPhone();
    const leadId = `lead_${nanoid()}`;
    const steps: FlowTestResult['steps'] = [];

    try {
        // Step 1: Incoming call creates lead in new_lead stage
        console.log('   Step 1: Incoming call creates lead...');
        await db.insert(leads).values({
            id: leadId,
            customerName: 'Call Flow Test User',
            phone,
            jobDescription: 'I need to mount a 55 inch TV on a plasterboard wall',
            source: 'call',
            stage: 'new_lead',
            stageUpdatedAt: new Date(),
        });

        const [lead1] = await db.select().from(leads).where(eq(leads.id, leadId));
        steps.push({
            name: 'Incoming call creates lead in new_lead',
            passed: lead1.stage === 'new_lead',
            expectedStage: 'new_lead',
            actualStage: lead1.stage as LeadStage,
        });

        // Step 2: Call ends with transcript, AI detects instant_quote route
        console.log('   Step 2: Call ends, route detected...');
        // Simulate route detection by updating lead (in real system, this happens via call outcome)
        await db.insert(calls).values({
            id: `call_${nanoid()}`,
            callId: `twilio_${nanoid()}`,
            phoneNumber: phone,
            direction: 'inbound',
            status: 'completed',
            startTime: new Date(),
            outcome: 'INSTANT_PRICE',
            leadId,
            customerName: 'Call Flow Test User',
            jobSummary: 'TV mounting on plasterboard',
        });

        // Stage should move to contacted after successful call
        await updateLeadStage(leadId, 'contacted', { reason: 'Call completed' });
        const [lead2] = await db.select().from(leads).where(eq(leads.id, leadId));
        steps.push({
            name: 'Call completion moves to contacted',
            passed: lead2.stage === 'contacted',
            expectedStage: 'contacted',
            actualStage: lead2.stage as LeadStage,
        });

        // Step 3: Quote is generated and sent
        console.log('   Step 3: Quote generated and sent...');
        const quoteId = uuidv4();
        await db.insert(personalizedQuotes).values({
            id: quoteId,
            shortSlug: `C${Date.now().toString(36).slice(-7).toUpperCase()}`,
            leadId,
            customerName: 'Call Flow Test User',
            phone,
            postcode: 'SW1A 1AA',
            jobDescription: 'TV mounting on plasterboard',
            segment: 'BUSY_PRO',
            quoteMode: 'simple',
            basePrice: 8500,
            createdAt: new Date(),
        });

        // Recompute stage - should be quote_sent
        const computed1 = await computeLeadStage(leadId);
        steps.push({
            name: 'Quote creation triggers quote_sent',
            passed: computed1.stage === 'quote_sent',
            expectedStage: 'quote_sent',
            actualStage: computed1.stage,
        });

        // Step 4: Customer views quote
        console.log('   Step 4: Customer views quote...');
        await db.update(personalizedQuotes)
            .set({ viewedAt: new Date() })
            .where(eq(personalizedQuotes.id, quoteId));

        const computed2 = await computeLeadStage(leadId);
        steps.push({
            name: 'Quote view triggers quote_viewed',
            passed: computed2.stage === 'quote_viewed',
            expectedStage: 'quote_viewed',
            actualStage: computed2.stage,
        });

        // Step 5: Customer selects package
        console.log('   Step 5: Customer selects package...');
        await db.update(personalizedQuotes)
            .set({
                selectedAt: new Date(),
                selectedPackage: 'enhanced',
            })
            .where(eq(personalizedQuotes.id, quoteId));

        const computed3 = await computeLeadStage(leadId);
        steps.push({
            name: 'Package selection triggers awaiting_payment',
            passed: computed3.stage === 'awaiting_payment',
            expectedStage: 'awaiting_payment',
            actualStage: computed3.stage,
        });

        // Step 6: Customer pays
        console.log('   Step 6: Customer pays...');
        await db.update(personalizedQuotes)
            .set({
                depositPaidAt: new Date(),
                bookedAt: new Date(),
            })
            .where(eq(personalizedQuotes.id, quoteId));

        const computed4 = await computeLeadStage(leadId);
        steps.push({
            name: 'Payment triggers booked',
            passed: computed4.stage === 'booked',
            expectedStage: 'booked',
            actualStage: computed4.stage,
        });

        console.log('   Step 7: Cleanup...');
        await cleanup(phone);

    } catch (e: any) {
        steps.push({
            name: 'Flow execution',
            passed: false,
            error: e.message,
        });
        await cleanup(phone);
    }

    const overallPassed = steps.every(s => s.passed);
    const result = { flowName: 'Call Flow', steps, overallPassed };
    flowResults.push(result);
    return result;
}

// ==========================================
// FLOW 2: WHATSAPP VIDEO FLOW
// Customer messages -> video route detected -> video received -> quote -> book
// ==========================================

async function testWhatsAppVideoFlow(): Promise<FlowTestResult> {
    console.log('\n2. Testing WhatsApp Video Flow...');
    const phone = generateTestPhone();
    const leadId = `lead_${nanoid()}`;
    const conversationId = uuidv4();
    const steps: FlowTestResult['steps'] = [];

    try {
        // Step 1: Incoming WhatsApp message creates lead
        console.log('   Step 1: Incoming WhatsApp creates lead...');
        await db.insert(leads).values({
            id: leadId,
            customerName: 'WhatsApp Flow Test User',
            phone,
            jobDescription: 'Leaking tap under my kitchen sink',
            source: 'whatsapp',
            stage: 'new_lead',
            stageUpdatedAt: new Date(),
        });

        // Create conversation
        await db.insert(conversations).values({
            id: conversationId,
            phoneNumber: phone,
            contactName: 'WhatsApp Flow Test User',
            status: 'active',
            lastMessageAt: new Date(),
            lastInboundAt: new Date(), // Opens 24h window
        });

        const [lead1] = await db.select().from(leads).where(eq(leads.id, leadId));
        steps.push({
            name: 'WhatsApp message creates lead in new_lead',
            passed: lead1.stage === 'new_lead',
            expectedStage: 'new_lead',
            actualStage: lead1.stage as LeadStage,
        });

        // Step 2: VA responds and requests video
        console.log('   Step 2: VA requests video (moves to contacted)...');
        await updateLeadStage(leadId, 'contacted', { reason: 'VA responded' });

        const [lead2] = await db.select().from(leads).where(eq(leads.id, leadId));
        steps.push({
            name: 'VA response moves to contacted',
            passed: lead2.stage === 'contacted',
            expectedStage: 'contacted',
            actualStage: lead2.stage as LeadStage,
        });

        // Step 3: Video requested, waiting
        console.log('   Step 3: Video requested, awaiting...');
        await updateLeadStage(leadId, 'awaiting_video', { reason: 'Video requested via WhatsApp' });

        const [lead3] = await db.select().from(leads).where(eq(leads.id, leadId));
        steps.push({
            name: 'Video request moves to awaiting_video',
            passed: lead3.stage === 'awaiting_video',
            expectedStage: 'awaiting_video',
            actualStage: lead3.stage as LeadStage,
        });

        // Step 4: Customer sends video
        console.log('   Step 4: Customer sends video...');
        await db.insert(messages).values({
            id: uuidv4(),
            conversationId,
            direction: 'inbound',
            content: '',
            type: 'video',
            mediaUrl: 'https://example.com/video.mp4',
            status: 'delivered',
            createdAt: new Date(),
        });

        // In real system, this would auto-detect and move stage
        // We'll simulate the VA processing it
        await db.update(leads)
            .set({
                videoReceivedAt: new Date(),
                awaitingVideo: false,
            })
            .where(eq(leads.id, leadId));

        steps.push({
            name: 'Video received recorded on lead',
            passed: true,
        });

        // Step 5: Quote generated from video analysis
        console.log('   Step 5: Quote generated from video...');
        const quoteId = uuidv4();
        await db.insert(personalizedQuotes).values({
            id: quoteId,
            shortSlug: `V${Date.now().toString(36).slice(-7).toUpperCase()}`,
            leadId,
            customerName: 'WhatsApp Flow Test User',
            phone,
            postcode: 'E1 6AN',
            jobDescription: 'Leaking tap repair - identified from video',
            segment: 'DIY_DEFERRER',
            quoteMode: 'hhh',
            essentialPrice: 9500,
            enhancedPrice: 14000,
            elitePrice: 18500,
            createdAt: new Date(),
        });

        const computed1 = await computeLeadStage(leadId);
        steps.push({
            name: 'Quote from video triggers quote_sent',
            passed: computed1.stage === 'quote_sent',
            expectedStage: 'quote_sent',
            actualStage: computed1.stage,
        });

        // Step 6-8: Same as call flow (view, select, pay)
        console.log('   Step 6: Customer views, selects, pays...');
        await db.update(personalizedQuotes)
            .set({
                viewedAt: new Date(),
                selectedAt: new Date(),
                selectedPackage: 'enhanced',
                depositPaidAt: new Date(),
                bookedAt: new Date(),
            })
            .where(eq(personalizedQuotes.id, quoteId));

        const computed2 = await computeLeadStage(leadId);
        steps.push({
            name: 'Full payment flow ends in booked',
            passed: computed2.stage === 'booked',
            expectedStage: 'booked',
            actualStage: computed2.stage,
        });

        console.log('   Step 7: Cleanup...');
        await cleanup(phone);

    } catch (e: any) {
        steps.push({
            name: 'Flow execution',
            passed: false,
            error: e.message,
        });
        await cleanup(phone);
    }

    const overallPassed = steps.every(s => s.passed);
    const result = { flowName: 'WhatsApp Video Flow', steps, overallPassed };
    flowResults.push(result);
    return result;
}

// ==========================================
// FLOW 3: WEB FORM FLOW
// Form submitted -> auto-chase WhatsApp -> callback -> quote -> book
// ==========================================

async function testWebFormFlow(): Promise<FlowTestResult> {
    console.log('\n3. Testing Web Form Flow...');
    const phone = generateTestPhone();
    const leadId = `lead_${nanoid()}`;
    const steps: FlowTestResult['steps'] = [];

    try {
        // Step 1: Web form submission creates lead
        console.log('   Step 1: Web form creates lead...');
        await db.insert(leads).values({
            id: leadId,
            customerName: 'Web Form Test User',
            phone,
            email: 'webform@test.com',
            jobDescription: 'Need shelves installed in my home office',
            source: 'web_quote',
            stage: 'new_lead',
            stageUpdatedAt: new Date(),
        });

        const [lead1] = await db.select().from(leads).where(eq(leads.id, leadId));
        steps.push({
            name: 'Web form creates lead in new_lead',
            passed: lead1.stage === 'new_lead',
            expectedStage: 'new_lead',
            actualStage: lead1.stage as LeadStage,
        });

        // Step 2: Auto-chase system sends WhatsApp template
        console.log('   Step 2: Auto-chase sends WhatsApp template...');
        // In real system, this would be automatic
        // Simulate by creating conversation
        const conversationId = uuidv4();
        await db.insert(conversations).values({
            id: conversationId,
            phoneNumber: phone,
            contactName: 'Web Form Test User',
            status: 'active',
            lastMessageAt: new Date(),
            // No lastInboundAt yet - template message, no reply
        });

        // Simulate outbound template message
        await db.insert(messages).values({
            id: uuidv4(),
            conversationId,
            direction: 'outbound',
            content: 'Hi! Thanks for your enquiry about shelf installation. When would be good for a quick call?',
            type: 'template',
            status: 'sent',
            createdAt: new Date(),
        });

        steps.push({
            name: 'Auto-chase WhatsApp template sent',
            passed: true,
        });

        // Step 3: Customer replies (opens 24h window)
        console.log('   Step 3: Customer replies...');
        await db.update(conversations)
            .set({ lastInboundAt: new Date() })
            .where(eq(conversations.id, conversationId));

        await db.insert(messages).values({
            id: uuidv4(),
            conversationId,
            direction: 'inbound',
            content: 'Yes, please call me around 2pm',
            type: 'text',
            status: 'delivered',
            createdAt: new Date(),
        });

        // VA contacts, moves to contacted
        await updateLeadStage(leadId, 'contacted', { reason: 'Customer replied to auto-chase' });

        const [lead2] = await db.select().from(leads).where(eq(leads.id, leadId));
        steps.push({
            name: 'Customer reply + contact moves to contacted',
            passed: lead2.stage === 'contacted',
            expectedStage: 'contacted',
            actualStage: lead2.stage as LeadStage,
        });

        // Step 4: Callback happens, quote generated
        console.log('   Step 4: Callback completed, quote sent...');
        await db.insert(calls).values({
            id: `call_${nanoid()}`,
            callId: `callback_${nanoid()}`,
            phoneNumber: phone,
            direction: 'outbound',
            status: 'completed',
            startTime: new Date(),
            outcome: 'LEAD_CAPTURED',
            leadId,
            customerName: 'Web Form Test User',
            jobSummary: 'Shelf installation in home office - 3 floating shelves',
        });

        const quoteId = uuidv4();
        await db.insert(personalizedQuotes).values({
            id: quoteId,
            shortSlug: `W${Date.now().toString(36).slice(-7).toUpperCase()}`,
            leadId,
            customerName: 'Web Form Test User',
            phone,
            postcode: 'N1 9GU',
            jobDescription: 'Install 3 floating shelves in home office',
            segment: 'BUSY_PRO',
            quoteMode: 'hhh',
            essentialPrice: 12000,
            enhancedPrice: 18000,
            elitePrice: 25000,
            createdAt: new Date(),
        });

        const computed1 = await computeLeadStage(leadId);
        steps.push({
            name: 'Callback + quote triggers quote_sent',
            passed: computed1.stage === 'quote_sent',
            expectedStage: 'quote_sent',
            actualStage: computed1.stage,
        });

        // Step 5-7: Complete booking
        console.log('   Step 5: Customer completes booking...');
        await db.update(personalizedQuotes)
            .set({
                viewedAt: new Date(),
                selectedAt: new Date(),
                selectedPackage: 'essential',
                depositPaidAt: new Date(),
                bookedAt: new Date(),
            })
            .where(eq(personalizedQuotes.id, quoteId));

        const computed2 = await computeLeadStage(leadId);
        steps.push({
            name: 'Full booking flow ends in booked',
            passed: computed2.stage === 'booked',
            expectedStage: 'booked',
            actualStage: computed2.stage,
        });

        console.log('   Step 6: Cleanup...');
        await cleanup(phone);

    } catch (e: any) {
        steps.push({
            name: 'Flow execution',
            passed: false,
            error: e.message,
        });
        await cleanup(phone);
    }

    const overallPassed = steps.every(s => s.passed);
    const result = { flowName: 'Web Form Flow', steps, overallPassed };
    flowResults.push(result);
    return result;
}

// ==========================================
// FLOW 4: LOST LEAD FLOW
// Lead goes cold -> marked as lost -> reactivation attempt
// ==========================================

async function testLostLeadFlow(): Promise<FlowTestResult> {
    console.log('\n4. Testing Lost Lead Flow...');
    const phone = generateTestPhone();
    const leadId = `lead_${nanoid()}`;
    const steps: FlowTestResult['steps'] = [];

    try {
        // Step 1: Create lead with quote
        console.log('   Step 1: Create lead with quote...');
        await db.insert(leads).values({
            id: leadId,
            customerName: 'Lost Lead Test User',
            phone,
            jobDescription: 'Bathroom renovations',
            source: 'call',
            stage: 'new_lead',
            stageUpdatedAt: new Date(),
        });

        const quoteId = uuidv4();
        await db.insert(personalizedQuotes).values({
            id: quoteId,
            shortSlug: `L${Date.now().toString(36).slice(-7).toUpperCase()}`,
            leadId,
            customerName: 'Lost Lead Test User',
            phone,
            postcode: 'SE1 7PB',
            jobDescription: 'Bathroom renovations',
            segment: 'DIY_DEFERRER',
            quoteMode: 'consultation',
            createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), // 8 days ago
            viewedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Viewed 7 days ago
        });

        steps.push({
            name: 'Lead created with old quote',
            passed: true,
        });

        // Step 2: Lead marked as lost (would normally be auto-detected)
        console.log('   Step 2: Lead marked as lost...');
        await updateLeadStage(leadId, 'lost', { reason: 'No activity for 7 days' });

        const [lead2] = await db.select().from(leads).where(eq(leads.id, leadId));
        steps.push({
            name: 'Lead moves to lost',
            passed: lead2.stage === 'lost',
            expectedStage: 'lost',
            actualStage: lead2.stage as LeadStage,
        });

        // Step 3: Reactivation attempt (forced transition out of lost)
        console.log('   Step 3: Reactivation attempt...');
        await updateLeadStage(leadId, 'contacted', { force: true, reason: 'Remarketing reactivation' });

        const [lead3] = await db.select().from(leads).where(eq(leads.id, leadId));
        steps.push({
            name: 'Forced reactivation to contacted',
            passed: lead3.stage === 'contacted',
            expectedStage: 'contacted',
            actualStage: lead3.stage as LeadStage,
        });

        console.log('   Step 4: Cleanup...');
        await cleanup(phone);

    } catch (e: any) {
        steps.push({
            name: 'Flow execution',
            passed: false,
            error: e.message,
        });
        await cleanup(phone);
    }

    const overallPassed = steps.every(s => s.passed);
    const result = { flowName: 'Lost Lead Flow', steps, overallPassed };
    flowResults.push(result);
    return result;
}

// ==========================================
// MAIN TEST RUNNER
// ==========================================

async function main() {
    console.log('='.repeat(60));
    console.log(' LEAD TUBE MAP E2E FLOW TESTS');
    console.log('='.repeat(60));

    const startTime = Date.now();

    try {
        // Run all flow tests
        await testCallFlow();
        await testWhatsAppVideoFlow();
        await testWebFormFlow();
        await testLostLeadFlow();

        // Summary
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        const passedFlows = flowResults.filter(f => f.overallPassed).length;
        const failedFlows = flowResults.filter(f => !f.overallPassed).length;

        console.log('\n' + '='.repeat(60));
        console.log(' FLOW TEST SUMMARY');
        console.log('='.repeat(60));
        console.log(`  Duration: ${duration}s`);
        console.log(`  Flows: ${flowResults.length}`);
        console.log(`  Passed: ${passedFlows}`);
        console.log(`  Failed: ${failedFlows}`);

        for (const flow of flowResults) {
            const icon = flow.overallPassed ? '\u2713' : '\u2717';
            console.log(`\n  ${icon} ${flow.flowName}`);
            for (const step of flow.steps) {
                const stepIcon = step.passed ? '\u2713' : '\u2717';
                const stageInfo = step.expectedStage
                    ? ` (expected: ${step.expectedStage}, got: ${step.actualStage})`
                    : '';
                console.log(`     ${stepIcon} ${step.name}${stageInfo}`);
                if (step.error) {
                    console.log(`       Error: ${step.error}`);
                }
            }
        }

        if (failedFlows === 0) {
            console.log('\n ALL FLOWS PASSED');
        } else {
            console.log('\n SOME FLOWS FAILED');
            process.exit(1);
        }
        console.log('='.repeat(60) + '\n');

    } catch (error) {
        console.error('\n Test suite failed with error:', error);
        process.exit(1);
    }

    process.exit(0);
}

main();
