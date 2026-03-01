# Twilio WhatsApp Content Templates

**Platform**: Handy Services -- Landlord Platform
**WhatsApp Number**: +15558874602
**Language**: en_GB (British English)
**Purpose**: Messages sent outside the WhatsApp 24-hour session window
**Submission**: Twilio Console > Messaging > Content Editor

---

## Table of Contents

1. [Tenant Templates (1--6)](#tenant-templates)
2. [Landlord Templates (7--12)](#landlord-templates)
3. [Proactive Templates (13--15)](#proactive-templates)
4. [Approval Tips](#meta-approval-tips)

---

## Tenant Templates

### 1. tenant_welcome

| Field        | Value                      |
|--------------|----------------------------|
| **Name**     | `tenant_welcome`           |
| **Category** | UTILITY                    |
| **Language** | en_GB                      |
| **Header**   | None                       |
| **Footer**   | Handy Services, Nottingham |
| **Buttons**  | None                       |

**Body:**

```
Hi {{1}}, welcome to Handy Services.

You've been registered at {{2}}. If something in your home needs fixing, simply reply to this number with a description of the issue and we'll get it sorted.

What to expect:
- We'll confirm your request within 1 working day
- You'll receive updates at each stage
- A contractor will be arranged at a time that works for you

If you have an urgent issue (e.g. leak, no heating, no hot water), reply URGENT followed by the problem.
```

**Sample Values:**

| Variable | Sample          |
|----------|-----------------|
| {{1}}    | Sarah           |
| {{2}}    | 14 Elm Street, NG7 2AA |

---

### 2. issue_status_update

| Field        | Value                      |
|--------------|----------------------------|
| **Name**     | `issue_status_update`      |
| **Category** | UTILITY                    |
| **Language** | en_GB                      |
| **Header**   | None                       |
| **Footer**   | Handy Services, Nottingham |
| **Buttons**  | None                       |

**Body:**

```
Hi {{1}}, here's an update on your reported issue.

Issue: {{2}}
Status: {{3}}

We'll notify you of any further changes. If you have questions, reply to this message.
```

**Sample Values:**

| Variable | Sample                        |
|----------|-------------------------------|
| {{1}}    | Sarah                         |
| {{2}}    | Kitchen tap leaking           |
| {{3}}    | Contractor assigned -- awaiting schedule confirmation |

---

### 3. contractor_assigned

| Field        | Value                      |
|--------------|----------------------------|
| **Name**     | `contractor_assigned`      |
| **Category** | UTILITY                    |
| **Language** | en_GB                      |
| **Header**   | None                       |
| **Footer**   | Handy Services, Nottingham |
| **Buttons**  | None                       |

**Body:**

```
Hi {{1}}, a contractor has been assigned to your issue.

Contractor: {{2}}
Issue: {{3}}
Date: {{4}}
Time window: {{5}}

Please make sure someone is available to provide access. If this time doesn't work, reply to this message and we'll rearrange.
```

**Sample Values:**

| Variable | Sample                |
|----------|-----------------------|
| {{1}}    | Sarah                 |
| {{2}}    | Mike R.               |
| {{3}}    | Kitchen tap leaking   |
| {{4}}    | Monday 10 March       |
| {{5}}    | 9:00 AM -- 12:00 PM  |

---

### 4. appointment_reminder

| Field        | Value                      |
|--------------|----------------------------|
| **Name**     | `appointment_reminder`     |
| **Category** | UTILITY                    |
| **Language** | en_GB                      |
| **Header**   | None                       |
| **Footer**   | Handy Services, Nottingham |
| **Buttons**  | Quick Reply: `Confirm`, `Reschedule` |

**Body:**

```
Hi {{1}}, this is a reminder that your appointment is tomorrow.

Issue: {{2}}
Date: {{3}}
Time window: {{4}}

Please ensure access to the property is available. If you need to reschedule, reply to this message as soon as possible.
```

**Sample Values:**

| Variable | Sample               |
|----------|----------------------|
| {{1}}    | Sarah                |
| {{2}}    | Kitchen tap leaking  |
| {{3}}    | Monday 10 March      |
| {{4}}    | 9:00 AM -- 12:00 PM |

---

### 5. job_complete_tenant

| Field        | Value                      |
|--------------|----------------------------|
| **Name**     | `job_complete_tenant`      |
| **Category** | UTILITY                    |
| **Language** | en_GB                      |
| **Header**   | None                       |
| **Footer**   | Handy Services, Nottingham |
| **Buttons**  | None                       |

**Body:**

```
Hi {{1}}, the following issue has been marked as complete:

{{2}}

If the work hasn't been done to your satisfaction or you notice any problems, please reply to this message within 48 hours and we'll arrange a follow-up at no extra cost.
```

**Sample Values:**

| Variable | Sample              |
|----------|---------------------|
| {{1}}    | Sarah               |
| {{2}}    | Kitchen tap leaking |

---

### 6. satisfaction_survey

| Field        | Value                      |
|--------------|----------------------------|
| **Name**     | `satisfaction_survey`      |
| **Category** | UTILITY                    |
| **Language** | en_GB                      |
| **Header**   | None                       |
| **Footer**   | Handy Services, Nottingham |
| **Buttons**  | None                       |

**Body:**

```
Hi {{1}}, we'd love your feedback on the recent work completed:

{{2}}

How would you rate the service? Reply with a number from 1 to 5:

1 - Poor
2 - Below average
3 - Average
4 - Good
5 - Excellent

Your feedback helps us maintain quality for you and your neighbours.
```

**Sample Values:**

| Variable | Sample              |
|----------|---------------------|
| {{1}}    | Sarah               |
| {{2}}    | Kitchen tap leaking |

---

## Landlord Templates

### 7. landlord_new_issue

| Field        | Value                      |
|--------------|----------------------------|
| **Name**     | `landlord_new_issue`       |
| **Category** | UTILITY                    |
| **Language** | en_GB                      |
| **Header**   | None                       |
| **Footer**   | Handy Services, Nottingham |
| **Buttons**  | URL: `View dashboard` -- `{{4}}` |

**Body:**

```
New issue reported at {{1}}.

Issue: {{2}}
Urgency: {{3}}

View full details and take action on your dashboard.
```

**Sample Values:**

| Variable | Sample                                              |
|----------|-----------------------------------------------------|
| {{1}}    | 14 Elm Street, NG7 2AA                              |
| {{2}}    | Bathroom extractor fan not working                  |
| {{3}}    | Standard                                            |
| {{4}}    | https://app.handyservices.co.uk/landlord/issues/142 |

---

### 8. landlord_approval_request

| Field        | Value                      |
|--------------|----------------------------|
| **Name**     | `landlord_approval_request`|
| **Category** | UTILITY                    |
| **Language** | en_GB                      |
| **Header**   | None                       |
| **Footer**   | Handy Services, Nottingham |
| **Buttons**  | Quick Reply: `Approve`, `Decline`, `Call me` |

**Body:**

```
Approval needed for a job at {{1}}.

Issue: {{2}}
Estimated cost: {{3}}

Reply APPROVE to go ahead, DECLINE to cancel, or CALL ME and we'll ring you to discuss.
```

**Sample Values:**

| Variable | Sample                             |
|----------|------------------------------------|
| {{1}}    | 14 Elm Street, NG7 2AA            |
| {{2}}    | Bathroom extractor fan not working |
| {{3}}    | £80 -- £120                       |

---

### 9. landlord_auto_dispatch

| Field        | Value                      |
|--------------|----------------------------|
| **Name**     | `landlord_auto_dispatch`   |
| **Category** | UTILITY                    |
| **Language** | en_GB                      |
| **Header**   | None                       |
| **Footer**   | Handy Services, Nottingham |
| **Buttons**  | Quick Reply: `OK`, `Hold job` |

**Body:**

```
A job has been auto-dispatched under your standing instructions.

Property: {{1}}
Issue: {{2}}
Scheduled: {{3}}
Cost: {{4}}

If you'd like to pause auto-dispatch for future jobs, reply STOP.
```

**Sample Values:**

| Variable | Sample                             |
|----------|------------------------------------|
| {{1}}    | 14 Elm Street, NG7 2AA            |
| {{2}}    | Dripping kitchen tap              |
| {{3}}    | Wednesday 12 March, AM            |
| {{4}}    | £75                               |

---

### 10. landlord_job_complete

| Field        | Value                      |
|--------------|----------------------------|
| **Name**     | `landlord_job_complete`    |
| **Category** | UTILITY                    |
| **Language** | en_GB                      |
| **Header**   | None                       |
| **Footer**   | Handy Services, Nottingham |
| **Buttons**  | URL: `View photos` -- `{{4}}` |

**Body:**

```
Job completed at {{1}}.

Issue: {{2}}
Final cost: {{3}}

Before and after photos are available for your records. A tax-ready invoice will follow by email.
```

**Sample Values:**

| Variable | Sample                                                |
|----------|-------------------------------------------------------|
| {{1}}    | 14 Elm Street, NG7 2AA                                |
| {{2}}    | Bathroom extractor fan not working                    |
| {{3}}    | £95                                                   |
| {{4}}    | https://app.handyservices.co.uk/landlord/photos/142   |

---

### 11. payment_confirmation

| Field        | Value                      |
|--------------|----------------------------|
| **Name**     | `payment_confirmation`     |
| **Category** | UTILITY                    |
| **Language** | en_GB                      |
| **Header**   | None                       |
| **Footer**   | Handy Services, Nottingham |
| **Buttons**  | None                       |

**Body:**

```
Payment received -- thank you.

Amount: {{1}}
Job: {{2}}
Reference: {{3}}

A receipt has been sent to your email address. If you have any queries about this payment, reply to this message.
```

**Sample Values:**

| Variable | Sample                             |
|----------|------------------------------------|
| {{1}}    | £95.00                             |
| {{2}}    | Bathroom extractor fan replacement |
| {{3}}    | INV-2026-0342                      |

---

### 12. balance_reminder

| Field        | Value                      |
|--------------|----------------------------|
| **Name**     | `balance_reminder`         |
| **Category** | UTILITY                    |
| **Language** | en_GB                      |
| **Header**   | None                       |
| **Footer**   | Handy Services, Nottingham |
| **Buttons**  | URL: `Pay now` -- `{{4}}`  |

**Body:**

```
You have an outstanding balance for completed work.

Amount due: {{1}}
Job: {{2}}
Property: {{3}}

You can pay securely using the link below. If you believe this has been sent in error, reply to this message.
```

**Sample Values:**

| Variable | Sample                                                 |
|----------|--------------------------------------------------------|
| {{1}}    | £95.00                                                 |
| {{2}}    | Bathroom extractor fan replacement                     |
| {{3}}    | 14 Elm Street, NG7 2AA                                 |
| {{4}}    | https://app.handyservices.co.uk/pay/inv-2026-0342      |

---

## Proactive Templates

### 13. quarterly_maintenance

| Field        | Value                      |
|--------------|----------------------------|
| **Name**     | `quarterly_maintenance`    |
| **Category** | MARKETING                  |
| **Language** | en_GB                      |
| **Header**   | None                       |
| **Footer**   | Reply STOP to opt out      |
| **Buttons**  | Quick Reply: `Yes please`, `Not now` |

**Body:**

```
Hi {{1}}, it's time for a seasonal property check.

We can inspect {{2}} for common issues like damp, guttering, boiler readiness, and general wear -- helping you catch small problems before they become expensive ones.

A standard check takes about 1 hour and starts from £65.

Reply YES to book or NOT NOW to skip this quarter.

To stop receiving these reminders, reply STOP.
```

**Sample Values:**

| Variable | Sample               |
|----------|----------------------|
| {{1}}    | James                |
| {{2}}    | 14 Elm Street, NG7 2AA |

---

### 14. monthly_summary

| Field        | Value                      |
|--------------|----------------------------|
| **Name**     | `monthly_summary`          |
| **Category** | UTILITY                    |
| **Language** | en_GB                      |
| **Header**   | None                       |
| **Footer**   | Handy Services, Nottingham |
| **Buttons**  | URL: `View dashboard` -- `{{4}}` |

**Body:**

```
Hi {{1}}, here's your monthly summary.

Jobs completed: {{2}}
Total spend: {{3}}

View your full breakdown, invoices, and photos on your dashboard.
```

**Sample Values:**

| Variable | Sample                                              |
|----------|-----------------------------------------------------|
| {{1}}    | James                                               |
| {{2}}    | 3                                                   |
| {{3}}    | £245.00                                             |
| {{4}}    | https://app.handyservices.co.uk/landlord/summary    |

---

### 15. emergency_escalation

| Field        | Value                      |
|--------------|----------------------------|
| **Name**     | `emergency_escalation`     |
| **Category** | UTILITY                    |
| **Language** | en_GB                      |
| **Header**   | None                       |
| **Footer**   | Handy Services, Nottingham |
| **Buttons**  | Quick Reply: `Go ahead`, `Hold`, `Call me` |

**Body:**

```
URGENT: An issue at {{1}} requires your attention.

Issue: {{2}}

We've attempted to reach you and haven't had a response. To avoid further damage or tenant disruption, we may need to proceed.

Reply GO AHEAD to authorise the repair, HOLD to pause, or CALL ME and we'll ring you now.
```

**Sample Values:**

| Variable | Sample                          |
|----------|---------------------------------|
| {{1}}    | 14 Elm Street, NG7 2AA         |
| {{2}}    | Burst pipe in upstairs bathroom |

---

## Meta Approval Tips

### General Guidelines

- **UTILITY** templates must be purely transactional. No promotional language, no upselling, no discounts.
- **MARKETING** templates must include an opt-out instruction (e.g. "Reply STOP to opt out").
- Keep body text under 1024 characters.
- Sample values must be realistic -- Meta reviewers check these.
- Avoid ALL CAPS except where it serves as a clear action keyword (e.g. URGENT, STOP, APPROVE).
- Do not use emoji excessively -- one or two is fine, none is safer.
- Do not include URLs in the body text; use URL buttons instead where possible.

### Quick Reply Buttons

- Maximum 3 buttons per template.
- Maximum 20 characters per button label.
- Labels should be clear, actionable, and distinct.

### URL Buttons

- Maximum 2 URL buttons per template.
- URL can contain a single {{1}} variable for dynamic paths.
- Button text maximum 20 characters.

### Common Rejection Reasons

1. **Promotional language in UTILITY template** -- phrases like "special offer", "discount", "limited time" will be rejected.
2. **Missing opt-out in MARKETING template** -- always include STOP instructions.
3. **Unrealistic sample values** -- use plausible names, addresses, and amounts.
4. **Too many variables** -- keep it simple. If you need more than 5 variables, consider splitting into multiple templates.
5. **Aggressive or threatening tone** -- even payment reminders must be neutral and professional.
6. **Duplicate templates** -- Meta may reject if an existing approved template covers the same use case.

### Submission Checklist

- [ ] Template name is snake_case, under 512 characters
- [ ] Category is correct (UTILITY vs MARKETING)
- [ ] Language set to en_GB
- [ ] Body is under 1024 characters
- [ ] All variables have realistic sample values
- [ ] MARKETING templates include opt-out instruction
- [ ] Quick reply buttons are under 20 characters each
- [ ] No promotional language in UTILITY templates
- [ ] URLs are in buttons, not body text (where possible)
- [ ] Tone is professional and neutral
