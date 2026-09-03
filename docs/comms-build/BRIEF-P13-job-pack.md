# P13: the job pack — one live record from clerk to contractor (pane top-right)
Worktree: /Users/courtneebonnick/v6-wt-exit (branch p13-job-pack, from comms-v3)

Owner decisions, 3 Sep 2026 (see Obsidian "Job Pack Handoffs" and the designed page):
the handover goes to the contractor portal AND as a contractor WhatsApp notification; the pack is
LIVE (later thread messages file into it); dispatch reads it and never infers; own table (not the
customer-facing quote); delivery-critical asks go out automatically after the deposit via the rules
layer. Same rules as every brief: worktree only; no DB, no app_settings, no push; idempotent SQL
migrations written, NOT applied; zero new tsc errors; server vitest failing set unchanged; client tests
green; esbuild bundles; commit; `P13-DONE.md`. This is the largest brief so far: land it in the order
below and commit after each part so a partial merge is still useful.

## Part 1 — the record (`job_packs`, migration `20260906_job_packs.sql`)
One row per quote (`quote_id` unique), created when the clerk marks an intake ready. Columns:
`lines jsonb` (per line: lineId, title, evidence [{messageId,text}], mediaIds, detail, assumptions,
exclusions, sizes, spec, supplyBy, procedure, category, minutesLow/Point/High, materials
[{name,supplier,sku?,size?,qty,unitPricePence}], hazards, disposal), `job jsonb` (accessMethod,
accessCodes, onSiteContact {name,phone,role}, floor, hasLift, parkingDistance, occupied, pets,
parkingPermit, prep, utilities, deliverySlot, doneLooksLike, accessNotes), `required jsonb`
(which fields are required for this job, derived from lines: e.g. supplied doors → sizes and spec),
`missing text[]` (computed on every write), `change_log jsonb` ([{at, field, from, to, by, source}]),
`locked_at`, `dispatch_id`, timestamps. Pure builders + tests. Server module `server/spine/job-pack.ts`:
`upsertFromClerk`, `upsertFromEstimate`, `applyBenEdits`, `fileAnswer`, `lock`, `missingFor`.

## Part 2 — writers
- Clerk: when the intake is ready, write lines with evidence (read `docs/comms-build/CLERK-EVIDENCE.md`;
  add evidence + mediaIds to the clerk artifact now, it is the clerk pane's own shape) and the
  price-critical fields it can see (sizes, spec, supply-by, exclusions, hazards, disposal, lead time).
  Add those to the clerk's GAP set so `needs_info` asks for them before Route A prices.
- Estimator: procedure, category, minutes range, materials with supplier/size/price, access notes.
- Ben's price screen (P12): its edits (materials, assumptions, resolutions, prices) write to the pack,
  and the quote's `pricing_line_items` are derived from the pack, not the other way round.
- Rules layer, after `deposit_paid`: a `job_pack_ask` intent, SEND tier, one question per message,
  from `required` minus what is known, in this order: access method, on-site contact, parking, pets,
  prep, delivery slot. Fixed wording per field (write it in `server/spine/packs/rules-followup.ts`
  style), no price, no date, ≤ 1 per day, stops when nothing is missing. Non-UK numbers: acknowledge
  only, as everywhere.
- Live filing: on every inbound after the quote, a deterministic pass then the clerk decide whether
  the message answers a pack field (key safe, contact, pets, parking, delivery). Delivery fields file
  silently with a change-log row (`source: customer`). Anything touching lines, sizes, spec or supply
  is a RESCOPE: tag it and lane the Scoper (P9), never edit the pack from a customer message.

## Part 3 — readers
- Dispatch (`server/contractor-dispatch.ts` ~1623–1700): build tasks from the pack when one exists
  (category, minutes point, materials with supplier/size/price, procedure, assumptions, exclusions,
  per-task mediaIds); fail with a clear 422 listing `missing` required fields instead of inferring.
  Keep the regex/£50 fallback ONLY for quotes with no pack (legacy), and log when it is used.
  Lock the pack at dispatch (`locked_at`, `dispatch_id`): after that, line/price/date fields change
  only through the existing variation path; job fields stay live.
- Booking engine: read floor/lift/parking/occupied from the pack when sizing the day.
- Contractor portal (`client/src/pages/contractor/ContractorJobSheet.tsx`, also the
  `/dispatch-link/:token` preview): a "Job pack" section per task (customer's words, the photo for
  that task, procedure, assumptions, exclusions, materials with where to buy) and per job (access,
  contact, parking, pets, prep, delivery, done-looks-like). Address, codes and contact only after
  acceptance, as the page already does for the address. A "Changed since you accepted" strip at
  the top from `change_log` after `acceptedAt`. jsdom tests.

## Part 4 — contractor WhatsApp notification
- Two fixed messages, no model: `job_pack_ready` ("Job pack for <title>, <postcode>, <date>: link")
  when the dispatch is created / a contractor accepts, and `job_pack_changed` ("Update on <title>
  <date>: <field> changed. Link") when a day-relevant field changes after acceptance. Both go
  through `sendCustomerMessage`'s contractor-audience path with an approver (`rules:job_pack`),
  to `handymanProfiles.whatsappNumber`, deep-linking to the portal job page. Guards: no customer
  PII in the message body (first name + postcode only), no money. Rate-limit: one `changed` per
  hour per job, batched.
- These are business-initiated, so outside a 24 h window they need APPROVED Meta templates. Write
  the two template bodies with variables into `docs/comms-build/TEMPLATES-JOB-PACK.md` for the
  owner to submit (templates are read-only in the app and sync hourly); until approved, the send
  falls back to the in-window path and otherwise queues for Ben with a reason, exactly like the
  customer holding line did before its template was approved.
- Owner also wants the pack to reach the partner side: link the same job page from the contractor
  dashboard list (`/contractor/dashboard/jobs`) with a "pack complete / N missing" chip.

## Not in scope
Pay, bonds, the prize wheel, invoicing, the materials-run page beyond reading the pack's materials.
