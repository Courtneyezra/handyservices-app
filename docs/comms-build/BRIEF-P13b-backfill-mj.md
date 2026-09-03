# P13b: back-fill a job pack for a booked job so we can test the handover (pane bottom-left)
Worktree: /Users/courtneebonnick/v6-wt-worker (branch p13b-backfill, from comms-v3)

Test case, owner's choice: **MJ, +447760498854**. Quote `uhj5jips` (id `quote_p80XgGRDNXjT4ZdgOsDDG`),
created 1 Sep, deposit paid, one line: "Supply and fit bespoke portable AC window kit to TWO sash
windows and secondary glazing units", £224. An earlier quote `japvc89r` (30 Aug, one window) was
superseded by it. There is a dispatch for it (find it by quote_id in `job_dispatches`; the column
names differ from the P13 brief, read the schema). No `job_packs` row exists (P13 creates packs only
for intakes the clerk marks ready from now on).

Same rules as every brief: worktree only; NO database access (you write the script, the orchestrator
runs it against production); no `app_settings`; no push; zero new tsc errors; server vitest failing
set unchanged (42); esbuild bundles; commit; `P13b-DONE.md`.

## Build `scripts/_backfill-job-pack.ts <slug> [--apply] [--notify]`
Dry run by default: print the pack it WOULD write (lines, job, required, missing, change_log) and
exit. `--apply` upserts the `job_packs` row through `server/spine/job-pack.ts` (the P13 store), links
`dispatch_id` and, if the dispatch is already accepted, locks it. `--notify` additionally sends the
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
4. `job_dispatches` → scheduled date, contractor, acceptedAt (lock), address fields for the portal.
5. Nothing is invented. A field with no source stays empty and lands in `missing`; the change log gets
   one `system` entry per source ("backfilled from quote lines", "…from thread", "…from dispatch").
   The customer's own words are quoted verbatim.

Also: a one-line summary at the end of the run, "pack for <slug>: N lines, M required, K missing:
<fields>", and the portal URL(s) the orchestrator should open to check (`/contractor/dashboard/jobs/<id>`
and `/contractor-job/<token>` if a link exists).

Tests: a fixture built from MJ's shape (one line, sash windows, two photos, a "we'll be in all day"
inbound) asserting the dry-run output; the script's pure `buildBackfillPack` exported and tested.
Idempotent: a second `--apply` updates the same row (unique on quote_id) and appends one change-log
entry, never duplicates.
