# Call Qualification Script

## Goal: In 60 seconds, know if HOT/WARM/COLD + which segment

---

## THE SCRIPT

### OPENING
```
"Hi, thanks for calling Handy Services! I'm [name].
What do you need help with today?"
```

**LISTEN FOR:**
- Specific job (tap repair, door hanging) = GOOD
- Vague ("various things", "few bits") = RED FLAG

---

### QUESTION 2: URGENCY
```
"Got it. And when do you need this done?"
```

| They Say | Score | Note |
|----------|-------|------|
| "Today" / "ASAP" / "Emergency" | +25 | HOT signal |
| "This week" / "Next few days" | +10 | WARM |
| "Whenever" / "No rush" / "Just planning" | -10 | COLD signal |

---

### QUESTION 3: PROPERTY TYPE
```
"Is this your own home, a rental you own, or a rental you live in?"
```

| They Say | Segment | Score |
|----------|---------|-------|
| "My own home" | DEFAULT | +10 |
| "Rental I own" / "Buy to let" | **LANDLORD** | +15 |
| "I'm a tenant" | RENTER | -10 (check authority) |

**IF RENTAL OWNER → Ask Q4**

---

### QUESTION 4: PORTFOLIO SIZE (Only if rental owner)
```
"Do you manage other properties too, or just this one?"
```

| They Say | Segment |
|----------|---------|
| "Just this one" | LANDLORD |
| "I've got X properties" / "A few" | **PROP_MGR** |
| "I'm an agent" / "Property management" | **PROP_MGR** |

---

### QUESTION 5: BUSINESS CHECK
```
"Is this for home or for a business?"
```

| They Say | Segment | Score |
|----------|---------|-------|
| "Business" / "Shop" / "Office" | **SMALL_BIZ** | +10 |
| "Home" | Continue | - |

---

### QUESTION 6: POSTCODE
```
"What's your postcode?"
```

| Result | Action |
|--------|--------|
| In area (NG, DE, LE) | +10, continue |
| Out of area | Polite decline: "Sorry, we don't cover that area" |

---

### QUESTION 7: DIY ATTEMPT (Optional)
```
"Have you had a go at fixing it yourself?"
```

| They Say | Segment Signal |
|----------|----------------|
| "Yes, made it worse" / "Tried but..." | **DIY_DEFERRER** |
| "No" | Continue |

---

### QUESTION 8: BUSY CHECK (If they seem rushed)
```
"Are you at work? Want us to text you instead?"
```

| They Say | Segment Signal |
|----------|----------------|
| "Yes, really busy" / "Can you text?" | **BUSY_PRO** |

---

## DECISION TREE (60 seconds in)

### Calculate Score
Start at 50, add/subtract based on answers above.

| Score | Grade | Action |
|-------|-------|--------|
| **70+** | HOT | "Let me get some details and we'll get you sorted today" |
| **40-69** | WARM | "I'll send you a quote within the hour" |
| **<40** | COLD | "Thanks! We'll send you our info" (end call) |

---

## RED FLAGS (End call quickly)

| They Say | Response | Why |
|----------|----------|-----|
| "Just getting prices" | "I'll text you our rate card" | Price shopping |
| "Can you give me a rough idea?" | "Need to see it first, minimum is £85" | Won't commit |
| "I've had 5 quotes already" | "Good luck with your search" | Price shopper |
| "My landlord will decide" | "Get your landlord to call us" | No authority |
| "What's your hourly rate?" | "We quote per job, not hourly" | Price focused |

---

## GREEN FLAGS (Invest time)

| They Say | Score | Why |
|----------|-------|-----|
| "Can you come today/tomorrow?" | +25 | Urgent = will pay |
| "How quickly can you get here?" | +20 | Ready to book |
| "I've got a few jobs actually" | +15 | Higher value |
| "I just want it sorted" | +15 | Not price shopping |
| "Money's not the issue" | +20 | Will pay premium |
| "Someone recommended you" | +10 | Referral |

---

## SEGMENT QUICK REFERENCE

| Segment | Key Signals | Value |
|---------|-------------|-------|
| **LANDLORD** | "My rental", "tenant", "buy to let", 1-3 properties | HIGH |
| **PROP_MGR** | Multiple properties, agency, portfolio | HIGHEST |
| **BUSY_PRO** | At work, time-poor, "fit me in", convenience | HIGH |
| **SMALL_BIZ** | Shop, office, commercial premises | HIGH |
| **DIY_DEFERRER** | "Tried myself", "made it worse", YouTube failed | MEDIUM |
| **BUDGET** | "Cheapest", "tight budget", price focused | LOW |
| **RENTER** | Tenant, needs landlord approval | LOW |
| **DEFAULT** | Standard homeowner | MEDIUM |

---

## CLOSING SCRIPTS

### HOT Lead (70+)
```
"Perfect, let me grab a few more details and we'll get someone out to you.
What's the best number to reach you on?
And the full address for the job?"
```

### WARM Lead (40-69)
```
"Great, I'll put together a quote and send it over to you within the hour.
What's the best number to text it to?
And just confirm your postcode for me?"
```

### COLD Lead (<40)
```
"Thanks for calling. We're quite busy at the moment but I'll send over
our info. Give us a call back when you're ready to book."
```

### Out of Area
```
"Sorry, we don't cover that area at the moment.
You might want to try Checkatrade or MyBuilder for your area."
```

---

## AFTER THE CALL

The AI will automatically:
1. Analyze the transcript
2. Calculate qualification score
3. Detect segment
4. Update the lead in the system

You'll see the lead appear in the Tube Map with:
- HOT (red badge) / WARM (amber) / COLD (grey)
- Segment tag
- Next action required
