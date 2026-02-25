# Tenant Chat Flow - Issue Resolution System

## Overview

The system aims to **resolve issues before logging a job** by:
1. Providing DIY help for simple problems
2. Only escalating to paid jobs when DIY fails
3. Keeping landlords informed at each stage

---

## Flow Diagram

```
                         ┌─────────────────────┐
                         │  INCOMING WHATSAPP  │
                         │      MESSAGE        │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │   IDENTIFY SENDER   │
                         │   (by phone number) │
                         └──────────┬──────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
              ▼                     ▼                     ▼
       ┌──────────┐          ┌──────────┐          ┌──────────┐
       │  TENANT  │          │ LANDLORD │          │ UNKNOWN  │
       └────┬─────┘          └────┬─────┘          └────┬─────┘
            │                     │                     │
            ▼                     ▼                     ▼
    ┌───────────────┐    ┌───────────────┐    ┌───────────────┐
    │ TENANT WORKER │    │LANDLORD WORKER│    │  ASK ADDRESS  │
    │               │    │               │    │  TO IDENTIFY  │
    │ • Reassure    │    │ • Approvals   │    └───────────────┘
    │ • Safety chk  │    │ • Settings    │
    │ • DIY help    │    │ • Status      │
    │ • Gather info │    └───────────────┘
    └───────┬───────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        DIY RESOLUTION ATTEMPT                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   AI assesses the issue:                                        │
│   • Is it SAFE for DIY? (No gas, electrical, heights)           │
│   • Is it SIMPLE enough? (dripping tap, blocked drain, etc.)    │
│                                                                  │
│   If YES → Provide step-by-step DIY instructions                │
│   If NO  → Skip to job logging                                  │
│                                                                  │
└─────────────────────────┬───────────────────────────────────────┘
                          │
            ┌─────────────┴─────────────┐
            │                           │
            ▼                           ▼
    ┌───────────────┐          ┌───────────────┐
    │  "IT WORKED"  │          │ "DIDN'T WORK" │
    │               │          │  "NEED HELP"  │
    └───────┬───────┘          └───────┬───────┘
            │                          │
            ▼                          ▼
    ┌───────────────┐          ┌───────────────┐
    │ RESOLVED_DIY  │          │ GATHER DETAILS│
    │               │          │               │
    │ • No job      │          │ • Photos      │
    │ • No cost     │          │ • Availability│
    │ • Landlord    │          │ • Urgency     │
    │   notified    │          │ • Access info │
    └───────────────┘          └───────┬───────┘
                                       │
                                       ▼
                              ┌───────────────┐
                              │ TRIAGE WORKER │
                              │               │
                              │ • Categorize  │
                              │ • Estimate £  │
                              │ • Set urgency │
                              └───────┬───────┘
                                      │
                                      ▼
                    ┌─────────────────────────────────┐
                    │      CHECK LANDLORD RULES       │
                    │   (Auto-dispatch thresholds)    │
                    └─────────────────┬───────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
                    ▼                 ▼                 ▼
            ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
            │   EMERGENCY  │  │ UNDER LIMIT  │  │ OVER LIMIT   │
            │              │  │              │  │              │
            │ Auto-dispatch│  │ Auto-dispatch│  │ Request      │
            │ + Notify     │  │ if category  │  │ landlord     │
            │ landlord     │  │ approved     │  │ approval     │
            └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
                   │                 │                 │
                   └─────────────────┴─────────────────┘
                                     │
                                     ▼
                            ┌───────────────┐
                            │  JOB LOGGED   │
                            │               │
                            │ • Quote sent  │
                            │ • Landlord    │
                            │   notified    │
                            │ • Tenant      │
                            │   updated     │
                            └───────────────┘
```

---

## Issue Statuses

```
new ──► ai_helping ──► awaiting_details ──► reported ──► quoted ──► approved ──► scheduled ──► completed
                │
                └──────────────────► resolved_diy (No job needed!)
```

| Status | Description |
|--------|-------------|
| `new` | Just received, not yet processed |
| `ai_helping` | AI is providing DIY assistance |
| `awaiting_details` | Need photos/availability from tenant |
| `reported` | Sent to landlord + admin hub |
| `quoted` | Quote generated |
| `approved` | Landlord approved |
| `scheduled` | Job scheduled with contractor |
| `completed` | Work done |
| `resolved_diy` | Fixed without a job! |

---

## DIY-Safe Issues (AI Will Suggest Fixes)

| Issue | DIY Suggestion |
|-------|----------------|
| Dripping tap | Turn off water, check washer |
| Blocked drain | Plunger, boiling water, baking soda |
| Running toilet | Check float, adjust arm |
| Squeaky door | WD-40 on hinges |
| Cold radiator | Bleed the radiator |
| Light not working | Replace bulb (if accessible) |

## NEVER DIY (Always Log Job)

| Issue | Why |
|-------|-----|
| Gas smell | Safety - evacuate |
| Electrical sparking | Safety - don't touch |
| Water flooding | Emergency dispatch |
| No heating (winter) | Emergency dispatch |
| Structural damage | Professional only |
| Broken locks | Security - urgent |

---

## Landlord Auto-Dispatch Rules

Landlords can configure thresholds to auto-approve jobs without waiting:

```typescript
{
  autoApproveUnder: 150,        // Auto-approve jobs under £150
  requireApprovalAbove: 500,    // Always ask above £500

  autoApproveCategories: [
    'plumbing_emergency',
    'heating',
    'security',
    'water_leak'
  ],

  alwaysRequireApproval: [
    'cosmetic',
    'upgrade'
  ]
}
```

### Decision Logic

```
IF emergency category           → Auto-dispatch immediately
IF price < threshold AND        → Auto-dispatch
   category in approved list
IF price > approval threshold   → Request landlord approval
ELSE                           → Request landlord approval
```

---

## Notifications

### To Tenant
- "We're looking into this"
- "Here's a DIY fix to try..."
- "Your landlord has been notified"
- "A handyman will visit on [date]"
- "Job complete!"

### To Landlord
- "New issue reported at [property]"
- "Issue resolved by DIY (no cost!)"
- "Quote ready for approval: £XX"
- "Job auto-approved (under your threshold)"
- "Job completed"

### To Admin Hub
- All issues visible
- Filter by status/landlord/urgency
- Chase landlord button
- Convert to quote button

---

## API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/whatsapp/incoming` | Twilio webhook for messages |
| `GET /api/admin/tenant-issues` | List all issues |
| `POST /api/admin/tenant-issues/:id/convert` | Convert to quote |
| `POST /api/admin/tenant-issues/:id/chase` | Chase landlord |
| `GET /api/landlord/:token/issues` | Landlord's issues |
| `POST /api/landlord/:token/issues/:id/approve` | Approve quote |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| DIY Resolution Rate | 15-25% |
| Time to First Response | < 30 seconds |
| Landlord Approval Time | < 24 hours |
| Issue → Job Conversion | 60-75% |
