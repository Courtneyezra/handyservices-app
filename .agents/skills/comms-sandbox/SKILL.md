---
name: comms-sandbox
description: Use when you need to exercise the comms desk end to end without messaging a real customer — driving /admin/sandbox, seeding one of the four front doors, replaying a pass, attaching media, ageing the 24-hour WhatsApp window, or reproducing a live thread's behaviour.
---

# Comms sandbox: a dry run of the whole desk

`/admin/sandbox` types as a customer and watches a spine pass run live. Use it before
touching customer-facing behaviour, and to reproduce a thread you cannot safely replay
in production.

## What makes it safe

- It lives on the reserved Ofcom drama number `+447700900942` (`SANDBOX_PHONE_E164` in
  `server/spine/sandbox.ts`). No subscriber exists on that range, ever.
- A sandbox pass never reaches the exit, so nothing is sent.
- The number is excluded from the board, the desk, the sweeps, the sampler, the autonomy
  evidence and the price queue. `server/spine/sandbox-exclusions.test.ts` pins that.
- The price screen's send refuses the sandbox number.

Because of the exclusions, sandbox traffic never contaminates autonomy promotion evidence.

## The API behind the page

All under `/api/comms-sandbox` (`server/spine/sandbox-routes.ts`, admin-only):

| Route | What it does |
| --- | --- |
| `POST /reset` | Clear the sandbox thread |
| `POST /start` | Open one of the four front doors (see below) |
| `POST /message` | Send a customer message; accepts photo/video attachments |
| `POST /run` | A clock pass with no new message |
| `POST /age` | Move every timestamp back, so the 24-hour window shuts honestly |
| `POST /call` | Ben rings them: writes the call through the live `ingestCallRow` |
| `POST /quote`, `/price`, `/accept` | Carry the thread to a sent quote and a paid deposit |

## The four doors

`POST /start { door }` seeds the originating event exactly as the live writer seeds it
(`server/spine/sandbox-scenarios.ts`, pure plans over the live decision functions and the
real template cache):

- `whatsapp` — inbound WhatsApp. This door takes `text`: the customer starts the
  conversation, so you type their opening message and it opens the 24-hour window.
- `post_call` — a finished call with WhatsApp agreed.
- `webform` — a website enquiry.
- `sms` — an inbound SMS.

Each door reports the first thing the customer would receive, and by which rung of which
ladder.

## Media

An attached photo or video is stored exactly as a real WhatsApp inbound is (`MEDIA_DIR`,
the S3 mirror, the same `messages` columns), so the describer's output reaches the Scoper
as it would live. The pass reports per item what the desk saw, or why it saw nothing;
the selection rule is `server/spine/media-selection.ts`, shared with `buildCaseFile`.

If descriptions come back empty, check the vision verdict before anything else — a red
**VISION FAILING** badge on the *AI Staff* sidebar item, the Vision card on `/admin/staff`,
or the sandbox banner (`server/spine/vision-health.ts`, `GET /api/spine/vision-health`).
`npx tsx scripts/_describe-media.ts <file> --live` prints the raw provider error.

## Reading a pass

The spine emits a live run feed for every pass (`server/spine/run-events.ts`).
A refused model belt is recorded as a failed pass, not a silent one.
