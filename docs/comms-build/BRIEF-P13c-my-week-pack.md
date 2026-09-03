# P13c: the job pack on the contractor's schedule (My Week) and an owner preview (pane bottom-left)
Worktree: /Users/courtneebonnick/v6-wt-worker (branch p13c-my-week-pack, from comms-v3)

Owner, 3 Sep: "we need to be able to see this in the jobs section under MJ's job on the schedule."
P13 wired the pack into the dispatch sheet, the dashboard job page and the jobs list, but the
schedule contractors actually use is the tokenised My Week app: `/my-week/:token`
(`client/src/pages/contractor/MyWeekPage.tsx`, data from `server/contractor-app-routes.ts`
`GET /:token/jobs`, job detail drawer with materials and "Buy" links). The dashboard job page is
behind the contractor login (`ContractorDashboardLayout` redirects to `/contractor/login`), which is
why the owner saw nothing at `/contractor/dashboard/jobs/2d21da09-…`. Test case: MJ, quote
`uhj5jips`, booking `2d21da09-6fc4-42b6-b036-ea013bb654c6`, contractor Craig Smith
(`hp_aa21264a-9143-4116-bda2-2da998255929`); pack `jp_55ci9dr8mtl3crnz` exists in production
(1 task, 4 photos, 9 missing). Same rules as every brief (worktree only, no DB, no app_settings,
no push, gates, commit, `P13c-DONE.md` in the worktree root).

## Build
1. **`GET /api/contractor-app/:token/jobs`**: each booked job gains `jobPack` =
   `contractorPackView(pack, { accepted, acceptedAt, mediaUrlsFor })` from
   `server/spine/job-pack-readers.ts` (by the booking's quoteId, `loadPackForQuote`), plus
   `packChip` for the card. Null when no pack. One query per page, not per job (batch by quote ids).
2. **My Week job detail drawer**: under the existing materials block, the same `JobPackSection`
   components the dashboard uses (`client/src/components/contractor/JobPackSection.tsx`): per task
   the customer's words, that task's photos, procedure, assumptions, exclusions; per job the fields
   with missing marked; the "Changed since you accepted" strip. Address, codes and contact only
   when the booking is accepted (already true for MJ). The day card shows the chip
   ("Pack complete" / "9 missing").
3. **Owner preview without a contractor login**: extend the existing admin preview pattern
   (`WeekPlannerPreview.tsx` / `DispatchPreviewPage.tsx`, find their routes in App.tsx) so an
   admin can open `/admin/my-week-preview/:contractorId` (requireAdmin) and see that contractor's
   My Week exactly as they do, including the pack. Read-only; no actions post from the preview.
4. **Materials run page** (`ContractorMaterialsRunPage.tsx`): if it lists materials per job, read
   them from the pack when one exists (supplier, size, price) instead of the quote line names.
5. Tests: server (jobs payload carries jobPack for a booked job with a pack, null without; batch
   query) and jsdom (drawer renders the task quotes and photos, the missing list, the chip; preview
   route renders read-only).

## Not in scope
Notifications, the dashboard pages (done in P13), the pack's writers.
