# Brief B — onEvent hook in runner.ts → stream live agent runs into the thread panel

You are **Agent B**. Agents A and C work in this SAME checkout in other panes. Obey the
file-ownership rules to avoid edit collisions.

## Goal
Stream comms agent runs live to the admin UI: when `runCommsAgent()` executes, the operator
viewing that conversation in CommsPage sees progressive activity ("checking thread…",
"verifying date…", "drafting reply…") instead of the draft just appearing.

## Dependency on Agent A
Agent A is creating `server/comms-events.ts` (an in-process event bus) as its FIRST action,
plus an SSE endpoint `GET /api/comms/events` and a client hook
`client/src/hooks/useCommsEvents.ts`. The bus contract (already agreed) includes:

```ts
| { type: 'run_started'; runId: string; conversationId: string; at: string }
| { type: 'run_event'; runId: string; conversationId: string; event: unknown; at: string }
| { type: 'run_finished'; runId: string; conversationId: string; ok: boolean; at: string }
```

Rules:
- **Never create or edit** `server/comms-events.ts`, the SSE route, or `useCommsEvents.ts` —
  Agent A owns them. If `server/comms-events.ts` does not exist yet, start with the parts of
  this brief that don't need it (runner.ts, LiveRunPanel) and re-check for it periodically.
- Read `docs/AGUI_SSE_BRIEF_A.md` for the full contract.

## File ownership (strict)
- **You own:** `server/agents/runner.ts`, the run-wiring inside `runCommsAgent()` in
  `server/agents/comms.ts` (~line 524), and new component
  `client/src/components/comms/LiveRunPanel.tsx`.
- **Agent A owns:** everything listed above plus the polling changes in `CommsPage.tsx`.
- You may make **one minimal insertion** into `client/src/pages/admin/CommsPage.tsx`
  (rendering `<LiveRunPanel conversationId={...} />` in the thread panel). Do this edit
  **LAST**, after your component compiles, to minimise collision with Agent A's edits there.

## Server work
1. `server/agents/runner.ts` (`runAgent()` ~line 66):
   - Add optional `onEvent?: (evt: AgentTranscriptEvent) => void` to the options.
   - Invoke it at the same points transcript events are appended (assistant text, tool_call,
     tool_result, done). Wrap calls in try/catch — a listener error must never break a run.
   - Purely additive: all existing callers work unchanged.
2. `server/agents/comms.ts` (`runCommsAgent()` ~524):
   - Generate a `runId` (crypto.randomUUID).
   - Emit `run_started` before the run, `run_event` per transcript event (pass the event
     through as `event`), `run_finished` (ok true/false) in a finally block — all via
     `emitCommsEvent` from `server/comms-events.ts`.
   - Keep payloads lean: for tool calls include tool name + a short summary, not full args
     if they're huge (e.g. truncate strings > 500 chars).

## Client work
`client/src/components/comms/LiveRunPanel.tsx`:
- Props: `conversationId: string`.
- Subscribe to the shared event stream (via Agent A's `useCommsEvents` hook if it exposes a
  subscriber API; otherwise open your own `EventSource('/api/comms/events')` inside this
  component — acceptable fallback, note it in your DONE doc).
- Filter events to this `conversationId`. On `run_started` show an activity strip; render
  each `run_event` as a compact line (map tool names to friendly labels: `get_thread` →
  "Reading thread", `check_date` → "Checking calendar", `queue_draft` → "Drafting reply",
  `flag_for_ben` → "Escalating", etc.). On `run_finished` show a brief done state then
  auto-clear after a few seconds.
- Renders nothing when no run is active. Keep styling consistent with existing Tailwind/
  shadcn usage in CommsPage.

## Verification
- Typecheck server + client.
- Trigger a run against a test conversation (see `scripts/_post-call-continuation-test.ts` /
  other `scripts/_test-*.ts` for patterns, or call `runCommsAgent` directly from a scratch
  script named `scripts/_test-live-run-events.ts`).
- Confirm events arrive on `/api/comms/events` (curl -N) and the panel renders them.

## Done criteria
Write `docs/AGUI_SSE_B_DONE.md`: what changed, files touched, event payload shapes, how you
verified, any deviations. Do NOT commit.
