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
      |                    |                     |                     |                     |                     :
      v                    v                     v                     v                     v                     :
+--------------------------------------------------------------------------------------------------------------+   :
| [sw] Channel gateway                                            every channel -> one normalised turn         |   :
|  +----------------+  +----------------+  +----------------+  +----------------+  +----------------+  +------:--+ |
|  | WhatsApp       |  | SMS adapter    |  | Voice adapter  |  | Form adapter   |  | Email adapter  |  |[reserved]| |
|  | adapter        |  | no window,text |  | transcript,    |  | creates the    |  | no window,     |  | Portal   | |
|  | window,        |  |                |  | no send        |  | lead           |  | files          |  | adapter  | |
|  | templates      |  |                |  |                |  |                |  |                |  | taps in, | |
|  +----------------+  +----------------+  +----------------+  +----------------+  +----------------+  | notices  | |
+--------------------------------------------------------------------------------------------------|out+--------+ |
                                                                                                          |          |
      +--------------------------------------------------------------------------------------------------+         |
      |                                                                                                             |
      v                                                                                                             |
+------------------------+                                                                          +---------------------------+
| [sw] Sender             |                                                                          | [sw] Identity              |
| the only exit -         |                                                                          | phone or email -> a person |
| approver + run id       |                                                                          | and a role                 |
| reply-channel policy    |                                                                          | homeowner, tenant of a     |
| splits into bubbles as  |                                                                          | property, landlord         |
| a person would          |                                                                          | every channel -> one case  |
+-----------+--------------+                                                                          | file                       |
            ^                                                                                         +---------------------------+
            | cleared
            |
                                     +-------------------------+
                                     | [sw] Desk API            |
                                     | one entry per customer   |
                                     | turn                     |
                                     +------------+--------------+
                                                  |
                                                  v
   ================================== THE DESK - ONE PIPELINE, ONE EXIT ==================================
   :                                                                                                        :
   :   +----------------------+        every drafted reply        +------------------------+               :
   :   | [ag] Desk coordinator | ---------------------------------> | [guard] Guards &       |               :
   :   | routes: subject,      |                                    | approver               |               :
   :   | stage                 |                                    | no unlooked-up figure,  |               :
   :   | composes the one      |                                    | date, duration,         |               :
   :   | reply                 |                                    | commitment, fault, claim|               :
   :   +-----------+------------+                                   | approver slot: Ben, or  |               :
   :               |                                                | a landlord's rules      |               :
   :               |    +----------------------------+              +------------------------+               :
   :               +--->| [reserved] DIY-first        |                                                       :
   :               |    | specialist                  |                                                       :
   :               |    | one quick check before       |                                                       :
   :               |    | scoping - landlord service,  |                                                       :
   :               |    | later                        |                                                       :
   :               |    +----------------------------+                                                       :
   :               |                                                                                          :
   :               v                                                                                          :
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
  Guards -> [sw] Ben's desk: held: money, complaints, regulated, trust doubts, guard hits
  Desk coordinator area -> [ag] Evaluation suite: eval cases, prompt gate, sandbox dry runs
  Desk area -> [model] THIRD-PARTY MODELS:
      Text models: Fable 5.1 writes, Sonnet 5 reasons, Haiku 4.5 routes
      Vision model: photos, video
  Desk area -> [sw] Case file: one per customer, every channel
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
- `[reserved]` Reserved - for the landlord service, not built now

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
| WhatsApp | Text, photos, video, voice notes. Opens the 24-hour window. | Freeform inside the window as one reply, split into bubbles as a person would separate messages, with a soft ceiling and no fixed count. Outside it, an approved template only. | The window. A platform limit, not a policy. | Back on WhatsApp. |
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

Every decision the fresh design needed, in the captain's words where they are his. One question is
still open, where a reply goes when the customer's channel cannot carry it or the WhatsApp window
is shut; it does not block Goal 1, which is WhatsApp inside the window. The three landlord
questions are parked in their own section below.

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

**Where does the reply go?** - *Open - recommendation on the page*
Three channels can carry a reply and two cannot, so the sender needs a rule. Recommended default:
reply on the channel the customer wrote on. For the two that cannot reply, and for a shut WhatsApp
window, fall through in order: WhatsApp if the number is on it, then SMS, then email. The one call
worth making explicitly is whether a shut window should fall to SMS rather than to an approved
template, because SMS carries a freeform reply and a template does not.

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

**Remove the old desk, keep the channel plumbing, land beside then delete** - *Settled - 10 Sep*
"Completely remove existing comms and build new." The desk itself, the pipeline, the legacy
drafting agents, handover, post-call, the comms worker, is replaced from a blank file. The channel
plumbing stays, because it is not comms-specific: the Twilio webhooks, WhatsApp sending, template
sync, and the sender registry that gates every customer send, quotes and invoices included. Order:
build beside in the sandbox, cut over on the desk switch, keep the old desk as roll-back for the
first weeks, then delete. Knowledge carries over, code does not.

**First goal: skeleton plus Scoping, WhatsApp only** - *Settled - 10 Sep*
Gateway, identity, case file, router and composer, guards, sender with bubble rendering, and the
Scoping specialist with its tool server. Done when every Stage 1 and Stage 2 line of the checklist
passes in the sandbox. The build plan below is written to that stop condition.

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
| The portal channel | An adapter slot is reserved in the gateway. | Approvals and declines come in as turns; notifications go out on it for landlords who prefer the dashboard. |

Parked until the landlord service is built: whether the desk may book an emergency job on its own
within the landlord's rules, how hard it chases an unresponsive landlord, and whether letting
agents and proactive maintenance are in the first version.

## The build plan, written for a goal loop

A goal loop needs three things a human reader does not: the knowledge in the repo it can read,
contracts it can build against, and a stop condition it can check. That is the order below.

**Before the loop - Land the knowledge in the repo**
The thirty-two recorded answers, the seven-stage checklist, and this page's decisions go into the
project as docs. Today they live outside it, where a loop cannot read them.

**Before the loop - Write the contracts**
Identity, case file, router and composer, guards and the approver slot, sender and bubble rules,
and the Scoping tool server. Named calls with inputs and outputs, grounded in what the code can
answer today.

**Goal 1 - Skeleton plus Scoping, WhatsApp**
New directory, nothing under the old desk touched. Stop: every line below passes in the sandbox,
twice in a row.

**Goal 2 - The other four channels**
SMS, email, form and voice adapters against the same desk, and the remaining Stage 1 lines. Nothing
below the gateway changes.

**Goals 3 to 5 - Quoting, Scheduling, Service**
One specialist per goal, each with its stage of the checklist as the stop. Then ten real threads
read, and the switch on the word.

### Goal 1's stop condition, line by line

The WhatsApp lines of Stage 1 and all of Stage 2, from the checklist as it stands. Marked where the
redesign changes a line. A line either passes in the sandbox or it does not.

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
| 2.6 | A date question gets "dates come with your quote" and scoping continues. No lead-time guess. | Right for Goal 1, because Scheduling is not built yet. Goal 4 replaces it with the diary read. |
| 2.7 | Anything about money goes to Ben, not answered. | Right for Goal 1, because Quoting is not built yet. Goal 3 replaces it with the quote-line read. |
| 2.8 | It never sends a second *reply* without the customer writing in between. | **Reworded.** The old line said "two messages in a row", which the bubble rule now allows within one reply. The rule is one reply per customer turn, however many bubbles. |

Deferred to Goal 2 because they need a second channel: 1.2 the web form acknowledgement, 1.3 the
post-call template, 1.4 replying on SMS and moving them to WhatsApp, 1.5 not asking a caller
whether we may call.

---

A clean-sheet design in the reference's format. The settled decisions are the captain's recorded
answers; the open ones are what this shape forces and has not yet been asked. Nothing on this page
has been dispatched.
