# Phase 3 / A — promotion, demotion, fast track — DONE (3 Sep 2026)

Worktree `/Users/courtneebonnick/v6-wt-exit`, branch **`p3-autonomy`**, one commit on top of 6d20718 (comms-v3). Not merged, not pushed. No dev server, no DB access, no app_settings writes.

**Nothing changes production by itself.** The job runs only when `app_settings.spine` has `enabled: true` AND `autonomy.enabled: true` (both default false, fail closed). `sampler.enabled` is added to the config with the same default for pane B's sampler. Until the job (or a person) writes a row, every tier is the static launch default.

## Migrations to apply

- `migrations/20260903_pack_intent_tiers.sql` — `pack_intent_tiers(pack_id, intent, tier, reason, changed_by, changed_at, PK(pack_id, intent))` and the append-only `pack_tier_events(id, pack_id, intent, from_tier, to_tier, reason, evidence jsonb, by, at)` + index. Idempotent. Drizzle: `packIntentTiers`, `packTierEvents` in `shared/schema.ts` (adds the `primaryKey` import).

The code tolerates the tables being absent: the overlay loader keeps launch defaults and logs; the staff API returns an empty ladder.

## Files

New
- `server/spine/autonomy.ts` — the job. `decideTier(evidence, now)` (pure), `demotionSignals`, `evalFamilyFrom(scoreboard, intent)`, `readLatestScoreboard`, `gatherEvidence()` (five grouped queries + `eval-results/latest.json`), `applyDecision` (upsert tier + append event + refresh overlay + system event + Pushover), `evaluateAutonomy({ dryRun })` (idempotent; dry-run computes and prints, writes nothing), `renderAutonomyTable`. Constants `GATE`, `FAST_TRACK_INTENTS`, `INCIDENT_TAGS`.
- `server/spine/autonomy.test.ts` — 21 tests: full gate, each miss, sanity blocks, fast track and each of its four conditions, non-fast-track intents, disallowed intents never SEND, the money/date assertion (throws), READ/PROPOSE hold, each demotion rule, the minimum-samples rule, re-promotion blocked while a demotion signal is in window, idempotent evaluate + dry-run writes nothing, scoreboard → family status, overlay application, `resolvePack` with an overlay.
- `scripts/_autonomy-report.ts` — owner's dry run (`--dry-run` default, `--json`); `--apply` writes but refuses unless both switches are on.
- `migrations/20260903_pack_intent_tiers.sql`.

Changed
- `server/spine/packs.ts` — DB tier overlay: `applyTierOverlay` (pure; ignores rows for intents the pack does not allow, forbidden names, or unknown tiers), `refreshTierOverlay` (cached 60 s, never throws, keeps the last good overlay), `assertPromotable`, `isForbiddenIntent`, `tierSourceFor`, `setTierOverlayForTests`, `resolveStaticPack`. `resolvePack` stays synchronous (the SpineApi contract) and returns the static pack with earned tiers merged.
- `server/spine/index.ts` — `runOnce` refreshes the overlay before resolving the pack.
- `server/spine/config.ts` — `autonomy: { enabled }`, `sampler: { enabled }` (default false, nested-merged), `isAutonomyEnabled()`.
- `server/cron.ts` — `30 7 * * *` Europe/London, worker-gated (`gateCustomerLoop`), skips unless `isAutonomyEnabled()`.
- `server/agent-staff.ts` — `/api/agents/staff` gains top-level `packTiers` (every ladder row with evidence) and `packTiers` on the comms member for `customer.default` + `customer.post_quote`. Read-only; a missing table is an empty list.
- `client/src/pages/admin/AgentStaffPage.tsx` — `PackTiersBlock` in the dossier: intent · tier (earned badge) · verdicts/30d (rejects) · unedited % · unsafe (+ escalations) · eval family · last change, one table per pack with the pack-level verdict line.
- `shared/pushover-settings.ts` + `server/pushover.ts` — event key `autonomy` (Dispatch, priority 0) and `notifyAutonomyChange`.
- `shared/schema.ts` — the two tables.

## Verification

- **tsc** — `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json 2>&1 | sort` on 6d20718 and on the finished tree: **1882 both**; diff by (file, code) with line numbers stripped: nothing new, nothing gone. One tsc at a time.
- **vitest** — `DATABASE_URL=postgres://u:p@127.0.0.1:1/x npx vitest run`: baseline 42 failed / 687 passed; finished tree **42 failed / 708 passed**, the same three pre-existing files (eve-pricing-engine, segment-classifier, contractor-pay). The first run had one red in my own suite: the "idempotent" case showed a just-demoted `ask_gap` being fast-tracked straight back next day. That was a real gap, fixed in code (demotion signals now block promotion while inside their window) and covered by a new test.
- **esbuild** — `npx esbuild server/index.ts --bundle --platform=node --format=esm --packages=external` succeeds.
- Not run: anything against a database or a model; the cron; the script.

## Not done, and why

- **The sampler itself** is not in this brief (pane B): `sampler.enabled` exists in config; the demotion rules read `sample_fine` / `sample_not_fine` verdicts wherever they come from.
- **No eval family per Scoper intent exists yet** (`eval-cases/` has guards, first_contact, money_question, date_question, complaint, absence, incident families). Until families named after intents land, every full-gate evaluation reports `eval family: missing` and only the two fast-track intents can promote — which is the design's launch shape.
- **No human promote/demote route** on `/admin/staff`; the tables accept `changed_by = human:<id>` and a route is a small follow-up.
- **Legacy comms.ts drafts do not count** toward the evidence: only verdicts on drafts whose run has a `pack_id` (spine runs) are joined. Legacy runs have no pack, so nothing they produce can promote a spine intent.

## Decisions the design left open

1. **Pack-level vs intent-level counts.** §4 reads "≥ 30 human verdicts across the pack … unedited ≥ 90%" as pack-level, and "zero unsafe on this intent ever, zero escalations attributed to the intent" as intent-level. The fast track is entirely intent-level (§0b).
2. **Fast track keeps the sanity checks** (zero unsafe ever, zero escalations in 14 d) on top of §0b's four conditions; an unsafe reject is a reject anyway, so this only adds the unsafe-edit / unsafe-sample cases.
3. **Demotion signals block promotion** while inside their window (30 d), so a demoted intent re-earns SEND rather than flip-flopping daily.
4. **Sampled-approval demotion needs ≥ 5 samples** (`GATE.minSamplesForRate`); one bad sample in two is noise, not evidence. Unsafe samples and incidents demote from the first one.
5. **Incident** = a `send` run of the intent in 30 d whose conversation now carries any of `incident`, `trust_concern`, `complaint`. Runs that did not send cannot have caused an incident.
6. **Intent attribution** = the run's recorded proposal intent (`agent_runs.proposal->'proposal'->>'intent'`), falling back to the draft reason's `[intent]` prefix (the exit writes both).
7. **Eval family status**: `pass` only when every regression case of the family passes pass^3; `skipped` when all were skipped (adapter unavailable); `missing` when no case exists. `skipped` does not promote.
8. **Both switches required**: the job needs `spine.enabled` and `spine.autonomy.enabled`. Tier changes only matter when the spine runs; a promotion while the spine is off would be a surprise on the day it is turned on.
9. **The overlay is cached 60 s in-process**, refreshed before every run and immediately after any write, and a read failure keeps the last good overlay (launch defaults on first failure). `resolvePack` never blocks on the database.
10. **Pushover goes to every recipient subscribed to `autonomy`** (new keys default subscribed, so Ben sees it too until he unticks it); the brief's "to Courtnee" is a recipient setting, not code.
11. **Rules packs are not on the ladder** (SEND by construction, content-free); `customer.exception` and `internal.ben` have no ladder either. `contractor.default` is evaluated like the customer packs.
12. Only DRAFT ↔ SEND moves; PROPOSE and READ hold.
