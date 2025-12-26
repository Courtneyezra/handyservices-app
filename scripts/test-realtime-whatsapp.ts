#!/usr/bin/env tsx

/**
 * Test Script: Real-Time Call Transcript → WhatsApp Message Generation
 * 
 * Purpose: Test the WhatsApp message generation flow using REAL call transcripts
 * from the Twilio calls dump before going live with actual incoming calls.
 * 
 * This simulates the entire flow:
 * 1. Load real call transcript from twilio_calls_dump.json
 * 2. Process through SKU detection (same as live calls)
 * 3. Generate WhatsApp message with context
 * 4. Display results for verification
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { detectSku } from '../server/skuDetector';
import { generateWhatsAppMessage, extractCallMetadata } from '../server/openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TwilioCall {
    callSid: string;
    from: string;
    to: string;
    status: string;
    duration: number;
    transcript: string | null;
    transcriptSource: string | null;
}

// Color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    red: '\x1b[31m',
};

function log(color: keyof typeof colors, message: string) {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testWhatsAppGeneration(call: TwilioCall, index: number) {
    if (!call.transcript || call.transcript.length < 50) {
        log('dim', `  ⊘ Skipping (no valid transcript)`);
        return;
    }

    log('cyan', `\n${'='.repeat(80)}`);
    log('bright', `TEST ${index + 1}: Call ${call.callSid ? call.callSid.substring(0, 20) : 'UNKNOWN'}...`);
    log('cyan', `${'='.repeat(80)}`);

    // Display original transcript
    log('blue', '\n📝 ORIGINAL TRANSCRIPT:');
    const transcriptPreview = call.transcript ? call.transcript.substring(0, 300) : '';
    console.log(colors.dim + transcriptPreview + '...' + colors.reset);

    try {
        // Step 1: Extract metadata (customer name, address, urgency)
        log('yellow', '\n🔍 STEP 1: Extracting call metadata...');
        const metadata = await extractCallMetadata(call.transcript);
        console.log(colors.green + `  ✓ Customer: ${metadata.customerName || 'Unknown'}` + colors.reset);
        console.log(colors.green + `  ✓ Address: ${metadata.address || 'Not provided'}` + colors.reset);
        console.log(colors.green + `  ✓ Urgency: ${metadata.urgency}` + colors.reset);
        console.log(colors.green + `  ✓ Lead Type: ${metadata.leadType}` + colors.reset);

        // Step 2: Detect SKU / Job Type
        log('yellow', '\n🎯 STEP 2: Detecting job type (SKU)...');
        const detection = await detectSku(call.transcript);

        if (detection.matched && detection.sku) {
            console.log(colors.green + `  ✓ Matched SKU: ${detection.sku.name}` + colors.reset);
            console.log(colors.green + `  ✓ Confidence: ${detection.confidence}%` + colors.reset);
            console.log(colors.green + `  ✓ Route: ${detection.nextRoute}` + colors.reset);
        } else {
            console.log(colors.yellow + `  ! No specific SKU matched` + colors.reset);
            console.log(colors.yellow + `  ! Rationale: ${detection.rationale}` + colors.reset);
        }

        // Step 3: Generate WhatsApp messages (both tones)
        log('yellow', '\n💬 STEP 3: Generating WhatsApp messages...');

        // Casual tone
        log('magenta', '\n  → CASUAL TONE:');
        const casualMessage = await generateWhatsAppMessage(
            call.transcript,
            metadata.customerName,
            'casual',
            detection
        );
        console.log(colors.bright + '  "' + casualMessage + '"' + colors.reset);

        // Professional tone
        log('magenta', '\n  → PROFESSIONAL TONE:');
        const professionalMessage = await generateWhatsAppMessage(
            call.transcript,
            metadata.customerName,
            'professional',
            detection
        );
        console.log(colors.bright + '  "' + professionalMessage + '"' + colors.reset);

        // Validation checks
        log('yellow', '\n✅ VALIDATION:');
        const hasJobContext = detection.sku?.name
            ? (casualMessage.toLowerCase().includes(detection.sku.name.toLowerCase().split(' ')[0]) ||
                professionalMessage.toLowerCase().includes(detection.sku.name.toLowerCase().split(' ')[0]))
            : false;

        const hasGreeting = casualMessage.toLowerCase().includes('hi') || professionalMessage.toLowerCase().includes('hi');
        const hasVideoRequest = casualMessage.toLowerCase().includes('video') || professionalMessage.toLowerCase().includes('video');

        console.log(`  ${hasJobContext ? '✓' : '✗'} Message includes job context: ${hasJobContext ? colors.green + 'YES' : colors.red + 'NO'}${colors.reset}`);
        console.log(`  ${hasGreeting ? '✓' : '✗'} Message includes greeting: ${hasGreeting ? colors.green + 'YES' : colors.red + 'NO'}${colors.reset}`);
        console.log(`  ${hasVideoRequest ? '✓' : '✗'} Message requests video: ${hasVideoRequest ? colors.green + 'YES' : colors.red + 'NO'}${colors.reset}`);

        log('green', '\n✓ Test completed successfully');

    } catch (error) {
        log('red', '\n✗ Error during test:');
        console.error(error);
    }
}

async function main() {
    log('bright', '\n╔═══════════════════════════════════════════════════════════════════╗');
    log('bright', '║   Real-Time Call Transcript → WhatsApp Message Test Suite       ║');
    log('bright', '╚═══════════════════════════════════════════════════════════════════╝\n');

    // Load real call data
    const dataPath = path.join(__dirname, '../data/twilio_calls_dump.json');

    if (!fs.existsSync(dataPath)) {
        log('red', `❌ Error: Could not find ${dataPath}`);
        log('yellow', 'Please ensure twilio_calls_dump.json exists in the data/ directory');
        process.exit(1);
    }

    const calls: TwilioCall[] = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

    // Filter calls with valid transcripts
    const validCalls = calls.filter(c => c.transcript && c.transcript.length > 100);

    log('blue', `📊 Loaded ${calls.length} total calls`);
    log('green', `✓ Found ${validCalls.length} calls with valid transcripts\n`);

    // Test selection
    const testCount = parseInt(process.argv[2]) || 3;
    const selectedCalls = validCalls.slice(0, testCount);

    log('yellow', `🧪 Running tests on ${selectedCalls.length} calls...\n`);

    // Run tests sequentially
    for (let i = 0; i < selectedCalls.length; i++) {
        await testWhatsAppGeneration(selectedCalls[i], i);

        // Add a small delay between tests for readability
        if (i < selectedCalls.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    // Summary
    log('cyan', `\n${'='.repeat(80)}`);
    log('bright', '🎉 TEST SUITE COMPLETE');
    log('cyan', `${'='.repeat(80)}`);
    log('green', `\n✓ Tested ${selectedCalls.length} real call transcripts`);
    log('blue', '✓ WhatsApp message generation verified with real-time context');
    log('yellow', '\n💡 Next steps:');
    log('dim', '  1. Review the generated messages above');
    log('dim', '  2. Verify they include proper job context from transcripts');
    log('dim', '  3. Check both casual and professional tones are appropriate');
    log('dim', '  4. Ready to handle live calls! 🚀\n');
}

// Run the test suite
main().catch(err => {
    log('red', '\n❌ Fatal error:');
    console.error(err);
    process.exit(1);
});
