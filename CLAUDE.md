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

---

## Session Notes
<!-- Add notes about current work here before closing -->

