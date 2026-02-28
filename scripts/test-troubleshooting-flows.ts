/**
 * Test script for Troubleshooting Flow Definitions and Engine
 *
 * Tests:
 * 1. Flow registry - all flows load correctly
 * 2. Flow structure - steps, transitions, expected responses
 * 3. Flow selection - keyword matching and category matching
 * 4. Response interpretation - pattern matching and semantic matching
 *
 * Usage: npx tsx scripts/test-troubleshooting-flows.ts
 */

import 'dotenv/config';
import { FLOW_REGISTRY, getFlowById, findFlowByKeywords, getFlowsByCategory, getAllFlowIds } from '../server/troubleshooting/flows';
import { TroubleshootingFlow, FlowStep } from '../server/troubleshooting/flow-schema';
import { selectFlowForIssue } from '../server/troubleshooting/flow-engine';

// ============================================================================
// TEST UTILITIES
// ============================================================================

let passCount = 0;
let failCount = 0;

function test(name: string, fn: () => boolean | Promise<boolean>) {
    return async () => {
        try {
            const result = await fn();
            if (result) {
                console.log(`  ✅ ${name}`);
                passCount++;
            } else {
                console.log(`  ❌ ${name}`);
                failCount++;
            }
        } catch (error: any) {
            console.log(`  ❌ ${name}`);
            console.log(`     Error: ${error.message}`);
            failCount++;
        }
    };
}

function section(name: string) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📋 ${name}`);
    console.log('='.repeat(60));
}

// ============================================================================
// TEST: FLOW REGISTRY
// ============================================================================

async function testFlowRegistry() {
    section('FLOW REGISTRY TESTS');

    await test('Flow registry is not empty', () => {
        const flowIds = getAllFlowIds();
        console.log(`     Found ${flowIds.length} flows: ${flowIds.join(', ')}`);
        return flowIds.length >= 3;
    })();

    await test('All required flows exist', () => {
        const requiredFlows = ['boiler_no_heat', 'dripping_tap', 'blocked_drain'];
        const allExist = requiredFlows.every(id => getFlowById(id) !== null);
        return allExist;
    })();

    await test('getFlowById returns correct flow', () => {
        const flow = getFlowById('boiler_no_heat');
        return flow !== null && flow.id === 'boiler_no_heat';
    })();

    await test('getFlowById returns null/undefined for unknown flow', () => {
        const flow = getFlowById('nonexistent_flow');
        return flow === null || flow === undefined;
    })();
}

// ============================================================================
// TEST: FLOW STRUCTURE
// ============================================================================

async function testFlowStructure() {
    section('FLOW STRUCTURE TESTS');

    const flowIds = getAllFlowIds();

    for (const flowId of flowIds) {
        const flow = getFlowById(flowId)!;

        await test(`${flowId}: Has required properties`, () => {
            return (
                typeof flow.id === 'string' &&
                typeof flow.name === 'string' &&
                typeof flow.category === 'string' &&
                Array.isArray(flow.steps) &&
                flow.steps.length > 0
            );
        })();

        await test(`${flowId}: Has trigger keywords`, () => {
            return Array.isArray(flow.triggerKeywords) && flow.triggerKeywords.length > 0;
        })();

        await test(`${flowId}: All steps have IDs and templates`, () => {
            return flow.steps.every(step =>
                typeof step.id === 'string' &&
                typeof step.template === 'string' &&
                step.template.length > 0
            );
        })();

        await test(`${flowId}: All steps have transitions`, () => {
            return flow.steps.every(step =>
                Array.isArray(step.transitions) &&
                step.transitions.length > 0
            );
        })();

        await test(`${flowId}: First step exists`, () => {
            return flow.steps[0] !== undefined;
        })();

        // Check for orphan steps (steps that can't be reached)
        await test(`${flowId}: No unreachable steps`, () => {
            const reachableSteps = new Set<string>([flow.steps[0].id]);
            let changed = true;

            while (changed) {
                changed = false;
                for (const step of flow.steps) {
                    if (reachableSteps.has(step.id)) {
                        for (const transition of step.transitions) {
                            if (transition.action.type === 'goto_step' && transition.action.stepId) {
                                if (!reachableSteps.has(transition.action.stepId)) {
                                    reachableSteps.add(transition.action.stepId);
                                    changed = true;
                                }
                            }
                        }
                        // Check fallback transition too
                        if (step.fallbackTransition?.action.type === 'goto_step' &&
                            step.fallbackTransition.action.stepId) {
                            if (!reachableSteps.has(step.fallbackTransition.action.stepId)) {
                                reachableSteps.add(step.fallbackTransition.action.stepId);
                                changed = true;
                            }
                        }
                    }
                }
            }

            const unreachable = flow.steps.filter(s => !reachableSteps.has(s.id));
            if (unreachable.length > 0) {
                console.log(`     Unreachable steps: ${unreachable.map(s => s.id).join(', ')}`);
            }
            return unreachable.length === 0;
        })();

        // Check for broken transitions (pointing to non-existent steps)
        await test(`${flowId}: No broken transitions`, () => {
            const stepIds = new Set(flow.steps.map(s => s.id));
            const brokenTransitions: string[] = [];

            for (const step of flow.steps) {
                for (const transition of step.transitions) {
                    if (transition.action.type === 'goto_step' && transition.action.stepId) {
                        if (!stepIds.has(transition.action.stepId)) {
                            brokenTransitions.push(`${step.id} -> ${transition.action.stepId}`);
                        }
                    }
                }
            }

            if (brokenTransitions.length > 0) {
                console.log(`     Broken transitions: ${brokenTransitions.join(', ')}`);
            }
            return brokenTransitions.length === 0;
        })();
    }
}

// ============================================================================
// TEST: FLOW SELECTION
// ============================================================================

async function testFlowSelection() {
    section('FLOW SELECTION TESTS');

    // Test keyword matching
    const keywordTests = [
        { keywords: ['boiler', 'cold'], expected: 'boiler_no_heat' },
        { keywords: ['no', 'heating'], expected: 'boiler_no_heat' },
        { keywords: ['radiator', 'cold'], expected: 'boiler_no_heat' },
        { keywords: ['tap', 'dripping'], expected: 'dripping_tap' },
        { keywords: ['leaking', 'tap'], expected: 'dripping_tap' },
        { keywords: ['faucet', 'drip'], expected: 'dripping_tap' },
        { keywords: ['drain', 'blocked'], expected: 'blocked_drain' },
        { keywords: ['sink', 'clogged'], expected: 'blocked_drain' },
        { keywords: ['toilet', 'blocked'], expected: 'blocked_drain' },
    ];

    for (const { keywords, expected } of keywordTests) {
        await test(`Keywords "${keywords.join(' ')}" -> ${expected}`, () => {
            const result = findFlowByKeywords(keywords);
            if (result !== expected) {
                console.log(`     Got: ${result || 'null'}`);
            }
            return result === expected;
        })();
    }

    // Test category matching
    await test('getFlowsByCategory returns flows for heating', () => {
        const flows = getFlowsByCategory('heating');
        return flows.length > 0 && flows.some(f => f.id === 'boiler_no_heat');
    })();

    await test('getFlowsByCategory returns flows for plumbing', () => {
        const flows = getFlowsByCategory('plumbing');
        return flows.length > 0;
    })();

    // Test selectFlowForIssue
    const issueTests = [
        { category: 'heating', description: 'my boiler is not working, no hot water', expected: 'boiler_no_heat' },
        { category: 'plumbing', description: 'kitchen tap is dripping all day', expected: 'dripping_tap' },
        { category: 'plumbing', description: 'the bathroom sink is blocked and water won\'t drain', expected: 'blocked_drain' },
    ];

    for (const { category, description, expected } of issueTests) {
        await test(`Issue "${description.substring(0, 40)}..." -> ${expected}`, () => {
            const result = selectFlowForIssue(category, description);
            if (result !== expected) {
                console.log(`     Got: ${result || 'null'}`);
            }
            return result === expected;
        })();
    }
}

// ============================================================================
// TEST: EXPECTED RESPONSES PATTERNS
// ============================================================================

async function testResponsePatterns() {
    section('RESPONSE PATTERN TESTS');

    // Test boiler flow patterns
    const boilerFlow = getFlowById('boiler_no_heat')!;
    const checkPowerStep = boilerFlow.steps.find(s => s.id === 'check_power');

    if (checkPowerStep?.expectedResponses) {
        const yesResponse = checkPowerStep.expectedResponses.find(r => r.id === 'power_yes');
        const noResponse = checkPowerStep.expectedResponses.find(r => r.id === 'power_no');

        await test('Boiler check_power: "yes" matches power_yes pattern', () => {
            if (!yesResponse?.patterns) return false;
            return yesResponse.patterns.some(p => new RegExp(p, 'i').test('yes'));
        })();

        await test('Boiler check_power: "it\'s on" matches power_yes pattern', () => {
            if (!yesResponse?.patterns) return false;
            return yesResponse.patterns.some(p => new RegExp(p, 'i').test("it's on"));
        })();

        await test('Boiler check_power: "no" matches power_no pattern', () => {
            if (!noResponse?.patterns) return false;
            return noResponse.patterns.some(p => new RegExp(p, 'i').test('no'));
        })();
    }

    // Test tap flow patterns
    const tapFlow = getFlowById('dripping_tap')!;
    const locationStep = tapFlow.steps.find(s => s.id === 'identify_location');

    if (locationStep?.expectedResponses) {
        const kitchenResponse = locationStep.expectedResponses.find(r => r.id === 'kitchen');
        const bathroomResponse = locationStep.expectedResponses.find(r => r.id === 'bathroom');

        await test('Tap identify_location: "kitchen sink" matches kitchen pattern', () => {
            if (!kitchenResponse?.patterns) return false;
            return kitchenResponse.patterns.some(p => new RegExp(p, 'i').test('kitchen sink'));
        })();

        await test('Tap identify_location: "bathroom tap" matches bathroom pattern', () => {
            if (!bathroomResponse?.patterns) return false;
            return bathroomResponse.patterns.some(p => new RegExp(p, 'i').test('bathroom tap'));
        })();
    }

    // Test drain flow patterns
    const drainFlow = getFlowById('blocked_drain')!;
    const drainLocationStep = drainFlow.steps.find(s => s.id === 'identify_location');

    if (drainLocationStep?.expectedResponses) {
        const toiletResponse = drainLocationStep.expectedResponses.find(r => r.id === 'toilet');

        await test('Drain identify_location: "toilet is blocked" matches toilet pattern', () => {
            if (!toiletResponse?.patterns) return false;
            return toiletResponse.patterns.some(p => new RegExp(p, 'i').test('toilet is blocked'));
        })();
    }
}

// ============================================================================
// TEST: SAFETY WARNINGS
// ============================================================================

async function testSafetyWarnings() {
    section('SAFETY WARNING TESTS');

    const boilerFlow = getFlowById('boiler_no_heat')!;

    await test('Boiler flow has safety warning', () => {
        return typeof boilerFlow.safetyWarning === 'string' && boilerFlow.safetyWarning.length > 0;
    })();

    await test('Boiler safety warning mentions gas', () => {
        return boilerFlow.safetyWarning?.toLowerCase().includes('gas') ?? false;
    })();

    // Check escalation data collection
    await test('Boiler flow specifies escalation data needed', () => {
        return Array.isArray(boilerFlow.escalationDataNeeded) && boilerFlow.escalationDataNeeded.length > 0;
    })();
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
    console.log('\n🧪 TROUBLESHOOTING FLOW TESTS\n');
    console.log('Testing flow definitions, structure, and selection logic...\n');

    await testFlowRegistry();
    await testFlowStructure();
    await testFlowSelection();
    await testResponsePatterns();
    await testSafetyWarnings();

    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`  ✅ Passed: ${passCount}`);
    console.log(`  ❌ Failed: ${failCount}`);
    console.log(`  📈 Total:  ${passCount + failCount}`);

    if (failCount > 0) {
        console.log('\n⚠️  Some tests failed. Please review the failures above.\n');
        process.exit(1);
    } else {
        console.log('\n🎉 All tests passed!\n');
        process.exit(0);
    }
}

main().catch(err => {
    console.error('Test runner failed:', err);
    process.exit(1);
});
