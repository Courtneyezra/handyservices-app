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
- `GET /api/health/comms-worker` — 200 with `status: "ok"` while the worker's heartbeat is fresh, 503 with `status: "stale"` when the heartbeat is older than 10 min, has never been written, or is unreadable (then `error` carries the reason). Point uptime checks and the platform healthcheck here. The same payload is on `/admin/staff` (strip at the top).
- Only a process with `COMMS_WORKER=1` (Railway) registers customer-facing loops. A dev process on the production DB warns loudly at boot and runs none.
- **Who is paged when the worker dies (0.6, 8 Sep 2026).** Two alarms, and they can never fire for the same episode because one needs `COMMS_WORKER=1` and the other needs its absence:
  - *inside the worker* — it pages when its OWN heartbeat goes stale, i.e. it is wedged or its DB writes are failing;
  - *outside the worker* — any passive **production** process (a second Railway service, the web service) polls the same row every 5 min and pages when the heartbeat is more than 10 min old. This is the one that catches a worker that is simply gone. It pages at most once an hour, only in UK daytime (08–20) like the alarm inside, and sends exactly one **"comms worker is back"** when the heartbeat returns, so a resolved outage is a message rather than the absence of one. Titles: `comms worker is not running` / `comms worker is back` (from outside) vs `comms worker heartbeat stale` (from inside).
  - A laptop never pages: the watchdog requires `NODE_ENV=production`, so a dev process on a Neon branch that has never seen a heartbeat stays quiet.
  - Today production runs **one** Railway service that is both the web process and the worker, so nothing outside it is watching yet: until a second passive service exists, the covering alarm is the platform/uptime healthcheck on the 503 above.

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

### A flagged thread that is also ready to price (P19)
A thread on the Ben lane (`decision=flag`) that carries `needs_quote` or `rescope` now runs the
Quote clerk too, and its Route A chain, so Ben gets the "Quote ready to price" Pushover and a draft
at `/admin/price/<slug>` while the flag is still open. Nothing goes to the customer: the clerk's
words are dropped, the decision is still the same flag with the same exception and due time, and
the flag row is unchanged. It runs once — the next pass sees the live estimate or the draft and
does not re-run the estimator. Expect a flag and a priced draft on the same thread; that is
correct. To see what a thread would do without touching anything:
```bash
npx tsx scripts/_p19-replay-thread.ts <conversationId>   # read-only: no writes, no sends
```

### Where things live
| What | Where |
|---|---|
| Every agent run (lane, decision, proposal, guards, cost) | table `agent_runs`; per-thread drawer on `/admin/comms`; `GET /api/agent-runs?conversationId=` |
| Ben's verdicts (approve / edit / reject + reason, samples) | table `draft_verdicts`; `GET /api/verdicts/stats?days=30` |
| The ledger (message_in/out, draft_*, flag_*, run_*) | table `comms_events` (write-at-source, `server/ledger.ts`); drift check `ledgerDriftCheck` |
| Drafts and flags with due times | `message_drafts.due_at`, `agent_questions.due_at` |
| Pack tiers (earned autonomy) | `pack_intent_tiers`, append-only `pack_tier_events` |
| Case files | `server/storage/case-files/` by hash (gitignored); `agent_runs.case_file_ref` |
| Eval scoreboard | table `eval_runs` (0.7, what the autonomy job reads); `eval-results/latest.md` + `latest.json` (gitignored, the fallback); `npx tsx scripts/eval-comms.ts`, `scripts/_eval-scoreboard.ts --status` |
| Shadow comparison | `npx tsx scripts/_shadow-report.ts --days 7` |
| Autonomy ladder | `npx tsx scripts/_autonomy-report.ts --dry-run` |
| WhatsApp templates: status, submission, what Meta does next | `/admin/staff` → Templates; `docs/META-TEMPLATE-RUNBOOK.md`; definitions in `server/window-templates.ts` |

### Migrations
Files in `migrations/` are idempotent SQL (`IF NOT EXISTS`). Apply with the targeted runner `npx tsx scripts/_apply-migration.ts migrations/<file>.sql` (statement by statement, comment-safe; never `db:push` against the shared production DB). psql works too
against the target branch, never with `db:push`:
```bash
npx tsx scripts/_apply-migration.ts migrations/20260902_agent_runs_ledger.sql
```
Comms-desk migrations, in order: `20260902_agent_runs_ledger.sql`, `20260902_due_at_holding_line.sql`,
`20260902_draft_verdicts.sql`, `20260903_pack_intent_tiers.sql`, `20260903_agent_runs_shadow_decision.sql`,
`20260908_eval_runs.sql`.

### Changing a prompt (build plan v2, 0.7)
The Scoper's standing orders live in `server/spine/prompts/`. They decide what a customer is told;
nothing else in the repository does more per line. **A change under `server/spine/prompts/` must
arrive with a change under `eval-cases/`.** Enforced two ways, both running the same rule
(`server/evals/prompt-gate.ts`):
```bash
npm run gate:prompts     # the same verdict you will get on the pull request
```
and the `Prompt gate` check on every pull request (`.github/workflows/prompt-gate.yml`). It names
the prompt that moved and says its eval family is missing. It is deliberately blunt: it cannot tell
a good family from a bad one, it only makes the omission impossible to merge in silence.

**Before merge, run the affected families against the model.** The gate cannot do this for you —
the spine adapter needs a key and costs money, so it stays a person's call:
```bash
EVAL_LIVE=1 ANTHROPIC_API_KEY=… npx tsx scripts/eval-comms.ts --adapter spine --family <family>
```
**The budget.** One family is 5 to 10 cases × 3 trials, so 15 to 30 Scoper runs. A Scoper run is
roughly 8k input + 1k output tokens on Sonnet ($2 / $10 per M, `server/agent-cost.ts`), about 2p a
run: **£0.30 to £0.60 per family**, and **£5 to £8** for every intent family at once. Estimated from
the token sizes, not measured — the run prints its own `usage`, so read the real figure from
`eval-results/latest.md` after the first one. A prompt change that touches one behaviour should run
one or two families, not all of them.

**Provenance.** Every eval run records the digest of `server/spine/prompts/*` it graded
(`promptHash`) and the Scoper's own per-pack hash (the same value `agent_runs.prompt_hash` carries),
so a green family is tied to the exact prompt it graded:
```bash
npx tsx scripts/_eval-scoreboard.ts --status   # prints STALE when the prompts have moved since
```

### The eval scoreboard on the server (0.7)
The daily promotion job (`server/spine/autonomy.ts`) reads its eval evidence from the newest
`eval_runs` row, falling back to `eval-results/latest.json`, and reads `missing` when there is
neither — never a green. Until 0.7 it read the file only, and `eval-results/` is gitignored with no
eval step in the container build, so on Railway the file has never existed: every intent's eval
family read `missing` and only the two fast-tracked intents (`ask_gap`, `confirm_received`) could
ever be promoted. To give the table its first row on the server, with the migration applied:
```bash
npx tsx scripts/_apply-migration.ts migrations/20260908_eval_runs.sql
DATABASE_URL=<the server's> npx tsx scripts/eval-comms.ts          # grades and publishes
DATABASE_URL=<the server's> npx tsx scripts/_eval-scoreboard.ts --publish   # or publish a latest.json you already have
```
A local run with no `DATABASE_URL` is unchanged: it writes the file, prints `table: skipped`, and
touches no database. `--no-publish` skips the table even when one is reachable.

### Verification rule for every build
The repo's `npm run check` is red project-wide (~1,882 pre-existing errors) and vitest has 42
pre-existing failures (pricing engine, segment classifier, contractor pay). The gate is therefore:
1. **Zero NEW tsc errors** vs the commit you started from:
   `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json 2>&1 | sort` on both,
   strip `(line,col)`, compare per-file × error-code counts. One tsc at a time (shared tsbuildinfo).
2. **vitest failures identical to baseline**: `DATABASE_URL=postgres://u:p@127.0.0.1:1/x PHASE0_MERGED=1 npx vitest run`
   (the fake URL keeps `server/db.ts` from throwing; `server/__tests__/setup.ts` refuses the
   production host outright). This runs three projects (`vitest.config.ts`): `server` (the 42
   baseline live here), `comms-v2` (the new desk under `server/comms-v2/`, the only project that
   loads the machine-local env; see `server/comms-v2/README.md`) and `client` (jsdom + Testing
   Library for the admin UI, must be green).
   `npm run test:client` runs the client project alone; new UI needs a test beside it under
   `client/src/**/__tests__/`, helpers in `client/test-utils.tsx`, jsdom gaps in `client/test-setup.ts`.
3. **esbuild succeeds**: `npx esbuild server/index.ts --bundle --platform=node --format=esm --packages=external --outfile=/tmp/esb.js`.
Architecture rules (`server/__tests__/architecture.test.ts`) pin the send choke points and the exit's importers.
