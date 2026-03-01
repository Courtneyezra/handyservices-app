# Handy Services Master Plan

## Vision
Two-sided platform: Free contractor app (supply) + Handy Services network (demand) + Franchisees (local ops)

## Business Model Decisions
| Decision | Choice |
|----------|--------|
| Launch Priority | Handy Services First - prove model with current contractors |
| Franchise Model | Hybrid - £250/month + 5-8% revenue share |
| Contractor Fees | Per-job commission - 15-20% of job value |

---

## Core Principle: AI Handles Volume, Humans Handle Value

**Problem**: Human time spent on every lead = unsustainable
**Solution**: AI qualifies and segments leads → Humans only engage with high-value prospects

```
SCORE 70+  → Human calls within 10 min (worth your time)
SCORE 40-69 → AI sends quote link, human only if they engage
SCORE <40  → Auto-decline politely, no human time
```

---

## Task List (Ordered)

### Phase 1: Foundation (Week 1)
| # | Task | Status | Priority |
|---|------|--------|----------|
| 1.1 | Fix payment flow bugs on quotes | ⏸️ DEFERRED | 🟡 Manual workaround for now |
| 1.2 | Get new WhatsApp number (giffgaff SIM) | ⬜ TODO | 🔴 Critical |
| 1.3 | Build AI Call Parser service | ⬜ TODO | 🔴 Critical |
| 1.4 | Add lead scoring to database schema | ⬜ TODO | 🟡 High |
| 1.5 | Build missed call WhatsApp recovery | ⏸️ BLOCKED | 🟡 Needs WhatsApp API |
| 1.6 | Clean up legacy files (5 files) | ⬜ TODO | 🟢 Low |

### Phase 2: Qualification System (Week 2)
| # | Task | Status | Priority |
|---|------|--------|----------|
| 2.1 | Integrate AI parser with call transcripts | ⬜ TODO | 🔴 Critical |
| 2.2 | Auto-calculate lead score on creation | ⬜ TODO | 🔴 Critical |
| 2.3 | Auto-detect segment from call | ⬜ TODO | 🔴 Critical |
| 2.4 | Build qualification routing logic | ⬜ TODO | 🟡 High |
| 2.5 | Add qualification questions to webform | ⬜ TODO | 🟡 High |

### Phase 3: WhatsApp Automation (Week 3)
| # | Task | Status | Priority |
|---|------|--------|----------|
| 3.1 | Apply for Twilio WhatsApp number | ⬜ TODO | 🔴 Critical |
| 3.2 | Build WhatsApp AI qualification bot | ⬜ TODO | 🔴 Critical |
| 3.3 | Connect bot to lead scoring | ⬜ TODO | 🟡 High |
| 3.4 | Build auto-quote sender for warm leads | ⬜ TODO | 🟡 High |
| 3.5 | Set up routing alerts for hot leads | ⬜ TODO | 🟡 High |

### Phase 4: Calendar & Booking (Week 4)
| # | Task | Status | Priority |
|---|------|--------|----------|
| 4.1 | Add contractor availability to profiles | ⬜ TODO | 🟡 High |
| 4.2 | Show available slots on quote page | ⬜ TODO | 🟡 High |
| 4.3 | Auto-block calendar on booking | ⬜ TODO | 🟡 High |
| 4.4 | Contractor notification on booking | ⬜ TODO | 🟢 Medium |

### Phase 5: AI Nurture Sequences (Week 5)
| # | Task | Status | Priority |
|---|------|--------|----------|
| 5.1 | Build follow-up sequence engine | ⬜ TODO | 🟡 High |
| 5.2 | Quote reminder sequence (4h, 24h, 48h) | ⬜ TODO | 🟡 High |
| 5.3 | Lost lead remarketing sequence | ⬜ TODO | 🟢 Medium |
| 5.4 | Time-waster auto-filter rules | ⬜ TODO | 🟢 Medium |

---

## Call Qualification Script (60-Second Framework)

### Goal
In 60 seconds: Know if HOT/WARM/COLD + which segment they belong to.

### The Script

```
OPENING:
"Hi, thanks for calling V6 Handyman! I'm [name].
What do you need help with today?"
→ Note: specific job or vague "various things"?

QUESTION 2:
"Got it. And when do you need this done?"
→ ASAP = +25 | This week = +10 | Flexible = -10

QUESTION 3:
"Is this your home, a rental you own, or a rental you live in?"
→ Own home = DEFAULT segment
→ Rental I own = LANDLORD segment (ask Q4)
→ Tenant = -10 score, check authority

QUESTION 4 (if rental owner):
"Do you manage other properties too?"
→ Yes, multiple = PROP_MGR segment
→ Just this one = LANDLORD segment

QUESTION 5:
"Is this for home or for a business?"
→ Business = SMALL_BIZ segment

QUESTION 6:
"What's your postcode?"
→ In area = +10 | Out of area = decline

QUESTION 7:
"Have you had a go at fixing it yourself?"
→ Yes, tried = DIY_DEFERRER segment signal

QUESTION 8 (if they seem rushed):
"Are you at work? Want us to text you instead?"
→ Yes, very busy = BUSY_PRO segment signal
```

### Segment Detection Reference

| If They Say... | Segment |
|----------------|---------|
| "I'm a landlord" / "my rental" / "tenant issue" | LANDLORD |
| "I manage X properties" / "portfolio" / "agency" | PROP_MGR |
| "I'm at work" / "really busy" / "squeeze me in" | BUSY_PRO |
| "It's for my shop/office/business" | SMALL_BIZ |
| "I tried fixing it but..." / "made it worse" | DIY_DEFERRER |
| "What's the cheapest option?" / "tight budget" | BUDGET |
| None of above | DEFAULT (homeowner) |

### Red Flag Phrases (End quickly, low score)

- "Just getting prices" → "I'll text you our rate card" (Score: -20)
- "Can you give me a rough idea?" → "Need to see it, minimum £85" (Score: -15)
- "I've had 5 quotes already" → Price shopper (Score: -25)
- "My landlord will decide" → No authority (Score: -15)

### Green Light Phrases (Invest time, high score)

- "Can you come today/tomorrow?" (+25)
- "How quickly can you get here?" (+20)
- "I've got a few jobs actually" (+15)
- "I just want it sorted" (+15)
- "Money's not the issue" (+20)

### Decision Tree

| Score | Segment Known? | Action |
|-------|----------------|--------|
| 70+ | Yes | "Let me get details, we'll get you sorted today" → Full engagement |
| 70+ | No | Ask 1-2 more questions to segment, then engage |
| 40-69 | Any | "I'll send you a quote within the hour" → Auto-quote |
| <40 | Any | "Thanks! We'll send our info" → End call, no follow-up |

---

## AI Call Parser Service

### Purpose
Automatically analyze call transcripts to extract:
1. Qualification score (0-100)
2. Customer segment
3. Job details
4. Red flags

### Output Schema

```typescript
interface CallAnalysis {
  // Qualification
  qualificationScore: number;      // 0-100
  qualificationGrade: 'HOT' | 'WARM' | 'COLD';
  shouldFollowUp: boolean;

  // Segment
  segment: SegmentType;
  segmentConfidence: number;       // 0-100
  segmentSignals: string[];        // Evidence from transcript

  // Job Details
  jobCategory: string;             // tap_repair, door_fitting, etc.
  jobDescription: string;          // Natural description
  urgency: 'emergency' | 'this_week' | 'flexible';
  estimatedValue: 'low' | 'medium' | 'high';

  // Customer
  customerName: string;
  phoneNumber: string;
  postcode: string;
  isOwner: boolean;
  propertyType: 'home' | 'rental_owned' | 'rental_tenant' | 'commercial';

  // Red Flags
  redFlags: string[];

  // Next Action
  recommendedAction: 'call_back_now' | 'send_quote' | 'nurture' | 'decline';
}
```

### Scoring Rules

```
BASE SCORE: 50

POSITIVE SIGNALS:
+25  Emergency/ASAP urgency
+15  Specific job described
+15  Owner or landlord (has authority)
+10  In service area
+10  Replied/engaged quickly
+15  Multiple jobs mentioned
+10  Tried DIY first (desperate)

NEGATIVE SIGNALS:
-20  "Just getting prices"
-15  Vague job ("various things")
-15  Tenant without authority
-25  "Already got quotes" (price shopping)
-10  Flexible timing (low urgency)
-30  Out of service area
-25  No response after 24h

GRADE:
70-100 = HOT
40-69  = WARM
0-39   = COLD
```

### GPT System Prompt

```
You are analyzing a handyman service call transcript.

TASK: Extract qualification score, customer segment, and job details.

SCORING (start at 50, add/subtract):
+25 Emergency/ASAP
+15 Specific job
+15 Owner/landlord
+10 In area
+15 Multiple jobs
-20 "Just getting prices"
-15 Vague job
-15 No authority
-25 Price shopping

SEGMENTS (pick one):
- LANDLORD: Owns 1-3 rental properties, mentioned tenant/rental
- PROP_MGR: Manages 4+ properties, agency, portfolio
- BUSY_PRO: Working professional, time-poor, convenience-focused
- SMALL_BIZ: Commercial property, shop, office
- DIY_DEFERRER: Tried fixing themselves, gave up
- BUDGET: Price-focused, tight budget mentioned
- DEFAULT: Standard homeowner, none of above

RED FLAGS to detect:
- Price shopping signals
- No authority to proceed
- Out of service area
- Unrealistic expectations

Return valid JSON matching the CallAnalysis schema.
```

### Integration Points

1. **After call ends** → Parse transcript → Store analysis on lead
2. **Lead list view** → Show score badge + segment tag
3. **Auto-routing** → Notify human only for HOT leads
4. **Quote generation** → Use segment for personalized quote

---

## WhatsApp AI Qualification Bot

### Purpose
Automatically qualify incoming WhatsApp leads before human engagement.

### Conversation Flow

```
CUSTOMER: "Hi, I need a handyman"

BOT: "Hi! 👋 Thanks for getting in touch.
What do you need help with?
(e.g., leaking tap, door repair, shelves)"

CUSTOMER: "Leaking tap in bathroom"

BOT: "Got it - leaking tap 🔧
When do you need this done?

1️⃣ Emergency (today/tomorrow)
2️⃣ This week
3️⃣ Just planning ahead"

CUSTOMER: "1"

BOT: "Understood - we'll prioritise this!
What's your postcode?"

CUSTOMER: "NG5 1AB"

BOT: "Great, we cover that area ✅

Is this your own home, a rental you own,
or a rental you're living in?"

CUSTOMER: "Rental I own"

BOT: "Perfect! Do you manage other rental
properties too, or just this one?"

CUSTOMER: "Just this one"

BOT [Internal: LANDLORD segment, Score 85]:
"Thanks! One of our team will call you
within 10 minutes to get this sorted.

What's the best number to reach you?
(Or reply QUOTE if you'd prefer
a quote sent here first)"
```

### Bot Scoring Logic

```typescript
function calculateWhatsAppScore(answers: BotAnswers): number {
  let score = 50;

  // Job specificity
  if (answers.jobDescription.length > 20) score += 15;
  if (answers.jobDescription === 'various' ||
      answers.jobDescription === 'few things') score -= 10;

  // Urgency
  if (answers.urgency === 'emergency') score += 25;
  if (answers.urgency === 'this_week') score += 10;
  if (answers.urgency === 'planning') score -= 15;

  // Property
  if (answers.propertyType === 'own_home') score += 10;
  if (answers.propertyType === 'rental_owned') score += 15;
  if (answers.propertyType === 'rental_tenant') score -= 10;

  // Area
  if (isInServiceArea(answers.postcode)) score += 10;
  else score = 0; // Auto-decline

  // Engagement
  if (answers.responseTime < 5 * 60 * 1000) score += 5; // Under 5 min

  return score;
}
```

### Routing Rules

| Score | Segment | Bot Response | Human Action |
|-------|---------|--------------|--------------|
| 70+ | Any | "Team will call in 10 mins" | Alert sent, call ASAP |
| 70+ | LANDLORD/PROP_MGR | + "We work with lots of landlords" | Priority alert |
| 40-69 | Any | "I'll send you a quote now" | Auto-quote, no alert |
| 40-69 | Any | If they reply, escalate to human | Monitor only |
| <40 | Any | "We're quite booked up right now" | No action |

---

## WhatsApp Number Setup

### Option A: Quick Setup (Today)
1. Buy giffgaff SIM (£6/month) - order online or get from shop
2. Put SIM in any old phone
3. Install WhatsApp Business app
4. Use this number for testing bot flows manually
5. Later migrate to Twilio API

### Option B: Proper Setup (1-2 weeks)
1. Apply for Twilio WhatsApp-enabled number
2. Submit business verification to Meta
3. Get approved (takes 5-10 business days)
4. Connect to system via API
5. Full automation enabled

### Recommended Path
```
DAY 1:   Get giffgaff SIM, set up WhatsApp Business
         Test qualification flow manually

WEEK 1:  Apply for Twilio WhatsApp number
         Continue manual testing
         Build bot logic in code

WEEK 2:  Twilio approval comes through
         Connect API
         Deploy automated bot
```

---

## Webform Qualification

### Current Fields
- Name
- Phone
- Email
- Message (freeform)

### Add These Questions (No Budget!)

```
1. "What do you need help with?" [Dropdown]
   - Plumbing (taps, toilets, leaks)
   - Doors & Windows
   - Electrical (sockets, lights)
   - Carpentry (shelves, furniture)
   - General Repairs
   - Multiple Jobs
   - Other

2. "When do you need this done?" [Radio]
   - Emergency (same day)
   - Within 2-3 days
   - This week
   - I'm flexible / Just planning

3. "Is this for..." [Radio]
   - My own home
   - A rental property I own
   - A property I manage
   - My business premises
   - I'm a tenant

4. "Postcode" [Text input]
   → Auto-validate service area
```

### Auto-Scoring on Submit

```typescript
function scoreWebformLead(form: WebformData): number {
  let score = 50;

  // Urgency
  if (form.timing === 'emergency') score += 25;
  if (form.timing === 'within_2_3_days') score += 15;
  if (form.timing === 'this_week') score += 10;
  if (form.timing === 'flexible') score -= 10;

  // Property type
  if (form.propertyType === 'own_home') score += 10;
  if (form.propertyType === 'rental_owned') score += 15;
  if (form.propertyType === 'property_managed') score += 15;
  if (form.propertyType === 'business') score += 10;
  if (form.propertyType === 'tenant') score -= 10;

  // Job type
  if (form.jobType === 'multiple_jobs') score += 10;

  // Service area
  if (!isInServiceArea(form.postcode)) score = 0;

  return score;
}
```

### Segment Detection from Webform

| Property Type Selection | Segment |
|-------------------------|---------|
| "A rental property I own" | LANDLORD |
| "A property I manage" | PROP_MGR |
| "My business premises" | SMALL_BIZ |
| "My own home" + Emergency | BUSY_PRO (likely) |
| "My own home" + Flexible | DEFAULT or DIY_DEFERRER |
| "I'm a tenant" | DEFAULT (low priority) |

---

## Metrics & Success Criteria

### This Week
- [ ] 10 jobs booked through system
- [ ] Payment success rate >95%
- [ ] First response <10 min for HOT leads
- [ ] New WhatsApp number active

### This Month
- [ ] 50+ leads processed
- [ ] 15%+ lead-to-booking conversion
- [ ] <15 min human time per job (avg)
- [ ] AI parser accuracy >80%
- [ ] WhatsApp bot handling WARM leads

### Before Scaling
- [ ] 50+ jobs/month in Nottingham
- [ ] 3+ reliable contractors
- [ ] WhatsApp automation working
- [ ] Payment flow bulletproof
- [ ] Clear unit economics (CAC < £30, LTV > £150)

---

## NOT Building Right Now

Deferred until core operations solid:

- [ ] Contractor app (CRM for independents)
- [ ] Franchise dashboard
- [ ] Multi-city expansion
- [ ] Advanced AI voice agent (live call handling)
- [ ] Partner program automation
- [ ] Full Kanban pipeline view

---

## Code Cleanup (Low Priority)

### Files to Remove
| File | Reason |
|------|--------|
| `server/quote-engine.ts` | Superseded by `value-pricing-engine.ts` |
| `server/dashboard.ts` | Superseded by `admin-dashboard-routes.ts` |
| `server/handymen.ts` | Superseded by `admin-contractors-routes.ts` |
| `server/upload.ts` | Superseded by `media-upload.ts` |
| `server/job-routes.ts` | Superseded by `job-assignment.ts` |
| `server/machine-learning.ts` | Empty placeholder |

### Before Removing
1. Check `server/index.ts` for route mounts
2. Grep for imports across codebase
3. Remove routes from index.ts first
4. Delete files

---

## File Changes Required

### New Files to Create
| File | Purpose |
|------|---------|
| `server/services/call-analyzer.ts` | AI call parser service |
| `server/services/lead-scorer.ts` | Lead qualification scoring |
| `server/services/whatsapp-bot.ts` | WhatsApp qualification bot |
| `server/services/segment-detector.ts` | Auto-detect segment from signals |

### Files to Modify
| File | Changes |
|------|---------|
| `shared/schema.ts` | Add lead score, segment fields |
| `server/leads.ts` | Add scoring on lead creation |
| `server/twilio-realtime.ts` | Hook call parser after call ends |
| `server/twilio-routes.ts` | Add missed call handler |
| `client/src/pages/HandymanLanding.tsx` | Add qualification questions |

---

## Implementation Order

```
WEEK 1: Foundation
├── Day 1-2: Fix payment bugs
├── Day 2: Get giffgaff SIM, set up WhatsApp
├── Day 3-4: Build AI call parser
└── Day 5: Add lead scoring to schema

WEEK 2: Qualification System
├── Day 1-2: Integrate parser with call flow
├── Day 2-3: Auto-score and segment on lead creation
├── Day 4: Qualification routing logic
└── Day 5: Webform qualification questions

WEEK 3: WhatsApp Automation
├── Day 1: Apply for Twilio WhatsApp (if not done)
├── Day 2-3: Build WhatsApp bot logic
├── Day 4: Connect bot to scoring
└── Day 5: Test full flow

WEEK 4: Calendar & Polish
├── Day 1-2: Contractor availability
├── Day 3: Slot selection on quotes
├── Day 4: Auto-booking flow
└── Day 5: Full system test
```
