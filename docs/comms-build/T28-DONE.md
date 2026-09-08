# T28 — never ask twice, never thank twice, never hand off twice

Plan v2 item **0.3**. The captain's cross-cutting rule 7, verbatim: *"We never ask twice for the
same thing, and never thank twice for the same photo."* He also made it a precondition of opening
up replies (answers 2 and 19), which is why 1.1a waits on it.

Shipped 8 Sep 2026. No model, no database, no clock: every rule here is read off the thread's own
outbound history, so a replay of a persisted case file gives the same answer as the run.

## What was already there

T20 (8 Sep) shipped ask-once and thank-once **for photos and videos only**
(`server/spine/media-ask.ts`, `send-preconditions.ts:136-141`, `agents/scoper.ts`). The only other
cross-turn repeat check on the desk was a ten-minute near-duplicate window in `message-drafts.ts`.
s28 finding M: *"0.3 is shipped for media and under-specified for everything else."*

## What T28 adds

`server/spine/ask-ledger.ts` — the ask ledger. Four subjects, each with the media belt's exact
shape (`asked` → `repliedSince` → `answeredSince` → `outstanding`):

| subject | asked by | answered by | re-opens when |
| --- | --- | --- | --- |
| `media` | `asksForMedia` (T20's, unchanged) | media arrives | a photo arrives — T20's own invalidation rule |
| `postcode` | `asksForPostcode` | a UK postcode arrives | a postcode arrives |
| `access` | `asksForAccess` | never — nothing on a thread can prove it | never: they replied, we do not insist |
| `handoff` | `saysHandoffLine` | a **new flag** opened since (s28 finding E) | a new hand-off, not a customer answer |

Plus `mediaAck`: the newest media **batch** and whether we have already thanked them for it.

**A. The case file renders it.** `buildCaseFile` stores `asks: buildAskLedger({ timeline })` in the
same object it hashes (`CaseFile.asks`, additive and optional). `askLedgerOf` prefers the stored
ledger — that is what makes a replay show what the agent actually read — and derives one on the
spot for a case file built before T28 or by a fixture that carries none.

**B. The belts generalise.** `send-preconditions.ts` keeps T20's two media codes exactly and adds
`already_asked:postcode`, `already_asked:access` and `handoff_already_said`. They sit where the
media belts sit: before the intent switch, so the rule holds whatever the intent says.

**C. The hand-off line's slot.** The line itself is item 1.4's to write; `handoff` is the named,
tested subject it lands in. Said once per open flag: a second line on the same flag is refused, a
flag raised since re-opens it, and the rest of the reply still moves (answer 14).

**D. The Scoper is told, not left to infer.** `renderCaseFile` carries `askLedgerLines(...)` — one
line per outstanding subject plus the thanked-batch line — and `scoper.core.md` gains one
paragraph: read the fact, never work it out from the timeline.

**E. Thank once per batch.** T20 read the newest media item alone, so a photo landing a minute
after our thanks earned a second thank-you. `mediaAckState` now walks back to the start of the
newest batch: our own outbound in the middle does not end it (that is exactly the racing case);
the customer moving the conversation on, or a gap over `MEDIA_BATCH_GAP_MS` (10 min), does.

## Two recorded expectations that changed

`eval-cases/guards/incident-v2-unguarded.json`: `guards-incident-9bdaa1853b` and
`guards-incident-5e5f585796` (Michael, 31 Aug) now report `already_asked:postcode` instead of
`ask_gap:quote_on_case`. On that thread we asked for the postcode and he refused twice, so the
ask-once belt names the refusal before the quote-on-case rule is reached. **Both still hold at
SEND**: the code changed, the safety did not. `send-preconditions.test.ts` reads the code from the
fixture and asserts it is one of the two.

## Tests

`server/spine/asked-once-t28.test.ts`, 37 cases: the detectors; the ledger and its order
independence; the belts per subject; a second ask refused with a named reason; an answered ask
re-opening under the media belt's rule; one thank-you per batch with two photos a minute apart; the
hand-off line once per open flag; the tool refusals; the rendering stable across a replay.

Eval families, `--adapter triage`, no key needed:
`eval-cases/ask_gap/asked-once.json` (5) and `eval-cases/confirm_received/thank-once.json` (2).
`npx tsx scripts/eval-comms.ts --adapter triage --family ask_gap` → 13 green, 0 red;
`--family confirm_received` → 7 green; `--family guards` → 5 green.

## Out of scope, and not touched

What the desk asks for and the order it asks in; the clerk's readiness test (item 1.3); the
hand-off line itself (item 1.4). No tier, pack, guard or template changed.

## Not verified here

No `.env` and no database in this worktree, so nothing was observed live: no run against the
sandbox, no real thread, and the eval `spine` adapter (which calls the model) was skipped. The
owner's check is a sandbox thread where the postcode is asked and refused, then a second turn: the
second ask must not appear, and the rest of the reply must still land.
