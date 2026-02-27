# Live Call System Fixes - Test Guide

This guide covers how to test the fixes S-002 through S-005 for the Live Call system.

## Overview of Fixes

| Fix ID | Description | Impact |
|--------|-------------|--------|
| S-002 | Page buffer extended from 5s to 15s | Prevents premature call clear |
| S-003 | Disabled buttons show tooltips with reasons | Improves VA guidance |
| S-004 | Job IDs use content hash instead of index | Stable IDs across cycles |
| S-005 | AI extraction parallelized, throttle reduced to 5s | Faster response time |

---

## S-002: Page Buffer Extension (5s -> 15s)

### What Changed
The delay before clearing call data after a call ends was increased from 5 seconds to 15 seconds.

### Why It Matters
- VAs need time to review the final analysis after a call ends
- The 5-second buffer was too short - data disappeared before VAs could act
- 15 seconds provides adequate time for review and action

### How to Test Manually

1. **Start a simulation or real call**
   - Navigate to the Live Call dashboard
   - Start a call simulation or receive a real call

2. **End the call**
   - When the call ends, start a timer

3. **Verify the buffer**
   - Call data should remain visible for approximately 15 seconds
   - The "LIVE" indicator should turn off immediately
   - Jobs, segment, and customer info should persist for the buffer duration

### Expected Behavior
- Call ends -> Live indicator off -> Data persists for ~15s -> Data clears

### Files Changed
- `client/src/contexts/LiveCallContext.tsx` - `setTimeout` in call_ended handler

---

## S-003: Disabled Button Tooltips

### What Changed
Action buttons (SEND QUOTE, GET VIDEO, BOOK VISIT) now show explanatory tooltips when disabled.

### Why It Matters
- VAs were confused about why buttons were disabled
- Clear reasons help VAs choose the correct action
- Reduces training time and errors

### Tooltip Reasons

| Button | Condition | Tooltip |
|--------|-----------|---------|
| SEND QUOTE | Red jobs exist | "Site visit required" |
| SEND QUOTE | Amber jobs exist | "Video needed first" |
| SEND QUOTE | No jobs | "No jobs detected" |
| GET VIDEO | Red jobs exist | "Site visit required" |
| GET VIDEO | All green jobs | "All jobs priced" |
| GET VIDEO | No jobs | "No jobs detected" |
| BOOK VISIT | All green jobs | "All jobs priced" |
| BOOK VISIT | Amber (no red) jobs | "Try video first" |
| BOOK VISIT | No jobs | "No jobs detected" |

### How to Test Manually

1. **Test with no jobs**
   - Start a new call (no jobs detected yet)
   - Observe all three buttons should be disabled
   - Each should show "No jobs detected" tooltip

2. **Test with green jobs (all matched)**
   - Simulate a call with matched SKUs (e.g., "I need a tap fixed")
   - Observe:
     - SEND QUOTE: Enabled
     - GET VIDEO: Disabled - "All jobs priced"
     - BOOK VISIT: Disabled - "All jobs priced"

3. **Test with amber jobs (unmatched)**
   - Simulate a call with custom work (e.g., "I need custom shelving")
   - Observe:
     - SEND QUOTE: Disabled - "Video needed first"
     - GET VIDEO: Enabled
     - BOOK VISIT: Disabled - "Try video first"

4. **Test with red jobs (specialist work)**
   - Simulate a call with specialist work (e.g., "I need gas work on my boiler")
   - Observe:
     - SEND QUOTE: Disabled - "Site visit required"
     - GET VIDEO: Disabled - "Site visit required"
     - BOOK VISIT: Enabled

### Files Changed
- `client/src/components/live-call/CallHUD.tsx` - Button state logic and tooltip rendering

---

## S-004: Stable Job IDs (Content Hash)

### What Changed
Job IDs are now generated using a content hash instead of array indices.

### Why It Matters
- Index-based IDs (`job-0`, `job-1`) change when jobs reorder
- This causes React re-renders and animation glitches
- Content hash IDs are stable across analysis cycles
- Enables proper job tracking and animation

### ID Format

```
Matched jobs:   job-{8-char-hash}
Unmatched jobs: unmatched-{8-char-hash}
```

Hash is based on:
- Job description (lowercase, trimmed)
- Matched status (for matched jobs)

### How to Test Manually

1. **Verify ID stability**
   - Start a simulation with multiple jobs
   - Note the job IDs in the browser console
   - Let the analysis cycle run again
   - Verify IDs remain the same for the same jobs

2. **Verify uniqueness**
   - Add different jobs
   - Each should have a unique ID

3. **Check React DevTools**
   - Open React DevTools
   - Navigate to the JobsDetectedPanel component
   - Jobs should have stable `key` props across renders

### Files Changed
- `server/twilio-realtime.ts` - Job ID generation in `analyzeSegment`
- New helper: `generateStableJobId(description, matched)`

---

## S-005: Parallel AI Extraction

### What Changed
AI extraction calls now run in parallel using `Promise.all` instead of sequentially.

### Why It Matters
- Sequential extraction was slow (each call waited for the previous)
- Parallel extraction is ~2-3x faster
- Throttle reduced from 10s to 5s for more responsive updates

### Performance Improvement

| Metric | Before | After |
|--------|--------|-------|
| Extraction timing | Sequential | Parallel (Promise.all) |
| Throttle interval | 10,000ms | 5,000ms |
| Typical response | ~3s | ~1s |

### How to Test Manually

1. **Measure extraction timing**
   - Open browser DevTools (Network tab)
   - Start a simulation
   - Observe API calls - they should fire in parallel
   - Look for overlapping request timelines

2. **Verify throttle**
   - During an active call, speak continuously
   - Analysis updates should occur every ~5 seconds
   - Not every ~10 seconds (old behavior)

3. **Check server logs**
   - Server logs should show concurrent processing
   - Look for `[SKU Detector] Debounce timer fired` entries

### Files Changed
- `server/twilio-realtime.ts` - `analyzeSegment` method
- Throttle constant in settings

---

## Running Automated Tests

### Unit Tests

```bash
# Run the live call fixes test suite
npm test -- server/__tests__/live-call-fixes.test.ts

# Run with verbose output
npm test -- server/__tests__/live-call-fixes.test.ts --reporter=verbose
```

### Manual Test Script

```bash
# Run the comprehensive manual test script
npx tsx scripts/test-live-call-fixes.ts
```

This script will:
- Test job ID stability
- Test parallel execution timing
- Test button state logic
- Verify code patterns in source files

---

## Checklist

Before marking these fixes as complete, verify:

- [ ] S-002: Call data persists for ~15s after call ends
- [ ] S-003: All disabled buttons show appropriate tooltips
- [ ] S-003: Tooltips match expected reasons per job state
- [ ] S-004: Job IDs remain stable across analysis cycles
- [ ] S-004: No React key warnings in console
- [ ] S-005: API calls fire in parallel (check Network tab)
- [ ] S-005: Analysis updates occur every ~5s (not 10s)
- [ ] Unit tests pass: `npm test`
- [ ] Manual test script passes: `npx tsx scripts/test-live-call-fixes.ts`

---

## Troubleshooting

### Buffer not working (S-002)
- Check `LiveCallContext.tsx` for the `voice:call_ended` handler
- Verify the setTimeout delay is 15000, not 5000

### Tooltips not showing (S-003)
- Ensure the `disabledReason` is being calculated
- Check that the tooltip component is rendering when `isDisabled && disabledReason`

### Job IDs still index-based (S-004)
- Check `twilio-realtime.ts` for `generateStableJobId` usage
- Verify the hash function is imported from `crypto`

### Extraction still sequential (S-005)
- Look for `await Promise.all([...])` pattern
- Ensure individual extractions are not awaited separately
