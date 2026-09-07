# B6 — Automatic demotion while the autonomy flag is off: DONE report

Brief: `BRIEF-B6-automatic-demotion.md`. Branch `fm/auto-demotion-b6`, start commit `8c80af6` (T6
merged). PRD v3 §5.4.

**Nothing here turns anything on.** No `app_settings` field was added or flipped, no tier moved, no
migration. This branch makes a future human SEND (`POST /api/spine/tiers`) *safe to set*; setting
it, and turning the sampler on, stay the owner's own acts.

**Nothing here was seen live.** This worktree has no `.env`, no database and no model key. Every
claim below rests on unit tests over injected rows and mocked database modules, plus the build
gate. The two things that read a database (`gatherEvidence`, the report script's dry run) were
not run against one; the injected-evidence tests are their proof.

---

## Read this first (for the owner)

### 1. Until the sampler is on, no verdict can reach a message that actually went out

The only rows that demote an intent are `draft_verdicts` with reason `unsafe`, a sampled
`not fine: unsafe`, a sampled-approval rate under 80%, and an incident tag on a conversation the
intent sent to. `draft_verdicts` has four writers, all through `recordVerdict`:

| Writer | Can it judge a message that was SENT at SEND tier? |
|---|---|
| Approve / edit-with-reason (`server/message-drafts.ts:814`) | No — the route acts on a *pending* draft; a sent one returns `NOT_PENDING` |
| Reject (`server/message-drafts.ts:861`) | No — matches `status = 'pending'` only |
| The sampler's judge (`server/spine/sampler.ts:211`) | **Yes, but only when `spine.sampler.enabled` is true** (`sampler.ts:190`) |
| Ben's tap on a sampler question (`server/agent-questions.ts:157`) | **Yes, but there is no question to tap until the sampler queued one** |

So: **no verdict-based signal (unsafe verdict, unsafe sample, sample approval) can reach a sent
SEND-tier message until you turn the morning sampler on.** The one signal that works without it is
the incident tag, and **in practice that is `trust_concern` only**: `INCIDENT_TAGS` is `incident`,
`trust_concern`, `complaint` (`server/spine/autonomy.ts:62`), but nothing in `server/` writes an
`incident` tag, triage raises `complaint` as an *exception* rather than a tag
(`server/spine/triage.ts:149`), and `trust_concern` is written only when a later Scoper run
proposes it (`server/spine/exit.ts:137`). The tag list was not widened here; BACKLOG **B6-a** asks
whether it should be.

One nuance, for completeness: a SEND-tier proposal whose 24-hour window is shut and has no approved
template is *refused* and left pending (`server/spine/exit.ts:223`). Ben can reject that with
`unsafe`, and with this branch that rejection demotes the intent within the second. That is an
unsent draft, and demoting on it is the right outcome.

### 2. How to turn the sampler on (not done here; do not do it until you mean to)

There is no script for it (`scripts/_spine-mode.ts` only flips off / shadow / live). The switch
lives on the staff page and is one click:

1. Open **https://www.handyservices.app/admin/staff** and log in as admin.
2. Find the **Spine switches** strip (the box that starts with the mode picker: off / shadow / live).
3. Click the toggle labelled **`sampler off`**. It becomes **`sampler on · 10%`**.

That click sends `POST /api/spine/config` with the body `{"sampler":{"enabled":true}}`
(`client/src/pages/admin/AgentStaffPage.tsx:708` → `server/spine/routes.ts:131` →
`server/spine/controls.ts:91`), writes `app_settings.spine.sampler.enabled = true`, and logs a
`config_change` event with who did it. Any admin can flip it, the VA included; it is not owner-only.
To turn it off again, click the same toggle.

**What it starts doing:** every morning at 08:30 UK the comms worker picks 10% of yesterday's
*automatic* sends (at least 1, at most 15) plus every one with a bad signal (an opt-out after it, a
complaint keyword in the reply, or a question that got no reply in 48 hours), has the verifier
judge each one, and queues a *fine / not fine* tap for Ben under "Yesterday's automatic sends to
check" on the comms page. Every judgement, the judge's and Ben's, is a `draft_verdicts` row, and an
`unsafe` one now demotes the intent the moment it lands. Today every customer intent is at DRAFT,
so there are no automatic sends to sample and the run queues nothing; it costs nothing to have on
before the first SEND, and it must be on before one.

### 3. What now happens the morning after a human SEND

With the spine on and `autonomy.enabled` off (today's row), the 07:30 job runs in **demote-only**
mode every day. It decides exactly as before, prints the same table, but writes only demotions. A
promotion it would have made is shown as `[held: demote-only]` and not written. An intent you set
to SEND is judged only on what happened *after* you set it: an `unsafe` verdict Ben recorded last
week on a DRAFT-era draft of the same intent does not undo your act next morning. Anything after
it still does.

---

## What was verified on `8c80af6` before building

Line numbers are the start commit's.

| Item | Where |
|---|---|
| `FAST_TRACK_INTENTS`, `GATE`, `INCIDENT_TAGS` | `server/spine/autonomy.ts:33`, `:35-46`, `:49` |
| `demotionSignals` (pure; `unsafe_verdict`, `unsafe_sample`, `incident`, `sample_approval`), `decideTier` (pure, never reads `lastChange`) | `:114-123`, `:125-179` |
| `gatherEvidence`; the 30-day verdict query with no tier filter; `lastChange` built and unused | `:244-323`, `:261-267`, `:317-318` |
| `applyDecision` (`by` defaults to `system:autonomy`), `effectiveTier` (module-private), `validateHumanTierRequest`, `evaluateAutonomy` | `:333-359`, `:422-426`, `:390-410`, `:492-519` |
| The 07:30 job's single `isAutonomyEnabled()` gate, worker-gated | `server/cron.ts:133-136`; `server/spine/config.ts:92-95` (master AND autonomy), `:111-128` (fail closed) |
| `recordVerdict`, single writer, never throws; its four call sites | `server/verdicts.ts:33-49`; `message-drafts.ts:814`, `:861`; `sampler.ts:211`; `agent-questions.ts:157` |
| Fact 1 (a sent SEND message never becomes a pending draft) | `exit.ts:179-226` (queue + agent-approve in one pass); `message-drafts.ts:851-853` (reject needs pending) |
| Fact 2 (no `incident` writer; `complaint` is an exception) | `triage.ts:149`; `exit.ts:137` |

---

## What shipped

### 1. Demote-only mode on the job

- `server/spine/config.ts:107` `autonomyJobMode(cfg)`: `enabled !== true` → `off`; enabled and
  `autonomy.enabled === true` → `full`; enabled and anything else → `demote_only`. Pure. `:112`
  `getAutonomyJobMode()` wraps the fail-closed row read. `isAutonomyEnabled` is untouched.
- `server/spine/autonomy.ts:635` `AutonomyMode`; `evaluateAutonomy` (`:659`) takes `mode`
  (default `'full'`, so every existing caller and the 28 pre-existing tests are unchanged). In
  `demote_only` a `promote` decision is pushed to the new `report.held` and skipped (`:678`);
  `decideTier` and `applyDecision` are untouched. The table header says `(demote-only: promotions
  are reported, never applied)`, the row says `[held: demote-only]`, and a `held (demote-only):`
  summary line lists them. `AutonomyReport` gains `mode` and `held`.
- `server/cron.ts:138-143`: the 07:30 job reads `getAutonomyJobMode()`; `off` skips (fail closed),
  otherwise it runs `evaluateAutonomy({ dryRun: false, mode })`. Still inside `gateCustomerLoop`.
- `scripts/_autonomy-report.ts`: `--demote-only`. `--apply --demote-only` needs only
  `spine.enabled`; a full `--apply` still needs both switches. With no reachable database the
  script fails closed: `Refusing --apply: app_settings.spine.enabled is false` (observed here).

### 2. The evidence floor from the last human SEND

- `autonomy.ts:132` `evidenceFloorMs(lastChange)`: epoch ms of the newest tier event **only**
  when its tier is SEND and `by` starts with `human:`; null otherwise (a `system:autonomy` or
  `system:verdict` event, a demotion, no event, an unparseable time).
- `:149` `foldWindow(verdictRows, incidentRows, floorMs)`: `unsafe`, the whole sampled set and
  the incident count are counted from the floor; the human counts (approve / edit / reject,
  unedited %, first_at) still span the 30-day window, because they are promotion evidence and a
  SEND does not promote.
- `gatherEvidence` now fetches the 30-day verdict rows and the 30-day incident runs ungrouped with
  their epoch ms (the ledger holds tens of rows), reads `at_ms` on `pack_tier_events` and
  `pack_intent_tiers`, and folds per (pack, intent) with the floor (`:379`). `IntentEvidence`
  gains `evidenceFloor` (ISO, or null) and the table's *why* column shows `(signals counted from
  human SEND at …)` when one applied. The fallback `lastChange` from `pack_intent_tiers` (no event
  row) floors the same way, because a human write puts `human:<id>` in `changed_by` too.
- `INTENT_EXPR` became the exported `intentExprSql(sql)` (`:276`), shared with the demoter.

### 3. Synchronous demotion on an `unsafe` verdict

- `server/verdicts.ts:48` `recordVerdict(input, hooks?)`: after a successful insert, when
  `isUnsafeVerdict(input)` (reason `unsafe`, verdict not `sample_fine`), it fires the demoter
  fire-and-forget off its own promise chain (`:65-73`): `void Promise.resolve().then(() =>
  demote(payload)).catch(warn)`. A sync throw, a rejection, a hang or a missing database changes
  nothing about the return value or timing. A failed insert returns null and fires nothing.
- `server/spine/autonomy.ts:596` `demoteOnUnsafeVerdict(input, deps?)`: refuses a non-unsafe
  verdict; resolves (pack, intent) with the job's own expression (`resolveVerdictIntent`, `:573`:
  `agent_runs` by `COALESCE(runId, message_drafts.run_id)`); returns quietly on no pack, no intent,
  a pack off the ladder, or an intent outside the pack; reads `effectiveTier`; returns when it is
  not SEND (the idempotence); otherwise builds `{ from: SEND, to: DRAFT, action: demote, rule:
  unsafe_verdict }` with a minimal `IntentEvidence` carrying `trigger` (draft, run, verdict id and
  author) and calls `applyDecision` with `by: 'system:verdict'`. Same tables, same event log, same
  single owner ping. Never throws; every failure is one `console.warn`.
- All four writers flow through `recordVerdict`, so one hook covers Ben's reject and
  edit-with-reason, the judge's sampled `unsafe`, and Ben's sampler tap. Parity with the job: no
  author filter.

## Tests (30 new, all passing; the failing set is unchanged)

| File | What it pins |
|---|---|
| `server/spine/autonomy.test.ts` (+16) | demote-only over `[promotable DRAFT, SEND with incident, clean SEND]` applies exactly the demotion, holds the promotion, table shows both; never promotes over two promotable intents; a no-change run applies nothing; default mode is full and identical to before; dry run prints the table; `GATE` / `FAST_TRACK_INTENTS` / `INCIDENT_TAGS` unchanged. Floor: human SEND at t0 with `unsafe` at t0 − 1 d → `hold`, at t0 + 1 d → `demote`; `system:autonomy` SEND is not floored; incidents and samples floored, promotion counts not. Demoter with injected deps: SEND → one write with `by: system:verdict`; DRAFT → none; unknown run / off-ladder pack / foreign intent → none and the tier is never read; `sample_fine` and non-unsafe never reach the resolver; the judge's sampled `unsafe` demotes; a throwing write / resolver / tier read never throws out (one warning each). |
| `server/spine/autonomy-demote.test.ts` (4, `../db` and `../system-events` mocked) | Through the **real** `applyDecision`: SEND → one `pack_intent_tiers` upsert to DRAFT and one `pack_tier_events` row, both `system:verdict`, the event carrying `trigger`, one ping; DRAFT → no write, no ping; unknown run → neither; a failing insert → no throw, no ping. |
| `server/spine/config.test.ts` (4) | `autonomyJobMode` for the three shapes, fail-closed on a missing or non-boolean master switch, `demote_only` when `autonomy` is absent or malformed, agrees with `spineMode` on `off`. |
| `server/verdicts.test.ts` (6, `./db` mocked) | `recordVerdict` returns its row when the demoter rejects, when it throws synchronously, and when it never resolves (raced against 500 ms); the hook fires only for `unsafe` and not `sample_fine`; a failed insert returns null and fires nothing; `isUnsafeVerdict`. |

## Build gate, as measured

Both sides measured in this worktree, no `.env`, the same placeholder `DATABASE_URL`
(`127.0.0.1:1`, refuses every connection). "Before" is `8c80af6` untouched; "after" is this branch.
The vitest diff is test-by-test from the JSON reporter, not counts.

| Check | `8c80af6` | This branch |
|---|---|---|
| `tsc --noEmit -p .` errors (8 GB heap) | 1,880 | 1,880 |
| tsc errors NEW vs start | — | **0**. Per-file counts identical. The nine lines that differ textually are the same errors at the same positions (`agents/comms.ts:1377`, `first-contact-ack.ts:927`, `:1169`, `lead-stage-engine.ts` ×5, `leads.ts:2264`) with union members printed in a different order; none of those files is touched. |
| vitest server: failing tests / files | 43 / 4 | 43 / 4 |
| vitest failing-set diff | — | **identical**; 1,477 → 1,507 tests, 1,426 → 1,456 passing; 0 unhandled errors both runs |
| new tests | — | 30, all passing |
| esbuild `server/index.ts` (the build script's flags) | — | bundles, 4.4 MB, exit 0 |
| `db:push` / migration / `app_settings` / tier / sampler / verifier / tier route / prices / ack / sandbox / cadence | none | none |

## Not done

- **Nothing was seen live.** No database, no worker, no model key. `gatherEvidence`'s new SQL
  (ungrouped rows with `extract(epoch …) * 1000` as `at_ms`, and the same on `pack_tier_events` /
  `pack_intent_tiers`) has been type-checked and its fold tested, but it has not been executed
  against Postgres. First thing after merge, on the worker or a dev branch:
  `npx tsx scripts/_autonomy-report.ts --dry-run --demote-only` and read the table.
- **The report script's dry run was not run against a database** (none here). Run without one it
  fails at the connection, as expected; `--apply` refuses first, fail closed.
- **The `incident` tag list was not widened** (hard constraint). Recommendation, as BACKLOG
  **B6-a**: have the complaint lexicon also write a `complaint` tag on the thread, so a complaint
  after an automatic send is an incident the next morning without the sampler. Today only
  `trust_concern` works, and only when a later Scoper run proposes it.
- **The `sample_approval` signal is floored with the rest.** A human SEND therefore also resets
  the sampled-approval denominator to the samples after it; with `minSamplesForRate: 5` it takes
  five post-SEND samples before the rate can demote. That is the brief's intent ("the sampled set
  from that moment onwards"); noting it because it delays that one signal by a few days.
- **Captain decision D3** (scout report §10) asked whether the floor is wanted at all. It is built
  as briefed. If the answer is no, delete `evidenceFloorMs` / `foldWindow`'s floor branch and
  their tests; the demote-only mode and the hook do not depend on it.
- **`fm-ensure-agents-md.sh` was not run**, for T5/T6's reason: it would move `CLAUDE.md` into a
  new `AGENTS.md`, a restructuring outside this task. `CLAUDE.md` was not edited either, to keep
  the diff away from the sibling PR (B7a); the one-line pointer for "Current Work in Progress"
  should be added when the two have merged.
- **Sibling B7a** touches `validateHumanTierRequest` and `server/spine/types.ts`; this branch
  touches neither, so the two should rebase cleanly.
