
import 'dotenv/config'; // Load env vars
import fetch from 'node-fetch';
import { db } from '../server/db';
import { calls } from '../shared/schema';
import { eq } from 'drizzle-orm';

async function testWebhook() {
    const TEST_CALL_SID = 'CA_TEST_' + Date.now();
    const TEST_CALL_ID = 'test_record_' + Date.now();

    console.log(`Setting up test call: ${TEST_CALL_SID}`);

    // 1. Create Dummy Call
    await db.insert(calls).values({
        id: TEST_CALL_ID,
        callId: TEST_CALL_SID,
        phoneNumber: '+447000000000',
        direction: 'inbound',
        status: 'in-progress',
        startTime: new Date(),
    });

    console.log("Dummy call created. Sending webhook...");

    const payload = {
        type: 'conversation.analysis.completed',
        conversation_id: 'conv_' + Date.now(),
        agent_id: 'agent_abc',
        call_id: TEST_CALL_SID, // Matching SID
        transcript: [
            { role: 'agent', message: 'Hello, testing.', time_in_call_secs: 1 },
            { role: 'user', message: 'This is a test transcript.', time_in_call_secs: 3 }
        ],
        analysis: {
            summary: "This was a successful test call.",
            success: "true",
            data_collection_results: {
                customer_name: { value: "Test User" },
                urgency: { value: "Low" }
            }
        },
        recording_url: "https://example.com/test.mp3"
    };

    try {
        const response = await fetch('http://localhost:5001/api/webhooks/elevenlabs', {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' }
        });

        console.log(`Webhook Response: ${response.status} ${await response.text()}`);

        // 2. Verify Update
        const [updatedCall] = await db.select().from(calls).where(eq(calls.id, TEST_CALL_ID));

        console.log("\n--- Verification ---");
        console.log(`Job Summary: ${updatedCall.jobSummary}`);
        console.log(`Customer Name: ${updatedCall.customerName}`);
        console.log(`Outcome: ${updatedCall.outcome}`);

        if (updatedCall.jobSummary === "This was a successful test call." && updatedCall.outcome === 'ELEVEN_LABS_COMPLETED') {
            console.log("✅ TEST PASSED");
        } else {
            console.log("❌ TEST FAILED - Data mismatch");
        }

    } catch (e) {
        console.error("Test Error:", e);
    }

    process.exit(0);
}

testWebhook();
