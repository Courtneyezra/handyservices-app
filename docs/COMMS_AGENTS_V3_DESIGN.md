# Comms Agents V3 — One Spine, Narrow Agents, Ledger, Policy Packs

Status: **v2, post-council, 2 Sep 2026.** Author: Courtnee + Claude. Council verdict folded in (§13 lists what changed).
Supersedes: `docs/AGENT_FRAMEWORK_V2_PLAN.md` (V2 pipeline), the comms parts of `docs/AGENTIC_WORKFLOW_PROPOSAL.md` and `docs/AGENT_SCENARIOS_10X.md`.
Honours: `docs/COMMS_MAP_2026-08.md`, `docs/AGENT_DECISION_FRAMEWORK.md`, `docs/COMMS_EVALS_PLAN.md`, `docs/COMMS_AGENT_MAP_STAGE1.md`, the 23 Aug council verdict (ledger + relay + policy packs).

---

## 0. Decisions locked before this design (owner, 2 Sep 2026)

| Question | Decision |
|---|---|
| Drivers | Replies wrong or unsafe; too many overlapping brains; can't see or measure what the agent did |
| Approach | Start clean from the 23–25 Aug verdicts. Legacy `comms.ts` and the V2 pipeline are salvage inputs, not foundations |
| Scope | Customer WhatsApp/SMS inbound; post-call outreach; recovery/re-engagement. Contractor lane designed here, built in Phase 4 (council: blocked on data, not architecture) |
| Autonomy target | **Auto by default, Ben on exceptions** |
| Always Ben | Complaints, trust concerns, refunds; out-of-scope or unusual jobs; **money figures and date commitments stay Ben-only for now** (§4 says how that relaxes on evidence) |
| Quoting boundary | Scope only, Ben prices (§6) |
| Models | Claude core via `server/llm.ts`; Gemini kept narrowly for native video (Phase 4); no OpenRouter |
| Deliverable | Design doc, council-tested (done 2 Sep), build next session |

### 0b. Interview decisions (owner, 2 Sep 2026, after the model)

| Question | Decision |
|---|---|
| Ben's hours / paid approvals | Not yet decided; Courtnee agrees it with Ben. Default Mon–Fri 08–18 |
| Bot disclosure | None. Automated messages speak as Handy Services |
| Silence-breaker wait | **10 minutes** (model used 20; re-run replay before Phase 1) |
| 30-day success metric | **Unanswered bursts in 24h: 23% → under 2%** |
| Non-UK numbers | Acknowledge like anyone else; only obvious spam patterns are dropped |
| First AI role to build | **Scoper on WhatsApp**, then Quote clerk on call transcripts, then Sorter deadlines |
| Go-live | Switch as soon as eval families pass; no mandatory shadow week |
| Launch shape | Templates reach customers from week one. **Fast track:** simple scoping intents (`ask_gap`, `confirm_received`) may go to SEND after two weeks of clean approvals (zero rejects, ≥ 90% unedited, ≥ 20 verdicts) without waiting for the eval family; the 10% sampler and automatic demotion still apply. Everything else keeps the full gate |
| Ben's reply channel | Business number only, confirmed from data; no personal-number ingest |
| Chores this week | Courtnee enters 8 contractor phones; Courtnee agrees Ben's hours; Claude drafts the note to Ben |

---

## 1. Why now — what the audits found (2 Sep 2026)

### 1.1 Three brains, one thread
- **Legacy comms agent** `server/agents/comms.ts` (2,304 lines, Sonnet loop, 10 tools, 11-detector guard chain in `draft-guards.ts`, ~6k-token standing orders). Hardened by the 27 Aug triple-send post-mortem.
- **V2 worker pipeline** `server/pipeline/v2.ts` + `server/workers/*` (31 Aug, built and wired to production in one day). `shouldUseV2()` ignored its argument and returned `true` for every conversation. `sendV2Reply` called `approveAndSendDraft` **without** `checkDraft`, without reading `autosend.enabled`, without the 08–20 gate, and its approver string `v2_pipeline:autosend` did not match `AUTOMATED_APPROVER`, so the near-duplicate and malformed-reason holds were skipped too.
- **Ops Manager** `server/agents/ops-manager.ts` (Opus, 22 tools) can fire the comms agent on any thread with no triage claim and no debounce.
- Plus four sweeps (`comms-sweep`, `sla-sweep`, cron `sweepCommsAgent`/`windowClosingSweep`/`backlogSweep`) and the promise tracker, each with its own pre-checks and three different automated approver prefixes.
- **The exit is not one function.** `sendCustomerMessage` (the Twilio choke point) has **16 direct callers** outside `outbound.ts` (`cron.ts`, `lead-automations.ts`, `customer-notifications.ts`, `quick-replies.ts`, `quotes.ts`, `invoices.ts`, `webform-chase-service.ts`, `voice-notes.ts`…). `approveAndSendDraft` has 8 importers. None of the 16 pass the guard chain, the hours gate, or the ledger.

### 1.2 The 31 Aug–2 Sep incident (found during this audit)
- Railway has no `OPENROUTER_API_KEY`. From the 31 Aug 15:06 UTC deploy, **every inbound triage and sweep in production failed** (`OPENROUTER_API_KEY is required`), and the legacy agent was unreachable on those paths. Production was silent on inbound for two days; only the rules-based first-contact ack fired. No alarm fired.
- Six `tsx watch` dev processes on this Mac (started 25–31 Aug, all on the main checkout, all with the key and the production `DATABASE_URL` and Twilio secrets) won the triage claims instead and **sent 24 unguarded V2 replies to five real customers** on 31 Aug–1 Sep, including a commitment about fitting a sash-window kit and "Morning Lou. Just checking in. Ready for that call now?" sent at 17:46.
- Hotfix applied 2 Sep (`cfb6039`): V2 default `enabled:false`, live `comms_agent.autosend.enabled` flipped to `false`. Legacy agent drafts; Ben approves.

Structural lessons this design encodes, not just remembers:
1. **Sweeps must not run in every booted process.** Tick loops are gated on an explicit worker env flag, **and** local dev uses a Neon branch with no Twilio secrets, so an unguarded local send is physically impossible even if the flag is wrong.
2. **Approver identity is an enum, not a string.**
3. **The guard lives in `sendCustomerMessage` itself.** It refuses any call without a `run_id` and an `Approver`. Guarding `approveAndSendDraft` alone leaves 16 doors open.
4. **Whole-fleet switches live in the DB kill-switch table**, fail closed, are visible on `/admin/staff`, **and a silent worker raises an alarm** (dead-man heartbeat).

### 1.3 The numbers (90 days to 2 Sep, test data scrubbed)
| Fact | Value | Implication |
|---|---|---|
| Sent drafts machine-approved | 183 / 189 (97%) | Ben's verdicts (the trust-ladder metric) barely exist |
| Human-approved agent drafts | 6, all unedited | n=6 cannot gate anything |
| Agent questions answered by Ben | 2 of 35 (median 10h) | The ask-Ben channel is dead; 36 `flagged` rows still open |
| Inbound bursts never replied to | 33 / 211 (16%) | Silence is the current failure mode, not just wrong replies |
| Inbound texts that mention money / dates / complaints | 11% / 6% / 0% of 310 | **83% of inbound is agent-eligible** under the exception rules; "Ben on exceptions" is real, not nominal |
| Median first reply: agent vs Ben direct | 1.4 min vs 2.0 min; p90 392 vs 29 | Ben is as fast as the agent when he is there. The problem is coverage when he is not |
| New threads by first channel | 261 calls, 37 WhatsApp, 3 web/SMS | Post-call is the front door; WhatsApp threads only exist since 15 Aug |
| Thread → quote → deposit | 31% quoted, 11% paid; median 0.14 d to quote, 1.04 d to deposit | Quotes come from calls, same day. The agent's job is to make quoting fast, not to quote |
| Quote lines matching an active SKU | 0 of 571 | The catalog cannot be a quoting boundary today |
| Quotes with 1 line / median lines | 46% / 2 | Most jobs are small and bespoke |
| Contractors with a real phone | 0 of 8 | Contractor lane has no reachable identity yet |
| Ben replies from the business number only (since 15 Aug) | Confirmed 2 Sep: 2 manual sends vs 335 inbound in 3 weeks, none elsewhere | The desk already sees every human reply; no personal-number ingest needed |
| `comms_events.edited_by` populated | 0 rows | Edit attribution was never captured |

---

## 2. Principles (binding)

1. **Elimination ladder first** (`AGENT_DECISION_FRAMEWORK`): remove the work → arithmetic/lookup → rules/template → deterministic flow with one model call → agent loop. Acks, media/postcode asks, post-call outreach, SLA chasing, promise tracking and the silence-breaker are rungs 3–4, not agents.
2. **Safety is structural.** An agent cannot do what its tool belt cannot do. Money, dates, sending, booking are absent from belts, not forbidden in prompts.
3. **Lanes, not scores.** Routing is by intent/exception lane with a fixed vocabulary, never by a confidence percentage.
4. **One spine, plural agents.** Runner, case file, draft queue, guard chain, exit and ledger are singular. Agents are narrow, one per role and risk tier, each with its own kill switch and eval family.
5. **Policy packs are config.** What a lane may say, to whom, when, and at what autonomy tier is data, versioned, and visible on `/admin/staff`.
6. **Every send is a ledger event with a run id, enforced at the Twilio choke point.** If it is not in the ledger it did not happen.
7. **Autonomy is earned and un-earned per intent** from evals, Ben's verdicts, and sampled post-hoc review of what was sent. Nothing ships sending. Demotion has its own data source.
8. **Silence is a failure.** Every inbound burst ends in a send, a pending draft with a due time, or a flag with a due time that expires into a holding send. Never nothing.

---

## 3. Target architecture

```
                 ┌──────────────────────────────────────────────────────────────┐
  Meta WA ──┐    │                        THE SPINE (singular)                    │
  Twilio WA ├──► │ ingest ─► claim ─► case file ─► triage ─► policy pack ─► agent │
  SMS       │    │   │                  │            │             │          │   │
  Call end ─┘    │   │                  │            │             ▼          ▼   │
  Webform        │   │                  │            │        proposal ─► guards  │
  Ben's own WA ─►│   ▼                  ▼            ▼             │          │   │
                 │ ledger ◄──────── agent_runs ◄── lane ◄──── decision ◄──────┘   │
                 │    ▲                                             │             │
                 │    │                   ┌─────────────────────────┼───────────┐ │
                 │    │                   ▼                         ▼           ▼ │
                 │    │              SEND (exit)              PENDING (Ben)   FLAG │
                 │    └──── sendCustomerMessage(run_id, approver) ◄── rules layer  │
                 │           refuses without both; writes the ledger itself        │
                 └──────────────────────────────────────────────────────────────┘
```

### 3.1 Ingest and claim
- Unchanged entry points (`meta-whatsapp.ts`, `conversation-engine.ts`, `leads.ts`, call finalize) all call one function: `spine.requestRun(conversationId, trigger)`. Nothing else may run an agent — not cron, not Ops Manager, not scripts. `requestRun` owns the debounce and the atomic `triageHeldUntil` claim (the 27 Aug fix, now the only path).
- **Ben replies only from the business number** (confirmed 2 Sep). The desk therefore sees every human reply, and every "Ben replied" rule below is safe without further ingest. This is now a standing rule, not an assumption.
- **Worker gate:** `requestRun` enqueues; only a process with `COMMS_WORKER=1` (Railway only) dequeues. Local dev runs against a Neon branch with no Twilio secrets; scripts may run an agent only with `--allow-send`, refused unless `NODE_ENV=production`.
- **Heartbeat:** the worker writes `app_settings.comms_worker_heartbeat` every tick. A Pushover fires if it is stale > 10 min in UK hours, and at boot on Railway if `COMMS_WORKER` is absent. This is the alarm 31 Aug did not have.

### 3.2 Case file (shared assembler)
One module builds one immutable object per run, and it is the *only* thing any agent reads:
- thread timeline (messages + calls with transcripts, quarantined rows excluded), media as image blocks and video descriptions, WhatsApp window state, channel deliverability;
- client record (`service_clients`), role profile, open leads, live quote with lines/views/expiry, paid/unpaid state;
- open promises, open flags, last agent run summary, tags/stage;
- policy pack id + version resolved for (audience, stage).
Persisted by hash to `agent_runs.case_file_ref` with the **exact model snapshot id** so a run is replayable against what actually shipped. This replaces `get_thread`, `get_customer_context`, and the V2 `conversation_memory` table.

### 3.3 Triage (rung 4, not an agent)
Deterministic pre-checks first (opt-out, spam patterns, first-contact, keyword lexicon for money/date/complaint; non-UK numbers are NOT dropped, decided 2 Sep, the replay found real customers among them), then a single schema-validated Claude call (Haiku 4.5) over the case file → `{ audience, intent, lane, exceptions[], stage, tags[] }` from fixed vocabularies. Exceptions: `complaint`, `trust_concern`, `refund`, `out_of_scope`, `regulated_trade`, `money_question`, `date_question`, `spam`, `out_of_area`. Any exception routes to the Ben lane before any agent runs. Measured share today: ~17% of inbound. Triage writes tags/stage itself and logs a run.

### 3.4 Policy packs (config, versioned)
```
pack = { audience, stage?, city?, allowedIntents[], guardSet[], tier, hours, exceptionsToBen[], voiceFile, templates{} }
```
| Pack | Allowed intents | Guards | Tier at launch |
|---|---|---|---|
| `rules.first_contact` | ack_enquiry, ack_photos, ack_returning, ask_media, ask_postcode, ask_name, holding_silence_breaker, quote_on_its_way | template only, opt-out, geography, spam, window/template ladder | **SEND** (content-free by construction; today's `first-contact-ack.ts`) |
| `customer.default` (Scoper) | ask_gap, clarify_scope, confirm_received, holding, faq_from_kb, point_to_quote_page, closing | money (unconditional), date_promise, discount, duration, capability, liability, policy, capitulation, voice, unseen | DRAFT → earns SEND per intent |
| `customer.post_quote` | + answer_from_quote, point_to_picker | same + `price_objection` → Ben | DRAFT |
| `customer.exception` | none | — | Ben only; rules layer may send one holding line at flag expiry |
| `rules.followup` | quote_unviewed, promise_overdue_holding, sla_chase | template only | SEND (content-free templates) |
| `contractor.default` | job_brief, availability_ask, confirm_receipt, materials_list | customer_pii, money_to_customer | Phase 4, DRAFT |
| `internal.ben` | anything | none | n/a |

Money and dates are absent from every customer pack's vocabulary; no intent can carry them. `city` is on the pack from day one so the Derby clone is config, not a rewrite.

### 3.5 The agents and the rules layer
| Component | Kind / tier | Trigger | Belt | Replaces |
|---|---|---|---|---|
| **Rules layer** (first contact + silence-breaker + follow-up templates) | rules, content-free SEND | inbound first touch; no reply after N min (10 min, decided 2 Sep; 24/7); cadence table | template ladder only; suppressed if any outbound landed since | `first-contact-ack.ts` (kept), `sla-sweep.ts`, `promise-tracker.ts` chases, cron sweeps |
| **Scoper** (customer conversation) | agent, DRAFT→SEND per intent | triage lane `scoping`/`gathering`/`post_quote` | read case file; `describe_video` (Phase 4); `propose_reply(intent, body)`; `flag(exception, note, due)`; `set_contact_name`; `schedule_recontact` | `comms.ts` reply half, V2 scoping+reply workers |
| **Quote clerk** | agent, PROPOSE | tag `needs_quote`, scoper `ready_to_quote`, **or post-call transcript** | read case file; `propose_intake(lines[{title, category}], gaps, media[])` → prefilled builder + in-chat card | `quote-prep.ts` (kept, moved onto spine) |
| **Recovery** | agent, PROPOSE | unpaid quote ≤21d, no recent nudge | read; `queue_nudge` into `nudge_queue` (wa.me prefill send) | `recovery.ts` (kept) |
| **Verifier** | agent, READ (shadow) + sampler | 10% of SEND messages next morning; grey-zone readiness | none | `quote-verifier.ts`, evals judge |
| **Contractor liaison** | agent, DRAFT | Phase 4 | contractor pack | new; verdict step 7 |

Ops Manager stays as Ben's console but loses `run_comms_agent`; it calls `spine.requestRun` like everyone else and cannot write drafts directly.

### 3.6 Proposal → guards → exit
- An agent never sends. It returns a **proposal** `{ intent, body[], reasons, citations }`. The spine runs the pack's guard set (`draft-guards.ts`, kept), then the tier decision: SEND if intent is at SEND tier in this pack **and** no exception on the thread **and** hours allow (reactive 24/7, proactive 08–20) **and** window/channel deliverable; else PENDING with `due_at`; else FLAG with `due_at`.
- **The exit is `sendCustomerMessage(run_id, approver, …)`.** It refuses any call without both. `Approver` is a TS enum (`agent.scoper`, `rules.first_contact`, `rules.followup`, `system.invoice`, `human:<id>`…). It runs the pack guard set for agent approvers, the hours gate for proactive sends, writes `draft_sent`/`message_out` to the ledger itself, and then the WA→template→SMS ladder. All 16 direct callers migrate to pass a `system.*` or `rules.*` approver (Phase 0); the build fails if a new caller omits it.
- Near-duplicate, malformed-reason, opt-out, stall-loop, and trust-concern holds stay where they are; they now apply to every non-human approver by construction.

### 3.7 Ledger and runs
- `comms_events` becomes **write-at-source** inside `sendCustomerMessage` and the draft/flag functions: `draft_created`, `draft_approved`, `draft_edited`, `draft_sent`, `draft_rejected`, `flag_raised`, `flag_closed`, `flag_expired`, `run_started`, `run_finished`, `sample_reviewed`, with `run_id`, `actor`, `drafted_by/edited_by/sent_by`. The existing derive-from-source sync stays as backfill and reconciliation, and a nightly check asserts zero drift.
- New `agent_runs`: `id, agent, pack_id, pack_version, trigger, conversation_id, case_file_ref, model_snapshot, prompt_hash, decision, lane, proposal jsonb, guards_hit[], usage, cost_pence, duration_ms, transcript_ref`. Every draft, flag, tag write carries `run_id`. This is the per-thread "what did it do and why" view Ben has never had, the replay corpus the evals need, and (joined to verdicts and `deposit_paid_at`) the labelled conversion corpus that makes the second city a config change.
- Outcomes are **derived** by joining events to quotes and `deposit_paid_at`. No outcome column on conversations.

### 3.8 Models
- Reasoning: Claude via `server/llm.ts` (prompt caching, per-turn usage logging). Scoper and Quote clerk on Sonnet 5; Triage on Haiku 4.5; Verifier on Opus 5. Model snapshot id recorded per run.
- Video (Phase 4): `describe_video` tool calls Gemini 2.5 Flash **directly** (`GEMINI_API_KEY` is already on Railway) with native video bytes; output is a fixed schema (`whatIsShown`, `whatIsMissing`, `defects[]`, `textFound[]`) validated before it enters the case file. Salvaged from `server/workers/vision.ts`. No OpenRouter.
- Every run logs cost; `/admin/staff` shows spend per agent per day; a daily cap per agent **drops the agent to DRAFT**, never to off. Off is silence.

### 3.9 Kill switches
`app_settings.kill_switch.<agent>` (fail closed to DRAFT for customer-facing agents, off for read-only ones) + `comms.autosend` master + per-pack tier. All visible and flippable on `/admin/staff`, every flip logged to `system_events`. Suites use process-local config (cherry-pick `useProcessLocalCommsConfig` from the `angry-merkle` worktree; do not merge that worktree, it is 97 commits behind).

---

## 4. "Auto by default, Ben on exceptions" — what it means concretely

**Exception lane (always Ben):** complaints, trust concerns, refunds, out-of-scope/regulated/unusual jobs, any money or date question (~17% of inbound). The flag carries `due_at` (default 4 working hours, 20 min for `callback_requested`). One Pushover, a 09:00 digest, auto-close when Ben replies in the thread. **At expiry the rules layer sends one template holding line** ("Ben's picking this up, back to you by …") and re-flags once. Flags never rot silently again.

**Everything else (agent by default):** the customer pack's allowed intents. At launch every Scoper intent is DRAFT, but the customer is never silent: the rules layer already covers first contact, media/postcode asks and the silence-breaker at SEND. Promotion to SEND is per intent, automatic, from evidence:
- eval regression family for the intent at pass^3 = 100% (`COMMS_EVALS_PLAN` gate), and
- **≥ 30 human verdicts across the pack** in the last 30 days with unedited-approval ≥ 90%, and **zero `unsafe` rejects on this intent** ever, and
- zero guard escalations attributed to the intent in the last 14 days.

**Fast track (decided 2 Sep):** `ask_gap` and `confirm_received` may skip the eval-family precondition and promote after two weeks of clean approvals (zero rejects, ≥ 90% unedited, ≥ 20 verdicts). Sampler and demotion apply unchanged. No other intent is fast-tracked.

**Un-earning.** Once an intent is at SEND, Ben stops seeing it, so the verdict stream would stop. Therefore: the Verifier queues **10% of SEND messages** for a one-tap next-morning review (`fine` / `not fine` + reason), and customer-side signals count as verdicts (opt-out, no reply within 48h on a question, `trust_concern` tag, complaint keyword). Any `unsafe` or `not fine: unsafe`, any incident tag, or sampled-approval < 80% over the trailing 30 drops the intent to DRAFT and pings Courtnee.

**Bootstrapping the verdicts.** The first two weeks after Phase 1 run DRAFT-only for Scoper intents with a two-tap approve/edit/reject UI capturing a reason code (`fine`, `tone`, `wrong_move`, `unsafe`, `missing_info`). Pending drafts also carry `due_at`; if Ben has not acted by then the rules layer sends the holding line, so a slow verdict never becomes customer silence. Expected: `ask_gap` and `confirm_received` reach SEND within ~4 weeks; `holding`, `point_to_quote_page` within ~6; `faq_from_kb` only after a KB exists.

**Relaxing money and dates (not now).** Both stay absent from customer packs until: (a) the Quote clerk's intake accuracy is measured (lines Ben keeps unchanged ≥ 80% over 50 quotes), and (b) `point_to_picker` has been at SEND for 30 days with no date-related rejects. Then, and only then, a council decision on "engine-sourced figures with a citation". The agent never originates a figure; the question is only whether it may *repeat* one the quote engine has already written to the customer's quote page.

**Bot disclosure** is a brand decision, not a config field: the rules layer's templates say "Handy Services" and never "I"; Scoper voice files say "we"; Ben's own replies are Ben. Decide explicitly before Phase 3 whether SEND-tier agent replies carry a marker.

---

## 5. Autonomy ladder per component (launch → target)

| Component | Launch | 30 days | 90 days |
|---|---|---|---|
| Rules layer | SEND: first contact, ask_media, ask_postcode, silence-breaker | + quote_unviewed, promise_overdue_holding | same |
| Triage | writes tags/stage | same | same |
| Scoper | DRAFT all | SEND: ask_gap, confirm_received | + holding, point_to_quote_page |
| Quote clerk | PROPOSE (card), post-call included | PROPOSE | PROPOSE; auto-attach media |
| Recovery | PROPOSE | PROPOSE | PROPOSE |
| Verifier | 10% sampler + shadow | advisory in UI | gates promotions |
| Contractor liaison | not live | Phase 4 DRAFT | SEND: job_brief, confirm_receipt |

---

## 6. Quoting boundary — decision

**Scope only. Ben prices and sends.** The agent's product is a quote Ben can send in under a minute: prefilled lines from the Quote clerk, media ticked onto the quote, name/postcode/customer type captured, gaps already asked. Not a price. **And the clerk runs on the post-call transcript too**, so for the 261-of-301 threads that start with a call, the card is waiting before Ben opens the thread.

Why, from the evidence:
- 0 of 571 quote lines match an active SKU name; 536 of 571 are `custom`. There is no catalog to rules-price against.
- Median 2 lines, 46% single-line, median £143 for one line. The price-barrier study says the sweet spot is £100–200 and the plateau to £1k must never be discounted; an engine that prices without Ben's judgement on scope will over- or under-shoot exactly where conversion is decided.
- Quotes already arrive 0.14 days after first inbound. Speed is not the constraint; Ben's attention per quote is.
- COMMIT (price) is never an agent tier, reaffirmed by the owner on 2 Sep.

**Build the catalog as a by-product:** the clerk emits `category` on every line from day one, and every line Ben keeps unchanged is a labelled SKU candidate. **Revisit trigger:** the day 30 quotes in 90 days share one category with one line and ≤ 20% price variance, run a READ-tier shadow estimate for that category for 30 days. If ≥ 80% within 10% of Ben's price, bring "agent sends engine-priced quote for category X" to council.

### 6.1 Addendum — Route A (built 3 Sep 2026, P8)

The boundary above stands; what changed is how much of the work before Ben's tap is automatic.
The contract, in one line: **clerk scopes, estimator measures, engine prices, Ben decides.**

- **Clerk scopes.** The spine's Quote clerk is the ONLY intake (the legacy `maybeAutoQuotePrep`
  handoff no longer fires and `metadata.quotePrepIntake` is never written again; it is read only as
  a fallback for pre-spine threads). One readiness vocabulary everywhere
  (`shared/intake-readiness.ts`: `quote_ready | quote_pending | needs_info | visit_first | decline`),
  one reader everywhere (`server/intake.ts getIntake`: spine artifact → human override → legacy
  fallback), one card in the thread and in the portal (`QuoteIntakeCard`).
- **Estimator measures.** It judges category, on-site time as a range, materials with cost,
  access/difficulty flags and confidence. It NEVER outputs a price; a price field in its output is
  stripped and refused. Time comes from history first (same category, last 12 months) and the
  model only when history is thin (`timeSource`).
- **Engine prices.** The ONLY pricing engine is `server/contextual-pricing/multi-line-engine.ts`
  with the live settings row (`materialsMarginPercent`, 27 today, never hardcoded). Labour = the
  estimator's on-site minutes per line + ONE setup and ONE cleanup allowance per job (no per-line
  buffers). The additive module in `pricing-config.ts` and `/api/quotes/from-estimate` are retired.
- **Ben decides.** The chain writes a DRAFT with suggested prices and bands in a separate field;
  every customer-visible price stays null until Ben's tap on the phone-first "price and send"
  screen (`/admin/price/<slug>`). The contextual generator stays one tap away. No price reaches a
  customer without that tap — COMMIT is still never an agent tier.

**Fallback rule.** A line the estimator cannot measure (no history, no catalogue match, low
confidence) is priced at the category reference rate × default duration from
`reference-prices.ts`, flagged `check_this` with the reason. It is never silent: the price screen
shows the badge and the reason.

**Visit-first rule.** Readiness `visit_first` produces no price. The spine drafts the paid survey
offer (intent `offer_survey`, tier DRAFT, fixed fee from settings, booking link) for Ben to
approve. **Decline rule.** Readiness `decline` (one of the four no-go trades) drafts the fixed
polite-no template at intent `closing`, tier DRAFT; Ben confirms it in the queue. The portal's lane
override can set `decline` by hand; that queues the same draft.

**Route B graduation trigger — unchanged.** Per category: ≥ 30 quotes in 90 days, ≤ 20% price
variance, and ≥ 80% of lines unedited-in-band for 30 days. Met → bring "agent sends engine-priced
quote for category X" to council. Nothing auto-sends in this phase; the price screen's stats table
only reports the trigger.

---

## 7. Scope lanes beyond the customer thread

**Post-call outreach.** Rules, not a model: recording > 10 s → nova-3 transcript → Triage (same call as inbound) → template ladder (freeform if window open, else approved template, else SMS) → Quote clerk on the transcript → thread now has a first outbound, so the Scoper handles the reply. Outbound calls are captured since 23 Aug. Merge gate remains the four call types from the `remove-realtime` worktree.

**Recovery / re-engagement.** Unpaid-quote nudges stay PROPOSE into `nudge_queue` with the wa.me prefill send (the Sukhy lesson) ; `quote_unviewed` template chases run from the rules layer at SEND. Re-engagement campaigns stay manual-triggered.

**Contractor lane (Phase 4).** Pack defined in §3.4; ingest fork and role resolver already exist (`server/roles.ts`, `conversations.role_profile`). Precondition is data entry: real phones for the 8 contractors on `/admin/contractors` (empty strings today). Owner: Courtnee, before Phase 2 starts. Relay via the Handy number stays verdict step 6.

---

## 8. Ben's surface

- `/admin/comms` stays the workbench. Add: a per-thread **Agent runs** drawer from `agent_runs` (what it read, lane, proposal, guards hit, why pending), verdict capture with reason codes on approve/edit/reject, `due_at` on drafts and flags, and the morning sample-review strip.
- `/admin/staff` shows per-agent tier per intent, kill switch, cost today, sampled-approval trailing 30, eval family status, worker heartbeat. Promotions/demotions appear here as events.
- 09:00 digest (Pushover): flags past due, pending drafts past due, sample reviews waiting. **Ben's hours and paid time for verdict-tapping are an operating-model question**, set before Phase 1 ships, not assumed.

---

## 9. Evals

Adopt `COMMS_EVALS_PLAN` with three additions: (1) `agent_runs` + ledger are the case source, so every production run is a replayable case with its model snapshot and Ben's verdict attached; (2) promotion/demotion in §4 reads the scoreboard directly; (3) **the guard chain gets its own measured false-negative rate** (seeded from the 24 V2 sends, the James incident, and the 165 legacy autosends) before any Scoper intent is promoted. Regression families = one per intent + incident regressions. Judge rubrics: voice-v1 and move-quality-v1, advisory until ≥ 85% agreement with Ben. **Owner for writing the ~10 intent families is named before Phase 2 starts**; without them nothing promotes regardless of Ben's taps.

---

## 10. Migration plan

Each phase has a kill criterion and ends deployed. Legacy `comms.ts` keeps running (DRAFT-only) until Phase 3 says the Scoper beats it.

| Phase | Build | Exit criterion | Kill |
|---|---|---|---|
| **0 — Close the doors** (2 Sep hotfix done; +2 days) | Delete `sendV2Reply` + V2 routing; `Approver` enum; **`sendCustomerMessage` refuses without `run_id` + approver, 16 callers migrated**; `COMMS_WORKER` gate on every tick/cron site + boot alarm + heartbeat; Neon dev branch + Twilio secrets off local `.env`; cherry-pick process-local config; enter 8 contractor phones | Railway is the only process that can send; no send without a run id; Ben confirmed on the business number only | — |
| **1 — See everything, never go silent** (~3 days) | Write-at-source ledger events; `agent_runs` table; run id on drafts/flags/tags; verdict capture with reason codes; `due_at` on drafts and flags with template-holding-line expiry; **rules-layer silence-breaker**; ack/ask_media/ask_postcode moved into the rules layer | 100% of sends have a run id; 0 inbound bursts unanswered > N min; ≥ 30 verdicts in 14 days | if verdict rate < 50% of drafts after 14 days, fix Ben's operating model (hours/pay) before touching UI |
| **2 — The spine** (~2–3 weeks, honest estimate) | `server/spine/` (requestRun, case file, triage, packs, proposal, exit); Scoper first, then Quote clerk (incl. post-call), then Recovery ported; Ops Manager's comms bypass removed; eval families written in parallel by the named owner; shadow logging optional, not a gate | Eval families pass for the ported role; guard-hit parity with legacy on replayed bursts; guard false-negative rate measured | if the Scoper's eval family cannot reach pass^3 in two weeks, stop and review packs |
| **3 — Earn sending** (~2 weeks, mostly waiting) | Eval harness reads ledger; judge calibrated; promotion + demotion job live; 10% sampler live; Scoper replaces legacy on customer lane; bot-disclosure decision made | first Scoper intents promoted to SEND by evidence; legacy `comms.ts` deleted | any `unsafe` on a SEND intent → automatic demotion, review |
| **4 — Widen** | Gemini `describe_video` tool; in-chat quote card; post-call merge-gate validation; contractor pack | video descriptions used in ≥ 50 runs; one contractor thread end-to-end | — |
| **5 — Delete** | `server/pipeline/v2.ts`, `server/workers/*` (except salvaged prompts), `conversation_memory`, `sla-sweep.ts`, `promise-tracker.ts`, `comms-sweep.ts`, cron comms sweeps, `resolve_question`, `autosend.intents`, `AUTOMATED_APPROVER` regex | no references; `/admin/staff` lists only spine components | — |

---

## 11. Salvage table

| From | Keep | Why |
|---|---|---|
| `comms.ts` | guard chain (`draft-guards.ts`, exists, 694 lines), standing orders split into pack voice files, `flag_for_ben` semantics, stall limiter, morning-release | proven in incidents |
| `first-contact-ack.ts` | whole module as the rules layer for first touch, silence-breaker and follow-up templates | the sanctioned content-free SEND |
| `message-drafts.ts` / `outbound.ts` | the queue and the Twilio ladder; exit moves *into* `sendCustomerMessage` | choke points, keep |
| `comms-ledger.ts` | sync as backfill/reconciliation | drift check |
| V2 `vision.ts` | prompt + `MediaExtraction` shape + native-video call | real capability; rewrite parser, call Gemini direct |
| V2 `scoping.ts` | gap/assumption vocabulary | good idea, needs schema validation |
| V2 `reply.ts` | voice notes into pack | bubble splitting already in the exit |
| V2 research/pricing workers | nothing | model-invented unit prices, hardcoded £45/£75 |
| `quote-prep.ts`, `quote-verifier.ts`, `recovery.ts` | as Quote clerk, Verifier, Recovery | already spine-shaped |
| `roles.ts`, `role_profile` | as-is | contractor pack needs it |

---

## 12. Open questions after council

1. ~~Ben's operating model for verdicts~~ decided 3 Sep: Mon–Fri 08–18, approvals are paid time (the shipped default).
2. **Bot disclosure** on SEND-tier agent replies. Brand decision before Phase 3.
3. **Silence-breaker copy** at 10 minutes (decided 2 Sep). Must sound like Handy, not a bot; must never fire once any outbound has landed.
4. **Guard false-negative bar** for promotion (§9). Proposed: 0 misses on the incident corpus, ≤ 2% on the 165 legacy autosends.

---

## 13. What the council changed (2 Sep 2026)

Five advisors (Contrarian, First Principles, Expansionist, Outsider, Executor), anonymous peer review, chairman. Verified facts overrode advisor claims where they conflicted.

**Agreed and adopted:** the exit was guarded at the wrong function (`sendCustomerMessage` has 16 direct callers) → §3.6 rewritten; the ≥30-verdicts-per-intent gate was unreachable at this volume → §4 gate now per pack + zero unsafe per intent; acks/media/postcode asks are rules, not agent intents → moved to the rules layer at SEND; contractor lane is blocked on an afternoon of data entry → Phase 4, phones entered in Phase 0; no dead-man heartbeat → §3.1; flags rot → `due_at` expiry into a holding send.

**Caught in peer review:** Ben's personal number was thought uncaptured → checked 2 Sep: he has used only the business number since 15 Aug, so the desk sees all replies and no ingest is needed; autonomy was never un-earned once at SEND → 10% sampler + customer-side verdicts; eval families were an unowned precondition → named owner before Phase 2; local machines hold prod secrets → Neon branch; guard chain's false-negative rate never measured → §9; replay without model snapshot → §3.2.

**Clashes resolved:** grandfather acks vs rules → rules (both eliminate silence; rules cost nothing per send). Shadow estimate now vs never → emit `category` now, estimate when 30 quotes share one. Unpaid chases SEND vs PROPOSE → SEND once Ben's number is ingested. Contrarian's "money/dates are most of the thread" → measured at 17%, not adopted.

**Executor's factual error noted:** `draft-guards.ts` exists; no guard-extraction work is needed. Its Phase 2 estimate (2–3 weeks) was kept anyway because the 16-caller migration and shadow dual-logging are real work.

---

## Appendix A — audit sources (2 Sep 2026)
Four parallel read-only audits: legacy lane (entry points, belt, guard chain, gates, send path), V2 pipeline (flow, workers, send safety, memory, OpenRouter, salvage), sibling agents + data model + UI, and 90-day DB evidence + doc contradictions. Live config read from `app_settings.comms_agent`; Railway variables and deploy logs read via the Railway MCP; direct-caller counts and exception share measured in this session.
