import axios from 'axios';

const BASE_URL = 'http://localhost:5001';
const TEST_LEAD = '+447700900123';
const TEST_TWILIO = '+4412345678';
const CALL_SID = 'CA_TEST_' + Date.now();

async function simulate() {
    console.log(`\n🚀 Starting Simulation: Incoming Call from ${TEST_LEAD}`);

    // 1. Incoming Call Webhook
    console.log('--- Step 1: Lead Dials UK Number ---');
    const voiceResponse = await axios.post(`${BASE_URL}/api/twilio/voice`,
        `From=${encodeURIComponent(TEST_LEAD)}&CallSid=${CALL_SID}&To=${encodeURIComponent(TEST_TWILIO)}`,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    console.log('TwiML Response (Conference Bridge):');
    console.log(voiceResponse.data);

    // 2. Agent Answers (Agent Join)
    console.log('\n--- Step 2: Agent Answers in Vietnam ---');
    const agentResponse = await axios.post(`${BASE_URL}/api/twilio/agent-join?conference=Call_${CALL_SID}&leadNumber=${encodeURIComponent(TEST_LEAD)}`, {});
    console.log('TwiML Response (Whisper + Join):');
    console.log(agentResponse.data);

    // 3. Fallback Test (Missed Call)
    console.log('\n--- Step 3: Simulating Missed Call (Fallback) ---');
    const statusResponse = await axios.post(`${BASE_URL}/api/twilio/outbound-status`,
        `CallStatus=no-answer&ParentCallSid=${CALL_SID}&To=${encodeURIComponent(TEST_TWILIO)}&From=${encodeURIComponent(TEST_TWILIO)}`,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    console.log('Status: Missed Call fallback triggered (Check server logs for SMS/Voicemail redirect)');

    console.log('\n✅ Simulation Complete. Check "server-debug.log" for bridge linking events.');
}

simulate().catch(err => console.error('Simulation Failed:', err.message));
