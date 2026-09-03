# P15: the contractor loop — fewer calls back to the office (pane top-right)
Worktree: /Users/courtneebonnick/v6-wt-exit (branch p15-contractor-loop, from comms-v3)

Owner interview 3 Sep 2026 (Obsidian "Job Pack Contents"). Contractors ring for three things: access and
arrival, "is this included?", materials and kit. Decisions: lock scope, materials, sizes, price and date at
dispatch, keep access live; the contractor buys materials against the pack's list and claims; no kit list;
extras become a variation priced through Route A and confirmed by Ben; at the door he messages the customer
THROUGH the app (business number, number hidden, logged); a job closes with before/after photos per task,
the customer's sign-off on his phone and a leftover report, never the balance on site. Same rules as every
brief (worktree only, no DB, no app_settings, no push, gates, commit after each part, `P15-DONE.md`).
Test case: MJ, booking `2d21da09-6fc4-42b6-b036-ea013bb654c6`, pack `jp_55ci9dr8mtl3crnz`, contractor
Craig (`hp_aa21264a-…`). Build in this order.

## Part 1 — "Not included", customer-facing and in the pack
- Pack line gains `notIncluded: string[]` (plain words). The clerk writes it from the intake's exclusions
  and assumptions ("small top door not included", "frames reused"); Ben edits it on the price screen
  (P12 page: one more editable list per line, like assumptions); it renders on the customer's quote page
  under the line ("Not included: …") and in the contractor's pack task beside the customer's own words.
- Tests: clerk → pack; price screen edit → pack and quote; quote page renders; pack task renders.

## Part 2 — message the customer through the app
- My Week / dashboard job drawer (accepted jobs only): "Message the customer" with three preset lines
  (arrived, running late by N minutes, which door / where to park) and a free-text box.
- Server: `POST /api/contractor-app/:token/jobs/:bookingId/message` → the customer thread, sent through
  `sendCustomerMessage` from the business number with approver `contractor:<id>`, body prefixed with the
  contractor's first name ("Craig here, I'm outside — which door?" → no dash: "Craig here, I'm outside.
  Which door?"), voice guard applied, money and date guards HOLD (a contractor cannot promise either).
  Rate-limit 5 per job per day. The customer's reply is routed to the contractor's screen (the spine's
  triage sees an active job for the thread and lanes it `contractor_relay`: the reply is shown in the
  job drawer and pushed to the contractor's WhatsApp as a `job_pack_changed`-style notice; nothing is
  auto-answered). Ben sees the exchange on the thread as usual.
- Tests: send path, guards hold, rate limit, relay lane, no customer number in any contractor payload.

## Part 3 — extras as a variation priced by Route A
- Job drawer: "Customer wants something extra": title, notes, photo. Server creates a `dispatch_variations`
  row (existing table) AND a clerk-shaped intake line, runs the estimator + engine for that line (reuse
  `server/spine/route-a.ts` pieces; never a price from a model), and lands a Pushover "Variation to price"
  for Ben with a one-line price screen (`/admin/price/variation/:id`: suggestion, band, accept/edit, send).
  On send: the customer gets a short message with a link to accept the extra (existing quote-link path or
  the quote page's add-line), the pack line list gains the line (locked), the contractor's pay updates via
  the existing variation path, and the contractor gets a notice.
- Tests on MJ: a "second window kit" extra end to end with a fake estimator.

## Part 4 — materials claim and completion gates
- Materials: the pack task lists exact items; the completion sheet (`CompletionSheet.tsx`) gains a
  "materials bought" step: receipt photo(s), total; the server compares against the pack's list at margin
  and flags a variance over 10 % / £20 to Ben (Pushover + a row on the job). No claim, no flag.
- Completion cannot close without: a before and an after photo for every pack task (the pack lists what to
  photograph, from the line title), the customer's sign-off on the contractor's phone (happy / not happy +
  reason, written to the thread and the job), and the leftover report (snags, extras spotted, access notes
  for next time → filed into `job_packs.job.accessNotes` and the customer record).
- Tests: gate refuses without photos / sign-off; report files the access note; variance flag maths.

## Not in scope
Pay changes, bonds, the prize wheel, kit lists (owner: none), taking the balance on site (owner: no).
