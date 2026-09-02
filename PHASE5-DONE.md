# Phase 5 / C — operator handover and staff directory — DONE

Worktree `/Users/courtneebonnick/v6-wt-config`, branch `p5-handover`, started from `12905d3` (comms-v3, Phases 0–4).

## Migrations

None. No schema change; nothing deleted (this is the "safe before the legacy agent retires" pass).
The legacy comms agent and its sweeps are untouched and keep working.

## Files

1. **`docs/comms-build/HANDOVER.md`** — the owner/operator document: current production state
   (spine SHADOW since 3 Sep ~00:15 UK, legacy drafting, autosend OFF, Railway the only worker);
   what shipped per phase; every switch (`spine.enabled/shadow/mode`, `agents.*`, `asks`,
   `autonomy`, `sampler`, `video`, `comms_agent.autosend/onInbound/enabled`) and what it does;
   Ben's day (queue, due-time chips, flags with deadlines, the morning strip, reason chips, the runs
   drawer, business number only); Courtnee's week (`_shadow-report`, `_autonomy-report`, eval
   scoreboard, `/admin/staff`, verdict stats); open owner actions (holding template, contractor
   phones, Neon branch + strip secrets, kill stale `tsx watch`, Ben's hours/pay, bot disclosure);
   go-live steps from CUTOVER §3 with eligibility dates (live from 4 Sep; autonomy ≥ 17 Sep; Phase 5
   delete after 7 live days).
2. **`/admin/staff`**
   - `server/spine/staff.ts` — `SPINE_STAFF`: rules layer, triage, scoper, quote clerk, recovery
     (spine), verifier, contractor liaison, vision. Same shape as the legacy `STAFF` exports
     (mission, freely / approval / never, tool chips, model, cadence) plus `tier` and `agent`.
   - `server/agent-staff.ts` — `spineRunTallies(7)` (one grouped `agent_runs` query: runs, errors,
     decision mix, shadow runs, spend; empty on a missing table), `spineOrders()` (the real
     standing orders: `TRIAGE_SYSTEM`, `scoper.core.md` + post-quote fragment, quote-prep `SYSTEM`,
     recovery `SYSTEM`, `MOVE_QUALITY_SYSTEM`, `LIAISON_CORE`, `VISION_SYSTEM_PROMPT`, the rules
     layer's fixed copy), `spineStaffMembers()` (stats + chips: `SPINE <mode>`, `TIER`, per-feature
     on/off, `DARK` when the feature is off in a running spine; pack tiers on the Scoper and
     liaison cards), `spineSwitches()`. Payload gains top-level `spine` (the config, which holds no
     secrets) and `legacy` (the five comms_agent flags). The legacy comms card gets
     `RETIRING AFTER 7 LIVE DAYS` and a "(legacy)" role title.
   - `client/src/pages/admin/AgentStaffPage.tsx` — `SpineSwitchStrip` above the roster: mode pill
     with a one-line meaning, one chip per switch with a tooltip naming the field, the legacy row.
     Types `SpineSwitches`, `LegacySwitches`. Cards render through the existing badge/dossier.
3. **`docs/RUNBOOK.md` §4 "Comms desk"** — health endpoint, spine mode commands + rollback SQL,
   where runs / verdicts / ledger / due times / tiers / case files / scoreboard live, the five
   comms migrations in order applied with `psql` (there is no runner), the three-part build
   verification rule and the architecture tests.
4. **`CLAUDE.md`** — "Comms desk" summary (7 lines) at the top of Current Work in Progress with
   pointers to the design, CUTOVER, HANDOVER, RUNBOOK §4, the pane reports and the delete list.
   The PROP_MGR / LANDLORD "Next steps" bullets are left in place: I could not verify they are done.

## Verification

- **tsc** (`NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json`): baseline 1882
  errors on `12905d3`, 1882 after. Per-file × error-code counts identical; zero errors in the three
  files touched.
- **vitest** (`DATABASE_URL=postgres://u:p@127.0.0.1:1/x PHASE0_MERGED=1 npx vitest run`): baseline
  43 failed / 825 passed (52 files, 4 failed); after 42 failed / 826 passed (52 files, 3 failed).
  The one difference is `server/call-script/__tests__/performance.test.ts`, a timing-threshold
  test that failed in the baseline run and passed in the after run — it is the flaky file noted
  since Phase 0, unrelated to this branch (no test file was added or changed here). The 42 are the
  usual three files (eve-pricing-engine, segment-classifier, contractor-pay).
- **esbuild** (`npx esbuild server/index.ts --bundle --platform=node --format=esm --packages=external`): 3.8 MB, no errors.
- The legacy agent: `server/agents/comms.ts`, `comms-sweep.ts`, `sla-sweep.ts`, `promise-tracker.ts`,
  `cron.ts` are not in the diff (`git diff --stat 12905d3..HEAD`).
- Not run (rules): dev server, any database read, the staff page in a browser. The new cards and
  strip are typed against the payload the route builds; `spineRunTallies` and `spineOrders` are
  try/catch'd so a missing table or module cannot take the directory down.

## Not done, and why

- **Nothing deleted.** PHASE5-DELETE.md's preconditions (7 live days, no unsafe, rollback
  exercised) are not met — production is in shadow. The delete list stays the orchestrator's.
- **No human promote/demote route** on `/admin/staff` (P3-autonomy noted it; still a follow-up).
- **Dates in HANDOVER §7** are computed from the shadow flip the brief states (3 Sep ~00:15 UK);
  if the flip time differs, shift them.

## Decisions the brief left open

1. **Spine cards read live numbers from `agent_runs`** (7 days) rather than mirroring the legacy
   per-source draft counts: the spine's unit of work is the run, and the drawer/ledger key on it.
2. **"DARK" chip** on a card whose feature is off while the spine is running (vision without
   `video.enabled`, verifier without `sampler.enabled`, an agent switched off) — so the roster says
   why a role shows zero runs.
3. **Standing orders are loaded verbatim** from the modules (the page's promise: "nothing is
   hand-written copy"); the rules layer, which has no prompt, shows its fixed copy and the
   template name instead.
4. **`legacy` flags on the payload** were not asked for; the strip needs them to show
   `comms_agent.autosend` / `onInbound` next to the spine switches, as the brief's switch list does.
5. **Migrations by `psql`.** The repo has no migration runner (only one-off `scripts/migrate-*`
   files), so the runbook documents the idempotent-file + psql convention the panes used.
