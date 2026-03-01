/**
 * Check WhatsApp Message Delivery Status
 *
 * Fetches recent outbound messages from Twilio API and shows their delivery status.
 * Run this AFTER test-all-notifications.ts to verify delivery.
 *
 * Usage: npx tsx scripts/test-check-delivery.ts [--limit 20]
 */

import 'dotenv/config';

async function main() {
    const SID = process.env.TWILIO_ACCOUNT_SID!;
    const TOKEN = process.env.TWILIO_AUTH_TOKEN!;
    const FROM = process.env.TWILIO_WHATSAPP_NUMBER!;

    if (!SID || !TOKEN || !FROM) {
        console.error('❌ Missing env vars');
        process.exit(1);
    }

    const args = process.argv.slice(2);
    const limitIdx = args.indexOf('--limit');
    const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 25;

    const auth = Buffer.from(`${SID}:${TOKEN}`).toString('base64');

    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║     WHATSAPP DELIVERY STATUS CHECK                  ║');
    console.log('╚══════════════════════════════════════════════════════╝\n');

    console.log(`📱 From: whatsapp:${FROM}`);
    console.log(`📊 Checking last ${limit} outbound messages...\n`);

    try {
        const url = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json?From=whatsapp:${encodeURIComponent(FROM)}&PageSize=${limit}`;

        const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
        const data = await res.json() as any;

        if (!data.messages || data.messages.length === 0) {
            console.log('No outbound messages found.');
            return;
        }

        // Status emoji mapping
        const statusEmoji: Record<string, string> = {
            queued: '⏳',
            sending: '📤',
            sent: '📨',
            delivered: '✅',
            read: '👁️',
            failed: '❌',
            undelivered: '⚠️',
        };

        // Counters
        const statusCounts: Record<string, number> = {};

        console.log('┌──────────────────┬──────────────────┬──────────────┬──────────────────────────────────────────┐');
        console.log('│ Time             │ To               │ Status       │ Body (truncated)                         │');
        console.log('├──────────────────┼──────────────────┼──────────────┼──────────────────────────────────────────┤');

        for (const msg of data.messages) {
            const time = new Date(msg.date_created).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const to = msg.to.replace('whatsapp:', '').padEnd(16);
            const emoji = statusEmoji[msg.status] || '❓';
            const status = `${emoji} ${msg.status}`.padEnd(12);
            const body = (msg.body || '').substring(0, 40).replace(/\n/g, ' ');

            statusCounts[msg.status] = (statusCounts[msg.status] || 0) + 1;

            console.log(`│ ${time.padEnd(16)} │ ${to} │ ${status} │ ${body.padEnd(40)} │`);
        }

        console.log('└──────────────────┴──────────────────┴──────────────┴──────────────────────────────────────────┘');

        // Summary
        console.log('\n📊 Status Summary:');
        for (const [status, count] of Object.entries(statusCounts)) {
            const emoji = statusEmoji[status] || '❓';
            console.log(`   ${emoji} ${status}: ${count}`);
        }

        const totalSent = data.messages.length;
        const delivered = (statusCounts['delivered'] || 0) + (statusCounts['read'] || 0);
        const failed = (statusCounts['failed'] || 0) + (statusCounts['undelivered'] || 0);

        console.log(`\n   Total: ${totalSent} | Delivered/Read: ${delivered} | Failed: ${failed}`);

        if (failed > 0) {
            console.log('\n❌ Failed messages:');
            for (const msg of data.messages.filter((m: any) => m.status === 'failed' || m.status === 'undelivered')) {
                console.log(`   SID: ${msg.sid}`);
                console.log(`   Error: ${msg.error_code} - ${msg.error_message}`);
                console.log('');
            }
        }

    } catch (err: any) {
        console.error('❌ Error fetching messages:', err.message);
    }

    // Also check inbound (replies)
    console.log('\n--- Inbound Messages (last 10) ---\n');

    try {
        const url = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json?To=whatsapp:${encodeURIComponent(FROM)}&PageSize=10`;

        const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
        const data = await res.json() as any;

        if (!data.messages || data.messages.length === 0) {
            console.log('No inbound messages found.');
        } else {
            for (const msg of data.messages) {
                const time = new Date(msg.date_created).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                const from = msg.from.replace('whatsapp:', '');
                console.log(`   📩 ${time} | From: ${from} | "${msg.body?.substring(0, 60)}"`);
            }
        }
    } catch (err: any) {
        console.error('❌ Error fetching inbound:', err.message);
    }

    console.log('\n=== DELIVERY CHECK COMPLETE ===\n');
}

main().catch(console.error);
