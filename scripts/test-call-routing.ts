/**
 * Unit Tests for Call Routing Engine
 * 
 * Tests all routing scenarios including:
 * - Agent modes (auto, force-in-hours, force-out-of-hours, voicemail-only)
 * - Business hours detection (UK timezone)
 * - VA forwarding logic
 * - Fallback handling (missed calls)
 * - Context selection (in-hours, out-of-hours, missed-call)
 */

import {
    determineCallRouting,
    isWithinUKBusinessHours,
    getEffectiveMode,
    getElevenLabsContextMessage,
    CallRoutingSettings,
    CallRoutingDecision,
    AgentMode,
    FallbackAction,
} from '../server/call-routing-engine';

// Test utilities
function createSettings(overrides: Partial<CallRoutingSettings> = {}): CallRoutingSettings {
    return {
        agentMode: 'auto',
        forwardEnabled: true,
        forwardNumber: '+447700900000',
        fallbackAction: 'eleven-labs',
        businessHoursStart: '08:00',
        businessHoursEnd: '18:00',
        businessDays: '1,2,3,4,5', // Mon-Fri
        elevenLabsAgentId: 'test-agent-id',
        elevenLabsApiKey: 'test-api-key',
        ...overrides,
    };
}

// Create a date in UK timezone for testing
function createUKDate(dayOfWeek: number, hour: number, minute: number = 0): Date {
    // dayOfWeek: 1=Mon, 2=Tue, ..., 7=Sun
    // We create a date and then adjust to match the desired day/time
    // Use a known Monday: 2026-01-05 is a Monday
    const baseMonday = new Date('2026-01-05T12:00:00Z');
    const dayOffset = (dayOfWeek - 1); // 0 for Monday
    const date = new Date(baseMonday);
    date.setUTCDate(date.getUTCDate() + dayOffset);
    date.setUTCHours(hour, minute, 0, 0);
    return date;
}

// Test counters
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
    try {
        fn();
        passed++;
        console.log(`✅ ${name}`);
    } catch (e: any) {
        failed++;
        console.log(`❌ ${name}`);
        console.log(`   Error: ${e.message}`);
    }
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
    if (actual !== expected) {
        throw new Error(`${message || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function assertTrue(condition: boolean, message?: string) {
    if (!condition) {
        throw new Error(message || 'Expected condition to be true');
    }
}

// ============================================
// TEST SUITE: Business Hours Detection
// ============================================

console.log('\n📅 Business Hours Detection Tests\n' + '='.repeat(40));

test('Monday 10am should be within business hours', () => {
    const date = createUKDate(1, 10, 0); // Monday 10:00
    const settings = createSettings();
    assertTrue(isWithinUKBusinessHours(settings, date));
});

test('Monday 8am exactly should be within business hours', () => {
    const date = createUKDate(1, 8, 0); // Monday 08:00
    const settings = createSettings();
    assertTrue(isWithinUKBusinessHours(settings, date));
});

test('Monday 18:00 exactly should be OUT of business hours (>= end)', () => {
    const date = createUKDate(1, 18, 0); // Monday 18:00
    const settings = createSettings();
    assertEqual(isWithinUKBusinessHours(settings, date), false);
});

test('Monday 7:59am should be OUT of business hours', () => {
    const date = createUKDate(1, 7, 59); // Monday 07:59
    const settings = createSettings();
    assertEqual(isWithinUKBusinessHours(settings, date), false);
});

test('Saturday 10am should be OUT of business hours (weekend)', () => {
    const date = createUKDate(6, 10, 0); // Saturday 10:00
    const settings = createSettings();
    assertEqual(isWithinUKBusinessHours(settings, date), false);
});

test('Sunday 14:00 should be OUT of business hours (weekend)', () => {
    const date = createUKDate(7, 14, 0); // Sunday 14:00
    const settings = createSettings();
    assertEqual(isWithinUKBusinessHours(settings, date), false);
});

test('Friday 17:59 should be within business hours', () => {
    const date = createUKDate(5, 17, 59); // Friday 17:59
    const settings = createSettings();
    assertTrue(isWithinUKBusinessHours(settings, date));
});

// ============================================
// TEST SUITE: Effective Mode
// ============================================

console.log('\n🎛️ Effective Mode Tests\n' + '='.repeat(40));

test('Auto mode during business hours should return in-hours', () => {
    const date = createUKDate(1, 10, 0); // Monday 10:00
    const settings = createSettings({ agentMode: 'auto' });
    assertEqual(getEffectiveMode(settings, date), 'in-hours');
});

test('Auto mode outside business hours should return out-of-hours', () => {
    const date = createUKDate(1, 20, 0); // Monday 20:00
    const settings = createSettings({ agentMode: 'auto' });
    assertEqual(getEffectiveMode(settings, date), 'out-of-hours');
});

test('Force-in-hours mode should always return in-hours', () => {
    const date = createUKDate(7, 23, 0); // Sunday 23:00
    const settings = createSettings({ agentMode: 'force-in-hours' });
    assertEqual(getEffectiveMode(settings, date), 'in-hours');
});

test('Force-out-of-hours mode should always return out-of-hours', () => {
    const date = createUKDate(1, 10, 0); // Monday 10:00
    const settings = createSettings({ agentMode: 'force-out-of-hours' });
    assertEqual(getEffectiveMode(settings, date), 'out-of-hours');
});

test('Voicemail-only mode should return voicemail-only', () => {
    const date = createUKDate(1, 10, 0);
    const settings = createSettings({ agentMode: 'voicemail-only' });
    assertEqual(getEffectiveMode(settings, date), 'voicemail-only');
});

// ============================================
// TEST SUITE: Call Routing Decisions
// ============================================

console.log('\n📞 Call Routing Decision Tests\n' + '='.repeat(40));

test('In-hours with forward enabled should attempt VA', () => {
    const date = createUKDate(1, 10, 0);
    const settings = createSettings({ agentMode: 'auto', forwardEnabled: true });
    const routing = determineCallRouting(settings, false, date);

    assertTrue(routing.playWelcomeAudio, 'Should play welcome audio');
    assertTrue(routing.attemptVAForward, 'Should attempt VA forward');
    assertTrue(routing.sendVASms, 'Should send VA SMS');
    assertEqual(routing.destination, 'va-forward');
    assertEqual(routing.effectiveMode, 'in-hours');
});

test('Out-of-hours should skip welcome audio and go to Eleven Labs', () => {
    const date = createUKDate(1, 20, 0); // Monday 20:00
    const settings = createSettings({ agentMode: 'auto' });
    const routing = determineCallRouting(settings, false, date);

    assertEqual(routing.playWelcomeAudio, false, 'Should NOT play welcome audio');
    assertEqual(routing.attemptVAForward, false, 'Should NOT attempt VA');
    assertEqual(routing.sendVASms, false, 'Should NOT send VA SMS');
    assertEqual(routing.destination, 'eleven-labs');
    assertEqual(routing.elevenLabsContext, 'out-of-hours');
});

test('In-hours with forward DISABLED should go to Eleven Labs with in-hours context', () => {
    const date = createUKDate(1, 10, 0);
    const settings = createSettings({ forwardEnabled: false });
    const routing = determineCallRouting(settings, false, date);

    assertTrue(routing.playWelcomeAudio, 'Should play welcome audio');
    assertEqual(routing.attemptVAForward, false, 'Should NOT attempt VA');
    assertEqual(routing.destination, 'eleven-labs');
    assertEqual(routing.elevenLabsContext, 'in-hours');
});

test('VA missed call should go to Eleven Labs with missed-call context', () => {
    const date = createUKDate(1, 10, 0);
    const settings = createSettings();
    const routing = determineCallRouting(settings, true, date); // isVAMissedCall = true

    assertEqual(routing.destination, 'eleven-labs');
    assertEqual(routing.elevenLabsContext, 'missed-call');
    assertEqual(routing.playWelcomeAudio, false, 'Audio already played');
    assertEqual(routing.attemptVAForward, false, 'Already attempted');
});

test('VA missed call with voicemail fallback should go to voicemail', () => {
    const date = createUKDate(1, 10, 0);
    const settings = createSettings({ fallbackAction: 'voicemail' });
    const routing = determineCallRouting(settings, true, date);

    assertEqual(routing.destination, 'voicemail');
    assertEqual(routing.elevenLabsContext, null);
});

test('Voicemail-only mode should bypass everything', () => {
    const date = createUKDate(1, 10, 0);
    const settings = createSettings({ agentMode: 'voicemail-only' });
    const routing = determineCallRouting(settings, false, date);

    assertEqual(routing.playWelcomeAudio, false);
    assertEqual(routing.attemptVAForward, false);
    assertEqual(routing.sendVASms, false);
    assertEqual(routing.destination, 'voicemail');
    assertEqual(routing.effectiveMode, 'voicemail-only');
});

test('Force-out-of-hours on Monday 10am should still be OOH', () => {
    const date = createUKDate(1, 10, 0);
    const settings = createSettings({ agentMode: 'force-out-of-hours' });
    const routing = determineCallRouting(settings, false, date);

    assertEqual(routing.playWelcomeAudio, false);
    assertEqual(routing.destination, 'eleven-labs');
    assertEqual(routing.elevenLabsContext, 'out-of-hours');
    assertEqual(routing.effectiveMode, 'out-of-hours');
});

test('Force-in-hours on Sunday 23:00 should still be in-hours', () => {
    const date = createUKDate(7, 23, 0); // Sunday 23:00
    const settings = createSettings({ agentMode: 'force-in-hours' });
    const routing = determineCallRouting(settings, false, date);

    assertTrue(routing.playWelcomeAudio);
    assertTrue(routing.attemptVAForward);
    assertEqual(routing.effectiveMode, 'in-hours');
});

test('Out-of-hours without Eleven Labs configured should go to voicemail', () => {
    const date = createUKDate(1, 20, 0);
    const settings = createSettings({
        agentMode: 'auto',
        elevenLabsAgentId: '',
        elevenLabsApiKey: ''
    });
    const routing = determineCallRouting(settings, false, date);

    assertEqual(routing.destination, 'voicemail');
    assertEqual(routing.elevenLabsContext, null);
});

// ============================================
// TEST SUITE: Context Messages
// ============================================

console.log('\n💬 Context Message Tests\n' + '='.repeat(40));

test('In-hours context should use default message', () => {
    const msg = getElevenLabsContextMessage('in-hours', {
        agentContextDefault: 'Custom in-hours message',
    });
    assertEqual(msg, 'Custom in-hours message');
});

test('Out-of-hours context should use OOH message', () => {
    const msg = getElevenLabsContextMessage('out-of-hours', {
        agentContextOutOfHours: 'We are closed right now',
    });
    assertEqual(msg, 'We are closed right now');
});

test('Missed-call context should use missed message', () => {
    const msg = getElevenLabsContextMessage('missed-call', {
        agentContextMissed: 'Sorry for the wait!',
    });
    assertEqual(msg, 'Sorry for the wait!');
});

test('Missing context should return empty string', () => {
    const msg = getElevenLabsContextMessage(null, {});
    assertEqual(msg, '');
});

// ============================================
// TEST SUITE: Business Days Validation
// ============================================

import {
    formatBusinessDays,
    parseBusinessDays,
    getDayNames,
    validateBusinessHours
} from '../server/call-routing-engine';

console.log('\n📅 Business Days Validation Tests\n' + '='.repeat(40));

test('formatBusinessDays should sort and join days', () => {
    assertEqual(formatBusinessDays([5, 1, 3, 2, 4]), '1,2,3,4,5');
});

test('formatBusinessDays should handle single day', () => {
    assertEqual(formatBusinessDays([6]), '6');
});

test('parseBusinessDays should parse valid string', () => {
    const result = parseBusinessDays('1,2,3,4,5');
    assertEqual(result.length, 5);
    assertEqual(result[0], 1);
    assertEqual(result[4], 5);
});

test('parseBusinessDays should handle empty string', () => {
    const result = parseBusinessDays('');
    assertEqual(result.length, 0);
});

test('parseBusinessDays should filter invalid day numbers', () => {
    const result = parseBusinessDays('0,1,2,8,9,-1');
    assertEqual(result.length, 2); // Only 1 and 2 are valid
    assertEqual(result[0], 1);
    assertEqual(result[1], 2);
});

test('parseBusinessDays should handle whitespace', () => {
    const result = parseBusinessDays(' 1 , 2 , 3 ');
    assertEqual(result.length, 3);
});

test('getDayNames should return readable names', () => {
    assertEqual(getDayNames([1, 2, 3, 4, 5]), 'Monday, Tuesday, Wednesday, Thursday, Friday');
});

test('getDayNames should handle single day', () => {
    assertEqual(getDayNames([6]), 'Saturday');
});

test('getDayNames should sort days', () => {
    assertEqual(getDayNames([7, 1, 6]), 'Monday, Saturday, Sunday');
});

test('validateBusinessHours should accept valid configuration', () => {
    const result = validateBusinessHours('08:00', '18:00', [1, 2, 3, 4, 5]);
    assertTrue(result.isValid);
});

test('validateBusinessHours should reject start >= end', () => {
    const result = validateBusinessHours('18:00', '08:00', [1, 2, 3, 4, 5]);
    assertEqual(result.isValid, false);
    assertTrue(result.error?.includes('before') || false);
});

test('validateBusinessHours should reject equal start and end', () => {
    const result = validateBusinessHours('09:00', '09:00', [1, 2, 3, 4, 5]);
    assertEqual(result.isValid, false);
});

test('validateBusinessHours should reject invalid time format', () => {
    const result = validateBusinessHours('25:00', '18:00', [1, 2, 3, 4, 5]);
    assertEqual(result.isValid, false);
    assertTrue(result.error?.includes('format') || false);
});

test('validateBusinessHours should reject empty days array', () => {
    const result = validateBusinessHours('08:00', '18:00', []);
    assertEqual(result.isValid, false);
    assertTrue(result.error?.includes('At least one') || false);
});

test('validateBusinessHours should reject invalid day numbers', () => {
    const result = validateBusinessHours('08:00', '18:00', [0, 8, 9]);
    assertEqual(result.isValid, false);
    assertTrue(result.error?.includes('Invalid day') || false);
});

test('validateBusinessHours should accept single day business', () => {
    const result = validateBusinessHours('09:00', '17:00', [6]);
    assertTrue(result.isValid);
});

test('validateBusinessHours should accept weekend-only business', () => {
    const result = validateBusinessHours('10:00', '16:00', [6, 7]);
    assertTrue(result.isValid);
});

test('validateBusinessHours should accept 24-hour format edge cases', () => {
    const result = validateBusinessHours('00:00', '23:59', [1, 2, 3, 4, 5, 6, 7]);
    assertTrue(result.isValid);
});

// ============================================
// Summary
// ============================================

console.log('\n' + '='.repeat(40));
console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
    console.log('❌ Some tests failed!');
    process.exit(1);
} else {
    console.log('✅ All tests passed!');
    process.exit(0);
}
