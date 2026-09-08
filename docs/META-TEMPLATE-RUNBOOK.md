# Runbook: submitting WhatsApp templates to Meta, and chasing their approval

For the owner. Submitting a template is an external act on the business's own Meta and Twilio
accounts, so nobody else can do it. Everything below is a command you type on a machine that has
the project's `.env`, or a click in a console you own. Nothing in this repo has ever called Meta on
its own, and the submission script (`scripts/_submit-window-templates.ts`) has never been run.

What is being submitted and why: `docs/comms-build/TEMPLATES-WINDOW-SHUT.md`.
The definitions themselves: `server/window-templates.ts`.

---

## 0. Why this is first, and how long it takes

WhatsApp carries free text for 24 hours after the customer's own last message. Outside that window
only a template Meta approved in advance may go out at all. Approval is Meta's queue, not ours.

Meta says a first decision usually lands within minutes and at most 24 hours, and this repo's own
note from the last submission round says the same ("Meta review typically minutes-to-hours",
`scripts/archive/_create-context-ack-template.ts`). What blows that out is a template Meta sends for
a second look: a re-review, an appeal, or a re-categorisation runs to days, and the build plan works
on "days to weeks" for exactly that reason. Plan on same-day for a clean utility template and up to
two weeks for the marketing one.

**This repo has no measured record of its own approval times.** `whatsapp_template_events` records
every status transition with its timestamp, so after this round there will be one: the gap between a
template's first-seen row and its `approved` row is the real number for this account.

That queue is the whole reason this item is first: the work that needs these templates is blocked
on it, so it starts now.

**Meta's content rules and the common rejection reasons are already written up** in
`docs/TWILIO_TEMPLATES.md` § Meta Approval Tips. Read that before changing any wording; this
runbook is the mechanics, that one is the rules.

## 1. Before you type anything

You need, on the machine you run this from:

1. **The project `.env`**, with `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` set. These are the same
   credentials the app sends WhatsApp with; the scripts read them through `dotenv/config` and refuse
   to run without them. Nothing else is needed — no Meta token, no Facebook login: Twilio's Content
   API is the account's route to Meta for templates.
   Check them without printing them:
   ```bash
   node -e "require('dotenv').config();console.log('sid',!!process.env.TWILIO_ACCOUNT_SID,'token',!!process.env.TWILIO_AUTH_TOKEN)"
   ```
   Both must print `true`. If not, copy `.env` from Railway (project Handy-Services → Variables) or
   from the Twilio console (Account → API keys & tokens).
2. **Node and the repo's dependencies**: `npm ci` if `node_modules` is missing.
3. Nothing else. Do **not** set `DATABASE_URL` for the dry run; the dry run touches no database.

## 2. Read the dry run first. Always.

```bash
npx tsx scripts/_submit-window-templates.ts
```

This prints, for each of the five: the name, Meta's category, the trigger, the exact body, the body
with its sample values filled in, and the two HTTP calls that `--submit` would make. It sends
nothing and exits 0.

It also runs two checks per template and **exits 2 without submitting anything** if either fails:
the house voice rules (`shared/chat-voice.ts`) and the draft guards (`server/agents/draft-guards.ts`)
against the rendered sample. If it stops here, fix the body in `server/window-templates.ts` — do not
work around the check.

Read the rendered samples out loud. This is the last point at which the wording is ours; after
approval it is Meta's, and the only lever left is to decline to send it.

## 3. Submit

```bash
npx tsx scripts/_submit-window-templates.ts --submit
```

For each template this makes two calls to `https://content.twilio.com/v1`: `POST /Content` creates
the Content resource, then `POST /Content/<sid>/ApprovalRequests/whatsapp` asks Meta to review it
with its category. Expect five lines like:

```
SKIP  quote_ready_link — already on the account (HXxxxx, approved). Nothing submitted.
ok    answer_ready_reopen_v1 created HXxxxx
ok    answer_ready_reopen_v1 submitted as UTILITY → status received
SKIP  web_enquiry_ack_context — already on the account (HXxxxx, approved). Nothing submitted.
ok    post_call_followup_v1 created HXxxxx
ok    post_call_followup_v1 submitted as UTILITY → status received
ok    enquiry_followup_optin_v1 created HXxxxx
ok    enquiry_followup_optin_v1 submitted as MARKETING → status received
```

`SKIP` is correct and expected for the two names the account already has: Meta rejects a repeated
name, so the script refuses to create one. `status received` means Meta has it and is reviewing.

To submit one at a time (safer if you want to watch the first one land):

```bash
npx tsx scripts/_submit-window-templates.ts --submit --only answer_ready_reopen_v1
npx tsx scripts/_submit-window-templates.ts --submit --only post_call_followup_v1
npx tsx scripts/_submit-window-templates.ts --submit --only enquiry_followup_optin_v1
```

`--only` also takes the trigger id (`question_unanswered`, `post_call_followup`, `enquiry_chase`).

**If a create call fails**, the script prints `FAIL <name> create <status>: <body>` and moves on to
the next one. The usual causes are a name that already exists in some other form (delete it in the
Twilio console: Content Template Builder → the template → Delete, then re-run) and a malformed
variable map (nothing to do here, the map comes from the definitions).

## 4. Check where they stand

Any of these three, in increasing order of effort:

```bash
# The staff page, which reads the app's own hourly cache:
#   /admin/staff → Templates. "Sync now" forces the poll instead of waiting for the hour.

# The same poll from the command line, straight against Twilio:
npx tsx scripts/archive/_wa-templates-status.ts

# Or hit the app's endpoint (admin session required):
#   GET /api/whatsapp-templates/status
```

Statuses you will see: `received` or `pending` (with Meta), `approved`, `rejected`,
`unsubmitted` (a Content resource exists but was never sent for review).

You do not have to watch it. The hourly sync (`server/whatsapp-template-sync.ts`, scheduled in
`server/cron.ts`) fires a **Pushover alert** the moment a template flips to approved or rejected,
with the rejection reason when there is one. That alert is the intended way to find out.

Nothing needs deploying when one is approved: the sync flips the cached status and every lookup is
by name, so the code starts finding it on its own.

## 5. When Meta rejects one

The rejection reason arrives on the Pushover alert and is stored on the row
(`whatsapp_templates.rejection_reason`, shown on the staff page).

1. **Read the reason before rewriting.** Most rejections here are one of three things: a
   near-duplicate of a template that is already approved, wording Meta reads as promotional in a
   UTILITY submission, or a variable that could carry anything (Meta dislikes a body that is mostly
   placeholder).
2. **Duplicate.** Do not resubmit a reworded twin — that is how you get two rejections instead of
   one. Use the existing approved template instead. The definitions already name the fallback where
   there is one: `post_call_followup_v1` falls back to `post_call_continuation_generic`.
3. **Anything else.** Edit the body in `server/window-templates.ts`, run the dry run, and submit
   again with `--only <name>`. A Content resource's body is fixed once created, so the old one has to
   go first: delete it in the Twilio console (Messaging → Content Template Builder → the template →
   Delete), or bump the name (`..._v2`) and add the old name as the second entry in the definition's
   `names` list, which is how `holding_line_v1` and `holding_line` already work. Bumping the name is
   the safer of the two, because the submission script refuses to create a name that already exists
   and a delete cannot be undone.
4. Record what happened in the log at the bottom of this file.

## 6. When Meta RE-CATEGORISES one

Meta categorises every template itself and re-categorises on review, on a schedule of its own, and
it will tell you after the fact rather than ask. A UTILITY template it decides is marketing becomes
a MARKETING template: priced differently, and only deliverable to a customer who has not opted out
of marketing.

**What to do:**

1. The hourly sync stores the live category on the row, so the staff page shows the change. Check
   `/admin/staff` → Templates and compare the `category` column against the definitions in
   `server/window-templates.ts`.
2. **Change the definition to match Meta.** Set `category` to what Meta says AND set `purpose` to
   `'marketing'`. The `purpose` field is what the send gate branches on: `'marketing'` is blocked
   for anyone who wrote STOP, `'service_reply'` is not (`server/opt-out.ts`). Leaving `purpose` as
   `'service_reply'` on a template Meta now prices and polices as marketing is the mistake that
   sends a marketing message to someone who opted out.
3. If it is re-categorised **to** marketing, it also needs a way out in the wording. Add the stop
   line (`Reply STOP and we will not message you again.`), and treat it as a wording change: step 5.3.
4. A re-categorisation can be appealed from WhatsApp Manager (Meta Business Suite → WhatsApp
   Manager → Message templates → the template), where Meta shows the category it assigned and an
   appeal control next to it. Appeals are limited and Meta does not always offer one, so use it only
   where the template is genuinely transactional: a re-engagement message is marketing however it is
   worded, and appealing that one achieves nothing. *(The exact console wording is Meta's and
   changes; the path above is the shape of it, not a promise about the button's label.)*
5. Never leave the repo disagreeing with Meta. If the definition says UTILITY and Meta says
   MARKETING, the definition is wrong.

## 7. When one is approved

1. The Pushover alert arrives, or the staff page shows `approved`.
2. Nothing to deploy. Confirm the name shows `approved` on `/admin/staff` → Templates.
3. That is all item 4.1 needs. **The template still does not send anything**: item 4.2 is what maps
   a trigger to it and gives template sends their own rule. Approval unblocks that work; it does not
   change today's behaviour.

## 8. What in this runbook has NOT been verified

Written without credentials and without a database, so:

- **No command here has been run against Twilio or Meta.** The dry run
  (`npx tsx scripts/_submit-window-templates.ts`, no flags) is the only thing that has been
  executed, and it makes no network calls.
- **The console paths are described, not clicked.** Twilio's and Meta's UIs move; the paths in
  sections 5 and 6 are the shape of the journey, and the labels may differ.
- **The live status of the two existing names is unknown here.** `quote_ready_link` and
  `web_enquiry_ack_context` were submitted in August 2026 and the repo assumes nothing about where
  they now stand. Section 4 is how you find out, and it is the first thing to do.
- **The wording of the two existing templates as recorded in `server/window-templates.ts` is what
  was submitted**, not necessarily what Meta approved. Compare against `/admin/staff` → Templates
  before relying on it.
- `quote_ready_link` carries its URL in the body rather than in a URL button, against the advice in
  `docs/TWILIO_TEMPLATES.md`. It was submitted that way and is left alone here; if Meta ever objects,
  that is the thing to change.

## 9. Submission log

Fill this in as you go, so the next person can see what Meta actually did rather than what we hoped.

| Template | Category submitted | Date submitted | Outcome | Category Meta settled on | Notes |
|---|---|---|---|---|---|
| `quote_ready_link` | UTILITY | (already on the account) | | | check status only, not resubmitted |
| `answer_ready_reopen_v1` | UTILITY | | | | |
| `web_enquiry_ack_context` | UTILITY | 22 Aug 2026 | | | reused, not resubmitted |
| `post_call_followup_v1` | UTILITY | | | | duplicate risk vs `post_call_continuation` |
| `enquiry_followup_optin_v1` | MARKETING | | | | submitted as marketing on purpose |
