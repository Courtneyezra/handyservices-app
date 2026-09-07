# T9 — the price queue: every quote waiting to be priced, in one place

## What paid for this brief

PRD v3 §9 (`docs/comms-build/PRD-COMMS.md:315-324`), 7 Sep 2026: four unsent Route A drafts, the
oldest four days old. Route A fires **one** Pushover at creation (`server/spine/route-a.ts:9`,
`server/pushover.ts:943` "Quote ready to price") linking to `/admin/price/<slug>`, and the janitor
closes only dead runs. If Ben misses that one ping nothing follows up. The quote sits, the customer
waits, and eventually she rings in (P19's thread is the same failure one step earlier).

The owner's words: *"we need a parent page with all /price items this can be accessed from the side
bar in admin or on bottom sticky in bens app"*. The customer-facing half of §9 (a promise with a due
time and a chase behind it) is the owner's, not this task's. **This is the internal visibility half
only**: a queue Ben can see, not a notification he must catch.

## What already exists, and is reused

- `server/spine/price-brief.ts` `loadNextWaiting(excludeQuoteId)` is the codebase's one definition
  of "a Route A draft waiting to be priced":

  ```sql
  is_draft = true and superseded_at is null and revoked_at is null
  and pricing_suggestions is not null
  and coalesce(pricing_suggestions->'hold', 'null'::jsonb) = 'null'::jsonb
  order by created_at asc
  ```

  i.e. an unsent draft, not superseded or revoked, that the chain priced (suggestions exist), and
  that Ben has not parked with *Ask her first* / *Call her* / *Needs a visit* (P12 hold). Oldest
  first. The price screen's confirm page already shows "Next quote waiting: Gemma" from it.
- `server/spine/price-screen.ts` `buildScreenLine` is pure and computes every per-line signal the
  screen shows: `checkThis` / `checkReason`, `suggestedPence` (null = Ben must type a price before
  Send unlocks, see `totalsOf().missing` on the page), `confidence`, `flags`. `findContradictions`
  (price-brief) is pure too. `statusOf`, `firstNameOf`, `jobPhrase` likewise.
- `client/src/components/layout/SidebarLayout.tsx` DISPATCH CONSOLE holds the Sandbox entry (T5);
  two badges there are already live counts on a react-query interval (Segment Review, Follow-Ups).
- `client/src/pages/admin/PriceAndSendPage.tsx` has a sticky header (z-10) and a fixed thumb bar
  (z-20) that is the four exits. After a send it shows a confirm screen with the next waiting.

## What to build

### 1. `GET /api/spine/price-queue` (read-only) and the pure builder

- `server/spine/price-brief.ts`: lift the predicate above into one exported constant
  `WAITING_DRAFT_WHERE` (a SQL string) and make `loadNextWaiting` use it via `sql.raw`. That is
  the **single source of truth**; the queue reads the same constant. No second definition.
- New `server/spine/price-queue.ts`:
  - `loadPriceQueue()`: one select over `personalized_quotes` with `WAITING_DRAFT_WHERE`, oldest
    first, capped at 200; one select of the newest non-superseded `quote_estimates` row per draft
    (42P01-tolerant like `selectEstimateJson`, the table may be absent); then the pure builder.
  - `buildPriceQueue({ rows, estimates, now })` → `{ count, items, oldestWaitingMs, at }`. Each
    item: `slug, quoteId, firstName, name, postcode, customerType, job` (`jobPhrase` of the lines,
    else the row's `job_description`), `lineCount, createdAt, waitingMs, sourceChannel`, and
    `signals: { checkThis, unpriced, contradictions, lowConfidence, estimateStatus }` computed by
    `buildScreenLine` and `findContradictions`. The builder re-applies `statusOf === 'draft'` and
    `holdOf === null` as a belt (same rule as the SQL, pure and testable).
  - **No money figure leaves this module.** `buildScreenLine` gets `materialsMarginPercent: 0`
    because the queue never shows a price, and the payload type has no pence field.
- `server/spine/routes.ts`: `spineRouter.get('/price-queue', …)` registered **before**
  `/price/:slug` (Express would not confuse the two, but the file's own P8 merge-fix comment is a
  warning about route order in this area; be explicit). Behind the existing `requireAdmin`.

### 2. The page: `/admin/price` (`client/src/pages/admin/PriceQueuePage.tsx`)

- Route added in `client/src/App.tsx` **before** `/admin/price/variation/:id` with a comment.
  Wouter matches `/admin/price` exactly, so neither `/admin/price/:slug` nor `…/variation/:id`
  can be shadowed; the order is still made explicit.
- Phone-first: one column of tappable cards, `max-w-md` centred, widening to a two-column grid on
  desktop. Each card: first name + postcode, the job in a few words, **how long it has waited in
  large type**, and chips only when there is something to say: *N to check*, *N need a price*,
  *N to resolve* (contradictions), *estimator failed*, *low confidence*. The whole card is the link
  to `/admin/price/<slug>`.
- Age is the point: oldest first, always. Under 4 h is quiet; 4 h to 24 h is amber; a day or more
  is red with the card border and the age both loud. The header says how many are waiting and the
  age of the oldest. Empty state: "Nothing waiting to be priced." Auth expiry: the same login link
  the price screen uses. Refetch on focus and every 60 s.
- One shared hook, `client/src/hooks/usePriceQueue.ts`: the query key `['spine-price-queue']`,
  the fetch with the Bearer header, and the pure `ageLabel` / `ageTone` helpers. The sidebar, the
  page and the price screen all read the **same cached query**, so on the price screen three
  consumers cost one request.

### 3. The sidebar entry

DISPATCH CONSOLE, between Comms and Sandbox: `PoundSterling` icon, label "Price queue", href
`/admin/price`, badge = the count when > 0 (the Segment Review idiom). The query runs only when an
`adminToken` exists in local storage (otherwise the 401 would just be noise), `staleTime` 30 s,
`refetchInterval` 60 s. Cost: one indexed-scan select per admin page mount plus one a minute while
the tab is open, the same shape and cadence as the two badge queries already there; it is the
cached query of item 2, so on `/admin/price` and `/admin/price/:slug` it is not an extra request.

### 4. The strip on the price screen

A single 36 px line inside the existing sticky header of `PriceAndSendPage` (never in the thumb
bar, never over the lines): **"3 more waiting · Next: Gemma, 2 days ↗"** with an "All" link to
`/admin/price`. Count and next exclude the quote on screen. Source: the shared queue query, falling
back to the payload's `nextWaiting` when the queue has not loaded. After a successful send, and
after *Ask her first* / *Call her* / *Needs a visit* succeed (each sets a hold, which removes the
quote from the queue), the page invalidates `['spine-price-queue']`, so the strip, the confirm
screen's "Next quote waiting" button and the sidebar badge all reflect the new state without a
manual refresh. The confirm screen prefers the fresh queue's first item over the stale
`result.nextWaiting` and says how many are left.

## Not in scope, deliberately

- No new mutation endpoint; nothing here prices, sends, approves, edits, dismisses or deletes.
- No change to the waiting predicate itself. If it turns out wrong (e.g. drafts the chain never
  priced, `pricing_suggestions is null`, are invisible to both the confirm button and this queue),
  that goes in the DONE report and BACKLOG, not into a second query.
- No customer-facing chase, no new Pushover, no repeat notification (PRD §9: both or neither, the
  owner has not authorised it here).
- Untouched: the comms spine, send preconditions, tiers, the sandbox, media settings, the
  first-contact ack, every price value. No migration, no `db:push`, no `app_settings` flag.
- The VA mobile bottom tab bar (`isVA` only) is not changed: the owner's "once something has been
  removed" is a choice of which tab to drop, and that is his. Reported, not done.

## Tests

- `server/spine/price-queue.test.ts` (pure, no db): oldest first; `waitingMs` from `created_at`;
  the five signals from real-shaped rows (a `checkThis` suggestion, a line with no suggestion, a
  failed estimate, an assumption-versus-materials clash, low confidence); held, sent, superseded
  and revoked rows dropped by the belt; `WAITING_DRAFT_WHERE` carries the four clauses.
- `client/src/pages/admin/__tests__/PriceQueuePage.test.tsx`: renders oldest first; the day-old
  card is marked stale; chips only when non-zero; the card links to `/admin/price/<slug>`; empty
  state; `ageLabel` / `ageTone` boundaries.
- `client/src/pages/admin/__tests__/PriceAndSendPage.test.tsx`: the strip shows the count and next
  excluding the current slug; a send and an exit each refetch the queue; the confirm screen's next
  comes from the refetched queue.

## Cannot be run here

No `.env`, database, key or dev server in this worktree. The DONE report opens with a
copy-and-paste "how to check this" for a non-developer and makes no claim the page works or looks
right.

## Build gate

Measured before and after in this worktree with a placeholder `DATABASE_URL`: `tsc --noEmit`
with the 8 GB heap (zero NEW errors vs `d45f94f`), vitest server failing **set** unchanged
(JSON reporters, test by test, not counts), vitest client green plus the new tests, esbuild bundles
`server/index.ts`. Start commit `d45f94f` confirmed as an ancestor.
