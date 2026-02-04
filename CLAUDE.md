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

### Quoting System Enhancements
**Last session**: Adding PDF download functionality to quote cards

**Uncommitted changes**:
- `client/src/pages/admin/components/QuoteCard.tsx` - Added Download PDF button
- `client/src/pages/admin/components/QuotesList.tsx` - Added Download PDF button

**What was done**:
- Imported `Download` icon from lucide-react
- Imported `generateQuotePDF` from `@/lib/quote-pdf-generator`
- Added `address`, `jobDescription`, `segment` fields to PersonalizedQuote interface
- Added tooltip-wrapped download button that calls `generateQuotePDF()`

**Next steps**:
- Test PDF generation works correctly
- Commit changes if working
- Continue with quoting system improvements

---

## Session Notes
<!-- Add notes about current work here before closing -->

