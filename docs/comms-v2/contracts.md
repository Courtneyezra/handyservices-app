# The comms desk contracts

The six contracts for the clean-sheet comms desk rebuild: a record shape, its named calls, what
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

## Contract 4 - Guards and the approver slot

Deterministic code, no model. Every composed reply passes here before the sender. The approver
slot is one function so the landlord service can attach without touching the guards.

**A composed reply only.** The guards exist to stop the composer inventing a figure, a date, a
commitment or a claim about the business. Words a person typed on Ben's board are not composed:
they go straight to the sender. The `human:<person>` approver on the send, the signed-in person's own
email or user id as server/approver.ts defines it, which no automated path
can produce, is the record that a person wrote them; guard results are not persisted on any send,
so nothing reads as a pass no guard gave (behaviour.md answer 43, `desk/human-reply.ts`).
What still holds for those words is everything the sender owns: the window rule, an approver and a
run id on every send, the party being on the file, and one run id sending once. Their line breaks
inside a bubble are his own too: `render` reflows the composer's prose, never a person's words.

**Only the slot the file answers to may answer it.** A person's reply is authorised against the
file, not against the row alone: the approver its hold names while one stands, else the slot
`approverFor` returns for it. A session holding some other slot is refused, on an unheld file as
much as a held one, so a slot minted for a landlord's thread can never reply on a homeowner's.

| Guard | Fails when | Checked against |
|---|---|---|
| figure | any amount of money appears that is not equal, to the penny, to one line of the live quote or a value on the customer's own record, cited as that line | the fact ids the composer supplied, resolved on the file |
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
| `render` | WhatsApp: splits the one reply into bubbles at the breaks a person would use, sentence and thought boundaries, no bubble longer than about three hundred characters, a soft ceiling of four, typing gaps of one to three seconds scaled to length. SMS: one message, two segments at most. Email: greeting, body, sign-off, on the same thread | a split that cuts mid-sentence; a ceiling reached, which returns the reply to the composer to shorten rather than sending a wall |
| `pick_template` | when the window is shut: one approved template for the reply's purpose from the registry, branching on purpose never on name; freeform resumes when the customer replies | no approved template for that purpose: the reply is held as a pending draft for Ben and recorded. Never an SMS fallback. |
| `send` | delivers the rendered reply with an approver and a run id, then records the send on the file with the facts it was written from | no approver or run id; guards not passed; window shut and no template; the party not on the file; a run id already sent |
| `initiate` | a desk-started send, template only, for chasing an approver or a maintenance reminder | unused in Goal 1. Exists so the landlord service can attach without a new exit. |

**Invariants.** One run id sends once. Every send on a file has an approver. Nothing reaches a
customer that did not pass the guards. A shut window never produces freeform text on any channel.

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
