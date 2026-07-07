# QUOTE_ENGINE_RETHINK.md

> Planning doc for a rethink of V6 Switchboard's contextual quote engine. Status: **draft for discussion**, not a final spec. Author: planning agent, date: 2026-04-23. Grounded in code as of this commit in the `gallant-shannon-0a802e` worktree.

## Section 1 — Current state map

### 1.1 Admin input surface

File: `client/src/pages/admin/GenerateContextualQuote.tsx` (2,437 lines). The form has **six logical input groups**, each with state held in `useState` hooks inside the `GenerateContextualQuote` component (starts line 785):

| Group | State | Lines | Flows into engine? |
|---|---|---|---|
| Customer identity | `customerName`, `phone`, `email`, `address`, `postcode`, `coordinates` | 789–795 | Stored on quote; not priced |
| Free-text job description | `jobDescription` | 798 | Parsed into `lineItems` via `/api/pricing/parse-job` |
| Parsed line items | `lineItems: LineItem[]` with `{description, category, estimatedMinutes, materialsCostPounds}` | 801 | **Primary pricing input** |
| Context signals (dropdowns) | `signals: {urgency, materialsSupply, timeOfService, isReturningCustomer, previousJobCount, previousAvgPricePence}` | 804–811 | **Primary contextual input to LLM** |
| Free-text VA context | `vaContext` (with optional voice recording) | 814–818 | Injected into LLM user prompt |
| Behavioral toggles | `behavioralSignals: {isCommercialPremises, wontBePresent, priceConscious}` | 825–829 | Appended as extra text onto `vaContext` (lines 918–926) |
| Admin date whitelist | `availableDates: string[]` | 821 | Stored, used by customer date picker |
| Contractor pre-assignment | `selectedContractorId` | 832 | Attaches to quote, drives margin preview |

Category auto-detection in `autoDetectCategory()` (line 190) gives a regex-based seed but LLM parse overrides.

### 1.2 Live preview loop

Lines 855–932: the admin form hits `POST /api/pricing/multi-quote` on a **600ms debounce** every time line items, signals, or `vaContext` change. So the full engine (reference rates → LLM → guardrails) is already re-running on every keystroke. Latency observations below in §6.

### 1.3 Engine flow

Entry: `POST /api/pricing/create-contextual-quote` in `server/contextual-pricing/routes.ts:777`.

```
[input validation — zod schema @ routes.ts:694]
      ↓
[build MultiLineRequest @ routes.ts:792]
      ↓
[content-library claim selection @ selector.ts → routes.ts:810]
   ↓ injects FORCED_CLAIMS based on vaContext keywords (routes.ts:817-837)
      ↓
[historical win rate query (last 90 days) @ routes.ts:854]
      ↓
generateMultiLinePrice() in multi-line-engine.ts:219
   ├─ L1: getReferencePrice() per line → market anchor (engine.ts:231)
   ├─ L2 + L3 (parallel):
   │    polishAllDescriptions() — N parallel Haiku calls to rewrite descriptions (engine.ts:128)
   │    generateMultiLineLLMPrice() — ONE Haiku call for all lines (multi-line-llm.ts:635)
   │        └─ prompt: system (reference rates + owner experience + signal rules) + user (vaContext + lines + signals)
   │        └─ returns: per-line {suggestedPricePence, reasoning, adjustmentFactors}
   │                     + batch discount %
   │                     + messaging {headline, contextualMessage, valueBullets, whatsappClosing, proposalSummary, jobTopLine}
   ├─ L4: applyPerLineGuardrails() — floor, min charge, 3x ceiling, margin floor (engine.ts:152)
   ├─ Materials margin: 27% markup on cost (engine.ts:284)
   ├─ Batch discount: applied to labour subtotal, max 15% (engine.ts:316)
   ├─ Returning customer cap: 15% above previous avg × lineCount (engine.ts:346)
   ├─ Whole-pound rounding on total (engine.ts:367)
   └─ Booking modes: determineBookingModes() — 100% deterministic (engine.ts:59)
      ↓
[dead-zone framing @ routes.ts:886 — £100-£200 band gets extra claims + per-day framing]
      ↓
[margin engine: calculateMultiLineCost + calculateCostFromWTBP @ routes.ts:980, 1008]
      ↓
[INSERT into personalized_quotes @ routes.ts:1112]
      ↓
[PostHog trackQuoteCreated @ routes.ts:1117]
      ↓
[build WhatsApp message — literal string concat @ routes.ts:1187]
      ↓
[return JSON response with quoteUrl + whatsappSendUrl]
```

### 1.4 Where engine output lands in the DB

Table `personalized_quotes` (shared/schema.ts:648). Relevant columns written by the contextual engine:

- `basePrice` — final price in pence (schema.ts:718)
- `contextualHeadline`, `contextualMessage`, `jobTopLine`, `proposalSummary` — schema.ts:789–792
- `valueBullets`, `whatsappValueLines`, `whatsappClosing` — schema.ts:793–795
- `layoutTier`, `bookingModes`, `requiresHumanReview`, `reviewReason` — schema.ts:796–799
- `pricingLineItems` JSONB (per-line with `{guardedPricePence, reasoning, adjustmentFactors, materialsCostPence, materialsWithMarginPence}`) — schema.ts:800
- `pricingLayerBreakdown` JSONB (full `MultiLineResult`) — schema.ts:801
- `batchDiscountPercent` — schema.ts:802
- `contextSignals` JSONB — schema.ts:684 (reused for contextual signals + raw vaContext, routes.ts:1080)
- `selectedContentIds` JSONB — which claims/testimonials/guarantees were picked
- `segment: 'CONTEXTUAL'` — used as the discriminator everywhere

### 1.5 Quote page render

File: `client/src/pages/PersonalizedQuotePage.tsx` (4,920 lines). Contextual quotes branch at line 1444: `isContextual = quote.segment === 'CONTEXTUAL' || !!(quote?.layoutTier && quote?.valueBullets)`. Rendering uses:

- `layoutTier` (quick/standard/complex) → picks layout variant around line 2298/2341/2507
- `contextualHeadline` + `contextualMessage` → hero (line 2204)
- `valueBullets` → value strip (capped per tier, line 2178)
- `pricingLineItems` → line breakdown card (line 2350) via `UnifiedQuoteCard.tsx`
- Content library selections (`quotePlatformImages`, `contentGuarantees`, `contentTestimonials`, `contentHassleItems`) — fetched and displayed inline

### 1.6 WhatsApp message generation

Server-side, one-shot string concat at `routes.ts:1187`. Structure:

```
Hey {firstName},

{contextualMessage}

{linkLabel}  // varies by layoutTier
{quoteUrl}

{whatsappClosing}
{batchNudge if 1 line}
```

The message is returned in the POST response as `whatsappMessage` + a `wa.me` click-to-send URL (`whatsappSendUrl`). There's no multi-turn follow-up generation — if the customer replies, it hits `server/whatsapp-ingest.ts` and lands in `conversations` / `messages` tables but no pricing or follow-up engine re-runs.

### 1.7 Tracking today

**On the quote record itself** (schema.ts:736–742):
- `viewedAt` (first view), `viewCount`, `lastViewedAt`
- `selectedPackage`, `selectedExtras`, `selectedAt`
- `bookedAt`, `depositPaidAt`, `completedAt`
- `rejectionReason`, `feedbackJson`
- `expiresAt`, `extensionCount`, `regenerationCount`

**Section-level engagement**: `quote_section_events` table (schema.ts:2303) — tracks dwell time + scroll depth per section per quote. Used by `server/quote-analytics-api.ts:10`.

**Content conversion**: `quote_platform_images`, `quote_platform_headlines` have `viewCount`/`bookingCount` counters per variant.

**External**: PostHog tracking on quote creation, view, select, book (see `trackQuoteCreated` at routes.ts:1117).

**What's missing**: no snapshot of the engine's original proposal (we only store the final post-edit quote), no record of admin edits between proposal and send, no immutable input-context record — the `contextSignals` column is the closest thing but it's a thin subset.

---

## Section 2 — Proposed unified context model

One shape, versioned, snapshotted at quote creation time. Proposed as a JSONB column `quote_context_snapshot` on `personalized_quotes` (or a side table — see §4).

```ts
interface QuoteContext {
  version: 'v2.0';
  createdAt: string;

  // Customer — everything we know at the point of quoting
  customer: {
    name: string;
    phone: string;           // normalized E.164
    email?: string;
    postcode?: string;
    address?: string;
    coordinates?: { lat: number; lng: number };
    firstSeenAt?: string;    // joined from leads if existing
    previousQuotes?: Array<{
      quoteId: string;
      createdAt: string;
      pricePence: number;
      outcome: 'booked' | 'paid' | 'rejected' | 'expired' | 'sent_not_viewed' | 'viewed_no_action';
    }>;
    creditOnAccountPence?: number;   // e.g. Sharon
    notes?: string;                  // sticky admin notes
  };

  // Raw provenance — all the unstructured stuff we have
  rawContext: {
    vaFreeText?: string;                     // admin typed/dictated narrative
    callTranscripts?: Array<{                // from twilio-realtime / live-call-sessions
      callId: string;
      transcript: string;
      recordedAt: string;
    }>;
    whatsappThread?: Array<{                 // from conversations / messages
      direction: 'in' | 'out';
      body: string;
      at: string;
    }>;
    voiceNoteUrls?: string[];                // s3-media uploads from VA
  };

  // Job — parsed from rawContext + admin edits
  job: {
    rawDescription: string;                  // original before parse
    lines: Array<{
      id: string;
      description: string;                   // polished
      rawDescription: string;                // original pre-polish
      category: JobCategory;
      estimatedMinutes: number;
      materialsCostPence: number;
      adminEdited: boolean;                  // did admin override LLM parse?
    }>;
  };

  // Admin overrides — explicit human decisions captured alongside LLM proposal
  adminOverrides: {
    availableDates: string[];                // hard whitelist
    approvedWording?: Partial<{               // admin can pin specific wording
      headline: string;
      message: string;
      whatsappClosing: string;
      valueBullets: string[];
    }>;
    linePriceOverrides?: Record<string, { pence: number; reason: string }>;
    batchDiscountOverride?: { percent: number; reason: string };
    contractorId?: string;
  };

  // Derived / inferred signals — explicit, auditable, editable
  // CRITICAL: these are LLM-proposed with admin confirm, NOT free-text-only
  derivedSignals: {
    urgency: { value: 'standard' | 'priority' | 'emergency'; source: 'llm_inferred' | 'admin_set'; evidence?: string };
    materialsSupply: { value: 'customer_supplied' | 'we_supply' | 'labor_only'; source: 'llm_inferred' | 'admin_set'; evidence?: string };
    timeOfService: { value: 'standard' | 'after_hours' | 'weekend'; source: 'llm_inferred' | 'admin_set'; evidence?: string };
    isReturningCustomer: { value: boolean; source: 'system_lookup'; previousJobCount: number; previousAvgPricePence: number };

    // Softer signals — LLM-only, no hard price multiplier
    propertySituation?: { type: 'owner_occupied' | 'landlord_remote' | 'tenant' | 'commercial' | 'airbnb'; confidence: 'low' | 'medium' | 'high' };
    priceSensitivity?: { level: 'budget' | 'neutral' | 'premium'; confidence: 'low' | 'medium' | 'high' };
    presenceDuringJob?: 'on_site' | 'absent' | 'partial';
    segment?: 'LANDLORD' | 'PROP_MGR' | 'BUSY_PRO' | 'BUDGET' | 'UNKNOWN';
  };

  // Pricing policy in effect at this moment — snapshotted for reproducibility
  policySnapshot: {
    pricingSettingsVersion: string;
    hourlyRateFloors: Record<JobCategory, number>;
    batchDiscountCap: number;
    materialsMargin: number;
    approvedClaims: string[];
    bannedPhrases: string[];
  };
}
```

### 2.1 Example — Sharon's 22-line landlord refresh with credit

```json
{
  "version": "v2.0",
  "createdAt": "2026-04-23T14:05:00Z",
  "customer": {
    "name": "Sharon Ellis", "phone": "+447700900123", "postcode": "NG7 3AA",
    "previousQuotes": [
      { "quoteId": "quote_...", "pricePence": 124000, "outcome": "paid", "createdAt": "2025-11-02T..." },
      { "quoteId": "quote_...", "pricePence": 86000,  "outcome": "paid", "createdAt": "2026-01-18T..." }
    ],
    "creditOnAccountPence": 5000,
    "notes": "Prefers WhatsApp; lives 2hrs away; always pays promptly."
  },
  "rawContext": {
    "vaFreeText": "Sharon's tenant moves out 28 Apr. Wants everything refreshed before re-let. She's got £50 credit from last job. Can't be there — standard tenant-coordination setup. Said 'just send me the photos when you're done' like usual.",
    "callTranscripts": [{ "callId": "call_abc", "transcript": "...", "recordedAt": "2026-04-23T13:45:00Z" }]
  },
  "job": {
    "rawDescription": "full refresh after tenant — kitchen silicone, regrout bath, 4 internal doors reseated, paint hallway, ...",
    "lines": [ /* 22 lines */ ]
  },
  "adminOverrides": {
    "availableDates": ["2026-04-29", "2026-04-30", "2026-05-01"],
    "approvedWording": { "whatsappClosing": "Set for the 29th as discussed — I'll send photos end of each day." }
  },
  "derivedSignals": {
    "urgency": { "value": "priority", "source": "llm_inferred", "evidence": "tenant moves out 28 Apr, re-let pressure" },
    "materialsSupply": { "value": "we_supply", "source": "llm_inferred", "evidence": "no mention of owner supplying" },
    "timeOfService": { "value": "standard", "source": "llm_inferred" },
    "isReturningCustomer": { "value": true, "source": "system_lookup", "previousJobCount": 2, "previousAvgPricePence": 105000 },
    "propertySituation": { "type": "landlord_remote", "confidence": "high" },
    "presenceDuringJob": "absent",
    "segment": "LANDLORD"
  },
  "policySnapshot": { "pricingSettingsVersion": "2026-04-01.r3", "...": "..." }
}
```

---

## Section 3 — Proposed engine flow

**Design principle**: LLM proposes, admin confirms; signals are *displayed*, not *hidden*.

### 3.1 Single "composer" call

One Anthropic call (Claude Sonnet 4.7 1M for the 22-line case; Haiku 4.5 for ≤6 lines as a cost optimization) that ingests the full `QuoteContext.rawContext + job` and returns a structured `QuoteProposal`:

```ts
interface QuoteProposal {
  inferredSignals: QuoteContext['derivedSignals'];   // with evidence strings

  pricing: {
    lines: Array<{
      lineId: string;
      suggestedPricePence: number;
      floorPence: number; ceilingPence: number;   // echoed from reference rates
      reasoning: string;                           // human-readable, 1-2 sentences
      adjustmentFactors: PricingAdjustmentFactor[];
      confidence: 'high' | 'medium' | 'low';
    }>;
    batchDiscount: { percent: number; reasoning: string };
    materialsMarginNotes?: string;
    loyaltyDiscount?: { percent: number; reasoning: string };     // NEW — surfaced separately, not buried
    totalProposalPence: number;
  };

  quoteCopy: {
    headline: string;
    message: string;
    jobTopLine: string;
    proposalSummary: string;
    valueBullets: string[];      // from approved list
    testimonialHint?: { jobCategory: string; segment: string };
    hassleComparisonHint?: { theme: string };
  };

  whatsapp: {
    initialMessage: string;
    closing: string;
    followups: Array<{            // NEW — pre-draft follow-ups
      triggerAfterHours: 24 | 48 | 72;
      body: string;
      onlyIf: 'viewed_no_action' | 'not_viewed' | 'any';
    }>;
  };

  flags: {
    requiresHumanReview: boolean;
    reviewReasons: string[];       // e.g. "price > £1k", "LLM confidence low on 3 lines"
    priceSanityWarnings: string[]; // e.g. "total 40% above sum of references"
  };
}
```

Then **deterministic post-processing** (non-negotiable, keep from current):
- Floor / minimum / ceiling / margin guardrails (`applyPerLineGuardrails` from engine.ts:152)
- Batch discount cap at 15%
- Returning customer cap (schema.ts: `previousAvgPricePence` logic from engine.ts:346)
- Whole-pound rounding
- `determineBookingModes()` (deterministic, engine.ts:59)

### 3.2 Admin review UI — the critical piece

New admin page replacing `GenerateContextualQuote.tsx`. Layout sketch:

```
┌────────────────────────────────────────────────────────────┐
│ 1. CUSTOMER + RAW CONTEXT                                  │
│    Name, phone, postcode (+ autofill from recent caller)   │
│    [ Paste VA notes / call transcript / WhatsApp thread ]  │
│    [ + attach voice note ]                                 │
│                                                            │
│    → Live: "Found 2 previous quotes (£1,240, £860 paid)"  │
│    → Live: "£50 credit on account"                         │
├────────────────────────────────────────────────────────────┤
│ 2. JOB LINES (from parser, editable inline)                │
│    22 lines · [Add line] [Re-parse from context]           │
├────────────────────────────────────────────────────────────┤
│ 3. LLM PROPOSAL  [Generate]  [Regenerate]  [Edit all]      │
│                                                            │
│    Inferred signals (click to override):                   │
│      ⚡ priority [✓ confirm]  "tenant moves out 28 Apr"    │
│      🛒 we supply [✓ confirm] "no mention of owner..."     │
│      📅 standard  [✓ confirm]                              │
│      🔁 returning (2 jobs, £1,050 avg) [system lookup]     │
│      🏠 landlord_remote — high confidence                  │
│                                                            │
│    Pricing proposal:  £2,145  [loyalty -5% = £2,038]       │
│      [Show per-line reasoning ▼]                           │
│      Line 1: Kitchen silicone · £75 (floor £60, LLM £75)  │
│         "Standard 45min job, no complexity flags"          │
│         [edit price] [edit reasoning]                      │
│      ... (21 more)                                         │
│                                                            │
│    Quote copy proposal:                                    │
│      Headline: "Market-ready in 3 days"  [edit] [regen]    │
│      Message: "..." [edit] [regen]                         │
│      Bullets: [...5 bullets with checkboxes]               │
│                                                            │
│    WhatsApp draft:                                         │
│      Initial: [full message preview]  [edit] [regen]       │
│      Follow-ups: [t+24h] [t+48h] drafts [edit each]        │
│                                                            │
│    ⚠ Flags: "Price 38% above sum of refs — review"         │
├────────────────────────────────────────────────────────────┤
│ 4. AVAILABLE DATES [calendar whitelist]                    │
│ 5. [Send via WhatsApp]  [Preview quote page]               │
└────────────────────────────────────────────────────────────┘
```

Key UX decisions:
- **Signals stay visible, not removed.** User said "counterproductive"; I read that as "don't make admin *fill them in* — let the LLM propose them from context." The signals still exist and still hard-multiply price. This is why I'm preserving them with `source: 'llm_inferred' | 'admin_set'`.
- **Inline reasoning**, not modal. Admin never has to click through. Per-line reasoning is always-on under each line.
- **Edit lock-in**: any field the admin edits gets a subtle "pinned" icon. On regenerate, pinned fields are preserved.

### 3.3 What stays deterministic vs what moves to LLM

| Concern | Today | Proposed | Why |
|---|---|---|---|
| Reference rates (L1) | Deterministic | Unchanged | Market anchor, auditable |
| Per-line price guardrails (floor/ceiling/margin) | Deterministic | Unchanged | Loss prevention, non-negotiable |
| Signal → price multiplier (urgency/timing) | LLM follows rules from prompt | **Still LLM** but signals are now LLM-inferred-then-confirmed | More robust than dropdown-only |
| Batch discount % | LLM suggests, capped at 15% | Unchanged | Already works |
| Materials margin (27%) | Deterministic | Unchanged | Simple rule, no need for LLM |
| Loyalty discount | Prompted as rule, LLM applies | **Surface explicitly** as a separate proposal line, admin can zero it | Right now it's buried in `contextualMessage` — users don't see it |
| Returning customer cap | Deterministic on total | Unchanged | Safety net |
| Booking modes (standard/flexible/urgent/deposit) | Deterministic | Unchanged | Simple decision table |
| Quote copy (headline/bullets/message) | LLM | LLM, but with better context | Where LLM shines |
| WhatsApp message | String template with LLM slots | **Full LLM** (with follow-ups) | Personalization is the whole point |

---

## Section 4 — Tracking + learning loop

### 4.1 Schema additions

Three new tables. Keep `personalized_quotes` unchanged (it's the "latest state of the quote"); these tables give you **immutability** for the learning dataset.

```sql
-- Snapshot of the input context at quote creation (immutable)
CREATE TABLE quote_context_snapshots (
  id                serial PRIMARY KEY,
  quote_id          varchar NOT NULL REFERENCES personalized_quotes(id),
  context_version   varchar NOT NULL,     -- 'v2.0'
  context_json      jsonb   NOT NULL,     -- the full QuoteContext
  created_at        timestamp DEFAULT now() NOT NULL
);
CREATE INDEX idx_qcs_quote ON quote_context_snapshots(quote_id);

-- Snapshot of the LLM's proposal BEFORE admin edits (immutable)
CREATE TABLE quote_proposals (
  id                serial PRIMARY KEY,
  quote_id          varchar NOT NULL REFERENCES personalized_quotes(id),
  proposal_version  integer NOT NULL,     -- 1 = first call, 2 = regenerate, etc
  model             varchar NOT NULL,     -- 'claude-sonnet-4-7-1m'
  proposal_json     jsonb   NOT NULL,     -- the full QuoteProposal
  total_pence       integer NOT NULL,
  token_cost        jsonb,                -- {input_tokens, output_tokens, cost_pence}
  latency_ms        integer,
  created_at        timestamp DEFAULT now() NOT NULL
);
CREATE INDEX idx_qp_quote ON quote_proposals(quote_id);

-- Admin edits — one row per edit event (immutable, append-only)
CREATE TABLE quote_edits (
  id                serial PRIMARY KEY,
  quote_id          varchar NOT NULL REFERENCES personalized_quotes(id),
  proposal_id       integer NOT NULL REFERENCES quote_proposals(id),
  edited_by         varchar,              -- admin user id
  field_path        varchar NOT NULL,     -- e.g. 'pricing.lines.abc.suggestedPricePence'
  old_value         jsonb,
  new_value         jsonb,
  reason            text,                 -- optional free text
  created_at        timestamp DEFAULT now() NOT NULL
);
CREATE INDEX idx_qe_quote ON quote_edits(quote_id);
CREATE INDEX idx_qe_field ON quote_edits(field_path);
```

Already existing, reuse as-is:
- `quote_section_events` (scroll + dwell per section, schema.ts:2303)
- `personalized_quotes.viewedAt / viewCount / selectedAt / bookedAt / depositPaidAt / rejectionReason`
- `quote_platform_images.{viewCount, bookingCount}` + `quote_platform_headlines.{viewCount, bookingCount}`

### 4.2 Derived outcome label

Add `outcome` as a computed column or materialized view:

```ts
type QuoteOutcome =
  | 'converted_paid'        // depositPaidAt is not null
  | 'converted_booked'      // bookedAt set but not paid
  | 'viewed_no_action'      // viewedAt set, expiresAt passed, no booking
  | 'sent_not_viewed'       // viewedAt null, expiresAt passed
  | 'rejected'              // rejectionReason set
  | 'in_progress';          // none of the above, not expired
```

### 4.3 Analysis queries this enables

```sql
-- "What wording converts in LANDLORD segment?"
SELECT
  q.contextual_headline,
  COUNT(*) as sent,
  COUNT(q.deposit_paid_at) as paid,
  ROUND(COUNT(q.deposit_paid_at)::numeric / COUNT(*) * 100, 1) as conv_rate
FROM personalized_quotes q
JOIN quote_context_snapshots s ON s.quote_id = q.id
WHERE s.context_json->'derivedSignals'->'segment'->>'value' = 'LANDLORD'
GROUP BY q.contextual_headline
HAVING COUNT(*) >= 5
ORDER BY conv_rate DESC;

-- "Win rate when batch discount > 10%"
SELECT
  CASE WHEN batch_discount_percent > 10 THEN '>10%' ELSE '<=10%' END as bucket,
  COUNT(*), COUNT(booked_at), COUNT(deposit_paid_at)
FROM personalized_quotes
WHERE created_at > now() - interval '90 days'
GROUP BY bucket;

-- "Which LLM-proposed prices did admins consistently override?"
SELECT
  field_path,
  COUNT(*) as edit_count,
  AVG((new_value->>'pence')::int - (old_value->>'pence')::int) as avg_delta_pence
FROM quote_edits
WHERE field_path LIKE 'pricing.lines.%.suggestedPricePence'
GROUP BY field_path
ORDER BY edit_count DESC;
```

---

## Section 5 — Migration path

### 5.1 Additive-only first

No changes to existing columns or the existing `/api/pricing/create-contextual-quote` endpoint in Phase 1. New endpoint + new admin page run in parallel.

### 5.2 Discriminator

Use `personalized_quotes.segment = 'CONTEXTUAL_V2'` (parallel to existing `'CONTEXTUAL'`). `PersonalizedQuotePage.tsx` line 1444 already uses a `isContextual` flag — extend to also match `CONTEXTUAL_V2` for render, but keep render logic identical for Phase 1 (new engine, same page).

### 5.3 Phased rollout

**Phase 1 (2–3 weeks)**: Build behind admin toggle.
- New endpoint `POST /api/pricing/v2/create-quote` writes `segment = 'CONTEXTUAL_V2'` plus the 3 new tables.
- New admin page at `/admin/quotes/compose` (keep `/admin/generate-contextual-quote` working).
- Toggle in admin settings: "Use new quote composer (beta)".
- Shadow mode option: run new engine in parallel on existing quotes, log the two proposals side by side, don't send the new one. Pure observation.

**Phase 2 (2–4 weeks)**: Default on, old path retired.
- Flip toggle default to "new composer".
- Old form marked deprecated in UI.
- At least 50 `CONTEXTUAL_V2` quotes with `bookedAt` recorded before moving to Phase 3.

**Phase 3 (1 week)**: Remove old code.
- Delete `GenerateContextualQuote.tsx` (2,437 lines) and the old endpoint route handler.
- Keep the engine files if still referenced — `multi-line-engine.ts` and `multi-line-llm.ts` likely become the inner implementation of the v2 composer.

### 5.4 Don't backfill

Old quotes render fine. There's no reason to reconstruct a `QuoteContext` for a quote that already closed/expired. New tables start at the migration date. If you ever want a longer baseline, run a backfill script that creates `quote_context_snapshots` rows from the existing `contextSignals` JSONB — but don't block on it.

---

## Section 6 — Open questions + trade-offs

### 6.1 LLM cost vs quality

One composer call with Sonnet 4.7 1M at ~15k input tokens / 4k output tokens = roughly £0.12–0.20 per quote (order of magnitude, not a precise quote). Multiply by regenerations. At 50 quotes/day that's ~£4–10/day. Not a blocker — but it's 10x the current Haiku cost. Options:

- **Cheap tier for ≤6 lines** → Haiku 4.5 (current). Works fine.
- **Expensive tier for ≥10 lines / returning customers / high-value** → Sonnet.
- Consider prompt-caching the system prompt (approved claims, reference rates, banned phrases) — saves ~40% on repeated calls.

### 6.2 Deterministic vs LLM — where's the line

My recommendation: **price floors, ceilings, materials margin, returning-customer caps, booking modes, and rounding stay deterministic**. These are loss-prevention rules that should never be at the mercy of an LLM JSON-parse failure. Everything above those guardrails (the "suggestion" the guardrails constrain) is LLM. This is basically today's design — keep it.

The harder question: **does the admin ever see a guardrail-triggered price?** Today guardrails modify the price silently (with reasoning added to `adjustments`). In the new composer, I'd surface them visually: *"LLM suggested £55, floor raised to £75 (reference rate × hours)"*. Admin can choose to accept or manually override downward with a reason.

### 6.3 WhatsApp — one-shot vs conversational

Today: one-shot. Proposed: one-shot initial message + pre-drafted follow-ups at t+24h / t+48h / t+72h (conditional on `viewCount`/`viewedAt`).

True conversational agent (replies to customer WhatsApp messages) is a much bigger project — there's already `docs/WHATSAPP_AGENT_ARCHITECTURE.md` and `server/conversation-engine.ts`. For this rethink, **stop at pre-drafted follow-ups**. Let the conversational agent consume the QuoteContext when it's ready.

### 6.4 Real-time vs async preview

**Red flag**: the prompt says "engine takes ~40s for 22 lines". Looking at `multi-line-engine.ts`, the LLM call is a single Haiku completion with `max_tokens: 8192`. Haiku 4.5 at 8k output tokens is ~10-15s, not 40s — and there's a live preview already running on a 600ms debounce (routes.ts:369; component.ts:915). Either (a) the 40s number is measured wrong, (b) it's the polish + LLM + margin combined under cold-start, or (c) the 22-line case actually does approach 40s because output tokens scale with lines.

Action: **measure before designing**. If Sonnet on the 22-line case is 15-25s, keep live preview with a spinner on big quotes. If it's genuinely 40s+, switch to two-stage UX: instant L1 reference-based estimate → admin clicks "Generate proposal" for the full LLM pass.

### 6.5 Privacy / compliance

Storing raw call transcripts + WhatsApp threads in `quote_context_snapshots` is a data-protection escalation vs today (where we store the VA's summary in `contextSignals`). Minimum:

- Add a retention policy (e.g. 24 months) and a scheduled purge.
- Customer-facing privacy notice update (mention "we use previous conversations to quote accurately").
- PII redaction option for long-term analytics dumps — strip phone, email, address before feeding into offline analysis tools.

### 6.6 Things I pushed back on

- **"Structured signal dropdowns are counterproductive."** Partially true. The *fill-in* UX is counterproductive (admin wastes time). But the *signals themselves* are load-bearing price multipliers — removing them means the LLM has to re-infer urgency from prose every call, with inconsistent results on weak context. The proposal here is **LLM infers, admin confirms with one tap**. Not full AI autonomy, not structured dropdowns.
- **"Everything through one LLM pass."** Mostly yes, but keep `polishAllDescriptions` separate (it parallelizes across N lines and returns fast) and keep the deterministic guardrails. One composer LLM call + one N-parallel polish call + deterministic pre/post = the right shape.
- **The 22-line Sharon case**: the current UI has no good way to review 22 line reasonings without endless scroll. The new composer needs a "review mode" (collapse-all / expand-flagged-only) or the admin will just rubber-stamp everything, which defeats the human-in-the-loop.

---

### Critical Files for Implementation

- `/Users/courtneebonnick/v6-switchboard/server/contextual-pricing/multi-line-engine.ts` — current orchestrator; becomes the inner deterministic post-processor in v2
- `/Users/courtneebonnick/v6-switchboard/server/contextual-pricing/multi-line-llm.ts` — current single LLM call; replaced by a new composer prompt (or extended to emit the full `QuoteProposal` shape)
- `/Users/courtneebonnick/v6-switchboard/server/contextual-pricing/routes.ts` — current `/create-contextual-quote`; add a parallel `/v2/create-quote` here
- `/Users/courtneebonnick/v6-switchboard/client/src/pages/admin/GenerateContextualQuote.tsx` — current 2,437-line admin form; replaced by a new composer page
- `/Users/courtneebonnick/v6-switchboard/shared/schema.ts` — add three new tables (`quote_context_snapshots`, `quote_proposals`, `quote_edits`); keep `personalized_quotes` unchanged
