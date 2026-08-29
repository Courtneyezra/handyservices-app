# Brief A — Comms SSE event bus + STATE_DELTA board/draft events (drop CommsPage polls)

You are **Agent A**. Agents B and C work in this SAME checkout in other panes. Obey the
file-ownership rules below to avoid edit collisions.

## Goal
Replace CommsPage's two aggressive polls (board every 30s, drafts every 15s) with a
server-push SSE channel that emits STATE_DELTA-style events whenever comms state changes.
The stream is a *view* over DB state, never the source of truth: on connect/reconnect the
client refetches a snapshot, then applies deltas by cache invalidation.

## File ownership (strict)
- **You own:** `server/comms-events.ts` (new), the SSE route, emit-point edits in
  `server/message-drafts.ts`, `server/agents/comms-lanes.ts`, `server/agents/sla-sweep.ts`,
  the `set_board_state` tool in `server/agents/comms.ts`, new hook
  `client/src/hooks/useCommsEvents.ts`, and the polling changes in
  `client/src/pages/admin/CommsPage.tsx`.
- **Agent B owns:** `server/agents/runner.ts`, the run-wiring in `runCommsAgent()` in
  `server/agents/comms.ts` (line ~524), and a new `LiveRunPanel` component. Do not touch those.
- **Do this FIRST:** create `server/comms-events.ts` exactly per the contract below and save
  it before anything else — Agent B builds against it.

## Shared bus contract (create verbatim, extend only additively)
```ts
// server/comms-events.ts
import { EventEmitter } from 'node:events';

export type CommsEvent =
  | { type: 'board_delta'; conversationId: string; reason: 'inbound' | 'outbound' | 'stage' | 'tags' | 'priority' | 'sla' | 'other'; at: string }
  | { type: 'draft_delta'; draftId: number | string; conversationId?: string; status: 'pending' | 'approved' | 'sent' | 'rejected' | 'blocked' | 'edited'; at: string }
  | { type: 'run_started'; runId: string; conversationId: string; at: string }
  | { type: 'run_event'; runId: string; conversationId: string; event: unknown; at: string }
  | { type: 'run_finished'; runId: string; conversationId: string; ok: boolean; at: string };

const bus = new EventEmitter();
bus.setMaxListeners(100);

export function emitCommsEvent(evt: CommsEvent): void {
  bus.emit('comms', evt);
}

export function onCommsEvent(cb: (evt: CommsEvent) => void): () => void {
  bus.on('comms', cb);
  return () => bus.off('comms', cb);
}
```
The `run_*` event types are reserved for Agent B — define them, do not emit them.

## SSE endpoint
`GET /api/comms/events`:
- Same auth/middleware as `GET /api/drafts` (check how that route is protected and match it).
- Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`;
  flush headers immediately.
- Serialize each `CommsEvent` as `data: <json>\n\n`. Heartbeat comment (`: ping\n\n`) every 25s.
- Unsubscribe + clear heartbeat on `req.close`.
- Register it wherever the drafts routes are registered so it sits BEFORE the SPA catch-all.

## Emit points (verify exact lines before editing — line refs are approximate)
- `server/message-drafts.ts`:
  - `queueDraft()` (~58) → `draft_delta` status `pending`.
  - PATCH edit route (~217) → `draft_delta` status `edited`.
  - approve/send path (~623) → `draft_delta` (`approved`/`sent`/`blocked` as applicable) and
    `board_delta` reason `outbound` on successful send.
  - reject route → `draft_delta` status `rejected`.
- `server/agents/comms.ts` `set_board_state` tool (~596-996 region) → `board_delta` with the
  matching reason (`stage`/`tags`/`priority`).
- `server/agents/comms-lanes.ts` `scheduleInboundTriage()` (~44) → `board_delta` reason `inbound`.
- `server/agents/sla-sweep.ts` SLA breach handling → `board_delta` reason `sla` (skip if invasive).

Emits must be fire-and-forget and never throw into business logic (wrap in try/catch).

## Client
- New `client/src/hooks/useCommsEvents.ts`:
  - `EventSource('/api/comms/events')` with reconnect backoff (EventSource auto-reconnects;
    add jittered manual retry on `error` if it closes permanently).
  - On `board_delta` → `queryClient.invalidateQueries` for the board query key used at
    CommsPage.tsx ~1698. On `draft_delta` → invalidate the drafts query (~1076).
  - On open/reopen → invalidate both (snapshot refresh after any gap).
  - Optional: expose the raw event stream via a subscriber registry so other consumers
    (Agent B's LiveRunPanel) can `useCommsEvents(onEvent)` — keep one shared EventSource.
- `client/src/pages/admin/CommsPage.tsx`:
  - Remove `refetchInterval: 30_000` (board) and `refetchInterval: 15_000` (drafts).
  - Replace with `refetchInterval: 300_000` as a resilience fallback.
  - Mount the hook once near the top of the page component.
  - Touch nothing else in this file (Agent B will make one small thread-panel insertion later).

## Verification
- Typecheck server + client (use whatever the repo uses — `npx tsc --noEmit` or build).
- Start dev server; `curl -N http://localhost:<port>/api/comms/events` (with auth) and trigger
  a draft via existing scripts (e.g. `scripts/_test-quote-send.ts` style) to see events flow.
- Confirm CommsPage still renders and updates when a draft is queued.

## Done criteria
Write `docs/AGUI_SSE_A_DONE.md`: what changed, files touched, event types emitted and from
where, how you verified, any deviations from this brief. Do NOT commit.
