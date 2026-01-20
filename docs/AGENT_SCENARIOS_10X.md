# 10x Agent Scenarios: The "Francis Flow" in Action

This document demonstrates how the Agentic Brain ("Francis") processes 10 distinct scenarios, covering the full spectrum of your business inputs.

---

## Scenario 1: The "Happy Path" (Simple Fix)
**Input (Web Form)**: "I have a dripping kitchen tap. It's driving me mad. Please help."
**Input Analysis**:
- **Intent**: Service Request
- **Urgency**: Low (Annoyance)
- **SKU**: `TAP-REP-01` (Replace Tap Washer/Cartridge) - Confidence 92%
**Agent Decision**: `CREATE_QUOTE` (Route: Instant Price)
**Outcome (Inbox)**:
- **Card**: "Send Quote"
- **Reason**: "Standard job detected."
- **Payload**: Pre-filled Quote for £125 (Essential) to £185 (Hassle-Free).

---

## Scenario 2: The "Emergency" (Burst Pipe)
**Input (Voice)**: "Help! Water is pouring through my ceiling! I can't find the stopcock!"
**Input Analysis**:
- **Intent**: Emergency
- **Urgency**: **HIGH** (Flooding)
- **SKU**: `LEAK-EMERGENCY` - Confidence 88%
**Agent Decision**: `CREATE_QUOTE` (Route: Instant Price)
**Outcome (Inbox)**:
- **Card**: "Send Quote" (High Priority)
- **Reason**: "Active leak detected."
- **Payload**: Quote with **1.3x Emergency Multiplier**. Price: £220+ (Priority Dispatch).

---

## Scenario 3: The "Commercial Client" (Property Manager)
**Input (Email/Web)**: "Hi, this is Sarah from Dexters. Flat 4B has a broken extractor fan. Tenant reports it's noisy."
**Input Analysis**:
- **Client Type**: **Commercial** (Keywords: Dexters, Tenant, Flat)
- **SKU**: `EXTRACTOR-REP-01`
**Agent Decision**: `BOOK_VISIT` (Route: Mixed/Commercial)
**Outcome (Inbox)**:
- **Card**: "Book Visit"
- **Reason**: "Commercial Client (Dexters) requires standard work order process."
- **Payload**: Pre-filled "Diagnostic Visit" link (£85 Call-out).

---

## Scenario 4: The "Vague Description" (Video Request)
**Input (Voice)**: "There's a weird noise coming from the boiler cupboard. It sounds like a clicking."
**Input Analysis**:
- **Intent**: Inquiry
- **SKU**: None (Confidence < 40%)
- **Context**: "Noise", "Clicking" (implies diagnosis needed).
**Agent Decision**: `REQUEST_VIDEO` (Route: Visual Check)
**Outcome (Inbox)**:
- **Card**: "Request Video"
- **Reason**: "Diagnosis required. Audio description insufficient."
- **Payload**: Draft WhatsApp: *"Hi [Name], to diagnose that boiler noise accurately, could you send a quick video recording of the sound?"*

---

## Scenario 5: The "Complex Project" (Multiple Tasks)
**Input (Web)**: "I need 3 curtain rails put up, a tv mounted on the wall, and some shelves in the alcove."
**Input Analysis**:
- **Tasks**: `HANDY-GNR-01` (Curtains) + `TV-MOUNT` + `SHELVING-CUSTOM`.
- **Complexity**: High (Custom shelves implies measurements).
**Agent Decision**: `BOOK_VISIT` (Route: Mixed Quote)
**Outcome (Inbox)**:
- **Card**: "Book Visit"
- **Reason**: "Multiple disparate tasks including custom work (shelves)."
- **Payload**: `visitReason`: "Assessment for multi-trade job: Curtains, TV, Custom Shelving."

---

## Scenario 6: The "Weekend Warrior" (Availability Check)
**Input (WhatsApp)**: "Can you come this Saturday to fix a light switch?"
**Input Analysis**:
- **Timeframe**: **Specific Date** (Saturday).
- **SKU**: `ELEC-SWITCH-01`.
**Agent Decision**: `CREATE_QUOTE` (Route: Instant)
**Outcome (Inbox)**:
- **Card**: "Send Quote"
- **Reason**: "Standard job."
- **Payload**: Quote includes **Weekend Surcharge** (if configured in Pricing Engine).

---

## Scenario 7: The "Price Shopper" (Inquiry)
**Input (Voice)**: "How much do you charge to paint a hallway?"
**Input Analysis**:
- **Intent**: Inquiry
- **SKU**: `DEC-PAINT-ROOM` (Variable pricing).
**Agent Decision**: `CREATE_QUOTE` (Route: Consultation)
**Outcome (Inbox)**:
- **Card**: "Send Quote" (Mode: Rate Card / Estimate)
- **Reason**: "Variable scope (Hallway size unknown)."
- **Payload**: Sends "Rate Card" quote (e.g., "From £250/day").

---

## Scenario 8: The "Spam/Sales" Call
**Input (Voice)**: "We are calling about your Google Business Listing optimization..."
**Input Analysis**:
- **Intent**: **Spam**
- **SKU**: None.
**Agent Decision**: `ARCHIVE`
**Outcome (Inbox)**:
- **Card**: "Archive Thread"
- **Reason**: "Solicitation detected."
- **Action**: Auto-moves to "Done" (or asks human to confirm).

---

## Scenario 9: The "Repeat Customer" (Recall)
**Input (WhatsApp)**: "Hi, it's John from 52 Acacia Ave. The tap you fixed is dripping again."
**Input Analysis**:
- **Intent**: Complaint / Warranty
- **Context**: "Again", "Fixed".
**Agent Decision**: `BOOK_VISIT` (Route: Warranty)
**Outcome (Inbox)**:
- **Card**: "Book Visit" (Priority: Critical)
- **Reason**: "Potential Warranty Recall."
- **Payload**: `visitReason`: "Warranty Re-visit: Recurrence of tap issue."

---

## Scenario 10: The "Flatpack Nightmare"
**Input (Web)**: "I have an IKEA Pax wardrobe to assemble. It's the big corner one."
**Input Analysis**:
- **SKU**: `FURNITURE-PAX-LG`.
- **Context**: "Corner", "Big" (implies 2 people needed).
**Agent Decision**: `CREATE_QUOTE` (Route: Instant)
**Outcome (Inbox)**:
- **Card**: "Send Quote"
- **Reason**: "Standard but heavy job."
- **Payload**: Quote automatically selects **2-Man Team** pricing tier.
