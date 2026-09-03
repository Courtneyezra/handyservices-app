# WhatsApp templates for the job pack (P13 part 4) — for the owner to submit

Contractor notifications are business-initiated. Inside a 24-hour window they go freeform; outside it
Meta requires an APPROVED template. Until these two are approved, an out-of-window notice queues for
Ben with the reason on the draft (`[job_pack_ready:<dispatch>] … no approved template`), exactly as the
customer holding line did before `holding_line_v1` was approved. Templates are read-only in the app
and sync hourly (`/admin/staff` → Templates → Sync now); one template per purpose or Meta rejects it as
a duplicate. Category UTILITY, language en_GB. Names must match exactly.

## `job_pack_ready_v1`
Sent when a dispatch is created (to every contractor it was sent to) and when a contractor accepts.

Body:
```
Job pack for {{1}}, {{2}}, {{3}}: {{4}}
```
Variables: `{{1}}` job title (contractor-facing, e.g. "Doors, carpentry") · `{{2}}` outward postcode
(e.g. "NG2") · `{{3}}` the date in words (e.g. "Tue 8 Sept" or "date to be confirmed") · `{{4}}` the
contractor's private job link (`https://handyservices.app/contractor-job/<token>`).
Sample values for the submission: `Doors, carpentry` · `NG2` · `Tue 8 Sept` ·
`https://handyservices.app/contractor-job/abc123`.

## `job_pack_changed_v1`
Sent when a day-relevant field changes after the contractor accepted: at most one an hour per job,
the changed fields batched into one message.

Body:
```
Update on {{1}} {{2}}: {{3}} changed. {{4}}
```
Variables: `{{1}}` job title · `{{2}}` the date in words · `{{3}}` the fields, in words, joined with
commas (e.g. "parking, pets") · `{{4}}` the contractor's private job link.
Sample values: `Doors, carpentry` · `Tue 8 Sept` · `parking, pets` ·
`https://handyservices.app/contractor-job/abc123`.

## What is never in either body
The customer's surname, street address, full postcode, phone number, or any money. The message is the
first name at most (the title carries none), the outward postcode and the link; everything else is
on the page, and the address, codes and contact only after acceptance. `guardContractorBody` in
`server/spine/job-pack-notify.ts` refuses a body that carries any of those.

## After approval
Nothing to deploy: the hourly template sync picks the status up, `findApprovedTemplateWithValues`
finds the names above, and the queued-for-Ben fallback stops being used. Check the staff page's
template table shows both as `approved`.
