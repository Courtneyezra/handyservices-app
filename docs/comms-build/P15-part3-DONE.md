# P15 part 3 — extras as a variation priced by Route A (DONE)

Worktree `/Users/courtneebonnick/v6-wt-worker`, branch `p15-part3-variations` off `comms-v3`.
Brief: `docs/comms-build/BRIEF-P15-contractor-loop.md`, part 3 only. No DB access, no push, no
`app_settings`, no migration.

## What it does

Craig finds something extra at MJ's door. He describes it and photographs it in the job drawer. He
never types a price and is never shown one, because a number he can see is a number he can say out
loud. The office prices it through the same Route A that priced the job, Ben accepts or overwrites
the figure on a one-line screen, and only his tap reaches the customer.

```
job drawer            "Customer wants something extra": title, notes, up to 4 photos
  POST .../variation  dispatch_variations row + a clerk-shaped intake line
  Route A             estimator measures (minutes, materials, flags) → the ONE engine prices
  Pushover            "Variation to price" → /admin/price/variation/:id
  Ben's tap           quote line → locked pack line → his pay → the row → her message → his notice
```

The contractor's confirmation says: *"Sent to the office. They will price it and message the
customer. Do not start it until she says yes."* No price in it.

## Files

New, all owned by this pane:

| File | What |
|---|---|
| `server/spine/variation.ts` | pure core + the store: what he may say, the `admin_notes` envelope, the one-line screen, Ben's price check, the customer's and the contractor's words, the locked pack line, the pay delta |
| `server/spine/variation-route-a.ts` | Route A for ONE line: `estimateProposal` → `fallbackEstimate` → `priceEstimate`. Never a price from a model |
| `server/spine/variation-routes.ts` | the three routes, auth per route inside |
| `client/src/components/contractor/JobExtraButton.tsx` | the drawer sheet (new component, one-line mount) |
| `client/src/pages/admin/VariationPricePage.tsx` | Ben's one-line price screen |
| `server/spine/variation.test.ts` | 31 tests, the pure half |
| `server/spine/variation-route-a.test.ts` | 8 tests, MJ end to end with a fake estimator |

Touched, minimally:

| File | Change |
|---|---|
| `server/index.ts` | one line: `app.use(variationRouter)` |
| `client/src/pages/contractor/MyWeekPage.tsx` | one import, one line: `<JobExtraButton …/>` |
| `client/src/App.tsx` | one lazy import, one `Route` **before** `/admin/price/:slug` |
| `server/spine/job-pack.ts` | additive `variationId` on `PackLine` (+ `emptyLine`, `normaliseLine`) |
| `server/pushover.ts` | additive `notifyVariationToPrice`, on the existing `quote_prep_ready` key |
| `server/spine/route-a.ts` | the estimator import went lazy, see below |

## Decisions

**No migration.** `dispatch_variations` already carries the description, the photos, the price, the
minutes and the status. The Route A brief rides in `admin_notes` as a JSON envelope under `p15` —
the P12 precedent, where Ben's hold rides in `pricing_suggestions.hold`. A human's own plain-text
note in that column is read back and preserved under `note`, never clobbered, and unparseable JSON
is treated as a note rather than a crash.

**He describes, he never prices.** `validateExtra` refuses a price anywhere in his title or notes
(`£140`, `140 quid`, `$200`, `90 pounds`). A title with plain digits ("2 extra sills, 900mm") is
fine. The response to his POST carries no figure at all.

**The pack line is how a LOCKED pack grows.** `commit` refuses every `line:` change once the pack is
locked and says so in words: *"use the variation path for: …"*. `appendVariationLine` **is** that
path — the one sanctioned exception. It appends directly, recomputes `required`/`missing`, writes
one change-log row under Ben with source `ben`, and is idempotent, so a retry never doubles the
line. A test asserts `commit` still throws `PackLockedError` for an ordinary line edit, so the
exception has not become a hole.

**The price is Ben's.** The band is advice. He may go well outside it. `validateSend` refuses only
nonsense: nothing, zero, negative, unparseable, or past a £2,000 ceiling (bigger than that is a new
quote, not an extra). A second send is 409.

**Pay moves through the existing engine.** `payDeltaFor` runs `computeContractorPay` at his delivery
tier on the labour half of the one line, and the delta is added to his snapshotted
`booking_assignments.payoutPence`. His booked pay is never recomputed, so a dial change after the
booking cannot rewrite it. A price entirely swallowed by materials pays nothing.

**Order of operations on send**, so a failure never leaves a half-done extra: quote line → pack line
→ pay → the row marked approved → the customer's message → the contractor's notice. Steps 2, 3 and 6
are best effort and say so in the log; a contractor notice that does not land never unsends the
customer's message. If the customer send itself fails, the response says the extra is priced and on
the quote and tells Ben to send her the link himself.

**Failure never loses his report.** The `dispatch_variations` row is written before Route A runs, so
an estimator that fails, a Pushover that does not land, or a brief that will not write all leave the
report standing. An estimator failure prices the line from reference rates, marks it check-this, and
tells Ben why on the screen and in the alert.

**The route order in `App.tsx` matters.** `/admin/price/variation/:id` sits **before**
`/admin/price/:slug`, or wouter reads "variation" as a quote slug.

## One change outside the new files, called out

`server/spine/route-a.ts` now imports the estimator lazily (`await import('./agents/estimator')` at
both call sites, both already async) instead of statically. The estimator drags the whole model and
db graph in at module load, which put `fallbackEstimate` — pure, and reused by this path — out of
reach of anything without a `DATABASE_URL`. Default behaviour is identical: `deps.estimate ??
estimateProposal` still resolves to the same function. `route-a.test.ts` stays red for its own
reason (it imports `EstimateClaimRefused` directly), so the baseline is unmoved either way.

## Gates

| Gate | Result |
|---|---|
| tsc errors, baseline | 1,869 |
| tsc errors, with this branch | 1,869 (**zero new**) |
| vitest `server/spine/`, baseline | 22 failed, 255 passed, 10 red files |
| vitest `server/spine/`, with this branch | 22 failed, 294 passed, **the same 10 red files** |
| new tests | 39, all passing |
| client tests (MyWeek preview, pack components) | 11 passing |
| esbuild `server/index.ts` | bundles, 4.1mb |

The 39 new tests cover: what he may say, the deterministic line id, the envelope round trip and its
tolerance of a human note, the flattened engine line, the screen in both stages, Ben's price check,
the customer's words (one price, an out, no dash) and the contractor's (no her name, no her number),
the locked-pack append and its idempotence, the pay delta across tiers, and MJ's "second window kit"
end to end — 150 estimator minutes plus the job's 30-minute allowance at £40/hr is £120 labour, plus
a £30 kit at 27% margin is £38.10, so £158.10 suggested; Ben rounds to £150 and she reads one
sentence with the link.

## Merge notes for the other two panes

- Only new files, plus six minimal edits, four of them a single line.
- `PackLine.variationId` is **additive and optional**. Nothing renamed, `LINE_FIELDS` untouched.
- `server/spine/job-pack.ts` is read, not restructured.
- The drawer edit is one line next to "Move to another day"; the component lives in its own file.
- New routes are in a new file with a one-line mount, so part 2's message route will not collide.

## Not done (out of this pane)

Parts 1, 2 and 4. Also out of scope by the brief: pay changes beyond the variation delta, bonds, the
prize wheel, kit lists, and taking the balance on site.

## Open

- **A booking with no dispatch row cannot raise an extra.** `dispatch_variations.dispatch_id` is
  NOT NULL with an FK to `job_dispatches`, and a job booked straight off the quote (the common path)
  has no dispatch row. It is refused in words — *"This job has no dispatch record… Ring the office"*
  — rather than 500ing on the constraint. Closing it properly means either creating a dispatch row
  at booking or relaxing the column, both of which need a decision and a migration.
- Nothing here is behind an `app_settings` flag. The contractor's button is visible to any accepted
  job on My Week as soon as this ships.
- Untested against the real database: no DB access in this pane. The store functions, the routes and
  the pay write are typed and bundled but not exercised.
