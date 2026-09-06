# T6 — the comms sandbox, run for the first time

Branch `fm/sandbox-debug-t6`, start commit `1c2a394` (T5 merged). Companion: `T5-DONE.md`, whose
"How to verify this locally" section is the specification this brief tests against.

## Why this exists

T5 built `/admin/sandbox` without a database or a model key and said so: the page was never
opened, no pass was ever run. The owner has now started the app on his own machine at `1c2a394`
against the production database, with every customer loop off (`COMMS_WORKER != 1`). This task is
the first thing to exercise the page, under a strict fence (only the sandbox panel, never another
admin page, never a write to the database by hand, never a restart of his server), and to fix in
code what it finds.

## The session that paid for this brief (6–7 Sep 2026, local, dry run)

The owner had already typed one line before this task began:

```
23:51:18  IN   "Hi is this handy services?"
23:51:22  run  lane=rules  agent=rules  decision=none  cost=null
```

Then, from **Reset thread**, the T5 script exactly:

```
00:01:53  IN   "Hi, do you fit bathroom extractor fans? The old one has died."
          run  Case file: 1 timeline item, stage enquiry, no quote
               Triage (rules): lane rules, intent ack_enquiry   ("no outbound on the thread: first contact")
               Pack rules.first_contact v1 → agent rules
               Agent rules proposed nothing · Decision: none — no proposal
               exit: "DRY RUN … Live, this would have: nothing sent — no proposal"
          why  "triage model call failed: 400 … Your credit balance is too low to access the Anthropic API"
00:02:32  IN   "It's in the bathroom ceiling, about 100mm. Can you give me a rough idea?"
          run  identical: lane rules, ack_enquiry, none.  The Scoper never ran.
00:02:49  Seed quote £480 → stage quote_sent, pill "unpaid quote sbx615d9 · £480.00", synthetic bubble lands
00:03:38  IN   chip "Objects on price"     → lane post_quote → agent scoper → "proposed nothing" → none, £0.00, GREEN "Agent finished"
00:03:53  IN   chip "Quote too expensive"  → money_question → lane ben → flag  (rules; no agent)
00:04:14  IN   chip "Skirts a negotiation" → lane post_quote → agent scoper → "proposed nothing" → none, £0.00, GREEN
00:04:30  IN   chip "Demands a price"      → money_question → lane ben → flag
00:05:xx  IN   chip "Wants a call before paying" → callback_requested + money_question → lane ben → flag
```

Everything T5 promised of the plumbing held: the page loads behind the admin session, an
unauthenticated call is refused (401), the SSE feed connects and the stage lines stream in order,
Reset and Seed quote do what they say, every pass is stamped sandbox and dry run, the NOT SENT
frame leads the detail. No console error belongs to the page (the three 404s on load are
`/api/admin/leads/needs-review` and PostHog, pre-existing and unrelated).

## The three defects

### D1 — a clean thread can never reach the Scoper (severe; the owner's own path)

`triageRules` lanes any message on a thread with no outbound to `rules` as first contact, by
design: live, the rules layer (the first-contact ack) answers it, an outbound lands, and the next
message reaches the desk. The sandbox inserts inbounds directly and nothing ever writes that
outbound, so **every** line on a clean thread is "first contact" forever. The only way out is
**Seed quote**, whose "here's your quote" bubble is an outbound. T5-DONE step 5 (send the extractor
fan line, watch the Scoper's tools) cannot happen as written, and the owner's first experience was
exactly this: nothing proposed, twice.

Worse, the exit line reads *"Live, this would have: nothing sent — no proposal"*, which is true of
the spine's pass and false of what the customer would experience: live, they get the ack.

### D2 — a failed model belt is shown as the agent choosing silence (severe when the key fails)

The Scoper catches its own belt failure (`scoper.ts`, the `try` around `runAgent`), logs to the
server console and returns `null`. The spine sees a clean "no proposal", records decision `none`
with `error` empty, and the feed says `run_finished ok=true`. The page then paints a green
**Agent finished**, *Agent scoper proposed nothing* and *No proposal: the agent chose to say
nothing* — while the API had refused with a 400. T5-DONE names the red *Agent run failed* line and
an *Error* row as the fault indicator; neither can appear today because nothing carries the failure
up. Only the triage row's "why" list betrayed it, because triage happens to fold its own model
error into `reasons`.

### D3 — the Anthropic key the local server uses has no credit (environment, not code)

`400 invalid_request_error: Your credit balance is too low to access the Anthropic API`, on both the
Haiku triage call and the Sonnet Scoper belt. Until it is topped up (or the local `.env` points at
the key production uses) the sandbox cannot show a single Scoper reply, so the thing the owner
actually wants to judge — the move — is untestable here. This brief cannot fix it and must say so.

## What to build

**D1 — mirror the rules layer's answer, on the sandbox thread only.** After a sandbox pass whose
triage laned to `rules` on the first-contact pack (intent `ack_enquiry` / `ack_photos`) and decided
`none`, `POST /message` composes the ack the rules layer would have sent — `composeFirstContactAck`
from `server/first-contact-ack.ts`, called as a pure function, *the ack module itself untouched* —
and writes it as a **synthetic outbound** on the sandbox thread, sender-named so the page can label
it *rules layer ack · mirrored · never sent*. The response carries `mirrored` so the detail can say
plainly: first contact is answered by the rules layer, not the desk; the ack is now on the thread;
the next line reaches the Scoper. `wouldHaveHappened` learns the same truth for a rules-lane `none`
so the exit line stops saying "nothing sent". The pure predicate (`firstContactMirrorFor`) is
tested; the route stays parameterless.

**D2 — carry the belt's failure up without changing a single decision.** `SpineAgent.run` gains an
optional `reportFailure(message)` beside `reportUsage`/`onEvent`. The Scoper calls it from the
catch it already has (its structural post-conditions still run — a Ben exception is still a flag).
`runOnce` records it as the run's `error` (row column, `note` stage line, `run_finished ok=false`)
exactly as it does for an agent that throws. The proposal, guards and decision are untouched: a
belt failure with no flag is still `none`. The page's Error row and red panel then work as T5-DONE
describes. This touches two pipeline files for observability only; see "Fence".

**Page.** Label the mirrored bubble; explain a rules-lane pass instead of "the agent chose to say
nothing"; clear the previous pass's proposed bubble when a quote is seeded (it was landing under the
quote bubble, out of order).

## Fence (from the launch brief, restated because it is the condition of the work)

Browser: only `/admin/sandbox`, only the sandbox panel's own controls, no dialogs. Never restart
the owner's server. Never write to the database by hand. Do not touch the first-contact ack's
behaviour, customer prices, `app_settings`, or `db:push`. The fixes land in this worktree; the
running page is the owner's working copy at `1c2a394`, so **no fix in this branch can be seen
live here** — the DONE report says which claims rest on tests alone (all of them) and gives the
owner a re-check list.

## Not in scope, written up instead

Whether a belt failure should be a `none` decision at all (it currently counts as a clean pass in
the autonomy evidence); the three preset lines that lane to Ben by lexicon before any agent runs
(that is the pipeline's move and the sandbox shows it faithfully — but it means only two of five
chips ever exercise the Scoper); replaying a real thread (T5-b already).

## Gate

Zero new tsc errors vs `1c2a394` (8 GB heap), vitest failing set unchanged plus the new tests,
esbuild bundles `server/index.ts`. Measured, in `T6-DONE.md`.
