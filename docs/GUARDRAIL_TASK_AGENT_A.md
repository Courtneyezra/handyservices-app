# Guardrail Task — Agent A: Send-Path Integrity

You are one of three agents working IN PARALLEL in this same checkout. Stay inside your file
boundary. Do NOT git commit anything — leave changes in the working tree.

**Your files**: `server/message-drafts.ts`, `server/agents/comms-sweep.ts` (you own these),
plus new test scripts in `scripts/`.
**Do NOT edit**: `server/agents/draft-guards.ts`, `server/agents/objection-levers.ts` (Agent B
owns them), `server/agents/comms.ts`, `server/agents/promise-tracker.ts` (Agent C owns them).

## Context

The comms agent auto-sends WhatsApp/SMS drafts to customers. On 27 Aug 2026, conversation
`b57b6790401ff28a3db04d58ff1e366f` (phone +447950552830, customer "James") exposed a triple-send
incident. Customer asked "How long does it usually take to price up" at 11:05:09 and received
THREE overlapping auto-sent replies:

- 11:05:40 `draft_1787828740067_8psvp5` reason `[answer_question] placeholder` — body "Hiya
  James, sorry for the wait on this one."
- 11:05:52 `draft_1787828752181_kqewnw` reason `[answer_question] Customer asked how long...` —
  3-part burst STARTING WITH THE IDENTICAL SENTENCE "Hiya James, sorry for the wait on this one."
- 11:06:17 `draft_1787828777738_xuu6cv` reason `[unlabelled] undefined` — "Hiya James, thanks
  for your patience on this one."

The customer got "sorry for the wait on this one" twice in 15 seconds, then a third redundant
message. All three were `approved_by = comms_agent:autosend`.

The triage lease (`tickDueTriage` in `server/agents/comms-sweep.ts:115-149`,
`MIN_MINUTES_BETWEEN_RUNS = 5`) should have prevented three agent runs in 40 seconds. It did not
— likely a race between the sweep-triggered triage and the on-inbound triage path (see the arm
function in `server/agents/comms-lanes.ts`, which writes `metadata.nextTriageAt` on inbound). You
may READ comms-lanes.ts and comms.ts to diagnose, but make your fixes in your owned files where
possible (if the true fix requires a small change in comms-lanes.ts, that file is unclaimed —
you may edit it, but keep the change minimal).

Repro script for the data: `scripts/_query-comms-debug-7950552830.ts`.

## Deliverables

### A1. Diagnose and fix the triple-run race
Work out how three agent runs fired within 40s despite the 5-minute lease. Fix the claim so it is
an atomic compare-and-set that a concurrent run cannot slip past (the codebase already uses CAS
claims elsewhere — see `approveAndSendDraft`'s `WHERE status='pending'` claim at
`server/message-drafts.ts:229-232` for the house style). Document root cause in a comment at the
fix site, following the codebase's rationale-comment style.

### A2. Recent-outbound near-duplicate guard
In `approveAndSendDraft` (server/message-drafts.ts:224-463), BEFORE the send: compare the draft
body against outbound `messages` rows for the same conversation from the last 10 minutes.
- Normalize (lowercase, strip punctuation/whitespace) and compare per burst part (split on `---`).
- If any part is a near-duplicate (exact normalized match, or high similarity — a simple token
  overlap ratio >= 0.9 is fine; no new dependencies) of a recently sent outbound message:
  - If the approver is an automated path (`approvedBy` starts with `comms_agent:`,
    `hours_gate:`, `first_contact_ack:`): do NOT send. Revert draft to `pending` with a note
    appended to `reason` (pattern: the OUTSIDE_WINDOW revert at message-drafts.ts:257-269), so a
    human can decide.
  - If the approver is a human (an email), allow the send (they can see the thread).
- Record the block in the ledger (`recordDraftVerdict`) consistently with how other refusals are
  recorded.

### A3. Malformed-run autosend guard
A draft whose `reason` is empty, `undefined`, `"placeholder"`, contains `[unlabelled]`, or
matches `/\b(placeholder|undefined|null)\b/i` after the `[...]` tag indicates a malformed agent
run. These must NEVER auto-send: in `approveAndSendDraft`, when the approver is an automated path
and the reason is malformed, revert to `pending` for human review (same pattern as A2). Human
approvals still go through.

## Quality bar
- Match the existing comment style (rationale-heavy, incident-dated: "27 Aug 2026 triple-send").
- Add a test script `scripts/_test-send-path-guards.ts` (follow the style of existing
  `scripts/_test-*.ts` files) covering: near-dup blocked for autosend, near-dup allowed for
  human, malformed reason blocked for autosend, clean draft sends. Use COMMS_CONFIG_OVERRIDE /
  test isolation patterns if the existing test scripts do (read `scripts/_test-quote-send.ts`
  and `scripts/_test-quoteprep-guard.ts` first). Do NOT send to real numbers — use the Ofcom
  test range +447700900xxx.
- `npm run check` must pass (tsc). Run your test script and make it pass.

## When finished
Write a summary of what you changed (files, root cause of the race, test results) to
`docs/GUARDRAIL_TASK_AGENT_A_DONE.md`. That file is your completion signal.
