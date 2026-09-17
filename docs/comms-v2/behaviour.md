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
keeps replying to anything outside the exception and says, in Ben's first person, that he will
come back on the rest.

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
The file is the job's, so it closes (17 Sep, job-file close: "Both"): on its own once the job is booked
or done, and by Ben's hand from the board. The customer's next message then opens a new file; a file
at quoted or accepted stays open (server/comms-v2/README.md, "Closing a case file").
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

## Batch 8, answered 11 Sep (the quoting build, and the review of Ben answering a customer)

**42. Payment paths.** Payment paths are not validated live. The deposit and the Stripe webhook are
not driven in the sandbox; the door records the acceptance event itself, exactly what the webhook
writes on the quote row, so the desk's own behaviour after an acceptance can be checked without
taking a payment.

## Batch 9, answered 11 Sep

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

The answer is about who WROTE the words, not who licensed the send. Ben pressing send on the price
screen licenses a message the desk wrote for him: the route carries no message body, so nobody reads
it before it goes, and it is a composed reply Contract 4 checks like any other
(`server/comms-v2/quoting/deliver-quote.ts`, the one delivery both the sandbox door and Ben's live
price screen take). The one-reply guard is told a person licensed that send, because his pressing
send is a fresh licence to speak and not the desk replying twice to one customer turn; the other
seven run over the words unchanged.

**A quote is never marked sent when the text that went is not the quote.** The window rule the
answer keeps means a shut window takes an approved template rather than freeform text. With
`quote_ready_link` approved (its second variable the link) a shut window takes that template, sent
under the person who licensed it rather than composed; with it not approved, Ben pricing on a shut
window holds for him and leaves the quote a draft he can price again, rather than delivering a
generic re-open nudge while the file records every figure as live. The same holds for a guard
failure and a refused send.

**44. Scrub the pipeline's test database.** "scrub". The Neon branch is a copy of production, so the
pipeline's live drives and PR evidence exposed real names, numbers, addresses and message bodies.
Every identifying value becomes synthetic, shapes preserved so the product still parses them, and it
runs once the goals in flight have landed. The alternative, accepting the exposure and naming GitHub
as a recipient in the processing record, was declined.

**45. The dispatch pool goes.** "these three need to be deleted, we only slect 'Quote skin (contractor)' on building a contextual quote", then "Delete the dispatch pool entirely". The contractor is chosen once, as the quote skin, when a contextual quote is built, so there is no later assignment step for a pool to feed. Three paths create an unassigned pool job today and all three are wrong: a cash-on-the-day booking, a visit booked during a live call, and a return visit raised from a dispute. Only the card path through the picker creates a real assigned job. Removing the pool takes the assignment flow and the dispatch board with it. Open at the point of asking: what a live-call visit does, since it has no quote and so no skin.

**46. The Service specialist's masked record.** Option A. In his words, as carried in the Goal 6 Service continuation's instructions: "keep the customer's email address and postal address out of the model entirely. The specialist may know that we hold an email or an address on file, so it can say we have one, but it must never receive or repeat the value. Name and phone stay as they are. A customer asking what address or email we hold holds for Ben with a clear reason on his card. Do not amend docs/COMMS_RECORD_OF_PROCESSING.md or the privacy notice page." Asked because the Service specialist reads the customer's own record and the record of processing and privacy notice name only name and phone. Applied on 13 Sep 2026 to a customer typing a new email or address: plain code recognises and handles it before the model sees the message.

**47. How far the masked record reaches.** "1", 13 Sep 2026. Answer 46 covers the customer's stored record: the Service specialist never receives or repeats the email or postal address we hold. A customer's own typed message, including a new email or address they type, is message content and is treated like every other message; the record of processing already names the thread's messages as going to Anthropic, so no document changes. No masking in the router, composer, Scoping, Scheduling or Quoting. Service's address-recognition check stays as best effort, a documented known limit, and whole messages are not withheld. Asked because Goal 6's review raised the same theme three times and a strict version would need plain code before every model call, which breaks Scoping's reading of the postcode. Declined: strict desk-wide interception, and withholding whole change-of-details messages from Service alone, since the router would still see them.

**48. Desk-started sends proven live at the switch-over.** "1A", 14 Sep 2026. PR 48 (a desk-started chase or escalation carries its own purpose to the deliverer, marketing class at the opt-out ledger, context comms_v2:<purpose>) stays merged and dormant; it is not reverted. The switch-over caller's own live test must drive live-mode approver chases and owner escalations and prove each is labelled, gated and recorded under its own purpose, never as a customer service reply. Asked because PR 48 merged overnight while its live test could not reach live mode, since no caller sends it live before the switch-over.

**49. Which WhatsApp templates go to Meta now.** "templates 1 to 3, draft accepted", 14 Sep 2026. Submit answer_ready_reopen_v1, post_call_followup_v1 and web_enquiry_ack_no_call_v1 with the wording already in server/window-templates.ts, unchanged. Do not submit enquiry_followup_optin_v1, the marketing chase, for now: no customer-facing chase rung sends it yet. Draft the missing template for a customer who accepts a quote after the 24-hour window has shut, for his review; submitting that one needs his separate word once he has read the wording. Submission goes through the live Handy Services Twilio account only.

**50. Web form photos land now; the server check is proven at the switch-over.** "a", 14 Sep 2026. PR 57 merges as it is: the desktop enquiry form takes up to four photos, 6MB each, checked again on the server by their real content, and the public POST /api/leads body limit rises to 40mb to fit them. A small per-sender rate limit on that route follows as its own job (hsa-leads-rate-limit). The server-side photo check could not be driven live before the internal-number directory exists, so the switch-over's live test must drive it: too many photos, too large, a non-image labelled as an image, and a valid photo. Declined: cutting the per-photo limit to 3MB, and adding the rate limit inside PR 57 before merging.

**51. The dispatch pool job is obsolete.** "dispatch pool is obsolete", 14 Sep 2026. The work answer 45 set up (delete the dispatch pool and the assignment step, and decide what a live-call visit does with no quote) is closed without building. Do not reopen it from answer 45's wording.

**52. Old automatic customer follow-ups stop with the old desk.** "1A", 14 Sep 2026. At the switch-over every old automatic customer message is refused while the new desk is live, including the ones with no new-desk replacement yet: system.lead_automation (quote reminders, the photo or video request, lost-lead recovery) and agent.sla_chase. One voice per customer; answer 8's one acknowledgement then silence holds. The new desk gains its own customer follow-ups later. Declined: keeping those old automations running beside the new desk.

**53. Ben's chase and the owner escalation go by WhatsApp template.** "2A", 14 Sep 2026. The desk's chase to Ben and escalation to the owner stay WhatsApp templates (desk_approver_chase_v1, desk_owner_escalation_v1), submitted to Meta by the captain alongside the others, with Ben's and the owner's numbers placed on Railway as COMMS_V2_CHASE_BEN_E164 and COMMS_V2_CHASE_OWNER_E164, never committed. Declined: chasing Ben by phone notification instead.

**54. The WhatsApp templates are in, and the two unplanned ones stay unused.** "1 -leave them unused, 2- start thte fix", 15 Sep 2026. The captain submitted the templates from the Mac on 15 Sep and Meta approved all seven: the five from answers 49 and 53, plus quote_accepted_ack_v1 and the marketing enquiry_followup_optin_v1, which answer 49 had kept back. Those two stay approved but unused: nothing wires, triggers or deletes them without a new answer. missed_call_ack is approved by Meta as marketing, so the app must treat it as marketing and a customer's STOP must block it; that fix is built now as a go-live necessity.

**55. Go-live: a real chat for Ben, email in test mode, ten live threads after a limited switch.** "1- b,2- a,3-a", 15 Sep 2026, answering the plan coverage check (hsa-comms-v2-plan-coverage-s32). 1(b): before the switch, each card on Ben's board becomes a live conversation: thread first, live refresh while open, chat styling, photos, one-tap send of a held reply, and a template send when the WhatsApp window has shut. This builds on answer 38's kanban rather than replacing it. The captain chose b alone, so retiring or rewiring the old /admin/comms page was not decided. 2(a): email goes live in dry run only, and the go-live says so. 3(a): answer 18's ten real threads are read after a limited switch with the roll-back ready. Declined: switching on with the sheet as it is, choosing an email provider before go-live, building a dry-run shadow mode over real traffic, and counting sandbox threads.

**56. The old comms page goes at the switch.** "the old comms to be removewd", 15 Sep 2026, answering whether the old /admin/comms page stays in Ben's menu once the new desk is live. While the new desk is live the old page is gone from the menu, its route sends staff to the new board, and every staff link or notification that pointed at it (such as the payment ping) points at the new board. It comes back unchanged on roll-back, because the old desk is the roll-back; its code is not deleted before cutover. Declined: keeping the old page beside the new board after the switch. Scope, settled by firstmate on 15 Sep 2026 and told to the captain: the question was about customer conversations, and the old page also carries the only contractor messaging lane, so its contractor lane stays reachable while live (contractors only, no path to a customer thread or send) until the new desk takes contractor messaging over (the after-go-live extra hsa-extra-desk-contractor-messaging).

**57. Ben's board keeps the kanban with the chat docked beside it.** "option 1", 15 Sep 2026, choosing from the four layouts in hsa-comms-v2-ben-board-layouts-s33. On a wide screen, tapping a card opens its conversation in a panel beside the board; on a phone it opens full screen, chat first, with a way back. The seven columns and held-on-top cards stay as answer 38 settled, and the chat view is answer 55's. Built with answer 55's chat work, not as a separate job. Not chosen: the inbox split view, the focus queue and the compact table; the focus queue stays a candidate once Ben uses the live desk.

**58. On a shut WhatsApp window, Ben's board offers only a template that is true for the thread.** "b", 15 Sep 2026. When Ben's typed reply is refused because the 24-hour window has shut, the board offers quote_ready_link with the real link when a quote has gone out, answer_ready_reopen_v1 only when the customer's latest message is an unanswered question, and otherwise no template: the customer must write first. A template whose variables cannot be filled truthfully is not offered. Never offered from that button: quote_accepted_ack_v1, enquiry_followup_optin_v1 (answer 54) or any marketing template. Declined: always offering answer_ready_reopen_v1, offering no template at all, and a new general template for now (it stays an option if Ben finds gaps).

## Batch 10, answered 15 Sep (the five report holds split into one board card per question)

Given on the bearings board, captured result lavish-d6356d3e6027f92c sequence 5, each recorded on its own question item (q-*), plus the captain's chat follow-up the same afternoon. Quoted words are the option labels he chose. Caveat firstmate owns: the S15 questions came from the 7 Sep review of the old desk (server/spine), and the cards did not say so; each answer still needs mapping to the new desk before any build, and an answer that only changes the old desk lapses at the switch.

**59. After the holding line, a second automatic message.** "A second automatic message after a set number of hours", wording his, per the no-templates ruling. (S15 D1.)

**60. Any person's reply hands the thread back to the desk.** "As soon as any person replies to the customer". Follow-up in chat, not yet settled: "maybe need a human override toogle to not allow to switch back to agent?", a per-thread switch so a person can keep a thread from returning to the desk. (S15 D2.)

**61. An unpriced quote: both.** "Both: remind Ben, escalate to the owner, and tell the customer it is taking longer". (S15 D3.)

**62. "I don't want to pay for a quote" gets its own handling.** "Yes: its own reply and more urgency". (S15 D4.)

**63. Detail asks keep sending while photos are unread.** "Keep sending until photo reading lands". The new desk already reads photos, so this applies to the old desk only. (S15 D5.)

**64. The 07:30 promotion stays on.** "Keep it on". Old desk only. (S15 D6.)

**65. Per-message alerts off.** "Turn off the per-message alert"; in chat: "turn off alerts for non important messages". (S15 D7.)

**66. The acceptance email's 24-hour WhatsApp promise: change the words.** "Change the email's words". (S15 D8.)

**67. The owner escalation stays.** On the board he chose "Nobody" as the last person chased; asked about the clash with answer 53, he replied in chat "keep the escualtion". Answer 53 stands: Ben is chased, then the owner. (S15 D9.)

**68. Answered calls: count first.** "Count how often it is missed first". (S15 D11.)

**69. Customer answers may carry one unchecked claim.** "Accept the risk for trust and policy answers". (S10 D1.)

**70. A fixed fact inside the desk's own sentence is not a template.** "Not a template: allowed". (S10 D2.)

**71. What the desk may answer by itself.** "Only trust and policy questions", from the facts list. (S10 D3.)

**72. The facts list.** "You write it, Ben checks it against what he actually says". (S10 D4.)

**73. Urgent dates.** "Yes": on today, asap or urgent, reply that dates come with the quote as well as asking for details. (S10 D5.)

**74. The website copy changes to match the chat rules.** "Change the website to match the chat rules" (free quote, no call-out charge, Gas Safe engineers, no-charge fix). Also covers the Meta report's public-copy point. (S10 D6.)

**75. The sampler goes off until something sends by itself.** "Off now, back on the day something sends by itself"; in chat: "you turn off sampler". Firstmate holds no login to the live app, so the toggle on /admin/staff is his. (S10 D7, S12 1.)

**76. The question-mark rule is relaxed.** "Relax it now". (S10 D8.)

**77. The Scoper may repeat a price already on the customer's quote.** "Yes: build it now". (S25 D1.)

**78. A price range from past quotes: later.** "Yes, but later". (S25 D2.)

**79. The Scoper works from the case file.** "Case file only; look-ups only for price history". (S25 D3.)

**80. Answers from the quote may send by themselves once built.** "Unlock once it lands". (S25 D5.) Still open: S25 D4, whether the Scoper talks after a deposit; he chose re-check, and nothing had changed.

**81. Meta's agent: keep building the desk.** "Keep building our desk". (S24 D1.)

**82. WhatsApp bubbles from 1 October.** "Keep up to three bubbles". (S24 D2.)

**83. The paused handset route resumes.** "Resume it", for the paused handset route. (S24 D3.)

**84. The number stays on Twilio.** "Stay on Twilio". (S24 D4.)

**85. No Messenger or Instagram leads.** "No". (S24 D5.)

**86. Spend limits on the three loops: build now.** "Build the limits now". The loops named in the audit are in the old desk; map them to the new desk before building. (S12 2.)

**87. The Google Business key: leave it for now.** Board: "Not sure, I will check"; chat: "leave google business key for now". (S12 3.)

**88. The build server stays at 8 GB.** "Stay on 8 GB".

**89. Ben's four fixed lines (answer 21), in his first person.** Chosen 15 Sep 2026 from firstmate's drafts, each the recommended option. Firstmate flagged that the code defaults speak of Ben in the third person ("I've passed this to Ben"), which breaks the brand-voice house rule that the desk is Ben; these replace them for the four knowledge-base rows:
- gas: "Thanks for getting in touch. We don't take on gas work, so a Gas Safe registered engineer is the one to call for this. / Thanks / Ben"
- complaint: "I'm sorry to hear that. Leave it with me, I'll look into it properly and come back to you personally. / Thanks / Ben"
- refund: "Understood. Let me go through the job and the payment, and I'll come back to you on it personally. / Thanks / Ben"
- trust: "That's a fair question. Let me get you a proper answer rather than a quick one, and I'll come back to you. / Thanks / Ben"
No timeframe in any of them. Still open as follow-up: the desk's other fixed lines in code (money_to_ben, held_ack, no_source and the rest) also name Ben in the third person.

## Batch 11, answered 16 Sep (a live thread case study)

Also 16 Sep, superseding answer 88: the server was rescaled to 16 GB, and work is gated by free memory rather than a worker count.

**90. A bare "thanks" after the desk has promised the quote.** "One short bubble". A brief human reply, never a repeat of the previous message. Refines answers 4 and 19.

**91. WhatsApp pace.** "Longer gaps only". Keep the 8-second quiet window; space bubbles by roughly their typing time.

**92. Referring to customer photos.** "One light detail". A short natural mention of what the photos show, not a full description.

**93. Bubble size.** "About 160, 1-2 sentences". A soft ceiling of about 160 characters per WhatsApp bubble, split at natural breaks, still at most three bubbles (answer 82). Refines answer 27.

## Batch 12, answered 17 Sep

**94. The holding line is not an answer.** "Yes, offer it", 17 Sep 2026, answering the open question from PR #110. When the only outbound turn since the customer's question is the desk's holding line (or its photo or video variant) and the WhatsApp window has shut, the board offers answer_ready_reopen_v1. Refines answer 58. Settled by firstmate on 17 Sep 2026 in the same change, not part of the captain's answer: answer_ready_reopen_v1 is offered only on a hold for a question, never on a complaint or other exception hold, so that template never clears one; its subject is the recorded job type, else "your enquiry", never the customer's own words. quote_ready_link is unchanged by this change. Implemented in `sendWindowTemplate` (`server/comms-v2/desk/human-reply.ts`).
