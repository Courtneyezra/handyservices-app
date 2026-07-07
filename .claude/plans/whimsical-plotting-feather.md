# Franchise Showcase Page

## Context
We need a page to attract investors/licensees who would operate the V6 Handyman platform in new UK cities. The licensee model: local operator recruits contractors, handles marketing/sales, uses the full platform. Revenue share with HQ for tech. The "Too Good To Go for tradespeople" angle — contractors fill dead hours, customers get fast service, platform takes a cut.

## Files to Create
1. **`client/src/pages/pitch/FranchisePage.tsx`** — Main page component
2. **`server/franchise-stats.ts`** — Public API endpoint for live aggregate stats

## Files to Modify
3. **`client/src/App.tsx`** — Add lazy import (line ~131) + route at `/franchise` (line ~312)
4. **`server/index.ts`** — Import and register franchise stats router

---

## Page Sections

### A. Hero
- "Own Your City's Home Services Market"
- "The Too Good To Go model for tradespeople" subline
- Two CTAs: "Request Info Pack" + "Book a Discovery Call"

### B. System Flow Diagram — "The Proven Playbook"
7 connected nodes showing the full journey:
Lead Gen → WhatsApp Intake → AI Quoting → Booking & Payment → Contractor Dispatch → Job Completion → Reviews & Repeat

Each node = icon + label in a card. Arrows between. Responsive: horizontal on desktop, vertical on mobile.

### C. Platform Features Grid — "Everything an Operator Needs"
10 feature cards in a 3-column grid:
1. AI-Powered Quoting — contextual pricing by segment
2. WhatsApp-First CRM — full conversation history
3. TGTG Contractor Model — fill dead hours, higher utilization
4. CRM & Pipeline — Kanban lead board
5. Live Call Coaching — real-time transcription + AI suggestions
6. Landlord Portal — tenant coordination, photo reports
7. Payments Built In — Stripe, Klarna, deposits, payouts
8. Booking & Dispatch — calendar view, auto-match
9. Public Contractor Profiles — SEO pages, trust badges
10. Analytics Dashboard — funnels, revenue, VA leaderboards

### D. Revenue Model — "How Money Flows"
Visual flow: Customer Pays → Platform Fee (20-25%) → Contractor Payout (65-70%) → Your Profit (5-10%)
Example breakdown card beneath.

### E. Live Stats — "Platform Performance (Live)"
Pull from new `/api/franchise/stats` endpoint:
- Total quotes generated
- Conversion rate
- Avg job value
- Active contractors
- Revenue generated
- Customer rating
- Jobs completed

Fallback to demo data if DB is empty (< 10 quotes).

### F. What You Get — "Your Franchise Package"
Two-column checklist:
- Left: Platform & Tech (full access, contractor app, AI engine, WhatsApp, analytics, ongoing updates)
- Right: Support & Playbook (launch playbook, recruitment templates, marketing templates, training, support, partner network)

### G. CTA Footer
"Ready to Own Your City?" with two buttons.

---

## API Endpoint: `GET /api/franchise/stats`

**File:** `server/franchise-stats.ts`
**Auth:** None (public page, aggregate vanity metrics only)
**Cache:** 5-minute in-memory cache

**Response:**
```json
{
  "totalQuotes": 234,
  "conversionRate": 48.5,
  "avgJobValuePounds": 185,
  "activeContractors": 12,
  "totalRevenuePounds": 45000,
  "avgRating": 4.8,
  "totalJobsCompleted": 156
}
```

**Queries** (parallel via `Promise.all`):
1. `personalizedQuotes` — count all, count viewed, count booked, avg basePrice where paid
2. `handymanProfiles` — count all
3. `invoices` — sum totalAmount where status = paid
4. `contractorReviews` — avg overallRating
5. `contractorJobs` — count where status = completed

Pattern reference: `server/quote-analytics-api.ts`

---

## Styling (matches existing pitch pages)
- Dark gradient: `bg-gradient-to-b from-gray-900 via-gray-900 to-gray-800`
- Cards: `bg-gray-800/50 border-gray-700`
- Accent: `#e8b323` (golden)
- Layout: `max-w-5xl mx-auto px-4`
- Components: shadcn Card/Button, Lucide icons

## Verification
1. Start dev server (`npm run dev`)
2. Navigate to `/franchise`
3. Check all sections render correctly
4. Verify stats endpoint returns data: `curl localhost:5000/api/franchise/stats`
5. Test mobile responsiveness (flow diagram wraps, grid stacks)
6. Screenshot to confirm visual appearance
