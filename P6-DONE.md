# P6 close-out / A — the seams the panes left open

Branch `p6-seams` from `comms-v3` at `dfa65aa`, worktree `/Users/courtneebonnick/v6-wt-exit`. Brief:
`docs/comms-build/BRIEF-P6-seams.md`. Production is in SHADOW; nothing here changes what a customer
receives: the template-first exit only runs on a `send` decision, and no intent is at SEND (the
ladder is DRAFT everywhere until the 07:30 job or a person promotes one). The nightly drift check
and the tier route are worker-gated / admin-gated bookkeeping.

## 1. Template-first exit (P2-spine not-done)

`server/spine/exit.ts`. On a `send` decision with the 24h WhatsApp window shut (`!window.canFreeform`
and the thread is not SMS), the exit resolves the pack's template for the intent
(`PACKS[pack.id].templates[intent]`) through the rules layer's lookup
(`findApprovedTemplateWithValues`, by NAME, `{{1}}` = `templateNameSlot(contactName)`) and queues
the draft with `contentSid` + `contentVariables` and the rendered body, so `approveAndSendDraft`
takes its template branch. No pack template, not yet approved by Meta, or a lookup that throws →
the unchanged freeform path: `approveAndSendDraft` refuses `OUTSIDE_WINDOW`, the draft stays
pending with its due time, the rules layer holds the line at expiry. Never silent; never a
freeform send outside the window. `ExitOutcome.template` names the template used.

New injectable `ExitDeps.resolveTemplate`; default `resolvePackTemplate` (exported). Tests in
`exit.test.ts`: window open never looks up; window shut + approved template → SID/variables/body
on the draft, sent with the approver and run id; window shut + no template → freeform refused,
pending, detail says why; SMS thread never looks up; a throwing lookup falls to pending.

## 2. Ledger drift check on cron (P1-ledger not-done)

- `server/ledger-drift-job.ts` (new): `runLedgerDriftCheck()` calls `ledgerDriftCheck(7)`, logs
  ONE `system_events` row every run (`kind 'sweep'`, `source 'ledger-drift'`, the report in
  `detail`), and when `totalAbsDelta > 0` sends ONE Pushover naming the drifting sources. Never
  throws; a failed check is a `FAILED` event. Deps injectable; `ledger-drift-job.test.ts` (5 tests).
- `server/pushover.ts`: `notifyLedgerDrift` on the existing `worker_health` key (infrastructure,
  not a customer; no link).
- `server/cron.ts`: `gateCustomerLoop('cron: 03:30 ledger drift check')`, `30 3 * * *`
  Europe/London — registers only on the Railway worker.

## 3. Parent run (P2-spine not-done)

- `migrations/20260904_agent_runs_parent_run.sql`: `agent_runs.parent_run_id text null` +
  partial index `idx_agent_runs_parent`. **Apply before deploying this code** (`startAgentRun`
  inserts the column), exactly as `20260903_agent_runs_shadow_decision.sql` was.
- `shared/schema.ts` `agentRuns.parentRunId`; `server/agent-runs.ts` `StartAgentRunInput.parentRunId`;
  `server/agents/runner.ts` passes `opts.parentRunId` through.
- One `runOnce` pass now stamps its run id on every child row it causes: the triage model row
  (`triage(cf, { parentRunId })`), vision `describe_video` rows
  (`buildCaseFile(id, { parentRunId })` → `describeCaseFileMedia`), the quote clerk's wrapped
  Quote Prep run (`runQuotePrep(..., { parentRunId })`, which also keeps its `parent:` transcript
  marker for old rows) and the spine recovery agent's wrapped `runRecovery`. The Scoper and the
  liaison run under the spine's own id already (same row), so they need no parent.
- `GET /api/agent-runs` returns `parentRunId`, read as `to_jsonb(agent_runs)->>'parent_run_id'`
  so a server ahead of the migration still answers.
- `AgentRunsDrawer.tsx`: `groupRuns()` nests children under their parent (a `+N` chip on the
  parent, indented child rows, "child of …" in the footer); a child whose parent is not in the
  list stays top-level, so pre-migration rows render as before.

## 4. Human promote / demote (P3-autonomy, P5-handover not-done)

- `POST /api/spine/tiers { packId, intent, tier, reason }` (`server/spine/routes.ts`, behind the
  router's `requireAdmin`). Validation is the pure `validateHumanTierRequest` in
  `server/spine/autonomy.ts`: pack must exist and be on the ladder (no `rules.*`, no internal);
  intent must be in the pack's `allowedIntents` (any tier); `SEND` additionally passes
  `assertPromotable` (money/date names can never be promoted); reason required (≤ 1000). 400 with
  the list of problems.
- `setTierByHuman` writes `pack_intent_tiers` (upsert) + `pack_tier_events` (rule `human`,
  evidence `{ rule, reason, by, from, to, at }`) with `changed_by = human:<email|id>`, refreshes
  the overlay, logs `config_change`, pings the owner through the existing `notifyAutonomyChange`.
  Idempotent: asking for the tier the intent already holds writes nothing. Refuses a non-human
  `by`. `AutonomyRule` gains `'human'`.
- `/admin/staff` ladder rows (`PackTiersBlock`) get a `↑ send` / `↓ draft` button on DRAFT/SEND
  rows; it opens an inline reason field (Enter confirms, Esc cancels), posts, and refetches the
  directory. Server errors show inline.
- Tests in `autonomy.test.ts` (7 new): accept / refuse cases and the write + ping + idempotency.

## 5. Judge agreement (P3-sampler not-done)

- `server/verdict-stats.ts`: `VerdictRow.draftId`; `samplerAgreement(rows)` pairs the
  `agent.verifier` sample verdict with the `human:*` sample verdict on the same `draft_id` →
  `{ judged, humanReviewed, agreement, disagreements }`; `VerdictStats.sampler` carries it, so
  `GET /api/verdicts/stats` and the staff directory both have it. `verdicts.ts` selects `draft_id`.
- `server/agent-staff.ts`: the verifier card gets `sampler` plus three workload stats (judged,
  Ben reviewed, agreement — green at ≥ 85%, amber below).
- `AgentStaffPage.tsx`: `SamplerBlock` in the verifier dossier.
- Tests in `verdict-stats.test.ts` (3 new).

## Files

New: `server/ledger-drift-job.ts`, `server/ledger-drift-job.test.ts`,
`migrations/20260904_agent_runs_parent_run.sql`, `P6-DONE.md`.
Changed: `server/spine/{exit,exit.test,autonomy,autonomy.test,routes,triage,case-file,index}.ts`,
`server/spine/agents/recovery.ts`, `server/agents/{runner,quote-prep,recovery}.ts`,
`server/{agent-runs,agent-runs-routes,agent-staff,cron,pushover,verdicts,verdict-stats,verdict-stats.test}.ts`,
`shared/schema.ts`, `client/src/components/comms/AgentRunsDrawer.tsx`,
`client/src/pages/admin/AgentStaffPage.tsx`.

## Migrations

`migrations/20260904_agent_runs_parent_run.sql` — additive, idempotent, NOT applied here (rule 2).
`npx tsx scripts/_apply-migration.ts migrations/20260904_agent_runs_parent_run.sql` before deploy.

## Verification

| Gate | Result |
|---|---|
| tsc vs start commit `dfa65aa` | 1,876 errors before, 1,876 after; diff ignoring line numbers is empty apart from one pre-existing comms.ts TS2802 whose union-member order shifted (same error, same file). Zero new. |
| vitest (`DATABASE_URL=postgres://u:p@127.0.0.1:1/x PHASE0_MERGED=1 npx vitest run`) | baseline 42 failed / 848 passed (53 files); after 42 failed / 868 passed (54 files); the failing set is byte-identical (same 42 tests in the 3 pre-existing red files) |
| esbuild `server/index.ts` (the build script's flags) | bundles, 3.8 MB |
| touched suites | exit 11/11 · autonomy 28/28 · verdict-stats 17/17 · ledger-drift-job 5/5 |

No dev server, no database, no `app_settings`, no push.

## Not done, and why

- **Client tests for `groupRuns` / the ladder buttons / `SamplerBlock`** — the vitest config
  includes `server/**` only; client tests are the P6-client-tests pane's. `groupRuns` is exported
  and pure for it.
- **The drift check will ping every night until the backfill runs.** P1-ledger recorded that
  legacy rejections (`comms_agent:superseded`, `hours_gate:stale_by_morning`, `ack_hold:superseded`)
  are not written at source; `message_drafts.rejected` will therefore show a delta until Phase 5
  deletes those paths or the backfill (RUNBOOK §7) runs. The brief asked for "Pushover if drift >
  0", so that is what it does; if the nightly ping is noise, the one-line change is a threshold or
  an allow-list of sources in `runLedgerDriftCheck`.
- **`pack.templates` is read from the static pack**, not the DB overlay — the overlay carries
  tiers only, templates are config in `server/spine/packs/*.ts`. Today only `holding`,
  `promise_overdue_holding`, `sla_chase` (and the rules pack's acks/asks) name a template, so a
  Scoper `send` at a shut window still falls to pending until the pack names an approved template
  for that intent.
- **No GET for tiers** — the page already receives `packTiers` with every row's evidence from
  `/api/agents/staff`; the POST refetches it.
- **The route does not check the spine mode** on purpose: a demotion must work while the spine is
  off, and a tier only has an effect once it is live.

## Decisions

- The template lookup is injected (`ExitDeps.resolveTemplate`) rather than imported, keeping
  `exit.test.ts` database-free; the default resolver is one function that never throws.
- A throwing template lookup falls to the pending path instead of failing the exit: losing the
  draft would be the silence the rules layer exists to prevent.
- Drift pings ride `worker_health` (the P1 brief offered `escalation` or `worker_health`): the
  ledger is infrastructure, the action is on the code or the backfill, not on a thread.
- Human tier changes reuse the job's tables, event log and Pushover, with `rule: 'human'` in the
  event's evidence, so `gatherEvidence`'s `lastChange` and the ladder's "last change" column show
  a person's move exactly like the job's.
- Child rows are read through `to_jsonb` so the drawer keeps working on a server that is ahead
  of the migration; the write side (`startAgentRun`) follows the shadow_decision precedent and
  needs the migration first.

---

# P6 close-out / A2 — switch controls, template status, shadow panel on /admin/staff

Same branch `p6-seams`, built after the A commit `8a019a2`. Brief: `docs/comms-build/BRIEF-P6-staff-controls.md`
(on `main` at `7f350f7`; not in this worktree). Decisions taken as instructed: (1) mode / legacy
autosend / autonomy are owner-only (owner account `ezramarketingltd@gmail.com` or role `admin`,
never `va`); asks, sampler, video and the per-agent switches are any admin. (2) Live needs the
go-live check with no NO-GO, then the word LIVE typed. (3) Templates read-only + Sync now, no submit.
(4) Shadow panel default 7 days with a 1-day toggle.

## 1. Switch controls

- `server/spine/controls.ts` (new, pure): `validateSpineConfigPatch` (fields `mode | agents | asks |
  autonomy | sampler | video | confirm`; unknown fields, bad types, unknown agents refused; `mode`
  writes the same three fields `scripts/_spine-mode.ts` writes; `mode:'live'` needs `confirm:'LIVE'`),
  `validateCommsConfigPatch` (`autosend.enabled`, `onInbound`; ON needs `confirm:'LIVE'`), `isOwner`,
  `lastChangeByField` (folds the `config_change` events the setters write into "who, when" per
  control), `MODE_CAPTIONS` (CUTOVER §2–4).
- `POST /api/spine/config` (`server/spine/routes.ts`): validate → owner check → for live, run the
  go-live check (`skipEvals: true`) and 409 with the report on any NO-GO → `setSpineConfig(patch,
  'human:<email>')` (existing; writes the row and the `config_change` event).
- `GET /api/spine/controls`: switches + legacy flags + `lastChanges` + `viewer.isOwner` + captions.
- `POST /api/comms-agent/config` (`server/comms-agent-config-routes.ts`, new; mounted in
  `server/index.ts` behind `requireAdmin`): the two legacy flags via `setCommsAgentConfig`, which now
  takes a `by` and records it (and `onInbound`) in its `config_change` event.
- `server/spine/golive-check.ts` (new): `runGoLiveCheck({ skipEvals })` — CUTOVER §0 as a table:
  worker heartbeat, `to_regclass` for the five comms tables + three columns, required templates
  approved (shared list in `server/template-status.ts`), eval regression red (SKIP on the page; reads
  `eval-results/latest.json` when run), legacy autosend OFF, shadow runs / errors in 24 h (WARN when
  none, NO-GO on an error spike), open flags past due (WARN), current mode (INFO). Loaders injectable.
  `GET /api/spine/golive-check?skipEvals=1`.
- Client `SpineSwitchStrip`: every chip is a toggle (optimistic pending state, refetch of
  `/api/spine/controls` and `/api/agents/staff` on settle); owner-only ones show 🔒 and are disabled
  for a `va` session; each control shows who last changed it and when; the mode pill opens a
  three-way off / shadow / live picker with the CUTOVER caption per mode; picking live runs the
  go-live check inline, refuses on any NO-GO, and only then shows the LIVE input; "Rollback to off"
  is always visible when not off; legacy autosend ON has its own typed confirmation.

## 2. Template status

- `server/template-status.ts` (new, pure): `EXPECTED_TEMPLATES` (holding line, missed-call ack,
  video / postcode / call requests as required; the two first-contact acks as optional) and
  `shapeTemplateStatus(rows)` → cached list (approved first), counts, `lastSyncedAt`, and per
  purpose approved / present / missing with the status per name; `requiredApproved`.
- `GET /api/whatsapp-templates/status` (`server/whatsapp-template-sync.ts`), reading the cache.
- Client `TemplateStatusPanel` moved under the switch strip: the expected-names table with a
  "NO-GO for live" mark, an "all required approved / required template missing" badge, the full
  cache collapsed below, and "Sync now" (the existing Twilio read). No submit button.

## 3. Shadow panel

- `GET /api/spine/shadow-report?days=1|7`: `compareShadow()` over the window; headline counts and
  agreement %, the decision matrix, and the last 10 pairs (newest first, with the run time).
- Client `ShadowPanel` under the templates: 7-day default with a 1-day toggle, five stat tiles,
  the matrix (diagonal in green), the last 10 pairs with thread links to `/admin/comms?conversation=…`.

## 4. Tests

`server/spine/controls.test.ts` (11: confirm rule, unknown fields, types, rights, ownership, the
last-change fold), `server/spine/golive-check.test.ts` (9: every verdict branch with fakes),
`server/template-status.test.ts` (4). Client tests: the client harness (P6-client-tests pane) has
not landed in this worktree; none written.

## Files (A2)

New: `server/spine/controls.ts`, `server/spine/controls.test.ts`, `server/spine/golive-check.ts`,
`server/spine/golive-check.test.ts`, `server/template-status.ts`, `server/template-status.test.ts`,
`server/comms-agent-config-routes.ts`.
Changed: `server/spine/routes.ts`, `server/whatsapp-template-sync.ts`, `server/agents/comms.ts`
(`setCommsAgentConfig(patch, by)`), `server/index.ts`, `client/src/pages/admin/AgentStaffPage.tsx`.
No migrations.

## Verification (A2, on top of A)

| Gate | Result |
|---|---|
| tsc vs `dfa65aa` | 1,876 → 1,876; the (file, error code) multiset is identical; line-level diff shows only pre-existing errors whose union-member text reordered |
| vitest | 42 pre-existing failures identical; 891 passed (24 new). One extra failure on the first run, `call-script/__tests__/performance.test.ts › should transition station in < 1ms`, a timing benchmark that ran while tsc held the machine; it passes alone (25/25) and nothing in this change touches call-script |
| esbuild `server/index.ts` | bundles |

## Not done, and why (A2)

- **`scripts/_golive-check.ts` did not exist** when this was built (it is the P6-golive pane's
  first item, in a different worktree), so there was nothing to reuse. `server/spine/golive-check.ts`
  is the shared logic; that script can be `runGoLiveCheck({ skipEvals: false })` + a printed table.
  If that pane lands its own checker, keep one and point the route at it.
- **Evals are skipped on the page** (decision 2, speed); the row says so and names the script.
  `runGoLiveCheck({ skipEvals: false })` reads `eval-results/latest.json` and never spawns the
  harness.
- **Sampler rate / video maxPerRun are not editable** on the page: only the switches are exposed;
  numbers stay script-set (the brief listed switches).
- **`comms_agent.enabled` (the legacy SLA sweep master), first-contact ack and auto quote-prep**
  stay read-only chips: the brief named only `autosend.enabled` and `onInbound`.
- **The go-live check runs on the process serving the page.** The heartbeat row is shared, so a
  passive process still reports the worker's heartbeat correctly; the shadow / flag counts are DB
  reads either way.

## Decisions (A2)

- Owner-only is enforced server-side (`isOwner` in both routes), not just by disabled buttons.
- The live flip is refused with 409 and the full go-live report when any NO-GO stands, even if the
  client sends the word; the client shows that report inline.
- `lastChangeByField` derives "who changed what" from the events the setters already write, so
  script flips (`scripts/_spine-mode.ts --by …`) show up too; no new table.
- `setCommsAgentConfig` gained a defaulted `by` parameter rather than a new setter, so every
  existing caller compiles unchanged and the event now carries the actor.
