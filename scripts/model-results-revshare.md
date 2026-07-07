# Revenue Share Model Analysis: V6 Handy Services

**Model**: Tiered Revenue Share (Per-Job)  
**Dataset**: 100 real Nottingham jobs  
**Date**: 12 April 2026

---

## Executive Summary

- **The model breaks even at ~97 jobs/month.** Below that volume, overheads (owner salary, Ben, software/insurance) exceed platform gross profit. At 100 jobs/month you net just ~£132/month; real profitability starts at ~150+ jobs/month.
- **Average platform margin is 36.5% on customer price**, but this varies wildly by tier: General/Outdoor categories yield 43-47% margin, while Specialist jobs (especially bathroom fitting) yield as low as 1-22% because the 55% contractor share and £28/hr floor eat most of the labour revenue.
- **The floor rate kicks in on 36% of jobs**, predominantly in Skilled and Outdoor tiers on longer-duration work. This protects contractors but compresses platform margin on exactly the jobs that take the most time.

---

## Per-Tier Breakdown

| Tier | Rate | Floor | Jobs | Total Labour | Contractor Pay | Platform Keeps | Margin % | Avg Eff. Hourly | Floor Triggered |
|------|------|-------|------|-------------|---------------|----------------|----------|-----------------|-----------------|
| **Specialist** | 55% | £28/hr | 21 | £2,287.00 | £1,653.10 | £633.90 | 21.7% | £31.34 | 5/21 (24%) |
| **Skilled** | 50% | £22/hr | 20 | £2,252.00 | £1,282.50 | £969.50 | 34.1% | £22.80 | 12/20 (60%) |
| **General** | 45% | £18/hr | 39 | £2,999.00 | £1,419.30 | £1,579.70 | 47.0% | £21.26 | 7/39 (18%) |
| **Outdoor** | 45% | £16/hr | 20 | £1,820.00 | £903.00 | £917.00 | 43.6% | £16.88 | 12/20 (60%) |
| **TOTAL** | -- | -- | **100** | **£9,358.00** | **£5,257.90** | **£4,100.10** | **36.5%** | **£22.94** | **36/100** |

### Key Observations by Tier

- **General is the profit engine**: 39 jobs, 47% margin, £1,580 platform keeps. High-volume, short-duration jobs with good pricing power.
- **Skilled has heavy floor usage**: 60% of jobs trigger the floor. Long carpentry/tiling jobs at £22/hr floor compress margins.
- **Specialist pays contractors well** (avg £31.34/hr effective) but leaves only 21.7% margin for the platform.
- **Outdoor floor triggers frequently** (60%) on fencing/flooring, but the £16/hr floor is low enough to still leave decent margin overall.

---

## Volume Scaling

| Metric | 20 jobs/mo | 50 jobs/mo | 100 jobs/mo | 200 jobs/mo |
|--------|-----------|-----------|------------|------------|
| Monthly revenue (customer pays) | £2,246 | £5,615 | £11,230 | £22,460 |
| Monthly contractor cost | £1,052 | £2,629 | £5,258 | £10,516 |
| Monthly platform gross profit | £820 | £2,050 | £4,100 | £8,200 |
| **Overheads breakdown:** | | | | |
| - Owner salary | £2,500 | £2,500 | £2,500 | £2,500 |
| - Ben base pay | £500 | £500 | £500 | £500 |
| - Ben 5% commission on labour | £94 | £234 | £468 | £936 |
| - Software / insurance | £500 | £500 | £500 | £500 |
| **Total overheads** | **£3,594** | **£3,734** | **£3,968** | **£4,436** |
| **Monthly NET profit** | **-£2,774** | **-£1,684** | **£132** | **£3,764** |
| **Annual NET profit** | **-£33,283** | **-£20,207** | **£1,586** | **£45,173** |
| Contractors needed (6 jobs/day, 22 days) | 1 | 1 | 1 | 2 |
| Contractor utilisation | 15% | 38% | 76% | 76% |

### Break-Even Point

| Metric | Value |
|--------|-------|
| Avg platform gross per job | £41.00 |
| Less: Ben's 5% commission per job | £4.68 |
| Net platform per job after commission | £36.32 |
| Fixed monthly overheads | £3,500 |
| **Break-even** | **97 jobs/month** |

---

## Top 5 Most Profitable Categories (for Platform)

Ranked by margin % on customer price:

| Rank | Category | Tier | Jobs | Margin % | Avg Platform/Job | Why |
|------|----------|------|------|----------|-----------------|-----|
| 1 | **Flat pack** | General | 5 | 55.0% | £41.80 | Zero materials, 45% share, no floor triggers |
| 2 | **Curtain/blinds** | General | 3 | 55.0% | £30.25 | Zero materials, short jobs, good pricing |
| 3 | **Waste removal** | Outdoor | 3 | 55.0% | £52.25 | Zero materials, low floor (£16/hr), high prices |
| 4 | **Pressure washing** | Outdoor | 3 | 53.7% | £42.08 | Zero materials, low floor |
| 5 | **Silicone/sealant** | General | 2 | 51.6% | £20.62 | Quick jobs, minimal materials |

**Pattern**: Zero-material, short-to-medium duration General/Outdoor jobs are the most profitable. These are the jobs to market aggressively.

---

## Top 5 Least Profitable Categories (for Platform)

| Rank | Category | Tier | Jobs | Margin % | Avg Platform/Job | Why |
|------|----------|------|------|----------|-----------------|-----|
| 1 | **Bathroom fitting** | Specialist | 3 | 1.2% | £5.00 | 55% share + £28/hr floor on long jobs (24hr full refit!) |
| 2 | **Carpentry** | Skilled | 6 | 29.7% | £44.58 | Long duration, floor triggers 4/6 times |
| 3 | **Tiling** | Skilled | 5 | 30.0% | £42.00 | Floor triggers every single time (5/5) |
| 4 | **Kitchen fitting** | Specialist | 2 | 30.8% | £57.00 | 55% share + floor on long installs |
| 5 | **Lock change** | Skilled | 2 | 33.8% | £28.75 | High material cost (locks), 50% share |

**Pattern**: Specialist tier (55% share + £28/hr floor) and long-duration Skilled jobs are margin killers. Bathroom fitting at 1.2% margin is essentially a loss-leader after overhead allocation.

---

## Detailed Per-Category Table

| Category | Tier | Jobs | Margin % | Total Platform | Avg Platform/Job | Avg Contractor Hourly | Floor Count |
|----------|------|------|----------|---------------|-----------------|----------------------|-------------|
| flat_pack | General | 5 | 55.0% | £209.00 | £41.80 | £19.00 | 0/5 |
| curtain_blinds | General | 3 | 55.0% | £90.75 | £30.25 | £27.00 | 0/3 |
| waste_removal | Outdoor | 3 | 55.0% | £156.75 | £52.25 | £19.73 | 0/3 |
| pressure_washing | Outdoor | 3 | 53.7% | £126.25 | £42.08 | £16.73 | 1/3 |
| silicone_sealant | General | 2 | 51.6% | £41.25 | £20.62 | £27.00 | 0/2 |
| furniture_repair | General | 2 | 51.6% | £41.25 | £20.62 | £33.75 | 0/2 |
| general_fixing | General | 13 | 51.0% | £387.65 | £29.82 | £26.03 | 1/13 |
| guttering | Outdoor | 3 | 48.4% | £104.00 | £34.67 | £19.11 | 1/3 |
| garden_maintenance | Outdoor | 5 | 45.2% | £244.00 | £48.80 | £16.24 | 4/5 |
| plastering | Skilled | 3 | 43.3% | £199.00 | £66.33 | £22.42 | 1/3 |
| tv_mounting | General | 5 | 43.0% | £187.00 | £37.40 | £23.54 | 0/5 |
| painting | General | 6 | 42.8% | £535.50 | £89.25 | £18.15 | 5/6 |
| shelving | General | 3 | 41.6% | £87.30 | £29.10 | £22.32 | 1/3 |
| door_fitting | Skilled | 4 | 38.6% | £235.50 | £58.88 | £23.29 | 2/4 |
| plumbing_minor | Specialist | 9 | 38.3% | £254.70 | £28.30 | £40.17 | 0/9 |
| electrical_minor | Specialist | 7 | 37.3% | £250.20 | £35.74 | £38.23 | 0/7 |
| fencing | Outdoor | 3 | 34.8% | £146.00 | £48.67 | £16.00 | 3/3 |
| flooring | Outdoor | 3 | 34.1% | £140.00 | £46.67 | £16.00 | 3/3 |
| lock_change | Skilled | 2 | 33.8% | £57.50 | £28.75 | £32.86 | 0/2 |
| kitchen_fitting | Specialist | 2 | 30.8% | £114.00 | £57.00 | £28.00 | 2/2 |
| tiling | Skilled | 5 | 30.0% | £210.00 | £42.00 | £22.00 | 5/5 |
| carpentry | Skilled | 6 | 29.7% | £267.50 | £44.58 | £22.36 | 4/6 |
| bathroom_fitting | Specialist | 3 | 1.2% | £15.00 | £5.00 | £28.00 | 3/3 |

---

## Risks and Considerations

### 1. Bathroom Fitting is a Margin Black Hole
At 1.2% margin, the platform makes £5 per job on average. The full bathroom refit (1,440 mins / 24 hours) pays the contractor £672 on a £600 labour price because the £28/hr floor kicks in. The platform actually **loses £72** on that single job. Consider: capping floor pay at X hours, or pricing bathroom refits higher.

### 2. Floor Rate Triggers Too Often in Skilled Tier
60% of Skilled jobs trigger the floor, meaning the revenue share percentage is effectively irrelevant for most carpentry, tiling, and long trade jobs. The £22/hr floor is protecting contractors but the 50% share rarely applies. Either the prices need to go up or the floor needs to come down.

### 3. Ben's Commission is Volume-Sensitive
At 5% of labour, Ben's commission scales linearly. At 200 jobs/month, it's £936/month -- nearly as much as his base pay. This is fine if he's genuinely driving that volume, but if jobs come organically, it's an expensive fixed variable cost.

### 4. Contractor Utilisation Risk
At 100 jobs/month, one contractor at 76% utilisation is tight. One sick day or van breakdown and you're missing jobs. At 200 jobs/month with 2 contractors at 76%, there's no slack. Real-world utilisation should target 60-70% to account for travel, no-shows, and complexity overruns.

### 5. Materials Pass-Through Assumption
This model assumes materials are passed through at cost. If contractors mark up materials (common in trades), the labour price calculation may be optimistic. Verify that `materialsPence` in the dataset reflects actual cost, not customer-facing material charges.

### 6. Average Job Duration is 2.3 Hours
At 229 total hours across 100 jobs (avg 2.3 hrs/job), the "6 jobs per day" assumption is tight. 6 x 2.3 = 13.8 hours of work, before travel. Realistically 4-5 jobs/day may be more accurate, which would push contractor needs up and break-even higher.

---

## Verdict: When Does This Model Work Best?

| Volume | Verdict |
|--------|---------|
| **20 jobs/mo** | Unviable. Losing ~£2,800/month. Not even close. |
| **50 jobs/mo** | Still losing ~£1,700/month. Owner salary must be deferred or reduced. |
| **97 jobs/mo** | **Break-even point.** Just covering costs, no profit. |
| **100 jobs/mo** | Barely profitable at £132/month. One bad month wipes it out. |
| **150 jobs/mo** | ~£1,950/month net profit. Starting to make sense. |
| **200 jobs/mo** | £3,764/month net (£45k/year). First viable "business" level. |

### The Sweet Spot: 150-200 jobs/month

This model needs **volume to work**. The fixed overhead base (£3,500/month before Ben's commission) is high relative to the £41 average gross profit per job. The model rewards:

1. **High-volume General/Outdoor categories** (flat pack, fixing, waste removal, pressure washing) -- market these hard
2. **Short-duration jobs** where the floor doesn't trigger
3. **Zero-material jobs** where the full customer price is labour

**To accelerate to profitability**, consider:
- Reducing owner salary draw until 150+ jobs/month is sustained
- Pricing Specialist tier jobs higher (especially bathroom fitting) to maintain margin above the floor
- Capping floor-rate pay at a maximum number of hours per job (e.g., 8 hours)
- Reviewing whether 55% Specialist share is sustainable -- 50% with a £28 floor might work better
- Focusing marketing on the "profitable 5" categories listed above

---

*Generated from 100-job Nottingham dataset. All prices in GBP. Pence converted to pounds for display.*
