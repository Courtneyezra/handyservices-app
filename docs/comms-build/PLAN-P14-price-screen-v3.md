# Plan P14: the price-and-send screen on top of the job pack (implementation plan, not yet a brief)

Written 3 Sep 2026 after P12 (the screen), P12b (its precision fixes) and P13 (the job pack) went live.
The price screen still reads and writes its own copy of the lines; P13 made the pack the carrier from
clerk to contractor but left Ben with no screen for the pack's job fields. This plan closes that gap.
It is a plan for the owner to check; it becomes `BRIEF-P14-*.md` once agreed.

## Goal
One screen, one record. Ben prices from the pack, sees what the contractor will get, and can fix or
ask for the pack's missing fields without leaving. What he sends the customer (prices, lines, message)
and what the contractor gets (the pack) can never disagree, because both are derived from the pack.

## Current state (verified in code)
- `GET /api/spine/price/:slug` (`server/spine/price-screen.ts`) builds its payload from the draft
  quote's `pricing_line_items` + `pricing_suggestions` + the estimate row, and P12 adds thread,
  evidence, contradictions, message, hold, nextWaiting. P13 makes Ben's send write to the pack
  (`applyBenEdits`) and derives `pricing_line_items` from `pack.lines`, but the READ side is still
  quote-first: the screen does not show `pack.job`, `required`, `missing` or `change_log`.
- Contradictions and evidence are computed at read time (P12b); the pack now stores evidence per line
  from the clerk when present (P13 part 2), so the inference is a fallback only.
- The four exits (send, ask first, call, needs a visit) hold the quote via `pricing_suggestions.hold`;
  the pack has no notion of a hold.
- Dispatch 422s on a missing line field and warns on missing job fields; Ben cannot see either before
  a contractor does.

## Desired behaviour
1. **Pack-first read.** The payload is built from `job_packs` when a pack exists; the quote row is a
   fallback for pre-P13 drafts (log it). Lines, evidence, contradictions, materials, assumptions,
   exclusions, sizes, spec, supply-by, hazards and disposal all come from the pack line.
2. **A "What the contractor will get" panel** under the price lines: the pack's job fields in the
   portal's own order (access, on-site contact, parking, pets, prep, utilities, delivery, done-looks-
   like), each marked known / asked / missing, with the required set derived by `requiredFor`.
   Line-level required fields that would 422 at dispatch (sizes, spec, disposal, hazards, lead time)
   are shown as red chips ON the line, above the price.
3. **Ben edits job fields inline.** Every job field is an editable control; a save writes through
   `fileAnswer` with `source: ben` and a change-log row. After the lock, line fields are read-only
   with a link to the variation path; job fields stay live (P13 rule).
4. **"Ask first" reads from `missing`.** The sheet is prefilled with the next question from
   `DELIVERY_FIELDS_IN_ASK_ORDER` (wording from `job-pack-asks.ts`) or, for a line field, from the
   clerk's gap wording; sending it queues the ask and marks the field `asked` on the screen.
5. **Send is blocked only by line-level required fields**, matching dispatch; job fields never block
   a quote (they are asked after the deposit by design). The confirm screen after send lists the job
   fields still missing and that the rules layer will ask for them.
6. **Change log strip.** When the pack changed since the draft was created (a customer filing, a
   rescope, an estimator re-run), a strip at the top says what changed, the same component the
   contractor portal uses.
7. **Hold moves to the pack.** `pack.hold` replaces `pricing_suggestions.hold`; the quote-intake
   card, the portal review page and the desk read it from one place.

## Build order (each part a commit, same gates as every brief)
- **Part 1, read side:** `loadPriceScreen` prefers the pack; payload gains `pack: { job, required,
  missing, changeLog, lockedAt }`; existing fields keep their shapes (the P12 page must render
  unchanged against the new payload). Tests on Sarah's and MJ's packs (MJ from P13b's backfill).
- **Part 2, job panel + inline edit:** `POST /price/:slug/pack/job` → `fileAnswer(source: ben)`;
  the panel component shared with the portal's `JobPackSection` (read-only there, editable here).
- **Part 3, ask-first from `missing`, send gating on line fields, confirm screen text.**
- **Part 4, hold on the pack + change strip**, and retire `pricing_suggestions.hold` readers.

## Risks and open questions
- Sarah's draft predates P13: her pack must be back-filled the same way as MJ's (P13b script) before
  Part 1 can be tested on her; otherwise she stays on the quote-first fallback.
- The estimator re-run after a rescope must supersede the pack's lines, not append: define that in
  Part 1 (`upsertFromEstimate` already keys on lineId; confirm titles that change).
- Inline job-field edits by Ben do not notify the contractor after acceptance (P13 gap). Part 2 should
  emit `job_pack_changed` for day-relevant fields with the same hourly batch rule.
- Open: should a line-level required field (e.g. door sizes) be askable from the screen before the
  price, or only via "Ask first"? Recommendation: both are the same button; the difference is only
  which wording is prefilled.

## Not in scope
The customer-facing quote page, the builder, materials picker UI, pay.
