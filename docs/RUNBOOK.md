# Runbook: Contractor Portal Operations

**Status:** LIVING DOCUMENT
**Last Updated:** 2026-01-05
**Scope:** Operations for the Contractor SaaS Product

---

## 1. User Management

### Creating a Test Contractor
The "Wizard" is the standard path, but for dev/debugging:
1.  **Register**: Go to `/contractor/register`.
2.  **Flow**: Complete the 3-step wizard.
3.  **Result check**:
    *   Database: Verify `users.role` is 'contractor'.
    *   Database: Verify `handyman_profiles` row exists.

### Impersonating a Contractor
To debug "What the user sees":
1.  **Locate User**: Find `id` in `users` table.
2.  **Login**: Use their email/password at `/contractor/login`.
    *   *Dev Tip*: Reset password in DB if unknown: `UPDATE users SET password = ...`.

---

## 2. Debugging Features

### Smart Quotes Not Generating
**Symptom**: "Error creating quote" toast.
1.  **Check Logs**: Look for `POST /api/contractor/quotes/create`.
2.  **Common Cause**: Contractor has no `productized_services` (SKUs) linked to them. The engine needs a base rate to calculate the quote.
3.  **Fix**: Run SKU Seeder or manually add a "General Labor" SKU for them in DB.

### Availability Not Syncing
**Symptom**: Dashboard calendar shows "Available" but Switchboard thinks "Busy".
1.  **Check Table**: `contractor_availability_dates` is the source of truth for specific days.
2.  **Check Table**: `handyman_availability` is the *weekly pattern* (Mon-Fri).
3.  **Logic**: Specific dates OVERRIDE the weekly pattern. Ensure the query checks both.

---

## 3. Deployment & Environment
*   **Access**: The portal is publicly accessible at `/contractor/*`.
*   **Security**: Ensure `requireContractor` middleware is applied to ALL API routes in `server/contractor-dashboard-routes.ts`.
