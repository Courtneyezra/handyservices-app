# P13b — back-fill MJ's booked job into a job pack (DONE, code only; the orchestrator runs it)

Branch `p13b-backfill` from `comms-v3` at `cf5597e8`, worktree `/Users/courtneebonnick/v6-wt-worker`.
Brief: `docs/comms-build/BRIEF-P13b-backfill-mj.md`. No database was touched from this pane.

## What the portal reads (the join question in the brief)

`/contractor/dashboard/jobs/:id` (`JobDetailsPage.tsx`) fetches `GET /api/jobs/:id`
(`server/job-assignment.ts:156`), and `:id` is the **`contractor_booking_requests` row**. P13 already
wired that route: it calls `loadPackForQuote(booking.quoteId)` and renders `contractorPackView`
(codes + contact gated on `acceptedAt` / `assignmentStatus`). So the booking-based page renders the
pack as soon as a `job_packs` row exists with `quote_id = quote_p80XgGRDNXjT4ZdgOsDDG`. **No schema
change and no new join**: `quote_id` is the key, exactly as P13 left it. The dashboard list chip
(`/api/contractor/bookings`) reads the same key. `contractor_jobs` / `job_sheets` are not on this
page's read path.

## Built

- `server/spine/job-pack-backfill.ts` — pure at the top, reads at the bottom:
  - `readQuoteLineItems(pricing_line_items)`: any engine's shape → one plain line (ids by P13's
    `derivePricingLineItems` rule: `lineId`, else position `card_N`; Ben's override wins over the
    engine's time / price; `guardedPricePence + materialsWithMarginPence` for the legacy shape).
    `supplyByFromTitle` reads "Supply and fit" as `us`, "customer supplied" as `customer`, "labour
    only" as `none`, else null. Nothing else is inferred.
  - `buildBackfillPack(sources)`: the four sources in the brief's order through P13's own writers
    (`linesFromClerk` → `mergeEstimate` → `applyBenEdits`, then the estimate if one exists, then
    the thread: P12b `evidenceForLines` for her words + photos by time, and the P13 filing rules
    (`parseDeliveryAnswer` + `decideFiling`) over EVERY inbound, latest answer wins, verbatim; a
    rescope-looking message is never filed and is listed for Ben), then the booking's access notes
    and the lock. Every diff is a change-log row at `now`, source `system`, by the script, plus ONE
    marker row per source that changed something ("backfilled from quote lines / estimate / thread
    / booking / dispatch"); a re-run that changes nothing appends exactly one `re-run: nothing changed`.
    A locked pack refuses changed line fields (reported as `FROZEN`, not written) but still files
    job fields. `required` / `missing` come from P13's `requiredFor` / `missingFor` untouched.
  - `lockForJob`: with a dispatch it is P13's `lock` (dispatch_id set); without one, `locked_at` is
    set, `dispatch_id` stays null and the lock row records `booking:<id>`. Idempotent.
  - `renderBackfillReport`: the dry-run print (lines, job, required, missing in words, what was
    filed and from which message, what was skipped, sources, change-log rows this run, the summary
    line, the URLs).
  - `bookingNoticeTitle` + `notifyJobPackReadyForBooking`: the `job_pack_ready` notice for a booking
    with no dispatch, through P13 part 4's `sendToContractor` as it is (window → freeform; approved
    template `job_pack_ready_v1` / `job_pack_ready`; else queued for Ben with the reason). Link =
    `/contractor/dashboard/jobs/<bookingId>`. Same PII / money guard.
  - `loadBackfillSources(slugOrId)`: read-only loaders. Conversation by the quote's phone against
    `conversations.phone_number` (last 10 digits, customer lane, newest), overridable with
    `--conversation`. Estimate by `draft_quote_id`, else the newest live one on the thread. Booking
    by `quote_id` (accepted first), overridable with `--booking`. Contractor from
    `handyman_profiles` + `users` (name; `whatsapp_number` else `users.phone`). Dispatch only if one
    exists (with its link tokens). Existing pack via `getPackForQuote`; a missing table is reported.
- `scripts/_backfill-job-pack.ts <slug|quote_id> [--apply] [--notify] [--conversation <id>]
  [--booking <id>] [--by <name>]` — dry run by default; `--apply` upserts through `savePack` (unique
  on `quote_id`); `--notify` needs `--apply`. Refuses `--apply` if `job_packs` is absent.
- `server/spine/job-pack-backfill.test.ts` — 14 tests on MJ's shape (one line, sash windows, two
  photos five minutes after the ask, "we'll be in all day" after the quote, accepted booking, no
  dispatch, no estimate): the dry-run pack field by field, the report, nothing invented on an empty
  thread, the rescope skip, a pending booking not locked, the dispatch variant, an estimate
  merging, the second run appending exactly one row, the locked-pack conflict, `lockForJob`, the
  notice body / guard / no-phone.

## What MJ's dry run should show (from the fixture; the real thread decides)

- One line `card_1` "Supply and fit bespoke portable AC window kit to TWO sash windows and secondary
  glazing units", £224 (labour / materials split as the quote row has it), `supplyBy: us`, her
  words from the inbound that named the windows, both photos (a one-line job takes every inbound
  photo: there is nothing else they could show).
- `required`: the six delivery fields + `sizes`, `spec` (we supply windows) + `leadTime` if the
  line carries materials. `missing` = those minus whatever the thread answered. Expect sizes and
  spec to be missing: the quote predates the clerk, and a measurement in a customer message is a
  rescope for Ben, never a pack edit.
- Locked to `booking:2d21da09-6fc4-42b6-b036-ea013bb654c6`, `dispatch_id` null.
- Summary line: `pack for uhj5jips: 1 line, N required, K missing: <fields in words>` and
  `open: /contractor/dashboard/jobs/2d21da09-6fc4-42b6-b036-ea013bb654c6`.

## Orchestrator: run order

1. If `job_packs` is not applied on production yet (P13 wrote it, never applied):
   `npx tsx scripts/_apply-migration.ts migrations/20260906_job_packs.sql`. The dry run says so if it
   is missing; `--apply` refuses without it.
2. `npx tsx scripts/_backfill-job-pack.ts uhj5jips` — read the print. If the conversation line says
   NONE, pass `--conversation 8785700b-a97c-4cb7-b23a-5982749bf318`.
3. `npx tsx scripts/_backfill-job-pack.ts uhj5jips --apply --by <you>` — then open
   `/contractor/dashboard/jobs/2d21da09-6fc4-42b6-b036-ea013bb654c6` as the contractor
   (`hp_aa21264a…`) and check the pack section renders: task with her words + photos, job fields,
   "N missing" chip on the list. Run `--apply` again: one more change-log row, nothing else moves.
4. Only if wanted: `--apply --notify`. With the templates not yet approved and no open window to
   the contractor's number, it lands in Ben's queue with the reason (never silent).

## Decisions and caveats

- **"Changed since you accepted" strip.** MJ accepted on 2 Sep; the backfill rows are dated when the
  script runs, so `changesSince(acceptedAt)` will list the backfilled fields on first view. That is
  honest (the pack did not exist when he accepted) and the P13 readers were not changed for it.
- **Lock without a dispatch** leaves `dispatch_id` null, so `afterPackChange` / `notifyJobPackChanged`
  (dispatch-keyed) stay inert for this job: a later customer answer files silently into the pack and
  the portal page shows it, but no `job_pack_changed` WhatsApp goes out. Dispatch-based jobs are
  unaffected.
- **Filing over every inbound**, including pre-quote ones, per the brief; the "answer to the question
  we asked" branch is not used (no `lastAskedField` in a backfill).
- Test env: `job-pack-filing` → `triage` imports `server/db` at load, which throws without
  `DATABASE_URL`; the test sets an offline placeholder via `vi.hoisted` (setup.ts still refuses the
  production marker). The worktree has no `.env`; the whole suite was run with the same placeholder
  to get the documented baseline.

## Verification

- `npx tsc --noEmit`: 1869 errors before, 1869 after (same set; none in the touched files).
- vitest server (with the placeholder `DATABASE_URL`): 42 failed before, 42 failed after, identical
  failing set; 79 files, 1116 passed (+14 new).
- esbuild: `server/index.ts` bundles; `scripts/_backfill-job-pack.ts` bundles on its own (4.3 MB).
- Not run: the script against a database (no access from this pane).
