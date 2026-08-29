# Implementation Plan: Scriptable iOS Widget ("Phase 2" of Web Push v1)

Self-contained brief for a fresh pane. Repo: `/Users/courtneebonnick/v6-switchboard` (V6 Switchboard — Express 4 + Drizzle/Neon Postgres backend, React/Vite client, see CLAUDE.md).

## Goal
A home-screen iOS widget (via the Scriptable app) showing a role-scoped ops summary at a glance:
- **admin**: today's jobs, money position, pipeline value, needs-attention count
- **va**: today's leads/calls, pipeline, needs-attention
- **contractor**: their jobs today (time · customer · area), next job, jobs this week

One new endpoint + one ~50-line Scriptable script. No push involvement — this is pull-based, refreshed by iOS on its own schedule.

## Context you can rely on (verify before coding)
- Auth: Bearer tokens in `contractorSessions`; `server/auth.ts:~57` `optionalAuth` resolves any role and sets `(req as any).user` (full `users` row: `id`, `role` = 'admin'|'va'|'contractor').
- Web Push v1 just landed (see `server/web-push.ts` for endpoint/router style — mount pattern in `server/index.ts`).
- Key tables (verify columns in `shared/schema.ts`): `contractorBookingRequests` (jobs; `scheduledDates` jsonb array of YYYY-MM-DD is the source of truth for scheduling, NOT the bare timestamp — see comment in `server/job-assignment.ts:~112`), `invoices`, `personalizedQuotes`, `leads`, `users`, `handymanProfiles` (contractor profile ↔ users.id via `handymanProfiles.userId`).
- Existing follow-ups / held-drafts / task-inbox logic exists somewhere in server — explore (`Task` tool, Explore agent) before defining "needs attention"; reuse existing queries/helpers rather than inventing new definitions.

## WP1 — Widget token (server)
Widgets can't do interactive login and iOS may hold the token for months, so don't reuse short-lived session tokens.
- Add nullable `widgetToken: varchar("widget_token")` to `users` in `shared/schema.ts` + unique index. **DB note:** `npm run db:push` is currently blocked by PRE-EXISTING schema drift (`job_material_expenses` et al. exist in schema but not DB — do NOT resolve interactively). Apply additively via a one-off script modeled on `scripts/_migrate-push-subs-user-role.ts` (`ALTER TABLE users ADD COLUMN IF NOT EXISTS widget_token varchar; CREATE UNIQUE INDEX IF NOT EXISTS ...`).
- `POST /api/widget/token` (authed via `optionalAuth`, 401 if no user): generates `crypto.randomBytes(24).toString('base64url')`, stores on the user, returns it. Idempotent option: return existing token unless `?rotate=1`.
- Surface it in the UI minimally: a small "Phone widget" section on `/admin/notifications` (admin/va) and the contractor Profile tab — button "Generate widget token" that calls the endpoint and shows the token + copyable install snippet. Keep it modest; match surrounding card styling.

## WP2 — `GET /api/widget/summary` (server)
- New file `server/widget.ts` exporting `widgetRouter`, mounted in `server/index.ts` next to `pushRouter`.
- Auth: accept `?token=` query param (Scriptable-friendly) AND `Authorization: Bearer` (nice for curl). Look up `users` by `widgetToken`; 401 on miss. Do NOT log the token.
- Response shape (keep flat and small — the script renders it dumbly):
```json
{
  "role": "admin",
  "generatedAt": "2026-08-29T09:00:00Z",
  "lines": [
    { "label": "Today", "value": "3 jobs", "detail": "Craig ×2, Joe ×1" },
    { "label": "Money", "value": "£4,120 due", "detail": "£980 paid this wk" },
    { "label": "Pipeline", "value": "£12,300", "detail": "9 open quotes" },
    { "label": "Attention", "value": "2", "detail": "follow-ups due" }
  ]
}
```
  Server owns ALL formatting (£, counts, truncation) so the script stays ~50 lines and role differences are purely server-side. 3–4 lines max; `detail` optional.
- Role scoping:
  - **admin**: jobs today (count from `contractorBookingRequests` where `scheduledDates` contains today), invoices outstanding vs paid-this-week (sum `totalAmount` pence → `£x,xxx`), open-quote pipeline value, needs-attention (reuse existing follow-ups/task-inbox logic found in exploration).
  - **va**: leads today, pipeline, needs-attention (no money line).
  - **contractor**: resolve `handymanProfiles` by `userId`, then their jobs where `scheduledDates` contains today (time · customerName), next upcoming job, count this week.
- Wrap each metric in its own try/catch so one bad query degrades to a missing line, not a 500. Cache-control: `no-store`.

## WP3 — Scriptable script
- New file `docs/scriptable-widget.js` (~50 lines, plain JS, Scriptable API):
  1. `const TOKEN = "PASTE_TOKEN"; const BASE = "https://www.handyservices.app";`
  2. Fetch `${BASE}/api/widget/summary?token=${TOKEN}` via `new Request(url).loadJSON()`.
  3. Cache last-good JSON to `FileManager.local()` and fall back to it on fetch failure (show a stale marker using `generatedAt`).
  4. Render a `ListWidget`: dark background (#0f172a to match the app), accent #e8b323, one row per `lines[]` entry (label small/grey, value bold, detail small), `widget.refreshAfterDate = new Date(Date.now() + 15*60*1000)`.
  5. Support small (first 2 lines) and medium (all lines) families; `Script.setWidget(widget)`.
- Add a short install section at the bottom of this file or in the UI snippet: install Scriptable → new script → paste → paste token → add Scriptable widget to home screen → choose script.

## Verification
1. Migration script runs; `users.widget_token` exists; `npm run check` clean for touched files (ignore pre-existing `scripts/` junk errors).
2. `POST /api/widget/token` with admin token → returns token; second call returns same; `?rotate=1` changes it.
3. `curl "/api/widget/summary?token=X"` → admin gets 4 lines with real numbers; contractor token gets only their jobs; bad token → 401.
4. One metric query artificially broken → response still 200 with remaining lines.
5. Script pasted into Scriptable with prod URL renders on home screen; airplane mode shows cached data.
6. Nothing logs the widget token.

## Out of scope
Push (done), token revocation UI beyond rotate, Android, per-widget config.
