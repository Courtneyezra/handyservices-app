# Comms Agents V3 — cost and load model

Companion to `cost-model.html` (pane bottom-right of the Comms Desk Model page). Same calculator, same numbers, frozen at on-load defaults. Prices dated 2 Sep 2026.

**Defaults are MEASURED.** `replay-results.json` (generated 2 Sep 2026 08:00, window 4 Jun – 3 Sep 2026, 91 days, 65 working days: 130 bursts, 117 non-dropped, 55 threads, 467 calls, 390 answered) existed when this was finished, so its per-day counts drive the defaults: section G model calls, section E automatic sends, section D Ben taps. The brief's pre-replay assumptions are kept as a second rate set ("Brief") for comparison.

Two replay caveats matter for reading the numbers. WhatsApp ingest was dead until 15 Aug, so the window average of 30 messages a week understates today; the run-rate since 17 Aug is about 130 a week. Ben's replies from his personal number are not in the DB, and the regex lexicons over-count the Ben lane.

Defaults: Replay = 30 messages/week and 36 calls/week per city. Brief = 100 messages/week and 15 calls/week per city. 1 city. LAUNCH = Scoper at DRAFT. MONTH 2 = Scoper at SEND for non-exception replies.

## Headline, 1 city

| | Replay LAUNCH | Replay MONTH 2 | Brief LAUNCH | Brief MONTH 2 |
|---|---:|---:|---:|---:|
| Models £/day | 0.080 | 0.081 | 0.117 | 0.122 |
| Models £/month (30.4 d) | 2.44 | 2.47 | 3.54 | 3.70 |
| Twilio/Meta messages £/month | 0.90 | 0.85 | 3.18 | 1.95 |
| Tokens/day | 51,900 | 52,100 | 86,000 | 87,100 |
| Ben taps / calendar day | 1.0 | 0.6 | 6.4 | 2.3 |
| Ben taps / working day | 1.5 | 0.8 | 8.9 | 3.2 |
| Ben minutes / working day (30 s/tap) | 0.7 | 0.4 | 4.5 | 1.6 |
| Ben hours / month | 0.27 | 0.15 | 1.62 | 0.58 |
| Operator time saved £/day at £15/h | 5.67 | 5.73 | 6.90 | 7.41 |
| Operator time saved £/month | 172 | 174 | 210 | 225 |

Replay section G per day: triage 1.3, scoper 0.5, clerk 4.4, auditor 0.2. Section E: 1.6 (launch) / 2.0 (month 2) automatic sends per day. Section D: 1.4 / 0.8 Ben taps per working day. The calculator reproduces these on load (1.31 / 0.49 / 4.44 / 0.17; 1.65 / 2.04; 1.47 / 0.83).

**The trade:** on measured rates the models cost about 8p a day and give back about 23 minutes of operator time, worth £5.67 a day. That is roughly 70× the model spend. Messaging fees are the same order as the models. The system is cheap; the constraint is Ben's attention and delivery, not tokens.

## Runs per day, by kind (1 city)

| Kind | Tier | Replay LAUNCH | Replay MONTH 2 | Brief LAUNCH | Brief MONTH 2 |
|---|---|---:|---:|---:|---:|
| Rules layer sends, total | SEND | 1.65 | 1.55 | 5.80 | 3.57 |
| · first-contact ack | SEND | 0.31 | 0.31 | 2.23 | 2.23 |
| · photo / postcode ask | SEND | 0.11 | 0.11 | 0.89 | 0.89 |
| · 20-min silence-breaker | SEND | 0.25 | 0.15 | 2.68 | 0.45 |
| · flag-expiry holding line | SEND | 0.13 | 0.13 | 0 | 0 |
| · post-call template to missed calls | SEND | 0.85 | 0.85 | 0 | 0 |
| Triage / Sorter · Haiku 4.5 | writes tags | 1.31 | 1.31 | 8.93 | 8.93 |
| Scoper · Sonnet 5 | DRAFT → SEND | 0.49 | 0.49 | 4.29 | 4.29 |
| Quote clerk · Sonnet 5 | PROPOSE | 4.44 | 4.44 | 2.79 | 2.79 |
| · from answered-call transcripts | | 4.30 | 4.30 | 1.71 | 1.71 |
| · from threads reaching 2+ Scoper bursts | | 0.15 | 0.15 | 1.07 | 1.07 |
| Verifier · Opus 5 (10% of automatic sends) | READ | 0.17 | 0.20 | 0.58 | 0.79 |
| Exception flags → Ben | BEN | 0.39 | 0.39 | 1.52 | 1.52 |
| Dropped before triage (non-UK number) | — | 0.15 | 0.15 | 0 | 0 |

Measured reality inverts the brief: the Quote clerk on call transcripts is 4.4 of 6.4 model calls a day, and Scoper traffic is small. Automatic sends at launch = rules sends only; at month 2 = rules sends + Scoper sends.

## Model calls and tokens per day (1 city, LAUNCH)

| Model | Rates | Calls | Input | Cache read | Output | £/day |
|---|---|---:|---:|---:|---:|---:|
| Haiku 4.5 | Replay | 1.31 | 3,270 | 0 | 196 | 0.003 |
| Sonnet 5 | Replay | 4.93 | 23,700 | 19,700 | 4,190 | 0.073 |
| Opus 5 | Replay | 0.17 | 830 | 0 | 50 | 0.004 |
| **All** | **Replay** | **6.40** | **27,800** | **19,700** | **4,440** | **0.080** |
| Haiku 4.5 | Brief | 8.93 | 22,300 | 0 | 1,340 | 0.023 |
| Sonnet 5 | Brief | 7.07 | 26,800 | 28,300 | 4,220 | 0.079 |
| Opus 5 | Brief | 0.58 | 2,900 | 0 | 174 | 0.015 |
| **All** | **Brief** | **16.6** | **52,000** | **28,300** | **5,740** | **0.117** |

Month 2 changes only the Opus line (Replay 0.20 calls, £0.005; Brief 0.79 calls, £0.020).

## Ben's desk per day (per operator)

Taps = draft approvals + exception flags + sample reviews, the replay's section D definition. Quote-clerk prefills are listed but not counted: they replace the quote intake Ben already does from the call. Working day = calendar day × 7/5.

| Tap | Replay LAUNCH /day | /wd | min/wd | Replay MONTH 2 /day | /wd | min/wd | Brief LAUNCH /day | /wd | min/wd | Brief MONTH 2 /day | /wd | min/wd |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Approve / edit / reject Scoper drafts | 0.49 | 0.69 | 0.3 | 0 | 0 | 0 | 4.29 | 6.00 | 3.0 | 0 | 0 | 0 |
| Exception flags (money, dates, complaints) | 0.39 | 0.55 | 0.3 | 0.39 | 0.55 | 0.3 | 1.52 | 2.13 | 1.1 | 1.52 | 2.13 | 1.1 |
| Next-morning 10% sample reviews | 0.17 | 0.23 | 0.1 | 0.20 | 0.29 | 0.1 | 0.58 | 0.81 | 0.4 | 0.79 | 1.10 | 0.6 |
| **Total taps** | **1.05** | **1.47** | **0.7** | **0.60** | **0.83** | **0.4** | **6.38** | **8.94** | **4.5** | **2.30** | **3.23** | **1.6** |
| Quote clerk prefills (not counted) | 4.44 | 6.22 | | 4.44 | 6.22 | | 2.79 | 3.90 | | 2.79 | 3.90 | |

## Scaling: 1, 2 and 5 cities (volumes per city held at defaults)

| Cities | Rates | Mode | Models £/day | Models £/mo | Messages £/mo | Operator taps/day (all cities) | Operator hrs/mo (all cities) | Time saved £/mo |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 1 | Replay | LAUNCH | 0.08 | 2.44 | 0.90 | 1.0 | 0.3 | 172 |
| 2 | Replay | LAUNCH | 0.16 | 4.88 | 1.81 | 2.1 | 0.5 | 345 |
| 5 | Replay | LAUNCH | 0.40 | 12.19 | 4.52 | 5.2 | 1.3 | 862 |
| 1 | Replay | MONTH 2 | 0.08 | 2.47 | 0.85 | 0.6 | 0.2 | 174 |
| 2 | Replay | MONTH 2 | 0.16 | 4.94 | 1.70 | 1.2 | 0.3 | 348 |
| 5 | Replay | MONTH 2 | 0.41 | 12.34 | 4.24 | 3.0 | 0.8 | 871 |
| 1 | Brief | LAUNCH | 0.12 | 3.54 | 3.18 | 6.4 | 1.6 | 210 |
| 2 | Brief | LAUNCH | 0.23 | 7.08 | 6.35 | 12.8 | 3.2 | 420 |
| 5 | Brief | LAUNCH | 0.58 | 17.70 | 15.88 | 31.9 | 8.1 | 1,049 |
| 1 | Brief | MONTH 2 | 0.12 | 3.70 | 1.95 | 2.3 | 0.6 | 225 |
| 2 | Brief | MONTH 2 | 0.24 | 7.40 | 3.91 | 4.6 | 1.2 | 451 |
| 5 | Brief | MONTH 2 | 0.61 | 18.49 | 9.77 | 11.5 | 2.9 | 1,127 |

Everything scales linearly with cities because a city is a config record and volumes are per city. One operator per city, so taps per operator do not change with city count.

## Rates: Replay (measured) vs Brief (assumed)

Shares are of non-dropped bursts. *[own]* marks figures neither source gave.

| Assumption | Replay | Brief |
|---|---:|---:|
| Messages per burst (group within 10 min) | 2.95 (384 msgs / 130 bursts) | 1.6 |
| Dropped before triage (non-UK number) | 10% (13/130) | 0% |
| First contact → rules layer | 24% (28/117) | 25% |
| Photo-only → rules layer | 9% (10/117) | 10% |
| Exceptions → Ben | 30% (35/117: money 27, date 8, complaint 0) | 17% (11 money, 6 date, 0 complaint) |
| Remainder → Scoper | 38% (44/117) | 48% |
| Silence-breaker fires, launch / month 2 | 19% / 11% (22 / 13) | 30% / 5% |
| Flag-expiry holding line | 10% (12/117) | 0% |
| Inbound calls answered and transcribed (>10 s) | 84% (390/467) | 80% *[own]* |
| Missed calls get one post-call template | yes (77) | no |
| Scoper bursts that are a thread's 2nd+ burst → extra clerk call | 30% (13/44) | 25% *[own]* |
| Every non-dropped burst gets one Triage call | 1 | 1 |
| Verifier + Ben sample of automatic sends | 10% | 10% |
| Ben's hand-written reply, minutes | 1.9 (measured median, n=89) | 3 *[own]* |
| Hand-written quote intake per answered call, minutes | 5 *[own]* | 5 *[own]* |
| Recovery agent | not modelled (no token figures; batch, low volume) | same |

Tokens per call and unit price:

| Call | Model | Input | Cache read | Output | USD/call | GBP/call |
|---|---|---:|---:|---:|---:|---:|
| Triage | Haiku 4.5 | 2,500 | 0 | 150 | 0.00325 | 0.00253 |
| Scoper | Sonnet 5 | 3,000 | 4,000 | 400 | 0.01080 | 0.00842 |
| Quote clerk | Sonnet 5 | 5,000 | 4,000 | 900 | 0.01980 | 0.01544 |
| Verifier | Opus 5 | 5,000 | 0 | 300 | 0.03250 | 0.02535 |
| Rules layer | — | 0 | 0 | 0 | 0 | 0 |

Prices, USD per million tokens (2 Sep 2026): Haiku 4.5 in 1.00 / out 5.00; Sonnet 5 in 2.00 / out 10.00; Opus 5 in 5.00 / out 25.00. Cache read = 10% of input price. Cache writes ignored (one per 5-min window, negligible). 1 USD = 0.78 GBP. Month = 30.4 days.

Message fees: WhatsApp template £0.035, WhatsApp reply inside the 24h window £0, SMS £0.04. 40% of rules-layer sends are templates, 10% SMS, 50% in-window (brief assumption, kept for both rate sets). Scoper replies are treated as in-window (£0).

Ben: £15/hour, 30 s per tap. Time-saved baseline (no system): one hand-written reply per burst at the rate above, plus a hand-written quote intake per answered call at 5 min. With the system Ben still hand-writes exception replies; those are counted against the saving.

## Formulas

```
bursts/day        = msgs/week ÷ 7 ÷ msgsPerBurst × (1 − dropShare)
rules sends       = bursts × (firstContact + photoOnly + silence + flagExpiry) + missed calls × postCallTemplate
scoper calls      = bursts × (1 − firstContact − photoOnly − exception)
clerk calls       = calls/week ÷ 7 × answered  +  scoper calls × secondBurst
automatic sends   = rules sends  (+ scoper calls at MONTH 2)
verifier calls    = automatic sends × 10%
Ben taps          = scoper calls (LAUNCH only) + bursts × exception + verifier calls
model £/day       = Σ calls × tokens × price ÷ 1e6 × 0.78
messages £/day    = rules sends × (40% × 0.035 + 10% × 0.04)
saved £/day       = (bursts × replyMin + answered calls × 5 − taps × 0.5 − exceptions × replyMin) ÷ 60 × 15
```
