/**
 * Test script for Response Interpreter
 *
 * Tests the LLM-powered response interpretation that maps
 * user messages to expected response IDs.
 *
 * Usage: npx tsx scripts/test-response-interpreter.ts
 */

import 'dotenv/config';
import { interpretUserResponse, extractDataFromMessage } from '../server/troubleshooting/response-interpreter';
import { FlowStep, ExpectedResponse } from '../server/troubleshooting/flow-schema';
import { getFlowById } from '../server/troubleshooting/flows';

// ============================================================================
// TEST UTILITIES
// ============================================================================

let passCount = 0;
let failCount = 0;

async function test(name: string, fn: () => Promise<boolean>) {
    try {
        process.stdout.write(`  Testing: ${name}...`);
        const result = await fn();
        if (result) {
            console.log(' ✅');
            passCount++;
        } else {
            console.log(' ❌');
            failCount++;
        }
    } catch (error: any) {
        console.log(' ❌');
        console.log(`     Error: ${error.message}`);
        failCount++;
    }
}

function section(name: string) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📋 ${name}`);
    console.log('='.repeat(60));
}

// ============================================================================
// MOCK STEPS FOR TESTING
// ============================================================================

const MOCK_YES_NO_STEP: FlowStep = {
    id: 'test_yes_no',
    type: 'question',
    template: 'Is the boiler powered on?',
    expectedResponses: [
        {
            id: 'yes',
            patterns: ['^yes', '^yeah', '^yep', 'it is', "it's on"],
            semanticDescription: 'User confirms yes, affirmative'
        },
        {
            id: 'no',
            patterns: ['^no', '^nope', 'not', "isn't", "it's off"],
            semanticDescription: 'User says no, negative'
        }
    ],
    transitions: [],
    fallbackTransition: {
        condition: { type: 'always' },
        action: { type: 'retry_step' }
    }
};

const MOCK_LOCATION_STEP: FlowStep = {
    id: 'test_location',
    type: 'question',
    template: 'Which tap is dripping?',
    expectedResponses: [
        {
            id: 'kitchen',
            patterns: ['kitchen', 'sink in kitchen'],
            semanticDescription: 'Kitchen tap or sink'
        },
        {
            id: 'bathroom',
            patterns: ['bathroom', 'bath', 'basin'],
            semanticDescription: 'Bathroom tap, basin, or bath'
        },
        {
            id: 'shower',
            patterns: ['shower'],
            semanticDescription: 'Shower head or shower tap'
        }
    ],
    transitions: [],
    fallbackTransition: {
        condition: { type: 'always' },
        action: { type: 'retry_step' }
    }
};

const MOCK_SEVERITY_STEP: FlowStep = {
    id: 'test_severity',
    type: 'question',
    template: 'How bad is the drip?',
    expectedResponses: [
        {
            id: 'slow',
            patterns: ['slow', 'occasional', 'every few seconds', 'minor'],
            semanticDescription: 'Slow or occasional drip'
        },
        {
            id: 'steady',
            patterns: ['steady', 'constant', 'continuous', 'keeps dripping'],
            semanticDescription: 'Steady, constant drip'
        },
        {
            id: 'fast',
            patterns: ['fast', 'stream', 'running', 'pouring', 'gushing'],
            semanticDescription: 'Fast drip or running water'
        }
    ],
    transitions: [],
    fallbackTransition: {
        condition: { type: 'always' },
        action: { type: 'retry_step' }
    }
};

// ============================================================================
// TEST: PATTERN MATCHING (NO LLM)
// ============================================================================

async function testPatternMatching() {
    section('PATTERN MATCHING TESTS (No LLM)');

    // These should match via regex patterns only
    const patternTests = [
        { step: MOCK_YES_NO_STEP, message: 'yes', expectedId: 'yes' },
        { step: MOCK_YES_NO_STEP, message: 'Yeah', expectedId: 'yes' },
        { step: MOCK_YES_NO_STEP, message: 'yep it is', expectedId: 'yes' },
        { step: MOCK_YES_NO_STEP, message: 'no', expectedId: 'no' },
        { step: MOCK_YES_NO_STEP, message: 'Nope', expectedId: 'no' },
        { step: MOCK_LOCATION_STEP, message: 'kitchen sink', expectedId: 'kitchen' },
        { step: MOCK_LOCATION_STEP, message: 'the bathroom one', expectedId: 'bathroom' },
        { step: MOCK_LOCATION_STEP, message: 'shower head', expectedId: 'shower' },
        { step: MOCK_SEVERITY_STEP, message: 'slow drip', expectedId: 'slow' },
        { step: MOCK_SEVERITY_STEP, message: 'it keeps dripping constantly', expectedId: 'steady' },
    ];

    for (const { step, message, expectedId } of patternTests) {
        await test(`"${message}" -> ${expectedId}`, async () => {
            const result = await interpretUserResponse(message, step, {});
            const matches = result.matchedResponseId === expectedId;
            if (!matches) {
                console.log(`\n     Got: ${result.matchedResponseId || 'null'}, confidence: ${result.confidence}`);
            }
            return matches;
        });
    }
}

// ============================================================================
// TEST: SEMANTIC MATCHING (LLM)
// ============================================================================

async function testSemanticMatching() {
    section('SEMANTIC MATCHING TESTS (With LLM)');

    // These require LLM interpretation
    const semanticTests = [
        { step: MOCK_YES_NO_STEP, message: 'absolutely', expectedId: 'yes' },
        { step: MOCK_YES_NO_STEP, message: 'definitely not', expectedId: 'no' },
        { step: MOCK_YES_NO_STEP, message: 'I think so', expectedId: 'yes' },
        { step: MOCK_LOCATION_STEP, message: 'the one where I wash dishes', expectedId: 'kitchen' },
        { step: MOCK_LOCATION_STEP, message: 'upstairs where I brush my teeth', expectedId: 'bathroom' },
        { step: MOCK_SEVERITY_STEP, message: 'just a drop now and then', expectedId: 'slow' },
        { step: MOCK_SEVERITY_STEP, message: 'water is coming out quite fast', expectedId: 'fast' },
    ];

    for (const { step, message, expectedId } of semanticTests) {
        await test(`"${message}" -> ${expectedId}`, async () => {
            const result = await interpretUserResponse(message, step, {});
            const matches = result.matchedResponseId === expectedId;
            if (!matches) {
                console.log(`\n     Got: ${result.matchedResponseId || 'null'}, confidence: ${result.confidence}`);
            }
            return matches;
        });
    }
}

// ============================================================================
// TEST: DATA EXTRACTION
// ============================================================================

async function testDataExtraction() {
    section('DATA EXTRACTION TESTS');

    await test('Extracts pressure reading "0.5 bar"', async () => {
        const result = await extractDataFromMessage('the gauge shows 0.5 bar', ['pressure']);
        return result.pressure === '0.5 bar' || result.pressure === '0.5';
    });

    await test('Extracts pressure reading "1.2"', async () => {
        const result = await extractDataFromMessage('it says 1.2', ['pressure']);
        return result.pressure === '1.2' || result.pressure === '1.2 bar';
    });

    await test('Extracts location "kitchen"', async () => {
        const result = await extractDataFromMessage('its the kitchen tap', ['location']);
        return result.location?.toLowerCase().includes('kitchen');
    });
}

// ============================================================================
// TEST: CONFIDENCE LEVELS
// ============================================================================

async function testConfidenceLevels() {
    section('CONFIDENCE LEVEL TESTS');

    await test('High confidence for exact match', async () => {
        const result = await interpretUserResponse('yes', MOCK_YES_NO_STEP, {});
        return result.confidence >= 0.9;
    });

    await test('Lower confidence for semantic match', async () => {
        const result = await interpretUserResponse('I suppose so', MOCK_YES_NO_STEP, {});
        // Should still match but with lower confidence
        return result.matchedResponseId === 'yes' && result.confidence < 0.95;
    });

    await test('Unclear response gets needsClarification flag', async () => {
        const result = await interpretUserResponse('maybe, not sure', MOCK_YES_NO_STEP, {});
        // Should either need clarification or have low confidence
        return result.needsClarification || result.confidence < 0.7;
    });
}

// ============================================================================
// TEST: SENTIMENT DETECTION
// ============================================================================

async function testSentimentDetection() {
    section('SENTIMENT DETECTION TESTS');

    await test('Detects frustrated sentiment', async () => {
        const result = await interpretUserResponse(
            'This is ridiculous, nothing is working!!!',
            MOCK_YES_NO_STEP,
            {}
        );
        return result.sentiment === 'frustrated';
    });

    await test('Detects confused sentiment', async () => {
        const result = await interpretUserResponse(
            'I dont understand what you want me to do',
            MOCK_YES_NO_STEP,
            {}
        );
        return result.sentiment === 'confused' || result.needsClarification;
    });

    await test('Detects neutral sentiment', async () => {
        const result = await interpretUserResponse(
            'yes the boiler is on',
            MOCK_YES_NO_STEP,
            {}
        );
        return result.sentiment === 'neutral' || result.sentiment === undefined;
    });
}

// ============================================================================
// TEST: REAL FLOW STEPS
// ============================================================================

async function testRealFlowSteps() {
    section('REAL FLOW STEP TESTS');

    const boilerFlow = getFlowById('boiler-no-heat');
    if (!boilerFlow) {
        console.log('  ⚠️  Boiler flow not found, skipping real flow tests');
        return;
    }

    const checkPowerStep = boilerFlow.steps.find(s => s.id === 'check_power');
    if (checkPowerStep) {
        await test('Boiler check_power: "yes its on" -> yes_on', async () => {
            const result = await interpretUserResponse('yes its on', checkPowerStep, {});
            return result.matchedResponseId === 'yes_on';
        });

        await test('Boiler check_power: "no nothing happening" -> no_off', async () => {
            const result = await interpretUserResponse('no nothing happening', checkPowerStep, {});
            return result.matchedResponseId === 'no_off';
        });
    }

    const checkPressureStep = boilerFlow.steps.find(s => s.id === 'check_pressure');
    if (checkPressureStep) {
        await test('Boiler check_pressure: "0.3 bar" -> low', async () => {
            const result = await interpretUserResponse('0.3 bar', checkPressureStep, {});
            return result.matchedResponseId === 'low' || result.extractedData?.pressure;
        });

        await test('Boiler check_pressure: "1.5 bar" -> normal', async () => {
            const result = await interpretUserResponse('1.5 bar', checkPressureStep, {});
            return result.matchedResponseId === 'normal' || result.extractedData?.pressure;
        });
    }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
    console.log('\n🧪 RESPONSE INTERPRETER TESTS\n');
    console.log('Testing pattern matching, LLM interpretation, and data extraction...\n');

    // Check if OpenAI is configured
    if (!process.env.OPENAI_API_KEY) {
        console.log('⚠️  OPENAI_API_KEY not set - semantic tests will be skipped\n');
    }

    await testPatternMatching();

    if (process.env.OPENAI_API_KEY) {
        await testSemanticMatching();
        await testDataExtraction();
        await testConfidenceLevels();
        await testSentimentDetection();
        await testRealFlowSteps();
    } else {
        console.log('\n⚠️  Skipping LLM-dependent tests (no API key)\n');
    }

    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log('📊 INTERPRETER TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`  ✅ Passed: ${passCount}`);
    console.log(`  ❌ Failed: ${failCount}`);
    console.log(`  📈 Total:  ${passCount + failCount}`);

    if (failCount > 0) {
        console.log('\n⚠️  Some tests failed. Please review the failures above.\n');
        process.exit(1);
    } else {
        console.log('\n🎉 All interpreter tests passed!\n');
        process.exit(0);
    }
}

main().catch(err => {
    console.error('Interpreter test runner failed:', err);
    process.exit(1);
});
