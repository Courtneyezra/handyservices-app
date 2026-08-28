# Guardrail Task — Agent C: Autonomy & Follow-Through

You are one of three agents working IN PARALLEL in this same checkout. Stay inside your file
boundary. Do NOT git commit anything — leave changes in the working tree.

**Your files**: `server/agents/comms.ts` (you own it), new file
`server/agents/promise-tracker.ts`, plus new test scripts in `scripts/`.
**Do NOT edit**: `server/message-drafts.ts`, `server/agents/comms-sweep.ts` (Agent A owns them —
EXCEPTION: you may add the single wiring call for C3 into comms-sweep.ts at the very END of your
work; re-read the file immediately before that edit because Agent A is changing it), and
`server/agents/draft-guards.ts` / `server/agents/objection-levers.ts` (Agent B owns them).

## Context

The comms agent triages inbound WhatsApp/SMS and can auto-send replies when `maySendDirect()`
(`server/agents/comms.ts:302-337`) passes: autosend config enabled, guard chain passed, not in a
never-send-direct family, inside hours or reactive window. On 27 Aug 2026, conversation
`b57b6790401ff28a3db04d58ff1e366f` (+447950552830, "James", £992 bathroom floor quote) exposed
three autonomy failures:

1. **Trust concern did not reduce autonomy** (11:34): James said his uncle "doesn't understand
   AI and phones and WhatsApp and stuff he thinks he's being taken advantage of". The thread got
   the `trust_concern` tag — and the agent KEPT AUTO-SENDING, including a policy claim about
   paid survey terms. When a customer signals distrust of the automated channel, a human should
   review every outbound before it goes.

2. **Stall loop with no escalation**: 26 Aug 17:11 the agent auto-sent "I'll get this priced up
   properly and sent over to you as soon as it's ready." Nothing happened for ~18 hours until
   the customer chased ("How long does it usually take to price up"), and the agent's response
   to its own SLA breach was ANOTHER holding reply ("I'll get it priced up and sent over to you
   as soon as it's ready"). A holding reply repeated is a stall loop; the second trigger should
   escalate to Ben, not re-stall the customer.

3. **Untracked follow-up promises**: 11:38 "I'll get a patch only version sorted... Let me check
   what we can set up and come back to you" and 11:45 "I'll come straight back to you with both
   as soon as I've got them." Two open commitments (patch-only quote, survey visit terms) with
   no timer. If Ben doesn't act, failure 2 repeats.

Read `server/agents/comms.ts` thoroughly first — especially `maySendDirect` (302-337),
`flagThreadForBen` / `routeRefusalsToBen` (375-453), the tool definitions, and how thread
tags/metadata are read and written (fresh-read CAS pattern for tags around line 739-741). Also
read `server/agents/comms-sweep.ts` to understand sweep structure (do not edit it yet), and the
`callback_due` / `callbackDueAt` pattern (comms-sweep.ts:261-317) which C3 should imitate.

## Deliverables

### C1. Trust-concern autonomy downgrade
When the conversation has the `trust_concern` tag, `maySendDirect` must return false (with a
distinct reason recorded, matching how other gate failures are logged) so drafts queue as
`pending` for human approval instead of auto-sending. Pass whatever thread data is needed into
`maySendDirect` — extend its options type; you own this file. Cover: tag present at run start
AND tag added during the same run (the agent can add_tags mid-run — check order of operations).

### C2. Holding-reply limiter
A "holding reply" = a draft that promises future action without new substance ("I'll come back
to you", "as soon as it's ready", "I'll get it sent over", "sorting it now", "let me check and
come back") and contains no quote link, no question to the customer, and no new information.
Implement detection (heuristic function in comms.ts or promise-tracker.ts, well-tested) and the
rule: if the LAST outbound message in the thread was already a holding reply and nothing material
has changed (no quote sent since, no Ben manual message since), then a new holding draft must NOT
auto-send — queue it pending AND `flagThreadForBen` with a note naming the breached expectation
("second holding reply attempted; customer still waiting on X since <time>"). One flag per
conversation while needs_ben is set (respect the existing flag dedupe).

### C3. Promise tracker (new file `server/agents/promise-tracker.ts`)
- On a sent outbound containing a follow-up commitment (same detection family as C2: "I'll come
  back to you with X", "I'll get X sorted/sent", "checking and coming back"), write conversation
  `metadata.openCommitment = { madeAt, dueAt, summary }` — dueAt = 4 working hours later
  (08:00-20:00 UK window, roll into next morning if it lands outside).
- A sweep function `flagOverdueCommitments()` that finds conversations where
  `metadata.openCommitment.dueAt` is past and no fulfilment has happened since `madeAt`
  (fulfilment = an outbound containing a quote link, or a manual/human outbound, or metadata
  cleared), flags Ben with the summary, and clears/marks the commitment so it doesn't re-flag
  every sweep. Follow the `callback_due` fallback pattern (comms-sweep.ts:261-317).
- Wiring: hook commitment-recording into the comms agent's post-send path in comms.ts (you own
  it). For the sweep: at the END of your work, add one call to `flagOverdueCommitments()` in
  comms-sweep.ts's sweep loop — re-read that file right before editing since Agent A is
  modifying it concurrently; keep the edit to the minimum lines possible.

## Quality bar
- Match the codebase's rationale-heavy, incident-dated comment style ("27 Aug 2026: James
  conversation...").
- Tests in `scripts/_test-autonomy-guards.ts` (read existing `scripts/_test-*.ts` files first
  for style and test-isolation patterns like COMMS_CONFIG_OVERRIDE). Cover: trust_concern blocks
  direct send; first holding reply allowed; second consecutive holding reply blocked + flagged;
  commitment recorded on promise; overdue commitment flags Ben once. Use the Ofcom test range
  +447700900xxx, never real numbers.
- `npm run check` must pass (tsc). Run your tests and make them pass.

## When finished
Write a summary (changes, detection heuristics, test results, exact comms-sweep.ts wiring line)
to `docs/GUARDRAIL_TASK_AGENT_C_DONE.md`. That file is your completion signal.
