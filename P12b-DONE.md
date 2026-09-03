# P12b — price screen v2 against Sarah's REAL payload: three precision fixes

Branch `p12b-price-screen-real-data` from `comms-v3` at `cb14cb7`, worktree `/Users/courtneebonnick/v6-wt-exit`.
Brief: `docs/comms-build/BRIEF-P12b-price-screen-real-data.md`. Every new test uses the real strings
from the brief and the owner's interview note (`Price Screen v2 Decisions`).

## 1. Contradiction detector false alarm (fixed)
`server/spine/price-brief.ts`
- **Main clause only.** `mainClause()` cuts the assumption at the first *unless / if / or /
  otherwise / in case / should the / where the customer / except* and everything after it. The reuse
  test and the reused-noun search run on the main clause alone, so "… unless customer wants
  existing ironmongery reused" contributes nothing.
- **Reuse must be the default.** "New X" in the main clause cancels X ("Assumes new handles/hinges
  supplied …" asserts NEW handles). `supplied` is no longer a reuse word; "customer's own X" and
  "X supplied by the customer" are matched explicitly. Words a reuse verb can sit beside that name
  no material ("existing *style*", "existing *layout*", "existing *condition*" …) are dropped.
- **The material must carry the noun in its own name** (handle ↔ "Coniston handle, latch & hinge
  set"). Sharing the line is not enough: "7× oak door" never matches "handles reused".
- Tests (`price-brief.test.ts`): Sarah's real line-1 sentence with her real materials → no
  contradiction (`mainClause` and `reusedNouns` asserted too); a line-2 sentence with "retained
  unless … or a new frame supplied if …" → none; "New ironmongery throughout, or reuse existing
  handles if …" → none; "If the customer prefers to keep the existing handles …" → none; "Existing
  handles reused on all doors" beside doors only → none; the true positive ("Existing handles reused
  on all doors" + handle set) and "Keep the existing handles" → fire. The P12 tests still pass.

## 2. Evidence ranking (fixed)
- `evidenceForLines(lines, thread)` ranks every line at once. A line's OWN words are its title +
  clerk notes minus the words the other lines also carry; own-word hits count ×3, shared-word hits
  ×1 (tie-breaks only). The quoted sentence is the one in the message with the most own words. When
  two lines would lead with the identical message and either has another candidate, the weaker
  match yields (a tie yields the earlier line). `evidenceForLine` remains as the one-line wrapper;
  `buildPricePayload` now calls `evidenceForLines`.
- Real-data fixture: her six inbound messages (11:49 "go ahead with the doors", "free for a call",
  12:03 "all 9 doors to be replaced …", two photos, 17:53 "The door without the panelling stores a
  few towels… Please quote for 9 off.") and her two line titles. With the clerk notes: line 1 leads
  with "I'm looking for all 9 doors to be replaced …", line 2 with "The door without the panelling
  stores a few towels", the photos sit under line 2. With titles alone the tie on "door" is broken
  the same way (line 2 keeps the towels message, line 1 takes the 9-doors message).
- **The clerk's stored evidence wins when present.** `pricing_line_items[].evidence`
  (`[{ messageId, text }]`) and `.mediaIds` are read as they are (quotes resolved to the thread for
  the time, media ids to the thread's URLs); no inference for that line. The shape is written for
  the clerk pane in `docs/comms-build/CLERK-EVIDENCE.md`. The P12-DONE note stands: inference is
  the stopgap.

## 3. Message wording and the flat band (fixed)
- `jobPhrase`: the clerk's leading verbs ("Supply and hang", "Fit & finish", "Replace the") and
  filler words (internal, storage, standard, replacement, existing, supplied, labour, only) are
  dropped, and each item gets "the". Sarah's titles → "the 8 oak panelled doors and the airing
  cupboard door"; the message reads "Your quote for the 8 oak panelled doors and the airing
  cupboard door is ready, link below."
- `flatBandFromMinutes` (`server/spine/price-screen.ts`, read-only): when the stored band is flat
  (low = high) and the line has a minutes range (from the stored basis, else the estimate row),
  the band the fix would have produced is shown: labour (stored `basis.labourPence`, else
  suggestion less materials-at-margin) scaled by the minutes range with the allowance, materials
  unchanged, via `labourBandFromMinutes`. The row is never rewritten; the line carries
  `bandRecomputed: true`. Sarah's stored suggestion (194,400 / 194,400, 640–1,120 min, 30 min
  allowance, labour 70,000, materials 124,400) → £1,759 – £2,129. A real band is untouched; a flat
  band with no range stays flat. The P8 fixture's fallback line (15,900 flat over 60–120 min) now
  shows £106 – £212, and one P8 verdict assertion moved from out-of-band to in-band accordingly.

## Files
Changed: `server/spine/price-brief.ts`, `server/spine/price-screen.ts`, `server/spine/price-brief.test.ts`,
`server/spine/price-screen.test.ts`, `P12-DONE.md` (note). New: `docs/comms-build/CLERK-EVIDENCE.md`,
`P12b-DONE.md`. No client change (the page already renders `evidence`, `bandRecomputed` is additive).
No migration.

## Verification

| Gate | Result |
|---|---|
| tsc vs `cb14cb7` | 1,869 → 1,869; (file, error code) multiset identical |
| server vitest | baseline 42 failed / 1,057 passed (74 files); after 42 failed / 1,065 passed (74 files); failing set identical |
| `npm run test:client` | 73 passed (7 files) |
| esbuild `server/index.ts` | bundles |

Server suite run with a placeholder `DATABASE_URL` (the worktree has no `.env`; no connection is
made), baseline the same way in a throwaway worktree at `cb14cb7`. No dev server, no database, no
`app_settings`, no push.

## Not done, and why
- **Line 2's real assumption string** is not in the brief; the test uses a sentence of the same
  shape ("retained unless … or … if …"). If the production string differs, the rule that applies is
  the same: nothing after unless / if / or counts, and the noun must be in the material's name.
- **Evidence is still inferred** until the clerk writes `evidence` / `mediaIds` (CLERK-EVIDENCE.md).
- **The flat-band recompute is display only.** The stored suggestion keeps its flat band; the
  verdict row records the band Ben saw (the recomputed one), which is what `in_band` should mean.
