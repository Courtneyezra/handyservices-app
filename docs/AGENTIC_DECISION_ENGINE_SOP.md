# SOP: The AI Decision Engine ("The D in DOE")

## Overview
This document defines the **Decision Logic** (SOP) used by the AI Agent ("Francis") to determine the Next Best Action. This is the "Brain" logic that runs before any tool is executed.

**File Reference**: `server/services/agentic-service.ts` (Orchestrator) & `server/skuDetector.ts` (Analyzer).

---

## 1. Input Analysis (The "Listen" Phase)
**Objective**: Convert unstructured text (transcript, message) into structured signals.

### Step A: Context Extraction (LLM Prompt)
The AI analyzes the raw text to extract 5 key signals:
1.  **Urgency**: `Low` | `Medium` | `High` (e.g., "Leaking now" = High).
2.  **Ownership**: `Homeowner` | `Tenant` | `Landlord` (affects pricing risk).
3.  **Timeframe**: `ASAP` | `Flex` | `Specific Date`.
4.  **Client Type**: `Residential` | `Commercial`.
5.  **Intent**: `Service Request` | `Emergency` | `Inquiry` | `Spam`.

### Step B: Task Decomposition (Skill: SKU Detector)
The AI breaks the text into atomic tasks and attempts to match them to the Price Book (SKUs).
- **Rule**: If >1 distinct task, split them (e.g., "Fix tap and hang TV" → 2 items).
- **Rule**: Match Confidence > 80% required for "Instant Price".

---

## 2. The Decision Matrix (The "Think" Phase)

Based on the signals, the Agent selects one of three **Routes**:

### Route A: "Create Quote" (The Happy Path)
**Criteria**:
- [x] SKU(s) detected with High Confidence (>80%).
- [x] Scope is clear (e.g., "Replace 1 Kitchen Tap").
- [x] No "Complex" keywords found (e.g., "Diagnosis", "Not sure", "Weird noise").

**Decision**:
- **Action**: Generate Pre-filled Quote.
- **Pricing**: Apply Dynamic Multiplier based on Urgency (e.g., 1.3x for Emergency).
- **Outcome**: Present "Send Quote" card to Dispatcher.

### Route B: "Request Video" (The Safety Net)
**Criteria**:
- [ ] SKU detected but Confidence is Low (<80%).
- [ ] Task is vague (e.g., "It's broken").
- [ ] Keywords imply visual need: "It looks weird", "Hard to explain", "Custom size".

**Decision**:
- **Action**: Request Video Review.
- **Draft Message**: "Hi [Name], to give you an accurate price, could you send a quick video of the issue?"
- **Outcome**: Present "Request Video" card to Dispatcher.

### Route C: "Book Visit" (The Complex Path)
**Criteria**:
- [ ] Client Type is `Commercial` (Always visit first).
- [ ] Mulitple disparate tasks (Complex Project).
- [ ] "Diagnosis" required (e.g., "Leak coming from ceiling").

**Decision**:
- **Action**: Book Diagnostic Visit.
- **Fee**: Quote standard "Call Out Fee" (£85).
- **Outcome**: Present "Book Visit" card to Dispatcher.

---

## 3. Reflexion & Self-Correction
**Rule**: If the Dispatcher (Human) *rejects* the proposal (e.g., Agent said "Quote" but Human clicked "Request Video"), the Agent logs this as a **Failure**.
- **Correction**: The system lowers the confidence score for similar phrases in the future.

---

## 4. Execution (The "Act" Phase)
Once the Decision is made, the Agent prepares the **Payload** for the Orchestrator:
```json
{
  "recommendedAction": "create_quote",
  "priority": "high",
  "draftReply": "Hi Jane, I can help with that leaking tap...",
  "payload": {
    "sku": "TAP-REP-01",
    "price": 12500
  }
}
```
This payload is what populates the **Inline Card** in the Inbox.
