# Data Flow: Contractor Workflows

**Status:** LIVING DOCUMENT
**Last Updated:** 2026-01-05
**Scope:** Contractor Portal Data Lifecycles

---

## 1. Onboarding Flow (The "Magic" Setup)
**Goal:** Convert a stranger into a "Deployable Asset" with SKUs.

1.  **User Input**: Name, Trade (e.g., Plumber), Hourly Rate (£80).
2.  **Wizard Processing**:
    *   Creates `users` record (Role: 'contractor').
    *   Creates `handyman_profiles` record.
    *   **Auto-SKU Gen**: Creates `productized_services` for standard items (e.g., "Plumbing - Hourly Labor") linked to this contractor.
3.  **Result**: Contractor lands on Dashboard ready to quote immediately.

**Key Schema**: `users` -> `handyman_profiles` -> `handyman_skills`.

---

## 2. Smart Quote Lifecycle (User -> Client)
**Goal:** Contractor sends a premium quote to a client.

1.  **Drafting (Dashboard)**:
    *   Contractor selects "New Quote".
    *   Inputs: "Fix Leaky Tap", Urgency: "High".
    *   Frontend sends payload to `POST /api/contractor/quotes/create`.
2.  **Generation (Server)**:
    *   Server uses **HHH Logic** (Essential/Enhanced/Elite) to calculate 3 price tiers.
    *   Saves to `personalized_quotes`.
    *   Generates a `short_slug`.
3.  **Presentation (Client)**:
    *   Client visits `domain.com/quote-link/[slug]`.
    *   The page renders *dynamic* content styled with the Contractor's Brand (Name/Hero Image).

**Key Schema**: `personalized_quotes` (stores the 3 tiers: `essentialPrice`, `enhancedPrice`, `elitePrice`).

---

## 3. Availability "Harvesting" Loop
**Goal:** Extract real-time availability data.

1.  **Input**: Contractor taps "Today" on Dashboard Calendar -> "Mark Unavailable".
2.  **State Change**: Frontend Optimistically updates UI.
3.  **Persistence**:
    *   `POST /api/contractor/availability/update`.
    *   Upserts record to `contractor_availability_dates` (Date + `isAvailable: false`).
4.  **Utilization**:
    *   Main Switchboard Routing Engine checks this table before forwarding a call.

**Key Schema**: `contractor_availability_dates`.
