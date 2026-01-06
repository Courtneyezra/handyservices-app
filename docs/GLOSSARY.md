# Glossary: Contractor SaaS Domain

**Status:** LIVING DOCUMENT
**Last Updated:** 2026-01-05
**Scope:** Business Terms for the Contractor App

---

## Core Concepts

### Trojan Horse Strategy
**Definition**: The core growth hack. We give contractors a **Free Dashboard** to manage their business, but the *real* goal is to capture their structured data (Availability, Pricing, Client list) to power our main automation platform.
**Mechanism**: The "Availability Calendar" is the primary input vector.

### Business-in-a-Box
**Definition**: The value proposition to the contractor. "Everything you need to run your trade business" (Quoting, Payments, Scheduling, CRM) in one app.

### HHH (Head, Heart, Hands)
**Definition**: The pricing psychology used in our Smart Quotes.
*   **Hands (Essential)**: Just the labor. "Get it done".
*   **Head (Enhanced)**: The smart choice. Better materials/guarantee.
*   **Heart (Elite)**: The premium choice. Priority service, best visuals.
*   *Note*: This allows us to charge higher margins by anchoring against the base price.

---

## App Entities

### Command Center
**Definition**: The main Dashboard Home (`ContractorDashboardHome.tsx`). Designed to show "Pulse" metrics (Revenue, Active Jobs) and Quick Actions.

### Personalized Quote
**Definition**: A web-based quote (not a PDF) that is interactive. The client can toggle options on the page, and the contractor gets notified instantly.
**Table**: `personalized_quotes`.

### Public Profile
**Definition**: The "Landing Page" for the contractor (e.g., `handy.com/handy/bob-the-builder`). Used to capture new leads from *their* traffic.
