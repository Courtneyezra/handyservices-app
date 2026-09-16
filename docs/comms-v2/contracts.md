# The comms desk contracts

The contracts for the clean-sheet comms desk rebuild: a record shape, its named calls, what
each call refuses, and an invariants paragraph, for each. Then how a goal is validated. Contracts
1 to 6 are Goal 1's; Contract 7, the Quoting tool server, is Goal 4's; Contract 8, the Service tool
server, is Goal 6's. The Scheduling tool server (Goal 5) is unnumbered.

A goal loop builds against these calls; a test checks the invariants. Written from the code
inventory, not from scratch.

## Contract 1 - Identity

Turns an address on a channel into a person with a role, before the desk replies. Every turn
passes through it; nothing downstream ever sees a raw phone number.

| Call | Input | Returns | Refuses when |
|---|---|---|---|
| `resolve` | channel kind; the address as received; optional hints from the turn: name, email, phone, property postcode | person id; customer id; role, one of `homeowner`, `tenant`, `landlord`, `contractor`, `internal`; whether this person is new; the canonical address; for a tenant, the property and landlord ids | The address matches two different people: returns the candidates and no reply may be sent until a person picks one. The address matches nobody and a key the turn only asserts, such as the email typed into the web form, names someone else: those are candidates too, never a silent bind. Ben's own handset or a staff number resolving as a customer. |
| `canonical` | a phone or an email, in any form | one canonical key: `phone:+44...` in E.164, or `email:<lowercase>`. Same convention the customer record already uses | Not a phone or an email. Five phone spellings today collapse to one key. |
| `link` | two canonical keys and the evidence they belong together | one person carrying both keys | Either key already belongs to a different person. The web form is the normal evidence, because it gives phone and email together. Anything weaker is Ben's call. |
| `register_internal` | a canonical key and a name | the key marked `internal` | The key is already a customer. Ben's handset, staff, and the business's own numbers live here so they are never treated as a customer. |

**Invariants.** One canonical key never maps to two people. A person may carry many keys. A turn
binds to an existing person only on a key the turn itself proves, the address it arrived on, or on a
key the business already holds for that person; a key the sender merely asserts about themselves is
evidence for `link`, never for `resolve`, because a shared household address or a typo would
otherwise append a stranger's enquiry to someone else's file and let a reply written from that whole
thread be addressed to the stranger. Role resolution runs in a fixed order, internal, contractor,
tenant, landlord, known customer, new customer, and stops at the first match. For Goal 1 only `homeowner` and `internal` are live; the
tenant and landlord roles exist in the type and return nothing until the landlord service attaches.

## Contract 2 - Case file

The job's folder. One per job, never per channel, with every party on it. It is the only state
specialists share; nothing passes between them any other way.

| Field | Holds | Rule |
|---|---|---|
| parties | each person on the job: person id, role, the channels they can be reached on with the canonical address, and for WhatsApp when the window closes | At least one. A tenant issue has two. Reply channel is chosen per party, never per file. |
| turns | every message from every channel in order: when, channel, direction, party, kind (text, media, call transcript, form, portal action, system), body, media with its description once described, and for outbound the run id and approver | Append only. A turn is never edited or deleted. A call transcript is a turn like any other. |
| stage | one of `first_contact`, `scoping`, `ready`, `quoted`, `accepted`, `booked`, `done`, with the history of every change and why | Moves only through `set_stage`. The kanban's columns are exactly these seven. |
| facts | what has been established: key, value, the source (thread turn, quote line, knowledge-base row, customer record, diary row, media description), when, and by which specialist | A fact without a source is refused. The composer may write only from facts. This is how "never a claim we cannot evidence" becomes checkable. |
| ask ledger | per subject (media, postcode, access, handoff, and any the specialists add): asked at which turn, answered at which, thanked at which | Spans every channel and every specialist. Asking a subject already asked and unanswered is refused. Thanking twice is refused. |
| hold | whether the job is waiting on an approver, which approver (Ben, or a landlord's rules then the landlord), the reason, since when, and the words that released it | A hold is a flag on the file, not a stage, so a held job still shows in its column with the hold on top. Released only with the approver's words recorded. |
| job | type, location once confirmed, the quote reference once one exists, the booking reference once booked | Ready means type and location are both present. Photos are optional, per the captain. |
| sends | every outbound reply: run id, approver, channel, the rendered bubbles, the facts it was written from | Any message to a customer can be traced to the facts and the approver behind it. |

| Call | Does | Refuses when |
|---|---|---|
| `open` | creates a file from an identity result and the first turn, stage first contact | The person already has an open file for a job that is not done: the turn is appended there instead. Identity returned candidates rather than one person. |
| `append_turn` | adds a turn | The party is not on the file. The turn is out of order. |
| `set_stage` | moves the stage and records why | The move is not one the seven allow. Ready without type and location. |
| `record_fact` | adds an established fact with its source | No source. A figure whose source is not a live quote line or a customer record. |
| `ask` / `answered` / `thanked` | writes the ledger | Ask on a subject already asked and unanswered. Thank on a subject already thanked. |
| `hold` / `release` / `supersede` | sets or clears the hold with the approver and words; `supersede` hands a standing hold to a graver reason, recording what it was held on, what it is held on now and when it changed | A second hold while one stands. Release without words. Release by anyone other than the named approver. Supersede on a file that is not held. |
| `record_send` | records an outbound reply after the sender confirms it | No run id or approver. Facts named that are not on the file. |

**Invariants a test can check.** Every send on the file cites facts that are on the file. Every
fact has a source. No subject is asked twice unanswered. The stage history is a walk through the
seven stages. A held file has a named approver. Two parties never share a channel address on one
file.

## Contract 3 - Router and composer

The coordinator's two jobs. The router decides who works; the composer is the only thing that ever
writes to a customer.

| Call | Input | Returns | Rule |
|---|---|---|---|
| `route` - Haiku 4.5, low | the case file and the new turn | the subjects the turn touches in order of primacy (scoping, quoting, scheduling, service), a proposed stage, the party addressed, and an exception if one applies: money beyond a quote line, complaint, refund, trust doubt, regulated work, a date change to a booked job | Never invents a subject. An unclassifiable turn goes to Scoping before ready and to Service after. Structured output, no prose. |
| `gather` | each routed specialist, with the case file and the turn | from each: facts with sources, a proposal (next question, offer a call, ready, thank for media, hold with reason), and from a specialist other than Scoping the notes the composer is given: which fact to copy verbatim and what not to say | Specialists return no prose, ever. A specialist that returns a sentence is a contract failure. |
| `compose` - Fable 5.1, medium | the case file, every specialist's return, the party, and any exception | one reply, the ids of the facts it was written from, and for each business claim the knowledge-base row it cites | One reply per customer turn that answers everything the turn asked. Written from facts on the file only. No figure, date, duration or commitment unless it is a sourced fact. No disclosure line. Mirrors the customer's language and register. Never silent, with two exceptions: identity returned candidates, or a promise of more, which gets one acknowledgement then quiet. |
| on exception | the exception from `route` | a hold on the file for the approver, and a reply that still answers what it can | Money, callbacks and date changes: answer the rest and say, in Ben's first person, that he will come back on that. Complaints, refunds, trust doubts and gas: one fixed line in Ben's words, then nothing until Ben. |

**Invariants.** Exactly one composer call per customer turn. Every sentence the composer writes
that asserts a figure, a date or a business fact carries a fact id or a knowledge-base id, and the
guards check each one. The router never sees a tool; the specialists never see the customer.

**No reason reaches the composer.** A specialist's notes say what the reply may say, never why it
may not. No internal state goes into them: not a cancelled or declined booking, not a revoked,
superseded or expired quote, not a read that failed, not a count of anything the business has done.
A reason handed to a writer is a reason that can end up in the reply, and no guard checks a sentence
like that. Where the reason matters, it goes to the hold the approver reads, and to the log line and
the run summary; the brief says only that there is no date, or no link, and to say nothing about
why.

**Ben's facts are not the customer's.** Some facts on the file are written for Ben and carry an
admin link or an internal note: the three notification facts (`ben_notified`, `ben_chased`,
`quote_accepted`) and the draft's missing list (`ben_to_request`). No guard reads a fact's meaning,
so the composer boundary is the one place they are kept out: `customerVisibleFacts` filters them
from the prompt and from the ids the composer may cite. Any new fact written for Ben's eyes goes on
`INTERNAL_FACT_KEYS` on the day it is written.

## Contract 4 - Guards and the approver slot

Deterministic code, no model. Every composed reply passes here before the sender. The approver
slot is one function so the landlord service can attach without touching the guards.

**A composed reply only.** The guards exist to stop the composer inventing a figure, a date, a
commitment or a claim about the business. Words a person typed on Ben's board are not composed:
they go straight to the sender. The `human:<person>` approver on the send, the signed-in person's own
email or user id as server/approver.ts defines it, which no automated path
can produce, is the record that a person wrote them; guard results are not persisted on any send,
so nothing reads as a pass no guard gave (behaviour.md answer 43, `desk/human-reply.ts`).
A human reply is not checked, but it is recorded. The ask ledger and `callOffered` are bookkeeping
of what the business has already said, not a check on what may go, and they are the one place the
never-ask-twice rule lives, so the detectors the desk runs over its own reply run over his too, but
read tightly: the subject word and the asking phrase must fall in one clause, because a missed ask
costs one repeated question while a false one means nobody ever asks about access on that job.
What still holds for those words is everything the sender owns: the window rule, an approver and a
run id on every send, the party being on the file, and one run id sending once. Their line breaks
inside a bubble are his own too: `render` reflows the composer's prose, never a person's words.

**Only the slot the file answers to may answer it.** A person's reply is authorised against the
file, not against the row alone: the approver its hold names while one stands, else the slot
`approverFor` returns for it. A session holding some other slot is refused, on an unheld file as
much as a held one, so a slot minted for a landlord's thread can never reply on a homeowner's.

Ben's priced quote is the other way round: he licenses the send from the price screen, but the
route carries no message body, so the words are the desk's own composer's and Contract 4 checks
them like any other reply (`quoting/quoting-door.ts`).

| Guard | Fails when | Checked against |
|---|---|---|
| figure | any amount of money appears that is not equal, to the penny, to one line of the live quote or a value on the customer's own record, cited as that line | the fact ids the composer supplied, resolved on the file, and the cited line's quote resolved for liveness (`live_figure_quotes`): a revoked, superseded or expired quote's figure is refused though the fact stays on the file |
| date, time, duration | any date, time, lead time or duration appears, anywhere in the reply, that is not a diary fact this turn looked up | facts with a diary source a specialist read on this run; one written on an earlier turn is not citable, since the diary may have moved since |
| commitment and fault | a promise to do, fix or guarantee something, a claim that a change to the customer's details is already made, or an admission of fault, that is not a sourced fact; and a promise that Ben will come back on a request to move a date when no hold reaches Ben, since the date-change gate holds only a change to a booked job and nobody would keep it | a fixed phrase list plus a cheap classifier, both fail closed; the Ben promise is refused only when the turn is a date-change request and the file carries no hold |
| business claim | two rules. The verbatim rail: the reply cites a knowledge-base row, by id or through a fact, that is not a reviewed row the desk resolved, or whose body the reply does not carry word for word. Under it, the claim lexicon: a statement about the business, its services, hours, coverage or policies with no citation supporting it. The rail runs whatever the reply is about, so payment terms, invoicing and aftercare are covered where no word list reaches | reviewed knowledge-base rows by id, verbatim |
| disclosure | any line describing the sender as automated or an assistant | a fixed phrase list |
| one reply | a second reply to the same party with no customer turn in between | the file's turns |
| ask ledger | the reply asks a subject already asked and unanswered, or thanks for something already thanked for | the file's ledger |
| regulated | the reply engages with gas or asbestos work as if we do it | the regulated matcher on the turn |

| Outcome | Then |
|---|---|
| pass | to the sender, with the fact ids attached to the send record |
| fail, first time | back to the composer once, with the failures named |
| fail, second time | hold for the approver with the draft and the failures. The customer still gets an acknowledgement, in Ben's first person, that he will come back, written from a fixed line. |

**The approver slot.** `approver_for(file, exception)` returns who may release a held job: Ben for
a homeowner; for a tenant issue, later, the landlord's rules, then the landlord, then Ben.
`release(file, approver, words)` clears the hold only from that approver and only with words
recorded. A rule-based approver is a legal value of the slot from day one and has no rules until
the landlord service attaches. The guards never change when it does.

## Contract 5 - Sender and bubble rules

The only exit. Chooses the channel per party, renders for it, respects the window, and records the
send.

| Call | Does | Refuses when |
|---|---|---|
| `choose_channel` | the channel the party wrote on; for a form or a call, which cannot carry a reply: a channel they have written on before whose window can carry it, so a thread that ran on SMS is answered on SMS, and failing that WhatsApp if the number is on it, then SMS, then email, which is what a web-form first contact takes | the party has no channel that can carry a reply |
| `window` | for WhatsApp, open or shut with the reason, from the party's channel record on the file | never guessed; a channel with no recorded window state is shut |
| `render` | WhatsApp: splits the one reply into bubbles at the breaks a person would use, sentence and thought boundaries, one or two sentences and about 160 characters a bubble (up to 200 only for a reply still over the ceiling after the composer's one shorten, the shortened reply first, else the guarded reply it was asked to shorten), at most three bubbles (behaviour.md answers 82 and 93), typing gaps of roughly each bubble's typing time, 2.5 to 7 seconds (answer 91). A person's own words are rendered as typed instead: a blank line still starts a new bubble, nothing inside one is reflowed, and their gaps of one to three seconds stay. Wider bubbles of up to about three hundred characters, still at most three, are kept for one of Ben's reviewed fixed lines sent on its own, the held acknowledgement, and a quote delivery that cannot fit three bubbles of about 160 characters. SMS: one message, two segments at most. Email: greeting, body, sign-off, on the same thread | a split that cuts mid-sentence; a ceiling reached, which returns the reply to the composer to shorten rather than sending a wall |
| `pick_template` | when the window is shut: one approved template for the reply's purpose from the registry, branching on purpose never on name; freeform resumes when the customer replies | no approved template for that purpose: the reply is held as a pending draft for Ben and recorded. Never an SMS fallback for a reply. The one carve-out is the quote delivery in Contract 7, which needs a link no template carries and which skips only a WhatsApp record the customer has never written on. |
| `send` | delivers the rendered reply with an approver and a run id, then records the send on the file with the facts it was written from | no approver or run id; guards not passed on anything the desk composed, a person's own `human:` words carrying no verdicts; window shut and no template; the party not on the file; a run id already sent |
| `initiate` | a desk-started send, template only, for chasing an approver or a maintenance reminder | unused in Goal 1. Exists so the landlord service can attach without a new exit. |

**Invariants.** One run id sends once. Every send on a file has an approver. Nothing the desk
composed reaches a customer without passing the guards, and only a person's own words go without
them, under their own `human:` approver (above, behaviour.md answer 43). A shut window never
produces freeform text on any channel.

## Contract 6 - The Scoping tool server

The first specialist's shelf. Every call is read-only against the world and writes only to the
case file through its calls. The specialist itself, on Sonnet 5, returns facts and a proposal.

| Tool | Input | Returns | Refuses when |
|---|---|---|---|
| `describe_media` | a turn id carrying a photo or video | kind, description, confidence, the model used, when; persisted on the turn so it is described once | the media has not been fetched. The WhatsApp adapter must download inbound media on arrival, on both webhook paths; this is where the old photo defect's requirement now lives. |
| `confirm_location` | free text or a postcode from the turn | postcode, address where resolvable, confidence | ambiguous: returns nothing and the specialist asks, once |
| `readiness` | the case file | ready, and what is missing if not | ready is job type and location both present as facts; photos never required |
| `next_question` | the case file | the one subject to ask next, in a fixed order: job, location, access, photos | a subject already asked and unanswered; photos already asked once |
| `offer_call` | the case file | whether a call is worth offering | the party prefers text, has already rung, or has been offered one |
| `regulated` | the turn | whether the work is gas or asbestos | only those two; plumbing, roofing, structural and electrical are ours |

**What the specialist returns.** Facts: job type, location, media descriptions, each with its
source. A proposal: the next question, whether to offer a call, whether to thank for media,
whether the job is ready, or a hold with the reason regulated. Never a sentence for the customer.

## Contract 7 - The Quoting tool server

The second specialist's shelf (Goal 4). Read-only against the world except through the quote
machinery it wraps (the clerk chain, Ben's price screen), writing to the case file only through
its calls. There is no price-book shelf: the catalogue is reached only from inside the clerk chain
`draft_quote` calls, which matches each line to a SKU for Ben's screen and the engine, and it is
never a source for a figure in chat (answer 35). The specialist itself, on Sonnet 5, returns facts cited to the quote and a
brief for the composer, and never sees a figure.

| Tool | Input | Returns | Refuses when |
|---|---|---|---|
| `quote_readiness` | the case file | ready, and what Ben may want to request before pricing (photo state, access) | ready is job type and location both present; photos never required |
| `draft_quote` | the case file, the party, the intake | the draft's slug and lines, Ben's notice, the facts recorded (the missing list among them, as the internal `ben_to_request` fact; it is never written to the quote row, whose every field is served to anyone holding the slug) | not ready; the file's quote reference names a quote that exists (one draft per job; changes are Ben's) |
| `notify_ben` | a notice (ready to price, chase, accepted) | recorded on the file as a fact cited to the quote, carrying what the notifier did; the sandbox records only, the live intake also sends it to Ben's phone (Pushover) while the new desk is the live desk | a second ready-to-price or accepted notice for the same quote (one notification); no quote on the file |
| `chase` | the case file, the clock | a numbered chase for Ben, naming the price an unpriced draft is waiting for or the held delivery a priced one is waiting on | the quote is no longer a draft (it has reached the customer); Ben not yet notified; not due (four hours after the notification, then daily); three chases already |
| `read_quote_line` | the quote and a line label | the amount to the penny and the citation (quote reference, label) the figure guard verifies | draft, revoked, superseded, expired; a label not on the quote; a label two lines share |
| `read_quote_scope` | the quote | what each line covers, its assumptions, what is not included; no figure | revoked, superseded, expired |
| `live_figure_quotes` | the case file | which quotes a figure may be read from now, for the figure guard's own check of a cited line | the same rule as `read_quote_line`: a draft, revoked, superseded or expired quote is not in the answer |
| `record_quote_facts` | the case file, the quote | the quote onto the file once: status, link, every figure (each line, the total, the deposit; never half a line, which is a breakdown rather than a line and is printed in whole pounds on the quote page) when live for figures, scope when live for scope | nothing; a repeat returns the existing facts |
| `price_quote` | Ben's per-line prices, or the chain's suggestions | the priced record and the totals; the row stays a draft | not a draft; a line with no suggestion and no figure from Ben |
| `mark_quote_sent` | the case file, after the delivery landed | the quote leaves draft, its figures reach the file, the stage walks to quoted | no quote on the file; a row the store will not mark sent |
| `record_acceptance` | a witness (live, a `paid` witness names what the Stripe webhook already wrote instead of writing it here) | the row, the stage forward to accepted, one push to Ben, the facts | any witness but a human; a draft; already accepted; no longer live — a `paid` witness refuses only on a row that does not yet carry the payment, whether or not the quote is still live |

**Which database the tools open.** Every WRITER in the desk asks one place before it opens the
database, for its purpose (`server/comms-v2/live-database.ts`): the quote store, the draft chain, the
case file store, the diary and any future writer. For the sandbox it refuses unless the database in
use is the Neon branch `COMMS_V2_DATABASE_URL` names. The refusal names that requirement and
falls back to nothing. It exists because the sandbox door is mounted on the ordinary server for
Ben's board, and on the deployed server that is the production database: the quote machinery would
otherwise draft a real quote row and publish a quote page with real prices on it. Writing is the
whole subject, so the reviewed knowledge-base readers do not ask: a read publishes nothing, and
made to refuse they would throw on exactly the gas, complaint and money turns the fixed line exists
for. Ben's board reading its own approver row is a read too. For the live intake the desk switch
answers instead: it opens the database in use only while the new desk is the live desk
(`server/comms-v2/switch.ts` `commsV2Live`, server/comms-v2/README.md "Which database the intake
opens"), and the sandbox purpose never opens production whatever the switches say.

**Delivering the quote.** Ben prices on the price screen and presses send. The price route carries
no message body, so the delivery is written by the desk's own composer from the file, with the
quote link, and Contract 4 checks it like any other composed reply. The composer is told the
channel the send goes out on rather than resolving one of its own, so the shape it writes to is the
shape the render wants. The quote leaves draft only once that send has landed: a shut window on a
channel the customer chose with no approved `quote_ready_link` template, a guard failure or a refused
send all hold for Ben and leave the quote a draft he can price again, rather than recording figures
as live that the customer was never shown. With `quote_ready_link` approved a shut window takes that
template, its second variable the link, sent under the person who licensed it: its approved wording
is the delivery. Ben's live price screen takes this same delivery for a quote a live case file
carries (`server/comms-v2/quoting/price-screen-send.ts`); every other quote keeps the old send. One channel is skipped rather than held on: a channel the
customer has never written on whose window is shut, which is the WhatsApp record a form or a call
lead is given for a number known to be on WhatsApp. Holding on that never-opened window would keep
the link from the lead the fallback order was written for, so the delivery takes the next channel
in the order, which needs no template. A WhatsApp thread the customer wrote on holds as above.

One sentence of the send is a fixed line rather than the composer's, from the one registry of Ben's
fixed sentences (`first_contact_ack`, desk/fixed-lines.ts): where
the acknowledgement a web-form enquiry was owed held for Ben and never went, the delivery is the
first message that will ever reach them, so it opens with a line naming us and the enquiry it
follows, ahead of the composer's words. The composer is told the room left after that line, not the
whole channel budget, because a reply written to the whole budget and then added to is one the
render refuses. The send does not clear the acknowledgement's hold: that card is Ben's and stays on
his board until he answers it. Nothing is interpolated into the line, so no model-written fact
reaches a customer through it and its wording is guard-checked by a test rather than in front of a
customer.

**What the specialist returns.** Facts: the quote's lines to the penny, scope, not included,
assumptions, link and status, each with source `quote_line` naming the quote and the label. A
brief: the quote is with Ben, or answer from these facts, or point at the quote page to accept, or
acknowledge a not-ready customer. Holds: money beyond a quote line whatever the quote's status, since
5.3's exemption is a figure already on the sent quote and a quote still with Ben has none to answer
from, acceptance in chat, a quote no
longer live for figures, and a draft the clerk could not build, where the brief promises the customer nothing, the turn asks nothing and
carries the held acknowledgement instead, and the hold reason names the failure, because no quote
exists and Ben has had no notification. A later turn that does draft the quote answers that hold:
the desk releases it in its own words, naming the quote and its price screen, so the card never
tells Ben to build a quote that is already waiting for him. Never a
sentence for the customer. Acceptance is a human event the door (live, the payment webhook)
records; the specialist can only read it.

**A price the quote does not state as a line.** The question model names which labels a turn asks
about, and any amount asked for under a name the live quote does not carry is money beyond a quote
line, so it goes to Ben: the labour or materials half of a line, a deposit on a quote priced without
one, or a label two lines share. The quote is asked about the label the model returned, not the copy
the brief shortens, so a line whose label runs past that clamp is still a line of the quote and its
price is answered (5.3). A total and a deposit are named by their kind rather than their label, so
"the total price" is the quote's one total, and that name is then checked against the quote like any
other.

**Two lines the quote titles the same.** Ordinary work: two fence panels, two taps. Each figure is
recorded and cited under a name unique on the quote - the label, or the label with its line position
when another line shares it - so one line's price can never be recorded or read back as another's.
That name is the desk's own key and never a name a line is read by: `read_quote_line` matches the
quote's own label only, and the composer's brief names every figure by that label, saying of a title
two lines share that the title is shared and no figure may be read for it. The specialist names the
quote's own labels to its question model, each once and never those
positions, which it has no way to map onto the customer's words: asked for under the title they
share, no figure is read at all, because which line is meant is not the desk's to guess, so it goes
to Ben. Answering it from the line's own
figure under that name would state an amount the customer's quote does not, and every check would
pass it, which is worse than a hold.

**The money belt and the reading that replaces it.** The router's deterministic belt raises `money`
on the wording alone, so 2.7 never depends on one model reading. A money exception is cleared only
while the file's quote is live for figures, because the Quoting question model then reads whether the
ask is beyond a line (5.3), and the route says so (`moneyToQuoting`) whichever raised it, the belt or
the router's own model. When that reading does not happen - the turn was read as a pause, an
acknowledgement or a promise of more, the body was empty, or the call failed - the exception stands
again and Quoting sets the money hold itself. The same applies when the specialist's own read of the quote fails: the belt was cleared
on the read that worked at the top of the turn, and the brief then forbids a figure outright, because
the amounts an earlier turn recorded are still on the file and the reply is still written.

**What Ben's send releases.** Exactly one hold, and only while no other voice has been added to it.
A step saying its own card again with a later reason - a second shut window, a second guard failure
- restates that card rather than adding a near-duplicate to it, and a note the desk writes about its
own run joins the card without marking it, because it is the same automatic step speaking (`own_card`
on `note_on_hold`). Only a reason carrying someone else's words, a customer's question routed onto
the card, marks it: from then on the card is nobody's to clear automatically. So a card one step
owns end to end stays that step's to clear: the one the price route itself put on the thread when an earlier attempt did not send,
which this attempt has now done. It clears in the desk's own words naming that send, never the
delivery that went, because nobody read those words before they went and a release recorded in them
would read as Ben's own answer to whatever the card asked. A hold is one card carrying every reason
it has been raised for (`note_on_hold`), so a card that has been added to since is nobody's to clear
automatically: a question Ben owed an answer to ("do you charge a call-out fee?") would go with it,
and the delivery carries the link and nothing else. The card records that it has been added to
(`noted_on`), which is the one place any automatic release asks. The same rule governs the desk's
own release of the draft-failed card once a later turn drafts the quote. Every other card stands
outright: the first-contact acknowledgement's hold, a complaint, refund, trust or regulated hold,
and acceptance, which stays human. A delivery that held reaches nobody and releases nothing, and
what stopped it is added to whatever card is already open rather than lost.

**A quote that is no longer live for figures.** No figure may be read from an expired, revoked or
superseded quote. Revoked and superseded hold for Ben: no fresh link is recorded, the reply says Ben
will come back to them on the quote, and the hold is what asks him, so the promise is one that is
kept (6.3). A money question on such a thread is beyond a line of the quote, because no line is
live, so the money fixed line and its hold stand. On superseded, answering from the newer quote is
the better answer and is its own item.

**An expired quote is reissued** (the captain's ruling of 16 September 2026: "re-issue the price
with 5% increase", automatic, "Up to nearest £1", "Always +5% on original", "Expired, new price").
When the customer writes back after the price lock, the desk puts the same quote back live
(`quoting/reissue.ts`, `reissue_quote`) at the price the customer first saw plus 5%, the total
rounded up to the next pound and the lines scaled to it to the penny, and the one reply opens with a
fixed sentence: "Your previous quote has expired, so I've updated it. The new price is £X." then
"Here's your updated quote: <link>", followed by the composer's answer to anything else they asked.
The original is kept on the row (`pricing_suggestions.reissue`), so a second and a third lapse land
on the same figure. It is not the customer's own refresh on the quote page, which compounds, and the
desk never points them there; once the desk has reissued a quote, that page's refresh prices from
the same original too (`planSelfRefresh`), so neither path takes the total past it; a page refresh
on a quote the desk never reissued still compounds as it always has, but keeps the original on the
row, so a desk reissue after it is the original plus 5% again. The reissue is claimed by one run
with a compare-and-set on the row and the reply is that run's alone, so one lapse is told at most
once; a reissue on the row the file has no record of telling them about (a restart between the write
and the reply, another process) holds for Ben once and is never told again. It does not happen, and
the thread holds for Ben as before with the reason on the card, when the turn or the thread has
anything else for Ben (money, acceptance in chat, any router exception, any other hold), when the
reply's window is shut (no approved template carries the sentence), when the customer has any
standing opt-out or the ledger cannot say, and when the row cannot be priced from the original with
certainty (a refresh on the page or an edit since). A plain ask of the quote's own price ("is that
price still ok?", "is the £120 still right?") is not money for Ben here: the router hands it to
Quoting (`applyQuotingRoute`) and the reissue answers it ("reissue for plain asks", 16 September
2026). Only a message that is nothing but such an ask qualifies (`plainPriceAsk` in
`desk/lexicon.ts`: every clause a plain ask or a greeting, any figure one the file recorded as the
quote's total, nothing `haggleMatch` reads). Any other money-shaped turn (a counter-offer, "come
down", "too steep", cash, payment terms, extras), or money the Quoting reading finds beyond the
quote's own lines or cannot tie to the quote, stays money for Ben with no reissue, a plain ask
included when the same message carries any of it; a plain ask that is not reissued for any other
reason also goes to Ben as money. A reissue whose reply did not go holds for Ben with the new price
and link named. The card records each one (`quote_reissued`, internal): the new figure, the one
before, that it was automatic, and when it was sent or why not. Facts are append-only, so the price
before a reissue stays on the file; only the newest `quote_line:<label>` for a quote is shown to the
composer or accepted by the figure guard (`isSupersededFigure`, desk/case-file.ts).

## The Scheduling tool server (Goal 5)

The specialist for dates and lead time, on the same pattern as Contract 6: read-only against the
world, writing only to the case file. It confirms and estimates; it never offers a slot and never
books one. Booking stays on the quote's picker. Built under `server/comms-v2/scheduling/`.

| Tool | Input | Returns | Refuses when |
|---|---|---|---|
| `typical_lead_time` | the diary | the median days from a booking being made to its first booked day over recent completed bookings, as a phrase ("about 3 days", exact days up to a fortnight), with the sample size and a diary row id | fewer than five completed bookings in the last 180 days, which is also what the door fixture's emptied diary reads as; a read that fails. Nothing is ever guessed: the specialist then proposes "dates come with your quote". |
| `confirm_booked_date` | the case file | the one authoritative booked date (`contractor_booking_requests.scheduled_date`, spans read through `expandSpanDates`) and a diary row id, and nothing else: no slot and no duration, because no guard can check a half of the day against the diary | the diary is its only source, so the five quote-side preference columns (`selected_date`, `available_dates`, `date_time_preferences`, `flex_booking_within_days`, `slot_offer`) are never read; nothing booked on the file or from its quote; a declined or cancelled booking; a booking already done, or one whose last booked day has passed, since a visit that has happened is not a standing booking; a booking with no date; a booking no contractor has taken on (`assignment_status`), whose date nobody has agreed to work, which instead holds for Ben so he answers what day we are coming, as a cancelled or declined one does: that is a visit taken off the customer, which they may still be expecting, so a request to move it goes to Ben, while a job already done or past is a new job rather than a change. Every refusal gives no date at all, so the composer has none to state, and names the state it refused in, which is also what the date-change belt reads: this is the one entry point to the file's booking, so the confirmation and the belt can never disagree. A refusal the diary threw gives a stable category and keeps both it and the machine text off the prompt, since why there is no date, a cancellation above all, is Ben's to give in his own words. On a date question it holds for Ben as well, since the reply has just promised that he will come back on the date, and the hold names the read, so his card says whether it may only need a retry; the one exception is a thread where nothing says there is a booking at all, no reference on the file, no stage of `booked` and no booking the read resolved from its quote, where a read that could not say is nothing known rather than a booking, so an availability or lead-time question is still answered by the picker and the diary's lead time. That exception is the one reading `isTheirBooking` names, which the picker refuses on and the classifier's fallback guesses on; the rest of that reading governs the confirmation and the picker alone, since the fallback guesses `booked_date` for any read that was not plainly `none`. A question about the day they are booked for is not covered by it: that one still holds for Ben, because telling somebody who has a day to pick one is worse than answering late. The booking a quote is answered by is the newest from it that stands, else the newest that does not, so a cancelled visit is seen whether or not the case file happens to carry a booking reference. Refusals are marked the way the picker's are: a state of the world it read plainly, nothing booked, a booking cancelled or done, one still waiting on a contractor, is the right answer and stays out of the run's error, while a refusal that is the read failing, a diary that threw, a booking reference the diary does not hold, a file booked with nothing to read, a booking carrying no date, reaches the log and the run summary, since a case file pointing at a booking that is not there is a defect nobody else will find. A date question about a finished job belongs to the Service goals to route, not this one. |
| `picker_link` | the case file | the quote's picker, `/quote/<slug>`, cited as the quote | no quote on the file; a draft (not sent), superseded, revoked or expired quote; a quote the customer already has a booking from, standing or still waiting on a contractor, since the picker is where that date was chosen and picking again would make a second booking from the one quote, and a quote the diary could not say about on a file that names a booking, since the booking it could not read may be that same one. Those last two are the one reading `isTheirBooking`, which the specialist's confirmation reads as well; the classifier's fallback reads only its unreadable-diary half. A booking cancelled off them is not refused, nor is one from an earlier quote, which says nothing about this one. The specialist asks for no link at all while a date is already Ben's to give, so no reply that holds for Ben ever carries the link; where the link was asked for first and refused, the hold that follows names that refusal. Two refusals are the right answer rather than something wrong, a booking they already have and a quote still in draft; those alone stay out of the run's error, and every other one, the unreadable diary included, reaches the log and the run summary. The two refusals that mean the customer has no quote to pick dates on, none on the file and one still in draft, are marked `unsent`, and that mark, not the reason, is what the specialist reads for the cell "dates come with your quote" answers. |
| `date_change` | the turn | the belt: a request to move a job the customer already has, where only the verbs of movement take the job itself, since changing or swapping the job is the work they want rather than the day | when a booking stands, when one sits in the dispatch pool no contractor has taken on, when the diary could not say whether one does (the belt fails closed and Ben still hears it), when the customer has a booking they may still be expecting under the phone or email the case file records for them, and when the router raised its `date_change` exception where the diary could not say whether they have one; only then, and a change is answered with no lead time and no picker. The router's exception on a thread the diary plainly says holds nothing of theirs is an availability question |
| `party_booking` | the case file | on a date-change-shaped turn only (the router's `date_change` exception, the belt matching the words, or the classifier itself reading `date_change`), the customer's bookings, found by the phones and emails the case file records for its customer parties (never a contact typed in a turn, never the desk's own people or contractors), matched on the booking row's contact or its quote's, and kept only where the customer may still be expecting the visit: one that stands, or one cancelled off them whose day has not come. On a file naming no booking and no quote, the one standing booking of theirs is written onto the job, so `confirm_booked_date` reads it on its own path | never looked up, and never written, on a plain availability or booked-date turn; writes nothing for two standing bookings, a file carrying a quote or naming a booking, or only a cancelled booking, since confirming the wrong job's date is worse than confirming none; no diary, no contact on the file and a read that fails are `unknown`, on which the router's `date_change` exception still holds |

**Ask by diary state.** The shelf that runs is chosen by what the turn asked and what
`confirm_booked_date` found, and the two together make a grid wider than the branches read. Every
cell, as the code stands:

| ask \ state | `standing` | `unaccepted` | `cancelled` | `unknown` | `none` |
|---|---|---|---|---|---|
| `date_change` | the date confirmed, a hold for Ben, the fixed line that he will come back on it; no lead time, no picker | no date, the same hold and fixed line | no date, the same hold and fixed line | no date, the same hold and fixed line | reachable only where the customer has a booking under their own contact (`party_booking`), or the router raised its exception and that read could not say; then no date, the same hold and fixed line. Anywhere else, the router's exception included, the change is rewritten to `availability` and answered as that cell |
| `booked_date` | the date, said verbatim | no date, a hold for Ben (`date_unconfirmed`) and the fixed line, nothing about why | the same hold and fixed line | the same hold and fixed line | the lead time and the picker answer, as for `availability`, and the cell is that cell, hold and all |
| `availability` (how soon we could come, or what dates we have) | the lead time; the day it stands on confirmed beside it, and no picker, because they booked on it from this quote already; with no lead time, nothing about how soon, since the day they have is the answer | the lead time; the same confirmation, which here is the hold and the fixed line, so they hear we know they booked and Ben hears the job is stuck; no picker | the lead time and the picker: the visit was taken off them, so rebooking is what they need; with neither to give, a hold for Ben and the fixed line that he will come back on the date | where the file names a booking, or the read resolved one from this quote, the `unaccepted` cell exactly: the lead time, the hold and the fixed line, and no picker, because the booking the diary could not read may be the one they made on it; where nothing says there is a booking at all, the lead time and the picker, a read that could not say being nothing known rather than a booking; with neither to give, the same hold and fixed line | the lead time and the picker; with no quote the customer has been sent, the fixed line that dates come with the quote; with a sent quote but neither to give, the same hold and fixed line |
| none of them | nothing is looked up and nothing is said about timing, on every state |

Three readings drove those cells apart over several rounds, so there is now one, `isTheirBooking`:
the booking the diary gave is theirs (`standing` or `unaccepted`) and came from the quote the file
carries, or the read could not say (`unknown`) on a file that names a booking, by its own reference,
by a stage of `booked`, or by the booking the read resolved from this quote. That one reading decides
whether the date is confirmed and whether the picker is refused, so those two can never disagree
about one file in one state. A classification that never came back is not decided by it: the
fallback guesses `booked_date` whenever the diary read was not plainly `none`, and `availability`
only where it was, or where a read that could not say found nothing on the file saying there is a
booking at all. It is deliberately the wider guess, and the two part on `cancelled`, where the
reading says the booking is not theirs and the fallback still holds for Ben: sending somebody whose
visit was taken off them to the picker, with nothing reaching him, is the worse way to be wrong
about a turn nobody could read. Above it sits one rule of sequence: **no picker goes in a reply that
holds for Ben**, in any state, because a message must not say he will come back on the date and then
hand over the page where dates are picked. A booking from an earlier quote is not theirs for this
purpose, and neither is a read that could not say on a file that names no booking.

Two rules fill the cells where the diary gave nothing, and they read across every column. **The
fixed line that dates come with the quote belongs only to a file with no quote the customer has been
sent**, none on the file at all or one still in draft, which the picker refuses as `unsent` for that
very reason, so the tool and the cell cannot state opposite answers: telling somebody who is holding
a quote, and a booking made from it, that dates come with their quote reads as not knowing who they
are. And **a
cell left with nothing to say about dates at all holds for Ben**, with the fixed line that he will
come back on the date: no day confirmed, no lead time and no picker is a reply that would answer a
date question with silence, which is the one thing the desk may not do. A cell that says one of
those three says nothing further about how soon.

A turn that asks two of them gets both: `booked_date` and `availability` together confirm the date and
give the lead time, and only `date_change` is exclusive.

**What the specialist returns.** Facts: the lead time and the booked date, each with a diary
source the date guard recognises; the picker link cited as the quote; a change request in the
customer's words from the thread. A proposal: the fixed lines to include (`dates_with_quote`,
`date_change_to_ben`) and a hold for Ben on a date change while the file is still
answered on everything else. Never a sentence for the customer.

## Contract 8 - The Service tool server

The specialist for facts and aftercare (Goal 6). Every call is read-only against the world and
writes only to the case file through its calls. The specialist itself, on Sonnet 5, returns
selections and facts with sources, never prose; it runs its deterministic tools every turn and its
model when the router sends the turn to `service`, or when the customer's own words ask to change a
detail on their record or whether we cover their area (`asksAboutOurArea`), whatever the router
read. A coverage question also offers `kb_lookup` the areas-covered row whatever words the customer
used, raises no hold of its own and leaves Scoping to run on a mixed turn's job half.

| Tool | Input | Returns | Refuses when |
|---|---|---|---|
| `kb_lookup` | the customer's question | reviewed knowledge-base rows selected by question, best first, by id with the body verbatim | read-only; an unreviewed, retired or blank row is invisible; may return nothing |
| `customer_record` | the case file and the party | the party's own details: name, the phone and email addresses on the file, and facts whose source is the customer record; the specialist's model sees the email and address only as held, never their values | another party's record is never read |
| `change_of_details` | a field, the new value, the turn | a fact `change_of_details` with the turn as its source, and a hold for Ben; for the email or address the fact names only the field and the value rides on the hold alone | a field not on the record; an empty value; a figure; a value the record already holds. The record itself is never written here. |
| `convergence` | the case file | converging, or not with why | not converging when the job has been asked JOB_ASKS_MAX times with no job type, or SCOPING_REPLIES_MAX replies have gone since the last release and since the job began being scoped (the turn routed to the Scoper, the job asked, or a job detail on the file; the file's `scopingFrom` records when) and the file is not ready; a ready file, or one past scoping, always converges |

**What the specialist returns.** Facts: each answer as a fact whose value is the reviewed row's
body verbatim (source `knowledge_base` by id) or the record's own name or phone (source `customer_record`),
and a requested change as a fact when the new value can be read from the customer's own words (never
the model's, which never saw a masked field's value); when it cannot, no fact is written and the hold
alone tells Ben the new value could not be read. A question about the email or address we hold is never read back:
it holds for Ben as `no_source`, naming the masked field. A proposal: a hold with its reason from the vocabulary
(`complaint`, `refund`, `trust_doubt`, `no_source`, `not_converging`, `change_of_details`), or none.
A brief for the composer naming the exact words and the id to cite. An id the lookup did not return
is no source. A question about the customer's own job is Scoping's: when Scoping ran on the turn it is
left to it, so a mixed turn never holds the job half as `no_source`. Never a sentence for the customer.

**Holds and what the customer hears.** Fixed line only, no composer, no specialist until Ben
releases: complaint, refund, trust doubt, gas, not converging. Answer the rest, with the fixed line
in the reply: money, a date change, a customer asking for a call (`callback`, the router's own
reading: "call round", "call in" and "call out" ask for a visit in this trade, which no matcher
separated reliably from a phone call), no source, a change of details. A turn can raise more than
one exception: each carries its own fixed line into the reply, and the hold records the gravest. Every later turn on a held thread is
acknowledged (checklist 7.3). A question the reply puts off still reaches Ben when Service's model did not
read the turn: a composed reply that says it will check or come back (`deferralMatch`, desk/lexicon.ts; a
sentence about the quote is the wrap-up, not a question put off) holds as `no_source`, unless the turn
has already put something on Ben's card. When Service read the turn, its own answers decide.

**Return to automation (7.4).** Any human's reply, from Ben's board or the door's "Ben replies",
goes through the one human-reply path (`desk/human-reply.ts`, Contract 5): it is sent on the
thread's own channel under a `human:<person>` approver and a run id, lands on the thread as an
outbound turn, records what it asked on the ask ledger, and releases the hold with those words (only
from the named approver). The next customer turn is routed as any other: the release records where the
thread stood, so a rule counting replies counts them from there and not for all time.

**Ben's chase (7.5).** On the desk's clock pass, a held thread chases Ben after one interval and
the owner after a second, through the sender's `initiate`: template only, an approver and a run id
on each, never freeform, never on the customer's thread. Intervals and addresses are configuration;
a missing address or an unapproved template is a refusal on the chase record, never a silent skip.

## Validation

Each goal is validated by the no-mistakes pipeline's end-to-end test step against the desk's
sandbox door (`server/comms-v2/desk/sandbox-door.ts`, served by `npm run comms-v2:door`), with the
recorded evidence in the PR. The checklist lines for the goal (`checklist.md`; which lines belong
to Goal 1 is in `design.md` under Goal 1's stop condition) are the scenarios the test step
exercises: a line either passes in the sandbox or it does not, and a mismatch is a finding. The
captain reviews sandbox threads before any flip.

The door emits a planned send for every turn instead of a sentence (case id, party, channel,
window state, template id, bubbles, fact and knowledge-base ids, every guard's result, approver,
run id, hold, delivered), so a turn can be checked without reading prose. Everything up to
delivery runs for real, including the guards; nothing leaves.
