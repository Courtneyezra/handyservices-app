# Brief: interactive walkthrough (pane top-right)

You are one of three panes modelling a comms system BEFORE it is built, for a non-developer owner. Read /Users/courtneebonnick/v6-switchboard/docs/COMMS_AGENTS_V3_DESIGN.md first (sections 3, 4, 5, 10 matter most). The system: one customer = one conversation across WhatsApp, SMS, calls, email, web chat; an append-only ledger; a single gated outbox (sendCustomerMessage refuses without run_id + Approver); a rules layer (first-contact acks, photo/postcode asks, 20-min silence-breaker, template chases) that SENDS from day one; narrow AI roles (Triage/Sorter on Haiku, Scoper on Sonnet at DRAFT earning SEND per intent, Quote clerk PROPOSE incl. on call transcripts, Recovery PROPOSE, Verifier = 10% sampler); exceptions always to Ben (complaints, refunds, out-of-scope, any money figure, any date); one operator per city, city = a config record. Your output is ONE self-contained HTML fragment that I will paste into a master page: a single <section id="..."> with its own scoped CSS (prefix every class) in a <style> inside the section and any JS in an IIFE. Use ONLY the colour variables in /Users/courtneebonnick/v6-switchboard/docs/comms-model/tokens.css (do not redefine them; do not hardcode colours). No external libraries. Must read well in light and dark. Do not touch any other file in the repo, do not commit, do not run the app, do not query the database. When done, reply with the output path and a 5-line summary.

## Your deliverable
`/Users/courtneebonnick/v6-switchboard/docs/comms-model/walkthrough.html` — `<section id="walkthrough">`, classes prefixed `wt-`.

A scenario picker (buttons) and, for the chosen scenario, a step-by-step trace of the message through the desk. Each step is a row: stage name (Ingest → Claim → Case file → Triage → Policy pack → Worker → Guards → Decision → Outbox/Ben), what happened in plain English, and a small state chip (send / pending / flag / dropped). Below the trace, two panels side by side: "What the customer sees" (message bubbles with times) and "What Ben sees" (queue item or flag with due time, or nothing). A "Next" button can step through one stage at a time; a "Show all" reveals the full trace. Page loads with the first scenario fully shown (never an empty state).

Scenarios (write realistic Nottingham content, no real names, first names only, no prices or dates ever written by the system):
1. Saturday 21:30, first-ever WhatsApp: "Hi, need a couple of doors hung and a shelf up, NG5" → rules layer ack + ask for photos at 21:31; Scoper draft for Ben at 08:30 Monday; Ben sees a pending draft with a due time.
2. Missed call at 14:10 Tuesday → text-back template within 1 min → customer replies with photos → ack_photos template → Quote clerk pre-fills from the transcript + photos → Ben sees a quote card.
3. "How much roughly for the doors?" → Triage: money_question → flag to Ben with 4-working-hour due time; if Ben misses it, holding line at expiry.
4. "Can you do Thursday morning?" → date_question → flag; the system may only point to the quote page picker, never confirm.
5. Complaint: "the shelf you put up last week has come off the wall" → complaint exception → urgent flag, Ben's phone pinged, holding line if unanswered; no automated apology that admits fault.
6. Mid-scope reply: customer answers "yes both doors are internal, standard size" → Scoper ask_gap/confirm_received; at LAUNCH goes to Ben's queue, at MONTH 2 sends automatically. Show a toggle LAUNCH / MONTH 2 for this scenario.
7. Landlord email (subject "Quote for 14 Mansfield Rd") → email adapter → same conversation as their WhatsApp thread → Scoper draft; reply goes out by email.
8. Web chat at 11:00: "do you cover Derby?" → out-of-area check (covered) → rules ack + ask postcode.
9. Spam / out of UK number → dropped, nothing sent, logged.
10. Silence-breaker: Ben is on a job, customer sent a photo at 13:05, no reply by 13:25 → holding line sent, draft still waiting for Ben; show that if Ben replied from his personal number at 13:15 the holding line is suppressed.

Make the trace honest to the design: the rules layer is the only thing that sends at launch; every send carries a run id; every flag has a due time. Keep copy in Handy's voice: short, warm, no corporate phrases, no em dashes.
