/**
 * Test Twilio WhatsApp Freeform Send
 * Checks if +15558874602 can send freeform (non-template) messages
 *
 * Usage: npx tsx scripts/test-twilio-freeform.ts
 */

import 'dotenv/config';

async function main() {
    const SID = process.env.TWILIO_ACCOUNT_SID;
    const TOKEN = process.env.TWILIO_AUTH_TOKEN;
    const FROM = process.env.TWILIO_WHATSAPP_NUMBER;

    console.log('\n=== TWILIO WHATSAPP FREEFORM SEND TEST ===\n');
    console.log('Account SID:', SID);
    console.log('WhatsApp From:', FROM);

    if (!SID || !TOKEN || !FROM) {
        console.error('❌ Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_WHATSAPP_NUMBER');
        return;
    }

    const auth = Buffer.from(`${SID}:${TOKEN}`).toString('base64');

    // 1. Check WhatsApp Senders
    console.log('\n--- 1. Checking Twilio Phone Numbers ---');
    try {
        const sendersUrl = `https://api.twilio.com/2010-04-01/Accounts/${SID}/IncomingPhoneNumbers.json`;
        const res1 = await fetch(sendersUrl, { headers: { Authorization: `Basic ${auth}` } });
        const data1 = await res1.json() as any;
        console.log('Incoming Phone Numbers:', data1.incoming_phone_numbers?.length || 0);
        for (const num of (data1.incoming_phone_numbers || [])) {
            console.log(`  📱 ${num.phone_number} | ${num.friendly_name} | Capabilities: ${JSON.stringify(num.capabilities)}`);
        }
    } catch (err) {
        console.error('  ❌ Error checking phone numbers:', err);
    }

    // 2. Check Messaging Services
    console.log('\n--- 2. Checking Messaging Services ---');
    try {
        const msUrl = `https://messaging.twilio.com/v1/Services`;
        const res2 = await fetch(msUrl, { headers: { Authorization: `Basic ${auth}` } });
        const data2 = await res2.json() as any;
        console.log('Messaging Services:', data2.services?.length || 0);
        for (const svc of (data2.services || [])) {
            console.log(`  📨 ${svc.friendly_name} | SID: ${svc.sid}`);
        }
    } catch (err) {
        console.error('  ❌ Error checking messaging services:', err);
    }

    // 3. Attempt freeform send
    console.log('\n--- 3. Attempting Freeform Message Send ---');
    const testTo = 'whatsapp:+447508744402';
    const testFrom = `whatsapp:${FROM}`;

    console.log(`From: ${testFrom}`);
    console.log(`To:   ${testTo}`);

    try {
        const formData = new URLSearchParams();
        formData.append('From', testFrom);
        formData.append('To', testTo);
        formData.append('Body', `V6 Switchboard freeform test - ${new Date().toISOString()}`);

        const sendUrl = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`;

        const res3 = await fetch(sendUrl, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData.toString()
        });

        const data3 = await res3.json() as any;

        console.log(`\nHTTP Status: ${res3.status}`);
        if (res3.ok) {
            console.log('✅ FREEFORM SEND SUCCESS!');
            console.log('  Message SID:', data3.sid);
            console.log('  Status:', data3.status);
            console.log('  Direction:', data3.direction);
            console.log('  Date Created:', data3.date_created);
        } else {
            console.log('❌ FREEFORM SEND FAILED');
            console.log('  Error Code:', data3.code);
            console.log('  Error Message:', data3.message);
            console.log('  More Info:', data3.more_info);

            if (data3.code === 63032) {
                console.log('\n  💡 Error 63032: Outside 24hr customer-initiated window.');
                console.log('     → Customer must message you first, OR use an approved template.');
                console.log('     → This is NORMAL for WhatsApp Business API. Freeform only works within 24hrs of last inbound.');
            } else if (data3.code === 21408) {
                console.log('\n  💡 Error 21408: Permission denied. Number not approved for WhatsApp.');
            } else if (data3.code === 63007) {
                console.log('\n  💡 Error 63007: WhatsApp sender not verified on Twilio.');
                console.log('     → Go to Twilio Console > Messaging > WhatsApp Senders');
            } else if (data3.code === 63016) {
                console.log('\n  💡 Error 63016: Number not registered as WhatsApp sender.');
            }
        }
    } catch (err) {
        console.error('  ❌ Request failed:', err);
    }

    console.log('\n=== TEST COMPLETE ===\n');
}

main().catch(console.error);
