# BRIEF T19 — the inbound WhatsApp door starts from the customer's own first message

Branch `fm/sandbox-first-message-t19`, from `ee65a05` (T16 merged). Written before coding.

## What the captain saw

On `/admin/sandbox` at `ee65a05`, hard reload, first use of the four doors:

> for inbound whatsapp in "Scenarios" there is no initial text from the user that would trigger
> the first ack which would be freeform as the 24 hour window is active as the user initiated
> conversation

## Reproduced in his browser (7 Sep, his server at `ee65a05`, production database, loops off)

Only `/admin/sandbox` was opened; nothing outside the sandbox panel was clicked; the thread was
reset afterwards to the bare thread he had left.

**Inbound WhatsApp door, as shipped.** The scenario card carries a name field ("Customer's name
(pushname)") and the note *"A clean thread. Type the first message below as the customer; it is
first contact."* There is no box for the customer's opening message; Webform and SMS have one
("Their first text"). Pressing **Open through this door** creates an empty thread named Sam: no
message, no ack, no ladder, no gate line, no pass. The window strip reads **SHUT — last customer
WhatsApp never · Only an approved Meta template may go on WhatsApp**, directly under a Door box
that says *"Every customer WhatsApp opens the 24-hour window. While it is open we may write
freely."* The two lines contradict each other because the door has produced no event yet.

Typing the opening line into the composer afterwards does work: the WhatsApp inbound row opens
the window (strip turns OPEN), the pass lanes to `rules` with intent `ack_enquiry`, and the
freeform ack *"Hi Sam, thanks for getting in touch…"* is mirrored. So nothing is pre-seeded and
no ack answers nothing. The gap is that the door itself has no event: the one thing that makes an
inbound WhatsApp thread exist, the customer's first words, is not part of opening the door.

**Webform door, for contrast.** Opening it seeds the enquiry bubble (📝 webform), mirrors the
template ack (`web_enquiry_ack_context`, ✓ on the ladder), shows the gate line and runs the first
pass at once. That is the shape the captain expected the WhatsApp door to have, with his own
words as the event.

## What to build

The inbound WhatsApp door takes the customer's opening message as its event, typed by the owner
in his own words (no canned default), and does with it exactly what the live door does:

1. The card gets a required box, empty by default: *Their opening WhatsApp message*. **Open**
   is disabled until it has words. `validateStart` refuses an empty text for `whatsapp` the way
   it refuses one for `webform` and `sms`.
2. `openDoor` inserts that message as a WhatsApp inbound (`insertInbound`, channel `whatsapp`),
   which sets `lastInboundAt` and so opens the 24 h window, as `conversation-engine.ts` does.
3. The first pass runs (`inbound_message`). **Only if the pass lands on the rules layer's first
   contact** (`firstContactMirrorFor`, the T6 rule) is the ack planned against his words with
   `windowOpen: true` (mode `freeform`) and mirrored onto the thread, the same code path the
   composer uses. The ack is triggered by his message; it is never placed before it.
4. The Door box reports: the window was opened by the customer's message (green), the ack plan
   (FREEFORM by whatsapp, the reason, the gate line: whether production would send it), and what
   was placed. If the pass did not reach the ack (spam screen, a failed belt), the box says
   nothing was placed and why to look at the run.
5. The window strip reads OPEN right after opening, because the customer initiated.

The other three doors keep seeding their originating event (a form, a call, an SMS): checked
against the same question, each seeds the right thing, so they are not changed.

Photo-first contact (`ack_photos`) stays reachable as before: **Reset thread** gives a bare
thread, then **Attach** a photo with no text in the composer.

## Files

`server/spine/sandbox-scenarios.ts` (validation, defaults, meaning), `server/spine/sandbox-routes.ts`
(the door, the mirror helper shared with `/message`, the entry report), `client/src/pages/admin/SandboxPage.tsx`
(the card, the Door box), their three test files, `CLAUDE.md` pointer, `T19-DONE.md`.

## Not touched

Live behaviour, prompts, packs, tiers, preconditions, the sampler, autonomy, media settings,
`describe-video.ts`, the first-contact ack's own composition, prices, migrations. The three
sandbox isolation layers stay pinned. Sibling files (`exit.ts`, the SLA sweep, the desk page, the
price-queue reader, the triage prompt, eval fixtures) are not touched.
