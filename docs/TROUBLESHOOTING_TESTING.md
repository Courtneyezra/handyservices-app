# Troubleshooting Deflection System - Testing Guide

This document provides comprehensive testing procedures for the troubleshooting deflection system.

## Quick Start

```bash
# Run all automated tests
npx tsx scripts/test-troubleshooting-flows.ts   # Flow definitions
npx tsx scripts/test-troubleshooting-e2e.ts      # End-to-end flows
npx tsx scripts/test-deflection-metrics.ts       # Metrics API

# With options
npx tsx scripts/test-deflection-metrics.ts --seed     # Seed test data first
npx tsx scripts/test-troubleshooting-e2e.ts --cleanup # Clean up after
```

---

## 1. Automated Test Scripts

### 1.1 Flow Definition Tests (`test-troubleshooting-flows.ts`)

Tests the static structure of troubleshooting flows:

| Test Category | What It Checks |
|---------------|----------------|
| Flow Registry | All flows load, required flows exist |
| Flow Structure | Steps have IDs, templates, transitions |
| Flow Selection | Keyword matching, category matching |
| Response Patterns | Regex patterns match expected inputs |
| Safety Warnings | Boiler flow has gas safety warning |

```bash
npx tsx scripts/test-troubleshooting-flows.ts
```

**Expected Output:**
```
✅ Flow registry is not empty
✅ All required flows exist
✅ boiler-no-heat: Has required properties
✅ Keywords "boiler cold" -> boiler-no-heat
...
```

### 1.2 End-to-End Tests (`test-troubleshooting-e2e.ts`)

Simulates full conversations through the flow engine:

| Scenario | Expected Outcome |
|----------|------------------|
| Boiler - Low Pressure DIY Fix | Deflected (resolved_diy) |
| Dripping Tap - Tightening Fix | Deflected (resolved_diy) |
| Blocked Drain - Boiling Water | Deflected (resolved_diy) |
| Boiler - No Power | Not Deflected (needs_callout) |
| Toilet Blocked - Severe | Not Deflected (needs_callout) |
| Unclear Responses | Not Deflected (escalated) |

```bash
npx tsx scripts/test-troubleshooting-e2e.ts
```

### 1.3 Metrics API Tests (`test-deflection-metrics.ts`)

Tests the deflection analytics API:

| Endpoint | What It Returns |
|----------|-----------------|
| `GET /api/admin/deflection-metrics` | Overall stats, by category, by flow |
| `GET /api/admin/deflection-metrics/flows` | Per-flow performance |
| `GET /api/admin/deflection-metrics/trends` | Time-based trends |

```bash
# Start server first
npm run dev

# In another terminal
npx tsx scripts/test-deflection-metrics.ts --seed
```

---

## 2. Manual Testing Procedures

### 2.1 WhatsApp Conversation Testing

#### Prerequisites
1. Test tenant phone registered in system (+447700100001)
2. Server running (`npm run dev`)
3. WhatsApp webhook configured

#### Test Case A: Boiler Low Pressure (DIY Success)

1. **Send**: "Hi, my boiler isn't working"
2. **Expect**: AI asks about power status
3. **Send**: "Yes it's on but showing red light"
4. **Expect**: AI asks about pressure gauge
5. **Send**: "0.3 bar"
6. **Expect**: AI explains repressurization
7. **Send**: "Ok I found the filling loop"
8. **Expect**: AI gives step-by-step instructions
9. **Send**: "It says 1.2 bar now"
10. **Expect**: AI confirms and asks if heating works
11. **Send**: "Yes it's working now!"
12. **Expect**: AI congratulates, offers further help

**Expected Outcome**: Issue resolved as `resolved_diy`, deflection recorded

#### Test Case B: Dripping Tap (DIY Success)

1. **Send**: "My tap won't stop dripping"
2. **Expect**: AI asks which tap
3. **Send**: "Kitchen"
4. **Expect**: AI asks about severity
5. **Send**: "Just a slow drip"
6. **Expect**: AI suggests tightening
7. **Send**: "I tried that and it stopped!"
8. **Expect**: AI confirms resolution

**Expected Outcome**: Issue resolved as `resolved_diy`

#### Test Case C: Blocked Toilet (Needs Callout)

1. **Send**: "My toilet is blocked"
2. **Expect**: AI asks about severity
3. **Send**: "Water almost overflowing"
4. **Expect**: AI gives safety instructions
5. **Send**: "I tried the plunger, nothing"
6. **Expect**: AI escalates to professional

**Expected Outcome**: Issue escalated as `needs_callout`

#### Test Case D: Gas Smell (Safety Escalation)

1. **Send**: "I can smell gas near my boiler"
2. **Expect**: Immediate safety warning, no DIY, escalate

**Expected Outcome**: Immediate escalation as `escalated_safety`

### 2.2 Admin Dashboard Testing

1. Navigate to `/admin/deflection-metrics` (when built)
2. Verify:
   - [ ] Overall deflection rate displays
   - [ ] Category breakdown chart renders
   - [ ] Flow performance table shows all flows
   - [ ] Time trends chart shows last 7 days
   - [ ] Follow-up rate displays (quality metric)

### 2.3 API Testing with curl

```bash
# Main metrics
curl http://localhost:5000/api/admin/deflection-metrics | jq

# Flow performance
curl http://localhost:5000/api/admin/deflection-metrics/flows | jq

# Trends
curl http://localhost:5000/api/admin/deflection-metrics/trends | jq
```

---

## 3. Test Data Management

### Seed Test Data
```bash
npx tsx scripts/test-deflection-metrics.ts --seed
```

### View Current Data
```bash
# Check sessions
npx tsx -e "import {db} from './server/db'; import {troubleshootingSessions} from './shared/schema'; db.select().from(troubleshootingSessions).then(console.log)"

# Check metrics
npx tsx -e "import {db} from './server/db'; import {deflectionMetrics} from './shared/schema'; db.select().from(deflectionMetrics).then(console.log)"
```

### Cleanup Test Data
```bash
npx tsx scripts/test-troubleshooting-e2e.ts --cleanup
```

---

## 4. Expected Metrics

### Target Performance
| Metric | Target | Notes |
|--------|--------|-------|
| Deflection Rate | ≥50% | Matches Lanten.ai claim |
| Avg Steps to Resolution | 3-5 | Not too short, not too long |
| Avg Time to Resolution | 2-5 min | Quick but thorough |
| Follow-up Rate | <15% | DIY fixes should hold |
| User Frustration Escalations | <10% | Good UX |

### Deflection by Category (Expected)
| Category | Expected Rate | Reason |
|----------|---------------|--------|
| Heating (simple) | 40-60% | Pressure, thermostat issues |
| Plumbing (drips) | 60-80% | Tightening, cleaning |
| Plumbing (blocks) | 30-50% | Some need professional |
| Electrical | 0% | Always escalate |
| Security | 0% | Always escalate |

---

## 5. Troubleshooting Test Failures

### "Session not found"
- Check `troubleshootingSessions` table has entries
- Verify session ID format matches

### "Flow not found"
- Run `test-troubleshooting-flows.ts` first
- Check flow files in `server/troubleshooting/flows/`

### "API returns 401/403"
- Admin endpoints require authentication
- Check `requireAdmin` middleware configuration

### "No metrics recorded"
- Verify `completeSession()` is called
- Check `deflectionMetrics` table

### "Deflection rate is 0%"
- Run seed script: `--seed`
- Complete some test conversations

---

## 6. CI/CD Integration

Add to your CI pipeline:

```yaml
# .github/workflows/test.yml
jobs:
  test-troubleshooting:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npx tsx scripts/test-troubleshooting-flows.ts
      # E2E tests need database
      - run: npm run db:push
      - run: npx tsx scripts/test-troubleshooting-e2e.ts
```

---

## 7. Performance Testing

For load testing the flow engine:

```bash
# Simple load test (requires k6 installed)
k6 run --vus 10 --duration 30s scripts/load-test-flows.js
```

**Targets:**
- Response time: <500ms p95
- Throughput: >100 sessions/second
- Error rate: <1%

---

## 8. Regression Testing Checklist

Before each release, verify:

- [ ] All flow definition tests pass
- [ ] All E2E scenarios complete correctly
- [ ] Metrics API returns valid data
- [ ] Deflection rate >= 40%
- [ ] No new TypeScript errors in troubleshooting files
- [ ] WhatsApp webhook processes messages correctly
- [ ] Safety warnings display for gas/electrical
- [ ] Follow-up tracking works (24h window)

---

## 9. Bug Report Template

When reporting issues:

```markdown
**Component**: [Flow Engine / Response Interpreter / Metrics API]
**Test Script**: [Which test failed]
**Expected**: [What should happen]
**Actual**: [What happened]
**Session ID**: [If applicable]
**Flow ID**: [If applicable]
**User Messages**: [Conversation history]
```
