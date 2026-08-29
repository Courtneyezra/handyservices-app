# Quote Assembly Plan — top-down design

**Status:** agreed 27 Aug 2026 (Courtnee). Governs the granular comms/quote work; build nothing
below that contradicts this. Sits under `docs/AGENT_DECISION_FRAMEWORK.md` — lanes not scores,
COMMIT never autonomous, every agent has an "I can't" exit, escalation lands loudly.

## Why now (evidence, this week)

- **Rebecca (+447452983308):** asked for a combined re-quote, agent tagged `needs_quote`,
  quote-prep's "live quote already out" guard silently skipped it 9 times. Customer held on a
  "shortly" for a day+. Silent lane.
- **Carolyne (+447941828889):** clerk verdict `visit_first`, agent promised a **free** visit
  (policy is paid survey), then 5 holding/apology messages over 22h waiting on a `needs_ben`
  flag nothing consumes. The clerk's three Ben-audience questions sat unread in
  `conversations.metadata.quotePrepIntake.gaps`. Loud promise, silent handoff.

Same root failure both times: **a lane that goes nowhere.** Not model skill — routing and
missing consumers.

## The journey

```
Customer thread
     │
     ▼
[1] SCOPING — comms agent, customer-facing
    Photos/video first. Max 2 scoping questions per thread beyond the
    media ask; past that, route, don't interrogate.
     │
     ▼
[2] TRIAGE LANES — quote-prep clerk (verdicts already exist)
    quote_ready │ needs_info │ visit_first │ decline
     │              │             │            │
     ▼              ▼             ▼            ▼
[3] ASSEMBLY    back to [1]   PAID survey   polite no
    with Ben    (customer Qs) (never free,
                               fee credited)
     │
     ▼
[4] PUSH — Ben's click, always. No agent pushes a quote.
```

## Question routing matrix

| Question type | Who answers | Asked by | Driven by |
|---|---|---|---|
| Scope facts (what/where/how many, access, photos) | Customer | comms agent, house voice, one per reply, **2 max** | Per-SKU intake checklist (rules table) |
| Trade judgment (structural? scaffold? price band?) | Ben | Assembly checklist in admin UI | Clerk's `gaps[audience=ben]` |
| Hidden extent / can't price remotely | Nobody — visit | Paid survey route | Clerk `visit_first` verdict |

Customer never sees Ben-audience questions. Ben never gets asked what the customer could have
answered in the same thread.

## Decisions (27 Aug 2026)

1. **Ben surface: admin UI first.** Gap questions + carried assumptions render as a
   tap-to-answer checklist in `QuotePrepPanel`. Answers update the draft. WhatsApp
   conversational version is v2, same answer store.
2. **Clerk output: full draft quote.** Lines + SKU-based *suggested* prices + assumptions.
   Suggestions clearly marked; Ben edits and confirms. PROPOSE tier — this does not breach
   "quote pricing = COMMIT never" because nothing sends without Ben's click.
3. **Customer question cap: 2** scoping questions beyond the photo/video ask. Hit the cap
   without readiness → route (`visit_first` or `needs_ben`), never keep interrogating.

## Build order

| Phase | What | Notes |
|---|---|---|
| **0. Loud lanes** | Every skip/handoff either acts or alerts. Fix Rebecca guard (stale-quote skip → unblock or pushover), consume-or-alert on `needs_quote`/`needs_ben` tags older than N hours. | Plumbing. In flight: Rebecca fix proposal (pane, awaiting confirm). |
| **1. Intake checklist** | Per-SKU rules table: required photos, measurements, access questions. ~50 SKUs cover 87% of line items. | Rung 3. Prerequisite for 2 and 3. |
| **2. Scoping upgrade** | Comms agent asks customer-audience gaps from the checklist, house voice, 2-question cap enforced in standing orders. | Existing agent, better inputs. |
| **3. Assembly loop** | Clerk compiles full draft quote; QuotePrepPanel shows gap checklist + assumptions for Ben; answers refine draft; Ben pushes. | PROPOSE tier. The "additional agent" is this loop, not a second autonomous sender. |
| **4. Visit lane** | Paid-survey standing orders (in flight, prompt-only), then `book_visit` tool: agent sends paid visit link on existing `/track-visit-booking` + Stripe rails. Agent never confirms a slot itself. | SEND, content-free by construction. |
| **5. Evals** | Rebecca, Carolyne, and the +447831826314 internal-note leak become regression cases per `docs/COMMS_EVALS_PLAN.md`. | Quality lock. |

## Not building

- Autonomous quote pushing or pricing (COMMIT — never).
- A second customer-facing sender. The assembly agent talks to **Ben**, in the UI.
- Free visits, in any wording.
- Unbounded customer questioning.

## In flight as of writing

- Visit policy standing-orders edit (bottom-right pane).
- Rebecca stale-quote guard fix — proposed, awaiting Courtnee's confirm.
- Internal-note leak (+447831826314) investigation (top-left pane).
