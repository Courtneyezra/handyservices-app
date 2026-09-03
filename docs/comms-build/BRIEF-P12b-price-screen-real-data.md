# P12b: price screen v2 against Sarah's REAL payload — three precision fixes (pane top-right)
Worktree: /Users/courtneebonnick/v6-wt-exit (branch p12b-price-screen-real-data, from comms-v3)

P12 is merged and live (`2c6b6a6`). Running `loadPriceScreen('z4p6t9mw')` against production data
(read-only, from the orchestrator) shows three things the fixtures did not. Same rules as every brief.

## 1. Contradiction detector false alarm (must fix)
On Sarah's line 1 it flagged: assumption "Assumes new handles/hinges supplied to match existing style
unless customer wants existing ironmongery reused" vs materials "7× oak door" and "8× Coniston handle,
latch & hinge set". That assumption says NEW handles are supplied; the materials list new handles;
there is no contradiction. The detector matched the words "existing … reused" inside an "unless"
clause, and it also pulled the doors in as a matching material. Line 2 (`card_2:a0`) was flagged too;
check it the same way.
- Only flag when the assumption ASSERTS reuse as the default ("existing X reused", "X kept", "keep
  the existing X"), never when reuse is the exception ("unless … reused", "if the customer prefers to
  keep", "or reuse existing"). Strip subordinate clauses starting with unless / if / or / otherwise
  before looking for the reuse noun.
- The matching material must carry the reused noun itself (handle ↔ handle set), not just share a
  line: doors must not match "handles reused".
- Add both Sarah sentences as unit tests (the real strings above), plus one true positive
  ("Existing handles reused on all doors" + a handle set) that must still fire.

## 2. Evidence ranking picks the wrong quote (must fix)
Both lines show the same three quotes, and line 1's top quote ("The door without the panelling
stores a few towels") is the cupboard sentence. Line 1 should lead with "I'm looking for all 9 doors
to be replaced" / "Please quote for 9 off"; line 2 with the towels sentence.
- Rank by overlap with the line's OWN distinguishing words (title minus words shared with the other
  lines), so "panelling / towels / cupboard" pull to line 2 and "9 doors / all doors / oak" to line 1.
- Never show the identical top quote on two lines when a distinct one exists.
- Real-data fixture: Sarah's six inbound messages and her two line titles; assert the top quote per line.
- Keep the note in P12-DONE: the proper fix is the clerk storing evidence per line. Write the shape
  you want (`evidence: [{ messageId, text }]`, `mediaIds`) into `docs/comms-build/CLERK-EVIDENCE.md`
  so the clerk pane can add it later; read it when present.

## 3. Message wording and the flat band on pre-fix drafts (should fix)
- `jobPhrase` produced "Your quote for supply and hang 8 internal oak panelled doors and supply and
  hang airing cupboard storage door is ready". Drop the verbs and join naturally: "Your quote for
  the 8 oak panelled doors and the airing cupboard door is ready". Test on Sarah's titles.
- Drafts priced before the band fix still carry bandLow = bandHigh (Sarah: 194400/194400). When the
  stored band is flat and the estimate has a minutes range, recompute the band on read with
  `labourBandFromMinutes` (read-only; do not rewrite the row) so the screen shows a real range.
  Test with Sarah's stored suggestions.

Report in `P12b-DONE.md`. No DB, no app_settings, no push.
