# Agent Decision Framework

**Status:** draft, 18 Aug 2026. How we decide where an AI agent belongs, where a deterministic
flow belongs, and where neither belongs.

Written after an analysis session that reached the wrong answer twice by measuring the wrong
thing. The framework is mostly a set of guards against the ways we have actually gone wrong,
not a general theory of AI.

---

## Step 0 — Measure the work before you design for it

Non-negotiable, because we have got this wrong at full confidence.

In Aug 2026 we sized the lead-intake problem from the `messages` and `conversations` tables and
concluded there was "no labour to save": Ben appeared to send 1–2 messages a day. Both facts
were true and both were useless. Every outbound row in that table has `sender_name = 'Agent'` —
it is an automation log. 81% of `conversations` rows were empty shells created by the quote-send
flow. Ben's real traffic was on his personal WhatsApp and never touched the database.

The real number, from a WhatsApp export: **~9.5 hrs/week on customer threads, ~6.3 hrs/week on
contractor threads, against 45 min/week on the phone.** We had been about to optimise the phone.

**Rules:**

1. Name the pipe the data came from and ask who writes to it. If the answer is "our own
   automation", you are measuring yourself, not the work.
2. Check for empty shells and system rows before computing any rate.
3. If a number contradicts what the operator says from experience, the operator is usually
   right and the query is usually wrong. Go and find the pipe you are missing.
4. State the assumption that carries the estimate. Our time model rests entirely on
   "30/45/60 seconds per message" — that is an assumption, everything scales linearly off it,
   and it takes Ben two minutes to sanity check.

---

## Step 1 — The elimination ladder

Work down. Stop at the first rung that solves it. **Only the bottom two rungs are agents.**

### 1. Remove the need for the work

The strongest fix is deleting the task, not automating it.

Contractor threads carried 3,845 messages in ten weeks, dominated by address, access, scope and
scheduling. Those messages existed because the contractor had no shared view of the job. The fix
was the contractor app, not a messaging agent. Every message it removes is one nothing has to
generate, review, send, or get wrong.

> **Ask:** is this message/decision only necessary because two parties can't see the same record?

### 2. Arithmetic or lookup

If the answer is computable, compute it. Never put a language model in front of a calculation.

Nearest Screwfix branch to the first job of the day is a distance sort over a branch table. Day-fit
is addition. A model doing either is slower, costlier, and — critically — capable of being
confidently wrong in a way arithmetic isn't.

> **Ask:** could a competent junior write this as a SQL query or a sort?

### 3. Rules and templates

Known job type → known intake checklist. Known lane → known template. Deterministic, inspectable,
diffable, and it fails loudly.

This is also where **most of our "AI" work actually belongs**: the per-SKU intake spec (what
photos, what measurements, what access questions) is a rules table. ~50 SKUs cover 87% of our
line items. Write the table once and the model's job shrinks to phrasing.

> **Ask:** is the variation in the *wording* or in the *decision*? Wording → template.

### 4. Deterministic flow with a model inside one step

The default shape for almost everything we build. The flow is code — ordering, retries, guards,
persistence. The model does one bounded thing inside it: extract, classify, summarise, draft.

`quote-prep.ts` is the reference implementation. The flow is fixed; the model extracts job lines
and emits a readiness verdict against a schema; the schema is validated in code and *rejects
incoherent output* (`quote_ready` carrying customer-audience gaps throws).

> **Ask:** can I write down the steps? Then write them down, and let the model fill one slot.

### 5. Agent loop (model chooses the next action)

Rare, and only where the branching genuinely can't be enumerated. Requires everything in Step 3.

---

## Step 2 — Risk tier by what it touches

Tier determines the guards, not how clever the agent is.

| Tier | Does | Failure looks like | Build posture |
|---|---|---|---|
| **READ / FILE** | Classifies inbound. Photos → job evidence, receipts → expense lines, voice note → "running late" | Mis-filed record, fixable | **Build freely.** Highest value/risk ratio we have |
| **PROPOSE** | Materials list, quote lines, triage lane, intake gaps | Human rejects it. Costs a moment | **Build freely, human approves** |
| **DRAFT** | Writes message text a human sends | Human edits or bins it | **Build, never auto-send** |
| **SEND** | Autonomous outbound to a customer | Wrong thing said in our name, permanently | **Only if content-free by construction** |
| **COMMIT** | Price, date, availability, promise, money | Alicia. Unbookable jobs. Undercharged invoices | **Never** |

Most of our best remaining opportunities are READ/FILE, and we keep reaching for SEND because it
feels more impressive. Inbound contractor media alone was 652 photos and 158 voice notes in ten
weeks, all unstructured, none of it visible to any system.

---

## Step 3 — Hard rules

These are the guards we already invented under pressure. Keep them.

**1. Structural incapability beats instruction.**
`first-contact-ack.ts` is safe to auto-send because its messages are content-free *by
construction* — it can only acknowledge, it has no vocabulary for price, date, or scope. It is
not safe because we told it to behave. If safety depends on the prompt, it isn't safe.

**2. Every number cites a source.**
`comms.ts` refuses any draft containing a £ figure unless it carries a `quote_slug` or
`price_source`. Generalise it: dates and availability need the same treatment. An invented date
is as damaging as an invented price and we have shipped both.

**3. Output lanes, not scores.**
A confidence score invites the human to ignore it. A lane forces a decision. Triage emits
*price it now / chase for photos / needs a visit / decline*. The fourth lane is the one that
saves the money and the one everyone forgets to build.

**4. Every agent needs an "I can't" exit.**
`quote-prep` has `visit_first`. `comms` has `ask_ben`. An agent with no way to escalate will
fabricate rather than stop. The escalation path is a feature, not an admission.

**5. Ship disabled, verify in production, then enable.**
Config-gated, off by default, with the first real runs inspected by a human. This is how
first-contact-ack shipped and it is the correct default.

---

## Step 4 — Do not build if

Any one of these is a stop. They are cheap to check and expensive to discover late.

**No capture.** The agent cannot see the data. Every WhatsApp agent we have designed is blocked
on Ben's personal number not being in the platform. An agent that can't see the thread can't
triage it. *Fix capture first — it is a prerequisite, not a phase.*

**The pipe is already built and empty.** `materials_catalog` has 4 rows. `materials_pickups` has
0. The picker, the run-list, the reconciliation and the pickup model all work — nothing upstream
feeds them, because Ben types a materials *cost* and not a *list*. Adding another consumer of an
empty table produces nothing. *Find the starving input and feed it.*

**Confident-wrong is worse than silent.** Screwfix stock: a wrong "in stock at Long Eaton" sends
a contractor on a wasted trip. No answer leaves his existing judgement intact. *If you can't be
reliably right, don't answer.*

**Not enough examples to learn from.** Six months of call data contains **4 jobs above £1k**.
Nothing can be trained or tuned on that. Below ~30 examples of an outcome, the answer is rules
written by someone who knows the trade. *Don't dress a guess as a model.*

**It's papering over a missing source of truth.** If the agent's job is to relay facts that
should live in a shared record, build the record. See rung 1.

---

## Step 5 — Make it grade itself

Prefer builds where the world tells you if the agent was right, without anyone scoring it.

The materials proposer is the model case: the quoted list is reconciled against actual
expense-card spend, and materials carry a 30% markup, so accuracy shows up directly in margin
within a month. No eval harness required.

Where no natural signal exists, define the check before you build, not after. If you can't name
what "wrong" looks like in data, you can't run it unattended and shouldn't plan to.

---

## Applied — where our current candidates land

| Candidate | Rung | Tier | Verdict |
|---|---|---|---|
| Contractor job record | 1 (remove work) | — | Done: contractor app |
| Nearest branch for materials run | 2 (lookup) | — | Deterministic. Columns already exist in `materials_pickups` |
| Pickup leg in day-fit | 2 (arithmetic) | — | Deterministic. Mind the 18 Aug day-fit bug — size the day *including* the leg |
| Per-SKU intake checklist | 3 (rules) | — | Rules table. Prerequisite for intake triage |
| Materials proposer | 4 | PROPOSE | **Build.** Self-grading, feeds four starved systems |
| Contractor inbound filing | 4 | READ/FILE | **Build,** after capture |
| Customer thread triage | 4 | PROPOSE | **Build,** after capture. ~9.5 hrs/wk at stake |
| Conversational intake (agent talks to lead) | 5 | SEND | **Not yet.** Needs capture, intake spec, and a fifth WhatsApp template |
| Quote pricing | — | COMMIT | **Never** |
| Stock checking | — | — | **Don't build** |

---

## One-page checklist

Before building any agent:

- [ ] I measured the work in the pipe humans actually use, and named that pipe
- [ ] I stated the assumption carrying the estimate
- [ ] I went down the ladder and this is genuinely not removable / arithmetic / rules
- [ ] I know its tier, and it isn't COMMIT
- [ ] If it sends, it is content-free by construction
- [ ] Every number it emits cites a source
- [ ] It outputs a lane, not a score
- [ ] It has an "I can't" exit
- [ ] The data it needs is actually captured today
- [ ] The systems downstream of it aren't already empty
- [ ] I know what "wrong" looks like in data, and where I'll see it
- [ ] It ships disabled
