# Overnight questions for the captain

Things found while driving the live desk on the sandbox that a fix would need a product decision
for, and so were not guessed at. One entry per finding, newest last.

## 1. A plan step the ask agent declined is still the step the confirm is bound to

Found: round 3 (17 Sep 2026), driving the Handy Desk ask bar as Ben on a complaint card.

Ben asked for one reply carrying three things: an apology, a promise to ring tomorrow morning to
rebook, and a line saying there is no charge for the wasted day. The composer's guards refuse a
specific time commitment and a money claim, so the run held a draft that carries the apology alone,
and the answer said so in plain words: "I couldn't add the 'ring tomorrow morning' promise or the
'no charge' line."

The reasoner's plan came back as four steps with the first two marked done:

    Write reply to Marcus          done
    Apologise for missed visit     done
    Promise call tomorrow to rebook
    Confirm no charge

`buildPlan` (`server/comms-v2/ask/plan.ts`) binds the run's proposal to the first step that is not
done, which is "Promise call tomorrow to rebook" — a step the draft does not do. Ben's card
therefore shows "Send as is" under that label. On his confirm, `planAfter` marked that step `done`,
and `remainingAfter` + `continueChain` (`ask/routes.ts`) started a fresh run at once, "Carry on with
the plan: Confirm no charge", which drafted and proposed a *second* message to the same customer
for a step the agent had already said the desk blocks.

Nothing went out unasked — every send still waits on Ben's own confirm, and the money line never
reached a draft. But the strip tells him a promise was made that was not, and one tap queues a
second message for a step that cannot be done.

This is the behaviour as recorded: `server/comms-v2/README.md` says the strip is "the steps the
reasoner gave, done as it said ... and the proposal's step `current` with its `actionId`", and
`ask/plan.test.ts` pins "marks the first unfinished step current with its proposal". The reasoner
has no way to say "I declined this step" — `give_answer`'s plan carries only a `done` flag, and the
`refused` state is set only from a refusal the proposal store returned, never from the agent
choosing not to do something.

**The decision needed:** when the agent declines a step in its answer rather than being refused by
the store, should that step show as refused (dropping the ones after it, so no chain runs), stay
`waiting` while the proposal binds to a step that matches it, or carry on as now? A fix means either
a `declined` flag on `give_answer`'s plan steps, or binding the proposal only to a step the kind
actually performs — both change the recorded shape of the strip.

## 2. Closing an unheld file by hand is not gated to the slot the file answers to

Found: round 3 (17 Sep 2026), reading the board's writes while driving the above.

Every other board write checks the slot the file answers to — `/answer` and `/send-held-draft`
through `humanReply`, `/send-template` and `/template-offer` through `planWindowTemplate`,
`/release` through `release` — and `api/routes.test.ts` pins "refuses a session listed for another
slot on a file that answers to ben".

`POST /api/comms-v2/case-files/:id/close` does not. `closeByHand` (`server/comms-v2/file-close.ts`)
checks the approver only by way of `release`, which runs only when a hold stands. On an **unheld**
file it closes for any session holding **any** slot. Today that is invisible, because
`comms_v2_approvers` lists one slot (`ben`) and `approverFor` returns `ben` for every file without
both a tenant and a landlord — but a second slot (a VA lane) would be able to close ben's unheld
files while being refused every other action on them.

**The decision needed:** is a hand close meant to be the file owner's alone, like answering it, or
is it deliberately open to anyone the approvers row lists, so a VA can tidy the board? If the
former, the fix is one `sameApprover(fileOwner(file), input.approver)` check in `closeByHand` and a
route test beside the existing wrong-slot one; if the latter, it wants a line in the file's header
saying so.

## 3. What a thread does between a stop request and Ben recording it

Found: round 5 (17 Sep 2026), driving opt-outs across SMS, a call and email on the sandbox door.

On the channels the old inbound path does not record — a call, an email, a web form — an opt-out
holds the file for Ben with "customer may have asked to stop <where>; check and record the opt-out"
(`optOutOnTurn`, `server/comms-v2/desk/desk.ts`), and nothing goes back on that turn. That is the
recorded behaviour and it works.

What is not recorded is what the thread does on the NEXT turn, while that hold still stands and
before Ben has written the ledger row. Driven: after an email whose whole message was "STOP", the
same person's next message ("Did you get my email?") was routed, scoped and composed as usual and
the reply was delivered —

    "Hi Dara, I'll check on your email and come back to you. For the kitchen tap at 14 Elm Road,
     what's the postcode? A photo of the tap would help if easy, no pressure. Happy to give you a
     quick call, or if it's easier you can message us on WhatsApp on this same number."

— asking for a postcode and a photo, offering a call and offering another channel, to someone who
had asked us in writing to stop. An opt-out hold is not one of the exception holds (complaint,
refund, trust, gas), so the desk does not treat it as a thread gone quiet: the specialists run and
the composer writes. The suppression row does not exist yet either, so the live opt-out gate in
`server/outbound.ts` would not stop the send (and on a thread whose reply channel is SMS or
WhatsApp, unlike email, that send is a real one).

**The decision needed:** while an opt-out hold stands, should the thread (a) stay silent, as it is
on the opt-out turn itself, (b) send the held acknowledgement only, as an exception hold does, or
(c) carry on as now because a person who writes again is asking us something? If (a) or (b), the fix
is one line in the desk's held-thread branch that reads an opt-out hold like an exception hold, plus
a test; either way it should be written down, because today it is the one hold whose standing
changes nothing about what the desk says next.
