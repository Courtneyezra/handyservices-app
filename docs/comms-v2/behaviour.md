# What the comms desk should do - the captain's own answers

The test oracle. Confirmed by the captain directly, not inferred from documents.
Written 8 Sep 2026. Every line here is his answer to a question firstmate put to him.

## Batch 1, answered 8 Sep

**1. Replying when the right reply is not a question.**
"Reply, even when it isn't a question." The assistant answers naturally: acknowledging,
summarising, confirming. He accepted that the repeat-acknowledgement safety must land first.
Evidence that prompted it: thread 495577b5 (Priya), where a correct summary of the job was
composed and never delivered because only ask_gap may send.

**2. How many messages per customer turn.**
"One reply, up to three bubbles." One reply per customer turn, which may arrive as two or three
short WhatsApp bubbles, like a person typing. Not one reply per inbound message.

**3. When the clerk should build a quote.**
"The job and the location, photos optional." As soon as the desk knows what the job is and where,
it builds a quote. Anything missing is Ben's to request from the price screen.
Consistent with his earlier rule: ask for a photo, but if there is hesitation do not insist.

**4. When the assistant may deliberately stay silent.**
"Almost never, always acknowledge." If someone writes, they hear something back.
This is the opposite of today's behaviour and directly contradicts the current design, which is
silent on a pause, on a promised-more, and whenever the model chooses not to propose.

## Consequences firstmate must not lose sight of

- Answer 1 conflicts with the `neverSend` list shipped in B7a (PR #6): `clarify_scope` and
  `faq_from_kb` can never reach SEND there, and `answer_from_quote` cannot on post-quote threads.
  That list was a deliberate safety decision on 7 Sep. Answer 1 cannot be delivered without
  revisiting it, and that is a captain decision, not a build.
- Answer 4 requires the promised-more wait and the "no proposal" silence to change.
- Answer 3 requires the clerk's readiness test to stop treating media as required.
- Answer 2 is roughly today's behaviour; the risk is repeats across turns, not bubbles within one.

## Batch 2, answered 8 Sep

**5. The neverSend lock.**
"Unlock everything that replies." Restating scope, answering from the knowledge base and answering
from the quote should all be able to reach the customer. He was shown, before choosing, that these
are the reply types that assert facts about the business, that the answering review (s10) found
NOTHING in the codebase can check whether such a claim is true, and that no knowledge base exists.
He chose it anyway. **This reverses the neverSend safety decision of 7 Sep (B7a, PR #6).**

**6. Out of hours and outside the messaging window.**
"Reply normally, hours do not matter." A customer who writes at any hour hears back.
He was shown that a 2am reply may read oddly from a handyman business.
Note: outside the 24-hour WhatsApp window only approved Meta templates can send at all, which is
a platform limit, not a policy choice, and no amount of unlocking changes it.

**7. Questions after the quote is sent.**
"Answer from the quote itself." What is included and excluded, the prices already on the quote,
what happens on the day. Read back to the customer rather than invented. Currently locked.

**8. A customer who is not ready ("I'll get back to you next month").**
"Acknowledge and stop, no chasing." One reply so they are not left in silence, then leave them
alone until they write again. No follow-up work, no re-engagement sequence.

## The standing tension, stated once so it is not lost

Answers 1, 5 and 7 together mean the desk should say things about the business, and about a
quote's contents, without a person reading them first. The s10 review established that no rail in
this repository can check whether such a statement is TRUE, because nothing records what is true.
Guards catch figures, dates, durations, commitments and credentials. They cannot catch a wrong fact.

The captain has chosen this knowingly, twice. Firstmate's obligation is therefore not to re-argue
it but to make the gap as small as possible: prefer answers whose source is checkable (a figure on
the quote the customer already holds, a line the owner wrote) over answers the model composes from
its own understanding of the business, and say plainly which is which whenever work is briefed.

## Batch 3, answered 8 Sep (build-plan questions, asked before writing the plan)

**9. Sending default once inverted.** "Send everything; hold on exceptions."
Every reply type sends on its own; money, complaints, regulated work, trust doubts and guard hits
still hold for Ben.

**10. First contact.** "The Scoper, from the first message." No fixed acknowledgement; the
assistant replies naturally, offers a call, asks the first scoping question.

**11. Sources for answers.** "The quotes, thread, knowledge base, CRM." All four.
The knowledge base: "Ben writes it in the admin, seeded by us." We seed a draft from the website
and past threads; Ben corrects it; the Scoper reads it as a tool and cites the entry.
CRM reads: "Their records plus business availability" - that customer's own lead, quotes, jobs,
dates, past visits, invoices, plus the diary.

**12. Dates.** "Diary for facts, picker for booking." The assistant may state typical lead time
and confirm a booked date from the diary; it never offers or books a slot. Booking stays on the
quote's picker. This narrows the old "dates come with your quote" rule to booking only.

**13. Window shut (24 h WhatsApp window closed).** "Approved templates for the common cases."
Three or four Meta templates; the desk picks one; freeform resumes on the customer's reply.

**14. While a thread sits with Ben.** "Answer what it can, hand the rest to Ben." The assistant
keeps replying to anything outside the exception and says Ben will come back on the rest.

**15. Ben's handset replies.** "No, Ben replies through the admin only." Nothing to build;
a handset reply still leaves the thread with Ben. Training, not code.

**16. Rollout.** "Sandbox checklist first, then all live threads." Flip on the captain's word.

**17. Second-model pre-send check.** "Not now; sampler and digest only."

**18. Done means.** "Every checklist line passes in the sandbox" AND "You review ten real threads
yourself."

## Batch 4, answered 8 Sep (after the four-scout review of plan v1: reports s28, s29, s30, s31)

**19. A promise of more.** "One acknowledgement, then quiet." The desk says it will wait for the
photos, once, then nothing until the customer writes. Checklist 2.5 is reworded to match.

**20. The follow-up after Ben's own outbound call.** "Sends unattended." Reverses the one-tap draft
T21 left in place. Needs an approved template because a call does not open the WhatsApp window.

**21. Which exceptions the desk talks around while a thread is with Ben.** "Money, callbacks and
date changes only." On complaints, refunds, trust doubts and gas: one fixed line in Ben's words,
then Ben only. The Scoper does not scope those threads.

**22. Diary facts.** "Build a proper diary read first", and "Before the flip". One canonical
booked-date read and a computed lead time land before the desk goes reply-by-default. Pushes the
flip from week 4 to week 5. No slot offers; booking stays on the picker.

**23. Prices read back from the quote.** "Figures, copied exactly from the quote line." A figure may
appear in chat only when it equals one line of the live quote to the penny, cited as that line. No
totals the model adds up, no superseded quote.

**24. Bot disclosure.** "No disclosure line." Stands with the 7 Sep decision. The privacy notice
still names every processor and says an assistant may draft and send replies.

## Batch 5, answered 10 Sep (fresh-design questions, from the agent map page)

**25. One case file per customer across every channel.** "Agreed." Not one per channel thread. A job that
starts on the web form, continues on WhatsApp and ends with a call is one conversation; the ask ledger
spans all of it. Consequence: identity must join phone and email to one person before the desk replies.
Channels in scope for the fresh design: WhatsApp, SMS, calls, web form, email.

**26. The landlord/tenant service.** The vision in his words: "we onboard landlords, they onboard their
properties and tenants. Any issues tenants contact us directly, we triage, try and solve the issues if
possible, scope, quote, present to landlords, accept, book." Case file for a tenant issue: "one per
issue, two parties." Decision: the service ATTACHES to the redesigned desk, it is not standalone; the
fresh build carries the seams (identity returns a role; case file has parties; the hold routes to an
approver slot, Ben or a landlord's rules; open lanes for a DIY-first specialist; reply channel per
party; a desk-initiated send entry; a reserved portal adapter) and builds nothing landlord-specific now.
Parked until that build: emergency auto-dispatch authority, how hard to chase a landlord, and whether
letting agents and proactive maintenance are in the first version.

## Batch 6, answered 10 Sep (closing the fresh-design decisions before the /goal build)

**27. Bubbles.** REPLACES answer 2's hard "up to three". His words: replies must be "as human like as
possible as in not long paragraphs and broken into bubbles that read as a human would separate
messages." The composer writes ONE reply; the sender splits it per channel (WhatsApp: natural breaks
with short typing gaps and a soft ceiling; SMS: one message; email: a letter). No fixed count.

**28. The coordinator composes.** "The desk coordinator should use the text model to give a
conversational answer." Two jobs: route (subject, stage, exception) and compose (write the one human
reply from what the specialists return). Specialists return facts with their source, never prose.
This is how a two-subject turn ("how much, and when can you come?") gets one natural reply.

**29. Send path.** Follows from 28: only the composer writes to a customer; every draft goes
coordinator -> guards -> the one sender. Specialists hold no send tool.

**30. Runtime models at launch.** "Fable 5.1 composer, Sonnet 5 specialists, Haiku 4.5 router."
Guards run no model. Cost per thread measured from day one; step a role down only when quality holds.
Accepts Fable 5.1's 30-day data retention; the privacy notice must reflect it.

**31. First /goal.** "Skeleton plus Scoping, WhatsApp only": gateway, identity, case file, router and
composer, guards, sender with bubble rendering, the Scoping specialist and its tool server. Done when
every Stage 1 and Stage 2 checklist line passes in the sandbox.

**32. Remove and rebuild.** "Completely remove existing comms and build new." Boundary firstmate
stated and he did not contest: the desk (spine, legacy agents, handover, post-call, comms worker) is
replaced from a blank file; the channel plumbing (Twilio webhooks, WhatsApp send, template sync, the
sender registry that gates every customer send) stays because quotes and invoices send through it.
Order: build beside in the sandbox, cut over on the switch, keep the old desk as rollback, then delete.
Crew models for the build: Fable 5.1 for backend/complex, cheaper models for frontend/easier tasks.

## Batch 7, answered 10 Sep (the three calls from the code inventory, report hsa-comms-v2-tools-s)

**33. Goal 0, the judge.** "Yes, build the judge first." A structured planned-send object from a dry
run, a scripted multi-turn runner over the sandbox doors, and a window that can be shut. Stop: the
runner drives the eleven Goal 1 lines against the current desk and reports pass or fail per line.
*Withdrawn 11 Sep:* "remove the judge, push parallelism, we will use lavish when needed." The judge
duplicated the no-mistakes pipeline's own end-to-end test step and forced a forty-five-minute
evidence regeneration after every review fix round. The pipeline's test step with recorded
evidence now validates each goal, and the captain's own review of sandbox threads is the bar. The
checklist stays the written oracle; the planned send stays, emitted by the desk's own door.

**34. Shut window.** "Approved template, as decided before." Reaffirms answer 13. The current
sender's silent fallback to SMS with freeform text goes.

**35. Price catalog.** "No, the four sources stand." Figures in chat come only from a line of the
live quote, to the penny. The catalog supports Ben's price screen and the quote builder only.

**36. Nothing existing is fixed.** "We are not fixing anything that is here and existing. We are
deleting the complete old comms and building new to the new framework." Sharpens answer 32: every
customer-facing piece is new, including the gateway, adapters and sender. Defects found in the old
comms are not fixed; their real requirements move into the v2 contracts. Only non-comms code survives
(quote engine, price book, Ben's price screen, invoicing) and its send path is re-pointed at cutover.

**37. Cutover wiring.** "Completely build comms again, make the old one obsolete, and connect the old
input to the new plumbing." The inbound entry points already registered with Twilio, Meta and the
web form stay as addresses; their handlers become thin forwards into the new gateway. The desk
switch decides which desk a turn reaches: sandbox first, flip on the word, old desk obsolete, then
deleted. Nothing is re-registered with a provider.

**38. Ben's desk UI.** "Front end kanban style UI is fine for now." Ben's desk is a kanban board over
case files: one column per stage, held items surfaced at the top, one tap to release or answer. Not
polished, just visible and operable.

## Batch 8, answered 11 Sep (the review of Ben answering a customer from the board)

**43. The guards over Ben's own words.** "humanReply does not run the desks guards over a reply Ben
typed. None of the eight, not figure, date, commitment and fault, business claim, disclosure,
regulated, ask ledger or one reply. They exist to stop the composer inventing things and Ben is the
source. What still applies is everything the sender owns: the window rule so a shut window takes an
approved template and never freeform, an approver and a run id on every send, the party being on
the file, and one run id sending once. Record on the send that the author is human and the guards
did not apply, so the file reads honestly rather than claiming a pass." On the same answer: the
one-reply carve-out goes with the guards, nothing left to override; the sandbox door's own answer
endpoint goes, because the board already has an authenticated answer route and the door only added
a second unauthenticated path to the same function on a router any admin session can reach; and the
quote-line citation shelf goes, because the desk keeps one structured spelling of a fact source and
a shelf that offers every quote line would let Ben cite a price the customer was never given. The
record he asks for is the `human:<person>` approver on the send, the signed-in person's own email or
user id, which no automated path can produce:
that is what says a person wrote the words. The send record was deliberately not widened to say more,
because no send stores a guard result at all, so none of them claims a pass, and that shape is the
shared case-file contract every goal is building against.
