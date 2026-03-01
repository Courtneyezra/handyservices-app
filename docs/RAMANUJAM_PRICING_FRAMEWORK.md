# Madhavan Ramanujam Pricing Framework for Handy Services

## Core Principles (Adapted)

### 1. Segment by WTP, Not Demographics
Don't segment by age/location. Segment by what they VALUE and what they'll PAY FOR.

### 2. Single Product Focus
Show ONE product per segment. Add-ons expand, tiers confuse.

### 3. The Apple Clarification
Apple shows multiple products to let customers SELF-SEGMENT. Once you click "iPhone Pro", you see one product with options - not a comparison table.

For handy services: The CONVERSATION is where self-segmentation happens. The QUOTE PAGE shows one product, tailored to detected segment.

---

## The Segment List (Revised)

### Final Segments (8 total)

| Segment | WTP Driver | Description | Priority |
|---------|------------|-------------|----------|
| **EMERGENCY** | Urgency | Crisis mode - leaks, floods, broken locks. Highest WTP. | 1 (always check first) |
| **BUSY_PRO** | Time | Dual-income, time-poor. Pay for speed & convenience. | 2 |
| **PROP_MGR** | Scale + SLA | 3-50+ properties. Needs reporting, volume pricing, reliability. | 3 |
| **LANDLORD** | Zero Hassle | 1-3 properties, often remote. Needs photo proof, tenant coord. | 4 |
| **SMALL_BIZ** | Zero Disruption | Retail/office. Pay for after-hours, minimal impact. | 5 |
| **TRUST_SEEKER** | Safety + Trust | Vulnerable/anxious homeowners. Need vetted, patient, trustworthy. | 6 |
| **DIY_DEFERRER** | Finally Done | Been putting it off. Responds to batching, permission to delegate. | 7 (default) |
| **RENTER** | Approval + Budget | Doesn't own property. Needs landlord approval, cost-conscious. | 8 |

### Segments Removed

| Old Segment | Problem | Resolution |
|-------------|---------|------------|
| **BUDGET** | Price sensitivity exists in ALL segments | Replaced with **RENTER** (specific situation) |
| **OLDER_WOMAN** | Demographic, not WTP-based | Replaced with **TRUST_SEEKER** (value driver) |
| **UNKNOWN** | Not actionable | Use **DIY_DEFERRER** as default |

### Why These Segments Work

Each segment has:
1. **Distinct WTP driver** - What they value enough to pay for
2. **Distinct messaging** - What to say (and never say)
3. **Distinct pricing model** - How to structure the offer
4. **Detectable signals** - How to identify them in conversation

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SEGMENT HIERARCHY                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  EMERGENCY ──────► Always check first. Crisis = highest WTP.            │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  PROPERTY-BASED (job address ≠ contact address)                 │    │
│  │  ├── PROP_MGR (3+ properties, professional, wants SLA)          │    │
│  │  └── LANDLORD (1-3 properties, individual, wants hassle-free)   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  CONTEXT-BASED (distinct situation)                             │    │
│  │  ├── SMALL_BIZ (commercial address, after-hours need)           │    │
│  │  ├── BUSY_PRO (time-poor signals, convenience focus)            │    │
│  │  ├── TRUST_SEEKER (vulnerability signals, trust focus)          │    │
│  │  └── RENTER (doesn't own, needs approval)                       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│       │                                                                 │
│       ▼                                                                 │
│  DIY_DEFERRER ───► Default. Safe middle-ground for unclear signals.    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Part 1: Conversation-Based Segment Detection

### The Challenge
You can't ask: "Are you a landlord?" or "What's your budget?"

You CAN ask normal quoting questions that ALSO reveal segment.

### The Framework: Dual-Purpose Questions

Every question serves two purposes:
1. **Operational** - Info you need anyway
2. **Segmentation** - Reveals WTP drivers

#### Question Bank

| Question (Natural) | Operational Purpose | Segment Signal |
|-------------------|---------------------|----------------|
| "What's the address for the job?" | Location/travel | Different from contact address → LANDLORD/PROP_MGR |
| "Will someone be home?" | Access planning | "My tenant" → LANDLORD, "I work" → BUSY_PRO |
| "When would suit you best?" | Scheduling | "ASAP" → EMERGENCY/BUSY_PRO, "Whenever" → DIY_DEFERRER |
| "Is this a home or business?" | Pricing/logistics | Business → SMALL_BIZ |
| "How long has this been an issue?" | Scope understanding | "Months/years" → DIY_DEFERRER, "Just happened" → EMERGENCY |
| "Are there any other jobs while we're there?" | Upsell | Long list → DIY_DEFERRER, "Regular maintenance" → PROP_MGR |
| "How did you hear about us?" | Marketing | "My letting agent" → PROP_MGR network |

### Signal Weighting System

```
Segment Score = Σ (Signal Weight × Confidence)
```

#### LANDLORD Detection

| Signal | Weight | Source |
|--------|--------|--------|
| Job address ≠ contact address | 0.8 | Address comparison |
| Mentions "tenant" | 0.9 | Transcript keyword |
| Mentions "rental", "BTL", "investment" | 0.9 | Transcript keyword |
| Asks for photos/report | 0.6 | Transcript pattern |
| "I can't be there" | 0.7 | Transcript pattern |
| Asks for invoice format | 0.5 | Transcript pattern |

**Threshold**: Score ≥ 1.5 → Classify as LANDLORD

#### BUSY_PRO Detection

| Signal | Weight | Source |
|--------|--------|--------|
| Wants earliest slot | 0.6 | Transcript pattern |
| "Before/after work" | 0.8 | Transcript keyword |
| Call during commute hours (7-9am, 5-7pm) | 0.4 | Timestamp |
| Short, direct messages | 0.3 | Message style |
| "Just get it done" | 0.7 | Transcript pattern |
| Professional email domain | 0.4 | Contact info |

#### DIY_DEFERRER Detection

| Signal | Weight | Source |
|--------|--------|--------|
| "Been meaning to" / "put off" | 0.9 | Transcript keyword |
| "Finally getting round to" | 0.9 | Transcript pattern |
| "Months" / "years" problem duration | 0.7 | Transcript pattern |
| Multiple small jobs | 0.6 | Job description |
| "My partner's been asking" | 0.7 | Transcript pattern |

#### EMERGENCY Detection (Check First - Highest Priority)

| Signal | Weight | Source |
|--------|--------|--------|
| "Leak" / "flooding" / "water everywhere" | 0.95 | Transcript keyword |
| "Emergency" / "urgent" / "right now" | 0.9 | Transcript keyword |
| "Broken" + access-related (lock, door, window) | 0.85 | Transcript pattern |
| Contact outside business hours (before 8am, after 6pm) | 0.5 | Timestamp |
| All caps / multiple exclamations | 0.4 | Message style |
| Multiple messages in < 5 minutes | 0.4 | Message pattern |
| Weekend/bank holiday contact | 0.3 | Timestamp |

**Threshold**: Score ≥ 0.9 → Classify as EMERGENCY (override other segments)

#### TRUST_SEEKER Detection (was OLDER_WOMAN)

| Signal | Weight | Source |
|--------|--------|--------|
| "My husband used to" / "passed away" | 0.9 | Transcript pattern |
| "Can't do it myself anymore" | 0.8 | Transcript pattern |
| "Need someone I can trust" | 0.9 | Transcript keyword |
| "Bit nervous" / "worried about" | 0.7 | Transcript pattern |
| Landline number (not mobile) | 0.4 | Contact info |
| Daytime availability mentioned | 0.3 | Transcript pattern |
| Formal/polite language style | 0.3 | Message style |
| "Can you explain" / "tell me what's involved" | 0.6 | Transcript pattern |

**Threshold**: Score ≥ 1.2 → Classify as TRUST_SEEKER

#### RENTER Detection (was BUDGET)

| Signal | Weight | Source |
|--------|--------|--------|
| "I'm renting" / "I rent" / "rented flat" | 0.95 | Transcript keyword |
| "My landlord" / "letting agent" / "agency" | 0.9 | Transcript keyword |
| "Need to check with landlord" | 0.85 | Transcript pattern |
| "Can you invoice my landlord?" | 0.8 | Transcript pattern |
| "Deposit" / "inventory" mentioned | 0.6 | Transcript keyword |
| "Not sure if I'm allowed" | 0.7 | Transcript pattern |

**Threshold**: Score ≥ 1.0 → Classify as RENTER

#### SMALL_BIZ Detection

| Signal | Weight | Source |
|--------|--------|--------|
| Commercial address | 0.8 | Address type |
| "Shop" / "office" / "premises" | 0.9 | Transcript keyword |
| "Before we open" / "after hours" | 0.7 | Transcript pattern |
| Company name in contact | 0.6 | Contact info |
| Asks about invoicing/VAT | 0.5 | Transcript pattern |

#### PROP_MGR Detection

| Signal | Weight | Source |
|--------|--------|--------|
| "I manage" / "property manager" / "portfolio" | 0.95 | Transcript keyword |
| "Multiple properties" / "several units" | 0.9 | Transcript pattern |
| Company email domain | 0.7 | Contact info |
| "Invoice to company" / "net 30" / "payment terms" | 0.8 | Transcript pattern |
| References to "our properties" (plural) | 0.85 | Transcript pattern |
| "Ongoing relationship" / "regular work" | 0.7 | Transcript pattern |
| Multiple addresses in conversation | 0.8 | Transcript pattern |

**Threshold**: Score ≥ 1.5 → Classify as PROP_MGR

### Conversation Flow for Detection

```
┌─────────────────────────────────────────────────────────────┐
│                    INCOMING CONTACT                         │
│               (Call transcript / WhatsApp)                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 1: PASSIVE SIGNALS (No questions needed)              │
│  - Time of contact                                          │
│  - Message urgency/style                                    │
│  - Keywords in initial message                              │
│  - Contact info (email domain, etc.)                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 2: NATURAL QUESTIONS (Asked anyway)                   │
│  Q1: "What needs doing?" → Job type + duration signals      │
│  Q2: "What's the address?" → Compare to contact address     │
│  Q3: "When suits you?" → Urgency signals                    │
│  Q4: "Will someone be home?" → Access + occupancy signals   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 3: SCORE CALCULATION                                  │
│  Run signal weights for each segment                        │
│  Select highest-scoring segment above threshold             │
│  Default: DIY_DEFERRER (safest middle-ground)               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  STEP 4: GENERATE QUOTE                                     │
│  Single product, segment-specific messaging                 │
│  Segment-appropriate add-ons                                │
│  Tailored trust signals + testimonial                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Part 2: Single Product Per Segment

### Why Not Tiers?

**Tier Comparison Problems:**
1. Analysis paralysis - "Which do I need?"
2. Anchors on cheapest - "I'll just get Basic"
3. Feature comparison - Focuses on what's MISSING
4. Looks commoditized - Same as every other quote

**Single Product Benefits:**
1. Clear decision - "Yes or no?"
2. Anchors on value - "Here's what you get"
3. Add-ons feel like bonuses - Not missing features
4. Feels bespoke - "This is for YOU"

### The Structure

```
┌─────────────────────────────────────────────────────────────┐
│  [SEGMENT] QUOTE PAGE                                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  TRUST STRIP                                                │
│  "£2M Insured • 4.9★ (127 reviews) • [Segment proof]"       │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  HERO                                                       │
│  [Segment-specific headline]                                │
│  [Segment-specific subhead]                                 │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  SINGLE PRODUCT                                             │
│  "[Product Name]" ─────────────────────────── £XXX          │
│                                                             │
│  ✓ [Included feature 1 - tied to segment pain]              │
│  ✓ [Included feature 2 - tied to segment value]             │
│  ✓ [Included feature 3 - differentiator]                    │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ADD-ONS (Optional)                                         │
│  □ [Add-on 1] ─────────────────────────────── FREE          │
│  □ [Add-on 2] ─────────────────────────────── +£XX          │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  TOTAL: £XXX                          [ BOOK NOW ]          │
│                                                             │
│  "Not right? We return and fix it free."                    │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  TESTIMONIAL                                                │
│  "[Segment-matched quote from similar customer]"            │
│  — [Name], [Segment identifier]                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Segment Product Cards

#### LANDLORD

```yaml
product_name: "Landlord Service"
hero:
  headline: "Your Rental. Handled."
  subhead: "One text. We sort it."

trust_strip: "£2M Insured • 4.9★ (127 reviews) • 180+ landlords trust us"

included:
  - "48-72hr scheduling"
  - "Photo report included"
  - "Tax-ready invoice"

add_ons:
  - name: "Tenant Coordination"
    price: "FREE"
  - name: "Key Collection"
    price: "£30"

guarantee: "Not right? We return and fix it free. No questions."

testimonial:
  quote: "I live 2 hours away. They coordinated with my tenant, sent photos, invoice was in my email by 5pm."
  name: "Mark T."
  identifier: "Landlord, 2 properties"
```

#### BUSY_PRO

```yaml
product_name: "Priority Service"
hero:
  headline: "Sorted Before You're Home."
  subhead: "Book in 90 seconds. Done while you work."

trust_strip: "£2M Insured • 4.9★ (127 reviews) • Average booking: 90 seconds"

included:
  - "Flexible scheduling (early/late slots)"
  - "SMS updates throughout"
  - "No need to be there (key safe/neighbour)"

add_ons:
  - name: "Same-Day Service"
    price: "+£50"
  - name: "Photo Completion Report"
    price: "FREE"

guarantee: "Not right? We return and fix it free."

testimonial:
  quote: "Booked at 7am, sorted by lunch. Didn't even need to leave work."
  name: "Sarah K."
  identifier: "Marketing Director"
```

#### DIY_DEFERRER

```yaml
product_name: "Get It Done Service"
hero:
  headline: "Finally. Sorted."
  subhead: "That job you've been putting off? We've got it."

trust_strip: "£2M Insured • 4.9★ (127 reviews) • 500+ 'finally done' jobs"

included:
  - "Fixed price (no nasty surprises)"
  - "All materials included"
  - "Proper job, done right"

add_ons:
  - name: "While We're There Bundle"
    price: "20% off additional jobs"
  - name: "Photo Before/After"
    price: "FREE"

guarantee: "Not right? We return and fix it free."

testimonial:
  quote: "Should've called months ago. They did in 2 hours what I'd been putting off for a year."
  name: "James P."
  identifier: "Finally got the bathroom fixed"
```

#### EMERGENCY

```yaml
product_name: "Emergency Response"
hero:
  headline: "We're On Our Way."
  subhead: "Emergency callout. Sorted today."

trust_strip: "£2M Insured • 4.9★ (127 reviews) • Average response: 2 hours"

included:
  - "Same-day attendance"
  - "Emergency-rated tradesperson"
  - "Problem contained + permanent fix quoted"

add_ons:
  - name: "Out-of-Hours Callout"
    price: "+£50"

guarantee: "If we can't fix it, you don't pay the callout."

testimonial:
  quote: "Water everywhere at 6pm. They were here by 7:30, leak stopped, mess cleaned up."
  name: "Helen R."
  identifier: "Emergency leak"
```

#### SMALL_BIZ

```yaml
product_name: "Business Service"
hero:
  headline: "Zero Disruption."
  subhead: "We work around your customers, not the other way round."

trust_strip: "£2M Insured • 4.9★ (127 reviews) • 50+ local businesses"

included:
  - "Before-open or after-close scheduling"
  - "Clean, professional tradesperson"
  - "VAT invoice for expenses"

add_ons:
  - name: "Weekend/Evening Work"
    price: "+£40"
  - name: "Ongoing Maintenance Contract"
    price: "Quote"

guarantee: "Not right? We return and fix it free."

testimonial:
  quote: "They came at 6am, finished before we opened. Customers never knew."
  name: "Coffee Shop Owner"
  identifier: "Leaking ceiling fixed"
```

#### PROP_MGR

```yaml
product_name: "Property Manager Service"
hero:
  headline: "Your Portfolio. Covered."
  subhead: "One text. We handle it. Invoice follows."

trust_strip: "£2M Insured • 4.9★ (127 reviews) • 230+ properties serviced"

included:
  - "48-72hr response SLA"
  - "Photo report on every job"
  - "Same-day invoice emailed"
  - "Tenant coordination included"

add_ons:
  - name: "Partner Program"
    price: "10% off all jobs"
    note: "Offered after 3+ completed jobs"
  - name: "Key Holding"
    price: "£15/month per property"

guarantee: "Miss our SLA? 20% off that job."

testimonial:
  quote: "They service 12 of my properties now. One text, sorted, invoice in my inbox. No chasing."
  name: "Sarah M."
  identifier: "Property Manager, 15 units"
```

#### TRUST_SEEKER

```yaml
product_name: "Trusted Home Service"
hero:
  headline: "Someone You Can Trust."
  subhead: "Vetted, patient, respectful. We take our time to do it right."

trust_strip: "£2M Insured • DBS Checked • 4.9★ (127 reviews) • 'Felt completely safe'"

included:
  - "ID-verified, background-checked tradesperson"
  - "We call before we arrive"
  - "Tidy workers - we treat your home with respect"
  - "We explain everything before we start"

add_ons:
  - name: "Call to Discuss First"
    price: "FREE"
  - name: "Fixed Price (No Hourly)"
    price: "Available on request"

guarantee: "Not comfortable? We leave. No charge."

testimonial:
  quote: "Since my husband passed, I've been nervous about tradesmen. They were patient, explained everything, cleaned up beautifully. I finally have someone I can call."
  name: "Margaret H."
  identifier: "Repeat customer, 4 jobs"
```

#### RENTER

```yaml
product_name: "Renter Service"
hero:
  headline: "Your Rental. Fixed Right."
  subhead: "We can invoice your landlord directly if needed."

trust_strip: "£2M Insured • 4.9★ (127 reviews) • Renter-friendly"

included:
  - "Fixed quote upfront (no surprises)"
  - "Photo before/after for your records"
  - "Invoice format landlords accept"
  - "We note what was pre-existing (protects your deposit)"

add_ons:
  - name: "Invoice Landlord Directly"
    price: "FREE"
  - name: "Detailed Report for Landlord"
    price: "FREE"

guarantee: "Not happy? We make it right. Protects your deposit."

testimonial:
  quote: "They sent photos and a proper invoice to my landlord. Got reimbursed the same week."
  name: "Tom S."
  identifier: "Renter, leaky tap fixed"
```

---

## Part 3: Implementation

### Database Schema Additions

```sql
-- Segment detection signals per lead
ALTER TABLE leads ADD COLUMN detected_segment VARCHAR(20);
ALTER TABLE leads ADD COLUMN segment_confidence DECIMAL(3,2);
ALTER TABLE leads ADD COLUMN segment_signals JSONB;

-- Example segment_signals:
-- {
--   "address_mismatch": true,
--   "mentioned_tenant": true,
--   "urgency_keywords": false,
--   "contact_time": "14:30",
--   "message_style": "formal"
-- }
```

### Detection Function

```typescript
interface SegmentSignal {
  signal: string;
  weight: number;
  detected: boolean;
  source: 'keyword' | 'pattern' | 'context' | 'metadata';
}

interface SegmentScore {
  segment: string;
  score: number;
  confidence: number;
  signals: SegmentSignal[];
}

type SegmentType =
  | 'EMERGENCY'
  | 'PROP_MGR'
  | 'LANDLORD'
  | 'SMALL_BIZ'
  | 'BUSY_PRO'
  | 'TRUST_SEEKER'
  | 'RENTER'
  | 'DIY_DEFERRER';

const SEGMENT_THRESHOLDS: Record<SegmentType, number> = {
  EMERGENCY: 0.9,      // Low threshold - if any emergency signal, catch it
  PROP_MGR: 1.5,       // High threshold - need multiple signals
  LANDLORD: 1.5,       // High threshold - need multiple signals
  SMALL_BIZ: 1.2,
  BUSY_PRO: 1.0,
  TRUST_SEEKER: 1.2,
  RENTER: 1.0,
  DIY_DEFERRER: 0,     // Default - no threshold
};

function detectSegment(
  transcript: string,
  metadata: {
    contactTime: Date;
    jobAddress?: string;
    contactAddress?: string;
    emailDomain?: string;
    phoneType?: 'mobile' | 'landline';
  }
): { segment: SegmentType; confidence: number; signals: SegmentSignal[] } {

  const scores: Record<SegmentType, SegmentScore> = {
    EMERGENCY: { segment: 'EMERGENCY', score: 0, confidence: 0, signals: [] },
    PROP_MGR: { segment: 'PROP_MGR', score: 0, confidence: 0, signals: [] },
    LANDLORD: { segment: 'LANDLORD', score: 0, confidence: 0, signals: [] },
    SMALL_BIZ: { segment: 'SMALL_BIZ', score: 0, confidence: 0, signals: [] },
    BUSY_PRO: { segment: 'BUSY_PRO', score: 0, confidence: 0, signals: [] },
    TRUST_SEEKER: { segment: 'TRUST_SEEKER', score: 0, confidence: 0, signals: [] },
    RENTER: { segment: 'RENTER', score: 0, confidence: 0, signals: [] },
    DIY_DEFERRER: { segment: 'DIY_DEFERRER', score: 0, confidence: 0, signals: [] },
  };

  const lower = transcript.toLowerCase();

  // ═══════════════════════════════════════════════════════════════
  // EMERGENCY - Check first, highest priority
  // ═══════════════════════════════════════════════════════════════
  if (/leak|flood|water everywhere|burst pipe/i.test(lower)) {
    scores.EMERGENCY.score += 0.95;
    scores.EMERGENCY.signals.push({ signal: 'water_emergency', weight: 0.95, detected: true, source: 'keyword' });
  }
  if (/emergency|urgent|right now|immediately/i.test(lower)) {
    scores.EMERGENCY.score += 0.9;
    scores.EMERGENCY.signals.push({ signal: 'urgency_keywords', weight: 0.9, detected: true, source: 'keyword' });
  }
  if (/broken.*(lock|door|window)|locked out/i.test(lower)) {
    scores.EMERGENCY.score += 0.85;
    scores.EMERGENCY.signals.push({ signal: 'security_emergency', weight: 0.85, detected: true, source: 'pattern' });
  }
  const hour = metadata.contactTime.getHours();
  if (hour < 8 || hour > 18) {
    scores.EMERGENCY.score += 0.5;
    scores.EMERGENCY.signals.push({ signal: 'out_of_hours_contact', weight: 0.5, detected: true, source: 'context' });
  }

  // ═══════════════════════════════════════════════════════════════
  // PROP_MGR - Multiple properties, professional
  // ═══════════════════════════════════════════════════════════════
  if (/property manager|i manage|portfolio|multiple properties/i.test(lower)) {
    scores.PROP_MGR.score += 0.95;
    scores.PROP_MGR.signals.push({ signal: 'prop_mgr_keywords', weight: 0.95, detected: true, source: 'keyword' });
  }
  if (/net 30|payment terms|invoice to company/i.test(lower)) {
    scores.PROP_MGR.score += 0.8;
    scores.PROP_MGR.signals.push({ signal: 'business_invoicing', weight: 0.8, detected: true, source: 'pattern' });
  }
  if (metadata.emailDomain && !metadata.emailDomain.includes('gmail') && !metadata.emailDomain.includes('yahoo')) {
    scores.PROP_MGR.score += 0.7;
    scores.PROP_MGR.signals.push({ signal: 'company_email', weight: 0.7, detected: true, source: 'metadata' });
  }

  // ═══════════════════════════════════════════════════════════════
  // LANDLORD - Different address, tenant mentions
  // ═══════════════════════════════════════════════════════════════
  if (metadata.jobAddress && metadata.contactAddress && metadata.jobAddress !== metadata.contactAddress) {
    scores.LANDLORD.score += 0.8;
    scores.LANDLORD.signals.push({ signal: 'address_mismatch', weight: 0.8, detected: true, source: 'metadata' });
  }
  if (/my tenant|the tenant|tenant lives|rental property|btl|buy.to.let/i.test(lower)) {
    scores.LANDLORD.score += 0.9;
    scores.LANDLORD.signals.push({ signal: 'landlord_keywords', weight: 0.9, detected: true, source: 'keyword' });
  }
  if (/can't be there|won't be there|send.*photo|i live.*away/i.test(lower)) {
    scores.LANDLORD.score += 0.7;
    scores.LANDLORD.signals.push({ signal: 'remote_landlord', weight: 0.7, detected: true, source: 'pattern' });
  }

  // ═══════════════════════════════════════════════════════════════
  // SMALL_BIZ - Commercial, after-hours need
  // ═══════════════════════════════════════════════════════════════
  if (/shop|office|restaurant|cafe|business|premises|commercial/i.test(lower)) {
    scores.SMALL_BIZ.score += 0.9;
    scores.SMALL_BIZ.signals.push({ signal: 'business_keywords', weight: 0.9, detected: true, source: 'keyword' });
  }
  if (/before we open|after close|after hours|no disruption/i.test(lower)) {
    scores.SMALL_BIZ.score += 0.7;
    scores.SMALL_BIZ.signals.push({ signal: 'after_hours_need', weight: 0.7, detected: true, source: 'pattern' });
  }

  // ═══════════════════════════════════════════════════════════════
  // RENTER - Doesn't own, needs approval
  // ═══════════════════════════════════════════════════════════════
  if (/i'm renting|i rent|rented flat|rented house/i.test(lower)) {
    scores.RENTER.score += 0.95;
    scores.RENTER.signals.push({ signal: 'renter_keywords', weight: 0.95, detected: true, source: 'keyword' });
  }
  if (/my landlord|letting agent|need to check|get approval/i.test(lower)) {
    scores.RENTER.score += 0.85;
    scores.RENTER.signals.push({ signal: 'needs_approval', weight: 0.85, detected: true, source: 'pattern' });
  }
  if (/deposit|inventory|end of tenancy/i.test(lower)) {
    scores.RENTER.score += 0.6;
    scores.RENTER.signals.push({ signal: 'tenancy_concerns', weight: 0.6, detected: true, source: 'keyword' });
  }

  // ═══════════════════════════════════════════════════════════════
  // TRUST_SEEKER - Vulnerability, trust focus
  // ═══════════════════════════════════════════════════════════════
  if (/husband (passed|died)|wife (passed|died)|on my own now/i.test(lower)) {
    scores.TRUST_SEEKER.score += 0.9;
    scores.TRUST_SEEKER.signals.push({ signal: 'bereavement', weight: 0.9, detected: true, source: 'pattern' });
  }
  if (/can't do it myself|used to do this myself|getting on a bit/i.test(lower)) {
    scores.TRUST_SEEKER.score += 0.8;
    scores.TRUST_SEEKER.signals.push({ signal: 'capability_change', weight: 0.8, detected: true, source: 'pattern' });
  }
  if (/someone i can trust|bit nervous|worried about strangers/i.test(lower)) {
    scores.TRUST_SEEKER.score += 0.9;
    scores.TRUST_SEEKER.signals.push({ signal: 'trust_concern', weight: 0.9, detected: true, source: 'keyword' });
  }
  if (metadata.phoneType === 'landline') {
    scores.TRUST_SEEKER.score += 0.4;
    scores.TRUST_SEEKER.signals.push({ signal: 'landline_number', weight: 0.4, detected: true, source: 'metadata' });
  }

  // ═══════════════════════════════════════════════════════════════
  // BUSY_PRO - Time-poor, convenience focus
  // ═══════════════════════════════════════════════════════════════
  if (/before work|after work|lunch break|earliest slot/i.test(lower)) {
    scores.BUSY_PRO.score += 0.8;
    scores.BUSY_PRO.signals.push({ signal: 'time_constrained', weight: 0.8, detected: true, source: 'keyword' });
  }
  if (/won't be home|not home|key safe|just get it done/i.test(lower)) {
    scores.BUSY_PRO.score += 0.7;
    scores.BUSY_PRO.signals.push({ signal: 'hands_off', weight: 0.7, detected: true, source: 'pattern' });
  }
  if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19)) {
    scores.BUSY_PRO.score += 0.4;
    scores.BUSY_PRO.signals.push({ signal: 'commute_time_contact', weight: 0.4, detected: true, source: 'context' });
  }

  // ═══════════════════════════════════════════════════════════════
  // DIY_DEFERRER - Been putting it off
  // ═══════════════════════════════════════════════════════════════
  if (/been meaning|put off|finally|getting around to/i.test(lower)) {
    scores.DIY_DEFERRER.score += 0.9;
    scores.DIY_DEFERRER.signals.push({ signal: 'deferral_keywords', weight: 0.9, detected: true, source: 'keyword' });
  }
  if (/months|years|ages|long time/i.test(lower)) {
    scores.DIY_DEFERRER.score += 0.7;
    scores.DIY_DEFERRER.signals.push({ signal: 'long_duration', weight: 0.7, detected: true, source: 'keyword' });
  }
  if (/list of|few things|couple of jobs|while you're there/i.test(lower)) {
    scores.DIY_DEFERRER.score += 0.6;
    scores.DIY_DEFERRER.signals.push({ signal: 'multiple_jobs', weight: 0.6, detected: true, source: 'pattern' });
  }

  // ═══════════════════════════════════════════════════════════════
  // PRIORITY-BASED SELECTION
  // ═══════════════════════════════════════════════════════════════
  const priority: SegmentType[] = [
    'EMERGENCY',     // Always check first
    'PROP_MGR',      // High value, distinct
    'LANDLORD',      // High value, distinct
    'SMALL_BIZ',     // Distinct needs
    'RENTER',        // Specific situation
    'TRUST_SEEKER',  // Specific needs
    'BUSY_PRO',      // Common
    'DIY_DEFERRER',  // Default
  ];

  for (const seg of priority) {
    if (scores[seg].score >= SEGMENT_THRESHOLDS[seg]) {
      return {
        segment: seg,
        confidence: Math.min(scores[seg].score / 2, 1),
        signals: scores[seg].signals,
      };
    }
  }

  // Default fallback
  return {
    segment: 'DIY_DEFERRER',
    confidence: 0.5,
    signals: [{ signal: 'default_fallback', weight: 0, detected: true, source: 'context' }],
  };
}
```

### Quote Generation Integration

```typescript
async function generateQuote(leadId: number) {
  const lead = await db.query.leads.findFirst({ where: eq(leads.id, leadId) });

  // Get segment (use detected or default)
  const segment = lead.detected_segment || 'DIY_DEFERRER';

  // Get segment config
  const config = SEGMENT_CONFIGS[segment];

  // Generate quote with segment-specific pricing
  const quote = {
    segment,
    productName: config.productName,
    hero: config.hero,
    trustStrip: config.trustStrip,
    includedFeatures: config.included,
    addOns: config.addOns,
    guarantee: config.guarantee,
    testimonial: config.testimonial,
    basePrice: calculateBasePrice(lead.jobDescription, segment),
  };

  return quote;
}
```

---

## Part 4: Metrics & Iteration

### Track These

| Metric | Why |
|--------|-----|
| Segment detection accuracy | Manual review sample monthly |
| Quote-to-book by segment | Which segments convert best? |
| Add-on attach rate by segment | Which extras resonate? |
| Price sensitivity by segment | Where can you raise prices? |
| Override rate | How often is detected segment wrong? |

### Iterate

1. **Monthly**: Review 20 random leads, check segment accuracy
2. **Quarterly**: Adjust signal weights based on conversion data
3. **When adding signals**: A/B test before full rollout

---

## Quick Reference

### Detection Priority Order

Check in this order (first match wins if score above threshold):

```
1. EMERGENCY ──────► Leak/flood/broken? → EMERGENCY (score ≥ 0.9)
       │
2. PROP_MGR ───────► Multiple properties + professional? → PROP_MGR (score ≥ 1.5)
       │
3. LANDLORD ───────► Different address + tenant mention? → LANDLORD (score ≥ 1.5)
       │
4. SMALL_BIZ ──────► Commercial address/business keywords? → SMALL_BIZ (score ≥ 1.2)
       │
5. RENTER ─────────► "I rent" / "my landlord"? → RENTER (score ≥ 1.0)
       │
6. TRUST_SEEKER ───► Vulnerability/trust signals? → TRUST_SEEKER (score ≥ 1.2)
       │
7. BUSY_PRO ───────► Time-poor signals? → BUSY_PRO (score ≥ 1.0)
       │
8. DIY_DEFERRER ───► Default fallback
```

### Segment → Messaging Cheat Sheet

| Segment | Lead With | Never Say | WTP Premium |
|---------|-----------|-----------|-------------|
| **EMERGENCY** | "We're on our way" | "Earliest slot is Tuesday" | +50-100% |
| **PROP_MGR** | "SLA + invoice same day" | "One-off pricing" | Volume discount |
| **LANDLORD** | "Photo proof + invoice" | "You'll need to be there" | Standard |
| **SMALL_BIZ** | "Zero disruption, after-hours" | "We'll come during trading" | +30-40% |
| **BUSY_PRO** | "Done by [time], hands-off" | "Depends on availability" | +20-40% |
| **TRUST_SEEKER** | "Vetted, patient, trustworthy" | "Quick in-and-out job" | Standard |
| **RENTER** | "We can invoice your landlord" | "Premium service" | Standard |
| **DIY_DEFERRER** | "Finally get it sorted" | "Easy DIY fix" | Bundle discount |

### Segment Summary Table

| Segment | Core Need | Pricing Model | Default Product |
|---------|-----------|---------------|-----------------|
| EMERGENCY | Fix it NOW | Premium fixed | Emergency Response |
| PROP_MGR | Scale + accountability | Volume/SLA | Property Manager Service |
| LANDLORD | Zero hassle, proof | Fixed | Landlord Service |
| SMALL_BIZ | Zero disruption | After-hours premium | Business Service |
| BUSY_PRO | Speed, convenience | Priority premium | Priority Service |
| TRUST_SEEKER | Safety, patience | Fixed (no hourly) | Trusted Home Service |
| RENTER | Approval, budget | Fixed, transparent | Renter Service |
| DIY_DEFERRER | Finally done | Bundle discount | Get It Done Service |
