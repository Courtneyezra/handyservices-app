# Contractor Academy — Compliance Module Quiz Bank

**Gate:** hard. Must pass to unlock job acceptance. `passedAt` + annual expiry (re-shows the airplane intro on expiry).
**Format:** multiple-choice, scenario-first. Pass threshold **80%** (8/10). Unlimited retries, but **every attempt is logged** — attempt-count is promotion signal, not just pass/fail.
**Design rule:** every question traces to a block in `docs/CONTRACTOR_ACADEMY_AIRPLANE_INTRO_SCRIPT.md`. Correct answer marked ✅. Randomise option order at render.

---

### Q1 — Insurance of record (Block 4)
You take on a small extra task the customer asks for on the day — it's not on the job sheet, but it's quick.
- A) Fine, as long as the customer's happy.
- B) Fine, it's covered because you're a Handy contractor.
- ✅ C) Stop — work outside the agreed standard/scope isn't covered by our insurance of record. Clear it with ops first.
- D) Do it, then tell ops afterwards.

### Q2 — Competence limit (Block 5)
A job needs a gas connection. You've done similar before but you're not Gas Safe registered.
- A) Do it carefully — you know how.
- ✅ B) Stop. If it needs a qualification you don't hold, you don't touch it — flag to ops.
- C) Do it and note it in the photos.
- D) Ask the customer if they mind.

### Q3 — Isolate before work (Block 5)
Before working on a light fitting, the correct sequence is:
- A) Work fast so the power's off for less time.
- ✅ B) Assess → isolate the power → verify it's dead with a tester → then work.
- C) Isolate only if the customer asks.
- D) Turn it off at the switch and start.

### Q4 — Breakage, customer not home (Block 8) — *keystone scenario*
You crack a customer's floor tile mid-job. They're not home.
- A) Finish the job and hope they don't notice.
- B) Try to fix it yourself and say nothing.
- ✅ C) Stop, make the area safe, and report it to ops straight away with photos.
- D) Leave a note and carry on.

### Q5 — Job bigger than quoted (Block 8)
Halfway in, you realise the job is far bigger than what was quoted.
- A) Agree a new price with the customer on the spot.
- B) Do as much as the quote covers and leave the rest.
- ✅ C) Stop and tell ops before proceeding — ops sets price and scope, you deliver quality.
- D) Absorb it to keep the customer happy.

### Q6 — Leaving a site safe (Block 6)
You've finished but you're running late for the next job.
- A) Leave tools out — you'll be quick next time.
- ✅ B) Clear trip hazards, tuck cables, remove anything sharp — especially around children/pets — then leave.
- C) Only tidy if the customer is watching.
- D) Cleaning up is the customer's responsibility.

### Q7 — Guest in the home (Block 7)
The customer's home has pale carpets and you need to move a chair to reach the work.
- A) Move whatever you need — you're working.
- ✅ B) Boots off or covers on, and ask before moving their belongings.
- C) Move the chair; ask about the carpets later.
- D) Only use covers if it's raining outside.

### Q8 — Photo proof (Block 9)
When are job photos required?
- A) Only if the customer requests them.
- B) Only the "after" shot.
- ✅ C) Before, during (where relevant), and after — no photos, no proof, no payment.
- D) Only on landlord jobs.

### Q9 — Injury on site (Block 8)
You cut yourself and it's bleeding more than expected.
- ✅ A) Stop, make yourself and the area safe, get first aid, and tell ops immediately.
- B) Wrap it and push through to finish.
- C) Finish first, report at the end of the day.
- D) Only report it if you need time off.

### Q10 — The core rule (Block 10)
Which single sentence captures the "when it goes wrong" rule?
- A) Fix it quietly and move on.
- B) Ask the customer what they'd prefer.
- ✅ C) Stop, make it safe, and tell us straight away — never hide it, never guess.
- D) Report it at your next login.

---

**Scoring/storage:** `contractor_training_progress(userId, moduleId='compliance', score, attempts, passedAt, expiresAt)`. On pass, set `expiresAt = passedAt + 12 months`. On expiry, `certs current?` check flips false → dashboard hard-redirects back to this module.
