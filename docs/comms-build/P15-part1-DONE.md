# P15 part 1 — "Not included", customer-facing and in the pack (DONE)

Brief: `docs/comms-build/BRIEF-P15-contractor-loop.md` part 1. Pane: top-right, worktree
`/Users/courtneebonnick/v6-wt-exit`, branch `p15-contractor-loop` from `comms-v3`. Worktree only, no
database, no `app_settings`, no push. Parts 3 and 4 belong to the other two panes.

## The decision this encodes

Contractors ring the office to ask "is this included?". The answer already exists at intake (the
clerk's exclusions and the assumptions that exclude something) but it died there: it was internal
wording that never reached the customer's quote or the contractor's pack. Part 1 gives that answer
ONE field with ONE owner chain, in the customer's own plain words, and shows it in all three places
it is asked.

## Built

### The field

`PackLine.notIncluded: string[]` (`server/spine/job-pack.ts`) — additive, per the pane rules; nothing
renamed, nothing restructured. It joins `LINE_FIELDS`, so a change to it is an ordinary change-log
row with who and which source, and it round-trips through `packFromRow` (an old row without the
column reads as `[]`).

### The owner chain

| Who | What they do | Where |
|---|---|---|
| clerk | derives it every time it writes the line | `linesFromClerk` → `notIncludedFrom(exclusions, assumptions)` |
| Ben | edits, adds, drops it on the price screen | `/admin/price/:slug` → `SendLine.notIncluded` → `applyBenEdits` |
| customer | reads it under the line on the quote | `QuoteLineRow` → "Not included" |
| contractor | reads it beside her words in the pack | `JobPackTask` → "Not included: …" |

`notIncludedFrom` is pure and is the only place the wording is decided:

- an exclusion becomes `"<exclusion> not included"`, unless it already says so ("the small top door,
  not included" stays as it is);
- an assumption becomes an entry only when it EXCLUDES something (`EXCLUDING_ASSUMPTION`: reused,
  kept, left in place, customer supplies/disposes/removes, no decorating/plastering/electrics…), so
  "Frames are sound" is not offered to the customer as an exclusion and "Frames reused" is;
- plain words: dashes become commas (the `shared/chat-voice.ts` rule), trailing stops go, a leading
  capital drops unless the phrase starts with a name;
- de-duplicated case-insensitively, capped at 8.

### Where it renders

- **Customer quote** (`client/src/components/quote/UnifiedQuoteCard.tsx`): a "Not included" block
  under the line, directly after "Priced assuming", same muted treatment. `QuoteLineRow` is now
  exported so it can be tested on its own; nothing else about the card changed.
- **Contractor pack** (`client/src/components/contractor/JobPackSection.tsx`): a red-tinted strip
  immediately under the customer's words in `JobPackTask`, because that is the moment the question
  gets asked. When the line carries the list, the older raw-`exclusions` block is suppressed (one
  answer, not two); a line with no list falls back to the exclusions block exactly as before.
- **Price screen** (`client/src/pages/admin/PriceAndSendPage.tsx`): one more editable list per line,
  built like the assumptions list (edit in place, drop with the X, "+ add something that is not
  included", max 8). The section renders even when empty so Ben can add the first item.

### The write path

- `buildScreenLine` fills the screen's `notIncluded` from the draft line, falling back to
  `notIncludedFrom` over the line's own exclusions + assumptions, so a pre-P15 draft arrives with
  the list already derived and Ben only edits.
- `validateSendBody` carries it trimmed, blank-dropped, capped at 8, and refuses an item over 120
  characters ("keep 'not included' to plain words").
- `confirmedLineItems` writes what Ben sent, else what the screen showed, onto the customer-visible
  line item; `packEditsFromSend` → `applyBenEdits` puts the same list on the pack, and
  `derivePricingLineItems` carries it (the pack stays the source once a pack exists).
- `verdictRowsFor` records `meta.notIncludedChanged` alongside `materialsChanged` /
  `assumptionsChanged`, so "Ben rewrote the exclusions" is visible in the graduation data.
- `dayRelevantChanges` counts `line:<id>.notIncluded` as day-relevant, so changing it after a
  contractor accepted shows in "Changed since you accepted" and (part 4's existing path) in the
  `job_pack_changed` notice.

## Tests (all new, appended to the existing files)

| File | What it proves |
|---|---|
| `server/spine/job-pack.test.ts` (+3) | `notIncludedFrom` wording, dashes, stops, de-dupe, the 8 cap, "Frames are sound" excluded and "Frames reused" included; the clerk derives on every write and a card may hand the list over outright; a re-run re-derives and logs `line:card_1.notIncluded` with from/to/source; Ben's list replaces the clerk's in plain words; `derivePricingLineItems` carries it; `packFromRow` round-trips and an old row reads `[]` |
| `server/spine/price-screen.test.ts` (+3) | `buildScreenLine` derives when the draft has none and reads it when it does; `validateSendBody` trims / caps / refuses over 120 chars; `confirmedLineItems` writes sent-else-shown; `meta.notIncludedChanged` true only on the changed line |
| `server/spine/job-pack-readers.test.ts` (+1) | the contractor view carries the list per task; a change to it is day-relevant |
| `client/src/components/contractor/__tests__/JobPackSection.test.tsx` (+2) | the strip renders after her words in document order; the raw exclusions block is suppressed when the list exists and still renders when it does not |
| `client/src/pages/admin/__tests__/PriceAndSendPage.test.tsx` (+2) | edit + add reach the send body in order, an untouched line sends nothing; dropping the only item sends `[]` (Ben cleared it deliberately) |
| `client/src/components/quote/__tests__/QuoteLineRow.notIncluded.test.tsx` (new) | the customer's line renders the list after the assumptions, and nothing at all when it is empty or absent |

One existing test was updated, not added to: `server/spine/price-brief.test.ts` asserts the verdict
meta with `toEqual`, so the new `notIncludedChanged: false` had to be written into both expected
objects. That is the only pre-existing assertion this part changed.

## Verification

- `npx tsc --noEmit`: 1,869 baseline → **1,869** (one new error was introduced and fixed before the
  commit; the final run matches the P13b-documented baseline and no error is in a touched file).
- vitest: 42 pre-existing failures unchanged, same failing set; the six files above pass
  (+11 new tests).
- esbuild: `server/index.ts` bundles (4.28 MB).
- Not run: anything against a database (no access from this pane, and the brief forbids it).

## Notes for the merge

- `PackLine.notIncluded` is additive and defaulted, so parts 3 and 4 can read it without ordering
  concerns. `PackTaskView.notIncluded` is optional on the client type for the same reason.
- The only shared-file edits are additive field plumbing (`job-pack.ts`, `job-pack-writers.ts`,
  `job-pack-readers.ts`, `price-screen.ts`, `quote-intake.ts`) plus the three render sites. No new
  server route, no new component file, so nothing here collides with another pane's mount line.
- `QuoteLineRow` changed from module-private to exported. Nothing else imports it yet.
