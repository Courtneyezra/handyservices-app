# Brief C — Decision: adopt AG-UI/CopilotKit for the approval-card UI, or stay bespoke on SSE

You are **Agent C**. This is a RESEARCH AND DECISION task — **write no application code**.
Agents A and B are concurrently implementing, in this same checkout:
- A: an SSE event bus (`server/comms-events.ts`) + STATE_DELTA board/draft events replacing
  CommsPage polling (`docs/AGUI_SSE_BRIEF_A.md`).
- B: an `onEvent` hook in the agent runner streaming live run events to a thread-panel
  component (`docs/AGUI_SSE_BRIEF_B.md`).

## Question to answer
Once A and B land, should we adopt the AG-UI protocol and/or CopilotKit's React components
for the draft-approval-card UI and live-run rendering, or keep our bespoke components on the
plain SSE channel?

## Work plan
1. **Research (start now, in parallel with A/B):**
   - AG-UI protocol: current spec, event types (RUN_STARTED, TEXT_MESSAGE_CONTENT,
     TOOL_CALL_*, STATE_SNAPSHOT, STATE_DELTA, etc.), transports, maturity/stability,
     licensing, who maintains it (CopilotKit), 2026 state of the ecosystem.
   - CopilotKit React: which prebuilt components would actually serve a draft-approval
     queue and a live tool-call feed; React 18 + Vite 5 compatibility; bundle weight;
     how opinionated the styling is vs our Tailwind/shadcn setup; self-hosted runtime
     requirements (we will NOT proxy through their cloud).
   - Human-in-the-loop support: how AG-UI models interrupts/approvals, and whether our
     `pending → approved/sent` draft lifecycle maps cleanly.
2. **Codebase mapping:** read `server/agents/runner.ts`, `server/agents/comms.ts`,
   `server/message-drafts.ts`, `client/src/pages/admin/CommsPage.tsx`. Produce a mapping
   table: our CommsEvent types ↔ AG-UI event types; note gaps both ways.
3. **Wait for** `docs/AGUI_SSE_A_DONE.md` and `docs/AGUI_SSE_B_DONE.md`, then review what
   was actually built (read the diffs/files) before finalising.
4. **Deliverable:** write `docs/AGUI_DECISION_C.md` containing:
   - One-paragraph recommendation up top (adopt / partial adopt / stay bespoke).
   - The event mapping table.
   - Cost/benefit: new dependencies, refactor surface, lock-in, what we'd delete vs keep.
   - If "adopt" or "partial": a concrete migration sketch (which files change, in what order,
     and what stays as-is). If "stay bespoke": what conventions to borrow from AG-UI anyway
     (e.g. event naming, snapshot+delta discipline) so a later adoption stays cheap.
   - Risks specific to this system: autosend guard model, DB-as-source-of-truth durability
     rule, single-operator admin UI, 1800-line hand-rolled CommsPage.

## Constraints
- No code changes, no new dependencies installed, no commits.
- Web research is expected and encouraged; cite sources in the doc.
- Keep the final doc under ~200 lines; it is a decision record, not a survey.
