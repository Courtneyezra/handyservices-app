# Comms desk replay, 2026-06-04 to 2026-09-02

Real customer WhatsApp/SMS bursts (91 days, 65 working days) replayed through the desk rules. LAUNCH = scoper drafts for Ben; MONTH2 = scoper sends. All queries succeeded.

**Read first:** inbound WhatsApp capture was dead until 15 Aug, so 96 of 132 bursts fall in the last 17 days. Per-day rates are given for the full window and "since 2026-08-17" (the honest run-rate). Calls were captured all window.

## A. Bursts

| Metric | Value |
|---|---|
| Bursts (<10 min gap) | 132 across 56 threads (whatsapp 128, sms 4) |
| Per week since 2026-08-17 | 39.5 |
| Out-of-hours (before 08:00, after 20:00, weekend) | 42 (31.8%), of which weekend 30 |
| First-contact / with media | 54 / 43 |

| Week of | 06-01 | 06-08 | 06-15 | 06-22 | 07-06 | 07-13 | 07-20 | 08-03 | 08-10 | 08-17 | 08-24 | 08-31 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Bursts | 3 | 10 | 1 | 3 | 3 | 3 | 4 | 4 | 5 | 27 | 39 | 30 |

## B. Lanes

| Lane | Count | % |
|---|---|---|
| dropped | 15 | 11.4% |
| receptionist_send | 38 | 28.8% |
| ben_flag | 35 | 26.5% |
| scoper | 44 | 33.3% |

Flag sub-types: money 27, date 8. Drops: non_uk_number 15. Receptionist: first_contact_ack 28, ack_photos 10.

## C. Silence and speed (non-dropped bursts, minutes to first outbound)

| Split | n | Actual silent 24h | Actual med / p90 | LAUNCH silent (substantive) | LAUNCH med / p90 (subst. p90) | MONTH2 silent (subst.) | MONTH2 med / p90 (subst. p90) |
|---|---|---|---|---|---|---|---|
| All | 117 | 27 (23.1%) | 1.5 / 8.2 | 0 (19) | 20 / 20 (70.6) | 0 (17) | 2 / 20 (22.1) |
| In-hours | 79 | 23 (29.1%) | 1.6 / 19.1 | 0 (12) | 14.1 / 20 (53.5) | 0 (12) | 2 / 20 (2) |
| Out-of-hours | 38 | 4 (10.5%) | 1.5 / 2.3 | 0 (7) | 20 / 20 (681.5) | 0 (5) | 2 / 20 (53.5) |

Simulated silence is zero by construction (holding line at 20 min); brackets = bursts with no substantive (non-holding) reply in 24h. Actual counts any delivered outbound; Ben alone answered 62/117, median 54 min.

## D. Ben's taps per working day

| Scenario | Flags | Scoper drafts | Sample reviews | Total | /working day (full) | /working day (since 2026-08-17) |
|---|---|---|---|---|---|---|
| Actual manual outbounds | – | – | – | 88 | 1.4 | 6.7 |
| LAUNCH | 35 | 44 | 19 | 98 | 1.5 | 6.1 |
| MONTH2 | 35 | 0 | 20 | 55 | 0.8 | 2.8 |

## E. Automatic sends

| Kind | LAUNCH total | /day (since 2026-08-17) | MONTH2 total | /day (since 2026-08-17) |
|---|---|---|---|---|
| receptionist | 38 | 1.2 | 38 | 1.2 |
| flag_expiry_holding | 17 | 0.5 | 17 | 0.5 |
| silence_breaker | 62 | 3.1 | 28 | 1.1 |
| post_call_template | 77 | 0.4 | 77 | 0.4 |
| scoper_send | 0 | 0 | 44 | 2.6 |
| **All** | 194 | 5.2 | 204 | 5.8 |

## F. Inbound calls per week (467: 390 answered, 77 missed)

| Week of | 06-01 | 06-08 | 06-15 | 06-22 | 06-29 | 07-06 | 07-13 | 07-20 | 07-27 | 08-03 | 08-10 | 08-17 | 08-24 | 08-31 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Answered = clerk prefill | 22 | 33 | 30 | 23 | 37 | 52 | 38 | 28 | 25 | 40 | 20 | 24 | 12 | 6 |
| Missed = post-call template | 3 | 12 | 4 | 7 | 13 | 9 | 6 | 3 | 2 | 8 | 4 | 4 | 2 | 0 |

## G. Model calls (counts)

| Model | LAUNCH total | /day (since 2026-08-17) | MONTH2 total | /day (since 2026-08-17) |
|---|---|---|---|---|
| triage_haiku | 117 | 5.4 | 117 | 5.4 |
| scoper_sonnet | 44 | 2.6 | 44 | 2.6 |
| clerk_sonnet | 403 | 3.2 | 403 | 3.2 |
| auditor_opus | 19 | 0.5 | 20 | 0.6 |
| total | 583 | 11.7 | 584 | 11.8 |
Clerk = 390 answered calls + 13 threads with 2+ scoper bursts.

## H. Ten example bursts (desk column = what fires, then minutes to first reply LAUNCH / MONTH2)

| Case | Who | UK time | Excerpt | Actual | Lane | Desk |
|---|---|---|---|---|---|---|
| Saturday-night first contact | customer …609 | Sat 15/08 18:17 | Hi, I'm looking for someone to do some work for us. When is  | silent (24h) | receptionist_send first_contact_ack | ack @ 15/08 18:18 → 1 (ack) / 1 (ack) |
| Photos | Rebecca …308 | Fri 21/08 13:24 | It would go across both windows / There are paper blinds alr | 2.1 min (comms_agent_bubble) | receptionist_send ack_photos | ack @ 21/08 13:25 → 1 (ack) / 1 (ack) |
| Money question | cus …394 | Tue 09/06 17:16 | Can you give me a price please to 1) remove 2 doors from my  | silent (24h) | ben_flag (money) | flag-hold @ 10/06 09:16; hold @ 09/06 17:36 → 20 (hold) / 20 (hold) |
| Date question | cus …557 | Sat 13/06 15:47 | Hi, this is Guen from Valstays. We saw online that you carr | silent (24h) | ben_flag (date) | flag-hold @ 15/06 12:00; hold @ 13/06 16:07 → 20 (hold) / 20 (hold) |
| Callback request | – | – | none in window | | | |
| Mid-scope reply | Guest …575 | Tue 18/08 11:32 | Hiya, the issue is fixed but we will surely let you know in  | 44.7 min (comms_agent) | scoper | hold @ 18/08 11:52 → 20 (hold) / 2 (scoper) |
| Actually went silent | Unknown …622 | Tue 09/06 10:20 | Good morning, this is Sarah from Creative Building Solutions | silent (24h) | receptionist_send first_contact_ack | ack @ 09/06 10:21 → 1 (ack) / 1 (ack) |
| Out-of-area / spam | cus …006 | Thu 04/06 02:14 | Hi | silent (24h) | dropped | nothing |
| Ben replied within 2 min | Paula …925 | Fri 21/08 11:39 | thank you, as far as I can see, the first open date is 27th | 2 min (Ben) | dropped | nothing |
| Holding line would fire | cus …644 | Tue 09/06 17:27 | Hi / I need a curtain pole fitted near NG4 1TF. It’s a small | silent (24h) | ben_flag (money) | flag-hold @ 10/06 09:27; hold @ 09/06 17:47 → 20 (hold) / 20 (hold) |

## I. Caveats

- Ben's median manual reply (n=65) = 53.5 min, used as the in-hours LAUNCH draft-approval delay.
- Answered call = completed AND duration > 10s; 65 completed calls of 10s or less count as missed (likely hang-ups/voicemail).
- Ben's personal-number WhatsApp replies are NOT in the DB. "Ben manual" = business-sender outbound with no message_drafts row and not matching dunning / job-reminder / nudge / test patterns, after re-attributing 185 sibling bubbles of agent sends (88 rows remain); any other undrafted automation is miscounted as Ben.
- Existing comms-agent sends count in the ACTUAL baseline only; the desk replaces that agent.
- Media = media_url or type image/video/audio/document. Lanes use fixed regexes ("pay", "book", "available" fire on ordinary sentences, so ben_flag is over-counted); nothing matched the callback lexicon.
- Working hours Mon-Fri 08:00-20:00 London; OOH LAUNCH drafts approved next working day 08:30, so Saturday bursts wait until Monday (hence the 635-min OOH p90).
- Scrubbed: phones with 7700900 / 84357691573, Test/QA names, content mentioning Ofcom / test_q_ / "please ignore" (263 rows). DB timestamps are UTC and converted explicitly.
