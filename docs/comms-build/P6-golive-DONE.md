# P6 — go-live readiness and data hygiene (close-out pane C)

Branch `p6-golive` from `comms-v3` at `dfa65aa`, worktree `/Users/courtneebonnick/v6-wt-config`. 2 Sep 2026 (UTC evening).
Brief: `docs/comms-build/BRIEF-P6-golive.md`. Production stays on the same code with the spine in SHADOW; nothing here
changes customer-facing behaviour. The only server change is a guard that removes a duplicate Ben Pushover.

## Files

| File | What |
|---|---|
| `scripts/_golive-check.ts` | CUTOVER §0 as a go/no-go table. Read-only. `--json`, `--skip-evals`, `GOLIVE_HEALTH_URL`. Exit 1 on any NO-GO, 2 on crash. |
| `scripts/_golive.ts` | `--to shadow\|live --yes`, `--rollback --yes`, `--status`, `--by`. CUTOVER §2 / §3.1–3.3 / §4 in order, each step re-read to confirm and written to `system_events` (`source = 'golive'`). Uses `setSpineMode`/`setSpineConfig`/`setCommsAgentConfig`. **Not run.** |
| `scripts/_export-conversation-memory.ts` | Every `conversation_memory` row (raw SQL; the table is gone from the schema) to `server/storage/archive/conversation_memory-<date>.json`, with columns, count and max(updated_at). Refuses to overwrite without `--force`. **Not run.** |
| `scripts/_retire-test-contractor.ts` | `--dry-run` (default) lists the seed contractor (mike.test@handyservices.co.uk / 07700900001) and every row that hangs off it; `--apply` sets `users.is_active=false`, `users.phone=NULL`, `handyman_profiles.public_profile_enabled=false`; `--clear-availability` also deletes the seeded weekly pattern and date rows. Refuses unless exactly one contractor matches. Writes one `system_events` row. **Not run.** |
| `server/agents/sla-sweep.ts` | Double-ping guard: `flagOwnedByExpiryPath()`; the `needs_ben` lane ignores a flagged `agent_questions` row that carries `due_at` (silence-breaker's `expireFlags` already sends the holding line and re-pings once). Falls through to the verdict lanes, as a moved flag did before. |
| `server/agents/sla-sweep.test.ts` | 6 vitest cases with a chainable fake `db` (no database, no Pushover): pure guard both ways; legacy flag → needs_ben lane; flag with due_at → no lane; flag with due_at falls through to `quote_ready`; no tag → flag never read. |
| `.gitignore` | `server/storage/archive/` (the export holds customer thread summaries). |

No migrations. No `app_settings` reads outside the read-only check script; no writes anywhere by anything that was run.

## What the go-live check reports

Rows: database (reachable + which host) · health endpoint (200, fresh, `thisProcess.role === 'worker'`) · heartbeat row in the DB ·
migrations (`to_regclass` for `draft_verdicts`, `agent_runs`, `pack_intent_tiers`, `pack_tier_events`; `due_at` on `message_drafts`
and `agent_questions`; `agent_runs.shadow_decision`) · Meta templates by name via `getCachedTemplates()` (holding `holding_line_v1`
or `holding_line`, `missed_call_ack`, `video_request`/`job_video_request`, `postcode_request`, `call_request`, all must be
`approved`) · spine mode (shadow = GO; off/live = WARN per §0b) · `comms_agent` flags (autosend on = NO-GO) · `agent_runs` last 24 h
(total / shadow / errors / decision mix; > 3 errors in the last hour or > 10 % error rate = NO-GO; zero shadow runs = WARN) · open
flags and pending drafts past due (> 10 unexpired past-due flags = NO-GO, any = WARN) · `eval-comms` spawned, `Regression red: 0`
and exit 0 required.

When the database is unreachable the config rows are NO-GO rather than the fail-closed defaults, so a laptop with a broken URL can
never print a convincing GO.

## Verification

Start commit `dfa65aa`. Baseline tsc captured on the clean tree before any edit.

| Gate | Result |
|---|---|
| tsc (`NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json`, sorted, line numbers stripped) | 1,876 errors before, 1,876 after; the diff is two pre-existing errors whose union-member order tsc prints differently between runs (`server/agents/comms.ts`, `server/first-contact-ack.ts`). No error in any touched file. |
| vitest (`DATABASE_URL=postgres://u:p@127.0.0.1:1/x PHASE0_MERGED=1 npx vitest run`) | 42 failed / 854 passed / 896 total; the 42 are the pre-existing ones in `server/__tests__/eve-pricing-engine.test.ts` (37), `server/call-script/__tests__/segment-classifier.test.ts` (4), `server/lib/contractor-pay.test.ts` (1). The 6 new cases pass. |
| esbuild (`npx esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=<scratch>`) | Done in 327 ms, 3.8 MB bundle. |
| `npx tsx scripts/eval-comms.ts` (no DB, no network) | `Regression red: 0 · capability red 5 · skipped 656`, exit 0 on `dfa65aa`. |
| Script smoke runs with `DATABASE_URL=postgres://u:p@127.0.0.1:1/x` | `_golive-check`: table and `--json` both render, every DB row NO-GO, exit 1; the health row hit the real endpoint and reported 200 / fresh / `role=worker` on Railway. `_golive --to live` prints the 3-step plan, exit 2, nothing written; `--rollback --yes` refuses (database unreachable), exit 1. `_retire-test-contractor --dry-run` and `_export-conversation-memory` fail on connect with exit 1 and write nothing (no `server/storage/archive/` created). |

Rules kept: worktree only; no dev server; no database reached by anything I ran (dead URL for every smoke run; the one live
request was a GET of the public health endpoint); no `app_settings` write; no push.

## Not done, and why

- **No script was run against a real database**, by rule 2. The go-live check's DB rows, the template read and the runs/flags
  queries are exercised only for load + failure path. First real run: `npx tsx scripts/_golive-check.ts` from a machine with the
  production `DATABASE_URL` (read-only) — expect `meta templates approved` NO-GO until Meta approves `holding_line_v1`.
- **`_golive.ts` has no dry-run against the live row** beyond the plan print; step confirmation is by re-reading the row after each
  setter, which is the same read `/admin/staff` does. It refuses without `--yes`, and on production without `--yes-production`.
- **The sla-sweep guard skips the lane, not just the Pushover.** A flag with `due_at` no longer opens an `sla_alerts` episode at all;
  any open `needs_ben` episode for such a flag resolves as `lane_changed` on the next Pass A (no ping on resolution). The brief said
  "skip the Pushover"; skipping the episode is the same outcome with no orphan `sla_alerts` rows. `scripts/_test-sla-sweep.ts`
  (the DB-backed suite) still passes by construction: its needs_ben fixtures are written without `due_at`; not re-run (rule 2).
- **Retirement does not touch bookings or quotes** that may reference the test profile; the dry run prints skills / pattern / date
  counts only. If the profile is referenced by `v2_bookings` or `contractor_booking_requests`, deactivation is still correct
  (the FK stays), but check `/admin/contractors` after `--apply`.
- **`_export-conversation-memory.ts` writes one JSON file**, not a streamed dump; if the table is very large, add `--out` on a
  bigger disk. It does not apply the DROP — that stays the hand step in `migrations/20260903_drop_conversation_memory.sql`.
- **Sampler (§3.4) and autonomy (§3.5) are not in `_golive.ts`** on purpose: their eligibility dates differ (HANDOVER §7) and both
  have switches on `/admin/staff`.

## Decisions

- `--json` mode redirects `console.*` to stderr before the server modules load (dynamic imports), so stdout is only the payload.
- `_golive.ts` writes every step even when the value is already in place (the setters are idempotent) and records `changed: false`
  in the event, rather than trusting a possibly-stale read to skip a rollback step.
- The template check treats every one of the five slots as blocking, as CUTOVER §0 lists them; `missed_call_ack` is already
  approved, the holding line is the one awaiting Meta.
- `--clear-availability` is opt-in: the brief lists only `isActive=false` + phone cleared; deleting the seeded availability rows is
  the step that keeps the picker/assigner from ever offering the test contractor, so it is there, behind its own flag.
