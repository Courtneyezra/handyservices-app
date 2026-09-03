# P13b: back-fill a job pack for a booked job so we can test the handover (pane bottom-left)
Worktree: /Users/courtneebonnick/v6-wt-worker (branch p13b-backfill, from comms-v3)

Test case, owner's choice: **MJ, +447760498854**. Quote `uhj5jips` (id `quote_p80XgGRDNXjT4ZdgOsDDG`),
created 1 Sep, deposit paid, one line: "Supply and fit bespoke portable AC window kit to TWO sash
windows and secondary glazing units", £224. An earlier quote `japvc89r` (30 Aug, one window) was superseded by it. Conversation
`8785700b-a97c-4cb7-b23a-5982749bf318` (phone column is `conversations.phone_number`), stage `won`,
tags photos_received + quote_sent. **There is NO `job_dispatches` row.** The booking is a
`contractor_booking_requests` row `2d21da09-6fc4-42b6-b036-ea013bb654c6`: status accepted, scheduled
2026-09-08, contractor `hp_aa21264a-9143-4116-bda2-2da998255929` (look up the name in
`handyman_profiles`). Find which record the contractor portal's dashboard job page
(`/contractor/dashboard/jobs/:id`, `client/src/pages/contractor/dashboard/JobDetailsPage.tsx` via
`server/contractor-dashboard-routes.ts`) reads for a booking like this (`contractor_jobs` /
`job_sheets` / the booking request) and link the pack to THAT so the pack section P13 added actually
renders for MJ; if P13 only wired dispatch-based pages, add the booking-based join (`job_packs`
keeps `quote_id` as the key; add nothing to the schema unless unavoidable, and then idempotent SQL
only, not applied). No `job_packs` row exists.

Same rules as every brief: worktree only; NO database access (you write the script, the orchestrator
runs it against production); no `app_settings`; no push; zero new tsc errors; server vitest failing
set unchanged (42); esbuild bundles; commit; `P13b-DONE.md`.

## Build `scripts/_backfill-job-pack.ts <slug> [--apply] [--notify]`
Dry run by default: print the pack it WOULD write (lines, job, required, missing, change_log) and
exit. `--apply` upserts the `job_packs` row through `server/spine/job-pack.ts` (the P13 store), links the booking (and `dispatch_id` if a dispatch exists) and, since the booking is accepted, locks the line fields. `--notify` additionally sends the
`job_pack_ready` contractor notice through the P13 notify path (template / in-window / Ben's queue as
it is).

Sources, in this order, all read-only:
1. `personalized_quotes.pricing_line_items` → lines (title, category, minutes, materials, assumptions).
2. `quote_estimates` for the conversation, if any → procedure, minutes range, materials with supplier
   and price, access notes (MJ may have none: the quote predates Route A; handle absence).
3. The thread (`messages` on the conversation; find the phone column name in `conversations`) →
   per-line evidence by the P12b `evidenceForLines` ranking, and job fields by the P13 filing rules
   run over EVERY inbound (not just post-quote): access method, contact, parking, pets, prep, delivery.
   Photos: the thread's media by time, as P12b does.
4. The booking request → scheduled date, contractor, accepted (lock), and the quote's address/postcode for the portal; `job_dispatches` only if one exists.
5. Nothing is invented. A field with no source stays empty and lands in `missing`; the change log gets
   one `system` entry per source ("backfilled from quote lines", "…from thread", "…from dispatch").
   The customer's own words are quoted verbatim.

Also: a one-line summary at the end of the run, "pack for <slug>: N lines, M required, K missing:
<fields>", and the portal URL(s) the orchestrator should open to check (`/contractor/dashboard/jobs/<id>` for this booking, and `/contractor-job/<token>` only if a dispatch link exists).

Tests: a fixture built from MJ's shape (one line, sash windows, two photos, a "we'll be in all day"
inbound) asserting the dry-run output; the script's pure `buildBackfillPack` exported and tested.
Idempotent: a second `--apply` updates the same row (unique on quote_id) and appends one change-log
entry, never duplicates.
