# Agent C — Autonomy & Follow-Through: DONE

Task spec: `docs/GUARDRAIL_TASK_AGENT_C.md`. Incident: conversation
`b57b6790401ff28a3db04d58ff1e366f` (+447950552830, "James", £992 bathroom
floor quote, 26–27 Aug 2026). All three failures now have code-level guards.
**Nothing committed** (per brief); all changes are in the working tree.

## Test results

`scripts/_test-autonomy-guards.ts` → **GREEN: 56 passed, 0 failed**
(re-run after Agent A landed their comms-sweep.ts changes — still green).
`npm run check` → clean except two **pre-existing** corrupted files
unrelated to this work (`scripts/scrape-reddit-value-drivers.ts`,
`scripts/seed-diy-advice.ts`) — Agent B's DONE file reports the same pair.
Agent B's `scripts/_test-content-guards.ts` still ALL GREEN after my comms.ts
edits.

Test numbers used: +447700900970/71/72 (Ofcom reserved range; 90097x
sub-range verified unused by other suites). Pushover is disarmed in-test by
deleting `PUSHOVER_APP_TOKEN`; config isolated via `COMMS_CONFIG_OVERRIDE`.
All fixture rows cleaned up at start and in `finally`.

## Files changed

| File | Ownership | Change |
|---|---|---|
| `server/agents/comms.ts` | mine | C1 gate, C2 limiter, C3 recording hook, Agent B handoff wiring, prompt/staff-card updates |
| `server/agents/promise-tracker.ts` | mine (new) | detection heuristics, working-hours clock, commitment record/clear, repeat-holding assessment, overdue sweep |
| `scripts/_test-autonomy-guards.ts` | mine (new) | 56-assertion suite |
| `server/agents/comms-sweep.ts` | Agent A | ONE line added (wiring, see below), after re-reading the file per brief |

## C1 — trust_concern strips autonomy

- `maySendDirect` (comms.ts, ~line 313) now takes a **required**
  `trustConcern: boolean` option. When true it returns
  `{ send: false, reason: 'held for human review because the thread is tagged trust_concern — …' }`.
  The gate sits after `neverSendDirectReason` and **before** the hours gate,
  so the reactive 24/7 lane cannot rescue it.
- `queue_draft` does a **fresh DB read at decision time** via new export
  `threadHasTrustConcern(conversationId)` (comms.ts, exported next to
  `TRUST_CONCERN_TAG = 'trust_concern'`). Reading at decision time rather
  than run start collapses both required cases — tag present at run start
  and tag added mid-run — into one proven behaviour (the 11:34 incident
  case: model added the tag itself, then kept auto-sending off a stale
  snapshot).
- The `firstContactOk` unsupervised lane is additionally fenced with
  `&& !trustConcern`.
- SYSTEM prompt gained a standing order ("ONE TAG YOU SET YOURSELF CHANGES
  YOUR OWN AUTONOMY") telling the model to set the tag on distrust signals
  and that a human clears it; the STAFF card `autonomy.approval` lists the
  new hold reasons.

## C2 — holding-reply stall-loop limiter

In `queue_draft`, after `maySendDirect` (hence `let decision`):
if `detectHoldingReply(input.body)` fires, `assessRepeatHolding()` walks the
trailing outbound burst. If the last agent-sent outbound was itself a holding
reply and nothing material changed since, the decision is overridden to
queue-pending AND `flagThreadForBen` is called with a note naming the breached
expectation: `Second holding reply attempted; the customer is still waiting on
"${waitingOn}" since ${sinceStr}…`. One flag per conversation via the existing
`needs_ben` dedupe. Errors in assessment degrade to "treat as first" (never
blocks a legitimate send on a DB hiccup).

"Material change" resets (any one allows another holding reply):
- a **substantive** outbound since (question, link, or new info),
- a **Ben-sent** message since (outbound content not matching any
  `messageDrafts` row with `source='comms_agent'`, split on `---` bubbles),
- a **quote row created** since the last holding reply.

## C3 — promise tracker (`server/agents/promise-tracker.ts`)

### Detection heuristics
- `detectFollowUpPromise(body)`: narrow regex family over house phrasings —
  "I'll come back to you", "I'll get X sorted/sent/priced", "let me check …
  and come back", "as soon as it's ready", "sorting it now", "on it now",
  "leave it with me", "bear with me", "I'll update you / let you know / keep
  you posted". Deliberately narrow: false negatives are cheap (no timer),
  false positives flag Ben spuriously.
- `detectHoldingReply(body)`: null if the body contains a question mark or a
  link (questions and quote links are forward motion). Otherwise requires a
  promise AND ≤ 8 words of residue after removing promise clauses and
  courtesy (`COURTESY_RE`). Sentences split on `.!?`, newlines, **and
  commas** — comma-splitting added so "I'll get the fitting arranged, and
  just so you know, the D-shape seat needs the hinge kit replacing" is
  correctly classed as substantive (the trailing clauses are new info).
- `addWorkingHours(from, hours)`: 08:00–20:00 Europe/London window,
  DST-safe via `Intl.DateTimeFormat`; time outside the window rolls to next
  morning.

### Recording & sweep
- `recordOutboundCommitment({conversationId, body})`: on a sent outbound
  carrying a promise, writes `metadata.openCommitment = {madeAt, dueAt,
  summary}` with `dueAt = madeAt + 4 working hours`
  (`COMMITMENT_DUE_WORKING_HOURS = 4`). An **existing** commitment is kept —
  re-promising does not reset the clock (that IS the incident). jsonb merge
  write (`coalesce(metadata,'{}'::jsonb) || …`) so concurrent metadata
  writers aren't clobbered.
- Wired into comms.ts strictly inside `if (sent.ok)` after `autosent = true`
  — a promise that never reached the customer is not a debt. Failures are
  caught and logged; they never break a send.
- `flagOverdueCommitments()`: sweep following the callback_due pattern
  (comms-sweep.ts fallbackOverdueCallbacks). Finds
  `metadata->'openCommitment'->>'dueAt' <= now`; if fulfilment happened since
  (quote-link outbound or human outbound) it clears silently; otherwise flags
  Ben **once** (needs_ben dedupe + `lastCommitmentFlagged` in metadata) and
  clears the commitment. Cap 3 actions/pass; thrown errors leave state for
  retry.

### Exact comms-sweep.ts wiring (the ONE permitted edit, end-of-task)

`server/agents/comms-sweep.ts:391` (inside the `fast` tick `Promise.all`,
after `fallbackOverdueCallbacks()`; line number is post-Agent-A-merge):

```ts
// 27 Aug 2026 (James): sent promises get a 4-working-hour timer; overdue ones flag Ben once.
import('./promise-tracker').then((m) => m.flagOverdueCommitments()).catch((e) => console.error('[CommsSweep] overdue-commitment sweep failed:', e?.message ?? e)),
```

Dynamic import avoids a static comms-sweep → promise-tracker → comms import
tangle; the file was re-read immediately before editing and Agent A's
surrounding code was untouched.

## Agent B handoff items (done in comms.ts, per their DONE file)

1. **ESCALATE_CODES**: added `'duration_claim', 'policy_commitment'`
   (~line 493 region) with incident-dated comment — these violations now
   queue for review instead of silently rewriting.
2. **VISITS ARE NEVER FREE reword**: the SYSTEM prompt block no longer
   instructs the model to write the exact sentence the new
   `policy_commitment` guard refuses. It now embeds the canonical
   `VISIT_TERMS_RAIL` constant imported from `objection-levers.ts`; the DO
   example is now "This one needs eyes on it to price properly. It'd be a
   paid survey visit. I'll come back to you with the details." and "The fee
   comes off the job if you go ahead." was added to the DON'T list.
3. **Belt-and-braces rail** (optional item, done): `neverSendDirectReason`
   now also calls `detectDurationClaim` / `detectPolicyCommitment` from
   `draft-guards.ts` and returns distinct reasons.

## Test coverage map (56 assertions)

1. Detection family, pure: incident phrasings verbatim, house promise
   family, substantive bodies pass through (incl. the comma-clause case).
2. `addWorkingHours` arithmetic incl. evening rollover (BST-aware).
3. `maySendDirect` trust gate: held reason names trust_concern, not an
   hours reason; outranks the reactive 2am lane; guard-failure precedence.
4. `threadHasTrustConcern` fresh-read: untagged→false, tag added
   mid-run→true, missing conversation→false.
5. `assessRepeatHolding` + flag dedupe: no outbound→allowed; incident shape
   (holding → chase → holding)→repeat with correct `waitingOn`/`since`;
   exactly one `needs_ben` tag and one `agentQuestions` row; Ben's own
   "Bear with me" in the burst→not repeat; substantive outbound resets.
6. `recordOutboundCommitment`: dueAt = madeAt + 4 working hours; re-promise
   does NOT reset the clock; non-promise body records nothing.
7. `flagOverdueCommitments`: overdue flags Ben once, clears commitment,
   writes `lastCommitmentFlagged`; fulfilled-via-quote-link clears silently;
   second sweep does not re-flag.

## Residual gaps (known, out of my file boundary)

- **Morning-release / Ben-approved sends don't record commitments**: sends
  that leave via `server/message-drafts.ts` or comms-sweep release paths
  (Agent A's files) bypass `recordOutboundCommitment`. If a *held* draft
  containing a promise is later approved and sent, no timer starts. Fix is
  one call in the shared send path — Agent A's territory.
  **CLOSED post-merge (coordinator)**: `approveAndSendDraft` now records
  commitments for non-`comms_agent` approvers (mirrors the beta-ping
  exclusion so agent autosends are not double-booked); both suites re-run
  green after the change.
- **Archived suites**: `scripts/archive/_adversarial-test.ts`,
  `_full-flow-demo.ts`, `_pipeline-e2e-test.ts` call `maySendDirect`
  without `trustConcern`. `scripts/archive/` is excluded from tsconfig so
  tsc passes, but they need updating if revived.
- Two pre-existing corrupted script files fail tsc (listed above) —
  untouched, not mine.
