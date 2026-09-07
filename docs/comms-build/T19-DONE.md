# T19 — the inbound WhatsApp door starts from the customer's own first message: DONE report

Brief: `BRIEF-T19-sandbox-first-message.md`. Branch `fm/sandbox-first-message-t19`, from `ee65a05`
(T16 merged). Your report, on the sandbox at `ee65a05` after a hard reload:

> for inbound whatsapp in "Scenarios" there is no initial text from the user that would trigger
> the first ack which would be freeform as the 24 hour window is active as the user initiated
> conversation

You were right, and it was reproduced in your browser before anything was changed (§ What was
found). **Your server still runs the old code**: the fix is on this branch and was proven by
tests, not on your screen. The list right below is how you see it.

---

## How to check this (copy and paste)

```bash
git fetch origin && git checkout fm/sandbox-first-message-t19 && npm run dev
```

Open http://localhost:5001/admin/sandbox. Press **New scenario** (or, with no thread, the doors
are already showing). **Inbound WhatsApp** is the door selected by default.

1. **The card now has a message box.** Under the name (Sam) there is a box labelled *Their
   opening WhatsApp message, in your own words (it creates the thread and opens the window; the
   ack answers it)*. It is **empty**: there is no canned text on this door on purpose. The green
   line still says whether the first-contact ack is ON for WhatsApp on your server. **Open through
   this door** is greyed out until you type something.
2. Type an opening line as a customer would, for example
   `Hi, my bathroom extractor fan has stopped working, can you replace it? NG7 2AB`, and press
   **Open through this door**. The desk thinks for ten to twenty seconds.
3. What you should see, in this order down the page:
   - the thread header **Sam · INBOUND WHATSAPP**;
   - the window strip in **green**: *WhatsApp window: OPEN — last customer WhatsApp 0 min ago;
     shuts 24.0 h from now · We may write freely on WhatsApp.* It is open because the customer
     wrote first. (At `ee65a05` this strip was amber SHUT here.)
   - on the left, your line as a customer bubble, then a bubble labelled **rules layer ack ·
     mirrored · never sent** reading *Hi Sam, thanks for getting in touch. --- Is it OK if we give
     you a quick call to run through it? Or just reply here with the details.* That is the ack,
     composed against your message, in our own words (freeform), because the window is open;
   - on the right, the blue **Door: Inbound WhatsApp** box, now with a **green line**: *The
     customer's own message ("Hi, my bathroom extractor fan…") created this thread and opened the
     24 h window: the reply may be freeform, no template needed.* Under *The first-contact ack
     ladder* it reads **FREEFORM by whatsapp — window open: the composed ack goes freeform on
     WhatsApp**, with no template table (none is needed), then the gate line: *On this server the
     first-contact ack is ON for whatsapp: production sends exactly this, 60 to 150 s after the
     message*, then *Placed on the thread as Sandbox (rules layer ack, mirrored, never sent), on
     whatsapp*, then *The desk's first pass ran with trigger inbound_message*;
   - in the pass detail, the triage line says `lane rules`, intent `ack_enquiry` (first contact
     is the rules layer's turn, not the desk's), and a sky-blue box carries the ack with the same
     gate note;
   - **What happened on this thread**, bottom right: *Opened through Inbound WhatsApp: the
     customer's message "…" created the thread and opened the 24 h window; first contact*, then
     *First-contact ack (ack_enquiry): freeform — window open…*.
4. Now type a second message in the composer, e.g. `It's a 4 inch fan in the ceiling`, and send.
   This one reaches the **Scoper** (triage `lane scoper`), and its reply is the dashed amber NOT
   SENT bubble. That is the live sequence: ack first, desk from the second message.
5. **Photo-first contact still works the old way.** Press **Reset thread** (a bare thread, no
   door), attach a photo in the composer with no text, send: the mirrored ack is *thanks for
   sending those over* (`ack_photos`), as T16 §4 described.
6. **The other three doors are unchanged.** Open **Webform**: the enquiry is still seeded, the
   ack is still the template on the ladder, the strip is still SHUT. Same for **Post-call** and
   **Inbound SMS**.

**What a fault looks like:**
- The Inbound WhatsApp card has no message box, or Open is enabled with it empty: you are not on
  this branch (hard reload, check `git log -1`).
- The strip says SHUT right after opening the WhatsApp door: `lastInboundAt` was not set by the
  door's inbound row. Stop and report with the run id.
- The Door box says *Nothing placed on the thread: the first pass did not land on the rules
  layer's first contact*: read the run below it. A red *Agent run failed* is the model belt (T6);
  a `drop` decision is the spam screen refusing your text (it is honest: live would not ack it
  either). Try a plainer opening line.
- The ack bubble is a template (`web_enquiry_ack_context` or `call_request`) on this door: the
  plan was made with the window shut. Stop and report.

**Nothing you do here can reach a phone.** The thread is on the reserved number `+447700900942`,
every pass is a dry run, the exit is never called, and `/admin/comms`, `/admin/desk` and
`/admin/price` must not show it.

---

## What was found (in your browser, 7 Sep, your server at `ee65a05`)

Only `/admin/sandbox` was opened, with the session token you provided, in a separate headless
Chrome. Nothing outside the sandbox panel was clicked; your server was not touched; the thread was
reset afterwards to the bare thread you had left (*Sandbox customer (not real)*, no messages).

**Inbound WhatsApp door, as shipped.** The scenario card carried a name field only and the note
*"A clean thread. Type the first message below as the customer; it is first contact."* There was
no box for the customer's opening message; Webform and SMS had one ("Their first text"). Pressing
**Open through this door** created an empty thread named Sam: no message, no ack, no ladder, no
gate line, no pass. The window strip read **SHUT — last customer WhatsApp never · Only an approved
Meta template may go on WhatsApp**, directly under a Door box saying *"Every customer WhatsApp
opens the 24-hour window. While it is open we may write freely."* Two lines that contradict each
other, because the door had produced no event.

Typing the opening line into the composer afterwards did work: the WhatsApp inbound row opened
the window (strip OPEN), the pass laned to `rules` / `ack_enquiry`, and the freeform ack *"Hi Sam,
thanks for getting in touch…"* was mirrored. So nothing was pre-seeded and no ack was answering
nothing. The gap was that the door itself had no event: on WhatsApp the customer starts the
conversation, and their first words are the thing that makes the thread exist, opens the window
and gets acknowledged, but they were not part of opening the door.

**Webform door, for contrast.** Opening it seeded the enquiry bubble (📝 webform), mirrored the
template ack (`web_enquiry_ack_context`, ✓ on the ladder), showed the gate line and ran the first
pass at once. That is the shape you expected the WhatsApp door to have, with your own words as
the event. (One side observation, not this task: on your server that first webform pass proposed
nothing, *"no reply proposed — NOTHING — no proposal"*. T16 expected `lane scoper` there. Worth
one look at that run's triage line next time you open the webform door.)

---

## What changed

**The inbound WhatsApp door takes the customer's opening message as its event.**

- `server/spine/sandbox-scenarios.ts`: `validateStart` refuses an empty `text` for `whatsapp`
  (*"whatsapp needs the customer's opening message: it is what creates the thread and opens the
  24 h window (type it in your own words)"*), as it already did for `webform` and `sms`.
  `DOOR_DEFAULTS.whatsapp.text` stays empty on purpose: no canned words on this door. The door's
  `firstReply` line now says the opening message is the event.
- `server/spine/sandbox-routes.ts`: `openDoor` for `whatsapp` inserts the message as a WhatsApp
  inbound through `insertInbound` (channel `whatsapp`), the same call the composer uses and the
  only path that sets `lastInboundAt`, so the window opens exactly as `conversation-engine.ts`
  opens it. It returns `firstMessage`, `openedWindow: true` and `firstRunTrigger: 'inbound_message'`,
  and places **no ack**. The `/start` handler runs the first pass and then, **only if the pass
  landed on the rules layer's first contact** (`firstContactMirrorFor`, the T6 rule), plans the
  ack with the window open (mode `freeform`) and mirrors it. That block was lifted out of
  `/message` into one helper, `mirrorFirstContactAck`, which both now call, so the door and the
  composer cannot drift apart. The entry report is then patched with the plan and what was placed,
  and the response carries `mirrored` so the page paints the same sky-blue box the composer gets.
  `entrySummary` for this door names the message and says it opened the window.
- `client/src/pages/admin/SandboxPage.tsx`: the WhatsApp card shows the message box (required,
  empty, with a placeholder), Open is disabled until it has words, and the *"A clean thread"* note
  is gone. The Door box carries a green line saying the customer's message opened the window (or
  amber for a thread opened before this change), shows the FREEFORM plan and the gate through the
  existing ack section, and, when the pass did not reach the ack, says so and points at the run.

**The other three doors were checked against the same question and are unchanged.** Each seeds
its originating event, which is right for its nature: a post-call thread starts from a call that
already happened (the calls row and the 📞 message, window shut), a webform thread from the
submitted form (📝, window shut, template ack), an SMS thread from the SMS (💬, no window, SMS
ack). None of them mirrors an ack before the customer's event exists.

**Seeding was not removed anywhere.** Webform and SMS keep their default text; the WhatsApp door
never had one.

### Isolation, still pinned

Unchanged and still tested: the exit is never called (`sandbox-exclusions.test.ts`, `sandbox.test.ts`),
a real number is refused before triage, sandbox runs stay stamped and out of the sampler and every
autonomy evidence query, and the sandbox number is out of the price queue and refused by the price
screen's send (`sandbox-routes.test.ts` "the route never takes an id"). The WhatsApp door's new
inbound row goes through the same `insertInbound` as every sandbox message, on the sandbox
conversation only. Not touched: live behaviour, prompts, packs, tiers, preconditions, the sampler,
autonomy, media settings, `describe-video.ts`, `first-contact-ack.ts` (the ack's composition),
prices, migrations, `app_settings`. No sibling file (`exit.ts`, the SLA sweep, the desk page, the
price-queue reader, the triage prompt, eval fixtures) was touched.

---

## Build gate, as measured

Both sides on this Mac with the same placeholder `DATABASE_URL`; the base is `ee65a05` in a
throwaway worktree sharing this checkout's `node_modules`. The vitest diff is test-by-test from
the JSON reporters, not counts.

| Check | Base `ee65a05` | This branch |
|---|---|---|
| `tsc --noEmit` errors (8 GB heap) | 1,880 | 1,880 |
| tsc errors NEW vs base | — | **0** (the file:line:col:code sets are identical) |
| vitest server: failing tests | 43 of 1,654 | 43 of 1,654 |
| vitest server failing-set diff | — | **identical**, test by test (the 43 are the known set: `eve-pricing-engine`, `segment-classifier`, `contractor-pay`, and the `performance.test.ts` heap benchmark, which failed on both sides this time) |
| vitest client | 0 failing of 218 | 0 failing of 221 when run alone. In the back-to-back gate run one test failed, `PriceAndSendPage.test.tsx › renders her words and photos…`, a `toHaveValue` on a textarea filled asynchronously; it is a file this task does not touch, and it passed on an isolated re-run of the whole client project (221 of 221) |
| the three suites this task touches | — | `sandbox-scenarios.test.ts` and `sandbox-routes.test.ts` 59 passing (with the dummy `DATABASE_URL`); `SandboxPage.test.tsx` 48 passing (3 new: the card, the entry box, the nothing-placed case; 1 rewritten: the picker no longer pins "the whatsapp door needs no text") |
| esbuild `server/index.ts` (the build script's flags) | — | bundles, 4.3 MB, exit 0 |
| `db:push` / migration / `app_settings` / any live prompt, pack, tier, precondition, price | none | none |

Files touched: `server/spine/sandbox-scenarios.ts`, `server/spine/sandbox-routes.ts`,
`client/src/pages/admin/SandboxPage.tsx`, their three test files, `CLAUDE.md` (one pointer line),
this brief and report.

---

## Not done

- **Not run on your server.** Your server runs `ee65a05`; the fix was proven by tests here, and
  the walkthrough above is how you see it. The ack wording quoted in step 3 is what the T6 mirror
  produced on your server at `ee65a05` from the composer; the door now goes through the identical
  helper, so it should read the same, but that is a claim about the code, not a screenshot.
- **The old bare-thread route is untouched.** **Reset thread** still gives a thread with no door
  (needed for the photo-first case, step 5). Its window strip reads SHUT until a message arrives,
  which is true, but that thread has no Door box to explain why.
- **A thread opened through the WhatsApp door at `ee65a05`** (before this change) shows the amber
  *opened without a customer message* line in its Door box if it is still there after you pull.
  Press Reset or open a door; it is bookkeeping only.
- **The webform first pass proposing nothing** on your server (§ What was found) was observed, not
  investigated.
- **`fm-ensure-agents-md.sh` was not run**, for the reason T5, T6, T11 and T16 gave: it would move
  this project's `CLAUDE.md` into a new `AGENTS.md`, a repo restructuring outside this task. One
  pointer line went into `CLAUDE.md`'s comms section instead.
