# P13c — the job pack on My Week (the contractor's schedule) and an owner preview

Branch `p13c-my-week-pack` from `comms-v3` (`378fd232`), worktree `/Users/courtneebonnick/v6-wt-worker`.
Brief: `docs/comms-build/BRIEF-P13c-my-week-pack.md`. No database access from this pane; no
migration, no `app_settings`, no push.

## What I built

1. **`GET /api/contractor-app/:token/jobs` carries the pack** (`server/contractor-app-routes.ts`).
   `loadJobsAndGrid` now selects `acceptedAt` on the booking rows and, after the quote rows, loads
   every booked quote's pack in **one query per page** (`loadPacksForQuotes`, plus one query for
   the media ids). Each booked job gains `jobPack` = `contractorPackView(pack, { accepted,
   acceptedAt, mediaUrlsFor })` and `packChip` = `{ complete, missing, label }`; both null when the
   quote has no pack. Codes and the on-site contact show only once the booking is accepted
   (`bookingAccepted`: `acceptedAt`, `status = accepted`, or `assignmentStatus` in accepted /
   in_progress / completed, the same rule as the dashboard job page). A missing `job_packs` table
   or a failed read logs and yields an empty map: the pack is optional everywhere it is read.
2. **My Week job drawer** (`client/src/pages/contractor/MyWeekPage.tsx`): under the existing
   materials block, `JobPackPanel` (`client/src/components/contractor/JobPackPanel.tsx`) renders
   the P13 `JobPackSection` components on a light card inside the dark drawer: the "Changed since
   you accepted" strip, per task the customer's words / that task's photos (tap → the page's
   lightbox) / how / priced-on-the-basis-that / not included / bring-buy with where to buy, and
   per job access, who is on site, parking, pets, prep, delivery with the missing ones marked and
   the "Still being confirmed: …" line. The day card and the "Next job" card show `PackChip`
   ("Pack complete" / "9 missing"), on the first span day only.
3. **Owner preview without a contractor login**:
   - `GET /api/admin/my-week-preview/:contractorId` (`server/my-week-preview-routes.ts`,
     `requireAdmin`) → `{ contractorId, name, token, url }`: the contractor's existing app token
     (minted once if absent, the same once-only mint the code login does; nothing else written).
   - `/admin/my-week-preview/:contractorId` (`client/src/pages/admin/MyWeekPreviewPage.tsx`,
     behind `ProtectedRoute role="admin"` in `App.tsx`): an amber "Preview · <name>'s My Week ·
     read-only, nothing sends from here" bar with a back link and the live link, then the **same
     `MyWeekPage`** mounted with `token` and `readOnly` props. So what the owner sees is exactly
     what the contractor sees, pack included, at phone width.
   - `MyWeekPage` gained `{ token?, readOnly? }` props (the contractor's own link passes nothing
     and reads the route as before). `readOnly` makes **every mutation refuse** before its fetch
     (`guard()` at the top of the diary-done, day-plans lock, flex place / place-block, move, day
     and pattern mutations, exported message `PREVIEW_READ_ONLY`), keeps the completion sheet
     from opening (so its photo / complete / prize posts are unreachable), and turns "Log out" into
     a plain return to `/admin/dispatch` instead of a POST.
4. **Materials run** (`GET /:token/materials-run` + `ContractorMaterialsRunPage.tsx`): where a job
   pack exists with materials, `runMaterialsFromPack` replaces the quote line materials with the
   pack's (Ben's qty, supplier, SKU, size, price), borrowing the image and the buy link from the
   quote's matching material (by SKU, else name). A pack with no materials, or no pack, falls
   back to the quote's as before. The aggregate now carries `size`, and the run-list row shows it
   ("£10.00 each · 600 × 400 mm").
5. **Pure helpers added to `server/spine/job-pack-readers.ts`**: `loadPacksForQuotes(ids, deps?)`
   (injectable reads), `bookingAccepted`, `bookingPackFields`, `runMaterialsFromPack`.

## Tests (11 new, all green)

- `server/spine/job-pack-myweek.test.ts` (6): the batch loader asks for the rows ONCE with the
  distinct quote ids and the media ONCE with every media id, maps only quotes that have a pack,
  empty on no ids / missing table, survives a media failure, rethrows anything else; the booked
  job payload carries `jobPack` + `packChip` with a pack (her words, photos, materials, codes open
  once accepted, the missing labels, the changed-since strip) and both null without; the run
  materials come from the pack with the quote's image / link borrowed, name-match pricing, and
  the fallbacks.
- `client/src/components/contractor/__tests__/JobPackPanel.test.tsx` (3, jsdom): the drawer
  panel renders the task's quotes and both photos (tap → `onPhoto`), the materials with where to
  buy, the job fields with the missing list, the chip; "Pack complete" + the changed strip;
  nothing without a pack.
- `client/src/pages/admin/__tests__/MyWeekPreviewPage.test.tsx` (2, jsdom): the admin call goes
  out with the bearer token, the banner names Craig and says read-only, My Week is fetched with
  his app token, MJ's card shows "9 missing", tapping it opens the drawer with the pack (her
  words, two photos, access, the missing line), and **no non-GET request is made**; an unknown
  contractor shows the endpoint's error rather than a dead-link page.

## Verification gates

| Gate | Result |
|---|---|
| tsc (`npx tsc --noEmit`) | 1869 errors at start commit, 1869 after; identical set (only tsc's union-member ordering differs in a few messages), none in touched files |
| vitest (server + client, offline placeholder `DATABASE_URL`) | 42 failed before, 42 failed after, identical failing set; 90 files (+3), 1206 passed (+11), client project green |
| esbuild `server/index.ts` | bundles |
| `vite build` | builds (two pre-existing Tailwind class warnings) |
| Worktree only, no DB, no `app_settings`, no push, no migration | yes |

## For the orchestrator / owner

- Open `/admin/my-week-preview/hp_aa21264a-9143-4116-bda2-2da998255929` with an admin session:
  Craig's My Week, MJ's job on the 8 Sep card with the chip, the drawer with the pack
  (`jp_55ci9dr8mtl3crnz`: 1 task, 4 photos, 9 missing). The live link in the bar opens
  `/my-week/<token>` as Craig sees it.
- The chip text is what `job_packs.missing` says; "9 missing" for MJ until sizes / spec / lead
  time and the delivery fields are filled.

## Not done / caveats

- **Pack photos are not S3-signed on My Week**, matching the dashboard job page (P13's
  `/api/jobs/:id`) rather than the dispatch sheet, which signs. MJ's pack media are message
  `/api/media/…` read-through URLs, which the read-through serves; a raw S3 URL outside the
  public prefix would 403 here as it does on the dashboard page.
- **The preview hands the admin the contractor's app token** (it has to: the token is the
  credential the app runs on). Read-only is enforced on the page, not the API; an admin who copies
  the token into `/my-week/<token>` has the live page, which they could already mint from
  the contractor's login. No preview-only API surface was built.
- The `readOnly` guard covers the seven mutations in `MyWeekPage` and the completion sheet's
  entry point; the materials link (`/my-week/:token/materials`) is a read-only page already.
- Not run against a database from this pane; the payload shape is asserted through the pure
  `bookingPackFields` and the injected-deps loader, not an HTTP call.
