/**
 * Test the video_request WhatsApp template
 * 
 * Usage: npx tsx scripts/test-video-request-template.ts <phone_number>
 * Example: npx tsx scripts/test-video-request-template.ts +447123456789
 */

import 'dotenv/config';

const PHONE = process.argv[2];

if (!PHONE) {
    console.error('Usage: npx tsx scripts/test-video-request-template.ts <phone_number>');
    console.error('Example: npx tsx scripts/test-video-request-template.ts +447123456789');
    process.exit(1);
}

const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) {
    console.error('Missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN in .env');
    process.exit(1);
}

async function sendTestTemplate() {
    const cleanNumber = PHONE.replace(/\D/g, '');
    
    // Test parameters
    const customerName = 'Test';
    const videoSubject = 'the leaking tap';
    
    const payload = {
        messaging_product: 'whatsapp',
        to: cleanNumber,
        type: 'template',
        template: {
            name: 'video_request',
            language: { code: 'en_GB' },
            components: [
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', text: customerName },      // {{customer_name}}
                        { type: 'text', text: videoSubject }       // {{video_subject}}
                    ]
                }
            ]
        }
    };
    
    console.log('\n📱 Sending video_request template...');
    console.log('To:', cleanNumber);
    console.log('Parameters:');
    console.log('  {{customer_name}}:', customerName);
    console.log('  {{video_subject}}:', videoSubject);
    console.log('\nPayload:', JSON.stringify(payload, null, 2));
    
    const response = await fetch(
        `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        }
    );
    
    const result = await response.json();
    
    if (!response.ok) {
        console.error('\n❌ Error:', result.error?.message || result);
        console.error('Full response:', JSON.stringify(result, null, 2));
        process.exit(1);
    }
    
    console.log('\n✅ Template sent successfully!');
    console.log('Message ID:', result.messages?.[0]?.id);
    console.log('\nCheck your WhatsApp for the message.');
}

sendTestTemplate().catch(console.error);
