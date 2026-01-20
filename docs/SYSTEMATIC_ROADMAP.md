
# Systematic Roadmap: "Usability First"

This document bifurcates tasks into **Frontend (F)** and **Backend (B)** items to systematically tackle the "Operational Usability" gap.

## 🚨 Priority 1: The "Order-to-Cash" Cycle (Invoicing)
*Goal: Ensure you can get paid for every job.*

### Backend Tasks (Invoicing)
- [ ] **B1: Create Invoice Schema**
    - Add `invoices` table (linked to `jobs` and `stripe_payment_intents`).
    - Statuses: `draft`, `sent`, `paid`, `void`.
- [ ] **B2: Invoice Generation Endpoint** (`POST /api/invoices/generate`)
    - Logic to pull Job Cost + Extras - Deposit = Remaining Balance.
- [ ] **B3: Stripe Webhook for Payouts**
    - Update `api/stripe/webhook` to mark Invoice as `paid` in DB when Stripe succeeds.

### Frontend Tasks (Invoicing)
- [ ] **F1: Invoice List View** (`/admin/invoices`)
    - See who owes what. Filter by "Unpaid".
- [ ] **F2: "Send Invoice" Action** (Job Details Page)
    - One-click button: "Generate & Email Invoice".

---

## 🚨 Priority 2: Dispatching & Calendar
*Goal: Assign a specific Job to a specific Human at a specific Time.*

### Backend Tasks (Dispatching)
- [ ] **B4: Job Assignment Schema**
    - Add `assigned_contractor_id` and `scheduled_slot` to `jobs` table.
- [ ] **B5: Dispatch Endpoint** (`POST /api/jobs/:id/assign`)
    - Logic: Check `availability-routes.ts` for conflicts -> Assign Job -> Notify Contractor.

### Frontend Tasks (Dispatching)
- [ ] **F3: Admin Calendar View** (`/admin/calendar`)
    - Drag-and-drop Jobs onto Contractor Rows (Monday.com style).
- [ ] **F4: Contractor "My Jobs" Card**
    - Update `ContractorDashboardHome` to show "Upcoming Job: [Time]" prominently.

---

## 🚨 Priority 3: The "Field App" (Contractor Experience)
*Goal: Contractor accepts job, does work, evidence upload.*

### Backend Tasks (Field App)
- [ ] **B6: Evidence Upload Endpoint**
    - Ensure `upload.ts` supports "Job Completion Photos" bucket.

### Frontend Tasks (Field App)
- [ ] **F5: Job Acceptance Screen**
    - When Job is assigned, Contractor sees "New Job Offer". Button: [Accept] / [Reject].
- [ ] **F6: "Complete Job" Flow**
    - Step-by-step wizard: Upload Before Photo -> Upload After Photo -> Mark Complete.

---

## Summary of Labels
| ID | Area | Description | Status |
|----|------|-------------|--------|
| B1 | Invoicing | Database Schema for Invoices | Pending |
| B2 | Invoicing | API to Generate Invoice | Pending |
| B3 | Invoicing | Stripe Webhook Listener | Pending |
| F1 | Invoicing | Admin Invoice Dashboard | Pending |
| F2 | Invoicing | "Send Invoice" Button | Pending |
| B4 | Dispatch | Schema for Job Assignments | Pending |
| B5 | Dispatch | Assign Job API | Pending |
| F3 | Dispatch | Admin Calendar UI | Pending |
| F4 | Dispatch | Contractor "Next Job" Widget | Pending |
| F5 | Field App | Job Accept/Reject UI | Pending |
| F6 | Field App | Job Completion Wizard | Pending |
