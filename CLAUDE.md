# V6 Switchboard ("The Monitor")

## Project Overview
Streamlined backend and frontend for the V6 Handyman Operations system. Isolates the "High IQ" components from V5 legacy.

### Core Components
1. **The Monitor** - Twilio Realtime WebSocket server for call transcription (OpenAI Whisper)
2. **The Brain** - SKU detector that analyzes transcripts to suggest services/pricing
3. **The Face** - HandymanLanding page optimized for conversion

## Tech Stack
- **Frontend**: React 18, Vite 5, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Express 4, Node.js
- **Database**: PostgreSQL (Neon) with Drizzle ORM
- **Integrations**: Twilio, OpenAI, Deepgram, ElevenLabs, Stripe, WhatsApp Web.js, AWS S3
- **Routing**: Wouter (client), Express (server)

## Project Structure
```
├── client/src/
│   ├── components/          # UI components
│   │   └── quote/           # Quote display components
│   ├── pages/
│   │   ├── admin/           # Admin dashboard
│   │   └── contractor/      # Contractor portal
│   └── lib/
│       ├── quote-helpers.ts
│       └── quote-pdf-generator.ts
├── server/
│   ├── index.ts             # Server entry
│   ├── quotes.ts            # Quote routes
│   ├── quote-engine.ts      # Quote generation logic
│   └── twilio-realtime.ts   # Call transcription
├── shared/
│   └── schema.ts            # Drizzle schema
├── scripts/                 # Utility scripts
├── migrations/              # DB migrations
└── docs/                    # Documentation
```

## Commands
```bash
npm run dev          # Start dev server
npm run build        # Build for production
npm run db:push      # Push schema to database
npm run seed         # Seed SKU table
```

## Key Documentation
- `docs/ROADMAP_STRATEGY.md` - Phase strategy (Bionic CRM → Co-Pilot → Agentic)
- `docs/SYSTEMATIC_ROADMAP.md` - Task breakdown (B1-B6, F1-F6)
- `docs/RUNBOOK.md` - Operations guide

## Current Phase: Phase 1 "Bionic CRM"
Focus on immediate operational utility before AI autonomy.

### Priorities
1. **Invoicing & Payments** - Order-to-cash cycle
2. **Dispatching & Calendar** - Job assignment flow
3. **Field App** - Contractor job acceptance & completion

## Database
Key tables: `users`, `leads`, `calls`, `personalized_quotes`, `productized_services` (SKUs), `handyman_profiles`

## API Routes
- `/api/quotes` - Quote CRUD & generation
- `/api/calls` - Call tracking
- `/api/leads` - Lead management
- `/api/twilio/*` - Twilio webhooks

---

## Current Work in Progress

### Comms desk — "the spine" (Phases 0–11 shipped 2–4 Sep 2026; production LIVE since 3 Sep 00:31 UK, autonomy + sampler still off)
- One pipeline for customer messaging under `server/spine/`: case file → triage → policy pack → agent (Scoper / Quote clerk / Recovery / Contractor liaison) → guards → decision → exit. The exit is the only sender; every send carries an `Approver` and a run id.
- Ships behind `app_settings.spine` (`enabled` / `shadow` / `mode`, plus `asks`, `autonomy`, `sampler`, `video`), all fail-closed off. Flip with `scripts/_spine-mode.ts`. Legacy `server/agents/comms.ts` keeps drafting until Phase 5 deletes it (7 live days, zero unsafe).
- Ben's approve / edit / reject with reason chips (`draft_verdicts`) plus eval families (`eval-cases/`, `scripts/eval-comms.ts`) are what promote an intent DRAFT → SEND (`server/spine/autonomy.ts`); the 10% sampler and any `unsafe` verdict demote.
- Only the Railway worker (`COMMS_WORKER=1`) runs customer loops; heartbeat on `/api/health/comms-worker`.
- Sandbox (T5, 6 Sep): `/admin/sandbox` types as a customer and watches a dry-run pass live. It lives on the reserved drama number `+447700900942` (`server/spine/sandbox.ts`), never reaches the exit, and is excluded from the board, desk, sweeps, sampler and autonomy evidence. The spine emits the live run feed for every pass (`server/spine/run-events.ts`). Report: `docs/comms-build/T5-DONE.md`. First run live 7 Sep (T6): a clean thread now gets the rules layer's ack mirrored so the second message reaches the Scoper, and a refused model belt is recorded as a failed pass. Report and owner re-check list: `docs/comms-build/T6-DONE.md`. Media (T11, 7 Sep): a sandbox message can carry photos or a video (`Attach`); they are stored exactly as a real WhatsApp inbound is (`MEDIA_DIR`, S3 mirror, the same `messages` columns) so Gemini's description reaches the Scoper as it would live, and the pass reports per item what the desk saw or why it saw nothing (`mediaReportFor`; the selection rule is `server/spine/media-selection.ts`, shared with `buildCaseFile`). Report and the owner's check: `docs/comms-build/T11-DONE.md`. Attach fix (T13, 7 Sep): the first real use found the page dropped the picked file before React read it (`addFiles` cleared the input's live FileList ahead of a deferred state updater), so no file ever reached the server; fixed on the page, and every downstream link (multipart, multer, the row, the bubble, the case file) was proven live on the owner's server. Gemini's description failed there for a reason only his console shows (`[describe_video]`); `scripts/_describe-media.ts <photo> --live` prints it. Report and re-check: `docs/comms-build/T13-DONE.md`.
- Describer model (T14, 7 Sep): `gemini-2.5-flash` answered 404 "no longer available to new users" on every call for this account, so photo and video description had never produced a description since `spine.video` went on (445 failed vision rows in 30 hours, all recorded as the generic `no description`). `server/spine/tools/describe-video.ts` now calls `gemini-3.6-flash` (the model Google's error named; still `generateContent` v1beta, no `temperature`, thinking tokens counted as output; price in `server/agent-cost.ts`, $0.75 / $3.75 per M to 31 Dec 2026) and classifies a failure: `describeMediaDetailed` marks HTTP 400 / 401 / 403 / 404 as `config` (permanent, not retried) and the vision row's `error` carries the real reason with its class first. `server/spine/vision-health.ts` reads the newest 20 vision rows into one verdict shown in three places: a red **VISION FAILING** badge on the sidebar's *AI Staff* item (`GET /api/spine/vision-health`), the Vision card on `/admin/staff`, and the sandbox banner. Not proven live (no key here): the owner's check is in `docs/comms-build/T14-DONE.md`.
- Sandbox doors, window and funnel (T16, 7 Sep): the sandbox opens through one of the four real front doors (`POST /api/comms-sandbox/start { door }`: inbound WhatsApp, post-call with WhatsApp agreed, webform, inbound SMS), each seeded as the live writer seeds it and each reporting the first thing the customer would receive and by which rung of which ladder (`server/spine/sandbox-scenarios.ts`, pure plans over the live decision functions and the real template cache). The 24 h window is shown as the case file reads it and can be shut honestly (`/age` moves every timestamp back) and observed (`/run` is a clock pass with no new message). Route A now RUNS in the sandbox with Ben's Pushover and the job pack recorded on the run instead of done (`sandboxRouteADeps`); `/price` and `/accept` carry the thread to a sent quote and a paid deposit. The sandbox number is excluded from the price queue (`WAITING_DRAFT_WHERE`) and the price screen's send refuses it. Report and the owner's walkthrough: `docs/comms-build/T16-DONE.md`.
- Sandbox first message (T19, 8 Sep): the inbound WhatsApp door starts from the customer's own opening message, typed by the owner with no default, because on that door the customer starts the conversation: `POST /api/comms-sandbox/start { door: 'whatsapp', text }` inserts it as the WhatsApp inbound (the window opens), runs the first pass, and mirrors the freeform ack only if the pass landed on first contact, through the same helper `/message` uses (`mirrorFirstContactAck`). The Door box says the message opened the window. The other three doors keep seeding their originating event. Report and re-check: `docs/comms-build/T19-DONE.md`.
- After Ben's own call (T21, 8 Sep): the ladder (`server/post-call-ladder.ts`) hands an ANSWERED outbound call with a transcript to the spine as `call_ended`, as an inbound answered call always was, so the Scoper resumes from what Ben established on the phone (he asks for photos there; the follow-up is what collects them, freeform when the customer wrote first and the window is open). The hand-off sits behind every post-call outreach rail (`outboundHandoffVerdict`: minimum duration, mobile only, suppression list, `no_auto_messages`, a classification on the row, no decline or objection, not a complaint or a dropped call, the 30-day dedupe, quiet hours), gathered fail-closed by `ingestCallRow` (`gatherOutboundRails`): an input that cannot be read refuses. An answered outbound call on a thread waiting for a call also settles `callback_requested` (tag and flag, through `releaseFromBen`, by `system:outbound_call`) as it already settled `callback_due`. Triage does not re-run its text lexicons on a customer message an outbound call has since answered (`server/spine/answered-by-call.ts`; two lines in `triage.ts`), and the Scoper now sees a call's summary line plus up to 4,000 characters of transcript (was 700, head only). On the `call_ended` pass after Ben's call every Scoper reply is a pending draft for Ben: the call is the newest turn, so `ours_is_newest` holds it; nothing new sends unattended. Sandbox: **Ben rings them** (`POST /api/comms-sandbox/call`) writes the call through the live `ingestCallRow` and runs the pass. Report and the walkthrough: `docs/comms-build/T21-DONE.md`.
- Send preconditions (B7a, 7 Sep): `server/spine/send-preconditions.ts` is the deterministic gate on the *move* of a SEND-tier customer reply (reactive, customer's turn newest, `ask_gap` only pre-quote with no date or question asked, `confirm_received` only when something arrived, the pointing intents only with the quote's slug in the body). `decide` runs it only at SEND on a customer pack, so nothing changes until a person sets a tier; `PolicyPack.neverSend` (holding, clarify_scope, faq_from_kb, closing, offer_survey, answer_from_quote) can never be set to SEND by anyone. Eval cases carry `expected.precondition`, graded by `--adapter triage` with no key. Report: `docs/comms-build/B7a-DONE.md`.
- Clerk re-runs (D1 / D10, 7 Sep): every live or shadow pass leaves `metadata.lastSpinePass` (`{ at, trigger, runId, quoteTags }`, written by `runDue` in the same UPDATE that clears the lease, and by `runShadow`); the untriggered-quote net (`sweepUntriggeredQuotes`, the only clock that can request a `cadence` run) refuses a quote-tagged thread whose last pass started after the customer's latest inbound and found every quote tag now on the row. A new customer turn, a quote tag the pass did not find, or a `manual` run re-opens it; a clock never does. The direct requesters never read it. Report: `docs/comms-build/D1-DONE.md`; further loop shapes are BACKLOG D11–D13.
- Price queue (T9, 7 Sep): `/admin/price` lists every Route A draft waiting to be priced, oldest first, with its age and the price screen's own signals; a count badge in the sidebar (DISPATCH CONSOLE) and a one-line strip in the price screen's header ("N more waiting · Next: …") read the same query. "Waiting" is `WAITING_DRAFT_WHERE` in `server/spine/price-brief.ts`, the confirm screen's own rule; there is no second definition. Read-only, no notification, no price value. Report: `docs/comms-build/T9-DONE.md`.
- After the handover (T17, 7 Sep): the S15 review found the desk delivers "nobody left in silence" for one message per turn and that a thread handed to Ben never came back. `server/agents/sla-sweep.ts` now carries the chase ladder as three lanes (`ben_flag` from the flag's due time, `pending_draft` from the draft's due time, `price_draft` from the Route A draft's creation; `WAITING_DRAFT_WHERE` is still the one rule): re-pinged every 4 working hours (BEN_HOURS) with a numbered title on the `chase` Pushover key, from 12 working hours on the owner-facing `chase_escalation` key, backlog after 3 days (`chase` in `sla_sweep` config; defaults in code). `server/handover.ts` is the way back: `releaseFromBen` clears `needs_ben`, dismisses the open flag rows and ledgers it, called from `sendCustomerMessage` on any `human:*` send, from the composer's Meta path, and as a belt from the sweep's needs_ben scan; the page no longer PATCHes tags. The exit dedupes a flag on the open flag row and its exception, not the tag (`flagAlreadyOpen`). The board's clock treats a rules-layer holding line as a machine receipt like an ack (`auto-ack-window.ts`), the card carries the flag's note and due chip (`flagNote` / `flagDueAt`), and the digest names threads. No customer-facing line; the expiry claim order stays with the D1 decision. Report and the owner's check: `docs/comms-build/T17-DONE.md`; follow-ups BACKLOG Lane 13.
- Scope is gas only (T18, 7 Sep): the captain decided "we do handle plumbing … gas only, the rest is ours". The only work the desk treats as not ours is gas (and asbestos, which he was not asked about): `RE_REGULATED` in `server/spine/triage.ts` is now the gas lexicon and is the ONE path by which a gas job reaches Ben (`regulated_trade`, raised by the rules before the model runs). `out_of_scope` is no longer the model's to add: `mergeTriage` drops it on every thread and records why; it stays in the vocab for flags already on the board. Plumbing, water heaters, roofing, structural and electrical work go to the Scoper. `DeclineReason` is `gas_work` only (`server/agents/quote-prep.ts`; `docs/DECLINE_CRITERIA.md` carries the dated note). Fixtures: `eval-cases/scope/`. Report, the check and what the boundary now lets through: `docs/comms-build/T18-DONE.md`.
- Docs: design `docs/COMMS_AGENTS_V3_DESIGN.md` · switching `docs/comms-build/CUTOVER.md` · people `docs/comms-build/HANDOVER.md` · ops `docs/RUNBOOK.md` §4 · per-pane reports `docs/comms-build/P*-DONE.md` · delete list `docs/comms-build/PHASE5-DELETE.md`.
- Build gate: zero NEW tsc errors vs your start commit (the repo has ~1,882 pre-existing), vitest 42 pre-existing failures unchanged, esbuild bundles. Never `db:push`; migrations are idempotent SQL applied with `npx tsx scripts/_apply-migration.ts migrations/<file>.sql`.

### Quoting System - PROP_MGR Segment (Completed Feb 4, 2025)

**What was done**:
- Improved PROP_MGR segment following Madhavan's single-product framework
- Updated hero/proof/guarantee messaging (removed "Landlord Safety Net")
- Single product "Property Service" instead of tier comparison
- Job-focused features: 48-72hr scheduling, photo report, tenant coordination
- Add-ons: Tenant Coordination (free), Photo Report (free), Key Collection (£30)
- Partner Program = post-job upsell (not first-quote pitch)
- Added PDF download buttons to QuoteCard and QuotesList
- Added PROP_MGR BOF conversion boosters (Feb 4, 2025):
  - Trust badge strip: £2M Insured • 4.9★ Google (127 reviews) • 230+ properties serviced
  - Risk reversal statement: "Not right? We return and fix it free. No questions."
  - Landlord PDF download button: "Download quote for landlord approval"

**Key files changed**:
- `client/src/pages/PersonalizedQuotePage.tsx` - Segment content & features
- `client/src/components/quote/SchedulingConfig.ts` - Add-ons config
- `server/segmentation/config.ts` - Tier structure & framing

**Design decisions**:
- Tenant coordination is OPTIONAL (property may be empty/Airbnb)
- First quote = win the job, Partner Program = retention upsell after proving value
- "Land and expand" strategy

**Next steps**:
- Test PROP_MGR quote flow end-to-end
- Consider Partner Program upsell automation (after X completed jobs)

### Quoting System - LANDLORD Segment (Added Feb 4, 2025)

**What was done**:
- Created new LANDLORD segment following Madhavan's single-product framework
- Distinct from PROP_MGR: Individual landlords with 1-3 properties (not portfolio managers)
- "Hassle-Free Landlord" angle: "Your Rental. Handled. One text. We sort it."

**Segment Configuration**:
- Hero: "Your Rental. Handled." / "One text. We sort it."
- Proof: "You don't need to be there." - Photo proof, tenant coordination, tax-ready invoice
- Guarantee: "Protect Your Investment" - 48-72hr response, photo report, tax-ready invoice
- Testimonial: "I live 2 hours away. They coordinated with my tenant, sent photos, invoice was in my email by 5pm."

**Single Product**: "Landlord Service"
- Features: 48-72hr scheduling, photo report included, tenant coordination available, tax-ready invoice
- Add-ons: Tenant Coordination (free), Photo Report (free), Key Collection (£30)

**Conversion Boosters**:
- Trust strip: £2M Insured • 4.9★ Google (127 reviews) • 180+ landlords trust us
- Risk reversal: "Not right? We return and fix it free. No questions."
- PDF download: "Download quote for your records"

**Key files changed**:
- `shared/schema.ts` - Added LANDLORD to segmentEnum
- `server/segmentation/config.ts` - Profile, detection signals, tier structure, pricing, framing
- `client/src/pages/PersonalizedQuotePage.tsx` - Segment content, features, conversion boosters
- `client/src/components/quote/SchedulingConfig.ts` - Add-ons config
- `server/openai.ts` - Added to segment types
- `client/src/pages/GenerateQuoteLink.tsx` - Added to dropdown selector
- `client/src/pages/GenerateQuoteLinkSimple.tsx` - Added to segment options

**Detection signals**:
- Keywords: landlord, my rental, buy to let, btl, tenant, investment property
- Patterns: "my rental property", "I'm a landlord", "can't be there", "send me photos"

---

## Apple Pay Setup

The Apple Pay domain verification file at `/.well-known/apple-developer-merchantid-domain-association` is served BY THIS APP (explicit Express route in `server/index.ts`, file at `client/public/.well-known/`). Updated 19 Jul 2026: the previously documented Cloudflare-served file was found NOT to exist — the path fell through to the SPA catch-all and returned index.html, which silently broke Apple Pay verification on www.handyservices.app. Cloudflare proxies the path straight through, so the Express route is authoritative. Do not remove the route or the file.

To register a new domain: Stripe Dashboard → Settings → Payment method domains → Add domain (or `POST /v1/payment_method_domains` with the secret key, then `/validate`). Stripe's universal association file (same for all Stripe merchants) downloads from https://stripe.com/files/apple-pay/apple-developer-merchantid-domain-association.

---

## Session Notes
<!-- Add notes about current work here before closing -->

