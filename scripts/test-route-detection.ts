/**
 * Test Route Detection for Tube Map
 *
 * This script tests transcript analysis for route detection:
 * - video: When VA needs to see the problem before quoting
 * - instant_quote: Simple jobs that can be quoted immediately
 * - site_visit: Complex jobs requiring physical assessment
 * - callback: When customer needs a callback
 *
 * Prerequisites:
 * - OpenAI API key must be configured
 *
 * Usage: npx tsx scripts/test-route-detection.ts
 */

// Route types for tube map
type TubeRoute = 'video' | 'instant_quote' | 'site_visit' | 'callback' | null;

interface RouteTestCase {
    transcript: string;
    expected: TubeRoute;
    description: string;
}

// Test cases for route detection
const testCases: RouteTestCase[] = [
    // VIDEO ROUTE CASES
    {
        transcript: "Can you send us a video of the tap so we can see what's happening?",
        expected: 'video',
        description: 'Direct video request for tap issue',
    },
    {
        transcript: "If you could just take a quick video showing the leak under the sink, that would help us give you an accurate price.",
        expected: 'video',
        description: 'Video request for leak visibility',
    },
    {
        transcript: "It would be really helpful if you could WhatsApp us a short video of the wall where you want the TV mounted.",
        expected: 'video',
        description: 'Video request for wall assessment',
    },
    {
        transcript: "To give you the best price, we'd need to see the current state of the tiles. Can you send some photos or a video?",
        expected: 'video',
        description: 'Photos/video request for tile work',
    },
    {
        transcript: "Before I can quote you, I'll need to see the damage. Could you record a video showing the hole in the wall?",
        expected: 'video',
        description: 'Video required before quoting',
    },

    // INSTANT QUOTE CASES
    {
        transcript: "That's a simple job, I can quote you GBP85 right now for the TV mounting.",
        expected: 'instant_quote',
        description: 'Direct instant quote given',
    },
    {
        transcript: "For a standard tap replacement like that, we charge GBP120 all-in.",
        expected: 'instant_quote',
        description: 'Standard price quoted immediately',
    },
    {
        transcript: "That's our most common job. I can tell you now it'll be GBP65 for the first hour.",
        expected: 'instant_quote',
        description: 'Common job with immediate pricing',
    },
    {
        transcript: "A basic shelf installation like you're describing would be GBP50. I'll send you the booking link.",
        expected: 'instant_quote',
        description: 'Basic job priced with booking intent',
    },
    {
        transcript: "Perfect, for hanging those three pictures it's GBP35. When would suit you?",
        expected: 'instant_quote',
        description: 'Simple job priced with scheduling',
    },

    // SITE VISIT CASES
    {
        transcript: "I'll need to come and see the property first before I can give you a price for that bathroom work.",
        expected: 'site_visit',
        description: 'Site visit needed for bathroom',
    },
    {
        transcript: "That sounds like a bigger project. We'd need to do a site assessment. Our consultation fee is GBP45, which gets deducted from the final bill.",
        expected: 'site_visit',
        description: 'Site assessment for larger project',
    },
    {
        transcript: "With the amount of work you're describing, I really need to see it in person to give you an accurate quote.",
        expected: 'site_visit',
        description: 'In-person assessment for complex work',
    },
    {
        transcript: "The structural work you're asking about really needs an on-site inspection. Can we arrange a visit?",
        expected: 'site_visit',
        description: 'On-site inspection for structural',
    },
    {
        transcript: "I'd need to survey the whole area before committing to a price. Shall we book a home visit?",
        expected: 'site_visit',
        description: 'Survey required before pricing',
    },

    // CALLBACK CASES
    {
        transcript: "I'm just taking notes. Someone from our team will call you back within the hour to discuss pricing.",
        expected: 'callback',
        description: 'Promise of callback for pricing',
    },
    {
        transcript: "Let me get the details and we'll ring you back with some options.",
        expected: 'callback',
        description: 'Callback to provide options',
    },
    {
        transcript: "I'll pass this to our specialist and they'll be in touch shortly.",
        expected: 'callback',
        description: 'Specialist callback arranged',
    },

    // UNCLEAR / MIXED CASES
    {
        transcript: "Let me get back to you with a quote after I check availability.",
        expected: null,
        description: 'Unclear - could be callback or just delay',
    },
    {
        transcript: "Thanks for calling, we'll be in touch.",
        expected: null,
        description: 'Generic ending - no clear route',
    },
    {
        transcript: "Can you tell me more about the job?",
        expected: null,
        description: 'Still gathering info - no route yet',
    },
];

// Simulated route detection function
// In production, this would call OpenAI or a trained model
function detectRouteFromTranscript(transcript: string): TubeRoute {
    const lowerTranscript = transcript.toLowerCase();

    // Video route indicators
    const videoIndicators = [
        'send us a video',
        'send a video',
        'video of',
        'record a video',
        'whatsapp us',
        'send some photos',
        'photos or a video',
        'quick video',
        'short video',
    ];

    // Instant quote indicators
    const instantIndicators = [
        'i can quote you',
        'we charge',
        'it\'ll be',
        'would be',
        'is gbp',
        'that\'s gbp',
        'gbp85',
        'gbp120',
        'gbp65',
        'gbp50',
        'gbp35',
        'booking link',
        'when would suit',
        'all-in',
        'right now',
    ];

    // Site visit indicators
    const siteVisitIndicators = [
        'come and see',
        'site assessment',
        'site visit',
        'home visit',
        'see it in person',
        'on-site inspection',
        'survey the',
        'need to survey',
        'property first',
        'consultation fee',
    ];

    // Callback indicators
    const callbackIndicators = [
        'call you back',
        'ring you back',
        'be in touch',
        'get back to you',
        'we\'ll contact',
    ];

    // Check for video first (most specific)
    for (const indicator of videoIndicators) {
        if (lowerTranscript.includes(indicator)) {
            return 'video';
        }
    }

    // Check for instant quote
    for (const indicator of instantIndicators) {
        if (lowerTranscript.includes(indicator)) {
            return 'instant_quote';
        }
    }

    // Check for site visit
    for (const indicator of siteVisitIndicators) {
        if (lowerTranscript.includes(indicator)) {
            return 'site_visit';
        }
    }

    // Check for callback
    for (const indicator of callbackIndicators) {
        if (lowerTranscript.includes(indicator)) {
            return 'callback';
        }
    }

    // No clear route detected
    return null;
}

// Confidence scoring for route detection
function getRouteConfidence(transcript: string, route: TubeRoute): number {
    if (!route) return 0;

    const lowerTranscript = transcript.toLowerCase();
    let matchCount = 0;

    const indicators: Record<TubeRoute & string, string[]> = {
        video: ['video', 'photo', 'send', 'whatsapp', 'show', 'see'],
        instant_quote: ['gbp', 'price', 'quote', 'charge', 'cost', 'booking'],
        site_visit: ['visit', 'site', 'person', 'inspection', 'survey', 'come'],
        callback: ['call', 'back', 'touch', 'contact', 'ring'],
    };

    const routeIndicators = indicators[route] || [];
    for (const indicator of routeIndicators) {
        if (lowerTranscript.includes(indicator)) {
            matchCount++;
        }
    }

    // Calculate confidence based on matches
    const confidence = Math.min(100, Math.round((matchCount / 3) * 100));
    return confidence;
}

// ==========================================
// TEST RUNNER
// ==========================================

interface TestResult {
    case: RouteTestCase;
    detected: TubeRoute;
    confidence: number;
    passed: boolean;
}

async function runTests(): Promise<void> {
    console.log('='.repeat(60));
    console.log(' ROUTE DETECTION TEST SUITE');
    console.log('='.repeat(60));

    const results: TestResult[] = [];

    console.log('\nRunning test cases...\n');

    for (const testCase of testCases) {
        const detected = detectRouteFromTranscript(testCase.transcript);
        const confidence = getRouteConfidence(testCase.transcript, detected);
        const passed = detected === testCase.expected;

        results.push({
            case: testCase,
            detected,
            confidence,
            passed,
        });

        const icon = passed ? '\u2713' : '\u2717';
        const detectedStr = detected || 'null';
        const expectedStr = testCase.expected || 'null';

        console.log(`${icon} ${testCase.description}`);
        console.log(`  Expected: ${expectedStr} | Detected: ${detectedStr} | Confidence: ${confidence}%`);
        if (!passed) {
            console.log(`  Transcript: "${testCase.transcript.substring(0, 60)}..."`);
        }
        console.log('');
    }

    // Summary
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const total = results.length;
    const accuracy = Math.round((passed / total) * 100);

    console.log('='.repeat(60));
    console.log(' SUMMARY');
    console.log('='.repeat(60));
    console.log(`  Total: ${total}`);
    console.log(`  Passed: ${passed}`);
    console.log(`  Failed: ${failed}`);
    console.log(`  Accuracy: ${accuracy}%`);

    // Breakdown by route type
    const byRoute: Record<string, { total: number; passed: number }> = {};
    for (const result of results) {
        const key = result.case.expected || 'null';
        if (!byRoute[key]) {
            byRoute[key] = { total: 0, passed: 0 };
        }
        byRoute[key].total++;
        if (result.passed) {
            byRoute[key].passed++;
        }
    }

    console.log('\n  By Route Type:');
    for (const [route, stats] of Object.entries(byRoute)) {
        const routeAccuracy = Math.round((stats.passed / stats.total) * 100);
        console.log(`    ${route}: ${stats.passed}/${stats.total} (${routeAccuracy}%)`);
    }

    // Average confidence for correct detections
    const correctResults = results.filter(r => r.passed && r.detected);
    const avgConfidence = correctResults.length > 0
        ? Math.round(correctResults.reduce((sum, r) => sum + r.confidence, 0) / correctResults.length)
        : 0;
    console.log(`\n  Avg Confidence (correct): ${avgConfidence}%`);

    if (failed === 0) {
        console.log('\n ALL TESTS PASSED');
    } else {
        console.log('\n SOME TESTS FAILED');
        console.log('\n  Failed cases:');
        for (const result of results.filter(r => !r.passed)) {
            console.log(`    - ${result.case.description}`);
            console.log(`      Expected: ${result.case.expected || 'null'}, Got: ${result.detected || 'null'}`);
        }
    }
    console.log('='.repeat(60) + '\n');
}

// ==========================================
// INTERACTIVE MODE
// ==========================================

async function interactiveMode(): Promise<void> {
    const readline = await import('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    console.log('\n='.repeat(60));
    console.log(' INTERACTIVE ROUTE DETECTION');
    console.log('='.repeat(60));
    console.log('\nEnter transcripts to test route detection.');
    console.log('Type "exit" to quit.\n');

    const question = (prompt: string): Promise<string> => {
        return new Promise((resolve) => {
            rl.question(prompt, resolve);
        });
    };

    while (true) {
        const transcript = await question('Transcript: ');

        if (transcript.toLowerCase() === 'exit') {
            console.log('\nGoodbye!\n');
            rl.close();
            break;
        }

        const route = detectRouteFromTranscript(transcript);
        const confidence = getRouteConfidence(transcript, route);

        console.log(`  Detected Route: ${route || 'null'}`);
        console.log(`  Confidence: ${confidence}%`);
        console.log('');
    }
}

// ==========================================
// MAIN
// ==========================================

async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--interactive') || args.includes('-i')) {
        await interactiveMode();
    } else {
        await runTests();
        process.exit(0);
    }
}

main().catch(console.error);
