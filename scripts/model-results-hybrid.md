# Hybrid Model Analysis: Day Rate + Revenue Share

**V6 Handy Services, Nottingham UK**
**Date:** 12 April 2026
**Dataset:** 100 real Nottingham jobs

---

## Executive Summary

- **The hybrid model at £160/day UNDERPERFORMS pure revenue share by 5 margin points (48.2% vs 53.2%) at every volume tested.** At £160/day and an average customer labour charge of £40/hr, the day-rate component costs £23.53/productive hour vs rev-share's effective £19.31/hr -- the day rate is simply too expensive relative to the revenue it generates.
- **Breakeven day rate is ~£129/day.** Below this threshold, hybrid starts to outperform. Alternatively, if customer prices were raised to ~£52/hr for general/outdoor work, the current £160/day would become competitive.
- **A "smart hybrid" restricting day-rate to only sub-60-minute jobs shows a marginal 0.5pp advantage** (53.7% vs 53.2%), but the tiny savings (~£63/month on 100 jobs) do not justify the operational complexity of running two contractor payment models.

---

## Job Split: Day-Rate vs Revenue Share

### Dataset Composition (100 jobs)

| Category Type | Jobs | % | Total Revenue | Total Labour | Avg Mins/Job | Avg Labour/Hr |
|---|---|---|---|---|---|---|
| **General (day-rate eligible)** | 39 | 39% | £3,360 | £2,988 | 108 min | £42.16/hr |
| **Outdoor (day-rate eligible)** | 20 | 20% | £2,105 | £1,831 | 156 min | £35.26/hr |
| **Specialist (rev-share only)** | 21 | 21% | £2,925 | £2,525 | 132 min | £48.73/hr |
| **Skilled (rev-share only)** | 20 | 20% | £2,840 | £2,010 | 168 min | £35.89/hr |
| **TOTAL** | **100** | | **£11,230** | **£9,354** | **138 min** | **£40.70/hr** |

### Category Detail

**Day-Rate Eligible (59 jobs, 59% of volume):**
- general_fixing: 13 jobs (750 min, £760)
- painting: 6 jobs (1,800 min, £1,250) -- note: these are LONG jobs
- flat_pack: 5 jobs (540 min, £380)
- tv_mounting: 5 jobs (390 min, £435)
- garden_maintenance: 5 jobs (1,020 min, £540)
- shelving: 3 jobs, curtain_blinds: 3 jobs, waste_removal: 3 jobs
- pressure_washing: 3 jobs, guttering: 3 jobs, fencing: 3 jobs
- flooring: 3 jobs, silicone_sealant: 2 jobs, furniture_repair: 2 jobs

**Revenue Share Only (41 jobs, 41% of volume):**
- plumbing_minor: 9 jobs (465 min, £665)
- electrical_minor: 7 jobs (480 min, £670)
- carpentry: 6 jobs (1,080 min, £900)
- tiling: 5 jobs (900 min, £700)
- door_fitting: 4 jobs (720 min, £610)
- bathroom_fitting: 3 jobs (1,800 min, £1,220)
- plastering: 3 jobs (570 min, £460)
- kitchen_fitting: 2 jobs (420 min, £370)
- lock_change: 2 jobs (105 min, £170)

---

## Hybrid Model P&L at Scale

### Assumptions

| Parameter | Value |
|---|---|
| Day rate | £160/day (8 hrs) |
| Effective productive time | 6.8 hrs/day (8 hrs x 85% after 15% travel) |
| Fill rate | 80% target (actual packing achieves ~98% on full days) |
| Specialist rev share | 55% of labour, floor £28/hr |
| Skilled rev share | 50% of labour, floor £22/hr |
| Overflow (Gen/Outdoor) rev share | 45% of labour, floor £18/hr (Gen) or £16/hr (Outdoor) |
| Working days/month | 22 |

### Combined P&L

| Metric | 20 jobs/mo | 50 jobs/mo | 100 jobs/mo | 200 jobs/mo |
|---|---|---|---|---|
| **Jobs: Day-rate** | 12 | 30 | 59 | 118 |
| **Jobs: Rev-share** | 8 | 20 | 41 | 82 |
| **Jobs: Overflow** | 0 | 0 | 0 | 2 |
| | | | | |
| **Revenue: Day-rate side** | £1,112 (50%) | £2,779 (50%) | £5,465 (49%) | £10,930 (49%) |
| **Revenue: Rev-share side** | £1,125 (50%) | £2,812 (50%) | £5,765 (51%) | £11,530 (51%) |
| **Total Revenue** | **£2,237** | **£5,592** | **£11,230** | **£22,460** |
| | | | | |
| **Day-rate cost** | £640 (4 days) | £1,440 (9 days) | £2,880 (18 days) | £5,600 (35 days) |
| **Rev-share cost** | £571 | £1,428 | £2,936 | £5,950 |
| **Total Contractor Cost** | **£1,211** | **£2,868** | **£5,816** | **£11,550** |
| | | | | |
| **Gross Profit** | **£1,025** | **£2,723** | **£5,414** | **£10,910** |
| **Gross Margin** | **45.8%** | **48.7%** | **48.2%** | **48.6%** |
| | | | | |
| Owner salary | £2,500 | £2,500 | £2,500 | £2,500 |
| Ben (base + 5% comm) | £612 | £780 | £1,062 | £1,623 |
| Fixed costs | £500 | £500 | £500 | £500 |
| **Total Overheads** | **£3,612** | **£3,780** | **£4,062** | **£4,623** |
| | | | | |
| **NET Profit** | **-£2,587** | **-£1,056** | **£1,353** | **£6,287** |
| **Annual NET** | **-£31,038** | **-£12,676** | **£16,235** | **£75,445** |
| | | | | |
| Day-rate contractors needed | 1 | 1 | 1 | 2 |
| Rev-share contractors on call | 1 | 2 | 4 | 7 |

### Margin Breakdown by Side

| Volume | Day-Rate Margin | Rev-Share Margin | Blended |
|---|---|---|---|
| 20 jobs | 42.4% | 49.1% | 45.8% |
| 50 jobs | 48.2% | 49.1% | 48.7% |
| 100 jobs | 47.3% | 49.1% | 48.2% |
| 200 jobs | 48.8% | 48.4% | 48.6% |

The day-rate side consistently produces LOWER margins than the rev-share side at these price levels.

---

## Side-by-Side: Hybrid vs Pure Revenue Share

| Metric | 20 jobs | 50 jobs | 100 jobs | 200 jobs |
|---|---|---|---|---|
| **Hybrid contractor cost** | £1,211 | £2,868 | £5,816 | £11,550 |
| **Pure RS contractor cost** | £1,045 | £2,613 | £5,258 | £10,516 |
| **Hybrid gross margin** | 45.8% | 48.7% | 48.2% | 48.6% |
| **Pure RS gross margin** | 53.3% | 53.3% | 53.2% | 53.2% |
| **Margin difference** | -7.5pp | -4.5pp | -5.0pp | -4.6pp |
| **Hybrid NET** | -£2,587 | -£1,056 | £1,353 | £6,287 |
| **Pure RS NET** | -£2,419 | -£797 | £1,911 | £7,321 |
| **Hybrid annual NET** | -£31,038 | -£12,676 | £16,235 | £75,445 |
| **Pure RS annual NET** | -£29,025 | -£9,566 | £22,927 | £87,854 |
| **Hybrid "savings"** | **-£168/mo** | **-£259/mo** | **-£558/mo** | **-£1,034/mo** |

**Pure revenue share outperforms hybrid at every volume tested.**

The hybrid model costs £558/mo MORE at 100 jobs and £1,034/mo MORE at 200 jobs. The gap widens with scale because you're locking in more day-rate days at a higher effective cost.

---

## Why the Hybrid Fails at Current Pricing

### The Core Math Problem

| Factor | Value |
|---|---|
| Day-rate effective cost per productive hour | **£23.53** |
| Rev-share effective cost per productive hour (General/Outdoor) | **£19.31** |
| Average customer labour charge (General/Outdoor) | **£40.07/hr** |
| Rev-share % (overflow) | 45% |
| Rev-share cost at avg charge | 45% x £40.07 = **£18.03/hr** |

The day-rate contractor costs £23.53/productive hour (£160 / 6.8 hrs). The rev-share overflow contractor costs only £18.03/hr at 45% of the average £40/hr labour charge. The day-rate is **30% more expensive per productive hour**.

### When Day-Rate Wins vs Loses (Per Job)

Day-rate wins on **short, low-value jobs** where the proportional time cost (mins/408 x £160) is less than the rev-share percentage:

| Job Type | Example | DR Effective | RS Cost | Winner |
|---|---|---|---|---|
| Quick fix (30 min) | Fix cupboard handles | £12 | £18 | **Day-rate** |
| Medium fix (45 min) | Repair skirting board | £18 | £22 | **Day-rate** |
| Half-day (120 min) | Flat-pack wardrobe | £47 | £38 | Rev-share |
| Full-day painting (480 min) | Paint living room | £188 | £144 | Rev-share |

But the **long jobs dominate the time** -- painting (1,800 min), garden work (1,020 min), flooring (600 min) -- so the day-rate disadvantage on big jobs outweighs the advantage on small ones.

### Breakeven Thresholds

| Lever | Breakeven Point | Current Value | Gap |
|---|---|---|---|
| Day rate | **£129/day** | £160/day | £31 too high |
| Customer hourly charge | **£52.29/hr** | £40.07/hr | £12.22 too low |
| Job duration threshold (smart hybrid) | **Under 60 min only** | All Gen/Outdoor | Very limited scope |

---

## "Smart Hybrid" Analysis: Day-Rate Only for Short Jobs

If we restrict day-rate to only sub-60-minute jobs:

| Approach | Jobs on DR | DR Days | Total Cost | Margin | vs Pure RS |
|---|---|---|---|---|---|
| All Gen/Outdoor on DR | 59 | 18 | £5,816 | 48.2% | -5.0pp |
| Only ≤60 min on DR | 25 | 3 | £5,195 | **53.7%** | **+0.5pp** |
| Only ≤90 min on DR | 31 | 5 | £5,329 | 52.5% | -0.7pp |
| Only ≤120 min on DR | 42 | 8 | £5,414 | 51.8% | -1.4pp |
| Pure rev-share | 0 | 0 | £5,258 | 53.2% | baseline |

The **only winning configuration** packs just the sub-60-minute jobs (25 of 59 eligible) into 3 day-rate days, saving ~£63/month vs pure rev-share. That is a 0.5pp margin improvement for significant operational complexity.

---

## Operational Complexity Analysis

| Volume | Scheduling Decisions/Week | Day-Rate Tetris | RS Dispatch | Complexity Score |
|---|---|---|---|---|
| 20 jobs | ~5 | Pack 12 jobs into 4 days | 8 individual dispatches | **Medium** |
| 50 jobs | ~12 | Pack 30 jobs into 9 days | 20 individual dispatches | **High** |
| 100 jobs | ~23 | Pack 59 jobs into 18 days | 41 individual dispatches | **Very High** |
| 200 jobs | ~46 | Pack 118 jobs into 35 days | 82 individual dispatches | **Extreme** |

### Hybrid-Specific Complexity Costs

1. **Day-rate Tetris problem**: Fitting variable-length jobs into 6.8-hour blocks requires route optimization and customer scheduling coordination. This is a non-trivial operations problem.
2. **Two payment systems**: Must track day-rate time sheets AND rev-share per-job payments. Two contractor onboarding flows. Two dispute resolution processes.
3. **Overflow routing decisions**: When a day isn't full, do you hold for more jobs (risking idle time) or overflow to rev-share (losing the day-rate "savings")? This creates a daily judgment call.
4. **Contractor type management**: Day-rate contractors expect guaranteed days. If volume dips, you're either paying for idle days or breaking commitments.

### Pure Rev-Share Complexity

- Simple: each job dispatched individually
- No packing/scheduling optimization needed
- One payment model
- Scale up/down instantly
- ~5 decisions/week at 20 jobs, ~23/week at 100 jobs (same volume, simpler decisions)

---

## Break-Even and Scaling Analysis

### Hybrid Break-Even (Monthly NET = 0)

| Model | Break-Even Volume |
|---|---|
| Hybrid (£160/day) | ~82 jobs/month |
| Pure Rev-Share | ~74 jobs/month |

Pure rev-share reaches profitability **8 jobs sooner** because of higher gross margins.

### Annual NET Comparison at Scale

| Volume | Hybrid Annual | Pure RS Annual | RS Advantage |
|---|---|---|---|
| 50 jobs | -£12,676 | -£9,566 | £3,110/yr |
| 100 jobs | £16,235 | £22,927 | £6,692/yr |
| 150 jobs | ~£46,000 | ~£55,000 | ~£9,000/yr |
| 200 jobs | £75,445 | £87,854 | £12,409/yr |

The gap **widens with scale**. At 200 jobs/month, you're leaving £12,409/year on the table with the hybrid model.

### What Would Make Hybrid Work?

1. **Lower day rate to £125-129/day**: At this rate, the day-rate component breaks even with rev-share. Below £125, it starts generating real savings. But Nottingham market rate for a general handyman is £30-48/hr -- paying £125/day (£18.38/hr effective) may not attract quality contractors.

2. **Raise customer prices to £50+/hr for General/Outdoor**: If your hourly charge exceeds £52.29/hr, the 45% rev-share cut exceeds the day-rate cost per hour. But Nottingham market won't bear £52/hr for basic fixing work.

3. **Restrict to micro-jobs only**: Only use day-rate for sub-60-minute jobs, achieving marginal savings. But this limits the model to 25% of eligible jobs and saves only ~£63/month.

4. **Dramatically improve fill rate and reduce travel**: If you could achieve 100% utilization with 0% travel overhead (theoretical maximum), cost drops to £20/hr -- still not competitive with the 45% rev-share at £40/hr charges (which costs £18/hr).

---

## Risks and Considerations

### Hybrid Model Risks

| Risk | Impact | Likelihood |
|---|---|---|
| **Underutilized day-rate days** | Pay £160 for partial day | High at <50 jobs/mo |
| **Contractor commitment obligations** | Must guarantee days even in slow weeks | Medium |
| **Scheduling rigidity** | Customer must accept time slots that fit the Tetris | High |
| **Operational overhead** | Owner/Ben time spent on packing optimization | Ongoing |
| **Volume volatility** | Day-rate cost is fixed; revenue is variable | High for new market |

### Pure Rev-Share Risks

| Risk | Impact | Likelihood |
|---|---|---|
| **Contractor availability** | No guaranteed capacity | Medium |
| **Higher per-unit cost at scale** | 45-55% goes to contractor always | Low (this IS the model) |
| **Contractor churn** | No income guarantee = less loyalty | Medium |
| **Price undercutting** | Contractors may go direct to customers | Medium |

### Key Insight: The Hybrid's Supposed Advantage Doesn't Exist Here

The traditional argument for day-rate is: "lock in a cheaper daily rate and fill the day with high-value jobs." This works when:
- Customer prices are HIGH relative to the day rate (e.g., London at £60-80/hr)
- Jobs are SHORT and packable (many 30-45 min jobs)
- Rev-share percentages are HIGH (60%+)

In Nottingham, with £40/hr average charges and 45% rev-share, the math doesn't work. The rev-share rate is already cheap enough that day-rate provides no advantage.

---

## Verdict

### At what volume does the hybrid start outperforming pure rev share?

**Never, at current pricing and day-rate levels.** The hybrid model underperforms pure rev-share at every volume from 10 to 200+ jobs/month. The gap widens with scale.

The ONLY scenario where hybrid marginally wins (+0.5pp) is the "smart hybrid" that restricts day-rate to sub-60-minute jobs only, saving ~£63/month -- not worth the complexity.

### When would hybrid make sense?

1. If day rates could be negotiated to **£125/day or below**
2. If customer prices were raised to **£50+/hr** for general/outdoor work
3. In a **higher-cost market** (London, Bristol) where customer charges naturally exceed £50/hr
4. If you had a **very high proportion of short jobs** (70%+ under 60 min) that pack efficiently

---

## Playbook Recommendation

### For Nottingham (and similar mid-market cities):

**Start with pure revenue share. Do not implement the hybrid model.**

- Gross margin: 53.2% vs 48.2% (hybrid)
- Simpler operations, one payment model
- Scale up/down instantly with no contractor commitment risk
- Break-even at ~74 jobs/month

### For a new city launch:

| City Tier | Customer Rate | Recommendation | Reason |
|---|---|---|---|
| **Tier 1** (London, SE) | £50-80/hr | Consider hybrid at £160-180/day | Math works at higher customer prices |
| **Tier 2** (Manchester, Bristol) | £40-55/hr | Test hybrid, likely marginal | Borderline -- run the numbers |
| **Tier 3** (Nottingham, Leicester) | £30-45/hr | Pure rev-share | Day-rate too expensive relative to revenue |

### Recommended Revenue Share Tiers (confirmed):

| Tier | % of Labour | Floor Rate | Categories |
|---|---|---|---|
| Specialist | 55% | £28/hr | electrical, plumbing, bathroom, kitchen |
| Skilled | 50% | £22/hr | carpentry, tiling, plastering, locks, doors |
| General | 45% | £18/hr | fixing, shelving, flat-pack, TV, curtains, painting, sealant, furniture |
| Outdoor | 45% | £16/hr | garden, waste, pressure wash, guttering, fencing, flooring |

### When to Revisit Hybrid:

- When Nottingham customer prices naturally rise above £50/hr (inflation, brand premium)
- When you have 150+ jobs/month and can negotiate day rates below £130/day with volume guarantees
- When you expand to London/SE where the economics flip

---

## Appendix: Day-Rate Packing Detail (100-Job Dataset)

18 days needed for 59 day-rate eligible jobs. Bin-packing achieved 98.2% average utilization (well above the 80% assumption).

Notable: several painting jobs (480 min, 360 min) consume entire days on their own, which is the worst-case scenario for day-rate -- you're paying £160 for a single job that would cost £108-144 at rev-share rates.

The high utilization actually makes the result MORE definitive: even with near-perfect packing, day-rate still loses. The problem isn't fill rate -- it's that £160/day for 6.8 productive hours is simply more expensive than 45% of a £40/hr labour charge.
