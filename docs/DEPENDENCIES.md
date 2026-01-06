# Dependencies: Contractor App

**Status:** LIVING DOCUMENT
**Last Updated:** 2026-01-05
**Scope:** Libraries powering the Contractor Portal

---

## 1. Frontend Experience
The portal relies heavily on these libraries for the "Premium App" feel:

### Core
*   **React Router (`wouter`)**: Handles sub-routing (`/contractor/*`).
*   **Tanstack Query (`@tanstack/react-query`)**: Manages server state (Quotes list, Availability).
    *   *Critical*: Used for optimistic updates on the Calendar widget.
*   **Lucide React (`lucide-react`)**: Provides the extensive icon set for the mobile menu.

### UI & Aesthetics
*   **Tailwind CSS**: Utility-first styling.
*   **Framer Motion (`framer-motion`)**: (Planned) For smooth page transitions and modal entries.
*   **Shadcn/UI**: The unstyled component primitives used for Inputs, Dialogs, and Cards.

---

## 2. Backend Services
*   **Drizzle ORM**: Critical for complex relational queries (getting a Contractor -> their SKUs -> their Quotes).
*   **Express Session**: Manages the `sid` cookie for contractor authentication.
*   **Stripe**: (Future) Will handle the Subscription billing (£49/mo) execution.

---

## 3. Data Storage
*   **Postgres Tables**:
    *   `handyman_profiles`: The core identity.
    *   `productized_services`: The catalog of work they can perform.
    *   `personalized_quotes`: The documents they generate.
