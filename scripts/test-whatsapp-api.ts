/**
 * WhatsApp API Debug Script
 *
 * Tests the Meta WhatsApp Cloud API connection
 * Usage: npx tsx scripts/test-whatsapp-api.ts
 */

import 'dotenv/config';

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const GRAPH_API_VERSION = 'v18.0';
const GRAPH_API_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

async function testWhatsAppAPI() {
    console.log('\n=== WHATSAPP API DEBUG ===\n');

    // Check environment variables
    console.log('1. Environment Check:');
    console.log('   Phone Number ID:', PHONE_NUMBER_ID || '❌ NOT SET');
    console.log('   Access Token:', ACCESS_TOKEN ? `✓ Set (${ACCESS_TOKEN.substring(0, 20)}...)` : '❌ NOT SET');

    if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
        console.error('\n❌ Missing required environment variables');
        return;
    }

    // Test 1: Get phone number info
    console.log('\n2. Testing Phone Number Info API...');
    try {
        const phoneInfoUrl = `${GRAPH_API_URL}/${PHONE_NUMBER_ID}?fields=display_phone_number,verified_name,code_verification_status,quality_rating`;
        console.log('   URL:', phoneInfoUrl);

        const response = await fetch(phoneInfoUrl, {
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
            }
        });

        const result = await response.json();

        if (response.ok) {
            console.log('   ✓ Phone number found:');
            console.log('     Display Number:', result.display_phone_number);
            console.log('     Verified Name:', result.verified_name);
            console.log('     Quality Rating:', result.quality_rating);
        } else {
            console.log('   ❌ Error:', JSON.stringify(result, null, 2));
        }
    } catch (error) {
        console.log('   ❌ Request failed:', error);
    }

    // Test 2: Get WhatsApp Business Account info
    console.log('\n3. Testing Access Token / Business Account...');
    try {
        const meUrl = `${GRAPH_API_URL}/me?access_token=${ACCESS_TOKEN}`;

        const response = await fetch(meUrl);
        const result = await response.json();

        if (response.ok) {
            console.log('   ✓ Token is valid');
            console.log('   Account:', JSON.stringify(result, null, 2));
        } else {
            console.log('   ❌ Token error:', JSON.stringify(result, null, 2));
        }
    } catch (error) {
        console.log('   ❌ Request failed:', error);
    }

    // Test 3: List registered phone numbers for the WABA
    console.log('\n4. Listing WhatsApp Business Account phone numbers...');
    try {
        // First get the WABA ID from debug token
        const debugUrl = `${GRAPH_API_URL}/debug_token?input_token=${ACCESS_TOKEN}&access_token=${ACCESS_TOKEN}`;
        const debugResponse = await fetch(debugUrl);
        const debugResult = await debugResponse.json();

        console.log('   Token debug info:');
        console.log('     App ID:', debugResult.data?.app_id);
        console.log('     Type:', debugResult.data?.type);
        console.log('     Expires:', debugResult.data?.expires_at === 0 ? 'Never' : new Date(debugResult.data?.expires_at * 1000).toISOString());
        console.log('     Scopes:', debugResult.data?.scopes?.join(', '));

        // The ID provided might be the WABA ID, not the Phone Number ID
        // Let's try to get phone numbers from it
        console.log('\n   Trying to get phone numbers from WABA ID:', PHONE_NUMBER_ID);
        const wabaUrl = `${GRAPH_API_URL}/${PHONE_NUMBER_ID}/phone_numbers`;
        const wabaResponse = await fetch(wabaUrl, {
            headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}` }
        });
        const wabaResult = await wabaResponse.json();

        if (wabaResponse.ok && wabaResult.data) {
            console.log('\n   ✓ Found phone numbers:');
            for (const phone of wabaResult.data) {
                console.log(`\n   📱 Phone Number ID: ${phone.id}`);
                console.log(`      Display Number: ${phone.display_phone_number}`);
                console.log(`      Verified Name: ${phone.verified_name}`);
                console.log(`      Quality Rating: ${phone.quality_rating}`);
                console.log(`\n   👉 Update your .env with: WHATSAPP_PHONE_NUMBER_ID=${phone.id}`);
            }
        } else {
            console.log('   WABA query result:', JSON.stringify(wabaResult, null, 2));
        }

    } catch (error) {
        console.log('   ❌ Request failed:', error);
    }

    // Test 4: Try sending a test message (to a test number)
    console.log('\n5. Testing message send capability...');
    const testPhone = '447508744402'; // Replace with a real test number

    try {
        const sendUrl = `${GRAPH_API_URL}/${PHONE_NUMBER_ID}/messages`;
        console.log('   URL:', sendUrl);

        const payload = {
            messaging_product: 'whatsapp',
            to: testPhone,
            type: 'text',
            text: { body: 'Test message from auto-video service' }
        };

        console.log('   Payload:', JSON.stringify(payload, null, 2));

        const response = await fetch(sendUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (response.ok) {
            console.log('   ✓ Message sent successfully!');
            console.log('   Result:', JSON.stringify(result, null, 2));
        } else {
            console.log('   ❌ Send failed:');
            console.log('   Status:', response.status);
            console.log('   Error:', JSON.stringify(result, null, 2));

            // Parse common errors
            if (result.error?.code === 100) {
                console.log('\n   💡 Error 100 typically means:');
                console.log('      - Phone Number ID is incorrect');
                console.log('      - Access token lacks permissions for this phone number');
                console.log('      - Phone number not registered in this WhatsApp Business Account');
            }
            if (result.error?.code === 190) {
                console.log('\n   💡 Error 190 means: Access token expired or invalid');
            }
            if (result.error?.code === 131030) {
                console.log('\n   💡 Error 131030 means: Recipient not a valid WhatsApp user');
            }
        }
    } catch (error) {
        console.log('   ❌ Request failed:', error);
    }

    console.log('\n=== DEBUG COMPLETE ===\n');
    console.log('Next steps:');
    console.log('1. Go to Meta Business Suite → WhatsApp Manager');
    console.log('2. Click on "Phone Numbers" in the left sidebar');
    console.log('3. Verify the Phone Number ID matches your .env');
    console.log('4. Ensure the phone number is properly verified');
    console.log('5. Check that the System User has proper permissions');
}

testWhatsAppAPI().catch(console.error);
