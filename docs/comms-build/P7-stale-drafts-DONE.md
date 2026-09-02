# P7 / A — no reply may go out that was written before the customer's latest message

Branch `p7-stale-drafts` from `comms-v3` at `476e9e7`, worktree `/Users/courtneebonnick/v6-wt-exit`.
Brief: `docs/comms-build/BRIEF-P7-stale-drafts.md`. Incident: 2 Sep, thread 46a13bdb… (Janet) —
14:14 "back soon with measurement", 14:15 legacy draft "just send the measurement over", 14:28 the
photo; the draft stayed pending, the 14:28 run was blocked by the source dedupe, Ben was one tap
from sending it. This makes that impossible for the legacy agent and the spine, for a human tap
and for autosend, and stops the spine drafting at all while the customer is fetching something.

## 1. Exit-time freshness guard (the hard guarantee)

- `server/draft-freshness.ts` (new). The pure rule `staleAgainst(draft, latestInbound)`: a draft
  that names the inbound it answered (`based_on_inbound_id`) is fresh only while that message is
  still the thread's latest non-quarantined inbound; a draft without one is stale when any inbound
  is newer than its `created_at`. Loaders (SELECT only): `latestInboundFor`, `inboundSince`,
  `conversationIdForDraft` (conversation id, else the `@c.us` key its phone maps to).
  `requestFreshRun`: spine enabled (shadow or live) → `requestRun(id, 'inbound_message', { delayMs: 0 })`;
  off → `metadata.nextTriageAt = now` (the legacy tick's row).
- `approveAndSendDraft` (`server/message-drafts.ts`): after the row claim and before the opt-out
  re-check, EVERY approver: stale → back to `pending` with `held_reason 'stale_by_inbound'`,
  `system_events` row (`hold`, marker `stale_by_inbound`), ledger `draft_rejected` by
  `system:stale_by_inbound` ("held at send: …"), a `blocked` outcome-ledger verdict, SSE
  `draft_delta`, `requestFreshRun`, and the new return code `STALE_BY_INBOUND`. The approve route
  turns that into 409 `{ error: 'STALE_BY_INBOUND', message }` and records NO human verdict for it
  (the words are about to be replaced).
- `queueDraft` stamps `based_on_inbound_id` from the thread's latest inbound at queue time.
- Migration `migrations/20260904_message_drafts_based_on_inbound.sql`: `based_on_inbound_id text null`
  + index `(conversation_id, status)`; documents `held_reason = 'stale_by_inbound'` and
  `approved_by = 'system:stale_by_inbound'`. **Apply before deploying** (queueDraft inserts the column).
  `shared/schema.ts` carries the column.

## 2. Supersede on new inbound

- `supersedeStaleDrafts(conversationId, inboundAt, { latestInboundId, why })` in
  `server/message-drafts.ts`: every PENDING draft with source `comms_agent` or `spine` written
  before the inbound (pure selection `selectSuperseded` in draft-freshness.ts; rules-layer, manual
  and every other source untouched; a spine draft written against that very inbound untouched) is
  set `rejected`, `approved_by 'system:stale_by_inbound'`, `held_reason 'stale_by_inbound'`, with a
  ledger `draft_rejected`, a `rejected` outcome verdict, a `system_events` row and an SSE delta.
  CAS on `status = 'pending'`, so a racing approve or reject keeps its own outcome. Never throws.
- Called from the ingest lane both webhooks share (`server/agents/comms-lanes.ts`
  `runInboundLanes`, awaited, right after the opt-out gate, with the stored message id), so Meta
  and Twilio inbound (text and media) both retire older agent drafts before any lane can draft.
- Called at the start of `queueDraft` for agent sources, so an agent run that starts after a new
  inbound clears the old draft itself before the dedupe can refuse the new one.

## 3. Spine exit re-check

- `server/spine/exit.ts`, `send` decision: re-read the thread's latest inbound now and compare with
  `caseFile.lastInboundId` (the time test on `builtAt` for a case file without one). Newer → the
  proposal is queued as a pending draft with `held_reason 'stale_by_inbound'` and a `HELD:` note
  in its reason, never approved, and `requestFreshRun` is called; outcome `pending`. Same inbound
  → the P6 path (template-first) as before. New injectable deps `latestInbound`, `requestFreshRun`.
- `based_on_inbound_id` is stamped by `queueDraft` on every draft the exit queues (send, held, pending).

## 4. "Customer promised more" wait

- `server/spine/triage.ts`: `RE_PROMISED_MORE` + `customerPromisedMore(text)` (back soon, be back,
  will send/get/…, I'll send/get…, sending now/over, one sec, give me a minute, hang on, bear with,
  let me get/grab/find, I'll get you, in a minute/bit/mo, shortly, just a sec…). `triageRules` sets
  `customerPromisedMore` (customer messages only; not call transcripts, not contractor threads) and
  adds the reason. `mergeTriage` carries it.
- `server/spine/decide.ts`: after opt-out / spam / exceptions and before the proposal check,
  `customerPromisedMore || caseFile.lastInboundPromisedMore` → `{ kind: 'none', reason: 'waiting_for_promised' }`.
  Never a flag, never an ask; an exception in the same message still goes to Ben.
- `server/spine/index.ts`: on that decision (not in shadow) `requestRun(id, 'inbound_message',
  { delayMs: 15 min })` (`PROMISED_MORE_FOLLOWUP_MS`). The promised item arriving runs the normal
  inbound path sooner and renews the same due row.
- `CaseFile` (additive): `lastInboundId`, `lastInboundPromisedMore`; `TriageResult.customerPromisedMore`.
  `server/spine/case-file.ts` fills both.

## 5. Ben's UI

- Thread endpoint (`server/inbox-board.ts`) and the drafts list (`GET /api/drafts`) attach
  `inboundSince { count, media, latestAt, latestId }` and `stale` to each pending draft.
- `DraftApprovalCard` (`client/src/pages/admin/CommsPage.tsx`): a red "Customer wrote since this
  draft (N messages / M media)" banner; one-tap approve disabled while stale (an edited approve
  stays possible — the server still refuses if the thread is stale at send time); a **Re-draft**
  button → `POST /api/spine/rerun/:conversationId`; a 409 from approve shows the server's message.
- `POST /api/spine/rerun/:conversationId` (`server/spine/routes.ts`): supersede the thread's
  pending agent drafts against its latest inbound, then `requestFreshRun`. Works in every mode.

## 6. Triage fixes from the same thread

- (a) `clampTriageModelOutput`: `reasons` trimmed to 200 chars / 6 entries and `tags` to 30 chars /
  8 entries BEFORE the zod parse, so a long reason no longer throws the whole model answer away.
- (b) The date lexicon. **Finding: `RE_DATE` does not contain "soon" and does not match "That's the
  only cladding, back soon with measurement"** (checked by running the regex; no lexicon in the
  repo has `soon`, only `soonest` in the eval mirror). The Ben-lane routing came from the Haiku
  triage, which `mergeTriage` lets ADD exceptions. Fix in the merge: when the customer promised
  more and the rules found no date, a model-only `date_question` is dropped, and a Ben lane that
  existed only because of it falls back to the rules' lane. A rules date hit (e.g. "what day can
  you come? back soon with the measurement") keeps the exception; a model `money_question` is never
  dropped. No token was removed from `RE_DATE`.
- Eval cases: `eval-cases/absence/cases.json` `ab-009-back-soon-with-measurement`,
  `ab-010-will-send-photos`; `eval-cases/date_question/cases.json` `dq-006-back-soon-is-not-a-date`
  (must not escalate), `dq-007-what-day-plus-back-soon` (must flag).

## 7. Tests

- `server/draft-freshness.test.ts` (11): the guard (older → held, newer → sends, named inbound,
  unparseable date), supersede (legacy + spine rejected; rules_layer, manual, sent, newer, and
  "written against this very inbound" untouched; without an id the time test), `countInboundSince`.
- `server/spine/exit.test.ts` (+4): newer inbound → held + no approve + fresh run; same inbound →
  sends; no inbound → sends; old case file without `lastInboundId` → time test holds.
- `server/spine/triage.test.ts` (+5): the promise phrases (and "soonest" is not one), the incident
  sentence stays on the scoper lane with no exception, transcripts / contractors cannot promise,
  the merge guard (drop model date_question; keep a rules date; keep model money), the clamp.
- `server/spine/decide.test.ts` (+4): waiting_for_promised at SEND tier, the case-file flag alone,
  exception still wins, opt-out still drops.
- `client/src/pages/admin/__tests__/CommsPage.draft-card.test.tsx` (+4): banner + disabled approve
  + edit re-enables; Re-draft posts and calls onDone; 409 STALE_BY_INBOUND shows the message; a
  fresh draft has neither banner nor button.

## Files

New: `server/draft-freshness.ts`, `server/draft-freshness.test.ts`,
`migrations/20260904_message_drafts_based_on_inbound.sql`, `P7-DONE.md`.
Changed: `server/message-drafts.ts`, `server/agents/comms-lanes.ts`, `server/inbox-board.ts`,
`server/spine/{exit,exit.test,triage,triage.test,decide,decide.test,index,case-file,types,routes}.ts`,
`shared/schema.ts`, `client/src/pages/admin/CommsPage.tsx`,
`client/src/pages/admin/__tests__/CommsPage.draft-card.test.tsx`,
`eval-cases/absence/cases.json`, `eval-cases/date_question/cases.json`.

## Migrations

`migrations/20260904_message_drafts_based_on_inbound.sql` — additive, idempotent, NOT applied here.
`npx tsx scripts/_apply-migration.ts migrations/20260904_message_drafts_based_on_inbound.sql` before deploy.

## Verification

| Gate | Result |
|---|---|
| tsc vs `476e9e7` | 1,872 → 1,872; (file, error code) multiset identical |
| vitest (both projects) | baseline 42 failed / 934 passed (64 files); after 42 failed / 961 passed (65 files); failing set identical |
| client project (`npm run test:client`) | 40 passed (6 files); baseline 36 |
| esbuild `server/index.ts` | bundles |

No dev server, no database, no `app_settings`, no push.

## Not done, and why

- **`approveAndSendDraft` and `supersedeStaleDrafts` are exercised through their pure parts**
  (`staleAgainst`, `selectSuperseded`) and the exit's injected deps, not through a database: the
  server test project has no Postgres. The DB paths are SELECT + one CAS UPDATE each.
- **The legacy comms agent's own "supersede" note** (`comms.ts` `draftedThisRun`) is untouched;
  the new guard sits under it at the shared exit, which is where the brief wanted the guarantee.
- **The 15-minute follow-up is not scheduled in shadow**: the legacy tick owns the thread there
  and the shadow run records `none / waiting_for_promised` for the report.
- **`RE_DATE` unchanged** — see 6(b): no offending token exists; the fix is in the merge.

## Decisions

- Identity beats time: a draft that names its inbound is fresh while that inbound is latest, even
  if the inbound's clock is later than the draft's (Twilio timestamps vs our insert time).
- A stale hold at send is a `blocked` outcome and a `system:stale_by_inbound` ledger rejection,
  not a human verdict, so the promotion gate never counts it either way.
- The rules layer's drafts are never superseded: a holding line or an ask is content-free and
  cannot answer the wrong turn.
- Promised-more waits are `none`, not `pending`: a pending draft would be exactly the stale
  artefact this pass exists to prevent.
