/**
 * Test All WhatsApp Notification Flows
 *
 * Sends test messages for every tenant & landlord notification function.
 * Uses the Twilio REST API directly (no server/DB dependencies).
 *
 * Usage: npx tsx scripts/test-all-notifications.ts [--dry-run] [--flow T4] [--delay 3000]
 *
 * Options:
 *   --dry-run    Print messages without sending
 *   --flow T4    Run only a specific flow (T4, T5, T6, T7, T8, L3, L6, L7, L8, L9, L10, L11, WELCOME)
 *   --delay N    Delay between sends in ms (default: 2000)
 */

import 'dotenv/config';

// ==========================================
// CONFIG
// ==========================================

const TEST_PHONE = '+447508744402';     // Test tenant/landlord phone
const TEST_TENANT_NAME = 'Sarah';       // Test tenant name
const TEST_LANDLORD_NAME = 'James';     // Test landlord name
const TEST_PROPERTY = '42 Oak Lane, Nottingham, NG1 2AB';
const TEST_ISSUE = 'leaking kitchen tap';
const TEST_CONTRACTOR = 'Dave\'s Plumbing';

const SID = process.env.TWILIO_ACCOUNT_SID!;
const TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const FROM = process.env.TWILIO_WHATSAPP_NUMBER!;

// ==========================================
// TWILIO SEND HELPER
// ==========================================

interface SendResult {
    success: boolean;
    messageSid?: string;
    status?: string;
    errorCode?: number;
    errorMessage?: string;
}

async function sendWhatsApp(to: string, body: string): Promise<SendResult> {
    const auth = Buffer.from(`${SID}:${TOKEN}`).toString('base64');
    const formData = new URLSearchParams();
    formData.append('From', `whatsapp:${FROM}`);
    formData.append('To', `whatsapp:${to}`);
    formData.append('Body', body);

    const url = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`;

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString()
    });

    const data = await res.json() as any;

    if (res.ok) {
        return { success: true, messageSid: data.sid, status: data.status };
    } else {
        return {
            success: false,
            errorCode: data.code,
            errorMessage: data.message
        };
    }
}

// ==========================================
// NOTIFICATION TEMPLATES (mirrors actual functions)
// ==========================================

interface TestFlow {
    code: string;
    name: string;
    type: 'tenant' | 'landlord';
    message: string;
}

const flows: TestFlow[] = [
    // ---- TENANT FLOWS ----
    {
        code: 'WELCOME',
        name: 'Tenant Welcome Message',
        type: 'tenant',
        message: `Hi ${TEST_TENANT_NAME}! Welcome to Handy Services at ${TEST_PROPERTY}. You can report any maintenance issues by messaging us here. We'll take care of everything. 🏠`
    },
    {
        code: 'T4-quoted',
        name: 'T4: Status → Quoted',
        type: 'tenant',
        message: `Hi ${TEST_TENANT_NAME}, we've assessed your ${TEST_ISSUE} and prepared a quote for your landlord.`
    },
    {
        code: 'T4-approved',
        name: 'T4: Status → Approved',
        type: 'tenant',
        message: `Hi ${TEST_TENANT_NAME}, your landlord has approved the repair for ${TEST_ISSUE}. We're scheduling it now.`
    },
    {
        code: 'T4-scheduled',
        name: 'T4: Status → Scheduled',
        type: 'tenant',
        message: `Hi ${TEST_TENANT_NAME}, your ${TEST_ISSUE} repair has been scheduled for Monday 10th March.`
    },
    {
        code: 'T4-in_progress',
        name: 'T4: Status → In Progress',
        type: 'tenant',
        message: `Hi ${TEST_TENANT_NAME}, work has started on your ${TEST_ISSUE}.`
    },
    {
        code: 'T4-completed',
        name: 'T4: Status → Completed',
        type: 'tenant',
        message: `Hi ${TEST_TENANT_NAME}, your ${TEST_ISSUE} has been completed! If you notice any problems, just message us here.`
    },
    {
        code: 'T5',
        name: 'T5: Contractor Assigned',
        type: 'tenant',
        message: `Hi ${TEST_TENANT_NAME}, good news! ${TEST_CONTRACTOR} has been assigned to your ${TEST_ISSUE} and is scheduled for Monday 10th March. They'll arrive between 9am - 12pm.`
    },
    {
        code: 'T6',
        name: 'T6: Appointment Reminder',
        type: 'tenant',
        message: `Hi ${TEST_TENANT_NAME}, just a reminder: your repair for ${TEST_ISSUE} is scheduled for tomorrow. The contractor will arrive between 9:00 AM (approx. 60 minutes).`
    },
    {
        code: 'T7',
        name: 'T7: Job Completion',
        type: 'tenant',
        message: `Hi ${TEST_TENANT_NAME}, your ${TEST_ISSUE} has been completed! If you notice any issues, just message us here. We're always happy to help.`
    },
    {
        code: 'T8',
        name: 'T8: Satisfaction Survey',
        type: 'tenant',
        message: `Hi ${TEST_TENANT_NAME}, how was the recent work on your ${TEST_ISSUE}? Reply with a number 1-5 (1=poor, 5=excellent). Your feedback helps us improve!`
    },

    // ---- LANDLORD FLOWS ----
    {
        code: 'L3',
        name: 'L3: Approval Request',
        type: 'landlord',
        message: `🔔 *Approval Needed*\n\nProperty: ${TEST_PROPERTY}\nIssue: ${TEST_ISSUE}\nEstimated cost: £80-£150\n\nReply YES to approve or NO to discuss.`
    },
    {
        code: 'L4-approved',
        name: 'L4: Approval Confirmed',
        type: 'landlord',
        message: `✅ *Approved*\n\nJob at ${TEST_PROPERTY} has been approved. We'll schedule it and keep you updated.`
    },
    {
        code: 'L4-rejected',
        name: 'L4: Rejection Confirmed',
        type: 'landlord',
        message: `❌ *Noted*\n\nJob at ${TEST_PROPERTY} has been put on hold. Reply if you'd like to discuss options.`
    },
    {
        code: 'L6',
        name: 'L6: Job Completion Report',
        type: 'landlord',
        message: `✅ *Job Complete*\n\nProperty: ${TEST_PROPERTY}\nIssue: ${TEST_ISSUE}\nCost: £120.00\nPhotos: https://app.handyservices.co.uk/photos/test-job\n\nInvoice will follow.`
    },
    {
        code: 'L7',
        name: 'L7: Payment Confirmation',
        type: 'landlord',
        message: `Payment of £120.00 received for ${TEST_ISSUE}. Thank you! Reference: PAY-TEST123`
    },
    {
        code: 'L8',
        name: 'L8: Balance Reminder',
        type: 'landlord',
        message: `Reminder: outstanding balance of £120.00 for ${TEST_ISSUE} at ${TEST_PROPERTY}. Pay here: https://handyservices.co.uk/pay/test-job`
    },
    {
        code: 'L9',
        name: 'L9: Emergency Escalation',
        type: 'landlord',
        message: `⚠️ URGENT: No response received for emergency at ${TEST_PROPERTY}: ${TEST_ISSUE}. Auto-dispatching in 30 minutes unless you reply HOLD.`
    },
    {
        code: 'L9-auto',
        name: 'L9: Emergency Auto-Dispatched',
        type: 'landlord',
        message: `🚨 *Emergency Auto-Dispatched*\n\nNo response received. A handyman has been dispatched to ${TEST_PROPERTY} for: ${TEST_ISSUE}.\n\nWe'll send updates as the job progresses.`
    },
    {
        code: 'L10',
        name: 'L10: Quarterly Maintenance Check-in',
        type: 'landlord',
        message: `Hi ${TEST_LANDLORD_NAME}, it's time for your seasonal property check at ${TEST_PROPERTY}. Want us to schedule an inspection? Reply YES to book.`
    },
    {
        code: 'L11',
        name: 'L11: Monthly Spend Summary',
        type: 'landlord',
        message: `Hi ${TEST_LANDLORD_NAME}, your monthly property report:\n• 3 jobs completed\n• Total spend: £450.00\n\nView full report: https://app.handyservices.co.uk/landlord/dashboard`
    }
];

// ==========================================
// TEST RUNNER
// ==========================================

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const flowFilterIdx = args.indexOf('--flow');
    const flowFilter = flowFilterIdx >= 0 ? args[flowFilterIdx + 1]?.toUpperCase() : null;
    const delayIdx = args.indexOf('--delay');
    const delay = delayIdx >= 0 ? parseInt(args[delayIdx + 1]) : 2000;

    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║     WHATSAPP NOTIFICATION TEST SUITE                ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');

    // Validate config
    if (!SID || !TOKEN || !FROM) {
        console.error('❌ Missing env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_WHATSAPP_NUMBER');
        process.exit(1);
    }

    console.log(`📱 From:    whatsapp:${FROM}`);
    console.log(`📱 To:      whatsapp:${TEST_PHONE}`);
    console.log(`🔧 Mode:    ${dryRun ? 'DRY RUN (no sends)' : 'LIVE SEND'}`);
    console.log(`⏱️  Delay:   ${delay}ms between sends`);
    if (flowFilter) console.log(`🎯 Filter:  ${flowFilter} only`);
    console.log('');

    // Filter flows
    const testFlows = flowFilter
        ? flows.filter(f => f.code.toUpperCase().startsWith(flowFilter))
        : flows;

    if (testFlows.length === 0) {
        console.error(`❌ No flows match filter: ${flowFilter}`);
        console.log('Available flows:', flows.map(f => f.code).join(', '));
        process.exit(1);
    }

    console.log(`Running ${testFlows.length} of ${flows.length} notification tests...\n`);

    // Results tracking
    const results: { code: string; name: string; success: boolean; detail: string }[] = [];

    for (let i = 0; i < testFlows.length; i++) {
        const flow = testFlows[i];
        const prefix = `[${i + 1}/${testFlows.length}]`;

        console.log(`${prefix} ${flow.code}: ${flow.name}`);
        console.log(`   Type: ${flow.type}`);

        if (dryRun) {
            console.log(`   Message: ${flow.message.substring(0, 80)}${flow.message.length > 80 ? '...' : ''}`);
            console.log(`   ⏭️  SKIPPED (dry run)\n`);
            results.push({ code: flow.code, name: flow.name, success: true, detail: 'dry-run' });
            continue;
        }

        try {
            const result = await sendWhatsApp(TEST_PHONE, flow.message);

            if (result.success) {
                console.log(`   ✅ SENT | SID: ${result.messageSid} | Status: ${result.status}`);
                results.push({ code: flow.code, name: flow.name, success: true, detail: result.messageSid! });
            } else {
                console.log(`   ❌ FAILED | Code: ${result.errorCode} | ${result.errorMessage}`);

                if (result.errorCode === 63032) {
                    console.log(`   💡 Outside 24h window. Send a message FROM ${TEST_PHONE} to ${FROM} first.`);
                }
                results.push({ code: flow.code, name: flow.name, success: false, detail: `Error ${result.errorCode}: ${result.errorMessage}` });
            }
        } catch (err: any) {
            console.log(`   ❌ EXCEPTION: ${err.message}`);
            results.push({ code: flow.code, name: flow.name, success: false, detail: err.message });
        }

        console.log('');

        // Delay between sends (avoid rate limiting)
        if (i < testFlows.length - 1) {
            await new Promise(r => setTimeout(r, delay));
        }
    }

    // ==========================================
    // RESULTS SUMMARY
    // ==========================================

    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║     TEST RESULTS SUMMARY                            ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');

    const passed = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log('┌──────────────┬──────────────────────────────────────┬────────┐');
    console.log('│ Code         │ Name                                 │ Result │');
    console.log('├──────────────┼──────────────────────────────────────┼────────┤');

    for (const r of results) {
        const code = r.code.padEnd(12);
        const name = r.name.substring(0, 36).padEnd(36);
        const status = r.success ? '  ✅  ' : '  ❌  ';
        console.log(`│ ${code} │ ${name} │${status}│`);
    }

    console.log('└──────────────┴──────────────────────────────────────┴────────┘');
    console.log(`\n📊 Total: ${results.length} | ✅ Passed: ${passed} | ❌ Failed: ${failed}`);

    if (failed > 0) {
        console.log('\n❌ Failed tests:');
        for (const r of results.filter(r => !r.success)) {
            console.log(`   ${r.code}: ${r.detail}`);
        }
    }

    // Check if 24h window might be the issue
    if (failed > 0 && results.some(r => r.detail.includes('63032'))) {
        console.log('\n⚠️  24-HOUR WINDOW ISSUE DETECTED');
        console.log('   To fix: Send a WhatsApp message FROM the test phone to the platform number first.');
        console.log(`   Test phone: ${TEST_PHONE}`);
        console.log(`   Platform:   ${FROM}`);
        console.log('   Then re-run this script within 24 hours.');
    }

    console.log('\n=== TEST SUITE COMPLETE ===\n');
}

main().catch(console.error);
