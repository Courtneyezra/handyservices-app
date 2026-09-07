# T9 — the price queue: DONE report

Brief: `BRIEF-T9-price-queue.md`. Branch `fm/price-queue-t9` from `d45f94f`. 7 Sep 2026.

**Nothing in this report was seen running.** This worktree has no `.env`, no database, no key and
no dev server. Everything below rests on the unit tests and the build gate; no claim is made that
the page works or looks right. The first section is what to do about that.

## How to check this (copy and paste, for a non-developer)

After the PR is merged and the site has redeployed, on your phone, logged in as admin:

1. **Open `https://www.handyservices.app/admin/price`.**
   - You should see a heading *Price queue*, a line like *3 waiting · oldest 4 days*, and one card
     per quote: the customer's first name, their postcode in a black chip, the job in a few words,
     and on the right, in large type, how long it has waited (*2 h*, *1 day*, *4 days*).
   - Oldest is at the top. A quote that has waited a day or more has a red border and a red age
     with a warning triangle; 4 to 24 hours is amber; under 4 hours is plain.
   - Under some cards, small chips: *1 to check*, *2 need a price*, *1 to resolve*, *estimator
     failed*, *low confidence*. A card with nothing to flag has no chips.
   - If nothing is waiting, it says *Nothing waiting to be priced.*
   - **Fault:** a red box *Couldn't load the queue*, or a spinner that never ends, or a card with
     a £ figure anywhere on it (there must be none).
2. **Tap a card.** It opens the normal price screen for that quote (`/admin/price/<code>`).
   - In the sticky header at the top, under the name chips, a grey one-line strip:
     *2 more waiting · Next: Gemma, 2 days → · All*. The count never includes the quote you are
     looking at. If this is the last one it says *Nothing else waiting · All*.
   - **Fault:** the strip covering any price line, or sitting in the bottom button bar; a count
     that includes the quote on screen.
3. **Price and send one** as normal. On the green *Sent* screen the *Next quote waiting* button
   should name the oldest of the rest with its age, and under it a small *N left in the queue*
   link. Tap it: the queue page should be one shorter, and the quote you sent gone from it,
   **without pulling to refresh**.
   - **Fault:** the sent quote still on the list; the count not going down.
4. **On another quote, tap *Ask her first*** (or *Call her* / *Needs a visit*). The strip's count
   should drop by one the moment the hold is confirmed, and that quote should no longer be on the
   queue page (it comes back when her answer clears the hold, exactly as before).
5. **Open the admin sidebar** (the ☰ on a phone). Under DISPATCH CONSOLE, between *Comms* and
   *Sandbox*, there is a *Price queue* entry with a **number badge** when something is waiting and
   no badge when nothing is. It counts the same cards as the page.
   - **Fault:** the badge and the page disagreeing for more than a minute; a badge on the
     entry when the page says nothing is waiting.
6. **Log out and open `/admin/price`.** You should be sent to log in, and after logging in land
   back on the queue.

If step 1 shows a quote you know was priced and sent, or hides one you know is waiting, that is
the shared "waiting" rule (below), not the page, and it needs a decision (BACKLOG **T9-a**).

## What shipped

### The one definition of "waiting"

`loadNextWaiting` in `server/spine/price-brief.ts` already defined a Route A draft waiting to be
priced: an unsent draft, not superseded or revoked, priced by the chain (`pricing_suggestions`
present), not parked by Ben with Ask / Call / Visit. That WHERE clause is now the exported constant
`WAITING_DRAFT_WHERE`, read by `loadNextWaiting` (the confirm screen's *Next quote waiting*
button, unchanged in behaviour) and by the queue. **There is no second query for what counts as
waiting.** The pure builder re-applies the same rule (`statusOf === 'draft'`, `holdOf === null`)
as a belt, so a row the SQL let through by mistake cannot be listed.

The rule was not changed. One consequence is worth knowing and is in BACKLOG as **T9-a**: a draft
saved by hand from the intake card has no suggestions and is therefore in neither the confirm
button nor the queue. Route A always writes suggestions (a failed estimator still prices the
fallback draft with check-this on every line), so every Route A draft is covered.

### `GET /api/spine/price-queue` (`server/spine/price-queue.ts`, `routes.ts`)

Read-only, behind the existing `requireAdmin`, registered before `/price/:slug` on purpose. One
select over `personalized_quotes` with `WAITING_DRAFT_WHERE`, oldest first, capped at 200; one
select of the newest non-superseded `quote_estimates` row per draft (the table may be absent,
`42P01` tolerated as the price screen does); then the pure `buildPriceQueue`. Each item carries
who, where, the job in a few words (`jobPhrase` of the lines, else the row's description), when
the draft was created (i.e. when the single Pushover fired), how long it has waited, and
`signals: { checkThis, unpriced, contradictions, lowConfidence, estimateStatus }` computed by the
price screen's own `buildScreenLine` and `findContradictions`. Nothing is invented.

**No money figure leaves the module.** `buildScreenLine` is given a margin of 0 because the only
pence it would shape is never read, and the payload type has no pence field (a test asserts the
serialised item never contains "pence").

### `/admin/price` (`client/src/pages/admin/PriceQueuePage.tsx`, `App.tsx`)

Phone first: one column of cards at `max-w-md`, two columns from `md`. Age is the point: oldest
first always; under 4 h plain, 4 h to a day amber, a day or more red with the border and the age
both loud. Chips only when a signal is non-zero. The whole card is the link. Empty state, the
expired-session link the price screen uses, refresh button, refetch on focus and every 60 s.
The route sits before `/admin/price/variation/:id` with a comment; wouter matches `/admin/price`
exactly, so it cannot shadow either existing route.

### The sidebar entry (`SidebarLayout.tsx`)

DISPATCH CONSOLE, between Comms and Sandbox, `PoundSterling` icon, label *Price queue*, badge =
the count when > 0 (the Segment Review idiom). **Cost:** it is the same cached react-query the
page and the price screen read (`client/src/hooks/usePriceQueue.ts`, key `['spine-price-queue']`),
so on `/admin/price` and `/admin/price/:slug` it is not an extra request; on other admin pages it
is one select per mount and one a minute while the tab is open, the same shape and cadence as the
Segment Review and Follow-Ups badges already there. It is skipped entirely when there is no admin
token in local storage (the endpoint would only answer 401). BACKLOG **T9-c** if it ever shows in
the DB logs.

### The strip on the price screen (`PriceAndSendPage.tsx`)

One 32 px line inside the existing sticky header, under the name chips and above the phone tabs:
*2 more waiting · Next: Tom, 1 day → · All*. Never in the thumb bar, never over a line (a test
pins both). Count and next exclude the quote on screen. Source: the shared queue query; the
payload's own `nextWaiting` stands in while the queue loads or if the endpoint fails.

**It shrinks as he works.** A successful send and a successful *Ask her first* / *Call her* /
*Needs a visit* (each sets a hold, which removes the quote from the queue) invalidate the queue
query, so the strip, the confirm screen's *Next quote waiting* button (now the refetched queue's
oldest, with its age, over the send's own stale `nextWaiting`) and the sidebar badge all move
without a manual refresh. The confirm screen also says *N left in the queue*, linking to the page.

## Not touched

The comms spine, send preconditions, tiers, the sandbox, media settings, the first-contact ack,
every price value, `loadNextWaiting`'s behaviour. No new mutation endpoint: nothing here prices,
sends, approves, edits, dismisses or deletes. No migration, no `db:push`, no `app_settings` flag.
No customer-facing chase and no new or repeated notification (PRD v3 §9: both or neither; the
owner has not authorised that here).

## Build gate, as measured

Both sides measured in this worktree with the same placeholder `DATABASE_URL` (a socket that never
connects). "Before" is `d45f94f` as checked out; "after" is this branch. The vitest diff is test by
test from the JSON reporters, not counts.

| Check | Start `d45f94f` | This branch |
|---|---|---|
| `tsc --noEmit` errors (8 GB heap) | 1,880 | 1,880 |
| tsc errors NEW vs start | — | **0** (per-file counts identical; the eight touched sources 0 → 0 apart from `SidebarLayout.tsx` 3 → 3 and `App.tsx` 1 → 1, pre-existing; the ten lines that differ textually are `comms.ts`, `call-thread.ts`, `inbox-board.ts`, `lead-stage-engine.ts` ×5, `leads.ts`, `webform-chase-service.ts` printing a union in a different order, untouched files, same errors) |
| vitest server: failing tests / suites failed at collection | 43 / 18 | 43 / 18 |
| vitest server failing-set diff | — | identical: 0 newly failing, 0 newly fixed; 1,557 → 1,564 tests, 1,506 → 1,513 passing |
| vitest client | 169 passing, 0 failing | 182 passing, 0 failing |
| new tests | — | **20** (7 server, 13 client); the 5 strip tests fail on the start commit's `PriceAndSendPage.tsx` (checked), the other 15 import files that do not exist there |
| esbuild `server/index.ts` (the build script's flags) | — | bundles, 4.4 MB, exit 0 |
| `db:push` / migration / `app_settings` / notifications / prices | none | none |

New tests: `server/spine/price-queue.test.ts` (Sarah / Gemma / Tom items and signals, oldest
first, the belt, empty, the constant), `client/src/pages/admin/__tests__/PriceQueuePage.test.tsx`
(age helpers, chips, the list, empty, 401, the token), and five in
`client/src/pages/admin/__tests__/PriceAndSendPage.test.tsx` (the strip, the last one, the
fallback, a send refetching, a hold refetching).

## Not done

- **Nothing was seen live.** No page, badge or strip was rendered in a browser; the "how to
  check this" list above is the deliverable in its place. In particular the strip's height on a
  real phone with the tabs below it, and the red card against the amber, are unchecked by eye.
- **The phone bottom tab bar is unchanged** (BACKLOG **T9-b**). The owner's "on bottom sticky in
  Ben's app once something has been removed" names a bar that is full and renders only for the VA
  role; which tab goes, and whether the bar should show for admins, is his call. The queue is in
  the sidebar and on the price screen instead.
- **Hand-saved drafts are not in the queue** (BACKLOG **T9-a**): the shared rule requires the
  chain's suggestions. Reported, not corrected, per the brief.
- **The badge polls** once a minute per open admin tab (BACKLOG **T9-c**).
- **No customer-facing chase, no repeat Pushover.** PRD v3 §9 pairs them; not authorised here.
- **`fm-ensure-agents-md.sh` was not run**, for T5's and T6's reason: it would move `CLAUDE.md`
  into a new `AGENTS.md`, a repo restructuring outside this task. The one durable pointer (the
  queue line and where "waiting" is defined) went into `CLAUDE.md`'s comms section instead.
