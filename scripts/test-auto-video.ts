/**
 * Test script for Auto-Video Service
 *
 * Usage: npx tsx scripts/test-auto-video.ts
 */

import 'dotenv/config';
import { analyzeCallForVideoRequest, generateVideoRequestMessage } from '../server/services/video-context-extractor';
import { processCallForAutoVideo } from '../server/services/auto-video-service';

// Sample transcript where customer agrees to send a video
const SAMPLE_TRANSCRIPT_AGREED = `
Agent: Hello, Handy Services, how can I help you today?
Customer: Hi, I've got a problem with my kitchen tap. It's been leaking for a few days.
Agent: Oh no, that's not good. Can you tell me a bit more about it? Is it leaking from the spout or the base?
Customer: It's leaking from the base, around the handle area.
Agent: Okay, that sounds like the washer or O-ring might need replacing. To give you an accurate quote, could you send us a quick video of the tap and the area underneath the sink?
Customer: Yeah sure, I can do that now.
Agent: Perfect, just send it over on WhatsApp and we'll get back to you with a quote straight away.
Customer: Okay, will do. My name's John by the way.
Agent: Thanks John, speak soon!
`;

// Sample transcript where customer didn't agree
const SAMPLE_TRANSCRIPT_NO_AGREEMENT = `
Agent: Hello, Handy Services, how can I help you today?
Customer: Hi, I need someone to mount a TV on my wall.
Agent: Sure, we can help with that. What size is the TV?
Customer: It's a 55 inch Samsung.
Agent: Great, and is the wall plasterboard or brick?
Customer: I think it's brick.
Agent: Excellent. I can give you a quote right now. For a 55 inch TV on brick, that would be £95 including brackets.
Customer: That sounds good. Can I book that in?
`;

async function runTests() {
    console.log('\n=== AUTO-VIDEO SERVICE TEST ===\n');

    // Test 1: Analyze transcript where customer agreed
    console.log('Test 1: Analyzing transcript with video agreement...');
    console.log('─'.repeat(50));

    const analysis1 = await analyzeCallForVideoRequest(SAMPLE_TRANSCRIPT_AGREED);
    console.log('Result:', JSON.stringify(analysis1, null, 2));
    console.log(`\nShould send: ${analysis1.shouldRequestVideo && analysis1.confidence >= 80 ? 'YES' : 'NO'}`);

    if (analysis1.shouldRequestVideo) {
        const message = generateVideoRequestMessage(analysis1);
        console.log(`\nGenerated message:\n"${message}"`);
    }

    // Test 2: Analyze transcript without video agreement
    console.log('\n\nTest 2: Analyzing transcript WITHOUT video agreement...');
    console.log('─'.repeat(50));

    const analysis2 = await analyzeCallForVideoRequest(SAMPLE_TRANSCRIPT_NO_AGREEMENT);
    console.log('Result:', JSON.stringify(analysis2, null, 2));
    console.log(`\nShould send: ${analysis2.shouldRequestVideo && analysis2.confidence >= 80 ? 'YES' : 'NO'}`);

    // Test 3: Full flow simulation (without actually sending)
    console.log('\n\nTest 3: Simulating full flow (dry run)...');
    console.log('─'.repeat(50));
    console.log('To test the full flow with actual message sending:');
    console.log('1. Make a test call where you ask for a video');
    console.log('2. Check the call logs for videoAnalysis metadata');
    console.log('3. Check /admin/pipeline for the activity stream');
    console.log('4. Check the lead stage is updated to "awaiting_video"');

    console.log('\n=== TESTS COMPLETE ===\n');
}

runTests().catch(console.error);
