# Comms Desk Agent Map

Handy Services - comms desk - fresh design

The reference architecture, redrawn box for box for a handyman business that talks to customers
on five channels, as a clean-sheet design rather than a map of what exists.
**Blue is the plumbing you build whatever the product is. Green is the agentic work.** (Colour
does not survive into this document; every box below is labelled `[sw]` for blue/software-
engineering, `[ag]` for green/agentic-engineering, `[guard]` for the rails, `[model]` for
third-party models, or `[reserved]` for a ghost/dashed box - the landlord service, not built now.)
This page is for settling the shape before anyone writes code.

## The design

Same format as the reference: channels across the top, a gateway that makes them look alike, a
coordinator in the middle, specialists below it, a tool server under each specialist, and the
capabilities each server exposes at the bottom. Cross-cutting concerns sit to the sides.

```
[sw] WhatsApp        [sw] SMS             [sw] Calls           [sw] Web form        [sw] Email           [reserved] Portal
 two-way, media        two-way, text        transcript in         one-shot, no reply    two-way, threaded     landlord, later
      |                    |                     |                     |                     |               :
      v                    v                     v                     v                     v               :
+------------------------------------------------------------------------------------------------------------:--------+
| [sw] Channel gateway                                            every channel -> one normalised turn       :        |
|  +----------------+  +----------------+  +----------------+  +----------------+  +----------------+  +-----:-----+  |
|  | WhatsApp       |  | SMS adapter    |  | Voice adapter  |  | Form adapter   |  | Email adapter  |  | [reserved]|  |
|  | adapter        |  | no window,text |  | transcript,    |  | creates the    |  | no window,     |  | Portal    |  |
|  | window,        |  |                |  | no send        |  | lead           |  | files          |  | adapter   |  |
|  | templates      |  |                |  |                |  |                |  |                |  | taps in,  |  |
|  +----------------+  +----------------+  +----------------+  +----------------+  +----------------+  | notices   |  |
|                                                                                                      +-----------+  |
+---------------------------------------------------------------------------------------------------------------------+
            ^                                                       |                                                    |
            |                                                       |                                                    |
            |                                                       v                                                    v
+-----------+-------------+                             +-----------+------------+                    +------------------+---------+
| [sw] Sender             |                             | [sw] Desk API          |                    | [sw] Identity              |
| the only exit -         |                             | one entry per customer |                    | phone or email -> a person |
| approver + run id       |                             | turn                   |                    | and a role                 |
| reply-channel policy    |                             +-----------+------------+                    | homeowner, tenant of a     |
| splits into bubbles as  |                                         |                                 | property, landlord         |
| a person would          |                                         |                                 | every channel -> one case  |
+-----------+-------------+                                         |                                 | file                       |
            ^                                                       |                                 +----------------------------+
            |                                                       |
            | cleared                                               |
            |                                                       |
   =========|======= THE DESK - ONE PIPELINE, ONE EXIT =============|==========================================
   :        |                                                       v                                         :
   :   +----+--------------------+                      +------------------------+                            :
   :   | [guard] Guards &        |  every drafted reply | [ag] Desk coordinator  |                            :
   :   | approver                | <--------------------| routes: subject,       |                            :
   :   | no unlooked-up figure,  |                      | stage                  |                            :
   :   | date, duration,         |                      | composes the one       |                            :
   :   | commitment, fault, claim|                      | reply                  |                            :
   :   | approver slot: Ben, or  |                      +-----------+------------+                            :
   :   | a landlord's rules      |                                  |                                         :
   :   +-------------------------+                                  |                                         :
   :                                                                |                                         :
   :   +------------------------------+                             |                                         :
   :   | [reserved] DIY-first         |                             |                                         :
   :   | specialist                   |                             |                                         :
   :   | one quick check before       |<----------------------------+                                         :
   :   | scoping - landlord service,  |                             |                                         :
   :   | later                        |                             |                                         :
   :   +------------------------------+                             |                                         :
   :                                                                |                                         :
   :         +---------------+----------------+----------------+-----+                                        :
   :         v               v                v                v                                              :
   :   +------------+  +------------+  +--------------+  +------------+                                       :
   :   | [ag]       |  | [ag]       |  | [ag]         |  | [ag]       |                                       :
   :   | Scoping    |  | Quoting    |  | Scheduling   |  | Service    |                                       :
   :   | agent      |  | agent      |  | agent        |  | agent      |                                       :
   :   | what,where,|  | price, what|  | dates, lead  |  | business   |                                       :
   :   | access,    |  | is         |  | time         |  | facts,     |                                       :
   :   | photos,    |  | included,  |  | read-only on |  | aftercare, |                                       :
   :   | the call   |  | questions  |  | the diary    |  | changes,   |                                       :
   :   |            |  | on quote   |  |              |  | invoices   |                                       :
   :   +-----+------+  +-----+------+  +------+-------+  +-----+------+                                       :
   :         v               v                v                v                                              :
   :   +------------+  +------------+  +--------------+  +------------+                                       :
   :   | [ag]       |  | [ag]       |  | [ag]         |  | [ag]       |                                       :
   :   | Scoping    |  | Quoting    |  | Diary tools  |  | Service    |                                       :
   :   | tools      |  | tools      |  | MCP server   |  | tools      |                                       :
   :   | MCP server |  | MCP server |  |              |  | MCP server |                                       :
   :   +-----+------+  +-----+------+  +------+-------+  +-----+------+                                       :
   :         v               v                v                v                                              :
   : +-------------+  +-------------+  +---------------+ +-----------------+                                  :
   : |[cap] Describe|  |[cap] Read a |  |[cap] Typical  | |[cap] Knowledge  |                                  :
   : | photo/video  |  | quote line  |  | lead time     | | base answer     |                                  :
   : |[cap] Confirm |  |[cap] Price  |  |[cap] Confirm a| |[cap] Read their |                                  :
   : | location     |  | book lookup |  | booked date   | | record          |                                  :
   : |[cap] Ask     |  |[cap] Draft  |  |[cap] Send the | |[cap] Change of  |                                  :
   : | once, thank  |  | quote for   |  | picker link   | | details         |                                  :
   : | once         |  | Ben         |  |               | |                 |                                  :
   : +-------------+  +-------------+  +---------------+ +-----------------+                                  :
   :                                                                                                            :
   ==========================================================================================================

Right-hand side, fed from the desk:
  Desk coordinator row -> [sw] Ben's desk: held: money, complaints, regulated, trust doubts, guard hits
  Desk coordinator area -> [ag] Evaluation suite: eval cases, prompt gate, sandbox dry runs
  Desk area -> [model] THIRD-PARTY MODELS:
      Text models: Fable 5.1 writes, Sonnet 5 reasons, Haiku 4.5 routes
      Vision model: photos, video
  Desk area -> [sw] Case file: one per job, every channel, every party on it
      conversation history - inter-agent shared state
      the ask ledger - the hold

Left-hand side, fed from the desk:
  [sw]/[ag] Observability: Prompts, agent calls, tool calls (ag) | Worker heartbeat, queue, latency (sw)
  [ag] Cost tracker: per run, per model
```

A customer turn arrives on any channel and the gateway makes it look the same to the desk. The
coordinator picks one specialist (or two, for a turn that spans subjects), every drafted reply
clears the guards, and one sender chooses the channel and renders for it. The specialists never
know which channel they are on. Nothing else can reach a customer.

**Legend** (colour in the original page; carried here as labels since colour does not survive):
- `[sw]` Software engineering
- `[ag]` Agentic engineering
- `[guard]` Rails - comms-specific
- `[model]` Models
- `[cap]` Capabilities
- `[reserved]` Reserved - for the landlord service, not built now, marked "later"

## Box for box

How each slot in the reference became a comms box, and which ones were dropped because they carry
weight a handyman business does not.

| Reference | Here | Why |
|---|---|---|
| User Interface (chat) | `[sw]` Five channels | The customer never opens an app of ours. They write on WhatsApp, SMS or email, fill in the web form, or ring. Three are two-way, two are inbound only, and each has its own rules about what can go back out. |
| Edge Layer | `[sw]` Channel gateway, one adapter per channel | No public endpoint to firewall. The real edge work is turning five different inbound shapes into one normalised turn, so everything below this line is channel-blind. Each adapter owns its channel's rail: the WhatsApp window and templates, SMS segments, the call transcript, the form's lead creation, email threading. |
| Authentication | `[sw]` Identity | Nobody signs in to talk to a handyman. A phone number or an email address resolves to one customer. The web form is the join, because it is the only channel that gives both at once. |
| API | `[sw]` Desk API | Kept. One entry per customer turn, not one per inbound message, so a burst of three bubbles is one turn. |
| Authorisation | `[guard]` Guards & hold | The bank asks "may this user do this". This desk asks "may this reply go out". Same slot, harder question: no figure that was not looked up, no date, duration, commitment, admission of fault, or claim that cannot be evidenced. |
| Coordinator Agent | `[ag]` Desk coordinator | Kept. Reads the case file, classifies the turn by subject and stage, picks the lane, and raises the hold when a turn touches money, a complaint, regulated work or a trust doubt. |
| Accounts / Transaction / Service | `[ag]` Scoping, Quoting, Scheduling, Service | Four subjects rather than three, because those are the four things a customer actually writes about. Each gets its own tool server so a specialist cannot reach a tool that is not its business. |
| MCP Servers | `[ag]` Tool servers | Kept, one per specialist. The scheduling server is read-only by design: it confirms and estimates, it never books. |
| PII Redaction | dropped | The obligation is real but it is a written one: two data-protection files name every processor and must stay true when a flow changes. A redaction box in the reply path would strip the very details the desk needs to quote. |
| Self-hosted LLM | dropped | No regulator is asking. Third-party stays, with a text model and a vision model because photos and video are half of scoping. |
| Agent Evaluation Suite | `[ag]` Evaluation suite | Kept and made the gate: eval cases, the prompt gate, and sandbox dry runs. Done means every checklist line passes there. |
| Observability - Cost Tracker | `[ag]` Kept as drawn | Same split as the reference. The one addition on the software side is the worker heartbeat, because a dead worker is a silent desk and nobody notices silence. |
| Session Store | `[sw]` Case file | Kept, but one per customer rather than per thread, so a job that starts on the web form, continues on WhatsApp and ends with a call is one conversation. It also carries the two things a bank never needs: the ask ledger, so nothing is asked or thanked for twice across channels, and the hold, so a thread with Ben stays with Ben. |
| *(none)* | `[sw]` Sender - Ben's desk | Two boxes the reference has no slot for. One exit, so every send carries an approver and a run id, and one place for the reply-channel decision and the per-channel rendering. And Ben's desk, because quote acceptance stays human permanently and held threads need somewhere to go. |

## Five channels, one desk

What each channel can carry in, what the desk may put back out on it, and the rail that channel
imposes. The specialists never see any of this; the adapters and the sender own it.

| Channel | In | Out | The rail | Reply goes where |
|---|---|---|---|---|
| WhatsApp | Text, photos, video, voice notes. Opens the 24-hour window. | Freeform inside the window as one reply, split into bubbles as a person would separate messages, no fixed count. Outside it, an approved template only. | The window. A platform limit, not a policy. | Back on WhatsApp. |
| SMS | Text only. No media, no read receipts. | One message, kept short. No window to worry about, but every segment costs. | Length and cost. No way to send a photo back. | Back on SMS. If a known customer also has WhatsApp, prefer it. |
| Calls | A live transcript from the call, plus the outcome when Ben rings out. | Nothing on the call itself. The desk never speaks. After the call, one follow-up on a text channel. | A call does not open the WhatsApp window, so the follow-up is a template or an SMS. | WhatsApp template if they have it, else SMS. |
| Web form | Name, phone, email, the job, sometimes photos. Creates the lead. | Nothing on the form. It has no reply path of its own. | One-shot. The first reply has to open a real channel. | WhatsApp if the number is on it, else SMS, else email. |
| Email | Long-form text, attachments, quoted history. Slower cadence. | One composed message with a greeting and sign-off, not bubbles. Attachments allowed. | Threading. Replies must stay on the same thread. | Back on email. |

## Who handles what

Four specialists, each with its own subject and its own shelf of tools. None of them writes to a
customer. Each returns facts with their source to the coordinator's composer, which writes the one
reply in a human voice.

**Scoping** - *first contact -> ready*
- Subject: What the job is and where. Access, photos, whether a call would help. Opens every new thread, including after an outbound call, and asks the first scoping question.
- Tools it may read: describe photo / video - confirm location - ask ledger - knowledge base
- Returns / holds: Returns the next question to ask, what it has confirmed so far, and whether a call is worth offering. Holds on regulated work.

**Quoting** - *job + location known*
- Subject: Drafts the quote the moment the job and location are known, photos optional. After it is sent, answers what is included, what is excluded, and what happens on the day, from the quote itself.
- Tools it may read: read a quote line - price book - draft quote
- Returns / holds: Returns a figure only as one line of the live quote, to the penny, cited as that line. Holds on any money question beyond that, and on acceptance.

**Scheduling** - *dates and lead time*
- Subject: States typical lead time and confirms a date that is already booked. Never offers a slot and never books one. Booking stays on the quote's picker.
- Tools it may read: typical lead time - confirm booked date - picker link
- Returns / holds: Returns typical lead time and a booked date, read from the diary. Holds on any date change to a booked job.

**Service** - *facts and aftercare*
- Subject: Factual questions about the business, changes of details, invoice and receipt queries, post-job follow-up. Answers only from a reviewed knowledge-base row or the customer's own record.
- Tools it may read: knowledge base - customer record - change of details
- Returns / holds: Returns cited facts only, each with its knowledge-base row or record. Holds on complaints, refunds and trust doubts: one fixed line in Ben's words, then Ben.

## Settle these before building

Every decision the fresh design needed, in the captain's words where they are his. Nothing here is
open. The three landlord questions are parked in their own section above.

**Send by default, hold on exceptions** - *Settled*
"Send everything; hold on exceptions." Every reply type sends on its own. Money, complaints,
regulated work, trust doubts and guard hits stop for Ben. If a customer writes, they hear
something back: "almost never silent, always acknowledge."

**What an agent may claim** - *Settled*
Sources are "the quotes, thread, knowledge base, CRM" and nothing else. A price appears in chat
only as a line copied from the live quote to the penny. A business fact appears only as a reviewed
knowledge-base entry Ben wrote. The design makes this structural: the Service agent has no tool
that lets it compose from its own understanding.

**Dates are read, never booked** - *Settled*
"Diary for facts, picker for booking." The scheduling tool server is read-only. Quote acceptance
and editing stay human, permanently.

**No bot disclosure line - what done means** - *Settled*
No disclosure line in chat; the privacy notice carries it. Done is every checklist line passing in
the sandbox *and* ten real threads read personally, then a flip on the word.

**The desk never speaks on a call** - *Settled*
Calls are an inbound channel only: the transcript becomes a turn in the case file. Ben makes the
outbound calls. The follow-up after his call "sends unattended" on a text channel, which needs a
template because a call does not open the WhatsApp window.

**Where does the reply go?** - *Settled - 10 Sep*
Reply on the channel the customer wrote on. For a call or a web form, which cannot carry a reply,
open a real channel: WhatsApp if the number is on it, then SMS, then email. When the WhatsApp
window is shut, an approved template, "as decided before": the desk picks one of the common-case
templates and freeform resumes when the customer replies. The current sender's silent fallback to
SMS with freeform text goes.

**One case file per job, never per channel, with every party on it** - *Settled - 10 Sep*
"Agreed" on one file across channels, and "one per issue, two parties" for the landlord service.
Together: the unit is the job. A homeowner's job that starts on the form, continues on WhatsApp
and ends with a call is one file with one party. A tenant issue is one file with two, the tenant
who reports and the landlord who approves. The ask ledger and the hold work across the whole file
either way. The price is that identity has to be right before the desk replies.

**The landlord service attaches; it is not a standalone product** - *Settled - 10 Sep*
Triage, try to solve, scope, quote, present, accept, book is this desk's flow with one step added
at the front and one substitution in the middle. Nothing landlord-specific is built now. The
plumbing carries six seams so it can attach later without a rebuild; they are listed in the section
below. One assumption: the approver slot allows a rule to approve money without a human, because
the landing page promises it. Whether that is ever switched on is decided when the service is
built.

**The coordinator composes; specialists return facts** - *Settled - 10 Sep*
"The desk coordinator should use the text model to give a conversational answer." Two jobs: route
the turn by subject, stage and exception, then write the one human reply from what the specialists
return. Specialists return facts with their source, never prose. That is how "how much, and when
can you come?" gets one natural answer: two specialists contribute, one voice writes. It also
settles the send path, because only the composer ever writes to a customer and every draft goes
coordinator, guards, sender. Specialists hold no send tool.

**Bubbles as a person would send them, not a fixed count** - *Settled - 10 Sep - replaces the
three-bubble rule*
"As human-like as possible, not long paragraphs, broken into bubbles that read as a human would
separate messages." The composer writes one reply. The sender splits it per channel: on WhatsApp
at the natural breaks a person would use, with short typing gaps and a soft ceiling so it never
becomes a wall of bubbles; on SMS one message; on email a letter. The number three goes.

**Fable 5.1 writes, Sonnet 5 reasons, Haiku 4.5 routes** - *Settled - 10 Sep*
The one call that writes to a customer runs on the strongest text model. Specialists only reason
over tools and return facts. Routing runs cheap at low effort. Guards run no model at all. Roughly
one Fable 5.1 call per turn rather than several. Cost per thread is measured from day one and a
role moves down only when quality holds. Fable 5.1 requires thirty-day data retention, so the
privacy notice must say so, and its safety classifiers can decline a request, so the composer needs
a fallback route rather than a silent empty reply.

**Delete the old comms entirely; fix nothing in it; build new** - *Settled - 10 Sep*
"We are not fixing anything that is here and existing. We are deleting the complete old comms and
building new to the new framework." Everything that talks to a customer is new: the gateway and
its adapters, identity, the case file, the desk, the guards, the sender. No defect in the old
comms is fixed; where a defect named a real requirement, that requirement lives in the new
contract instead. What survives is only what is not comms: the quote engine, the price book, Ben's
price screen, invoicing, and the send path those already use, which is re-pointed at the new
sender at cutover. Order: build beside in the sandbox, cut over on the switch, keep the old desk
as roll-back for the first weeks, then delete it. Knowledge carries over, code does not.

**Connect the old inputs to the new plumbing; flip on the switch** - *Settled - 10 Sep*
"Completely build comms again, make the old one obsolete, and connect the old input to the new
plumbing." The addresses already registered with Twilio, Meta and the web form do not change;
their handlers become thin forwards into the new gateway. The desk switch decides which desk a
turn reaches: the sandbox first, the flip on your word, the old desk obsolete from that moment,
then deleted. Nothing is re-registered with a provider.

**Ben's desk is a kanban board** - *Settled - 10 Sep*
"Front end kanban style UI is fine for now." One column per stage of the case file, held items
surfaced at the top, one tap to release or answer. It doubles as the window onto the sandbox while
the desk is being built, which is why it comes early in the plan. Not polished, just visible and
operable.

**First goal: skeleton plus Scoping, WhatsApp only** - *Settled - 10 Sep*
Gateway, identity, case file, router and composer, guards, sender with bubble rendering, and the
Scoping specialist with its tool server. Done when every Stage 1 and Stage 2 line of the checklist
passes in the sandbox. The build plan below is written to that stop condition.

## One quote, box by box

A customer writes "Hi, can I get a quote for a leaking tap?" on WhatsApp. This is what every box
on the map does, turn by turn, under the decisions above. Nothing here is a new rule; it is the
rules already settled, run end to end.

| Turn | What happens, box by box | The customer sees |
|---|---|---|
| 1 - first contact | **Gateway** normalises the WhatsApp turn; the window is open. **Identity** resolves the number: new customer, homeowner. **Case file** opens one job, stage first contact. **Router** (Haiku) reads the turn: subject is scoping, not quoting, because a quote needs the job and the location and only the job is known. **Scoping** (Sonnet) reads its tools: ask ledger empty, nothing to describe. Returns: job is a leaking tap; next question is where; a call is worth offering; a photo would help, ask once. **Composer** (Fable) writes one reply. **Guards**: no figure, no date, no commitment. Pass. **Sender** splits it into bubbles. | Three bubbles: the tap acknowledged in its own words, where are you, and would a quick call help or a photo if easy. |
| 2 - scoping | Customer sends a postcode and a photo. **Scoping**: *describe photo* via the vision model returns "kitchen mixer tap, dripping at the base"; *confirm location* resolves the postcode; the *ask ledger* records photo received, so it is thanked once and never asked for again. Job and location are now known, which is the captain's test for ready: "the job and the location, photos optional." Scoping returns ready-to-quote as a fact. **Router** moves the stage to ready and routes to **Quoting**. Quoting's tools: *price book lookup* matches the job to catalogue lines, allowed here because this feeds Ben's screen and not the chat; *draft quote* writes a priced draft onto Ben's price screen. Returns: draft created, with Ben. **Composer** writes the reply. **Guards**: no figure may appear, because no live quote exists yet; no date. Pass. **Ben's desk** now holds the draft. | Thanks for the photo, that is everything needed, Ben will have your quote over shortly. No price, no date. |
| Ben | Ben reviews the draft on his price screen, adjusts what he likes, and sends the quote. Quote acceptance and editing stay human, permanently. The **case file** now carries a live quote with lines and figures. | The quote link, with the booking picker on it. |
| 3 - after the quote | Customer asks "what does that include, and how much is the labour?" **Router**: subject is quoting, stage post-quote. **Quoting**: *read a quote line* returns the labour line in pence with its label. Returns two facts with their sources. **Composer** voices them. **Guards** verify the figure equals one line of the live quote to the penny, cited as that line, and that nothing else numeric appears. Pass. | What is included, read back from the quote, and the labour figure exactly as it appears on it. |
| 3 - two subjects | Customer asks "and when could you come?" in the same turn. **Router** sees two subjects. **Scheduling** (once built, Goal 5): *typical lead time* from the diary, and a pointer to the picker; it never offers a slot. Until Goal 5 exists the answer is "dates come with your quote", which the checklist still expects. **Composer** writes one reply from both specialists. | One reply, two bubbles: the quote answer, then lead time and the picker link. |
| Exceptions | "Can you do it for less?" is a money question beyond a quote line: the **approver slot** holds it for Ben and the composer says Ben will come back on that. A complaint, a refund, a trust doubt or gas: one fixed line in Ben's words, then Ben only. "I'll get back to you next month": one acknowledgement, then nothing, "no chasing." The desk pursues within a conversation, one question at a time, never across silence. | Ben will come back to you on that. Or: no problem, whenever you are ready. |

The quote engine, the price book and Ben's price screen are not comms and are not deleted. The
new Quoting tool server wraps them. Everything that talks to the customer is new.

## Contracts

What a goal loop builds against, in full, is `contracts.md`; this page names each contract and
points there so the calls, refusals and invariants live in one place.

- **Contract 1 - Identity.** Turns an address on a channel into a person with a role, before the
  desk replies. See `contracts.md`.
- **Contract 2 - Case file.** The job's folder: one per job, never per channel, with every party
  on it. See `contracts.md`.
- **Contract 3 - Router and composer.** The coordinator's two jobs: the router decides who works,
  the composer is the only thing that ever writes to a customer. See `contracts.md`.
- **Contract 4 - Guards and the approver slot.** Deterministic code, no model, that every composed
  reply passes before the sender. See `contracts.md`.
- **Contract 5 - Sender and bubble rules.** The only exit: chooses the channel per party, renders
  for it, respects the window, records the send. See `contracts.md`.
- **Contract 6 - The Scoping tool server.** The first specialist's shelf, read-only against the
  world, writing only through its calls. See `contracts.md`.
- **Validation.** Each goal is validated by the pipeline's end-to-end test step against the
  desk's sandbox door, with recorded evidence in the PR; the goal's checklist lines are the
  scenarios; the captain reviews sandbox threads before any flip. See `contracts.md`.

## Where the landlord service attaches

The vision: a landlord onboards, adds properties and tenants. A tenant with a problem messages the
one number. The desk triages, tries to solve it, scopes, quotes, presents to the landlord, takes
the approval, books. Six seams in the plumbing make that an extension rather than a rebuild. None
of the landlord-side boxes are built now.

| Seam | Built now as | What attaches later |
|---|---|---|
| Identity | A phone or email resolves to a person *and a role*: homeowner, tenant of a property, landlord. | Tenant and property registration from the landlord portal. An unregistered number claiming to be a tenant is a trust question, not a new customer. |
| Case file parties | One file per job with one or more parties on it. A homeowner job has one. | A tenant issue has two. The desk talks to each on their own channel; there is one record of what happened. |
| The approver slot | The hold routes to an approver. For a homeowner that is Ben. The guards themselves do not change. | For a tenant issue: the landlord's rules first (auto-approve under a limit, always ask above one, emergency categories through, cosmetic always waits), then the landlord with one tap, then Ben. The single most important seam. |
| Open lanes | The coordinator routes by subject to whichever specialists exist. | The DIY-first specialist: one quick check before scoping, with the troubleshooting flows as its tool server and deflection counted as the saving. One more box, no change to the coordinator. |
| Reply channel per party | The sender chooses the channel per person on the file, not per file. | A tenant on WhatsApp, a landlord on WhatsApp, email or the portal, in the same job. |
| Desk-initiated turns | The sender has an *initiate* entry next to *reply*, unused. The homeowner desk never starts a thread. | Chasing a landlord for approval, and proactive maintenance reminders to tenants. Both open a shut window, so both are template sends. |
| The portal channel | An adapter slot is reserved in the gateway ("later"). | Approvals and declines come in as turns; notifications go out on it for landlords who prefer the dashboard. |

Parked until the landlord service is built: whether the desk may book an emergency job on its own
within the landlord's rules, how hard it chases an unresponsive landlord, and whether letting
agents and proactive maintenance are in the first version.

## What the code can answer today

A scout inventoried the eleven capabilities the design names against the current code, so the
contracts are grounded rather than invented. Three exist, six are partial, two are missing. The
full report cites a file and line for every claim.

| Capability | Today | What a v2 contract must add |
|---|---|---|
| Read a quote line | *partial* - Quote loader and per-line totals exist; the case file keeps only the total | A reader keyed by quote and line label, because older quotes have no stable line id. A refusal set: draft, revoked, superseded, expired. A citation format the guard can verify to the penny. Today the guard is presence-only and three belts forbid any figure; your answer on quote figures reverses that, so all three change together. |
| Price book lookup | *partial* - Three SKU matchers exist; the desk calls none of them | A decision first: the catalog is not one of your four sources. See the call below. |
| Draft quote for Ben | *exists* - The clerk chain and the price screen | The re-run defect is confirmed at the line: a re-asserted ready tag is treated as already seen. Filed as its own fix. The chain is not callable outside a pass. |
| Diary read | *partial / missing* - One authoritative booked date, read only by the contractor side. No lead time anywhere | A read that is allowed to return nothing. Five quote-side date columns are preferences, not bookings, and nothing reconciles them. Lead time is a new computation over completed bookings, which you already ordered before the flip. |
| Knowledge base answer | *partial* - Table, reviewed-only helpers, Ben's page; wired into nothing | A selection by question, a verbatim-body guard, and editing the test that deliberately forbids any reply path from importing it. |
| Describe photo / video | *exists, unproven* - Gemini, structured output, health check | Persist descriptions where a tool can read them by message; today the Scoper sees 160 characters. Photos arriving on the Meta path are never downloaded, so they cannot be described at all. Filed as its own fix. No live success on record. |
| Ask ledger | *exists* - Four subjects, stored on the case file | It does not hear calls: after Ben asks for photos on a call, the desk may ask again. Record asks as structured events at send time so the ledger spans the whole job, as you decided. |
| Sender, approver, templates | *partial* - One send function, a registry, approver and run id, five template definitions | The sender performs no window check and, when the window is shut, falls back to SMS carrying freeform text. The window decision moves inside the sender. Three of five templates are unwired and none has a recorded approval status. See the call below. |
| Identity | *partial* - Phone to customer, contractor or staff; UK phone canonicalisation | No tenant or landlord role, no email as an identity key outside one file, and the web form writes a client but not a conversation. The seam the landlord service needs is confirmed missing. |
| Sandbox and evaluation | *exists* - Doors, fixtures, a prompt gate, a scoreboard | Nothing structured to check a send by: dry runs produce a sentence, fixtures are single-turn, the window is hard-coded open. The new desk's door emits a planned send per turn and can shut the window; the pipeline's test step drives it. See the call below. |
| Channel adapters | *exists / missing* - Twilio and Meta WhatsApp webhooks, voice, web form | No email inbound at all. Five inbound writers with no shared envelope and no canonicalisation on the way in. Which WhatsApp webhook is live cannot be proven from the repo. |

**Three calls came out of this, all answered on 10 Sep.** A judge was to be built before Goal 1:
"yes, build the judge first"; withdrawn on 11 Sep ("remove the judge, push parallelism, we will
use lavish when needed"), because it duplicated the pipeline's own end-to-end test step, so that
step now validates each goal (see the build plan). A shut window falls to an approved template,
"as decided before", and the current sender's silent fallback to SMS goes. The price catalog is
never a source for a figure in chat: "the four sources stand."

## The build plan, written for a goal loop

A goal loop needs three things a human reader does not: the knowledge in the repo it can read,
contracts it can build against, and a stop condition it can check. That is the order below. Every
stop condition is checked the same way: the pipeline's end-to-end test step passes the goal's
checklist lines against the desk's sandbox door, with recorded evidence in the PR, and the
captain reviews the sandbox threads before any flip.

**Before the loop - Land the knowledge in the repo**
The recorded answers, the seven-stage checklist, and this page's decisions go into
the project as docs. Today they live outside it, where a loop cannot read them.

**Before the loop - Write the contracts**
Identity, case file, router and composer, guards and the approver slot, sender and bubble rules,
and the Scoping tool server. Named calls with inputs and outputs, grounded in the inventory
above, in `contracts.md`, with how a goal is validated.

**Goal 1 - Skeleton plus Scoping, WhatsApp**
New directory, nothing under the old desk touched. Stop: the pipeline's test step passes every
line below, with evidence.

**Goal 2 - Ben's desk, kanban**
A board over case files, one column per stage, holds on top, one tap to release or answer. Stop:
the pipeline's test step passes the goal's checklist lines with evidence: every sandbox thread
from Goal 1 is visible and a held draft can be released from the board.

**Goal 3 - The other four channels**
SMS, email, form and voice adapters against the same desk, the old handlers forwarding into the
new gateway, and the remaining Stage 1 lines. Nothing below the gateway changes. Stop: the
pipeline's test step passes the remaining Stage 1 lines with evidence, through each new door.

**Goals 4 to 6 - Quoting, Scheduling, Service**
One specialist per goal. Stop for each: the pipeline's test step passes that specialist's stage
of the checklist with evidence. Then ten real threads read, the switch on the word, and the old
desk deleted.

**Goals with independent files run in parallel.** A goal is dispatched as soon as the files it
touches are free, not when the goal before it is done: Goal 2's board and Goal 3's adapters share
nothing with each other, and the three specialists of Goals 4 to 6 each own their tool server, so
they run side by side against the same desk. Only a goal that edits a file another goal is
editing waits. Each lands as its own PR with its own evidence.

### Goal 1's stop condition, line by line

The WhatsApp lines of Stage 1 and all of Stage 2, from the checklist as it stands. Marked where the
redesign changes a line. A line either passes in the sandbox or it does not; these lines are the
scenarios the pipeline's test step exercises for Goal 1.

| # | Expected | Note for the redesign |
|---|---|---|
| 1.1 | The customer's first WhatsApp message gets one acknowledgement that quotes their enquiry back and offers a call, freeform. | The composer writes it; the sender splits it. |
| 1.6 | A customer who has said text-only is never asked for a call again. | A fact on the case file the router reads. |
| 1.7 | Photos arriving with the first message are acknowledged as photos, not as a bare enquiry. | Scoping's describe capability, called before the composer writes. |
| 2.1 | It replies to every customer turn, whether or not the reply is a question. | Unchanged. |
| 2.2 | It asks for a photo once. If they reply without sending one, it proceeds. | The ask ledger. |
| 2.3 | It asks about the job one thing at a time, in its own words. | Scoping returns the next question; the composer voices it. |
| 2.4 | A short pause ("one sec") does not stop it. | Unchanged. |
| 2.5 | A real promise ("I'll send photos tomorrow") gets one acknowledgement, then quiet until they write. | Reworded to the later answer: one acknowledgement, then quiet. |
| 2.6 | A date question gets "dates come with your quote" and scoping continues. No lead-time guess. | Right for Goal 1, because Scheduling is not built yet. Goal 5 replaces it with the diary read. |
| 2.7 | Anything about money goes to Ben, not answered. | Right for Goal 1, because Quoting is not built yet. Goal 4 replaces it with the quote-line read. |
| 2.8 | It never sends a second *reply* without the customer writing in between. | **Reworded.** The old line said "two messages in a row", which the bubble rule now allows within one reply. The rule is one reply per customer turn, however many bubbles. |

Deferred to Goal 3 because they need a second channel: 1.2 the web form acknowledgement, 1.3 the
post-call template, 1.4 replying on SMS and moving them to WhatsApp, 1.5 not asking a caller
whether we may call.

### Goal 3's stop condition, line by line

The remaining Stage 1 lines and all of Stage 3, each through its own door on the desk's sandbox
(server/comms-v2/README.md, "Driving the door"). Built under `server/comms-v2/channels/`.

| # | Expected | How it is met |
|---|---|---|
| 1.2 | The web form acknowledgement carries the enquiry's context. | The form door. The number on WhatsApp: the approved web form template quoting the enquiry, the one without the call offer when they have already rung us (1.5). Not on it: the composer's freeform reply on SMS, then email. |
| 1.3 | The post-call template opens WhatsApp with the name and context from the call. | The call door, outcome `ben_rang`. The post-call template with `{{1}}` the name and `{{2}}` the job phrase the reader took from the transcript. No approved post-call template on the account holds the follow-up for Ben with its words as the draft, never an SMS fallback (answer 34). Off WhatsApp the same words go on SMS. |
| 1.4 | Inbound SMS gets a reply on SMS that tries to move them to WhatsApp. | The SMS door. One message of at most two segments, carrying the fixed `move_to_whatsapp` line once. |
| 1.5 | A customer who already rang is not asked whether we may call. | The call door, outcome `missed` or `answered_inbound`, marks the party as having rung; `offer_call` refuses from then on, and the web form acknowledgement, which is a template rather than a composed reply, reads the same `offer_call` and takes the row with the offer taken out (`webform_first_contact_no_call`). Until Meta approves that row the acknowledgement holds for Ben with its words as the draft, never the asking one instead. |
| 3.1 | The call offer never blocks; they can carry on by message. | Unchanged from Goal 1 on every channel: the offer is a sentence, never a gate. |
| 3.2 | After Ben's outbound call the thread continues and collects what he asked for. | The reader records what Ben asked for and puts it on the ask ledger after the follow-up; the next turn's photos are thanked once and scoping continues from the file. |
| 3.3 | The assistant sees enough of the call to know what Ben asked for. | The transcript is a turn on the file and `ben_asked_for` a fact with that turn as its source; the follow-up names the job. |
| 3.4 | An earlier "yes please call me" does not send the thread back to Ben after the call. | A callback is not an exception the desk holds on; the call turn settles the `handoff` ask and raises no hold. |
| 3.5 | A missed call gets one text back; an answered inbound call gets no acknowledgement. | The call door: `missed` sends the missed-call template (or its words on SMS) once per thread, the acknowledgement written to the ask ledger so a customer who rings three times still hears back once; `answered_inbound` reads the transcript for facts and sends nothing. |

The old inputs forward into the new gateway behind `COMMS_V2_INTAKE` (off by default; the old
handler still runs); inbound email is new, a webhook under the new code; see the README.

---

A clean-sheet design in the reference's format. The settled decisions are the captain's recorded
answers; the open ones are what this shape forces and has not yet been asked. Nothing on this page
has been dispatched.
