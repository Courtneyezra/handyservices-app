# Brief B — DONE: live agent runs streamed into the thread panel

Agent B, 29 Aug 2026. Not committed (per brief).

## What changed

When `runCommsAgent()` executes, every transcript step is now mirrored onto Agent A's comms
event bus (`server/comms-events.ts`) as `run_started` / `run_event` / `run_finished`, and a new
`LiveRunPanel` in the CommsPage thread panel renders the run live: "Reading thread…",
"Updating board…", "Drafting reply…" with per-step spinners, a done/failed state, then
auto-clear after 4s.

## Files touched (ownership respected)

- **`server/agents/runner.ts`** — added optional `onEvent?: (evt: AgentTranscriptEvent) => void`
  to `runAgent()` opts. Invoked inside the existing `log()` helper, which is the single place
  every transcript event is appended (assistant_text, tool_call, tool_result, tool_error, done,
  turn_cap, truncated), so all points are covered with one wiring. Wrapped in try/catch — a
  listener error logs a warning and never breaks the run. Purely additive; all existing callers
  unchanged.
- **`server/agents/comms.ts`** — run-wiring in `runCommsAgent()` (~line 585 now):
  - `runId = randomUUID()`; local `emit()` wrapper so `emitCommsEvent` can never throw into the run.
  - `run_started` before `runAgent`, `run_event` per transcript event via `onEvent`,
    `run_finished` (ok true/false) in a `finally` around the `runAgent` call.
  - New module-level `leanTranscriptEvent()` shrinks payloads for the wire: tool name kept,
    every string recursively truncated at 500 chars, arrays capped at 20, depth capped, circular
    guard. The full untruncated event still goes into the run transcript as before.
  - Two import lines added (`node:crypto`, `../comms-events`). The follow-up
    `quote_prep_gaps` recursion gets its own runId naturally (it re-enters `runCommsAgent`).
- **`client/src/components/comms/LiveRunPanel.tsx`** (new) — props `{ conversationId: string }`.
  Filters run_* events to this conversation; `run_started` opens the activity strip; each
  `run_event` becomes a compact line (tool_call → friendly label with spinner, tool_result
  settles the matching pending line to a check, tool_error → red line, assistant_text → italic
  120-char snippet; done/turn_cap ignored — `run_finished` carries the outcome). Joining
  mid-run (panel mounted after `run_started`) still tracks. Renders nothing when idle; Tailwind
  styling matches the existing comms components (slate/emerald/red palette, lucide icons).
- **`client/src/pages/admin/CommsPage.tsx`** — done LAST, per brief: one import line + one
  insertion in `ThreadPanel`, directly under the message scroll area and above the quote-prep /
  drafts blocks: a `border-t px-3 py-2 empty:hidden` wrapper around
  `<LiveRunPanel conversationId={card.id} />` (`empty:hidden` collapses the wrapper while the
  panel renders null). Nothing else in the file touched; Agent A's polling changes were already
  in place and were left alone.
- **`scripts/_test-live-run-events.ts`** (new) — the verification script below.

Not touched: `server/comms-events.ts`, `server/comms-events-route.ts`,
`client/src/hooks/useCommsEvents.ts` (all Agent A's; consumed only).

## Event payload shapes

Bus events exactly per the agreed contract:

```ts
{ type: 'run_started';  runId: string; conversationId: string; at: string }
{ type: 'run_event';    runId: string; conversationId: string; event: unknown; at: string }
{ type: 'run_finished'; runId: string; conversationId: string; ok: boolean; at: string }
```

The `event` payload (`leanTranscriptEvent` output) is:

```ts
// tool_call / tool_result / tool_error
{ at: string; type: 'tool_call';   tool: string; input: <truncated> }
{ at: string; type: 'tool_result'; tool: string; result: <truncated> }
{ at: string; type: 'tool_error';  tool: string; error: <truncated> }
// everything else (assistant_text, done, turn_cap, truncated)
{ at: string; type: string; detail: <truncated> }   // assistant_text → detail.text
```

`<truncated>` = strings capped at 500 chars (+ `… [truncated]`), arrays at 20 items, depth 6.

## How verified

- `npx tsc --noEmit` — zero errors in any touched file (repo has pre-existing errors in
  unrelated `scripts/scrape-reddit-*` / `seed-diy-*` files, untouched).
- `npx tsx scripts/_test-live-run-events.ts` — full integration run on an Ofcom drama number
  (+447700900940): creates a conversation + one inbound WhatsApp message, subscribes
  `onCommsEvent`, calls `runCommsAgent` for real (one Claude call, 3 turns), asserts, then
  deletes everything it wrote. Isolation: `COMMS_CONFIG_OVERRIDE` forces autosend /
  first-contact ack / quote-prep / VA call tasks OFF and `PUSHOVER_APP_TOKEN` is deleted so no
  push fires. **All 9 checks PASS**: exactly one `run_started`; 8 `run_event`s; one
  `run_finished ok=true`; one shared runId across run_* events; ordering (started first,
  finished last); first streamed tool_call is `get_thread`; longest string in any lean payload
  254 chars (≤ 520); nothing sent. Agent A's `board_delta` correctly interleaved on the same
  bus mid-run (from the `set_board_state` emit-point) — the script accounts for it.
- SSE wire: with the dev server running on :5001, `curl -sN` against
  `/api/comms/events` with a valid admin Bearer token returns `: connected\n\n` and holds the
  stream open. (Run events could not be curled end-to-end because the bus is in-process and no
  HTTP route triggers `runCommsAgent` — a scripted run emits on the script's bus, not the
  server's. The bus-level test above plus Agent A's verified bus→SSE bridge covers the chain.)
- Panel render: not exercised against a live in-server run for the same in-process reason;
  component typechecks and consumes the exact shapes the integration test proved on the wire
  format.

## Deviations from the brief

- **LiveRunPanel uses Agent A's `useCommsEvents(onEvent)` subscriber seam**, not its own
  `EventSource`. The brief allowed an own-EventSource fallback and the first version did that,
  but A's hook landed mid-task exposing the subscriber API — and critically it handles the
  `?token=` auth (a bare `EventSource('/api/comms/events')` would 401 against `requireAdmin`).
  Switched before the CommsPage insertion; one shared connection, no double-refetch (the hook's
  invalidation-owner logic handles multiple mounts).
- `onEvent` wired once inside the runner's `log()` rather than at each call site — same
  coverage (log() IS the transcript append point), less duplication.
- `run_event` also forwards `tool_error` / `turn_cap` / `truncated` events (the brief listed
  the main four); the panel maps tool_error to a visible "hit a snag" line and ignores the rest.
