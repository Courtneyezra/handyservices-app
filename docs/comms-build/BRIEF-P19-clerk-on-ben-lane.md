# P19 — the Quote clerk keeps working when the thread is Ben's

## The thread that paid for this brief

`f7ebd4f6-71ce-470a-b914-77e4aca3eeed`, 4 Sep 2026, a first-contact WhatsApp number.

```
08:56:44  IN   "I am in need of a small bedside table being built, I was just wondering
                how much this would be roughly and when you would have availability?"
08:58:46  OUT  first_contact_ack (rules layer, sent)
08:59:14  IN   "A call would be great!"
09:00:47  IN   "Fell free to call me"
09:11:47  OUT  rules layer: "we'll come back to you shortly"   <- open commitment, due 13:11
09:12:19  OUT  Ben, typed by hand: asks for a photo
09:13:31  IN   two photos ("here is the manual and the box it came in")
09:16:19  OUT  Ben, typed by hand: asks for the postcode
09:16:38  IN   "NG7 2DP"
09:59:34  IN   SHE RANG IN to chase. 1m28s. Agent could not give her a price.
```

By 09:16 the thread carried `photos_received`, `postcode_received`, `bedside_table` and
**`needs_quote`**. Everything a quote needs was there. The clerk never ran.

From 09:30 the spine flagged the same thread every five minutes — 09:30, 09:35, 09:40, 09:45,
09:50 — always the same verdict:

```
src=model  lane=ben  decision=flag  exc=["callback_requested","date_question"]
reasons: "Customer requested callback at 09:00:47 and provided postcode at 09:16:38."
         "Photos of bedside table received at 09:13:31-09:13:32."
         "Open promise 'we'll come back to you shortly' due at 13:11 is now overdue"
```

The rules find no exception on "NG7 2DP", so the Haiku model runs, reads the recent timeline,
and correctly re-raises both exceptions — she *did* ask for a callback and she *did* ask about
dates, and neither had been answered. Then `mergeTriage` does `if (exceptions.length) lane = 'ben'`
and `agentForLane('ben')` returns `null`, so **no agent runs at all**.

## The actual defect

One rule is doing two jobs:

1. *Ben must be the one who talks to this customer.* — correct, and must not change.
2. *Therefore no agent may do any internal work on this thread.* — wrong.

The Quote clerk produces an **internal artifact**. On the `quote_ready` path, Route A runs the
estimator and writes a draft quote with prices null plus a Pushover for Ben. Nothing reaches the
customer. That is precisely the agent that *should* keep running while a thread sits with Ben —
it is what puts a priced draft on his phone instead of him finding out at 09:59 when she rings.

## What to build

On a Ben-lane run, still run the Quote clerk when the thread is tagged `needs_quote`, purely for
its artifact. The customer-facing decision must be **byte-for-byte unchanged**: the thread still
flags, exactly as it does today.

Entry point is `runOnce` in `server/spine/index.ts` (`agentName`/`agent` resolution, then the
Route A block). `agentForLane` is in the same file. Do not loosen `mergeTriage` or `triageRules`
to hand the lane to the clerk — the lane is what `decide` reads, and it must keep saying `ben`.

## Hard constraints

1. **The decision cannot move.** `decide()` returns `flag` before it looks at any proposal
   (`server/spine/decide.ts`, the exceptions branch sits above everything). Verify that still
   holds with a clerk proposal present, and pin it with a test.
2. **Watch the `visit_first` path.** In `runOnce`, a `visit_first` readiness *replaces* the
   proposal with a customer-facing survey offer. On a Ben-lane thread that must never become a
   draft. Either skip that branch on the Ben lane or prove `decide` still flags it. Test both.
3. **Do not create a five-minute clerk loop.** This thread re-runs on cadence every 5 minutes.
   `ensureQuoteRun` / `isLiveEstimate` in `server/spine/request-run.ts` already guard the
   estimator against re-running; confirm they cover this path, and add the guard if they do not.
   A repeated Haiku triage call is cheap; a repeated estimator chain is not.
4. **No customer message, in any mode.** Nothing here may reach the exit as a send.
5. Money and dates stay Ben's. This changes *who prepares*, never *who speaks*.

## Build gate (CLAUDE.md)

- Zero NEW tsc errors against your start commit (the repo carries ~1,882 pre-existing).
- vitest: 42 pre-existing failures, unchanged. Touch `server/spine/*.test.ts` — `architecture`,
  `triage`, `decide` are the relevant suites.
- esbuild must bundle.
- Never `db:push`. No migration should be needed here; if one is, it is idempotent SQL applied
  with `npx tsx scripts/_apply-migration.ts`.
- Do not flip any `app_settings` flag. The spine is LIVE in production right now.

## Definition of done

- A Ben-lane run on a `needs_quote` thread produces a clerk artifact and a Route A draft quote.
- The same run still returns `decision: flag` with the same exception and the same due time.
- No draft row, no send, on the Ben lane — proven by test, not by reading.
- Replay `f7ebd4f6-71ce-470a-b914-77e4aca3eeed` read-only (build the case file, run the pipeline
  with `dryRun`) and show the before/after: same flag, plus an artifact that was not there before.
