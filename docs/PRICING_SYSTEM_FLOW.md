# HANDY SERVICES — COMPLETE SYSTEM FLOW

## Customer Quote → Margin Preview → Contractor Payout

This document is the single source of truth for how money flows through the platform.
It covers three independent but connected systems:

1. **Customer Pricing** (EVE / Contextual Engine) — what the customer pays
2. **Contractor Pricing** (CVS / WTBP) — what the contractor earns
3. **Margin Preview** — what Ben sees before sending a quote

---

## 1. CUSTOMER PRICING — "What does the customer pay?"

### Engine: Contextual Multi-Line Pricing

**Files:**
- `server/contextual-pricing/multi-line-engine.ts` — orchestrator
- `server/contextual-pricing/multi-line-llm.ts` — LLM pricing (Layer 3)
- `server/contextual-pricing/reference-rates.ts` — market reference rates
- `server/eve-pricing-engine.ts` — EVE segment rates (legacy single-line)

### How it works

```
Customer describes job(s)
        ↓
AI parses into job lines (category + time estimate per line)
        ↓
Layer 1: Reference rate lookup per line (Nottingham market data)
        ↓
Layer 3: Single LLM call prices ALL lines contextually
         (considers urgency, materials, time-of-service, returning customer)
        ↓
Layer 4: Per-line guardrails (floor, ceiling, margin)
        ↓
Sum lines → labour subtotal
        ↓
Batch discount (2+ jobs, capped at 15%)
        ↓
Psychological pricing (total ends in 9)
        ↓
Final customer price
```

### Reference Rates (per category)

These are Nottingham market benchmarks — what a customer would pay going with
any other tradesperson. This is the "purple block" in the EVE diagram.

| Category | Hourly Rate | Min Charge | Market Range |
|---|---|---|---|
| General Fixing | £30/hr | £55 | £25-40/hr |
| Flat Pack | £28/hr | £55 | £20-35/hr |
| TV Mounting | £35/hr | £50 | £30-50/hr |
| Carpentry | £40/hr | £55 | £35-50/hr |
| Plumbing (Minor) | £45/hr | £60 | £40-65/hr |
| Electrical (Minor) | £50/hr | £65 | £45-70/hr |
| Painting | £30/hr | £80 | £25-40/hr |
| Tiling | £40/hr | £60 | £35-55/hr |
| Plastering | £40/hr | £60 | £35-55/hr |
| Lock Change | £50/hr | £70 | £45-80/hr |
| Bathroom Fitting | £50/hr | £150 | £40-65/hr |
| Kitchen Fitting | £50/hr | £200 | £40-65/hr |

Source: Checkatrade, TaskRabbit, Handyman HQ, Lady Bay Handyman, Airtasker — March 2026.

### Guardrails

| Guard | Rule | Purpose |
|---|---|---|
| Floor | Price >= reference rate × time | Never below market average |
| Minimum charge | Per-category minimum (£50-200) | Covers callout cost |
| Ceiling | Max 3x reference (4x emergency) | Prevents gouging |
| Margin floor | Effective rate >= £60/hr | Ensures platform viability |
| Psychological | Final total ends in 9 | Conversion optimisation |
| Returning cap | Max 15% above prev avg × line count | Retention pricing |

### Key principle

> Customer pricing is CONTEXTUAL — it varies per job based on signals.
> The same category can be priced differently depending on urgency,
> time-of-service, customer history, and VA context.

---

## 2. CONTRACTOR PRICING — "What does the contractor earn?"

### Engine: Contractor Value Score (CVS)

**Files:**
- `server/contractor-value-score.ts` — CVS scoring + WTBP rate calculation
- `server/wtbp-routes.ts` — API endpoints for rate card management
- Admin UI: `/admin/wtbp-rates`

### Core principle

> Contractor pricing is STRUCTURAL — it's a fixed hourly rate per category
> that changes slowly. All contractors earn the same rate for the same
> category. The platform competes for contractors on pipeline volume and
> convenience, not on rate negotiation.

### The relationship: Surplus capacity filler, not employer

We are NOT the contractor's main client. We are NOT competing to be their
primary income source. We fill their **surplus hours** — the quiet Tuesday
afternoon, the empty Friday morning, the gap between their own direct jobs.

**This framing is critical because it changes everything about pricing:**

- We're not asking contractors to work for less than they're worth
- We're offering them paid work during time they'd otherwise earn £0
- Any rate above their marginal cost (petrol + wear and tear) is pure profit
- We don't compete with their direct customers — we fill the gaps around them
- The contractor is never dependent on us, and we're never needy

**How we pitch it to contractors:**
> "You've got a free afternoon Tuesday? We've got a 2-hour plumbing job
> in Beeston. £46 in your pocket, we handle everything. Interested?"

**What this means for rates:**
- Surplus hours have near-zero opportunity cost to the contractor
- The alternative is £0 income during that slot
- So our rate doesn't need to match their direct rate — it needs to be
  attractive enough that they'd rather take our job than sit idle
- But we're not exploitative — we pay a fair rate that respects the skill

### WTBP = "What To Budget Per (hour)"

The WTBP rate is what the platform pays the contractor per hour of work.
Contractor pay for a specific job = WTBP hourly rate × job time estimate.

### How WTBP rates are calculated

```
Nottingham subcontractor going rate (what subbies charge builders)
        ↓
Adjusted by CVS score (5 supply-side factors)
        ↓
Surplus capacity discount applied (15-20%)
        ↓
WTBP hourly rate per category
```

### The anchor: Nottingham subcontractor rates

NOT the customer-facing market rate. NOT what end customers pay on Checkatrade.
The anchor is what a subcontractor charges when working for a builder or agency
in Nottingham — the trade-to-trade rate.

**Why this anchor?**
- It's the established rate for trade-to-trade work (not direct-to-customer)
- Subbie rates already exclude marketing, quoting, and customer acquisition
- Our jobs are similar in nature: turn up, do the work, get paid
- But our jobs are even easier than subbing for a builder — we handle
  all customer comms, scheduling, and admin

**Nottingham subcontractor rate benchmarks:**

| Trade Level | Direct Rate | Subbie Rate | Source |
|---|---|---|---|
| General handyman | £25-35/hr | £20-25/hr | Local builder relationships |
| Skilled trade (carpentry, tiling) | £30-40/hr | £22-28/hr | Checkatrade contractor side |
| Specialist (plumbing, electrical) | £35-50/hr | £25-35/hr | Trade body benchmarks |

### Surplus capacity discount: 15-20% below subbie rate

The discount vs subbie rate is justified because:

1. **These are surplus hours** — the contractor would earn £0 otherwise
2. **Zero effort to win the work** — no quoting, no marketing, no chasing
3. **Zero admin** — we handle invoicing, payment, customer comms
4. **Zero risk** — guaranteed payment, our insurance covers the job
5. **Total flexibility** — they only accept jobs when they're free

| What we provide | What it means for the contractor |
|---|---|
| Fill surplus AM/PM/days | Turns dead time into income |
| All customer comms handled | Just turn up and do the work |
| No quoting or estimating | Accept/decline in the app |
| Guaranteed same-week payment | No chasing, no bad debt |
| Insurance covered | No additional policy cost |
| Schedule around their diary | Never conflicts with their own jobs |

**The contractor's calculation:**
> "I'd earn £25/hr if I found this job myself. But I'd need to answer the
> call, go quote it, win it against 3 other quotes, do the work, invoice,
> then chase payment. With Handy Services I get £20/hr, turn up, do the
> work, get paid Tuesday. And I had nothing else on anyway."

This isn't a discount — it's a different product. We're selling convenience
and guaranteed income during downtime.

### CVS (Contractor Value Score) — 5 supply-side factors

Each category is scored 1-5 on five factors that affect what we need to pay:

| Factor | Weight | What it measures |
|---|---|---|
| **Skill Complexity** | 30% | Qualifications, training, expertise needed |
| **Market Scarcity** | 30% | How hard to find contractors in Nottingham |
| **Compliance/Liability** | 20% | Part P, water damage, height safety, DBS |
| **Tool Requirement** | 10% | Specialist equipment the contractor owns |
| **Physical Demand** | 10% | Labour intensity, heights, weather exposure |

**How CVS maps to discount rate:**

| CVS Score | Category Type | Platform Discount | Reasoning |
|---|---|---|---|
| 60-100 | Specialist (electrical, plumbing, locks) | 15% | Scarce — we need them more than they need us |
| 35-59 | Skilled (carpentry, tiling, plastering) | 17% | Moderate supply — balanced relationship |
| 0-34 | Commodity (flat pack, painting, shelving) | 20% | Abundant supply — we have more leverage |

### WTBP Rate Formula

```
WTBP Hourly = Subbie Going Rate × (1 - Platform Discount)
```

Where platform discount is driven by CVS score:
- CVS 0 → 20% discount (commodity)
- CVS 100 → 15% discount (specialist)
- Linear interpolation between

### Rate model

- **Same rate for all contractors** within a category
- No per-contractor negotiation
- Contractors compete on quality, availability, and reviews — not price
- Simplifies dispatching: assign based on availability + proximity, not cost

### WTBP Rate Card (proposed)

| Category | Subbie Rate | CVS | Discount | WTBP/hr | Tier |
|---|---|---|---|---|---|
| Electrical (Minor) | £30/hr | 80 | 16% | £25.00/hr | Specialist |
| Plumbing (Minor) | £28/hr | 60 | 17% | £23.00/hr | Specialist |
| Lock Change | £28/hr | 60 | 17% | £23.00/hr | Specialist |
| Bathroom Fitting | £30/hr | 88 | 15% | £25.50/hr | Specialist |
| Kitchen Fitting | £30/hr | 88 | 15% | £25.50/hr | Specialist |
| Plastering | £25/hr | 48 | 18% | £20.50/hr | Skilled |
| Tiling | £25/hr | 45 | 18% | £20.50/hr | Skilled |
| Carpentry | £24/hr | 40 | 18% | £19.50/hr | Skilled |
| Door Fitting | £22/hr | 37 | 18% | £18.00/hr | Skilled |
| Guttering | £22/hr | 32 | 18% | £18.00/hr | Commodity |
| Fencing | £22/hr | 32 | 18% | £18.00/hr | Commodity |
| TV Mounting | £22/hr | 25 | 19% | £18.00/hr | Commodity |
| Pressure Washing | £20/hr | 25 | 19% | £16.00/hr | Commodity |
| Flooring | £20/hr | 22 | 19% | £16.00/hr | Commodity |
| Painting | £20/hr | 15 | 19% | £16.00/hr | Commodity |
| General Fixing | £20/hr | 13 | 20% | £16.00/hr | Commodity |
| Shelving | £20/hr | 10 | 20% | £16.00/hr | Commodity |
| Curtain/Blinds | £20/hr | 13 | 20% | £16.00/hr | Commodity |
| Silicone/Sealant | £18/hr | 8 | 20% | £14.50/hr | Commodity |
| Flat Pack | £18/hr | 2 | 20% | £14.50/hr | Commodity |
| Garden Maintenance | £18/hr | 10 | 20% | £14.50/hr | Commodity |
| Waste Removal | £18/hr | 25 | 19% | £14.50/hr | Commodity |
| Furniture Repair | £20/hr | 18 | 19% | £16.00/hr | Commodity |

### Guardrails

| Guard | Rule |
|---|---|
| Floor | WTBP never below £14/hr (above national living wage) |
| Ceiling | WTBP never above subbie going rate (we always pay less than direct) |
| Change control | Rate changes require notes for audit trail |
| History | All rate changes tracked with effectiveFrom/effectiveTo dates |

---

## 3. MARGIN PREVIEW — "What Ben sees before sending"

### Where it appears

When Ben (or a VA) generates a quote, the admin view shows:

```
┌─────────────────────────────────────────────────────┐
│  Quote for: Sarah M. — 3 jobs                       │
│                                                     │
│  Line 1: Fix dripping tap (plumbing_minor, 45min)   │
│    Customer price:  £67.00                          │
│    Contractor cost: £17.25  (£23/hr × 0.75hr)      │
│    Margin:          £49.75  (74%)  ✅               │
│                                                     │
│  Line 2: Mount TV (tv_mounting, 60min)              │
│    Customer price:  £79.00                          │
│    Contractor cost: £18.00  (£18/hr × 1hr)          │
│    Margin:          £61.00  (77%)  ✅               │
│                                                     │
│  Line 3: Assemble desk (flat_pack, 90min)           │
│    Customer price:  £59.00                          │
│    Contractor cost: £21.75  (£14.50/hr × 1.5hr)    │
│    Margin:          £37.25  (63%)  ✅               │
│                                                     │
│  ─────────────────────────────────────────────────  │
│  Subtotal:    £205.00                               │
│  Batch disc:  -£16.40 (8%)                          │
│  Final price: £188.69                               │
│                                                     │
│  Total contractor cost: £57.00                      │
│  Total platform margin: £131.69 (70%)               │
│                                                     │
│  [Send Quote]  [Adjust Price]  [Flag for Review]    │
└─────────────────────────────────────────────────────┘
```

### Margin status indicators

| Margin % | Indicator | Action |
|---|---|---|
| >= 40% | ✅ Healthy | Send freely |
| 30-39% | ⚠️ Thin | Warning shown, can still send |
| 20-29% | 🟠 Low | Strong warning, suggest price adjustment |
| < 20% | 🔴 Critical | Flag for review — can still send but logged |

### Margin behaviour: WARNING ONLY

Ben sees the margin but is NOT blocked from sending. Rationale:
- Some thin-margin jobs are strategic (first job for a property manager, foot in door)
- Ben has context the system doesn't (customer relationship, future pipeline)
- Every flagged low-margin quote is logged for Courtnee to review

---

## 4. THE MONEY FLOW

### End-to-end for a single job

```
1. Customer contacts Handy Services
        ↓
2. VA captures job details + context
        ↓
3. System generates quote:
   - AI parses job → category + time estimate
   - Reference rate lookup → market anchor
   - LLM contextual pricing → adjusted price
   - Guardrails → floor/ceiling/margin check
   - Customer price set (e.g. £89)
        ↓
4. Margin preview calculated:
   - WTBP hourly for category looked up (e.g. £23/hr plumbing)
   - Contractor cost = £23 × 1hr = £23
   - Platform margin = £89 - £23 = £66 (74%)
   - Ben sees this before sending
        ↓
5. Quote sent to customer
        ↓
6. Customer books + pays (Stripe)
   - Full amount collected: £89
        ↓
7. Job dispatched to contractor
   - Contractor sees: job details + their payout
   - Payout shown: £23 for this job
        ↓
8. Contractor completes job
   - Uploads completion photos
   - Marks job complete in app
        ↓
9. Contractor paid
   - £23 transferred (weekly batch or per-job)
   - Platform retains £66
        ↓
10. Platform margin covers:
    - Insurance (£2M public liability)
    - Marketing & customer acquisition
    - VA salaries (Ben, team)
    - Platform / tech costs
    - Profit
```

---

## 5. STRATEGIC REASONING

### Why these rates work

**For the contractor:**
- These are surplus hours — they'd earn £0 otherwise
- £14.50-25.50/hr for zero-effort work during downtime
- No marketing, quoting, invoicing, chasing — just turn up and work
- Completely flexible — only accept when they're free
- Never competes with their own direct customer work
- Guaranteed payment, no bad debt risk

**For the platform:**
- Minimum margin of ~30-40% on reference-rate jobs
- Higher margins on contextually-priced jobs (urgency, premium segments)
- Specialist categories have thinner margins (27-34%) but higher absolute £
- Commodity categories have fatter margins (40-54%) but lower absolute £
- Portfolio effect: mix of specialist + commodity averages to healthy 35-45% blended

**For the customer:**
- Prices at or above market reference — we're not the cheapest
- Value proposition is convenience, trust, and reliability — not price
- Customer never sees or knows the contractor rate
- Contractor always available because we're filling their surplus, not competing for busy slots

### Competitive positioning

**Customer side:**
```
    Airtasker ──── Market Low ──── Us ──── Specialist Direct
    (£20/hr)      (£30/hr)    (£45-80/hr)  (£50+/hr)
                                    │
                              Above market average,
                              justified by value
```

**Contractor side:**
```
    Our WTBP ──── Subbie Rate ──── Direct Rate
    (£14-25/hr)   (£20-30/hr)     (£25-50/hr)
         │
    Below subbie rate BUT:
    - Surplus hours (alt = £0)
    - Zero effort to win work
    - Zero admin
    - Guaranteed payment
```

### Contractor retention model

Phase 1 (now): Simple hourly rate per category, same for all.
Retention is driven by volume and convenience, not rate increases.
The pitch: "We keep your quiet days busy."

Phase 2 (later): Bonus system overlaid on base rate:
- 5-star review bonus: +£5 per job
- Speed bonus: job completed under estimated time
- Loyalty bonus: after 50 jobs, base rate increases 5%
- Referral bonus: bring another contractor, earn £50
- Fill-up pack bonus: take a batch of small jobs in one area, earn a route premium

### Rate review cadence

- Monthly: review margin reports, flag any category below 25%
- Quarterly: benchmark subbie rates against Nottingham market
- Annually: full CVS factor re-scoring

---

## 6. KEY FILES REFERENCE

| File | Purpose |
|---|---|
| `server/contextual-pricing/multi-line-engine.ts` | Customer pricing orchestrator |
| `server/contextual-pricing/multi-line-llm.ts` | LLM pricing (Layer 3) |
| `server/contextual-pricing/reference-rates.ts` | Market reference rates per category |
| `server/eve-pricing-engine.ts` | EVE segment rates (legacy/single-line) |
| `server/contractor-value-score.ts` | CVS scoring + WTBP rate calculation |
| `server/margin-engine.ts` | Margin calculation (cost vs price) |
| `server/wtbp-routes.ts` | WTBP rate card API |
| `shared/categories.ts` | Category definitions + labels |
| `shared/contextual-pricing-types.ts` | TypeScript types for pricing system |
| `scripts/show-cvs-vs-wtbp.ts` | CVS vs WTBP comparison report |
| `scripts/test-multijob-pricing-vs-wtbp.ts` | Multi-job quote test with margin analysis |

---

## 7. WHAT NEEDS DOING

### 1. Contractor Pricing Engine (CVS + WTBP)
- [ ] Update CVS engine to use Nottingham subbie rates as anchor (not Airtasker low)
- [ ] Apply 15-20% surplus capacity discount instead of 65-85% capture range
- [ ] Change WTBP from flat per-job to hourly rate model:
  - [ ] Add `rateType` field to `wtbp_rate_card` table ('hourly' vs legacy 'per_job')
  - [ ] Update WTBP API to store/return hourly rates
  - [ ] Update admin UI (`/admin/wtbp-rates`) to show "per hour" rates
- [ ] Seed DB with CVS-calculated hourly rates (replacing made-up seed data)
- [ ] Update contractor detail page (`/admin/contractors/:id`) to show WTBP hourly rates

### 2. Margin Engine Integration
- [ ] Update `calculateCostFromWTBP()` in `server/margin-engine.ts`:
  - Currently takes flat `ratePence` per category
  - Needs to take `hourlyRatePence × timeEstimateMinutes / 60` per line
- [ ] Wire margin calculation into quote generation flow so it's available at quote time
- [ ] Store margin data on the quote record (contractor cost, margin %, flags)

### 3. Margin Preview for Ben
- [ ] Add margin preview panel to contextual quote generation page (`/admin/pricing-engine`)
- [ ] Show per-line: customer price | contractor cost | margin £ | margin %
- [ ] Show totals: total price | total cost | total margin
- [ ] Colour-code margins: green (40%+), yellow (30-39%), orange (20-29%), red (<20%)
- [ ] Warning only — never block sending
- [ ] Log all quotes sent with margin < 25% for Courtnee review

### 4. Contractor-Facing Payout Display
- [ ] Show contractor their payout on job acceptance screen
- [ ] Format: "£46 for this job (2hr plumbing)" — not the hourly rate
- [ ] Contractor sees job payout, never the customer price

### 5. LLM Migration (OpenAI → Anthropic)
- [ ] Create `server/anthropic.ts` client wrapper (SDK already installed)
- [ ] Migrate contextual pricing LLM calls first (`multi-line-llm.ts`)
- [ ] Then migrate remaining 15+ files using OpenAI
- [ ] Replace `gpt-4o-mini` → `claude-haiku-4-5` (cost/speed equivalent)
- [ ] Replace `gpt-4o` → `claude-sonnet-4-6` (reasoning equivalent)

### 6. Later / Phase 2
- [ ] Contractor bonus system (review bonus, speed bonus, loyalty, referral)
- [ ] Fill-up pack route premium
- [ ] Unified margin dashboard (aggregate category margins over time)
- [ ] Rate review automation (quarterly benchmark alerts)
