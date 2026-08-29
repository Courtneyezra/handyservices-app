# Decline Criteria — the polite-no rules table

**Status:** agreed 29 Aug 2026 (Courtnee). Governs the `decline` readiness lane being
added to quote-prep under T6. The clerk APPLIES these rules; it never invents its own.
Every decline is a PROPOSAL — nothing reaches the customer until Ben approves it in the
portal, then the pre-written polite no goes out.

## Auto-decline (clerk proposes `decline` with the matching reason)

Only certified/high-risk trades outside our scope:

| Trigger | Examples | Reason code |
|---|---|---|
| Gas / heating cert work | Boiler repair, gas hob install, flue work — anything Gas Safe | `gas_work` |
| Roofing / work at height | Full roof work, chimneys, anything needing scaffold beyond a standard ladder job | `roofing_height` |
| Structural alterations | Wall removal, lintels, underpinning — needs calcs / building control | `structural` |
| Major electrical (notifiable) | Consumer units, rewires, new circuits — Part P notifiable beyond swaps and fittings | `major_electrical` |

Mixed jobs: decline applies only if the WHOLE job is no-go. If a job mixes no-go and
in-scope work (e.g. "fix the fence and service the boiler"), the clerk quotes the
in-scope lines and the decline reason covers only the excluded line — surfaced to Ben
as a line-level note, not a whole-thread decline.

## Never auto-decline (explicit decisions, do not "improve" these)

| Factor | Decision |
|---|---|
| Distance | **No fixed limit.** Ben weighs travel per job; big jobs can justify the drive. Clerk may note travel as a Ben-audience gap, never a decline. |
| Job size | **No minimum.** Small jobs feed reviews and repeat business. Never decline or discourage for size. |
| Customer behaviour | **Ben decides all.** Non-payment history, rudeness, pre-quote haggling are FLAGS surfaced to Ben with the evidence — the clerk never proposes decline on behaviour. |
| Urgency we can't meet | **Offer the next available date.** Never decline for timing. |
| Another trade's botched work | **Normal job.** Same lanes as any enquiry; photos may be enough to quote. |
| Tenant messaging directly | **Proceed as normal.** Quote them like any customer; payer is sorted later. |
| Large / multi-trade jobs | **`visit_first`, never decline.** Renovation-scale work routes to the paid survey lane. |

## The polite no (sent only after Ben approves)

Style: **point them right + invite back.** Template per reason code, e.g.:

> "Thanks for sending that over. That one needs a Gas Safe engineer so it's not
> something we can take on — but for any handyman jobs in future we'd love to help."

Rules: name the correct trade for their job, keep the door open for handyman work,
never apologise excessively, no referrals to named firms (no partner list yet), and the
templates are fixed text per reason code — not composed per thread.

## Implementation notes (for the T6 build)

- New readiness verdict `decline` in server/agents/quote-prep.ts with `declineReason`
  (one of the four codes) required; validator rejects `decline` without a code or with
  a code whose trigger isn't evidenced in the thread summary.
- Consumer: Ben's portal shows the proposed decline + reason + evidence; approve sends
  the reason-code template; reject returns the thread to normal lanes.
- Pushover: reuse/extend `quote_prep_ready` alert with the decline verdict ("Polite no
  proposed — gas work") rather than a new event type, unless found unworkable.
- Eval cases (T7 family `decline`): one per reason code + near-miss cases that must NOT
  decline (e.g. "replace radiator valve" is plumbing not gas; "repair fence post" is
  not structural; ladder-height gutter clean is not roofing/height; light fitting swap
  is not notifiable electrical) + one mixed-job case (quote in-scope lines, note the
  no-go line).
