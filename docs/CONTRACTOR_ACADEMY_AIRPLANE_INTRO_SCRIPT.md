# Contractor Academy — "Pre-Flight" Intro (Compliance Module) — Script & Shot List

**Purpose:** The hard-gated compliance/safety module every contractor must pass before accepting jobs. Modelled on the airline pre-flight safety briefing: mandatory, choreographed, warm-but-authoritative, discharges a liability duty, sets the tone for the whole Academy.

**Production recipe (per the UGC video workflow constraint — NO AI talking-heads):**
- Visuals: silent stylized b-roll (`higgsfield-video-explainer` skill for this intro — non-photoreal, narration-first; Seedance reserved for the photoreal "real job site" modules).
- Narration: one consistent narrator voice (Seed Audio), calm airline-cabin cadence.
- Overlays: burned-in on-screen text + Handy logo tag + captions (ffmpeg). Keep the blue polo logo-free (AI garbles text).
- Format: 10-second blocks to match the explainer skill. Target ~110s (11 blocks).
- Tone reference: Air NZ / Delta safety films — friendly, a touch of dry wit, never sloppy.

**Style key (one line, reused across every block):** *"Clean, calm, well-lit British home-services world; navy + warm gold palette; a Handy contractor in a plain blue polo; soft cabin-briefing lighting; unhurried camera; premium, reassuring, not corporate-cold."*

---

## Block-by-block

### Block 1 — Welcome aboard (0:00–0:10)
- **Narration:** "Welcome aboard. Before your first job with Handy, a short briefing — so that every time a customer opens their door to you, they get the best tradesperson they've ever had."
- **Visual:** Contractor stands at a front door, sets down a tidy toolbag, looks up ready. Warm morning light. Handy logo tag fades in.
- **On-screen text:** `PRE-FLIGHT BRIEFING` / `Please complete before your first job`

### Block 2 — Who we are (0:10–0:20)
- **Narration:** "Handy isn't a handyman. Handy is the standard a handyman should be — and can't usually reach on their own. You are the moment that promise becomes real."
- **Visual:** Split-second contrast: a chaotic "typical" van (messy, cluttered) vs. the calm, ordered Handy setup. Land on the ordered one.
- **On-screen text:** `YOU ARE THE STANDARD`

### Block 3 — The three things (0:20–0:30)
- **Narration:** "Three things keep everyone safe: you, the customer, and the Handy name. Insurance. Safety on site. And knowing what to do when something goes wrong."
- **Visual:** Three clean icon cards slide in one at a time (shield / hard-hat / lifebuoy).
- **On-screen text:** `1. INSURANCE   2. SAFETY   3. WHEN IT GOES WRONG`

### Block 4 — Insurance / insurance-of-record (0:30–0:40)
- **Narration:** "Every Handy job is covered under our insurance of record. That protection only holds while you follow the standard on this briefing. Work outside it, and the cover doesn't travel with you."
- **Visual:** A document with a subtle "COVERED" seal; camera pulls back to show it sitting on a job sheet.
- **On-screen text:** `COVERED — while you follow the standard`

### Block 5 — Safety on site, part 1 (0:40–0:50)
- **Narration:** "On every site: assess before you touch. Isolate power and water before you work on them. If a job needs a tool or a qualification you don't have — you stop. Stopping is never the wrong call."
- **Visual:** Contractor pauses at a consumer unit, flips the isolator, checks with a tester before proceeding. Deliberate, unhurried.
- **On-screen text:** `ASSESS → ISOLATE → THEN WORK`

### Block 6 — Safety on site, part 2 (0:50–1:00)
- **Narration:** "Leave a site the way you'd want yours left. Cables tucked, no trip hazards, nothing sharp left out — especially where there are children or pets."
- **Visual:** Wide shot of a tidy, hazard-free work area; contractor coils a lead and clears the floor.
- **On-screen text:** `LEAVE IT SAFE — every time`

### Block 7 — The customer's home is not yours (1:00–1:10)
- **Narration:** "You are a guest. Boots off or covers on. Ask before you move anything. Their home, their rules — and their peace of mind is part of the job."
- **Visual:** Contractor slips on shoe covers at the threshold, gestures politely before moving a chair.
- **On-screen text:** `A GUEST IN THEIR HOME`

### Block 8 — When it goes wrong (1:10–1:20)
- **Narration:** "Things go wrong. A breakage, an injury, a customer who isn't home, a job bigger than the quote. The rule is simple: stop, make it safe, and tell us straight away. Never hide it, never guess."
- **Visual:** Contractor steps back from a problem, pulls out phone, opens the Handy app to report. Calm, not panicked.
- **On-screen text:** `STOP · MAKE SAFE · TELL US`

### Block 9 — Photos & proof (1:20–1:30)
- **Narration:** "Before, during, after — photograph the work. Photos protect you as much as the customer. No photos, no proof, no payment."
- **Visual:** Quick sequence of three phone-frame shots: before / during / after of the same repair.
- **On-screen text:** `BEFORE · DURING · AFTER`

### Block 10 — The non-negotiables recap (1:30–1:40)
- **Narration:** "So: stay inside the standard, keep everyone safe, tell us the moment something's off, and prove your work. Do that, and you're covered, you're paid, and you're on the path to Core."
- **Visual:** The three icon cards from Block 3 return, now all stamped with a check.
- **On-screen text:** `COVERED · PAID · ON THE PATH TO CORE`

### Block 11 — Hand-off to the quiz (1:40–1:50)
- **Narration:** "One short quiz to confirm you've got it — then your first job is cleared for takeoff. Welcome to Handy."
- **Visual:** "Fasten seatbelt"-style sign flips from off to on; button pulses: `START QUIZ`. Handy logo tag holds.
- **On-screen text:** `PASS THE QUIZ TO UNLOCK JOBS →`

---

## Notes for downstream tasks
- **Quiz must mirror this script.** Scenario questions, not trivia — e.g. "You've broken a customer's tile mid-job and they're not home. What do you do?" → *Stop, make safe, report immediately* (Block 8). Every quiz item should trace to a block.
- **Re-certification:** compliance content gets a `passedAt` + expiry (annual). This intro is the artefact that expiry re-shows.
- **Reusable assets:** the narrator voice, style key, logo tag, and the three icon cards are shared across all Academy modules — generate once, reuse.
- **Blocked on:** Higgsfield authorization (OAuth via interactive `/mcp` session) before any render. Script + shot list are render-ready now.
