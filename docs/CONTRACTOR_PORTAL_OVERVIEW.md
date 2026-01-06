# Contractor Portal Overview (Business-in-a-Box)

**Status:** LIVING DOCUMENT
**Last Updated:** 2026-01-05
**Scope:** Contractor SaaS Application ONLY

---

## 1. High-Level Concept
The **Contractor Portal** is a mobile-first web application designed to be the "Operating System" for independent tradespeople. It employs a **"Trojan Horse" strategy**:
1.  **Give Value (Free)**: A "Command Center" dashboard with a calendar and job manager.
2.  **Get Data**: Incentivize them to keep availability up-to-date (so we can route Switchboard calls effectively).
3.  **Upsell (Premium)**: Advanced tools like "Smart AI Quoting" and "Branded Client Portal".

---

## 2. Architecture & Entry Points

### Frontend application
The Portal is a sub-section of the main React Monorepo, but acts as a standalone SPA.

*   **Entry Route**: `/contractor/*`
*   **Main Layout**: [`ContractorDashboardHome.tsx`](file:///Users/courtneebonnick/v6-switchboard/client/src/pages/contractor/dashboard/ContractorDashboardHome.tsx)
    *   *Design:* Mobile-First "App Shell" with Sticky Bottom Nav.
    *   *Theme:* Dark Mode / Glassmorphism (Premium feel).

### Backend API
The portal has its own dedicated Router stack segregated from the main Switchboard logic.

*   **Auth Router**: [`server/contractor-auth.ts`](file:///Users/courtneebonnick/v6-switchboard/server/contractor-auth.ts)
    *   Handles: Login, Register, Session Management.
    *   *Note:* Uses `users` table but enforces `role = 'contractor'`.
*   **App Logic**: [`server/contractor-dashboard-routes.ts`](file:///Users/courtneebonnick/v6-switchboard/server/contractor-dashboard-routes.ts)
    *   Handles: Dashboard stats, Quote generation, Profile updates.
*   **Availability**: [`server/availability-routes.ts`](file:///Users/courtneebonnick/v6-switchboard/server/availability-routes.ts)
    *   Handles: Syncing the "Trojan Horse" calendar data.

---

## 3. Core Modules

### A. Authentication & Onboarding
*   **The Wizard**: [`ContractorOnboarding.tsx`](file:///Users/courtneebonnick/v6-switchboard/client/src/pages/ContractorOnboarding.tsx) transforms a raw signup into a configured provider (Standard Day Rate/Hourly Rate SKUs) in < 60s.

### B. Smart Quoting Engine (The "Killer Feature")
A tool that creates "Good/Better/Best" quotes in seconds.
*   **Builder UI**: [`PrivateQuoteBuilder.tsx`](file:///Users/courtneebonnick/v6-switchboard/client/src/pages/contractor/dashboard/PrivateQuoteBuilder.tsx).
*   **Output**: Generates a public, branded link (e.g., `handy.com/quote/xyz`).

### C. Availability "Harvester"
*   **UI**: The "Next 14 Days" widget on the Dashboard Home.
*   **Logic**: Tapping a date toggles `contractor_availability_dates`. This data feeds the main Switchboard to prevent routing calls to busy contractors.

---

## 4. Verification & Assumptions
*   **Verification 1**: Login executes via `POST /api/contractor/login` and sets a session cookie. (Route: `contractor-auth.ts`).
*   **Verification 2**: The "Dashboard" route `/contractor/dashboard` is protected by `requireContractor` middleware.
*   **Verification 3**: Quote creation writes to `personalized_quotes` with `contractor_id` set.
