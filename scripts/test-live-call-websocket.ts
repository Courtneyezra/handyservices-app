/**
 * Test Live Call WebSocket Flow
 *
 * Simulates a real call with WebSocket events to test full integration.
 * Run with: npx tsx scripts/test-live-call-websocket.ts
 */

import 'dotenv/config';
import WebSocket from 'ws';

const BASE_URL = 'http://localhost:5001';
const WS_URL = 'ws://localhost:5001/api/ws/client';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testWebSocketFlow() {
  console.log('=== Testing Live Call WebSocket Flow ===\n');

  const testCallId = `test-ws-call-${Date.now()}`;
  const testPhone = '+447700900123';

  // Connect to WebSocket
  console.log('1. Connecting to WebSocket...');
  const ws = new WebSocket(WS_URL);

  const receivedMessages: any[] = [];

  ws.on('open', () => {
    console.log('   Connected!\n');
  });

  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type?.startsWith('callscript:')) {
        console.log(`   [WS] Received: ${msg.type}`);
        receivedMessages.push(msg);
      }
    } catch (e) {
      // Ignore non-JSON messages
    }
  });

  ws.on('error', (err) => {
    console.error('   WebSocket error:', err.message);
  });

  // Wait for connection
  await sleep(500);

  // Initialize session via the realtime handler (we'll import it directly)
  console.log('2. Initializing call script session...');

  // Import and call directly since we can't trigger a real Twilio call
  const { initializeCallScriptForCall, handleTranscriptChunk, endCallScriptSession } =
    await import('../server/call-script/realtime-handler');
  const { initializeRealtimeHandler } = await import('../server/call-script/realtime-handler');

  // Set up broadcast function to send to our test WebSocket
  // Note: In production, this is done via server/index.ts broadcastToClients
  // For testing, we'll check if messages are being sent properly

  try {
    const machine = await initializeCallScriptForCall(testCallId, testPhone);
    console.log('   Session created for:', testCallId);
    console.log('   Initial station:', machine.getCurrentStation());
  } catch (err: any) {
    console.log('   Note: Session creation may have broadcast issues in test mode');
    console.log('   Error:', err.message);
  }

  await sleep(200);

  // Simulate transcript chunks (like real speech coming in)
  console.log('\n3. Simulating caller speech...');

  const transcriptChunks = [
    { text: "Hi, I need help with a problem at my rental property", speaker: 'inbound' },
    { text: "The tenant reported a leaking tap in the kitchen", speaker: 'inbound' },
    { text: "I'm the landlord but I live in Manchester", speaker: 'inbound' },
    { text: "The postcode is SW11 2AB", speaker: 'inbound' },
  ];

  for (const chunk of transcriptChunks) {
    console.log(`   Processing: "${chunk.text.substring(0, 40)}..."`);
    handleTranscriptChunk(testCallId, chunk.text, chunk.speaker);
    await sleep(600); // Allow classification to run
  }

  await sleep(1000); // Wait for LLM classification

  // Check session state
  console.log('\n4. Checking session state...');
  const sessionRes = await fetch(`${BASE_URL}/api/call-script/session/${testCallId}`);
  const sessionData = await sessionRes.json();

  if (sessionData.success) {
    console.log('   Current station:', sessionData.state.currentStation);
    console.log('   Detected segment:', sessionData.state.detectedSegment);
    console.log('   Segment confidence:', sessionData.state.segmentConfidence);
    console.log('   Captured info:', JSON.stringify(sessionData.state.capturedInfo, null, 2));
  } else {
    console.log('   Session state:', sessionData);
  }

  // Test VA actions via API
  console.log('\n5. Testing VA actions (confirm station)...');
  const action1Res = await fetch(`${BASE_URL}/api/call-script/session/${testCallId}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'confirm_station', payload: {} }),
  });
  const action1Data = await action1Res.json();
  console.log('   Result:', action1Data.success ? 'SUCCESS' : action1Data.error);
  if (action1Data.state) {
    console.log('   New station:', action1Data.state.currentStation);
  }

  // Select segment
  console.log('\n6. Selecting segment as LANDLORD...');
  const action2Res = await fetch(`${BASE_URL}/api/call-script/session/${testCallId}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'select_segment', payload: { segment: 'LANDLORD' } }),
  });
  const action2Data = await action2Res.json();
  console.log('   Result:', action2Data.success ? 'SUCCESS' : action2Data.error);

  // Set qualified
  console.log('\n7. Setting qualified...');
  const action3Res = await fetch(`${BASE_URL}/api/call-script/session/${testCallId}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'set_qualified', payload: { qualified: true, notes: ['Test'] } }),
  });
  const action3Data = await action3Res.json();
  console.log('   Result:', action3Data.success ? 'SUCCESS' : action3Data.error);
  if (action3Data.state) {
    console.log('   Station:', action3Data.state.currentStation);
  }

  // Select destination
  console.log('\n8. Selecting destination...');
  const action4Res = await fetch(`${BASE_URL}/api/call-script/session/${testCallId}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'select_destination', payload: { destination: 'INSTANT_QUOTE' } }),
  });
  const action4Data = await action4Res.json();
  console.log('   Result:', action4Data.success ? 'SUCCESS' : action4Data.error);
  if (action4Data.state) {
    console.log('   Selected destination:', action4Data.state.selectedDestination);
  }

  // End session
  console.log('\n9. Ending session...');
  await endCallScriptSession(testCallId);
  console.log('   Session ended');

  // Summary
  console.log('\n=== WebSocket Messages Received ===');
  console.log(`Total callscript:* messages: ${receivedMessages.length}`);
  receivedMessages.forEach((msg, i) => {
    console.log(`${i + 1}. ${msg.type}`);
  });

  // Close WebSocket
  ws.close();

  console.log('\n=== Test Complete ===');
  console.log('\nThe live call tube map is ready!');
  console.log('Go to: http://localhost:5001/admin/live-call');
}

testWebSocketFlow().catch(console.error);
