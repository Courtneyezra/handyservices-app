# T6 — the comms sandbox, run for the first time: DONE report

Brief: `BRIEF-T6-sandbox-debug.md`. Branch `fm/sandbox-debug-t6`, start commit `1c2a394` (T5 merged).

**The page was exercised live** on the owner's own server (`localhost:5001`, his working copy at
`1c2a394`, production database, every customer loop off) through an isolated browser holding a
short-lived admin session, inside the fence the launch brief set: only `/admin/sandbox`, only the
sandbox panel's own controls, no dialogs, no restart, nothing written to the database by hand.
**The fixes below were NOT seen live.** The running server is the owner's copy, not this branch, so
every fix rests on tests alone (all of them fail against the start commit's sources and pass with
the change). The re-check list at the end is what to click after pulling.

---

## Read this first: what you will see after pulling, and why

1. **Your first message on a clean thread will now get the rules layer's greeting** as a bubble
   labelled *rules layer ack · mirrored · never sent*, and the detail will say *First contact — the
   rules layer answers, not the desk*. Before this fix your first line, and your second, and every
   line until you pressed Seed quote, went to the rules lane and the desk never ran. That is what
   happened to "Hi is this handy services?" at 23:51 on 6 Sep (`rules → none`), and it is not a
   fault in the desk: it is how first contact works live, minus the ack the sandbox had no way to
   write. **Your second message is the one the Scoper answers.**
2. **The Scoper cannot reply until the Anthropic key has credit.** Every model call on your machine
   returned `400 … Your credit balance is too low to access the Anthropic API`. Until that is fixed
   the sandbox will show, honestly now, *Agent run failed* in red with the 400 in the Error row —
   before this fix it showed a green *Agent finished* and *the agent chose to say nothing*. Check
   whether the key in your local `.env` is the one production uses; if it is, the live desk is
   failing the same way right now and only the rules layer is answering customers.
3. **Three of the five chips flag to Ben by rule before any agent runs** (*Quote too expensive*,
   *Demands a price*, *Wants a call before paying* — the money / callback lexicon). The sandbox
   shows that faithfully; it is the pipeline's move. Only *Objects on price* and *Skirts a
   negotiation* reach the Scoper. Written up as BACKLOG T6-b.

## Re-check list (copy and paste, after `git pull` and `npm run dev`)

Open http://localhost:5001/admin/sandbox and press **Reset thread**.

| Step | Do | You should now see |
|---|---|---|
| 1 | Type `Hi, do you fit bathroom extractor fans? The old one has died.` and press Enter | Your line appears at once on the left, then *the desk is thinking…*. The live panel streams `Case file`, `Triage (rules): lane rules, intent ack_enquiry`, `Pack rules.first_contact`, ends with **DRY RUN … nothing from this pass — no proposal. First contact is the rules layer's (the first-contact ack) …**. A green-labelled bubble *rules layer ack · mirrored · never sent* lands on the right of the chat with the greeting. Under the decision, a blue box: *First contact — the rules layer answers, not the desk*. |
| 2 | Type `It's in the bathroom ceiling, about 100mm. Can you give me a rough idea?` | Triage should say `lane scoper` (not `rules`) and `Pack customer.default → agent scoper`. **With credit on the key:** the Scoper's tools stream (*Reading thread*, *Propose reply*…), then a dashed amber *proposed reply · NOT SENT · dry run* bubble. **Without credit:** a red *Agent run failed*, a red note line quoting the 400, and *No proposal: the agent failed.* with the same text in the detail — never a green finish. |
| 3 | Press **Seed quote** | Pill *unpaid quote … · £480.00*; the *Here's your quote* bubble; the previous pass's proposed bubble is cleared (it no longer sits under the quote). |
| 4 | Click **Objects on price**, then **Send as customer** | `lane post_quote → agent scoper`. Same outcome as step 2 depending on credit. |
| 5 | Click **Quote too expensive**, send | `lane ben`, `exceptions money_question`, **Decision: flag (money_question)**, exit line *flagged for Ben … nothing to the customer*. No agent runs. This is correct. |

If step 2 still says `lane rules`, the mirror did not land: check the server log for
`[Sandbox] message failed` and press Reset thread.

---

## What was found, in the order it was found

Full transcript of the session is in the brief. Screenshots in `t6-evidence/`.

| # | Finding | Severity | Where | Status |
|---|---|---|---|---|
| D1 | A clean thread never leaves the rules lane: no outbound ever lands, so every line is "first contact" and the Scoper is unreachable without Seed quote. The exit line said *nothing sent — no proposal*, which is false of what the customer gets live (the ack). | Severe — blocks the owner's own path and misrepresents | sandbox route + `wouldHaveHappened` | **Fixed** (mirror the ack; honest exit line) |
| D2 | The Scoper swallows its belt failure and returns null; the spine records a clean `none`, the feed says ok, the page paints green *Agent finished* and *the agent chose to say nothing*. Only triage's "why" list betrayed the 400. | Severe when the key fails — misrepresents; the T5-DONE fault indicator (red line + Error row) could never appear | `scoper.ts` catch, `index.ts`, `types.ts` | **Fixed** (`reportFailure`; observability only, no decision changes) |
| D3 | The Anthropic key the local server uses has no credit: `400 invalid_request_error … credit balance is too low` on Haiku triage and the Sonnet belt. | Environment | the owner's `.env` / Anthropic billing | **Not fixable here** — reported above |
| D4 | After a pass, the page painted the proposed-reply bubble before the customer's own line was back from the refetch, so the chat read out of order for a beat (`t6-evidence/02-…png` shows the chip line still in the box with the pass finished). | Cosmetic | `SandboxPage.tsx` | **Fixed** (paint the POST's own `state`; show the pending line at once) |
| D5 | The previous pass's proposed bubble stayed after Seed quote and landed under the quote bubble. | Cosmetic | `SandboxPage.tsx` | **Fixed** (seed clears the last pass) |
| D6 | Three of five chips lane to Ben by lexicon before any agent runs. | Design question, pipeline's move | `triageRules` / the presets | **BACKLOG T6-b** |
| D7 | A belt failure is a `none` decision and counts as a quiet pass in the autonomy evidence. | Pipeline | `autonomy.ts` | **BACKLOG T6-a** |

**What held, as T5 promised:** the page loads behind the admin session and refuses an
unauthenticated call (401 `Authentication required`; bad SSE token 401 `Session expired`; the page
redirects to `/admin/login?next=/admin/sandbox`); the SSE feed connects and the stage lines stream
in order (`Case file` → `Triage` → `Pack` → `Proposed` → `Decision` → amber `DRY RUN`); Reset
thread deletes and recreates; Seed quote writes the pill, the synthetic bubble, `stage quote_sent`,
and the case file sees `quote sbx… (unpaid)`; every pass is stamped `sandbox: true`, `dryRun: true`,
`hasTrigger: false`; the NOT SENT frame leads the detail; the Ben-lane passes read *flagged for Ben
… nothing to the customer*; costs record (`£0.00` on the refused Sonnet passes, `claude-sonnet-5`).
No console error belongs to the page: the three 404s on load are `/api/admin/leads/needs-review`
and two PostHog calls, pre-existing and unrelated. The sandbox thread did not appear anywhere I was
allowed to look; the board and desk were outside the fence and were not opened.

---

## What shipped

### D1 — the sandbox mirrors the first-contact ack (`server/spine/sandbox-routes.ts`, `run-events.ts`)

`firstContactMirrorFor(run)` (pure, tested): triage lane `rules`, pack `rules.first_contact`,
decision `none`, intent `ack_enquiry` or `ack_photos` → mirror. `POST /message` then calls
`composeFirstContactAck({ intent, contactName: null })` from `server/first-contact-ack.ts` — a pure
function; **the ack module is untouched and its live behaviour unchanged** — and writes the body as
a synthetic outbound with sender `Sandbox (rules layer ack, mirrored, never sent)`. The response
carries `mirrored: { kind, intent, body, messageId, note }`. The route stays parameterless and keyed
on the number; nothing else changed in it.

Assumption stated: live, the ack goes out only when `first_contact_ack.enabled` is on; when it is
off the rules layer queues the same words as a draft for Ben, and the outbound lands when he
approves. Either way the thread's next message is the desk's once an outbound exists, which is the
one thing the mirror reproduces. The sandbox does not read the flag (it must not touch
`app_settings`) and always mirrors.

`wouldHaveHappened` now takes optional `triage` / `pack` and, for a `none` on the rules lane, says
*nothing from this pass — … First contact is the rules layer's (the first-contact ack), which
answers outside the spine; the desk takes over once it has*. Every other line is byte-identical.

### D2 — a reported belt failure is a failed pass (`types.ts`, `agents/scoper.ts`, `index.ts`)

`SpineAgent.run` gains `reportFailure?: (message) => void` beside `reportUsage` / `onEvent`. The
Scoper calls it from the catch it already has, inside its own try so a throwing listener cannot
break the run; its post-conditions still run (a Ben exception is still a flag, pinned). `runOnce`
sets `error = agent scoper failed: …`, logs it, emits a `note` stage, and closes the feed with
`ok=false`, exactly its existing path for an agent that throws. **The proposal, guards and decision
are what they were**: a refused belt with no flag is still `none`; with a flag it is still `flag`
(both pinned in `sandbox.test.ts`). This touches two pipeline files for observability only and
changes no send, draft, flag or price. The desk's `LiveRunPanel` gains the same red line for free.

### The page (`client/src/pages/admin/SandboxPage.tsx`)

The mirrored bubble is labelled; the detail shows a blue *First contact — the rules layer answers,
not the desk* box with the note and the ack; the proposed-reply slot says *first contact: the rules
layer's ack above is what the customer gets* instead of *no reply proposed*; a pass with `error`
reads *No proposal: the agent failed.* in red with the text, and a rules-lane pass reads *this pass
landed on the rules lane, which runs no agent* — *the agent chose to say nothing* is now only said
of an agent that ran and chose. Every POST's `state` is painted at once (`setQueryData`), the line
just sent shows while the desk thinks, and Seed quote clears the previous pass.

---

## Build gate, as measured

Both sides measured in this worktree with the same placeholder `DATABASE_URL` (a socket that never
connects); "before" = the six changed sources and five changed tests checked out from `1c2a394`,
"after" = this branch. The vitest diff is test-by-test from the JSON reporters, not counts.

| Check | Start `1c2a394` | This branch |
|---|---|---|
| `tsc --noEmit` errors (8 GB heap) | 1,880 | 1,880 |
| tsc errors NEW vs start | — | **0** (per-file counts identical; the six touched files 0 → 0; the four lines that differ textually are `call-thread.ts`, `first-contact-ack.ts` ×2, `inbox-board.ts` printing a union in a different order, untouched files, same errors) |
| vitest server: failing tests / files / suites at collection | 43 / 4 / 18 | 43 / 4 / 18 |
| vitest server failing-set diff | — | identical: 0 newly failing, 0 newly fixed; 1,469 → 1,477 tests, 1,418 → 1,426 passing |
| vitest client | 162 passing, 0 failing | 165 passing, 0 failing |
| new tests | — | **11** (8 server, 3 client); all 11 fail on the start commit's sources (7 server + 3 client fail, the 8th server test is the control that passes on both) |
| esbuild `server/index.ts` (the build script's flags) | — | bundles, 4.4 MB, exit 0 |
| `db:push` / migration / `app_settings` / first-contact ack behaviour / prices | none | none |

New or extended tests: `server/spine/run-events.test.ts` (rules-lane `none`), `server/spine/agents/
scoper.test.ts` (failure reported, return unchanged, throwing listener, quiet on success), `server/
spine/sandbox.test.ts` (reported failure → error / note / ok=false / decision unchanged, plus control),
`server/spine/sandbox-routes.test.ts` (`firstContactMirrorFor` ×3), `client/src/pages/admin/
__tests__/SandboxPage.test.tsx` (failed agent never green, rules-lane wording + mirrored box, the
mirrored bubble from the POST's own state).

---

## Not done

- **No fix was seen live.** The running page is the owner's copy at `1c2a394`; this branch cannot
  be loaded into it without restarting his server, which the fence forbids. Every claim above about
  the fixed behaviour rests on the tests. The re-check list is the deliverable in its place.
- **No Scoper reply was ever observed**, so the thing the sandbox exists to judge — the move — is
  still unverified end to end, including T5-DONE's promised *Reading thread* / *Propose reply* tool
  lines and the amber proposed bubble. Cause: the key has no credit (D3). Nothing in this branch can
  change that.
- **Board / desk exclusion not re-checked** (T5-DONE step 7): both pages were outside the fence.
  The T5 tests pin it; a human should open `/admin/comms` and `/admin/desk` once after this session
  and confirm the sandbox thread is absent.
- **Real-thread replay (T5-b) and the chip lanes (T6-b)** are unchanged; the chips still say nothing
  about which lane they will land on.
- **The mirror always mirrors**, regardless of whether the live ack is enabled or the thread's
  channel would allow freeform. It reproduces the one structural fact (an outbound exists) and
  says so; it does not claim the exact wording that would have gone.
- **The sandbox thread on production was left as this session ended** (eight messages, seven
  runs, one synthetic quote), all on the drama number, all stamped sandbox. Reset thread clears it.
- **`fm-ensure-agents-md.sh` was not run**, for T5's reason: it would move `CLAUDE.md` into a new
  `AGENTS.md`, a repo restructuring outside this task. Nothing durable enough for every future
  session came out of this beyond what `CLAUDE.md` already points at (the sandbox line).
- **The admin token** was used in the browser's local storage and as a Bearer header only; it is
  in no file, screenshot, log or report in this branch (the one network capture that would have
  held it was deleted and re-taken redacted).

## New BACKLOG rows

`BACKLOG.md` Lane 6: **T6-a** (a belt failure recorded as a `none` decision, and as autonomy
evidence), **T6-b** (three chips flag to Ben by lexicon before any agent runs).
