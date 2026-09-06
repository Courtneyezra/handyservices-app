# PRD — Comms

**v2, 6 Sep 2026.** v1 was reviewed **flawed** (`PRD-COMMS-REVIEW.md`) for specifying as new several
things that already exist and are misbehaving. This version is written the other way round.

> **How to read this.** Every section says what **exists**, why it **fails** today, and what
> **changes**. A PRD that describes absent features will get them re-specified instead of repaired.
> Where a rule is owner-decided it is marked **[OWNER]** and is not up for debate; everything else is.

Sources: owner decisions 5–6 Sep; live ledger queried 6 Sep; code at `main` `17cf5d86`.

> ⚠️ **Reading the ledger.** `messages`, `message_drafts`, `comms_events` and `agent_questions` store
> naive UTC (`timestamp without time zone`). Query them with an explicit `at time zone 'UTC'`. A
> non-UTC client silently shifted three afternoon sends into "overnight" and produced a false defect
> (withdrawn BACKLOG D8).

---

## 1. Goal, measure, failure

**Goal.** Nobody we deal with is ever left in silence, and nothing we say is something we cannot
stand behind — without Ben having to hold any of it in his head. **[OWNER]**

**Measure.** Time from first contact to quote sent. **[OWNER]** Nothing measures it today; it is
computable from `conversations.created_at` to the quote's sent time. It carries no term for the
second half of the goal — pair it with the count of `unsafe` verdicts, which should stay at zero.

**The failure it is designed against.** A customer rang in at 09:59 on 4 Sep to chase a price nobody
had prepared. **[OWNER]** — with a correction: **P19 already fixed the preparation half** (`c599df99`).
The clerk now keeps working while a thread sits with Ben, and on that same thread the clerk and
estimator ran at 11:01 the next day. What is *not* fixed is the other half: she said *"a call would
be great"* at 08:59 and nobody rang. **The live gap is the call that does not happen, not the quote
that is not prepared.** This PRD argues from that.

**The principle that follows:** prepare work before a human asks for it, and never let a lead wait on
a human who has not moved.

## 2. Scope

Comms is every conversation the business has: **new leads · customer service · post-quote questions ·
contractor communication · system notifications.** **[OWNER]**

Confirmed emitters that send *through* comms **[OWNER]**: invoicing and payment · scheduling and job
reminders · contractor dispatch · reviews and re-engagement.

**They do not all obey the same rules.** An invoice does not answer a customer turn; a reply does.
Any rule written "for every sender" must name the purposes it applies to (§7.3).

## 3. Ben's role **[OWNER]**

Four things, nothing else:

1. **First contact where a call is wanted** — he rings.
2. **The quote moment** — approve · call the lead · message the lead · edit the quote.
3. **Flagged conversations** (§6).
4. **Manual input at any time** — his own WhatsApp messages and his own calls.

**Not Ben's:** dates · approving each scoping message · prices the customer already holds.

**Ben's hours are Mon–Fri 08–18** (HANDOVER, owner-agreed 3 Sep). Every clock below sits inside them.

## 4. First contact

### 4.1 Calls are a first-contact channel and are already handled

**Exists.** 102 inbound calls in 30 days; `quote-clerk.ts:9` records that **261 of 301 threads start
with a call**. `post-call-ladder.ts` owns them: missed → one text-back; answered → no ack, transcript
to the spine as `call_ended`; abandoned mid-ring → ack only while fresh; outbound → recorded, never
an ack.

**Change: none.** v1 omitted the largest channel and would have bolted a second first-contact flow
beside a working one. A call-first thread **never** receives "is it OK if we give you a call" — they
rang us — and does not start the §4.3 clock.

### 4.2 The written first contact already asks for the call

**Exists.** `first-contact-ack.ts:415-432`. The ack asks *"is it OK if we give you a quick call?"* and
offers the written route in the same breath — an owner decision of 19 Aug, taken because "we'll come
back to you shortly" is a promise the customer waits on and waiting is where a lead cools. A yes is
detected (`STRONG_CALL_PATTERNS`), opens a `callback_due` debt and fires a Pushover with the number.

**Two exceptions are owner decisions and v1 wrongly overrode them. They stand:**
- `ack_missed_call` **does not ask.** They already rang us; asking permission reads as hesitancy.
- A **`prefers_text`** customer is never asked again. They said no once. Re-asking is, in the code's
  own words, "the single fastest way to make an automated system feel like one."

Out of hours the ask survives and the timing moves ("first thing"), never implying someone is at a
desk at 11pm.

**Why it fails.** In 14 days, **15 of 51** new WhatsApp threads got a sent ack — about 30%. Ten were
rejected `system:stale_by_inbound`. `staleAgainst` (`draft-freshness.ts:44-52`) judges a draft by the
inbound it answered: a customer who sends a message and then photos retires the ack before it sends.
On 3 Sep one lead generated three ack drafts in five minutes and received none.

**Change — and this is the single highest-value fix in the document.** *Staleness is meaningless for
a content-free acknowledgement.* The ack does not answer a message; it acknowledges that a person has
arrived. Exempt rules-layer content-free sends from the freshness test (or stop stamping them with
`basedOnInboundId`), so a burst produces **one** ack rather than none.

"Every first contact, always" then becomes true because the mechanism works, not because a new one
was built.

### 4.3 The 30-minute clock **[OWNER: 30 minutes]**

The lead says yes; Ben is pinged; **he has 30 minutes**. Past that the Scoper begins scoping by
message. The call offer stands — a later call adds depth rather than replacing the scoping. A lead is
never left waiting on a human, and never overnight.

**Why it cannot work today.** A `callback_requested` thread is on the **Ben lane**, where no agent
runs (`index.ts:59`) and `decide()` flags before reading any proposal (`decide.ts:85`, pinned by
`architecture.test.ts`). The Scoper cannot begin.

**Change.** `callback_requested` stops being a Ben-lane exception and becomes **a debt with a clock**
— which `callback_due` already is. The ping still fires. After 30 working minutes a delayed run
(`requestRun({ delayMs })`, the P7 mechanism) puts the Scoper on the thread. The open flag closes when
Ben rings or when the Scoper takes over, and says which.

Outside Ben's hours the clock does not run: the Scoper scopes by message and the call offer stands for
the next working morning, which is what the ack already says.

## 5. Scoping — autonomy by construction

**Why a second mechanism.** The built ladder is evidence-based: 30 verdicts per pack at ≥90% unedited
(`autonomy.ts:7-8`). **21 verdicts exist in total** (11 approve, 2 edit, 1 reject-fine, 7
reject-`wrong_move`). Scoping autonomy is unreachable that way — not slow, unreachable.

So: **a message may send because of what it is, not what it has earned.**

### 5.1 May send with no approval **[OWNER]**
Ask for a photo, video or postcode · ask a scoping question about the job · acknowledge what arrived ·
point at the quote page for prices and dates · a looked-up price range (§5.2).

### 5.2 May never send, at any level
Any figure not returned by a lookup · any date or time · any duration · any commitment or promise ·
any admission of fault · any claim we cannot evidence.

### 5.3 The honest limit on "by construction"

The **move** is a closed set, so day-one SEND is a config act (`pack_intent_tiers`, settable by a
person). The **words** are not: `ask_gap` / `clarify_scope` / `confirm_received` are Sonnet-generated,
and P17 measured the reply-text guard alone catching **45.5%** of unsafe eval cases (BACKLOG D2, open).

**So "safe by construction" is true of the move and not yet of the words.** Two options, and this PRD
requires one of them before any day-one send:

- **(a) Template the day-one intents** — fixed wording with slots. Genuinely rung-zero. Recommended.
- **(b) Close D2 first**, so the text rail stands on our words alone, then allow generated text.

A day-one SEND of free text before either is an evidence-free promotion past a rail that holds under
half the time.

### 5.4 Demotion

An `unsafe` verdict must demote a by-construction send. A tier set statically in a pack does not move;
`autonomy.ts:115` demotes through the overlay. **By-construction tiers must therefore live in the
overlay**, not the static pack, so the existing demotion path reaches them.

### 5.5 Loop safety — corrected

v1 asserted a one-message-per-turn rule at the door and justified it with two incidents. **Both
justifications were false**, and the rule as written would have blocked invoices and every second
bubble of a normal reply. Restated:

- **The runaway loop is upstream and sent nothing.** 598 cadence Scoper runs in 7 days, 561 on one
  thread, **591 refused at the draft queue**. It is a compute, ledger-noise and (invisible) spend
  defect, not a customer-facing one. Fix it where it runs: `comms-sweep.ts:154`. **BACKLOG D7 + D6.**
- **A door rule still has a place**, but needs three things v1 lacked: a **unit** (a Scoper reply is
  1–3 bubbles and must count as one), a **purpose scope** (`service_reply` only — never invoices,
  reminders or job packs), and **evidence of a failure it prevents**, which we do not currently have.
  Until that evidence exists this is a *proposal*, not a requirement.
- **Scoper rows record `cost_pence` 0.** Until they record real cost, no loop is visible in spend.
  Small, and it is the instrument for everything above.

## 6. Handover to Ben

### 6.1 The four reasons **[OWNER]**
Unhappiness, complaint or doubt about us · regulated or high-risk work surfacing mid-conversation ·
**the customer asks something we have no source for** · the scoping is not converging.

The third needs a capability, not a rule: the Scoper must be able to tell when it does not know. Until
it can, it is unenforceable — flagged as the hardest item here.

### 6.2 The exceptions v1 silently dropped

`customer-default.ts:19` sends eight exceptions to Ben. Live 7-day hits: **out_of_scope 253**,
date_question 163, regulated_trade 56, callback_requested 39, money_question 9, trust_concern 4,
complaint 1. v1 kept two, moved two, and deleted three without saying so. Explicitly:

| Exception | Disposition |
|---|---|
| `complaint`, `trust_concern`, `regulated_trade` | **Stay Ben's.** §6.1 reasons 1 and 2 |
| `date_question` | **Retired** as a Ben trigger (§7) |
| `callback_requested` | **Becomes a debt with a clock** (§4.3) |
| `refund` | **Stays Ben's.** Not covered by §6.1; added here explicitly |
| `out_of_scope` | **Stays automatic.** The most frequent exception by far. The clerk's fixed decline template (intent `closing`) handles it today and continues to. It is not a handover |
| `money_question` | **Narrowed**, not retired — see §8 |

## 7. Dates **[OWNER]**

| Situation | Behaviour |
|---|---|
| Before a quote exists | *"Dates come with your quote"*, carry on scoping. No lead-time guess, no hold, no flag |
| A live quote exists | Point at the picker (`dateQuestionNeedsBen`, `scoper.ts:269`, already exempts this) |
| After booking, wanting to change | **OPEN** (§12) |

`date_question` is retired from `exceptionsToBen` and from the triage lexicon as a Ben trigger. "Dates
come with your quote" carries no date, so `date_promise` passes it. This alone removes Ben's
second-largest trigger — 163 hits in 7 days.

## 8. Price **[OWNER: allowed]**

The Scoper may soften sticker shock before the quote lands. **The invariant is unchanged: facts are
looked up, never generated.** A range from our own quote history is a fact; a figure the model reasons
to is an invention.

**v1 called this "one lookup to build". It is four changes**, and a customer asking *"how much
roughly?"* never reaches the Scoper today:

1. **`RE_MONEY` narrows.** `triage.ts:34` raises `money_question` on "how much / price / cost / £"
   *before any agent runs*, and the Ben lane runs none. A pre-quote roughly-how-much must reach the
   Scoper; a discount demand, a price objection and a payment dispute must not.
2. **The money guard gains a cited-range path.** `moneyAllowedBySettings` (`guards.ts:57-63`) passes a
   figure only for `intent === 'offer_survey'` with `price_source=settings`. Extend the same shape:
   `price_source=history`, every figure in the body matching the lookup, or refuse.
3. **The never-promotable rule.** `FORBIDDEN_INTENT_SMELL` (`packs.ts:31`) refuses promotion of any
   intent whose *name* contains money/price/cost. Either the intent carries a non-smelling name — a
   loophole, and it should be called one — or the rule changes to test the **citation** rather than
   the name. The latter is correct: a cited figure is safe, an uncited one never is, whatever it is
   called.
4. **The lookup itself** — a price range over quote history, keyed by job type.

**Post-quote** the agent may read back prices already on the quote (§9): a lookup of a figure the
customer holds, not an invention.

## 9. Post-quote **[OWNER]**

May be answered from the quote with no approval: what is included or excluded on a line · the prices
already on the quote · what happens on the day · available dates (point at the picker).

`answer_from_quote` exists as an intent (`vocab.ts:25`) but any figure in its body is refused today —
it needs §8.2.

**Stalled quote.** Four unsent Route A drafts exist, the oldest four days old. Route A fires one
Pushover at creation and **there is no chase**. Owner decision: **tell the customer it is coming** —
and this PRD adds the internal chase, because a customer-facing promise with nothing working behind it
is precisely the 13 Aug dunning incident. The customer line carries a due time; the chase escalates to
the owner. Both, or neither.

## 10. Contractors **[OWNER]**

May reach a contractor with no approval: job pack ready · a change to an accepted pack · a chase for
completion photos or paperwork · answering a contractor's question from the job pack.

**State:** the first two exist (`job-pack-notify.ts`, approver `rules.job_pack`) but **queue for Ben
out of window until Meta approves `job_pack_ready_v1` and `job_pack_changed_v1` — not yet submitted**
(BACKLOG Lane 5, an owner action). The completion chase and answering-from-the-pack are **new builds**;
`contractor-liaison.ts:175` is DRAFT tier.

## 11. Invariants — with the truth about each

1. **One door.** *Partly true.* Every send reaches the wire through `sendCustomerMessage`
   (`outbound.ts:174`, 20 callers). But the spine's `exit.ts` is a **second, narrower** door the rules
   layer bypasses (`rules-layer.ts:304`). Say which door a rule attaches to, every time.
2. **One version of the truth; parts receive context, none fetches its own.** **Currently false.**
   `quote-clerk.ts:50` re-reads the conversation; `estimator.ts:314-321` loads its own intake card. A
   target, not a description. Raised twice in review; recorded as such rather than reworded again.
3. **Silence is a failure state** the system owns. True.
4. **No dead ends** — every handover is a pause with a resume condition and a stated gap.
5. **Facts are looked up, never invented.** True, and §8 preserves it.
6. **Everything traceable.** True — except Scoper cost, recorded as 0.
7. **Quote acceptance and editing stay human. Permanently.** **[OWNER]** A policy decision, not a
   capability gap.

## 12. Build list, mapped to the queue

| # | Work | Where | Size |
|---|---|---|---|
| 1 | Exempt content-free rules-layer sends from `staleAgainst` | `draft-freshness.ts`, `first-contact-ack.ts` | small · **highest value** |
| 2 | `callback_requested` → debt with a 30-minute delayed run | `triage.ts`, `index.ts` | small |
| 3 | Fix the cadence loop where it runs; add "anything to say?" | BACKLOG **D7**, **D6** | small |
| 4 | Record real `cost_pence` on Scoper runs | run recording | small |
| 5 | Retire `date_question` as a Ben trigger | `triage.ts`, `customer-default.ts` | small |
| 6 | Template the day-one intents **or** close D2 | BACKLOG **D2** | medium |
| 7 | By-construction tiers into the overlay, so demotion reaches them | `packs.ts`, `autonomy.ts` | small |
| 8 | Price: narrow `RE_MONEY`, cited-range guard path, citation-based promotion rule, history lookup | four changes, §8 | **medium–large** |
| 9 | Stalled-quote chase + customer line with a due time | `route-a.ts`, janitor | small |
| 10 | Contractor completion chase; answering from the pack | new | medium |
| 11 | Instrument the measure (first contact → quote sent) | new | small |

Nothing here is scheduled against Lanes 1–4 of BACKLOG yet, and Lane 2 (P14) and Lane 4 (Phase 5)
touch overlapping files — **Phase 5 deletes `server/agents/comms.ts`, which `quote-clerk.ts:17`
imports and `PHASE5-DELETE.md` does not list.** Sequencing is an open item, not a solved one.

## 13. Still open

Changing a **booked** date · **suppliers** in scope? · does Ben's **edit** teach the estimator? ·
**repeat customers** treated differently? · how the Scoper knows **it does not know** (§6.1) ·
whether repeated same-day holding lines are a defect at all (withdrawn D8) · the **bot disclosure
decision**, which §5 reaches because day-one sends are SEND · sequencing against Lanes 1–4.

## 14. Out of scope

Replacing Ben · autonomy as an objective · answering everything · anything moving quote acceptance
away from a human.
