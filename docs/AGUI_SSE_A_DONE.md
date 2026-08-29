# Brief A — DONE: Comms SSE event bus + STATE_DELTA events (polls dropped)

Agent A, 29 Aug 2026. Implements `docs/AGUI_SSE_BRIEF_A.md`. Not committed.

## What changed

CommsPage no longer polls aggressively (board 30s / thread+drafts 15s). An in-process event
bus (`server/comms-events.ts`) now emits STATE_DELTA-style events at every comms choke point;
`GET /api/comms/events` streams them over SSE; a client hook maps each event to a React Query
cache invalidation. The stream is a view only — on connect/reconnect the client refetches a
snapshot, and both queries keep a 5-minute `refetchInterval` as a resilience fallback.

## Files touched

| File | Change |
|---|---|
| `server/comms-events.ts` | **NEW.** The shared bus, created FIRST, verbatim per the brief contract. `run_*` types defined for Agent B, never emitted here. |
| `server/comms-events-route.ts` | **NEW.** SSE route `GET /api/comms/events`: `?token=` shim → the same `requireAdmin` as `/api/drafts` → event-stream headers, `flushHeaders()`, `data: <json>\n\n` frames, `: ping` heartbeat every 25s, unsubscribe + clear heartbeat on `req.close`. |
| `server/index.ts` | Import + `app.use(commsEventsRouter)` registered immediately ABOVE the `/api/comms` mount (whose mount-level header-only `requireAdmin` would otherwise 401 the query-token request), well before the SPA catch-all. |
| `server/message-drafts.ts` | `pushCommsEvent` try/catch helper + emit points (below). |
| `server/agents/comms.ts` | One edit only, inside the `set_board_state` tool's `run()`: `board_delta` after the DB write. Dynamic import so the shared import block stays untouched for Agent B's concurrent edits. `runCommsAgent()` untouched. |
| `server/agents/comms-lanes.ts` | `scheduleInboundTriage()` emits `board_delta` reason `inbound` (lazy import, swallowed errors — hot webhook path). |
| `server/agents/sla-sweep.ts` | `emitSlaBoardDelta()` helper; emits `board_delta` reason `sla` on first breach alert and on daily reminders. |
| `client/src/hooks/useCommsEvents.ts` | **NEW.** Shared single `EventSource` + subscriber registry (details below). |
| `client/src/pages/admin/CommsPage.tsx` | Mounted `useCommsEvents()` at the top of `CommsPage`; board `refetchInterval` 30_000 → 300_000; thread/drafts `refetchInterval` 15_000 → 300_000; one import added. Nothing else touched. |
| `scripts/_test-comms-events-sse.ts` | **NEW.** Scratch end-to-end verifier (mints a 10-min admin session, opens the stream, drives the draft PATCH/reject routes, asserts events arrive, tidies up after itself). |

## Events emitted, and from where

- `draft_delta` (`server/message-drafts.ts`, all fire-and-forget via `pushCommsEvent`):
  - `queueDraft()` after insert → status `pending`
  - `PATCH /api/drafts/:id` on success → `edited`
  - `approveAndSendDraft()`: opt-out refusal → `blocked`; the 27 Aug autosend guards
    (`holdForHuman`, both markers) → `blocked`; successful send → `sent`
  - `POST /api/drafts/:id/reject` → `rejected`
  - Not emitted: `approved` (the claim flips to a terminal state within the same call, so only
    the terminal event goes out), `OUTSIDE_WINDOW` reverts (row returns to `pending`,
    no state the UI doesn't already show), `failed` sends (no such status in the contract).
- `board_delta`:
  - reason `outbound` — `approveAndSendDraft()` after a successful send, when the draft has a
    `conversationId` (skipped when null: `conversationId` is required on the event)
  - reason `stage` / `priority` / `tags` — `set_board_state` in `server/agents/comms.ts`
    (one event per call; reason precedence stage > priority > tags when several fields change)
  - reason `inbound` — `scheduleInboundTriage()` in `server/agents/comms-lanes.ts`
  - reason `sla` — `sweepSlaBreaches()` on breach alerts and reminders
- `run_started` / `run_event` / `run_finished` — defined in the contract, reserved for
  Agent B, emitted nowhere in my changes.

## Client hook design (`useCommsEvents`)

- ONE module-level `EventSource` shared across every mounted instance, with an
  insertion-ordered subscriber registry. `useCommsEvents(onEvent?)` is the subscriber seam
  Agent B's LiveRunPanel can use to receive raw events without opening a second connection.
- The FIRST mounted instance owns invalidation, so multiple consumers never double-refetch:
  - `board_delta` → invalidate `['comms-board']` (prefix — both lanes) AND `['comms-thread']`
  - `draft_delta` → invalidate `['comms-thread']` (drafts ride inside the thread response)
  - stream open/reopen → invalidate both (snapshot refresh after any gap)
- Reconnect: EventSource auto-retries transient drops; on a CLOSED socket the hook retries
  manually with jittered exponential backoff (1s → 30s cap), resetting on a successful open.
- Auth: token from `localStorage.adminToken` sent as `?token=` (see deviation 1).

## How I verified

1. `npx tsc --noEmit` — zero errors in any touched file (client + server are both in the
   tsconfig include). Pre-existing errors exist in unrelated scratch scripts
   (`scripts/scrape-reddit-value-drivers.ts`, `scripts/seed-diy-advice.ts`, etc.) — untouched.
2. `npm run dev` (port 5001), then `npx tsx scripts/_test-comms-events-sse.ts`:
   - unauthenticated `curl /api/comms/events` → 401 (auth intact)
   - with a minted session token via `?token=` → 200 `text/event-stream`, `: connected` frame
   - PATCH on a throwaway draft → `draft_delta` status `edited` arrived on the stream
   - reject → `draft_delta` status `rejected` arrived. **PASS**, cleanup ran.
3. The dev server's boot SLA sweep fired a real `quote_ready` breach during the test and the
   new `board_delta` emit ran on that path with no errors logged.
4. Vite transforms of both new/edited client modules confirmed over the dev server
   (`/src/hooks/useCommsEvents.ts`, `/src/pages/admin/CommsPage.tsx` → 200, valid output).

## Deviations from the brief

1. **`?token=` auth shim.** `requireAdmin` reads only the `Authorization: Bearer` header and
   the browser `EventSource` API cannot set headers. The SSE route therefore also accepts the
   same session token as `?token=`, copied into the header BEFORE the unchanged `requireAdmin`
   runs. Verification logic is identical to `/api/drafts`; header auth (curl) still works.
   This is also why the route is registered above the `/api/comms` mount rather than inside
   `comms-activity-routes.ts` — the mount-level `requireAdmin` would 401 query-token requests
   before any router-local shim could run.
2. **SSE route lives in a new file** (`server/comms-events-route.ts`) rather than inside
   `server/comms-events.ts`, keeping the bus file byte-exact to the agreed contract for
   Agent B.
3. **`board_delta` also invalidates the thread query.** The brief maps `board_delta` → board
   only, but the 15s poll being removed was ALSO how the open thread showed new
   inbound/outbound messages; without this, an open thread would go stale for up to 5 minutes.
   Cheap: at most one thread query is active at a time.
4. **The "drafts query" at CommsPage ~1076 is the thread query** (`['comms-thread', id]` —
   drafts are a field of the thread response). Its poll is the one relaxed to 300_000.

## Notes for Agents B/C

- The dev server I started may still be running on :5001 (background task).
- `emitCommsEvent` listener errors: my SSE route wraps its own writes, but call `emitCommsEvent`
  inside try/catch anyway (EventEmitter listeners run synchronously in the emitter's frame).
- `scripts/_test-comms-events-sse.ts` shows how to mint a throwaway admin session for curl
  tests; it deletes the session and draft when done.
