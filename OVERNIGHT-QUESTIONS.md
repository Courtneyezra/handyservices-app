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

## 3. Shut window after a hold: does the desk's holding line count as answering the question? (16 Sep 2026)

Round 14: a customer asks "How much would that be roughly?" on WhatsApp, and the desk holds for Ben
with "Thanks, leave it with me and I'll come back to you." Ben opens the card 25 hours later. His
answer and the held draft are both refused because the window is shut (answer 34, correct). The
board's template send (`sendWindowTemplate` in `server/comms-v2/desk/human-reply.ts`) is refused too,
as "no template is true for this thread", because any outbound turn after the question counts as
answering it (`unansweredQuestion`, and the test "a question the desk has already answered", whose
fixture is a holding line: "Let me check on the price and come straight back to you."). So on the most
common late-hold thread, where no quote has been sent, nothing can reach the customer until they write
again, and a thread held on a question stays silent for good.
The registry's own trigger for `answer_ready_reopen_v1` is "the customer asked something and the
24-hour window shut before the desk answered". A holding line that promises Ben will come back
arguably has not answered anything, and "we have an answer for you" is true once Ben has one.
behaviour.md (answers 13 and 34) says only "approved templates for the common cases".

Needed: when the only outbound turns since the customer's question are the desk's holding line or
acknowledgement, and the hold still stands, should Ben be offered `answer_ready_reopen_v1`? Or should
he keep waiting for the customer to write again?
