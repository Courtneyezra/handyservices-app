# PRD — Comms

**v3, 6 Sep 2026.** v1 was reviewed *flawed* for specifying features that already exist. v2 was
reviewed *flawed, narrowly* — "the shape survives", but three of its mechanisms rested on wrong
claims. v3 fixes those. Review history: `PRD-COMMS-REVIEW.md`, `PRD-COMMS-V2-REVIEW.md`.

> **How to read this.** Each section says what **exists**, why it **fails**, and what **changes**.
> Owner-decided rules are marked **[OWNER]** and are not up for debate. Everything else is.

Sources: owner decisions 5–6 Sep; live ledger queried 6 Sep; code at `main` `17cf5d86`.

> ⚠️ **Reading the ledger.** `messages`, `message_drafts`, `comms_events` and `agent_questions`
> store naive UTC (`timestamp without time zone`). Query them with an explicit `at time zone 'UTC'`.
> A non-UTC client silently shifted three afternoon sends into "overnight" and produced a false
> defect (BACKLOG D8, withdrawn).

---

## 1. Goal, measure, failure

**Goal.** Nobody we deal with is ever left in silence, and nothing we say is something we cannot
stand behind — without Ben having to hold any of it in his head. **[OWNER]**

**Measure.** Time from first contact to quote sent. **[OWNER]** Nothing measures it today; it is
computable from `conversations.created_at` to the quote's sent time. It carries no term for the
second half of the goal — pair it with the count of `unsafe` verdicts, which should stay at zero.

**The failure it is designed against.** A customer rang in at 09:59 on 4 Sep to chase a price nobody
had prepared. **[OWNER]**

**The preparation half is already fixed.** P19 (`c599df99`, committed 4 Sep 11:03 UTC) makes the
clerk keep working while a thread sits with Ben. Evidence: **62 runs carrying `benLaneClerk` since
it deployed at 14:54 that day, 55 of which prepared something.** (v2 cited that thread's 11:01 run
as proof; that run predates the commit by two minutes and happened because the exceptions cleared,
not because of P19. Corrected.)

**What is still broken is the other half.** She wrote *"a call would be great!"* at 08:59 and nobody
rang. **The live gap is the call that does not happen, not the quote that is not prepared.**

**Principle:** prepare work before a human asks for it, and never let a lead wait on a human who has
not moved.

## 2. Scope

Comms is every conversation the business has: new leads · customer service · post-quote questions ·
contractor communication · system notifications. **[OWNER]**

Emitters that send *through* comms **[OWNER]**: invoicing and payment · scheduling and job reminders ·
contractor dispatch · reviews and re-engagement.

**They do not all obey the same rules.** An invoice does not answer a customer turn; a reply does.
Any rule written "for every sender" must name the purposes it applies to (§5.5).

## 3. Ben's role **[OWNER]**

Four things: **first contact where a call is wanted** (he rings) · **the quote moment** (approve ·
call the lead · message the lead · edit the quote) · **flagged conversations** (§6) · **manual input
at any time**, his own messages and calls.

**Not Ben's:** dates · approving each scoping message · prices the customer already holds.

**Hours: Mon–Fri 08–18** (owner-agreed 3 Sep). Every clock below sits inside them.

## 4. First contact

### 4.1 Calls are a first-contact channel, already handled

**Exists.** 102 inbound calls in 30 days; `quote-clerk.ts:9` records **261 of 301 threads start with
a call**. `post-call-ladder.ts` owns them: missed → one text-back; answered → no ack, transcript to
the spine as `call_ended`; abandoned mid-ring → ack only while fresh; outbound → recorded, no ack.

**Ben's own call feeds the scoping.** `call-thread.ts:606-623` requests a `call_ended` run, so the
Scoper resumes from what the call established and Ben files nothing. *(v2 dropped this line; it is
the mechanism behind "the loop closes by observation" and it exists.)* 51 outbound calls in 60 days,
38 transcribed — the loop closes for about three quarters of them.

**Change: none to the ladder.** A call-first thread never receives "is it OK if we give you a call".

**One decision open.** A missed call is the *strongest* call-wanted signal, already has a
`callback_due` debt, a clock and a text fallback (`post-call-outreach.ts:263-280`). v2 exempted it
from the §4.3 Scoper takeover, which leaves the most call-hungry lead with the weakest promise.
**Recommendation: the takeover applies to missed calls too.** Owner decision.

### 4.2 The written first contact already asks for the call

**Exists.** `first-contact-ack.ts:415-432`. The ack asks *"is it OK if we give you a quick call?"* and
offers the written route in the same breath — an owner decision of 19 Aug, because "we'll come back
to you shortly" is a promise the customer waits on, and waiting is where a lead cools. A yes is
detected (`STRONG_CALL_PATTERNS:956`), opens a `callback_due` debt and fires a Pushover with the
number (`:1094-1113`).

**Two owner exceptions stand** (v1 and v2 both wrongly overrode them):
- `ack_missed_call` does not ask. They already rang us; asking reads as hesitancy.
- A `prefers_text` customer is never asked again. Re-asking is "the single fastest way to make an
  automated system feel like one."

Out of hours the ask survives, the timing moves ("first thing").

**Why it fails.** **15 of 51** new WhatsApp threads got a sent ack in 14 days. Ten were rejected
`system:stale_by_inbound`; **4 phones were held stale and never acked at all.** `staleAgainst`
(`draft-freshness.ts:44-52`) judges a draft by the inbound it answered, so a customer who sends a
message and then photos retires the ack before it sends. On 3 Sep one lead generated three ack
drafts in five minutes and received none.

**Change — re-compose at release, NOT an exemption.**

v2 said "exempt content-free rules-layer sends from the freshness test (or stop stamping them with
`basedOnInboundId`)". Both halves were wrong:

- **The ack is not content-free.** The `web_enquiry_ack_context` template quotes the customer's
  enquiry back (`:838-846`), and on the freeform and SMS paths the media ask is appended to the same
  body (`:880-892`). Exempting it sends the version composed from the *least* information — before
  the photos, before "text only please", before "wrong number".
- **The alternative is a no-op.** Without `basedOnInboundId`, `staleAgainst` falls back to a time
  test and returns stale for the same draft.
- **An exemption keyed on the hold marker over-reaches**, also exempting the post-call video and
  webform lanes that share it (`comms-sweep.ts:311-313`) and are not content-free.
- The source is `first_contact_ack`, not `rules_layer`; the guard that bites is `approveAndSendDraft`
  for every approver (`message-drafts.ts:449-470`).

**So: when a first-contact ack is held stale, re-compose it against the thread as it now stands and
send once.** Media already received → no media ask. No-call words present → the written route, no
call ask. Quote the latest message, not the first. This keeps P7's meaning — never answer a
superseded turn — while fixing the 0-of-4. A manual reply during the hold already rejects the ack
(`comms-sweep.ts:330-340`), so the human path is safe as it stands.

**Not established:** why that lead produced three ack drafts when a stale-held ack should block the
source dedupe (`message-drafts.ts:150-165`). Trace before building.

### 4.3 The 30-minute clock **[OWNER: 30 minutes]**

Lead says yes; Ben is pinged; he has 30 minutes. Past that the Scoper begins scoping by message. The
call offer stands. A lead is never left waiting on a human.

**Two holes v2 missed:**

1. **An open flag blocks the takeover.** `decide.ts:120-122`: any open flag on the thread makes every
   proposal `pending`, so a Scoper takeover under an open callback flag cannot send — contradicting
   §5.1. The takeover must **answer and close** the flag, or the ping must not be a flag at all.
2. **Nothing opens the debt from a first message.** `callback_due` is opened only by ack-reply triage
   (`first-contact-ack.ts:1094-1113`), which runs on replies *to the ack*. A first message saying
   "please ring me on 07…" opens nothing. **Spine triage must open the debt too.**

`callback_requested` stops being a Ben-lane exception and becomes a debt with a clock. After 30
working minutes a delayed run (`requestRun({ delayMs })`, the P7 mechanism) puts the Scoper on the
thread.

**Out of hours the clock does not start; the Scoper scopes by message immediately** and the call
offer stands for the next working morning, which is what the ack already says. (v2 was ambiguous
between pausing the clock and taking over at once; "never overnight" requires taking over.)

**Size: medium**, not small — triage, decide, the ping, and the flag close.

### 4.4 A bound on first-contact automation

Absent from v2, and it matters now that several things can speak. In the first hour a new lead may
receive, at most: **the ack · one gap ask (photo or postcode, one per 24h) · the Scoper's first
message at 30 minutes**, plus the silence-breaker's holding line if any gap reaches 10 minutes.
Anything beyond that is a defect. This is the concrete bound §5.5 does not yet provide in general.

## 5. Scoping — autonomy by construction

**Why a second mechanism.** The built ladder needs 30 verdicts per pack at ≥90% unedited
(`autonomy.ts:7-8`). **21 verdicts exist in total** (11 approve, 2 edit, 1 reject-fine, 7
reject-`wrong_move`, 0 `tone`, 0 `unsafe`). Scoping autonomy is unreachable that way.

So: **a message may send because of what it is, not what it has earned.**

### 5.1 May send with no approval **[OWNER]**
Ask for a photo, video or postcode · ask a scoping question about the job · acknowledge what
arrived · point at the quote page for prices and dates · a looked-up price range (§8).

### 5.2 May never send, at any level
Any figure not returned by a lookup · any date or time · any duration · any commitment or promise ·
any admission of fault · any claim we cannot evidence.

### 5.3 The honest limit, and the choice it forces

The **move** is a closed set and a day-one tier is a config act (`POST /tiers`, `routes.ts:16`;
`applyTierOverlay` honours the row). The **words** are not: `ask_gap` and `clarify_scope` name a gap
the model chooses, and P17 measured the reply-text guard alone catching **45.5%** of unsafe eval
cases (BACKLOG D2, open).

**"Safe by construction" is true of the move and not yet of the words.** One of these must land
before any day-one send:

- **(a) Template the day-one intents** — *and this requires a closed gap vocabulary* (room, count,
  material, access, postcode, photo). A slot filled by generated text is still generated text, so
  without the closed list (a) collapses into (b). **Recommended.**
- **(b) Close D2 first**, so the text rail stands on our words alone.

The **bot disclosure decision** (BACKLOG Lane 5) sits in front of either: it gates anything reaching
SEND, and these do.

### 5.4 Demotion — the real gap

v2 claimed by-construction tiers must live in the overlay so demotion reaches them. **Wrong premise:**
`applyTierOverlay` (`packs.ts:90-99`) merges overlay rows over static ones and `decideTier` reads the
resolved tier, so an overlay DRAFT already demotes a static SEND. Where the tier lives is irrelevant.

**The real gap is worse.** The only automatic demoter is the autonomy job, which runs *only when*
`spine.autonomy.enabled` (`cron.ts:131-136`) — off, and eligible no earlier than 17 Sep at a verdict
rate we do not have. **So a day-one send would have no automatic demotion at all.**

Required before any day-one send, pick one:
- the autonomy job runs in **demote-only mode** for by-construction tiers regardless of the flag, or
- an `unsafe` verdict **demotes synchronously** at the point it is recorded.

A person can always demote by hand (`POST /tiers`), but that is not a safety mechanism.

### 5.5 Loop safety — corrected

v2 asserted a one-message-per-turn rule at the door on two false justifications:

- **The runaway loop sent nothing.** 598 cadence Scoper runs in 7 days, 561 on one thread, **591
  refused at the draft queue**. A compute, ledger-noise and invisible-spend defect, not a
  customer-facing one. Fix it where it runs: `comms-sweep.ts:154`. **BACKLOG D7 + D6.**
- **The three holding lines each followed a fresh customer message**, so they were *compliant* with
  the proposed rule. Whether three "we've got it" lines in a working day is a defect at all is a
  judgement nobody has made. §13.

A door rule may still earn its place, but needs a **unit** (a Scoper reply is 1–3 bubbles and counts
as one — `message-drafts.ts:602-612` sends each separately), a **purpose scope** (`service_reply`
only, never invoices, reminders or job packs — `sendCustomerMessage` has 20 callers), and **evidence
of a failure it prevents**, which does not currently exist. **Until then it is a proposal, not a
requirement.** §4.4 is the concrete bound we do have.

**Scoper rows record `cost_pence` 0.** Until they record real cost, no loop is visible in spend. It
is the instrument for all of the above.

## 6. Handover to Ben

### 6.1 The four reasons **[OWNER]**
Unhappiness, complaint or doubt about us · regulated or high-risk work surfacing mid-conversation ·
**the customer asks something we have no source for** · the scoping is not converging.

The third needs a *capability*, not a rule: the Scoper must be able to tell when it does not know.
Unenforceable until built — the hardest item in this document.

### 6.2 Every live exception, and where it goes

`customer-default.ts:19` sends eight exceptions to Ben. Live 7-day hits: **out_of_scope 253**,
date_question 163, regulated_trade 56, callback_requested 39, money_question 9, trust_concern 4,
complaint 1.

| Exception | Disposition |
|---|---|
| `complaint`, `trust_concern`, `regulated_trade` | **Stay Ben's** (§6.1 reasons 1–2) |
| `refund` | **Stays Ben's.** Not covered by §6.1; recorded explicitly |
| `date_question` | **Retired** as a Ben trigger (§7) |
| `callback_requested` | **Becomes a debt with a clock** (§4.3) |
| `money_question` | **Narrowed**, not retired (§8) |
| `out_of_scope` | **Build item — not settled.** See below |

**`out_of_scope` is not automatic today** and v2 wrongly said it was. It is a Ben flag, raised only
by the model (`triage.ts:202`, no lexicon), and the clerk's decline is a **DRAFT** at `closing` —
"Ben confirms the polite no" (`quote-clerk.ts:57-60`). Worse, `DeclineReason`
(`quote-prep.ts:68-84`) covers only gas_work, roofing_height, structural and major_electrical —
**nothing for "outside our service area" or "a trade we do not cover"**, which is most of what the
triage prompt means by out-of-scope.

Either it stays Ben's, or it needs new decline reasons, a lexicon, and a tier decision. **It is the
most frequent exception by a factor of five and therefore the largest single claim on Ben's queue.**
Build row 12.

## 7. Dates **[OWNER]**

| Situation | Behaviour |
|---|---|
| Before a quote exists | *"Dates come with your quote"*, carry on scoping. No lead-time guess, no hold, no flag |
| A live quote exists | Point at the picker (`dateQuestionNeedsBen`, `scoper.ts:269`, already exempts this) |
| After booking, wanting to change | **OPEN** (§13) |

`date_question` retires from `exceptionsToBen` and from the triage lexicon as a Ben trigger. "Dates
come with your quote" carries no date, so `date_promise` passes it. Removes Ben's second-largest
trigger — 163 hits in 7 days.

## 8. Price **[OWNER: allowed]**

The Scoper may soften sticker shock before the quote lands. **The invariant is unchanged: facts are
looked up, never generated.** A range from our own quote history is a fact; a figure the model
reasons to is an invention.

**v2 called this four changes. It is at least seven**, and a customer asking *"how much roughly?"*
never reaches the Scoper today:

1. **Narrow `RE_MONEY`** (`triage.ts:34`). It raises `money_question` on "how much / price / cost /
   £" before any agent runs, and the Ben lane runs none. A pre-quote roughly-how-much must reach the
   Scoper; a discount demand, a price objection and a payment dispute must not.
2. **The money guard gains a cited-range path.** `moneyAllowedBySettings` (`guards.ts:57-63`) passes
   a figure only for `intent === 'offer_survey'` with `price_source=settings`. Extend the shape:
   `price_source=history`, every figure in the body matching the lookup, or refuse.
3. **The promotion rule.** `FORBIDDEN_INTENT_SMELL` (`packs.ts:31`) refuses any intent whose *name*
   smells of money, and `validatePack` (`:33-37`) enforces it **at load time**, where no citation
   exists — so "make the rule citation-based" as v2 wrote it is incoherent. Either the intent takes a
   non-smelling name (a loophole, and it should be called one) or the *runtime* check moves to the
   citation while the load-time name check stays.
4. **The lookup** — a price range over quote history, keyed by job type.
5. **The Scoper's own belt.** `checkProposedBody` (`scoper.ts:237-257`) runs `checkDraft` on every
   `propose_reply` and refuses a figure **at the tool, before any guard sees it**. This is a hard
   stop v2 missed entirely.
6. **The prompt.** The tool description and `CORE_FALLBACK` (`scoper.ts:80, 284`) both say "Never a
   money figure… the tool refuses them". Left unchanged, the model will not attempt what it is told
   is forbidden.
7. **The verifier rubric.** `verifier.ts:64` marks a message unsafe if it "states a money figure",
   and an `unsafe_sample` demotes (`autonomy.ts:115-116`). **The first sampled cited range would
   demote the very intent we had just enabled.**

Also widens the eval families' assertions. **Size: large.** Not a first task.

**Post-quote** the agent may read back prices already on the quote (§9) — a lookup of a figure the
customer holds. `answer_from_quote` exists (`vocab.ts:25`) but any figure in its body is refused
until change 2 and 5 land.

## 9. Post-quote **[OWNER]**

May be answered from the quote with no approval: what is included or excluded on a line · the prices
already on the quote · what happens on the day · available dates (point at the picker).

**Stalled quote.** Four unsent Route A drafts exist, the oldest four days old. Route A fires one
Pushover at creation (`route-a.ts:9`) and the janitor closes only dead runs — **there is no chase**.
Owner decision: **tell the customer it is coming**; this PRD adds the internal chase, because a
customer-facing promise with nothing behind it is the 13 Aug dunning incident. The customer line
carries a due time; the chase escalates to the owner. Both, or neither.

## 10. Contractors **[OWNER]**

May reach a contractor with no approval: job pack ready · a change to an accepted pack · a chase for
completion photos or paperwork · answering a contractor's question from the job pack.

**State:** the first two exist (`job-pack-notify.ts:22,146`, approver `rules.job_pack`) but **queue
for Ben out of window until Meta approves `job_pack_ready_v1` and `job_pack_changed_v1` — not yet
submitted** (owner action). The completion chase and answering-from-the-pack are **new builds**;
`contractor-liaison.ts:175` is DRAFT tier.

## 11. Invariants — with the truth about each

1. **One door.** *Two doors, and they must not be confused.* Every send reaches the wire through
   `sendCustomerMessage` (`outbound.ts:174`, 20 callers, only Twilio site `sms.ts:121`). The spine's
   `exit.ts` is a **second, narrower** door the rules layer bypasses (`rules-layer.ts:304`). Name the
   door, every time a rule is written.
2. **One version of the truth; parts receive context, none fetches its own.** **Currently false.**
   `quote-clerk.ts:50` re-reads the conversation; `estimator.ts:314-321` loads its own intake card. A
   target, not a description — and now build row 13 rather than a third acknowledgement.
3. **Silence is a failure state** the system owns.
4. **No dead ends** — every handover is a pause with a resume condition and a stated gap.
5. **Facts are looked up, never invented.** §8 preserves it.
6. **Everything traceable** — except Scoper cost, recorded as 0 (build row 4).
7. **Quote acceptance and editing stay human. Permanently.** **[OWNER]**

## 12. Build list

Sizes corrected per review. ✅ = verified crew-ready, no open design question.

| # | Work | Where | Size |
|---|---|---|---|
| 1 | **✅ Fix the cadence loop where it runs**; add "anything to say?" | BACKLOG **D7**, **D6** | D7 small · D6 a design step |
| 2 | **✅ Record real `cost_pence`** on Scoper runs | run recording | small |
| 3 | **✅ Retire `date_question`** as a Ben trigger | `triage.ts`, `customer-default.ts` | small |
| 4 | Trace the triple-ack-draft path, then **re-compose the held ack at release** | `comms-sweep.ts`, `first-contact-ack.ts` | small · **highest value** |
| 5 | `callback_requested` → debt with a 30-min run; **open the debt from spine triage**; **close the flag on takeover** | `triage.ts`, `index.ts`, `decide.ts` | medium |
| 6 | Automatic demotion while autonomy is off (§5.4) | `autonomy.ts`, `cron.ts` | small · **blocks any day-one send** |
| 7 | Closed gap vocabulary + template the day-one intents | packs, prompts | medium |
| 8 | The §4.4 first-hour bound | rules layer | small |
| 9 | Stalled-quote chase + customer line with a due time | `route-a.ts`, janitor | small |
| 10 | Contractor completion chase; answering from the pack | new | medium |
| 11 | Instrument the measure (first contact → quote sent) | new | small |
| 12 | `out_of_scope`: decline reasons, lexicon, tier decision | `quote-prep.ts`, triage | medium |
| 13 | Invariant 2: stop the clerk and estimator fetching their own context | `quote-clerk.ts`, `estimator.ts` | medium |
| 14 | Price, all seven changes (§8) | seven files | **large** |

**Sequencing, still unresolved.** Lane 2 (P14) and Lane 4 (Phase 5) touch overlapping files, and
**Phase 5 deletes `server/agents/comms.ts`, which `quote-clerk.ts:17` imports while
`PHASE5-DELETE.md` does not list it.** That import must be added to the delete list before F3 runs.

## 13. Still open

Changing a **booked** date · **suppliers** in scope? · does Ben's **edit** teach the estimator? ·
**repeat customers** treated differently? · how the Scoper knows **it does not know** (§6.1) ·
whether repeated same-day holding lines are a defect at all · whether the §4.3 takeover applies to
**missed calls** (§4.1, recommendation: yes) · the **bot disclosure decision** · sequencing against
BACKLOG Lanes 1–4.

## 14. Out of scope

Replacing Ben · autonomy as an objective · answering everything · anything moving quote acceptance
away from a human.
