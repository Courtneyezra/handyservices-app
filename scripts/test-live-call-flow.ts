/**
 * Test Live Call Flow
 *
 * Simulates a real call coming in to verify the full tube map integration works.
 * Run with: npx tsx scripts/test-live-call-flow.ts
 */

import 'dotenv/config';

const BASE_URL = 'http://localhost:5001';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testLiveCallFlow() {
  console.log('=== Testing Live Call Tube Map Flow ===\n');

  const testCallId = `test-call-${Date.now()}`;
  const testPhone = '+447700900123';

  // Step 1: Check if there's an existing session (should be none)
  console.log('1. Checking for existing session...');
  const checkRes = await fetch(`${BASE_URL}/api/call-script/session/${testCallId}`);
  const checkData = await checkRes.json();
  console.log('   Response:', checkData.success ? 'No session yet' : checkData.error || 'Error');

  // Step 2: Simulate call start by posting to create a session
  console.log('\n2. Creating new session (simulating call start)...');

  // We need to call the backend initialization directly
  // Since we can't call initializeCallScriptForCall from here, let's use the API
  // First, let's check if there's an endpoint to create a session

  // Check active sessions
  const sessionsRes = await fetch(`${BASE_URL}/api/call-script/sessions`);
  const sessionsData = await sessionsRes.json();
  console.log('   Active sessions:', sessionsData.sessions?.length || 0);

  // Step 3: Test the action endpoint structure
  console.log('\n3. Testing action endpoint (will fail without active session)...');
  const actionRes = await fetch(`${BASE_URL}/api/call-script/session/${testCallId}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'confirm_station', payload: {} }),
  });
  const actionData = await actionRes.json();
  console.log('   Response:', actionData);

  console.log('\n=== Direct State Machine Test ===\n');

  // Since we can't easily trigger a real call, let's verify the state machine works
  // by importing it directly
  const { CallScriptStateMachine } = await import('../server/call-script/state-machine');

  const machine = new CallScriptStateMachine(testCallId);
  console.log('4. Created state machine for call:', testCallId);
  console.log('   Initial station:', machine.getCurrentStation());
  console.log('   Initial state:', JSON.stringify(machine.toJSON(), null, 2));

  // Simulate transcript detection
  console.log('\n5. Simulating segment detection...');
  machine.updateSegment('LANDLORD', 75, ['rental property', 'tenant']);
  console.log('   Detected segment:', machine.toJSON().detectedSegment);
  console.log('   Confidence:', machine.toJSON().segmentConfidence);

  // Update captured info
  console.log('\n6. Simulating info capture...');
  machine.updateCapturedInfo({
    job: 'Leaking tap in bathroom',
    postcode: 'SW11 2AB',
    name: 'John Smith',
  });
  console.log('   Captured info:', machine.toJSON().capturedInfo);

  // Advance to SEGMENT station
  console.log('\n7. Confirming LISTEN station...');
  const advanceResult = machine.confirmStation();
  console.log('   Result:', advanceResult);
  console.log('   Current station:', machine.getCurrentStation());

  // Confirm segment
  console.log('\n8. Confirming segment as LANDLORD...');
  machine.confirmSegment('LANDLORD');
  console.log('   Confirmed segment:', machine.toJSON().detectedSegment);

  // Advance to QUALIFY
  console.log('\n9. Confirming SEGMENT station...');
  const advanceResult2 = machine.confirmStation();
  console.log('   Result:', advanceResult2);
  console.log('   Current station:', machine.getCurrentStation());

  // Set qualified
  console.log('\n10. Setting qualified...');
  machine.setQualified(true, ['Decision maker confirmed']);
  console.log('    Qualified:', machine.toJSON().isQualified);

  // Advance to DESTINATION
  console.log('\n11. Confirming QUALIFY station...');
  const advanceResult3 = machine.confirmStation();
  console.log('    Result:', advanceResult3);
  console.log('    Current station:', machine.getCurrentStation());
  console.log('    Recommended destination:', machine.toJSON().recommendedDestination);

  // Select destination
  console.log('\n12. Selecting INSTANT_QUOTE destination...');
  machine.selectDestination('INSTANT_QUOTE');
  console.log('    Selected destination:', machine.toJSON().selectedDestination);

  // Final state
  console.log('\n=== Final State ===');
  console.log(JSON.stringify(machine.toJSON(), null, 2));

  console.log('\n=== Test Complete ===');
  console.log('\nTo test with real calls:');
  console.log('1. Go to http://localhost:5001/admin/live-call');
  console.log('2. Make a call to your Twilio number');
  console.log('3. Watch the tube map activate and guide the conversation');
}

testLiveCallFlow().catch(console.error);
