x Handy Services Call Audit Report
**Date**: 11 March 2026
**Period analysed**: 25 February - 10 March 2026 (last 100 calls)
**Total calls in database**: 452

---

## Executive Summary

We have 452 calls in the system. Of the last 100, **zero have converted to a paid job**. The data tells a clear story about where the funnel is breaking.

---

## 1. The Numbers

| Metric | Value |
|--------|-------|
| Total calls (last 100) | 100 |
| Calls with recordings | 95 (95%) |
| Calls with transcripts | 92 (92%) |
| Average call duration | **1 min 25 sec** |
| Calls under 30 seconds | **26 (27%)** |
| Calls under 60 seconds | **53 (56%)** |
| Calls over 5 minutes | 3 (3%) |
| Conversions | **0** |

### Call Outcomes

| Outcome | Count | What it means |
|---------|-------|---------------|
| VIDEO_QUOTE | 75 | AI told customer "send a video" |
| INSTANT_PRICE | 12 | AI gave a price on the call |
| FORWARDED | 5 | Call forwarded to Ben (not answered by AI) |
| UNKNOWN | 5 | Couldn't determine outcome |
| VIDEO_REQUESTED | 3 | Video was actually requested from customer |

---

## 2. Where The Funnel Breaks

### Problem 1: Most calls are too short for anything meaningful

**56% of all calls are under 60 seconds.** Many of these are just the AI hold message playing:

> "Please wait while we connect you to one of the team at Handy Services. The only local handyman service who quotes in minutes, not weeks."

The customer hangs up before anyone answers. These are **wasted leads** — real people with real jobs who called and got nobody.

### Problem 2: 75% of calls end at "VIDEO_QUOTE" but almost no videos come back

The AI agent tells the customer to send a video. Out of 75 calls marked VIDEO_QUOTE, only **3** progressed to VIDEO_REQUESTED (where a video link was actually sent). That's a **4% follow-through rate**.

**The video request is where leads go to die.**

### Problem 3: Lead stages confirm the drop-off

| Lead Stage | Count | Meaning |
|------------|-------|---------|
| new_lead | ~40 | Never progressed past the call |
| quote_viewed | ~8 | Got a quote, didn't convert |
| awaiting_video | ~3 | Stuck waiting for video that never came |
| converted | **0** | Nobody has paid |

### Problem 4: Segmentation is not working

| Segment | Count |
|---------|-------|
| DEFAULT | ~68 |
| DIY_DEFERRER | 2 |
| All others | 0 |

**97% of leads are falling into DEFAULT segment.** The segment detection (BUSY_PRO, LANDLORD, PROP_MGR, etc.) is not triggering. This means every customer gets generic messaging instead of targeted messaging that speaks to their situation.

---

## 3. The Calls Worth Listening To (Priority Order)

These are the substantive calls where a real conversation happened. **These are the ones to listen back to and learn from.**

### Tier 1: Long, qualified calls that should have converted

| # | Date | Customer | Job | Duration | Outcome | Why listen |
|---|------|----------|-----|----------|---------|------------|
| 1 | 04/03 | **Rajinda** | Replace internal doors + locks | **10m 5s** | VIDEO_QUOTE | Longest call. Detailed job. Should have been an easy win. |
| 2 | 07/03 | **Terry** | Mantelpiece on plasterboard | **6m 47s** | VIDEO_QUOTE | Long engaged call. Clear job. Where did it drop off? |
| 3 | 04/03 | **Ajith** (Derby) | TV wall mounting | **5m 48s** | VIDEO_QUOTE | Clear job, gave address (DE24 3HS). Should have been booked. |
| 4 | 27/02 | **Richard Walker** | Kitchen worktop fitting | **4m 33s** | VIDEO_QUOTE | Gave area (West Bridgeford NG2). Kitchen job = high value. |
| 5 | 28/02 | **Chandula** | Lock replacement | **4m 18s** | VIDEO_REQUESTED | Actually got to video request stage. What happened after? |
| 6 | 10/03 | **Ava** | Bed assembly | **3m 37s** | INSTANT_PRICE | AI gave instant price. Did a quote go out? Any follow-up? |
| 7 | 03/03 | **Gordon Johnston** | Shed + outdoor cabinets assembly | **3m 27s** | VIDEO_QUOTE | Gave full address (DE22 2TG). Multi-job. |
| 8 | 26/02 | **Mikaela** (Sherwood) | IKEA shelves reinstall | **3m 8s** | INSTANT_PRICE | Local Nottingham. Got instant price. What happened next? |

### Tier 2: Medium calls with clear jobs

| # | Date | Customer | Job | Duration | Outcome |
|---|------|----------|-----|----------|---------|
| 9 | 09/03 | **Farida** | Large blind + radiator move | 2m 41s | VIDEO_QUOTE |
| 10 | 03/03 | **CJ** | Toilet seat + washing line | 2m 39s | VIDEO_QUOTE |
| 11 | 10/03 | **Courtney** | Dressing table install | 2m 39s | VIDEO_QUOTE |
| 12 | 26/02 | **Emily** | Window mechanism fix | 2m 29s | VIDEO_QUOTE |
| 13 | 28/02 | **Simon Pasey** | Light switch relocation | 2m 22s | VIDEO_QUOTE |
| 14 | 26/02 | **Mary** | Shave 9 doors for carpet | 2m 22s | VIDEO_QUOTE |
| 15 | 09/03 | **Seron Russell** | Mirror on bathroom tiles | 2m 15s | INSTANT_PRICE |
| 16 | 07/03 | **Claire Potter** | Curtain rails x2 | 2m 14s | VIDEO_QUOTE |
| 17 | 05/03 | **Aisha** (HomesRUs) | Fence repair | 2m 4s | VIDEO_REQUESTED |
| 18 | 25/02 | **Louise Jessen** | Ring camera install | 1m 58s | VIDEO_QUOTE |

### Tier 3: Short calls that still had real customers

| # | Date | Customer | Job | Duration | Outcome |
|---|------|----------|-----|----------|---------|
| 19 | 10/03 | **Linda** | Kitchen cupboard + blind | 1m 24s | INSTANT_PRICE |
| 20 | 09/03 | **Sandra** | Bathroom boiler + outdoor tap | 1m 46s | VIDEO_QUOTE |
| 21 | 10/03 | **Mister Tor** | Washing machine fitting | 1m 12s | VIDEO_QUOTE |
| 22 | 28/02 | **Unknown** | Paint edges/skirting boards | 0m 59s | VIDEO_QUOTE |

---

## 4. Repeat Callers (Showing Interest But Not Converting)

These people called more than once — they're interested but something keeps failing:

| Phone | Name | # Calls | Jobs mentioned |
|-------|------|---------|----------------|
| +447777522490 | Seren/Saron Russell | 3 | Mirror on bathroom tiles |
| +447963111491 | Al / "Honey Services" | 4 | Door handles, bath reseal, leak |
| +447725880785 | Sandra | 2 | Bathroom boiler, outdoor tap |
| +447946830481 | Chen | 2 | Sink issue |
| +441686948134 | Unknown | 2 | General inquiry |
| +447789484849 | Unknown | 2 | General inquiry |
| +447840572002 | Unknown | 2 | General inquiry |
| +447980581719 | Unknown | 2 | General inquiry |
| +441918409370 | Unknown | 2 | General inquiry |

**Seren Russell called 3 times about a mirror.** That's a customer begging to give you money.

---

## 5. Spam / Non-Customer Calls

These are NOT real leads and should be filtered:

| Date | Caller | What happened |
|------|--------|---------------|
| 28/02 | Neha Ywanto (+441617915733) | Card machine sales pitch |
| 26/02 | Zoe (+441135476111) | SEO/digital marketing sales |
| 26/02 | Harry, RFSoft (+442045185401) | Software sales pitch |

---

## 6. Transcript Quality Issues

The Whisper transcription has a recurring bug: it transcribes "Please wait" as **"Leak wait"** in approximately 40% of calls. This is cosmetic (doesn't affect customer experience) but makes transcript analysis harder.

Example: *"Leak wait while we connect you to one of the team at Handy Services"* should be *"Please wait..."*

---

## 7. Key Findings For Ben

### What's going right
- The phone is ringing. You're getting 5-15 calls per day from real people with real jobs.
- The AI agent is answering and qualifying. It's capturing names, jobs, and postcodes.
- 95% of calls have recordings. The data is there.

### What's going wrong
1. **Too many calls end before a real conversation happens** (56% under 60s). The AI hold message plays, customer waits, nobody picks up, they hang up.
2. **"Send a video" is a dead end.** 75 calls ended with VIDEO_QUOTE. Almost none sent a video. Customers don't want to send videos — they want someone to come and do the job.
3. **No follow-up is happening.** Repeat callers (Seren Russell called 3 times!) aren't being called back or chased.
4. **Segmentation isn't working.** 97% of leads are in DEFAULT. The system can't tailor messaging if it can't detect who the customer is.

### What needs to change immediately
1. **Ben must answer or call back within 5 minutes.** The AI hold message buys time, but if nobody follows up, the lead is dead.
2. **Stop relying on the video flow for first contact.** Most customers won't send a video. Get the job details on the call, give a ballpark price, and book the visit.
3. **Chase repeat callers TODAY.** Seren Russell (mirror), Sandra (bathroom), Al (door handles) — these people want the work done. Call them back.
4. **Use Wispr Flow for every WhatsApp message.** Ben's voice messages via Wispr are better than his typed messages. Make it mandatory.
5. **One simple flow: Call > Get Job Details > Send WhatsApp with Price > Book.** No video step unless the customer offers.

---

## 8. Recordings Available For Review

All 95 recordings are stored locally at:
```
storage/recordings/call_CA*.raw
```

These can be played back through the admin dashboard at `/api/calls/{id}/recording` which handles format conversion automatically.

**Recommended listening session**: Go through Tier 1 calls (8 calls, ~45 minutes of audio) together. Note where the conversation goes well and where it breaks down.

---

*Report generated from V6 Switchboard database, 11 March 2026*
