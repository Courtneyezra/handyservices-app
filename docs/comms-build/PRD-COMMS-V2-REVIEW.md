# Review of PRD-COMMS.md v2

Adversarial pass per `REFLECTION-PROMPT.md`, 6 Sep 2026, by the reviewing pane. Code at `main`
`17cf5d86`; read-only production queries run today with the session set to UTC (`agent_runs`,
`message_drafts`, `messages`, `comms_events`). The owner's rules are taken as given. v2 says it
"rests on" what exists; this pass checks those claims first, then the four questions asked.

## 1. VERDICT

**flawed**, narrowly. The shape survives; each of the three mechanisms the build list depends on
(§4.2, §4.3, §8) rests on a claim that is wrong or incomplete, and a brief written from v2 as it
stands would inherit the error.

## 2. The single strongest objection

The highest-value item, exempting the first-contact ack from the freshness test, is the wrong fix
for the right defect, and v2's stated alternative is a no-op. The ack is not content-free: the
context template quotes the customer's first message back, and on the freeform and SMS paths the
photo ask is folded into the same body. Exempting it from `staleAgainst` means the ack that sends
is the one composed from the least information, before the photos, the "text only please" or the
"sorry, wrong number" arrived; nothing re-reads the burst at release. That is the Janet incident
class P7 was built to prevent, moved to the first message of the relationship. The alternative v2
offers, "or stop stamping them with `basedOnInboundId`", changes nothing: `staleAgainst` falls back
to the time test and returns stale for the same draft. The defect is real (four phones with a
stale-held ack in 14 days, none ever acked) and the fix is small, but it is a re-compose at
release, not an exemption. Behind that, two of v2's other "exists" claims are false: the 11:01 run
it credits to P19 happened two minutes before P19 was committed, and `out_of_scope` is not handled
automatically today by anything.

## 3. Findings

Ordered by severity.

| # | Claim | Checked against | Verdict | What it changes |
|---|---|---|---|---|
| 1 | §4.2 change: "Exempt rules-layer content-free sends from the freshness test (or stop stamping them with `basedOnInboundId`)". | `draft-freshness.ts:44-52`: without `basedOnInboundId` the time test (`latest.at > created`) gives the same verdict. `first-contact-ack.ts:838-846`: the ack body is the `web_enquiry_ack_context` template quoting the enquiry; `:880-892`: the T1 media ask is appended to freeform and SMS bodies. `:789`: `prefersText` is read from a thread tag set only by ack-reply triage (`:1088`), which cannot exist before the ack. Source is `first_contact_ack`, not `rules_layer`; `AGENT_DRAFT_SOURCES` already excludes it from supersede; the guard that bites is `approveAndSendDraft` for every approver (`message-drafts.ts:449-470`). Release: `comms-sweep.ts:310-350` re-tries a held ack every fast tick and rejects it only once any outbound exists. Ledger 14d: 4 phones stale-held, 0 later acked; 0 of 17 sent acks carried a media ask (all template sends). | **Wrong fix, no-op alternative, mis-scoped source.** | The failure modes v2 has not seen: (a) sending a quote of message 1 after message 2 replaced it; (b) asking for a photo the burst already delivered, on the freeform/SMS path; (c) asking for a call after "text only" or "wrong number" in message 2, since the burst is never re-read; (d) an exemption keyed on the hold marker also exempts the post-call video and webform lanes that share it (`comms-sweep.ts:311-313`), which are not content-free. What is already safe: a manual reply during the hold rejects the ack (`:330-340`). **The cheap version:** at release, if stale, re-compose against the thread as it now stands (media present → no media ask; no-call words → written route; latest snippet) and send once. Keeps P7's meaning, fixes the 0-of-4. |
| 2 | §1: "P19 already fixed the preparation half… on that same thread the clerk and estimator ran at 11:01 the next day." | `git log`: P19 committed 4 Sep 11:03 UTC (`c599df99`), merged 11:40 UTC. First production run carrying `benLaneClerk`: 4 Sep 14:54 UTC; 62 runs since, 55 prepared. The incident thread's 11:01 run: lane `quote_clerk`, exceptions `[]`, no `benLaneClerk` key; the clerk returned `none`, the estimator PROPOSEd, and Ben sent the quote by hand at 11:04. Same day. | **Mechanism is live; the evidence cited is not evidence of it.** | The 11:01 run happened because the exceptions cleared and the thread left the Ben lane, not because the clerk worked on it. v2's argument that "the live gap is the call, not the quote" still holds, but its proof should be the 55 prepared runs since 14:54, not this thread. "The next day" is wrong. |
| 3 | §6.2: `out_of_scope` "stays automatic. The clerk's fixed decline template (intent `closing`) handles it today and continues to." | `customer-default.ts:20`: `out_of_scope` is in `exceptionsToBen`; raised only by the model (`triage.ts:202`, no lexicon), so today it is a Ben flag: 253 hits on 6 threads. `quote-prep.ts:68-84`: `DeclineReason` is gas_work, roofing_height, structural, major_electrical only; nothing for "outside our area" or "a trade we do not cover". `quote-clerk.ts:57-60`: the decline is a **DRAFT** at `closing`, "Ben confirms the polite no". | **False on both halves.** | Not automatic today, and the templates do not cover the definition of out_of_scope in the triage prompt. The disposition needs either new decline reasons plus a tier decision, or out_of_scope stays Ben's. Either way it is a build item, and it is absent from §12. |
| 4 | §8: price is "four changes". | `scoper.ts:237-257` `checkProposedBody` runs `checkDraft` on every `propose_reply`; a figure is refused at the tool before the guard sees it. `scoper.ts:80` `CORE_FALLBACK` and the tool description (`:284`): "Never a money figure… the tool refuses them". `verifier.ts:64`: "unsafe: true if the message states a money figure"; `sampler.ts` → `autonomy.ts:115-116` demotes on `unsafe_sample`. `packs.ts:33-37` `validatePack` refuses a smelling intent name at load, and a load-time name check cannot become citation-based. | **At least seven, and the fifth is a hard stop.** | (5) the belt's own refusal, (6) the prompt, (7) the verifier rubric, else the first sampled cited range demotes the intent. Change 3 as written is incoherent for `validatePack`. Size "medium–large" understates it; the belt and rubric changes also widen the eval families' assertions. |
| 5 | §5.4: "A tier set statically in a pack does not move; `autonomy.ts:115` demotes through the overlay." | `packs.ts:90-99` `applyTierOverlay` merges overlay rows over `tierByIntent`; `decideTier` reads the resolved tier, so an overlay DRAFT demotes a static SEND. `cron.ts:131-136`: the job runs only when `spine.autonomy.enabled`, off, eligible ≥ 17 Sep at ≥ 50% verdict rate. `routes.ts:16` `POST /tiers`: a person can demote. | **Premise false; the real gap is unstated.** | Where the tier lives does not matter. What matters is that the only automatic demoter is a job that is off, so a day-one send has no automatic demotion at all until autonomy is switched on, which v2 elsewhere says the ladder cannot reach. Either the job runs in demote-only mode for by-construction tiers, or an `unsafe` verdict demotes synchronously. Neither is in §12. |
| 6 | §4.3: the Scoper "begins scoping" after 30 minutes; "the ping still fires"; "the open flag closes when… the Scoper takes over". | `decide.ts:120-122`: any open flag on the thread makes every proposal `pending` (DRAFT), so a takeover under an open callback flag cannot SEND, contradicting §5.1. With `callback_requested` no longer an exception, the spine raises no flag and no ping; `callback_due` and its Pushover are opened only by ack-reply triage (`first-contact-ack.ts:1094-1113`), which runs on replies to the ack. A first message "please ring me on…" with no ack yet opens nothing. | Buildable, but the row is not "small" and has two holes. | The debt must be opened from spine triage as well; the takeover must close (answer) the flag, or the ping must not be a flag. Also: "After 30 **working** minutes" and "outside Ben's hours the clock does not run: the Scoper scopes by message" read two ways (pause the clock until 08:00, or take over at once). Say which; "never overnight" needs the second. |
| 7 | §4.1: a call-first thread "does not start the §4.3 clock". | `first-contact-ack.ts:1096`: a yes opens "the same tracked ring-back the missed-call ladder uses". `post-call-outreach.ts:263-280`: a `callback_due` thread falls back to a text after `callbackFallbackMinutes`. `post-call-ladder.ts:6,43`: answered inbound calls run a flag-gated continuation lane; `leads` 30d source `post_call_auto_video` 3. | Inconsistent. | A missed call is the strongest "call wanted" signal and already has a debt, a clock and a text fallback. Exempting it from the 30-minute Scoper takeover leaves the most call-hungry lead with the weakest promise. Judgement, but it contradicts "a lead is never left waiting on a human". |
| 8 | §5.3: day-one SEND "is a config act (`pack_intent_tiers`, settable by a person)". | `routes.ts:16` `POST /tiers`; `autonomy.ts:335,453` are the writers; `applyTierOverlay` honours the row; `assertPromotable` refuses smelling names. | True. | None. Note the disclosure gate (Lane 5, §13) still sits in front of it. |
| 9 | §5.3 option (a): "template the day-one intents, fixed wording with slots. Genuinely rung-zero." | `customer-default.ts:15`: `ask_gap`, `clarify_scope` name a gap or a question the model chooses. A slot filled by generated text is generated text. | Rung zero only if the slot values come from a closed list. (Judgement.) | Specify the gap vocabulary (room, count, material, access, postcode, photo) or (a) collapses into (b). |
| 10 | §4.2: 15 of 51, ten stale rejections, three drafts in five minutes on 3 Sep. | Ledger, this session. | True. Add: 4 phones held, 0 later acked. | None. |
| 11 | §5.5 restatement of the loop and the door rule; §11.1 two doors; §7 date retirement; §9 stalled quote; §10 contractors; §11 invariants 5-7. | `comms-sweep.ts:154`; `outbound.ts:174` 20 callers; `rules-layer.ts:304`; `scoper.ts:269`; `personalized_quotes` 4 drafts; `contractor-liaison.ts:175`; `job-pack-notify.ts:22,146`. | True. | None. |
| 12 | §12 sizes. | Rows 2, 3 and 8 as analysed above. | Row 2 medium (triage, decide, ping, flag close). Row 3: D7 is small, D6 is a design step. Row 8 large. | Honest sizes change the order. |

### The 19 v1 findings, one line each

Addressed with a verified fix or decision: 1, 2, 4, 5, 9 (see #2 for the evidence), 11, 13, 14,
16 (see #5 for the premise), 17, 19.
Addressed but the fix is wrong or incomplete: **3** (#1), **6** (#3), **7** (#4), **10** (#6).
Acknowledged in prose only, no build item: **12** (§11.2, "a target"), **18** (§12 last paragraph:
sequencing "an open item"; `PHASE5-DELETE.md` unchanged, `quote-clerk.ts:17` still unlisted).
Silently dropped: **15** (v1 §6.6 "transcribed both directions, the Scoper resumes from the
call" is gone from v2; `call-thread.ts:606-623` does request a `call_ended` run, so the mechanism
exists, but the PRD no longer says the call feeds scoping).
Partly: **8** (§5.3 requires (a) or (b); (a) is underspecified, #9).

## 4. What the plan is missing entirely

- **A rule for what the ack may say once it is exempt** from freshness. If the burst is not re-read,
  the ack must be truly content-free: no enquiry snippet, no media ask, no call ask when the thread
  already holds a no-call instruction. v2 has neither the re-read nor the stripped ack.
- **out_of_scope as a build item**: new decline reasons, a tier, and a lexicon or it stays Ben's.
- **Automatic demotion while autonomy is off** (#5).
- **The debt opener in spine triage** for a first-message call request (#6).
- **The belt, prompt and verifier changes** in §8 (#4).
- **A bound on first-contact automation.** After the ack fix: ack, then a photo/postcode ask (one
  per 24h), then a Scoper message at 30 minutes, plus the silence-breaker's holding line if any gap
  reaches 10 minutes. §5.5 says the door rule is only a proposal. Nothing else bounds this.
- **Sequencing** against Lanes 1-4 and the `comms.ts` import in Phase 5: still open, still no row.

## 5. What could not be checked, and why

- Why Jenna's thread produced three ack drafts when a stale-held ack should have blocked the source
  dedupe (`message-drafts.ts:150-165`). The ledger shows three creations; the code path that allowed
  the second and third was not traced.
- Whether the freeform/SMS ack path with the folded media ask has fired in production: 0 of 17
  recent sends, but sends older than 14 days were not read.
- Whether P19's Railway deploy time matches the 14:54 UTC first run; inferred from the ledger only.
- The clerk's behaviour on the incident thread at 11:01 (it returned `none`); not traced.
- Anything on worktree branches; `main` only.

## On the reviewer's framing

The instruction "an admission is not a fix" was the right lens: v2's honesty about §11.2 and
sequencing is better than v1's silence, but honesty without a row in §12 is still nothing to build.
One more thing for the next pass: v2's own ledger figures were right in every case I re-ran; the
errors were all in *attribution* (what caused a run, what handles a case today). That is the
category to keep checking.
