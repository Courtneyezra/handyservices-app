# P13 — the job pack: one live record from clerk to contractor

Branch `p13-job-pack` from `comms-v3` at `8a73900`, worktree `/Users/courtneebonnick/v6-wt-exit`.
Brief: `docs/comms-build/BRIEF-P13-job-pack.md`; owner decisions in the Obsidian note "Job Pack
Handoffs". Landed in four commits so a partial merge is still useful:

| Part | Commit | What |
|---|---|---|
| 1 record | `4346518` | `job_packs` migration + schema, `server/spine/job-pack.ts` (pure builders + store), 11 tests |
| 2 writers | `4b285fe` | clerk fields + gaps, Route A pack write, Ben's edits, rules-layer asks, live filing, 11 tests |
| 3 readers | `f191c5e` | dispatch from the pack (422 on missing), lock at dispatch, booking engine, portal sections + chip, 6 server + 8 jsdom tests |
| 4 WhatsApp | `344d332` | `job_pack_ready` / `job_pack_changed` to contractors, guard, hourly batch, template doc, 7 tests |

## Part 1 — the record
- `migrations/20260906_job_packs.sql` (idempotent, additive, NOT applied) and `jobPacks` in
  `shared/schema.ts`: one row per quote (`quote_id` unique), `lines jsonb`, `job jsonb`,
  `required jsonb`, `missing text[]`, `change_log jsonb`, `locked_at`, `dispatch_id`, timestamps.
- `server/spine/job-pack.ts`: shapes (`PackLine`, `PackJob`, `ChangeLogEntry`, `JobPack`);
  `requiredFor` (delivery fields always, in ask order; sizes + spec when WE supply something sized;
  disposal on a removal; hazards on a hazard word; lead time when we supply materials; no delivery
  slot on a labour-only job); `missingFor` recomputed on every `commit`; `diffPacks` → the change
  log with who and which source; `linesFromClerk` / `mergeEstimate` / `applyBenEdits` layering onto
  one record (each owner's fields replaced, the others' kept); `fileAnswer` (a customer may only
  fill `CUSTOMER_FILEABLE` delivery fields); `lock` (line fields freeze → `PackLockedError`, job.*
  stays live); `changesSince`; `derivePricingLineItems` (the quote's line items FROM the pack);
  store `getPackForQuote` / `getPackForConversation` / `getPackForDispatch` / `savePack` (upsert on
  quote_id) / `upsertFromClerk` / `upsertFromEstimate` / `applyBenEditsToQuote` /
  `fileAnswerForQuote` / `lockPack`; `isMissingTable` so every reader treats an unapplied migration
  as "no pack".

## Part 2 — writers
- **Clerk** (`server/agents/quote-prep.ts`): `get_thread` now shows each message's `id` (a media
  message's id is its media id); `submit_intake` lines accept `evidence [{messageId, text}]`,
  `mediaIds`, `exclusions`, `sizes`, `spec`, `supplyBy`, `hazards`, `disposal`, `leadTime`
  (CLERK-EVIDENCE.md shape, now the clerk's own); the prompt has a "job pack" section; `packGapsFor`
  turns a supplied sized item with no sizes / spec into a large customer gap and `normalizeIntake`
  downgrades `quote_ready` to `needs_info` when one exists, so Route A never prices a supplied door
  with no size. The fields ride through `intakeFromArtifact` → `pricing_line_items` (`packFieldsOf`),
  which P12b's price screen already reads.
- **Route A** (`route-a.ts` → `job-pack-writers.ts`): after the draft, `writePackFromChain` writes
  the clerk's lines then the estimator's judgement (procedure, category, minutes range, materials
  with supplier / sku / size / price, access notes; `EstimateMaterial.size` added, estimator
  passes it through). Same on the orphan-fallback path. Injectable (`RouteADeps.writePack`).
- **Ben** (`price-screen.ts`): `confirmPrices` applies his prices, materials-as-sent and
  assumptions-as-sent to the pack and the quote's `pricing_line_items` are `derivePricingLineItems(pack)`
  from then on; a quote with no pack keeps the P8 write.
- **Rules layer** (`job-pack-asks.ts`, `rules-layer.ts`, `approver.ts`, `types.ts`, `vocab.ts`,
  `packs/rules-followup.ts`): intent `job_pack_ask`, approver `rules.job_pack`, fixed wording per
  field (`JOB_PACK_ASK_COPY`, no price, no date, one question), order access → contact → parking →
  pets → prep → delivery, ≤ 1 per thread per day (`lastJobPackAsk` reads the draft reason
  `[job_pack_ask] Job pack: <field> …`), 08–20 UK, UK numbers only, stops when nothing is missing,
  never the same field twice in a row. `sendJobPackAsk` goes through the rules layer's own
  `deliver` (window / template `job_pack_ask_v1` / SMS / else Ben's queue). Runs from the slow
  sweep (`comms-sweep.ts`) on deposit-paid quotes.
- **Live filing** (`job-pack-filing.ts`, hooked in `spine/index.ts` after triage on an inbound when
  the thread has a quote): `parseDeliveryAnswer` (key safe + code, someone home, a named contact
  with a mobile, pets, parking → the quote's parking vocabulary, delivery, prep, floor / lift, and
  "the answer to the question we asked yesterday" when short and plain); `isRescopeText` (P9
  `looksLikeRescope` + measurements / instead / another) → never filed, logged as a hold; the clerk
  (`clerkClassifier`, one small model call, JSON, restricted to the fileable fields) only when the
  rules found nothing; every filing is a change-log row with `source: customer`.

## Part 3 — readers
- **Dispatch** (`contractor-dispatch.ts` draft-from-quote): when a pack exists the tasks come from
  `dispatchLinesFromPack` (category, minutes point, labour, materials with supplier / sku / size /
  price, per-task photos from `mediaIds`, the customer's words, procedure, assumptions, exclusions,
  hazards, disposal on `task.pack`) and `dispatchBlockers` refuses with **422 `JOB_PACK_INCOMPLETE`**
  listing every missing dispatch-critical field in words (no category / minutes / price on a line;
  the clerk's price-critical fields the pack requires). The regex / £50-an-hour fallback stays ONLY
  for quotes with no pack and logs `no job pack for quote … fallback`. `POST /api/admin/dispatch`
  locks the pack (`locked_at`, `dispatch_id`). `GET /api/contractor-job/:token` and
  `GET /api/dispatch-link/:token` carry `jobPack` (`contractorPackView`: codes and the contact only
  after acceptance, media signed, `changes` since `acceptedAt`).
- **Booking engine**: `siteContextFromPack` puts the pack's floor / lift / parking / occupied over
  the quote's columns when a pack exists.
- **Portal** (`client/src/components/contractor/JobPackSection.tsx`): `JobPackTask` (her words,
  the photo for that task, how, priced on the basis that, not included, bring / buy with where to
  buy, watch for, waste), `JobPackJob` (getting in, who is on site, parking, pets, prep, delivery,
  water / power, done looks like; "unlocks on accept" before), `ChangedSinceStrip`, `PackChip`.
  Used in `ContractorJobSheet` (per task inside the expanded task, "On the day" section, the strip
  at the top after acceptance), `DispatchLinkPage` (pre-accept), the dashboard `JobDetailsPage`
  (`/api/jobs/:id` carries `jobPack`) and `MyJobsTab` (`/api/contractor/bookings` rows carry
  `pack` → "Pack complete" / "N missing", the row already links the job page).

## Part 4 — contractor WhatsApp
- `server/spine/job-pack-notify.ts`: `readyBody` ("Job pack for <title>, <outward postcode>, <date
  in words>: <link>") on dispatch create (every contractor it was sent to) and on accept (that
  contractor); `changedBody` ("Update on <title> <date>: <fields> changed. <link>") when a
  day-relevant field changes after acceptance, at most one an hour per job (`lastChangedNotice` on
  the draft reason / the ledger), the fields since the last notice batched. Both go through
  `sendCustomerMessage` (approver `rules.job_pack`, purpose `service_reply`, the ledger's
  message_out) to `handymanProfiles.whatsappNumber` (else the link's phone), deep-linking to the
  contractor's private page. `guardContractorBody` refuses money, a phone number, a full postcode,
  a street, the customer's surname, a dash. Pipe: window → freeform; else an approved template
  (`job_pack_ready_v1` / `job_pack_changed_v1`); else queued for Ben with the reason naming the
  template to submit. Hooks: dispatch create, accept, and the filing path (`afterPackChange`).
- `docs/comms-build/TEMPLATES-JOB-PACK.md`: the two bodies with variables and sample values for
  the owner to submit.

## Verification

| Gate | Result |
|---|---|
| tsc vs `8a73900` | 1,869 → 1,869; (file, error code) multiset identical |
| server vitest | after: 42 failed / 1,102 passed (78 files), the baseline set. The baseline run (throwaway worktree, alongside the foreground suite) showed 43: the 42 plus the known timing benchmark `call-script/__tests__/performance.test.ts` (flakes under load; passes on the current tree) |
| `npm run test:client` | 79 passed (8 files) |
| esbuild `server/index.ts` | bundles |

Server suite run with a placeholder `DATABASE_URL` (no `.env` in the worktree; no connection is
made), the baseline the same way in a throwaway worktree at `8a73900`. No dev server, no database,
no `app_settings`, no push. Migration written, not applied.

## Not done, and why
- **`TimelineItem` has no message id**, so the clerk cites ids from its own `get_thread` (which
  now shows them). The case-file pane can add `messageId` to `TimelineItem` later; nothing here
  depends on it.
- **The clerk's model pass in live filing** costs one small call per unmatched short inbound on a
  quoted thread (Haiku, ≤ 120 tokens); it is skipped when no model key is configured and never
  runs on a rescope. Watch the cost line after the first live day.
- **Dispatch blocks on line fields, warns on job fields.** Pets / prep / delivery are asked after
  the deposit and can arrive after dispatch (job.* stays live), so they are `jobPack.missing` on
  the draft response, not a 422. Sizes / spec / disposal / hazards / lead time on a line ARE a 422.
- **Existing dispatches** (before P13) have no pack: the fallback runs and logs; the portal shows
  no pack section. Nothing to migrate.
- **`job_pack_changed` after a Ben edit** is not wired: after the lock, line fields throw
  `PackLockedError` (the variation path), and Ben has no UI for job fields yet; the customer's
  filings are the live source of change and they notify.
- **The `lastChangedNotice` proxy** for a freeform send reads the ledger's outbound body
  ("Update on …") on the contractor's number; a template send is found by its draft. Good enough
  for one-an-hour; a `job_pack_notices` row would be exact if it ever matters.
