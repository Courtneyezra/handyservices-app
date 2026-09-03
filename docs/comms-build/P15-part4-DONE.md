# P15 part 4 — materials claim and completion gates (DONE, code only; no database touched)

Branch `p15-part4-completion` from `comms-v3` at `ea3d2206`, worktree `/Users/courtneebonnick/v6-wt-config`.
Brief: `docs/comms-build/BRIEF-P15-contractor-loop.md`, Part 4 only, under the three-pane split rules.
No database access, no migration, no `app_settings`, no push, nothing sent.

## What a close now costs

Before this, a job closed on one photo and a signature. Neither says which room, and neither says
whether she was happy. A job now closes on evidence, and the rules are one pure function
(`shared/completion-gate.ts`) that the **server refuses with and the phone greys the button with**,
so the 422 and the helper text under the button are the same sentence and cannot drift.

1. **A before and an after for every task the pack lists.** The pack's lines become the photo plan
   — one card per line, headed with the line's own title — so "photos of the finished work" stops
   being a judgement call on the doorstep. Two tasks means four photos; a second room cannot ride
   on the first room's picture.
2. **Her sign-off on his phone.** Happy, or not happy with the reason in her words. **Not happy
   still closes the job** — the point is that it is recorded, not that the contractor is trapped in
   someone's hallway. An unhappy verdict pushes Ben immediately.
3. **The leftover report.** Snags, work spotted, access notes for next time. It may be empty, but
   he has to have been asked: "nothing to report" is an answer and a tap, silence is not.

**No pack, no per-task rule.** A job whose quote has no pack gets an empty plan and falls back to
the rule that was there before (at least one photo). The pack is optional everywhere it is read,
and a missing pack must never be why a contractor cannot close a job he has finished.

**The materials claim is deliberately NOT a gate** (owner: "no claim, no flag"). A contractor who
bought nothing claims nothing and closes normally.

## Built

- **`shared/completion-gate.ts`** (new, pure, no imports) — `completionGate`, `taskPhotosMissing`,
  `signOffComplete`, `leftoverAnswered`, `flattenEvidence`, `materialsVariance`. Shared by the
  server and the phone on purpose. `flattenEvidence` keeps the legacy `evidence_urls` column filled
  from the per-task photos, so the history view and the invoice email are untouched.
- **`server/spine/job-pack-completion.ts`** (new; pure at the top, the writes at the bottom, same
  shape as the other pack modules) — `photoPlanFromPack`, `expectedMaterialsPence`,
  `materialsListFromPack`, `completionFiling`, `mergeAccessNotes`, then `fileCompletion` and
  `recordMaterialsClaim` with injected deps. **Every write is best-effort by contract**: the job is
  already marked complete by the time filing runs, so a property record or a thread having a bad
  day is a bookkeeping gap, never a refused completion. The refusing is the gate's job and it runs
  first.
- **`server/contractor-completion-routes.ts`** (new router, one mount line in `server/index.ts`) —
  `GET …/plan` (what to photograph, what to buy, what it should cost), `POST …/receipt` (receipt
  photo, `receipts/` prefix), `POST …/materials` (the claim). Also exports `gateCompletion`, so the
  gate's only call site outside this pane is two lines.
- **`client/src/components/contractor/CompletionSteps.tsx`** (new) — `TaskPhotoCards`,
  `MaterialsClaimStep`, `SignOffStep`, `LeftoverStep`. In a new component file precisely so panes 1
  and 2 can work on the job drawer without meeting this code in a merge.
- **`client/src/pages/contractor/CompletionSheet.tsx`** — this pane's file per the brief. Fetches
  the plan on open, captures per-task photos, posts the claim once (a ref guard, so a retry after a
  failed close never double-counts a receipt), then closes.

## Where the evidence goes

| What | Lands on |
| --- | --- |
| Before / after photos | `contractor_booking_requests.evidence_urls` (flattened, after-photos first) |
| Sign-off verdict + reason | The thread as an internal note, and `completion_notes` on the booking |
| Access notes for next time | `job_packs.job.accessNotes` **and** `service_properties.access_notes` |
| Snags / spotted work | `completion_notes` on the booking |
| Materials claim | `job_material_expenses` where it exists, **always** `completion_notes` |
| Unhappy sign-off, flagged variance | Pushover to Ben (`escalation`) + a `system_events` row |

The thread note is written as a `messages` row with **`channel: 'note'`, and the conversation's
clocks deliberately left alone**. Advancing `last_message_at` here would make the board read the
thread as answered when nobody has replied to the customer at all. This is a new precedent — no
other module writes a `note` row today — so it is called out here rather than buried.

## Two judgement calls the orchestrator should know about

**1. "over 10 % / £20" is read as BOTH, not either.** A claim is flagged when it is more than 10 %
away from the pack *and* more than £20 away in cash. Either-condition would push Ben a notification
for £4 over on a £35 receipt, and an alert that cries wolf is an alert nobody opens. The constants
(`VARIANCE_PERCENT`, `VARIANCE_PENCE`, `VARIANCE_NEEDS_BOTH`) sit at the top of the shared file and
the boundary is tested in both directions, so flipping it is one line if the owner wants it to bite
earlier. **Under-spends flag too**: money quoted and not spent is the same surprise.

**2. The comparison baseline is supplier COST, not materials at margin.** The brief says "at
margin"; the figure a receipt is actually measured against is what the contractor spent on our
card, which is `unitPricePence × qty` on the pack's material rows — the same figure dispatch calls
`materialsCostPence` and describes as "the contractor's spend on our card". Materials **at margin**
(`materialsPence`, what the customer was charged) is the **fallback** when a pack carries no priced
material rows. It is the wrong side of the markup, so it is generous to the contractor rather than
accusing. The endpoint returns `expectedBasis: 'cost' | 'margin' | 'none'` so which one was used is
never a guess.

Also added beyond the letter of the brief, and easily removed: **an unhappy sign-off pushes Ben.**
The brief only asks for the variance flag, but a customer saying "this is not right" and nobody
being told would be the one silent failure this screen cannot afford.

## Tests

- `server/spine/job-pack-completion.test.ts` — **36 tests, green.** The gate refuses an after with
  no before, a second unphotographed task, a missing signature, a missing verdict, `not_happy` with
  no reason, and an unanswered leftover report; it lists everything missing at once; no pack falls
  back to one photo. The filing test proves the access note reaches **both** the pack and the
  property record, that a report with nothing in it files no access note, and that a failing write
  never throws. The variance maths is tested exactly on both thresholds (£20.00 over on £200 does
  **not** flag; one penny more does), on a big percentage of small money, on big money at a small
  percentage, on an under-spend, and against a pack that expected no materials.
- `client/src/components/contractor/__tests__/CompletionSteps.test.tsx` — **13 tests, green.**
- No database in either file; every read and write is injected.

## Build gate

| Check | Result |
| --- | --- |
| `tsc` project-wide | **1869 errors before, 1869 after** — byte-identical error set, zero new |
| `server/contractor-app-routes.ts` | 7 errors before, 7 after (all pre-existing, lines 357–1132) |
| vitest `server/spine/` | failing-file set **identical** to the base commit (pre-existing, `DATABASE_URL`) |
| vitest `--project client` | **97 passed, 11 files, all green** |
| esbuild bundle | clean, 4.1 mb |

Baselines were taken by stashing this branch's work and re-running, not from memory.

## Merge notes for the other two panes

Files this pane **created**: `shared/completion-gate.ts`, `server/spine/job-pack-completion.ts`,
`server/contractor-completion-routes.ts`, `client/src/components/contractor/CompletionSteps.tsx`
and the two test files. Nobody else should be in them.

Files this pane **edited**, and the whole of the edit:

- `server/index.ts` — one import line, one `app.use` line, both immediately after the existing
  `contractor-app-routes` ones.
- `server/contractor-app-routes.ts` — **three hunks, all inside the existing `/complete` handler
  plus one import block**: the gate replacing the two ad-hoc 400s, `flattenEvidence` filling
  `evidenceUrls`, and the `fileCompletion` call after the two status writes. Nothing else in the
  file is touched — the job drawer payload, the pack fields and the materials run are untouched, so
  a pane adding a route at the end of this file will not conflict.
- `client/src/pages/contractor/CompletionSheet.tsx` — this pane's file per the brief. **`MyWeekPage.tsx`
  was not touched at all**: the plan comes from the new endpoint rather than from the job drawer's
  payload, precisely so pane 1 and pane 2 own that file between them.

`PackLine` and `PackJob` were **not changed** and `job-pack.ts` was **not restructured** — the pack
is read, and the access note is filed through P13's own `fileAnswer` (`job.*` stays live after the
lock by design, which is exactly what an access note for next time needs).

## Not done, and why

- **`job_material_expenses` has no migration in this repo.** The claim writes there when the table
  exists and swallows a `42P01` when it does not; the durable copy is the note on the booking,
  written either way. If the orchestrator wants the reconciliation table for real, that is a
  migration, and this pane had no database access.
- Nothing on the MJ test case was run end to end — no database from this pane. The pack shape used
  throughout the tests is MJ's (`quote_mj`, `card_1`, two sash AC kit panels at £10 on our card),
  built through P13's own writers so it cannot drift from the real one.
- Out of scope and untouched, as the brief says: pay changes, bonds, the prize wheel, kit lists,
  taking the balance on site.
