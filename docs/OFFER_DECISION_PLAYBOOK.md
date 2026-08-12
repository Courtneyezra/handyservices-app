# Offer Decision Playbook — v1 (LOCKED 12 Aug 2026)

**Status: policy locked with owner, 12 Aug 2026 — not yet wired into code.**
Build order locked: spine first (router + decision log + Ben's builder view);
missing plays log as unmet intent, build queue then comes from the log. This document is the
canonical spec the offer router builds against. The decision tree is never
drawn or enumerated: it is *generated* from the three sections below —
variables × rules (with precedence) × guardrails. Change the behaviour of the
system by editing this file (human-reviewed, like a pricing change), never by
silent drift.

Related context: council review 12 Aug 2026 (rules-first spine, LLM as shadow
challenger, not decider). Conversion definition: `deposit_paid_at` on viewed
quotes. Test/dummy quotes are scrubbed before any evidence aggregation.

---

## 1. Variables (the dimensions)

| Variable | Values | Source | Exists today? |
|---|---|---|---|
| `moment` | `first_view` \| `stalled` \| `declined` \| `expired` \| `job_done` | derived from quote events | partially — only `first_view` + `expired` have triggers |
| `customerType` | `homeowner` \| `oap_homeowner` \| `landlord` \| `property_manager` \| `tenant` \| `business` \| `letting_agent` | `contextSignals.customerType` (builder enum) | ✅ |
| `priceBand` | `under_100` \| `100_200` \| `200_1000` \| `1000_2500` \| `over_2500` | derived from quote total pence | trivial fn (band edge at £200 deliberately matches `welcomeGiftMinQuotePence`) |
| `stakes` | `low` \| `med` \| `high` | **NEW** — v0 deterministic proxy: `high` if `surveyRequired` OR any line in a risk trade (active leak / electrical / structural / roofing); else `med` if total ≥ £500; else `low`. Later: LLM classifier over transcript/VA notes (shadow first) | ❌ build |
| `firstTime` | `true` \| `false` | **NEW** — phone/email match against prior quotes with `deposit_paid_at` | ❌ build |
| `marginOk` | `true` \| `false` | `computeContractorPay` pnl on this quote | ✅ (quote-accuracy work) |
| Pass-throughs | `vertical`, skin (solo/team), `surveyRequired` | generation payload | ✅ — variants read these; rules mostly ignore them |

~1,050 theoretical situations; traffic visits ≈50–100. Rules below are
wildcards (each reads 2–3 variables) so ~15 cover the space.

## 2. Play inventory (the whitelist)

The router may ONLY output plays from this table. `none` is always legal.

| Play id | What it is | Goal served | Status |
|---|---|---|---|
| `welcome_gift` | free small task (addonMenu ≤ `welcomeGiftMaxMinutes`), first job | deposit now | ✅ built (`welcome_gift_v1`) |
| `bundle_up` | add-task menu, "Craig's already coming" | raise basket | 🟡 add_task built, not targeted |
| `risk_removal` | guarantee + photo proof + assumptions front-and-centre, survey option | build trust | ❌ not built |
| `visit_first` | paid survey / site-visit CTA replaces book-now | visit booked | 🟡 survey-gate exists (admin toggle), not a play |
| `quote_split` | "choose what to do now" line-item deferral | smaller yes | 🟡 lab page only |
| `partner` | PM/agent relationship offer (priority response, account terms) | relationship | 🟡 copy only, not bookable |
| `forward_pack` | tenant → landlord approval pack (PDF + forward flow) | owner approval | 🟡 PDF exists |
| `loyalty` | repeat-customer priority / credit | deposit now | ❌ not built |
| `terms_compliance` | business: invoiced terms + RAMS/compliance pack | account terms | ❌ not built |
| `nudge` | stalled-viewer WhatsApp re-engagement | re-engage | ❌ not built |
| `post_job_upsell` | partner enrol / next-job credit / review→gift | repeat + referral | ❌ not built |
| `none` | straight to price, no interstitial | — | ✅ (trivially) |

**Unbuilt-play rule:** when a rule selects a play that isn't built, the router
logs `targetPlay` (the intent) and serves the fallback (`servedPlay`, usually
`none`). The decision log therefore measures demand for missing plays *before
they're built* — the build queue comes from logged unmet intents, not opinion.

## 3. Guardrails — precedence 0, always win, never overridable

- **G1** `surveyRequired = true` → no job-booking play; `visit_first` route only (server already 409s money paths).
- **G2** expired quote → reissue gate only (existing flow untouched).
- **G3** `welcome_gift` requires: `firstTime = true` AND total ≥ `welcomeGiftMinQuotePence` (£200) AND gift pool non-empty (≤ `welcomeGiftMaxMinutes`). Server-enforced, as today.
- **G4** output must be in the play inventory; anything else → `none`.
- **G5** a per-customer-type offer group explicitly disabled in `quoteOffers.perCustomerType` stays suppressed.
- **G6** `flex_date` is retired — never emitted, including from stale DB config.
- **G7** `marginOk = false` → no giveaway plays (`welcome_gift`, `bundle_up` discounts); `none` or trust plays only.

## 4. Rules — first match wins within a tier; lower tier only if no match

### Tier 1 — context overrides (specific)

| # | When | Goal | Play | Until play is built |
|---|---|---|---|---|
| R1 | `firstTime = false` | deposit now | `loyalty` | serve `bundle_up` (owner call 12 Aug: "Craig's already coming" works for repeats and raises basket; never `welcome_gift` — "welcome" to a repeat customer is nonsense) |
| R2 | `priceBand = under_100` | raise basket | `bundle_up` | serve add_task as-is |
| R3 | `priceBand = over_2500` | phone first | `visit_first` | serve `none` + flag to Ben (0% close self-serve — don't let these ride the normal page) |
| R4 | `priceBand = 1000_2500` | visit booked | `visit_first` + `quote_split` | serve `none` (14% close — book-now theatre isn't the lever) |
| R5 | `stakes = high` AND total ≥ £250 | build trust | `risk_removal` | serve `none`, assumptions rendered prominently |
| R6 | `customerType ∈ {property_manager, letting_agent}` | relationship | `partner` | serve `none`, professional framing (no gift theatre) |
| R7 | `customerType = tenant` | owner approval | `forward_pack` | serve landlord-PDF button prominently |
| R8 | `customerType = business` | account terms | `terms_compliance` | serve `none` |

### Tier 2 — sweet-spot defaults

| # | When | Goal | Play |
|---|---|---|---|
| R9 | `firstTime` AND `customerType ∈ {homeowner, oap_homeowner, landlord}` AND `priceBand = 200_1000` AND `stakes ≠ high` | deposit now | `welcome_gift` (the built cell; oap → Minimal template variant, no urgency pressure) |
| R10 | `firstTime` AND `priceBand = 100_200` | raise basket | `bundle_up` (below the £200 gift floor; sub-£100→£129-149 floor test lives here later) |

### Tier 3 — fallback

| # | When | Play |
|---|---|---|
| R11 | nothing matched | `none` — straight to price. Always legal, never an error. |

### Post-first-view moments (routes, same variables reused)

| # | Moment + when | Goal | Play | Status |
|---|---|---|---|---|
| R12 | `stalled` (viewed ≥2 over 48h, no booking) | re-engage | `nudge` (context-variant message) | ❌ log-only for now |
| R13 | `declined` OR `stalled` AND total ≥ £500 | smaller yes | `quote_split` | 🟡 lab exists |
| R14 | `expired` | reactivate | existing +5% self-reissue | ✅ untouched |
| R15 | `job_done` | repeat + referral | `post_job_upsell` (PM/landlord → partner enrol; homeowner → review + next-job credit) | ❌ log-only |

**Re-decision triggers:** any quote mutation that can change an input —
edit, reissue (+5% can cross a price band), customer-type correction —
re-runs the router and appends a new decision row (never updates in place).

## 5. The residue — where the shadow agent looks

Rules are deliberately coarse. The known judgment zones the tiers punt on:

1. `stakes` boundary cases — the v0 proxy is trade-based; real anxiety lives in the transcript ("we had a cowboy in last year"). This is the LLM's first real job: shadow-classify stakes per quote, log next to the proxy, compare.
2. R9 vs R5 boundary — £250–1k first-timer with *medium* stakes: gift or trust? Rules say gift; the shadow agent may disagree. Its logged disagreements are the review queue.
3. Nudge variant selection (tone, timing, angle) once R12 is live.

Shadow agent contract: same inputs + this playbook → `{stakes, play, rationale}`
logged to the decision row (`shadowPlay`, `shadowStakes`, `shadowRationale`),
**never served**. Promotion to decider happens per-segment, only after its
disagreement log beats the rules on eyeball review — council decision 12 Aug.

## 6. Decision log — `quote_offer_decisions` (spec, not yet migrated)

One row per decision (append-only):

```
id, quote_id, slug, decided_at, moment,
inputs: { customer_type, price_band, stakes, stakes_source(proxy|llm|ben),
          first_time, total_pence, margin_ok, survey_required, vertical },
rule_fired,            -- e.g. "R9" | "G3-blocked" | "R11-fallback"
target_play,           -- what the rules wanted
served_play,           -- what the customer actually saw (after unbuilt-play fallback)
decided_by,            -- rules | ben_override
shadow_play, shadow_stakes, shadow_rationale,   -- nullable, agent shadow
ben_override_play, ben_override_at              -- nullable
```

Joins for the review loop: `viewed_at`, offer accepted/declined events,
`deposit_paid_at` (canonical conversion), actual margin (expense-card
reconciliation), gift redemption cost. Review output is a **dashboard, not an
autopilot**: coarse cells (served_play × stakes × price_band), test data
scrubbed, edits land as reviewed diffs to this file.

## 7. Locked decisions (owner review, 12 Aug 2026)

1. **Build order**: spine first — router + `quote_offer_decisions` log + Ben's builder view. Plays get built afterwards, ranked by logged unmet-intent volume.
2. **R1 repeat interim**: `bundle_up`, not `none`.
3. **`firstTime`**: no prior quote with `deposit_paid_at` (a previously-quoted-but-never-booked customer still counts as first-time).
4. **High-stakes trades (v0 proxy)**: active leaks / major plumbing, electrical, structural / load-bearing, roofing / external height — all four.
5. **Landlords**: gift like homeowners (R9 as written). Partner framing stays reserved for `property_manager` / `letting_agent`.
6. **Band edges**: £1,000 (R4) and £2,500 (R3), per the July price-barrier analysis.
7. **Shadow-disagreement review**: Ben flags disagreements that match his gut in the builder; owner approves any per-segment promotion of the agent. (Caveat on record: Ben's 10%-of-labour incentive means his flags are signal, never ground truth — promotion decisions weigh conversion evidence, not flag counts.)
