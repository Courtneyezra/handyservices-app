# Review of PRD-COMMS.md

Adversarial pass per `REFLECTION-PROMPT.md` (6 Sep revision), 6 Sep 2026, by the reviewing pane.
Every code claim checked against `main` at `17cf5d86`. Live figures are read-only queries on
production (`agent_runs`, `message_drafts`, `draft_verdicts`, `comms_events`, `messages`, `calls`,
`conversations`, `leads`, `personalized_quotes`, `agent_questions`) run today. The owner's business
rules are taken as given; what is judged is consistency, buildability, agreement with the ledger,
and whether anything recreates a failure already on the record.

**A correction to the record first.** `P20-REVIEW.md` finding 15 and BACKLOG D8 say three holding
lines went to one customer "overnight at 04:05, 06:09, 09:14 UTC on 3 Sep". That was a timestamp
artifact: `message_drafts.created_at` is `timestamp without time zone` and my client rendered it
shifted by seven hours. The stored values are 11:05, 13:09 and 16:14 UTC (12:05, 14:09, 17:14 UK),
and each followed a fresh customer turn. The PRD inherits the error in §7.2. Details in finding 1.

## 1. VERDICT

**flawed**

## 2. The single strongest objection

The PRD's one hard mechanism, the loop-safety rule at the door (§7.2), is justified by two incidents
it would not have stopped, and as written it breaks §4. The 561 Scoper runs on one thread sent
nothing: 591 of them were already refused at the draft queue, so a rule at the door changes nothing
about a loop that lives upstream in the legacy sweep. The three holding lines were each the first
outbound after a new customer turn (customer wrote 10:53, 12:52 and 16:03 UTC; holding line at
11:05, 13:09 and 16:14), which is exactly the "one message per customer turn" the rule permits. And
the only door every sender shares is `sendCustomerMessage`, which invoices, booking reminders and
job packs also use; none of those answers a customer turn, so a per-turn rule enforced there refuses
the emitters §4 says must flow through it. Underneath that, the PRD presents as new design three
things that already exist and are misbehaving in the ledger: the first-contact ack already asks
"is it OK if we give you a quick call?" and reached 15 of 51 new WhatsApp threads in 14 days; a
customer's yes already opens a tracked ring-back with a Pushover; and the 4 Sep failure in §3 was
closed by P19 on 4 Sep. A PRD built on the belief that these are absent will re-specify them
instead of fixing why they fail.

## 3. Findings

Ordered by severity. "Checked against" cites what was read or queried.

| # | Claim | Checked against | Verdict | What it changes |
|---|---|---|---|---|
| 1 | §7.2: a one-message-per-turn rule at the exit "would have prevented both live incidents". | Loop: `agent_runs` 7d, 598 cadence Scoper runs, 591 with outcome `queueDraft refused` (dedupe against the pending draft of 3 Sep 10:06); nothing reached the wire. Trigger is `server/agents/comms-sweep.ts:154`. Holding lines: `messages` for `8e0382…`, stored UTC: customer 10:53-10:55 → holding 11:05; customer 12:52-12:58 → holding 13:09; customer SMS 16:03-16:04 → holding 16:14. `rules-layer.ts:148-155` suppresses only when an outbound already answered the triggering inbound or a rules send is under 2h old. | **False on both counts.** | The rule's only stated evidence is gone. The loop needs fixing where it runs (BACKLOG D7, upstream of any door). The holding lines were compliant with the PRD's own rule; whether three "we've got it" lines in a working day to a customer who kept sending is a defect at all is a judgement the PRD has not made. |
| 2 | §7.2 / §12.9: the rule is "at the exit, enforced for every sender including the rules layer". | The rules layer never passes through `server/spine/exit.ts`; it sends via `sendCustomerMessage` (`rules-layer.ts:304`). `sendCustomerMessage` (`outbound.ts:174`) has 20 callers including `invoices.ts`, `invoice-generator.ts`, `customer-notifications.ts`, `cron.ts`, `lead-automations.ts`, `spine/job-pack-notify.ts`. Bubbles: `propose_reply` body is "1 to 3 bubbles, each its own WhatsApp message" (`scoper.ts:283-296`); `message-drafts.ts:602-612` sends each part separately. | **Not buildable as written.** | "Message" and "turn" are undefined. Literal enforcement at the common door blocks an invoice or a job pack; literal counting of messages blocks bubble two of every Scoper reply. The rule needs a purpose scope and a unit before anyone can build it. |
| 3 | §5.1, §6.2-6.4: "Every first contact is asked whether a call is alright… If yes, Ben is alerted to ring." | Exists: `first-contact-ack.ts:415-432` ("the ack now ASKS 'is it OK if we give you a quick call?'"), live body in `comms_events`: "Is it OK if we give you a quick call in the morning… Or just reply here with the details". Yes-detection `STRONG_CALL_PATTERNS` (`:956`), and a yes opens `callback_due` plus `notifyCallbackDue` Pushover (`:1094-1113`). Ledger 14d: 51 new `@c.us` conversations, 15 with an ack `sent`; 8 acks `rejected`, 10 `system:stale_by_inbound` rejections. Jenna, 3 Sep: three ack drafts 10:43-10:48, none sent, each superseded by her next message. | **Already built; live send rate about 30%.** | The PRD specifies the ack as if absent. The defect is that a first-contact burst (message, then photos) retires the ack as stale before it sends. "Every first contact, always" is currently violated by the freshness rule from P7, not by a missing feature. Fix that and §6.2-6.4 are live today. |
| 4 | §6.3: "no conditions on channel, hour or content." | `first-contact-ack.ts:424-431`: `ack_missed_call` deliberately does not ask ("Owner's explicit call"), and `prefers_text` customers are never asked again. The template offers the call "in the morning" out of hours. | Contradicts a recorded owner decision. | Either the earlier decision is reversed (say so) or §6.3 is wrong. As written it also re-asks customers who have already said no, which the code comment calls "the single fastest way to make an automated system feel like one". |
| 5 | §6.1: "Lead arrives — webform, SMS or WhatsApp." | `calls` 30d: 102 inbound calls. `leads` 30d by source: whatsapp 48, contextual_quote 32, voice_monitor 30, personalized_quote 20, voice_call 8, desktop_hero_flow 6. `quote-clerk.ts:9`: "the 261-of-301 threads that start with a call". `post-call-ladder.ts:5-9`: missed → one text-back; answered → transcript to spine `call_ended`. | **Silent scope loss.** | The first-contact flow omits the channel that produces a third or more of leads and has its own ladder. Nothing in §6 says how a call-first thread reaches "ask whether a call is alright" (it should not: they rang us) or the 30-minute clock. |
| 6 | §8: handover has "four reasons, all owner-confirmed" (unhappiness, regulated, no source, not converging). | `customer-default.ts:19` `exceptionsToBen`: complaint, trust_concern, refund, out_of_scope, regulated_trade, money_question, date_question, callback_requested. Live 7d exception hits: out_of_scope 253 (6 threads), date_question 163 (9), regulated_trade 56, callback_requested 39, money_question 9, trust_concern 4, spam 2, complaint 1. | **Three live triggers dropped without a word.** | `date_question` is retired explicitly (§9) and `callback_requested` becomes §6. `out_of_scope` (the most frequent exception), `money_question` and `refund` simply vanish. §14 lists pre-quote price as open while §8 presents itself as complete. What happens to an out-of-scope enquiry (today: the clerk's fixed decline template at intent `closing`) is unspecified. |
| 7 | §7.1: the Scoper may send a looked-up price range pre-quote; §10: it may read back prices on the quote with no approval. | `triage.ts:34` `RE_MONEY` ("how much", "price", "cost", "£", …) raises `money_question` before any agent runs (`:135`), and the Ben lane runs no agent (`index.ts:59`, `decide.ts:85`). `guards.ts:57-63` `moneyAllowedBySettings` passes a figure only when `intent === 'offer_survey'` and the citation is `price_source=settings`. `answer_from_quote` exists as an intent (`vocab.ts:25`) but any figure in its body is refused by the money guard. `packs.ts:31` `FORBIDDEN_INTENT_SMELL` refuses promotion of any intent named with money/price/cost; `customer-default.ts:4-5`: "Money and dates are not intents here and never will be." | **Not buildable without three changes the PRD does not name.** | A customer who asks "how much roughly?" never reaches the Scoper today. §7.1 and §10 need: money_question retired or narrowed as a Ben trigger; a quote-cited figure path in the money guard; and either a non-smelling intent name (a loophole) or a change to the never-promotable rule. "Needs building: a price-range lookup" understates it by two thirds. |
| 8 | §7: "safe because of what it is, not what it has earned"; day-one sends with no approval. | Tiers are per intent via the `pack_intent_tiers` overlay (`packs.ts:64-70`), settable "by autonomy.ts or a person", so day-one SEND is a config act. But the words of `ask_gap` / `clarify_scope` / `confirm_received` are Sonnet-generated (`propose_reply`), and `P17-DONE.md:37,172` measured the reply-text guard alone at **45.5%** of unsafe eval cases (BACKLOG D2, open). §12.6 says the words are "often a template" without saying which day-one intents are templated. | True of the move, not yet of the words. (Judgement, on a measured base.) | "By construction" holds only for rung-zero words. Until D2 lands or the day-one intents are templated, a day-one SEND is an evidence-free promotion of free text past a rail that holds under half the cases. Say which. |
| 9 | §3: the 4 Sep failure is "the failure this is designed against". | `BRIEF-P19-clerk-on-ben-lane.md` names the same thread (`f7ebd4f6…`). P19 merged (`c599df99`, `0d39edde`). Ledger since 4 Sep on that thread: `quote_clerk` run 11:01, `estimator` PROPOSE 11:01. `agent_questions`: 2 flag rows (09:09, 09:35); 20 flag decisions in `agent_runs`, deduped at the exit. | **Already fixed; the count is wrong.** | The design principle "prepare before asked" is live on the Ben lane (`benLaneClerkDecisionFor`, `index.ts:85-91`). What P19 did not fix is Ben not ringing within 30 minutes of "A call would be great!", which is §6.5. The PRD should argue from that gap, not from a closed one. "Flagged five times" is 20 decisions and 2 rows. |
| 10 | §6.5: "Ben has 30 minutes. Past that the Scoper begins scoping by message." | No timer exists (grep for a 30-minute window in `first-contact-ack.ts`, `rules-layer.ts`, `asks.ts`: nothing). `requestRun(…, { delayMs })` exists (P7 15-minute follow-up, `index.ts`). But a thread with `callback_requested` is on the Ben lane, where no agent runs and `decide()` flags before reading any proposal (`decide.ts:85`; pinned by `architecture.test.ts` P19). | Buildable, but only after a triage change the PRD does not state. | The Scoper cannot "begin scoping" on a thread whose lane is Ben's. `callback_requested` must stop being a Ben-lane exception and become a debt with a clock (which `callback_due` already is). The PRD should say that, and say what happens to the open flag. |
| 11 | §10 stalled quote: "the customer is told it is coming, AND the internal chase runs." | `personalized_quotes`: 4 unsent Route A drafts, oldest 2 Sep 10:45 (four days). `janitor.ts:8-10` closes only dead runs and running estimates. Route A fires one Pushover at draft creation (`route-a.ts:9`). No chase exists. | Needs building; not listed under "needs building". | The customer-facing "it is coming" with a due time is a promise the system has to keep; the PRD says so itself and names the 13 Aug dunning incident. The P19 brief already calls the 09:11 "we'll come back to you shortly" an open commitment. Without the chase this recreates that pattern. |
| 12 | §13.2: "Parts receive context; none fetches its own." §12: tools "do not know what a message is". | `quote-clerk.ts:50` → `runQuotePrep(caseFile.conversationId)` reads the conversation itself (`quote-prep.ts:326`) with a `get_thread` tool ("Call FIRST"). `estimator.ts:314-321` loads its own intake card and `agent_runs` row. | Reworded from P20, not addressed. | The invariant is stated as held; it is false today for two of the four tools. P20-REVIEW finding 2 stands. |
| 13 | §13.1 / §4: "Exactly one piece of code puts words on the wire… All of them queue behind the same one door." | Twilio send site: only `sms.ts:121` found; every caller goes through `sendCustomerMessage`. But the spine `exit.ts` is a different door from `sendCustomerMessage`, and invoices do not "queue", they send with their own approver. | True at the wire; the PRD conflates two doors. | §12.9's "one door out, loop-safety enforced here" and §13.1's one door are different functions. Which one carries §7.2 decides whether §4 survives (finding 2). |
| 14 | §11: contractors may be reached "with no approval" for pack ready / change / chase / answering a question from the pack. | `contractor-liaison.ts:175` tier DRAFT. `job-pack-notify.ts:22,146` sends with approver `rules.job_pack` in-window; out-of-window queues for Ben until `job_pack_ready_v1` / `job_pack_changed_v1` are approved (BACKLOG Lane 5: not submitted). `contractor_relay` (`triage.ts:150-155`) relays the customer's reply to the contractor; nothing answers a contractor from the pack. | Two of four exist and are gated on Meta; two are new agents. | "Answering a contractor's question from the job pack" is an unlisted build. The Meta gate is an owner action the PRD does not mention. |
| 15 | §6.6: Ben's Groundwire call is "transcribed both directions" and lands in the thread. | `calls` 60d: outbound 51, transcribed 38, recorded 48. `twilio-realtime.ts:44-60`: dual-channel recording, originator flag maps track to speaker. Jenna's thread shows "Outbound call (5m 10s): Clarified curtain rail…" at 16:45. | Supported by the ledger. (Corrects the 19 Aug memory "outbound never captured".) | None, except that 13 of 51 were not transcribed; the PRD's "the loop closes by observation" depends on that rate. |
| 16 | §7: the ladder "needs 30 verdicts per pack at 90% unedited, and 21 verdicts exist in total". | `autonomy.ts:7-8`; `draft_verdicts` all time: 21 (11 approve fine, 2 edit fine, 1 reject fine, 7 reject wrong_move). | True. | The by-construction path is a second promotion mechanism. The PRD does not say whether an `unsafe` verdict on a by-construction send demotes it (`autonomy.ts:115` demotes via the overlay; a tier set statically in the pack would not move). Missing failure mode. |
| 17 | §9: "The date lexicon is retired as a Ben trigger." | `scoper.ts:269` `dateQuestionNeedsBen` already exempts post-quote date questions; pre-quote `date_question` is 163 hits on 9 threads in 7d; "Dates come with your quote" carries no date so `date_promise` passes. | Buildable; a `triage.ts` and `exceptionsToBen` change. | Sound. Note it alone removes the second-largest Ben trigger, so the "four reasons" table and Ben's queue both change shape. |
| 18 | Reconciliation with BACKLOG. | BACKLOG now carries D7-D9 from P20-REVIEW; "Order to run" still omits D4-D9. Nothing in the PRD maps §6, §7.1, §7.2, §10 or §11 to a lane. D8 as written ("overnight", "not at all outside Ben's hours") rests on the timestamp error above. `PLAN-P14` has no "call the lead / message the lead" buttons (§5.2). | Sequencing defect; P20-REVIEW finding 8 not addressed. | Every "needs building" item here is a new row with no place in the queue, and one queued row (D8) needs rewriting before a pane builds an hours rule the data does not support. |
| 19 | §2: the measure is "time from first contact to quote sent". | Nothing measures it today (no query or dashboard found). Four Route A drafts are four days old. | Judgement. | Measurable from `conversations.created_at` to `personalized_quotes` sent time. It carries no term for the second half of §1 ("nothing we say is something we cannot stand behind"); `unsafe` verdicts exist and could. |

**The cheap version.** Send the first-contact ack even when the customer keeps typing (it is
content-free, so staleness is meaningless for it); retire `callback_requested`, `date_question` and,
narrowly, `money_question` as Ben-lane exceptions with the debt, the "dates come with your quote"
line and a quote-cited figure path as their replacements; fix the cadence loop where it runs (D7)
and add the "anything to say?" step (D6); add a 30-minute `requestRun` delay on a yes. With those,
§5, §6, §9 and most of §7 run on code that exists.

## 4. What the plan is missing entirely

- **Calls as a first-contact channel** and the post-call ladder that already owns them.
- **What happens to the dropped exceptions**: out-of-scope (the most frequent), refund, and money
  questions before a quote. Today they are Ben's; the PRD neither keeps nor replaces them.
- **Definitions** of "message" and "customer turn" for §7.2, and which purposes it applies to.
- **The ack's live failure**: a 30% send rate on new threads, caused by `stale_by_inbound`. The PRD
  cannot promise "every first contact, always" without knowing why it is not so today.
- **Owner gates the design depends on**: Meta approval for the ack context template, the holding
  line, and both job-pack templates; the bot disclosure decision (BACKLOG Lane 5: "anything reaching
  SEND"). §7's day-one sends reach SEND.
- **Demotion** for by-construction sends, and what an `unsafe` verdict does to them.
- **Hours.** Ben is Mon-Fri 08-18 (HANDOVER). §6.5's 30-minute clock on a Saturday evening means the
  Scoper scopes at 21:30 while the call offer stands until Monday; the PRD says "never overnight"
  without saying what the customer is told about the call.
- **Which day-one intents are templates** and which are generated (finding 8).
- **Cost visibility.** Scoper rows record 0 pence; the loop in finding 1 is invisible in spend.
- **A place in the queue** for each "needs building" item, and the correction to D8.

## 5. What could not be checked, and why

- Twilio's response to an empty or duplicate body: not exercised.
- Whether the 38 outbound transcripts carry both speakers correctly: not read; only counted.
- Why the cadence loop on `8e0382…` stopped after 4 Sep: not established, may recur.
- The Scoper's Sonnet spend: `cost_pence` is 0 on every Scoper row.
- Whether the 51 new threads include contractor, test or spam numbers: not filtered, so the 15-of-51
  ack rate is an upper bound on how bad it is, not a lower one.
- The owner's answers of 6 Sep: cited by the PRD, not reproduced anywhere I could read.
- Anything on the four worktree branches; `main` only.

## On the reviewer's framing

The prompt's live-ledger clause is right and is what caught the PRD's §7.2. One warning for whoever
uses it next: `messages`, `message_drafts`, `comms_events` and `agent_questions` store naive UTC
timestamps (`timestamp without time zone`); `agent_runs` does not. A client in any zone but UTC will
shift the naive ones silently, which is how my own D8 finding, and now the PRD, came to say
"overnight" about three daytime sends. Read those columns with an explicit `at time zone 'UTC'`.
