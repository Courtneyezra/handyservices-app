# Dispatch & Contractor Model — Scaling Roadmap

> Last updated: 2026-04-13
> Model: Per-task tiered revenue share with geographic clustering

---

## Core Model Decision

**We are a per-task revenue share platform.** Contractors are paid a percentage of the customer-facing price for each job. We do NOT buy time from contractors (no day rates, no block booking).

This means:
- Contractors are genuinely self-employed (IR35 clean)
- No micromanagement — they do the job, they get paid
- No dead-hour risk for the platform
- Aligned incentives: higher customer price = higher contractor pay

**The routing and clustering IS the product.** We make per-task work feel like a full day by grouping jobs geographically.

---

## Revenue Share Tiers

| Tier | Contractor % | Floor Rate | Categories |
|------|-------------|-----------|------------|
| Specialist | 55% | £28/hr | electrical, plumbing, bathroom, kitchen |
| Skilled | 50% | £22/hr | carpentry, tiling, plastering, lock change, door fitting |
| General | 45% | £18/hr | fixing, shelving, flat pack, curtains, painting, sealant, TV, furniture |
| Outdoor | 45% | £16/hr | garden, waste, pressure wash, guttering, fencing, flooring |

**Pay = MAX(revenue_share, floor_rate x hours)**

---

## The 3-Date Buffer Model

Customers choose 3 preferred dates when accepting a quote. This gives us a 2-3 day window to:
1. Group jobs by postcode area
2. Build efficient contractor days (3-5 jobs, tight radius)
3. Confirm the best date within 24 hours

**Customer experience:** "Pick 3 dates that work → We confirm one within 24hrs → Your handyman arrives on time with a planned route."

**Contractor experience:** "Get a message the evening before with tomorrow's jobs — all in your area, route planned, earnings clear."

---

## Stage 1: Manual Dispatch (NOW — 5-20 jobs/week)

### What's built:
- [x] Contextual quote builder with contractor assignment
- [x] Revenue share model with tier calculations
- [x] Margin preview panel (Platform/Contractor toggle)
- [x] Daily planner with postcode clustering (`/admin/daily-planner`)
- [x] 3-date picker on customer quote page

### How it works:
1. VA takes call, builds contextual quote
2. Customer receives quote via WhatsApp
3. Customer selects 3 preferred dates and pays deposit
4. Dispatcher opens daily planner each evening
5. Reviews tomorrow's confirmed jobs, grouped by postcode
6. Assigns contractor to each cluster (one dropdown per area)
7. Contractor gets morning message with the day's schedule

### Team required:
- 1 dispatcher (part-time, can be VA)
- 2-3 contractors covering key postcode areas

### Key metrics to track:
- Contractor effective hourly rate (target: £22+)
- Jobs per contractor per day (target: 3-5)
- Date confirmation time (target: <24hrs)
- Contractor acceptance rate
- Customer satisfaction with confirmed date

### Trigger to move to Stage 2:
- Consistently hitting 20+ jobs/week
- Dispatcher spending >1hr/day on routing
- Contractor scheduling conflicts becoming frequent

---

## Stage 2: Smart Dispatch (20-50 jobs/week)

### What to build:
- [ ] Contractor day view — "Your jobs tomorrow" (SMS/WhatsApp summary)
- [ ] Auto-suggest contractor for clusters based on postcode + skills + availability
- [ ] Capacity tracking — "Ollie has 5hrs booked Tuesday, 2hrs free"
- [ ] Contractor preferred area field on profile (home postcode radius)
- [ ] Basic route map view for dispatcher (plot jobs on map by postcode)
- [ ] Contractor acceptance/decline tracking per job

### How dispatch changes:
- Planner auto-suggests best contractor per cluster
- Dispatcher reviews and confirms (one-click approve)
- Contractor gets formatted day schedule via WhatsApp
- System tracks if contractor accepts/declines

### Team required:
- 1 full-time dispatcher
- 4-6 contractors with defined coverage areas
- Simple morning WhatsApp routine

### Trigger to move to Stage 3:
- Hitting 50+ jobs/week
- Multiple dispatchers needed
- Demand in new postcode areas without contractor coverage

---

## Stage 3: Optimised Dispatch (50-100 jobs/week)

### What to build:
- [ ] Algorithmic cluster building — auto-group by postcode + time window
- [ ] Contractor availability calendar — weekly slots, date-specific overrides
- [ ] Performance dashboard — on-time rate, completion rate, ratings
- [ ] Travel time estimation between jobs
- [ ] Demand heatmap by postcode by day of week
- [ ] Automatic contractor notification pipeline
- [ ] Fill-Up Pack presentation — "Your day: 4 jobs, £165, all NG9"

### How dispatch changes:
- System builds clusters automatically each evening
- Suggests optimal contractor + route per cluster
- Dispatcher is now quality-checking, not building from scratch
- Edge cases and complex jobs still get manual attention
- Contractors can see their upcoming week in a simple portal

### Data captured (feeding Stage 4):
- Actual travel time between postcodes
- Actual job duration vs estimate
- Contractor acceptance rate by postcode distance
- Customer NPS by scheduling speed
- Demand patterns by day of week, postcode, category

### Team required:
- 1-2 dispatchers
- 8-12 contractors
- Part-time ops manager

### Trigger to move to Stage 4:
- Hitting 100+ jobs/week
- Expanding to second city
- Dispatcher time still the bottleneck

---

## Stage 4: Automated Dispatch (100+ jobs/week)

### What to build:
- [ ] Full routing algorithm — minimise total travel time across all contractors
- [ ] Multi-city support — separate postcode maps per city
- [ ] Automated contractor matching — skills + location + capacity + history
- [ ] Predictive demand — forecast jobs by area based on historical data
- [ ] Dynamic pricing integration — increase prices in high-demand areas/times
- [ ] Weekly pack builder — auto-generate contractor week plans
- [ ] Contractor self-serve scheduling — pick up available packs
- [ ] Real-time job tracking — en-route, started, completed

### How dispatch changes:
- System handles 90% of routing automatically
- Human dispatcher handles exceptions and complex jobs
- Contractors see their week plan Sunday evening
- New cities can launch with the same playbook
- Data flywheel: more jobs → better predictions → better routing → happier contractors

### Team per city:
- 0.5 dispatcher (shared across cities)
- 15+ contractors
- Tech handles the rest

---

## Key Principles (All Stages)

1. **Per-task payment always.** Never buy time. Revenue share keeps incentives aligned.
2. **Routing is the product.** A well-routed day is worth more to a contractor than a higher percentage.
3. **Confirm fast.** Customer picks 3 dates → confirm within 24hrs. Speed = trust.
4. **Capture data even if you don't use it yet.** Travel times, actual durations, acceptance rates.
5. **Recruit by postcode, not by city.** You need a contractor in NG9, not "in Nottingham."
6. **Manual first, automate second.** The human dispatcher teaches you what the algorithm should do.

---

## Recruitment Levers (Priority Order)

| Lever | Impact | Cost | When |
|-------|--------|------|------|
| Same-day payment | Massive — #1 draw | Cash flow | Stage 1 |
| Routed days (3-5 jobs) | High — effective rate boost | Built into planner | Stage 1 |
| No admin burden | High — they just turn up | Already built | Stage 1 |
| Guaranteed minimum days/week | Medium — reduces their risk | Platform eats downside | Stage 2 |
| Branded materials/van | Medium — social proof | Marketing cost | Stage 3 |
| Materials trade account | Medium — they don't front costs | Working capital | Stage 2 |
| Performance bonuses | Low-Medium — on-time streaks | Margin cost | Stage 3 |

---

## City Launch Playbook (Stage 3+)

1. Seed demand: Run ads, generate 20-30 quotes in target city
2. Map clusters: Which postcodes are requests coming from?
3. Recruit 2-3 contractors: One per major cluster
4. Run 3-date buffer model with manual dispatch
5. Measure: If contractor effective rate hits £22+/hr within 4 weeks, city is viable
6. Scale: Add demand in postcodes where you have contractors first
7. Expand: New postcodes only when you recruit a contractor for them

**Required per city:** 1 part-time dispatcher, 2-3 contractors, ~40 jobs/month minimum
**NOT required:** Local office, new software, different pricing model

---

## Critical Metrics Dashboard (Build at Stage 2)

| Metric | Target | Why it matters |
|--------|--------|---------------|
| Contractor effective hourly rate | £22+/hr | Below £18 = churn risk |
| Jobs per contractor per day | 3-5 | Below 2 = bad routing |
| Date confirmation time | <24hrs | Slow = lost trust |
| Contractor day fill rate | 70%+ | Below 50% = demand gap |
| Platform margin after contractor pay | 45-55% | Below 35% = pricing issue |
| Contractor 30-day retention | 80%+ | Below 60% = model problem |
| Customer rebook rate | 25%+ | Proves service quality |
| Postcode coverage | 80%+ of demand areas | Gaps = slow scheduling |
