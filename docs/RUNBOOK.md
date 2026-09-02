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

## 4. Comms desk (the spine) — operations

Design: `docs/COMMS_AGENTS_V3_DESIGN.md`. Switching: `docs/comms-build/CUTOVER.md`. People: `docs/comms-build/HANDOVER.md`.

### Health
- `GET /api/health/comms-worker` — 200 while the worker's heartbeat is fresh, 503 when stale (> 10 min). Point uptime checks here. The same payload is on `/admin/staff` (strip at the top).
- Only a process with `COMMS_WORKER=1` (Railway) registers customer-facing loops. A dev process on the production DB warns loudly at boot and runs none.

### Spine mode
```bash
npx tsx scripts/_spine-mode.ts --status
npx tsx scripts/_spine-mode.ts --off      # legacy only (rollback)
npx tsx scripts/_spine-mode.ts --shadow   # spine runs dry + records; legacy still drafts
npx tsx scripts/_spine-mode.ts --live --by <name> --yes   # spine answers; production needs --yes
```
Every flip writes a `config_change` system event. Rollback SQL (if the script cannot run):
```sql
UPDATE app_settings SET value = value || '{"enabled": false}'::jsonb, updated_at = now() WHERE key = 'spine';
```
Other switches (`asks`, `autonomy`, `sampler`, `video`, per-agent) are fields on the same row; see HANDOVER §3.

### Where things live
| What | Where |
|---|---|
| Every agent run (lane, decision, proposal, guards, cost) | table `agent_runs`; per-thread drawer on `/admin/comms`; `GET /api/agent-runs?conversationId=` |
| Ben's verdicts (approve / edit / reject + reason, samples) | table `draft_verdicts`; `GET /api/verdicts/stats?days=30` |
| The ledger (message_in/out, draft_*, flag_*, run_*) | table `comms_events` (write-at-source, `server/ledger.ts`); drift check `ledgerDriftCheck` |
| Drafts and flags with due times | `message_drafts.due_at`, `agent_questions.due_at` |
| Pack tiers (earned autonomy) | `pack_intent_tiers`, append-only `pack_tier_events` |
| Case files | `server/storage/case-files/` by hash (gitignored); `agent_runs.case_file_ref` |
| Eval scoreboard | `eval-results/latest.md` + `latest.json` (gitignored); `npx tsx scripts/eval-comms.ts` |
| Shadow comparison | `npx tsx scripts/_shadow-report.ts --days 7` |
| Autonomy ladder | `npx tsx scripts/_autonomy-report.ts --dry-run` |

### Migrations
Files in `migrations/` are idempotent SQL (`IF NOT EXISTS`). There is no runner; apply with psql
against the target branch, never with `db:push`:
```bash
psql "$DATABASE_URL" -f migrations/20260902_agent_runs_ledger.sql
```
Comms-desk migrations, in order: `20260902_agent_runs_ledger.sql`, `20260902_due_at_holding_line.sql`,
`20260902_draft_verdicts.sql`, `20260903_pack_intent_tiers.sql`, `20260903_agent_runs_shadow_decision.sql`.

### Verification rule for every build
The repo's `npm run check` is red project-wide (~1,882 pre-existing errors) and vitest has 42
pre-existing failures (pricing engine, segment classifier, contractor pay). The gate is therefore:
1. **Zero NEW tsc errors** vs the commit you started from:
   `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json 2>&1 | sort` on both,
   strip `(line,col)`, compare per-file × error-code counts. One tsc at a time (shared tsbuildinfo).
2. **vitest failures identical to baseline**: `DATABASE_URL=postgres://u:p@127.0.0.1:1/x PHASE0_MERGED=1 npx vitest run`
   (the fake URL keeps `server/db.ts` from throwing; `server/__tests__/setup.ts` refuses the
   production host outright).
3. **esbuild succeeds**: `npx esbuild server/index.ts --bundle --platform=node --format=esm --packages=external --outfile=/tmp/esb.js`.
Architecture rules (`server/__tests__/architecture.test.ts`) pin the send choke points and the exit's importers.
