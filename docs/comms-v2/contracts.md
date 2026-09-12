# The comms desk contracts

The contracts for the clean-sheet comms desk rebuild: a record shape, its named calls, what
each call refuses, and an invariants paragraph, for each. Then how a goal is validated.

A goal loop builds against these calls; a test checks the invariants. Written from the code
inventory, not from scratch.

## Contract 1 - Identity

Turns an address on a channel into a person with a role, before the desk replies. Every turn
passes through it; nothing downstream ever sees a raw phone number.

| Call | Input | Returns | Refuses when |
|---|---|---|---|
| `resolve` | channel kind; the address as received; optional hints from the turn: name, email, phone, property postcode | person id; customer id; role, one of `homeowner`, `tenant`, `landlord`, `contractor`, `internal`; whether this person is new; the canonical address; for a tenant, the property and landlord ids | The address matches two different people: returns the candidates and no reply may be sent until a person picks one. Ben's own handset or a staff number resolving as a customer. |
| `canonical` | a phone or an email, in any form | one canonical key: `phone:+44...` in E.164, or `email:<lowercase>`. Same convention the customer record already uses | Not a phone or an email. Five phone spellings today collapse to one key. |
| `link` | two canonical keys and the evidence they belong together | one person carrying both keys | Either key already belongs to a different person. The web form is the normal evidence, because it gives phone and email together. Anything weaker is Ben's call. |
| `register_internal` | a canonical key and a name | the key marked `internal` | The key is already a customer. Ben's handset, staff, and the business's own numbers live here so they are never treated as a customer. |

**Invariants.** One canonical key never maps to two people. A person may carry many keys. Role
resolution runs in a fixed order, internal, contractor, tenant, landlord, known customer, new
customer, and stops at the first match. For Goal 1 only `homeowner` and `internal` are live; the
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
| `hold` / `release` | sets or clears the hold with the approver and words | Release without words. Release by anyone other than the named approver. |
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
| `gather` | each routed specialist, with the case file and the turn | from each: facts with sources, and a proposal: next question, offer a call, ready, thank for media, hold with reason | Specialists return no prose, ever. A specialist that returns a sentence is a contract failure. |
| `compose` - Fable 5.1, medium | the case file, every specialist's return, the party, and any exception | one reply, the ids of the facts it was written from, and for each business claim the knowledge-base row it cites | One reply per customer turn that answers everything the turn asked. Written from facts on the file only. No figure, date, duration or commitment unless it is a sourced fact. No disclosure line. Mirrors the customer's language and register. Never silent, with two exceptions: identity returned candidates, or a promise of more, which gets one acknowledgement then quiet. |
| on exception | the exception from `route` | a hold on the file for the approver, and a reply that still answers what it can | Money, callbacks and date changes: answer the rest and say Ben will come back on that. Complaints, refunds, trust doubts and gas: one fixed line in Ben's words, then nothing until Ben. |

**Invariants.** Exactly one composer call per customer turn. Every sentence the composer writes
that asserts a figure, a date or a business fact carries a fact id or a knowledge-base id, and the
guards check each one. The router never sees a tool; the specialists never see the customer.

**Ben's facts are not the customer's.** Some facts on the file are written for Ben and carry an
admin link or an internal note: the three notification facts (`ben_notified`, `ben_chased`,
`quote_accepted`). No guard reads a fact's meaning, so the composer boundary is the one place they
are kept out: `customerVisibleFacts` filters them from the prompt and from the ids the composer may
cite. Any new fact written for Ben's eyes goes on `INTERNAL_FACT_KEYS` on the day it is written.

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
| date, time, duration | any date, time, lead time or duration appears that is not a diary fact or the picker pointer | facts with a diary source |
| commitment and fault | a promise to do, fix or guarantee something, or an admission of fault, that is not a sourced fact | a fixed phrase list plus a cheap classifier, both fail closed |
| business claim | a statement about the business, its services, hours, coverage or policies, with no knowledge-base citation, or a citation whose row is not reviewed or whose body does not support the sentence | reviewed knowledge-base rows by id, verbatim |
| disclosure | any line describing the sender as automated or an assistant | a fixed phrase list |
| one reply | a second reply to the same party with no customer turn in between | the file's turns |
| ask ledger | the reply asks a subject already asked and unanswered, or thanks for something already thanked for | the file's ledger |
| regulated | the reply engages with gas or asbestos work as if we do it | the regulated matcher on the turn |

| Outcome | Then |
|---|---|
| pass | to the sender, with the fact ids attached to the send record |
| fail, first time | back to the composer once, with the failures named |
| fail, second time | hold for the approver with the draft and the failures. The customer still gets an acknowledgement that Ben will come back, written from a fixed line. |

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
| `choose_channel` | the channel the party wrote on; for a form or a call, which cannot carry a reply: WhatsApp if the number is on it, then SMS, then email | the party has no channel that can carry a reply |
| `window` | for WhatsApp, open or shut with the reason, from the party's channel record on the file | never guessed; a channel with no recorded window state is shut |
| `render` | WhatsApp: splits the one reply into bubbles at the breaks a person would use, sentence and thought boundaries, no bubble longer than about three hundred characters, a soft ceiling of four, typing gaps of one to three seconds scaled to length. A person's own words are rendered as typed instead: a blank line still starts a new bubble, nothing inside one is reflowed. SMS: one message, two segments at most. Email: greeting, body, sign-off, on the same thread | a split that cuts mid-sentence; a ceiling reached, which returns the reply to the composer to shorten rather than sending a wall |
| `pick_template` | when the window is shut: one approved template for the reply's purpose from the registry, branching on purpose never on name; freeform resumes when the customer replies | no approved template for that purpose: the reply is held as a pending draft for Ben and recorded. Never an SMS fallback. |
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
| `kb_lookup` | a question | reviewed knowledge-base rows by id, verbatim | read-only; may return nothing in Goal 1 |

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
| `notify_ben` | a notice (ready to price, chase, accepted) | recorded on the file as a fact cited to the quote; nothing is dispatched (dispatch to Ben's phone is a cutover item) | a second ready-to-price or accepted notice for the same quote (one notification); no quote on the file |
| `chase` | the case file, the clock | a numbered chase for Ben | the quote is not an unpriced draft; Ben not yet notified; not due (four hours after the notification, then daily); three chases already |
| `read_quote_line` | the quote and a line label | the amount to the penny and the citation (quote reference, label) the figure guard verifies | draft, revoked, superseded, expired; a label not on the quote |
| `read_quote_scope` | the quote | what each line covers, its assumptions, what is not included; no figure | revoked, superseded, expired |
| `live_figure_quotes` | the case file | which quotes a figure may be read from now, for the figure guard's own check of a cited line | the same rule as `read_quote_line`: a draft, revoked, superseded or expired quote is not in the answer |
| `record_quote_facts` | the case file, the quote | the quote onto the file once: status, link, every figure (each line, the total, the deposit; never half a line, which is a breakdown rather than a line and is printed in whole pounds on the quote page) when live for figures, scope when live for scope | nothing; a repeat returns the existing facts |
| `price_quote` | Ben's per-line prices, or the chain's suggestions | the priced record and the totals; the row stays a draft | not a draft; a line with no suggestion and no figure from Ben |
| `mark_quote_sent` | the case file, after the delivery landed | the quote leaves draft, its figures reach the file, the stage walks to quoted | no quote on the file; a row the store will not mark sent |
| `record_acceptance` | a witness | the row, the stage quoted to accepted, one push to Ben, the facts | any witness but a human; a draft; already accepted; no longer live |

**Which database the tools open.** Every live WRITER in the desk refuses unless the database in use
is the Neon branch `COMMS_V2_DATABASE_URL` names, in one place the quote store, the draft chain and
any future writer call (`server/comms-v2/live-database.ts`). The refusal names that requirement and
falls back to nothing. It exists because the sandbox door is mounted on the ordinary server for
Ben's board, and on the deployed server that is the production database: the quote machinery would
otherwise draft a real quote row and publish a quote page with real prices on it. Writing is the
whole subject, so the reviewed knowledge-base readers do not ask: a read publishes nothing, and
made to refuse they would throw on exactly the gas, complaint and money turns the fixed line exists
for. Ben's board reading its own approver row is a read too. Cutover replaces this with the desk
switch.

**Delivering the quote.** Ben prices on the price screen and presses send. The price route carries
no message body, so the delivery is written by the desk's own composer from the file, with the
quote link, and Contract 4 checks it like any other composed reply. The quote leaves draft only
once that send has landed: a shut window (no approved template carries a quote link, so wiring
`quote_ready_link` into the desk's sender is a cutover item), a guard failure or a refused send all
hold for Ben and leave the quote a draft he can price again, rather than recording figures as live
that the customer was never shown.

**What the specialist returns.** Facts: the quote's lines to the penny, scope, not included,
assumptions, link and status, each with source `quote_line` naming the quote and the label. A
brief: the quote is with Ben, or answer from these facts, or point at the quote page to accept, or
acknowledge a not-ready customer. Holds: money beyond a quote line, acceptance in chat, a quote no
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
Asked for under the title they share, no figure is read at all: which line is meant is not the desk's
to guess, so it goes to Ben. Answering it from the line's own
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

**What Ben's send releases.** The quote going out answers two holds: one the price route itself put
on the thread when an earlier attempt did not send, and a money hold, because 2.7's promise is that
Ben will come back to them on the price and this is him doing it. A complaint, refund, trust or
regulated hold is a person's to answer and stands, and so does an acceptance hold.

**A figure the quote has moved on from.** Facts are append-only, so a line whose amount changes -
Ben re-pricing or editing the quote - leaves the old `quote_line:<label>` fact beside the new one.
The newest for a label on a quote is that quote's current line and the only one the composer is
shown or the figure guard accepts (`isSupersededFigure`, desk/case-file.ts), so a price the quote no
longer carries can never be read back.

**A quote that is no longer live for figures.** Expired, revoked and superseded are one path on
purpose: no figure may be read from any of them, no fresh link is recorded, the reply says Ben will
come back to them on the quote, and the hold is what asks him, so the promise is one that is kept
(6.3). A money question on such a thread is beyond a line of the quote, because no line is live, so
the money fixed line and its hold stand.

Expired deliberately gets no softer treatment than revoked, though the quote page can refresh a
lapsed price itself: telling the customer to do that is its own item, to settle once Ben has used the
board and can say how many cards a two-day-old thread is worth. On superseded, answering from the
newer quote is the better answer and is its own item too.

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
