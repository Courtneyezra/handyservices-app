# Overnight questions

Product decisions the overnight comms-desk sweep needs and could not find recorded in
`docs/comms-v2/behaviour.md`. Nothing here was guessed into code.

## 1. Expired quote: should a plain price ask reissue the quote at +5%? (16 Sep 2026)

The sweep brief says a plain price ask on an expired quote reissues it at +5%, and haggling or a
discount ask goes to Ben with no reissue. The second half is what the desk does today
(`server/comms-v2/desk/desk.test.ts`, "money on an expired quote goes back to Ben"). The first half
is not a recorded decision. `docs/comms-v2/contracts.md` ("A quote that is no longer live for
figures") treats expired exactly like revoked on purpose, and leaves refreshing a lapsed price as
"its own item, to settle once Ben has used the board". So today a plain "how much was it again?" on
an expired quote holds for Ben (`stale_quote`) and the reply says he will come back to them.
The quote page's own self-refresh (`server/quotes.ts`, `REISSUE_SURCHARGE`, compounding 5%, capped
by `REISSUE_MAX_SELF`) already exists, but the desk never calls it.

Needed: should the desk itself reissue (reuse the quote page's refresh, including its cap and
compounding), or send the customer the quote link so they refresh it on the page, or keep holding
for Ben? And should a reissued figure be quoted in chat, or only the link?

## 2. The sweep's worktree has no environment (16 Sep 2026)

This checkout (`~/.treehouse/handyservices-app-4cf2b2/6/handyservices-app`) has no direnv
`.envrc` in it or above it, so `COMMS_V2_DATABASE_URL` and the model keys are unset and
`npm run comms-v2:door` refuses to open. No live sandbox scenario can run until a non-production
`.envrc` is placed for this run root. Until then, rounds are driven through the repo's own door
and desk test suites (scripted model client).
