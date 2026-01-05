# Agentic Workflow Implementation Proposal

Based on the [System Overview](../docs/SYSTEM_OVERVIEW.md) and analysis of the current server codebase, here are four high-impact areas to implement **Agentic Workflows** to meet your goals of Autonomy, Productivity, Conversion, and Communication.

## Core Concept: The "Agent Loop"
Currently, the system is **Reactive** (Event -> Rule -> Action).
The proposed "Agentic" system is **Proactive** (Goal -> Plan -> Action -> Verify -> Adjust).

---

## 1. Contractor Operations Agent (Autonomy)
**Goal**: Reduce the manual effort of calling/messaging contractors to fill jobs.

### Current Implementation (`server/job-routes.ts`)
- Jobs sit in `pending` status until a contractor manually accepts or an admin manually assigns.
- Relies on contractors checking the app.

### Proposed Agentic Workflow
1.  **Trigger**: New Job created with status `pending`.
2.  **Agent Action**:
    *   **Analyze**: Look up job location and required skills.
    *   **Search**: Query `handymanProfiles` for contractors within X miles who are "available".
    *   **Outreach**: Send WhatsApp/SMS to the top 3 matches: *"New job in [Area]: [Description]. Pay: £[Amount]. Reply YES to accept."*
    *   **Negotiate**: If no one accepts in 1 hour, expand search radius or slightly increase payout (within pre-approved margin).
    *   **Finalize**: When a contractor replies "YES", call `POST /api/contractor/jobs/:id/accept` and notify the customer.

---

## 2. Quote Conversion Agent (Increase Conversions)
**Goal**: Move from "sending quotes" to "closing deals".

### Current Implementation (`server/quote-engine.ts`)
- Calculates a score -> Recommends a type -> Generates a price/PDF.
- Fire and forget.

### Proposed Agentic Workflow
1.  **Trigger**: Quote sent (`status: sent`).
2.  **Agent Action (The "Chaser")**:
    *   **Monitor**: Check if quote has been viewed (via tracking pixel or similar).
    *   **Nudge 1 (24h)**: If not viewed, send WhatsApp: *"Hi [Name], just checking you received our quote for [Job]?"*
    *   **Nudge 2 (48h)**: If viewed but not accepted, send: *"Hi [Name], do you have any questions about the quote? I can clarify the pricing."*
    *   **Closer**: If customer asks a question via WhatsApp, use RAG (Retrieval Augmented Generation) to answer distinct questions about the quote content.
    *   **Offer**: If still stalled, Agent can autonomously offer a "5% discount if booked today" (Dynamic Incentive).

---

## 3. Lead Triage & Communication Agent (Better Lead Communication)
**Goal**: Instant, intelligent response to every inbound message, 24/7.

### Current Implementation (`server/meta-whatsapp.ts`)
- Receives message -> Broadcasts to Dashboard.
- Waits for human Operator to reply.

### Proposed Agentic Workflow
1.  **Trigger**: Inbound WhatsApp message.
2.  **Agent Action**:
    *   **Classify**: Is this a New Lead, Existing Customer, or Contractor?
    *   **Draft**: fast-draft a response in the database (`messages` table, status `draft`).
    *   **Auto-Reply (Confidence High)**: If it's a standard FAQ ("Do you cover London?", "What are your rates?"), Agent sends reply immediately.
    *   **Escalate (Confidence Low)**: If complex ("My boiler is making a weird clanking sound and leaking blue fluid"), Agent marks conversation as `URGENCY: HIGH` and pings the human dashboard with a summary.
    *   **Schedule**: If customer says "Can you come Tuesday?", Agent checks calendar availability and proposes slots.

---

## 4. Pricing Reflexion Agent (Productivity & Optimization)
**Goal**: Self-improving pricing model that maximizes revenue.

### Current Implementation (`server/value-pricing-engine.ts`)
- Uses static multipliers (`URGENCY_MULTIPLIERS`, `TIER_RATIOS`) defined in code.
- Config is hardcoded or manually updated.

### Proposed Agentic Workflow
1.  **Job**: Runs nightly.
2.  **Agent Action**:
    *   **Review**: Analyze the last 30 days of quotes.
    *   **Insight**: "We are losing 80% of 'High Urgency' quotes. Our 1.3x multiplier might be too aggressive."
    *   **Experiment**: "Propose lowering Urgency Multiplier to 1.25x for the next 7 days."
    *   **Notify**: Send report to Admin: *"I suggest lowering urgent pricing by 5% to boost conversion. [Approve/Reject]"*
    *   **Update**: If approved, Agent updates `QuoteEngineConfig` in the database dynamically.

---

## Implementation Map

| Workflow | Key Files to Modify | Complexity |
| :--- | :--- | :--- |
| **Contractor Ops** | `server/job-routes.ts`, `server/scheduler.ts` (New) | High |
| **Quote Conversion** | `server/quote-engine.ts`, `server/cron-jobs.ts` (New) | Medium |
| **Lead Triage** | `server/meta-whatsapp.ts`, `server/chat-agent.ts` (New) | Medium |
| **Pricing Reflexion** | `server/value-pricing-engine.ts`, `server/analytics.ts` (New) | High |
