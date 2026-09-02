# Phase 4 / C — contractor pack + post-call merge gate — DONE

Worktree `/Users/courtneebonnick/v6-wt-config`, branch `p4-contractor`, started from `53b7340` (comms-v3).

## Migrations

None. The contractor lane reads existing tables (`users`, `handyman_profiles`,
`contractor_booking_requests`, `contractor_jobs`, `personalized_quotes`, `conversations.role_profile`).

## DATA PRECONDITION (blocks the lane)

**The contractor lane cannot light up until the 8 contractor users have real phone numbers.**
`server/roles.ts` resolves `conversations.role_profile` from the phone; with `users.phone = ''` every
contractor thread is a customer thread. `loadContractorContext` returns `contractor: null` for the
same reason and the liaison briefs from the thread alone. Owner action (design §7, §13): enter the
phones on `/admin/contractors`. Then the audience resolves, triage lanes to `contractor`, and — with
`spine.enabled` — the liaison drafts.

## Files

**1. Contractor liaison**
- `server/spine/agents/contractor-liaison.ts` — `createContractorLiaisonAgent(deps)`, `contractorLiaisonAgent`
  (name `contractor_liaison`, tier DRAFT, model `SCOPER_MODEL` = Sonnet 5, `accepts` =
  `triage.audience === 'contractor'`). Belt: `propose_reply` (pack intents only; refuses customer PII,
  voice, > 1 question, > 3 bubbles, > 40 words/bubble), `flag` (complaint / trust_concern /
  out_of_scope / callback_requested). Standing orders in `LIAISON_CORE`; the house voice file is
  appended with "you are the office, not Ben". Registered in `server/spine/agents/index.ts`;
  `agentForLane('contractor')` already returned `contractor_liaison` (pane A, Phase 2).
- `server/spine/contractor-case.ts` — `loadContractorContext(phone)` (phone → `users.role='contractor'` →
  `handyman_profiles` → bookings ±14 days in `contractor_booking_requests` where assigned/contractor id
  matches, plus live `contractor_jobs`), `renderContractorContext`, `materialsFromLines` (reads
  `materials` / `shoppingList` / `materialsList` on a quote line, whichever the picker used; never
  prices). Customer reduced to first name + postcode by construction.
- `server/spine/guards.ts` — `detectCustomerPii` exported: phone (UK mobile / landline), email, or a
  full name together with a street address → hit; postcode-only, first name, or a bare street →
  allowed. `money_to_customer` is a documented no-op for the contractor audience.
- Tests: `server/spine/guards-contractor.test.ts` (6), `server/spine/agents/contractor-liaison.test.ts`
  (4: brief with postcode + first name; PII / two-question refusals + flag-only; customer thread never
  runs; pure helpers).

**2. Post-call merge gate**
- `server/post-call-ladder.ts` — `classifyCall` + `decidePostCallLadder` (pure), executed by
  `ingestCallRow` in `server/call-thread.ts` (steps 4/5 now read the plan; the outbound-card rules
  are untouched).
- `server/__tests__/post-call-ladder.test.ts` — the four call types with fakes, plus
  `decideOutreach` for the "one text-back" claim.

**3. Client** — `BoardCard.roleProfile` (server `inbox-board.ts` interface + `toCard`, client
`CommsPage.tsx`) and the header chip `audience: contractor · contractor.default` (title names the
pack, tier and guards). Drafts from the liaison are `source: 'spine'` and render in the existing
`DraftApprovalCard` like every other draft; `/admin/contractors/:id` already deep-links to the
contractor lane of `/admin/comms` (`CommsCard`), unchanged.

## Post-call ladder: what passed TODAY vs after the fix

Run 1 (ladder extracted as a straight copy of the current rules, tests against it):

| Case | Today | Reason |
|---|---|---|
| (a) missed after ring → one text-back | **PASS** | `ackForCall` sends `ack_missed_call` once; the video-request lane refuses (no classification); second ingest with an existing card does not re-ack |
| (b) answered → no text-back | **PASS** | `ANSWERED_HANDLED_BY_POST_CALL_OUTREACH`; continuation lane runs, flag-gated |
| (b) transcript → triage / clerk hook | **FAIL** | nothing in `call-logger.finalizeCall` / `ingestCallRow` asked the spine (or the legacy triage) for a run on `call_ended`; the clerk never saw a transcript |
| (c) abandoned mid-ring, fresh → ack | **PASS** | canceled ⇒ missed ⇒ ack |
| (c) abandoned mid-ring, stale → no ack | **FAIL** | no freshness check anywhere; a row finalized hours later (the case `remove-realtime`'s janitor creates) would ack |
| (d) outbound → recorded, no ack | **PASS** | ack is inbound-only; outbound card only via `outboundOpensCard` + duration ≥ 10s |

Run 2 (after the two fixes, 17 lines in the ladder + 18 in `call-thread.ts`): all 13 pass.
- (b): `spineRun = 'call_ended'` when the call is answered, the transcript is ≥ 40 chars, and
  `spine.enabled` — `requestRun(conv.id, 'call_ended')` owns the debounce/claim. Off by default.
- (c): an abandoned ring whose `startTime` is > 30 min old gets no ack (`ABANDON_FRESH_MS`).

**`remove-realtime` (72c1bff) is NOT ported.** Its diff (805 deletions across `index.ts`,
`post-call-outreach.ts`, `first-contact-ack.ts`, + `call-janitor.ts`) does not fix either failing
test: the transcript hook is spine work that post-dates that branch, and its janitor *creates* the
stale-abandon case rather than guarding it. Both fixes were < 50 lines. The branch's real value
(recording-status as the sole post-call trigger, nova-3 multichannel, the janitor) remains a
separate merge decision for the orchestrator; nothing here conflicts with it.

## Verification

- **tsc** (`NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json`): baseline 1882
  errors on `53b7340`, 1882 after. Per-file × error-code counts identical. My first pass added one
  (a `.filter` chained onto `push` in `contractor-case.ts`); fixed in `e3766b9`, re-run confirmed.
  The pre-existing errors in `call-thread.ts` / `inbox-board.ts` are unchanged in count.
- **vitest** (`DATABASE_URL=postgres://u:p@127.0.0.1:1/x npx vitest run`): baseline 42 failed / 773 passed / 8
  skipped (47 files); after 42 failed / 796 passed / 8 skipped (50 files). Failing-file set identical
  (diffed sorted summaries). 23 new tests.
- **esbuild** (`npx esbuild server/index.ts --bundle --platform=node --format=esm --packages=external`): 3.7 MB, no errors.
- Rules kept: no dev server, no DB, no `app_settings`, no push, no external calls.

## Not done, and why

- **No live run of the liaison** (no model key, rule 2). The belt is exercised with a stubbed
  runner only.
- **`accepts` uses triage audience, which comes from `role_profile`** — see the data precondition.
- **Contractor packs on the eval harness**: no `contractor.*` families yet; the guards and belt
  are unit-tested instead. Add families once real contractor threads exist to draw contexts from.
- **`remove-realtime`** not merged (above).

## Decisions the design / brief left open

1. **`customer_pii` semantics.** Pane A's Phase 2 detector banned any postcode. The brief says
   postcode-only is allowed, so the detector now targets phone, email, and *full name + street
   address*; a bare street or a first name passes. The pack chip's tooltip states the rule.
2. **`money_to_customer` no-op** for contractor audience, as briefed; the customer-side rule is the
   `money` guard in every customer pack.
3. **The liaison speaks as "the office", not Ben.** Ben's voice file is appended for register, but
   the standing orders override the "You ARE Ben" line: a contractor is texting the business.
4. **Ladder executed from the ingest, not a new webhook.** Keeps the current finalize path and
   makes the four decisions testable without Twilio; the spine hook is `requestRun`, never a direct
   agent call (§3.1).
5. **Transcript threshold 40 chars** so a "hello?" on a 12-second answered call does not wake the
   clerk.
6. **Freshness window 30 minutes** for an abandoned ring — long enough for a delayed status
   callback, short enough that the ack still reads as immediate.
