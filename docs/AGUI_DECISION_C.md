# Decision C — AG-UI/CopilotKit for the approval-card UI, or stay bespoke on SSE?

Agent C, 29 Aug 2026. Research + decision only; no code changed. Written after reviewing
Agents A and B's landed work (`docs/AGUI_SSE_A_DONE.md`, `docs/AGUI_SSE_B_DONE.md`) and the
files they touched.

## Recommendation

**Stay bespoke.** Do not adopt AG-UI as a wire protocol or CopilotKit's React components for
the draft-approval cards or live-run rendering. The deciding facts: (1) CopilotKit's prebuilt
surface is chat-centric (CopilotChat/sidebar, `useCopilotAction`/`renderAndWaitForResponse`
rendering approval UI *inside a chat transcript*) — nothing prebuilt serves a kanban board or
a durable approval worklist, which is what CommsPage is; (2) AG-UI's human-in-the-loop model
is **run-scoped** — a run ends with an `interrupt` outcome and the client *resumes the run*
with the answer — whereas our drafts are durable DB rows that outlive the run and are approved
hours later through `approveAndSendDraft()`, a deterministic send path with its own guard
stack, not a resumption of an LLM run; (3) what A and B just built is deliberately *thinner*
than AG-UI: events are invalidation hints over a DB that holds the truth, not state carried on
the wire. Adopting AG-UI would mean carrying state in events (STATE_SNAPSHOT + RFC 6902
deltas), inverting our durability rule for no user-visible gain. Borrow AG-UI's vocabulary and
discipline (below) so a later adoption is a translation layer, not a rewrite.

## Event mapping: our `CommsEvent` union ↔ AG-UI

Our bus (`server/comms-events.ts:4-9`) vs the AG-UI spec (docs.ag-ui.com/concepts/events).

| Ours | AG-UI equivalent | Fit / gap |
|---|---|---|
| `run_started {runId, conversationId, at}` | `RUN_STARTED {runId, threadId}` | Clean. `conversationId` ≈ `threadId`. |
| `run_finished {runId, ok}` | `RUN_FINISHED {outcome}` / `RUN_ERROR` | Ours collapses success/failure into `ok`; AG-UI splits and can carry an `interrupt` outcome we don't use. |
| `run_event {event: tool_call}` | `TOOL_CALL_START` + `TOOL_CALL_ARGS` + `TOOL_CALL_END` | We emit one complete event per call (runner buffers the turn); AG-UI streams args as deltas. Ours is coarser but sufficient — the panel shows "Drafting reply…", not arg-by-arg typing. |
| `run_event {event: tool_result}` | `TOOL_CALL_RESULT` | Clean. |
| `run_event {event: tool_error}` | none (per-call) — `CUSTOM` or run-level `RUN_ERROR` | AG-UI has no per-tool-call error event; a gap *in AG-UI* for our use. |
| `run_event {event: assistant_text}` | `TEXT_MESSAGE_START/CONTENT/END` | We emit whole blocks, not token deltas — the Anthropic SDK call in `runner.ts` is non-streaming, so token-level TEXT_MESSAGE_CONTENT is unimplementable without changing the runner. |
| `run_event {event: turn_cap/truncated}` | `CUSTOM` at best | No AG-UI equivalent. |
| `board_delta {reason}` | `STATE_DELTA` (loosely) | **Deliberate mismatch.** Ours carries no payload — it is a cache-invalidation hint; AG-UI's is an RFC 6902 patch the client must apply. |
| `draft_delta {draftId, status}` | closest: `RUN_FINISHED{outcome: interrupt}` + resume | **The core mismatch.** Our draft lifecycle (`pending → approved → sent / rejected / failed`, plus guard-driven reverts to `pending`) is durable, out-of-run state. AG-UI interrupts pause a live run and expect a resume; they have no model for a send that happens through a separate code path after the run is long finished. |
| snapshot-on-connect (REST refetch in `useCommsEvents` `onOpen`) | `STATE_SNAPSHOT` / `MESSAGES_SNAPSHOT` | Same discipline, different mechanism: we refetch `/api/inbox/board` + thread; AG-UI pushes the snapshot as an event. |
| — | `STEP_STARTED/FINISHED` | Unused; our runner has turns but doesn't expose them. Fine. |

## Cost/benefit of adopting

**New dependencies:** `@copilotkit/react-core` + `@copilotkit/react-ui` (+ provider wrapping),
plus a self-hosted `CopilotRuntime` HTTP endpoint on Express (we will not proxy their cloud;
self-hosting is supported and MIT-licensed). Or, protocol-only: `@ag-ui/core`/`@ag-ui/client`
(HttpAgent, subscribers) — a dependency to replace a 5-variant type union and a 170-line hook
that already work.

**Refactor surface:** the 2015-line hand-rolled `CommsPage.tsx` (board + thread + composer +
draft cards), `server/comms-events-route.ts` (SSE framing → AG-UI encoder), `comms.ts` run
wiring (lean transcript events → AG-UI event streams per run), and an auth story — CopilotKit
runtime endpoints would need the same `?token=` shim A had to build. Draft approval would still
need fully custom rendering inside CopilotKit's chat container, or stay outside it — in which
case the adoption bought nothing for the approval cards at all.

**Lock-in:** moderate. AG-UI is MIT and multi-framework (LangGraph, Mastra, Pydantic AI, ADK,
etc. ship integrations as of 2026), so protocol lock-in is low — but CopilotKit *components*
assume the CopilotKit runtime and chat paradigm, which is real coupling.

**What we'd delete vs keep:** we'd delete `useCommsEvents` and the SSE route (~250 lines,
freshly built and verified today) and keep... essentially everything else, since no prebuilt
component matches board, cards, or queue. That ratio is the decision in miniature.

**Benefit forgone:** token-streaming chat polish and a standard protocol if we ever want
third-party frontends on our agent. Neither matters for a single-operator admin worklist.

## Conventions to borrow (so later adoption stays cheap)

1. **Keep the run vocabulary AG-UI-shaped.** `run_started/run_event/run_finished` with a
   stable `runId` + `conversationId` already mirrors RUN_STARTED/RUN_FINISHED + threadId. If
   `run_event` is ever refined, split it into typed events named after AG-UI's families
   (`tool_call_start/result`, `text_message`) rather than inventing new names. An AG-UI
   adapter then becomes a pure translation function over the bus.
2. **Snapshot + delta discipline (already in place — keep it).** Connect/reconnect always
   refetches the snapshot; deltas are hints; missed events are recoverable by design because
   the DB is the truth. If a delta ever needs to carry data (e.g. optimistic card moves), use
   RFC 6902 JSON Patch as AG-UI does rather than ad-hoc partial objects.
3. **Extend the `CommsEvent` union only additively** (the hook's comment already says this).
   That is exactly the compatibility posture that makes a later protocol swap non-breaking.
4. **If run-scoped approvals are ever wanted** (agent pauses mid-run for a human), model them
   as AG-UI does — an interrupt outcome on `run_finished` with an id/reason/schema — but keep
   the *durable* draft queue as DB rows. The two are different products: an interrupt is a
   pause; a draft is a debt.

## Risks specific to this system (why adoption is worse than neutral here)

- **Autosend guard model.** Every automated send exits through `approveAndSendDraft()`
  (`server/message-drafts.ts:303`), where the 27 Aug guards live (near-duplicate hold,
  malformed-reason hold, opt-out recheck at send time). AG-UI's interrupt/resume flow would
  route approval decisions back *into the run* as tool results, creating a second send-shaped
  path that bypasses or duplicates the queue exit — the exact class of split-brain that caused
  the 27 Aug triple-send.
- **DB-as-source-of-truth.** `useCommsEvents` states it outright: "The stream is a VIEW over
  DB state... events carry no payloads worth trusting." AG-UI clients materialise state *from
  the event stream* (snapshot + patches). Adopting that model makes the SSE stream
  load-bearing for correctness; today a dropped stream costs at most 5 minutes of staleness
  (the retained `refetchInterval` fallback) and zero correctness.
- **Single-operator admin UI.** CopilotKit's value concentrates in end-user chat UX and
  multi-frontend reach. Ben's queue is one person's worklist; the marginal UX ceiling is
  already reached by what A and B shipped today (live invalidation + live run strip).
- **The 2015-line CommsPage.** It is hand-rolled Tailwind/shadcn with its own query topology,
  drag-drop board, and deep-link handling. Wrapping it in a CopilotKit provider or porting
  cards into chat-rendered actions is a large, risky refactor of the business's primary
  operating surface, with the approval-card UI — the thing this decision is about — still
  ending up custom-built either way.

## Sources

- [Master the 17 AG-UI Event Types (CopilotKit blog)](https://www.copilotkit.ai/blog/master-the-17-ag-ui-event-types-for-building-agents-the-right-way)
- [AG-UI events reference (docs.ag-ui.com)](https://docs.ag-ui.com/concepts/events) — event families, RFC 6902 STATE_DELTA, interrupt outcome on RunFinished
- [AG-UI / CopilotKit human-in-the-loop spec](https://docs.copilotkit.ai/agent-spec/human-in-the-loop) — interrupt/resume model, `renderAndWaitForResponse`
- [CopilotKit self-hosting (Copilot Runtime)](https://docs.copilotkit.ai/guides/self-hosting) — Express-hostable, no cloud required
- [CopilotKit GitHub (MIT; makers of AG-UI)](https://github.com/copilotkit/copilotkit); adoption across LangGraph/Mastra/Pydantic AI/ADK etc. per 2026 ecosystem reports ([OpenUI state-of-generative-UI](https://www.openui.com/blog/state-of-generative-ui-report))
- [@ag-ui/client on npm](https://www.npmjs.com/package/@ag-ui/client) — HttpAgent/subscriber SDK usable without CopilotKit
