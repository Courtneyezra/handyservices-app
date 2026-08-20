# Mobile prep page — implementation plan

**Status: PARKED (20 Aug 2026).** Approved in principle; build when picked back up.
**Owner context:** Ben receives the "📋 Intake ready to price" Pushover ping on his phone.
The job-to-be-done from that ping is narrow — read the intake, glance the evidence, set the
price, send — and the comms board is a desktop tool (400 cards, drag-and-drop) that a phone
should never have to load to do it.

## What already exists (built 20 Aug, committed `6d371a3`)
- The ping carries `?conversation=<id>&prep=1` as both message text and the Pushover tappable URL.
- `/admin/comms` opens that thread on arrival; the prefilled quote panel opens itself once the
  stored intake loads (`GET /api/agents/quote-prep/:conversationId/intake`), params stripped after.
- This is the **interim** mobile answer: the slide-over is full-width on a phone and usable —
  it just rides on a heavy page. The mobile page replaces the vehicle, not the flow.

## The page

**Route:** `/admin/prep/:conversationId` (house precedent: `/admin/availability-mobile` — a
phone-first page for Ben because the desktop admin is heavy).

**Layout, top to bottom (thumb-first):**
1. **Header** — customer name, postcode, urgency chip, the clerk's verdict chip
   (`quote_ready` / `needs_info` / `visit_first`), link back to full comms.
2. **Job lines as cards** — title (customer-facing wording), evidence paragraph (Ben-only),
   **editable price field per line**, assumptions listed beneath each (tap to remove, add-field).
   Prefilled from the stored intake; same shapes QuotePrepPanel uses.
3. **Media strip** — every photo/video on the thread as swipeable thumbnails, tap = full screen.
   Tickable "on the quote" state reuses the panel's media-attach behaviour.
4. **Chat peek** — last ~6 bubbles collapsed under "view conversation"; expander loads the full
   thread inline. Full comms is one link away, never required.
5. **Sticky footer** — computed total, deposit, survey-gate toggle (pre-set on `visit_first`),
   and one **Send quote** button.

**Send path:** identical to the panel's one-motion send (persist draft quote →
`POST /api/agents/quote-prep/:id/draft-send-message` → `POST .../send-quote`), including the
window-shut template/queue fallbacks and the failure-only edit screen. After success: a done
screen with "view what they received", then back link.

## Server work
- No new endpoints expected: intake GET, thread messages, media URLs, draft-send-message and
  send-quote all exist. Audit while building; add a slim `GET /api/prep/:id/bundle` only if the
  phone round-trips prove chatty.
- Repoint the Pushover deep link to `/admin/prep/<id>` (keep `?conversation=` fallback working
  for old notifications).

## Auth (required, currently missing)
Tapping the link with an expired session must bounce through login **and return to the prep
page** — wire a `returnTo` param through the admin login flow. Without this the ping dead-ends
on a login screen and Ben loses the context he tapped for.

## Dependencies / cautions
- **Media persistence** (separate session, in flight): until media survives deploys, the strip
  can render dead thumbnails. Ship after, or degrade gracefully (broken-image → "photo
  unavailable, re-fetching" state).
- Keep the page dumb: no board query, no dnd-kit, no agent panels. Target: interactive under
  2s on 4G.
- The quote skin / crew picker and optional extras stay desktop-only (panel/builder); the
  mobile page uses the defaults the intake carries and shows what it chose. If Ben needs the
  full kit he taps through to comms.

## Test plan
- Unit: bundle/prefill mapping, price edit math, assumptions add/remove.
- Live: stage an intake on the Ofcom smoke conversation, drive the page with the browser tools
  at mobile viewport, send with config forced off (draft queued, read back, cleaned up).
- Real: one end-to-end from a real ping on Ben's phone before repointing the notification link
  for good.
