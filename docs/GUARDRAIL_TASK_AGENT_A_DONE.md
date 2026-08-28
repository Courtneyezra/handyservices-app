# Agent A — DONE (27 Aug 2026)

Brief: `docs/GUARDRAIL_TASK_AGENT_A.md`. Incident: triple-send on conversation
`b57b6790401ff28a3db04d58ff1e366f` (+447950552830, "James") — three overlapping auto-sent
replies at 11:05:40, 11:05:52 and 11:06:17, two opening with the identical sentence, all
approved_by `comms_agent:autosend`.

## Root cause (A1)

Three agent runs fired inside 40 seconds because **each trigger path guarded itself on its own
metadata key and nothing excluded one path (or process) from another**:

- `sweepOnce()` checked `lastAutoTriageAt` and then stamped it in a **second** statement — a
  check-then-act race two concurrent passes both win.
- `tickDueTriage()` leased `nextTriageAt` with a real CAS, but that lease is invisible to
  `sweepOnce` and to every other `runCommsAgent` entry point.
- The guards were per-process in effect only by luck: the production deployment's logs for the
  incident window (Railway, deployment `0759420a`, filter "CommsSweep", 11:04:30–11:06:45) show
  its ticker starting only the **third** run (`lease 2026-08-27T11:09:56.017Z` at 11:05:56 →
  the 11:06:17 send). The first two runs arrived through other paths/processes — dev checkouts
  run this same code against the production Neon database.

## Fix (A1) — `server/agents/comms-sweep.ts`

- New `claimTriageTurn(conversationId)` / `releaseTriageTurn(conversationId, token)`: **one
  shared atomic run claim** on `conversations.metadata.triageHeldUntil`, a single
  `UPDATE ... WHERE hold is absent-or-expired ... RETURNING id` — the same CAS shape as
  `approveAndSendDraft`'s `WHERE status='pending'` claim. Concurrent claimers serialize on the
  row lock; losers match zero rows. The 5-minute hold doubles as the in-flight mutex **and** the
  between-runs floor, and self-expires so a crashed run costs minutes, never a wedge. Full
  root-cause comment lives on `claimTriageTurn`.
- `sweepOnce()` must now win the claim before running (the advisory checks stay, the claim
  decides).
- `tickDueTriage()` wins the shared claim **before** its `nextTriageAt` lease; a lost turn
  leaves `nextTriageAt` due (15s tick retries once the floor expires — delayed, never lost); a
  lost lease after a won turn hands the turn back via `releaseTriageTurn`.

## Fix (A2 + A3) — `server/message-drafts.ts`

Two autosend-only guards at the queue exit in `approveAndSendDraft`, after the opt-out re-check
(every automated send passes through here, whichever path produced the draft). Automated
approvers (`comms_agent:` / `hours_gate:` / `first_contact_ack:`) are blocked; a human approver
passes through with the override logged.

- **A2 near-duplicate guard**: draft body compared per burst part (split on `---`) against all
  outbound messages in the same conversation from the last 10 minutes — exact normalized match
  (lowercase, punctuation stripped) or token-overlap ≥ 0.9. Blocked drafts revert to `pending`
  (the OUTSIDE_WINDOW pattern) with `[near_duplicate_hold]` appended to `reason` (once), the
  refusal recorded in the outcome ledger as `blocked`, and a `hold` system event logged. New
  return code `NEAR_DUPLICATE`.
- **A3 malformed-reason guard**: reason empty/missing, `[unlabelled]`, or a
  placeholder/undefined/null stub after the `[intent]` tag never auto-sends — same revert with
  `[malformed_reason_hold]`, ledger `blocked`, return code `MALFORMED_REASON`. (Draft 1 of the
  incident carried `[answer_question] placeholder`, draft 3 `[unlabelled] undefined`.)
- `releaseMorningHolds()` and `releaseHeldAcks()` in comms-sweep.ts now skip drafts carrying
  either hold marker, so a guard-held draft cannot re-enter the 15-second release loop — it
  waits for a person.

## Files changed

- `server/agents/comms-sweep.ts` — `claimTriageTurn`/`releaseTriageTurn` + wiring into
  `sweepOnce`, `tickDueTriage`, `releaseMorningHolds`, `releaseHeldAcks`.
- `server/message-drafts.ts` — guard helpers (`isMalformedAgentReason`, `isNearDuplicateText`,
  hold markers) + the two guards inside `approveAndSendDraft`; return union gains
  `NEAR_DUPLICATE` | `MALFORMED_REASON` (fits the existing `!sent.ok` handling in comms.ts).
- `scripts/_test-send-path-guards.ts` — new test script (below).
- No files owned by Agent B or Agent C were touched. Not committed, per the brief.

## Test results

`npx tsx scripts/_test-send-path-guards.ts` — **28 passed, 0 failed** (Ofcom fixtures
+447700900950, all cleaned up):

- Unit: malformed-reason cases (incident reasons, empty/null, bare tag, real reason negative);
  near-dup exact-after-normalize, 0.9-overlap, distinct-negative.
- Near-dup guard: exact repeat blocked for autosend → draft reverted pending, approval cleared,
  marker appended; second trip blocked with reason NOT growing; burst-part repeat blocked;
  0.9-overlap variant blocked; 30-min-old outbound does NOT block; human approver passes.
- Malformed-reason guard: blocked for all three automated approver prefixes; held pending with
  marker; human approver passes.
- Clean draft: passes both guards (Twilio then rejects the Ofcom range with 21211 → honest
  `SEND_FAILED`, which is the acceptable non-guard outcome per the brief).
- `claimTriageTurn`: exactly 1 winner of 5 concurrent claims; re-claim refused while held;
  wrong-token release is a no-op; right-token release frees the turn.

`npm run check` (tsc): **zero errors in every file this task touched** and in server/shared/
client generally. The only failures are `scripts/seed-diy-advice.ts` and
`scripts/scrape-reddit-value-drivers.ts` — both tracked, unmodified, committed long before this
task (cc574b9), i.e. `tsc` already failed on them on main. Out of Agent A's file boundary, left
alone.
