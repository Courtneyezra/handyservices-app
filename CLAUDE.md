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

