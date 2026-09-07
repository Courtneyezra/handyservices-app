# B6 — Automatic demotion while the autonomy flag is off

## The decision that paid for this brief

PRD v3 §5.4 (`docs/comms-build/PRD-COMMS.md:195-209`). The owner wants the Scoper's replies to
reach customers without approving each one ("We dont need it queued it can send directly"). The day
that starts, a person sets an intent to SEND with `POST /api/spine/tiers`, and from then on the
only thing that can take the tier away again by itself is the 07:30 autonomy job.

On the start commit `8c80af6` that job is skipped unless `app_settings.spine.autonomy.enabled` is
true (`server/cron.ts:135-136`, via `isAutonomyEnabled` at `server/spine/config.ts:92-95`, which
also requires the master switch). The flag is off and is not eligible before 17 Sep, at a verdict
rate the business does not have. **So a day-one send would have no automatic demotion at all.** A
person can demote by hand; that is not a safety mechanism.

Scout report: `/Users/courtneebonnick/firstmate/data/scoping-autonomy-s4/report.md` §0, §2, §4, §6
(line references there are against `1fd113c`; the ones below are against `8c80af6`).

## What is true on `8c80af6` (verified, this worktree)

`server/spine/autonomy.ts`:

| Thing | Lines |
|---|---|
| `FAST_TRACK_INTENTS` | 33 |
| `GATE` | 35-46 |
| `INCIDENT_TAGS` (`incident`, `trust_concern`, `complaint`) | 49 |
| `demotionSignals` (pure; `unsafe_verdict`, `unsafe_sample`, `incident`, `sample_approval`) | 114-123 |
| `decideTier` (pure; never reads `lastChange`) | 125-179 |
| `gatherEvidence`; `INTENT_EXPR` at 253; the 30-day verdict query with no tier filter at 261-267; `lastChange` built at 317-318 and read by nothing | 244-323 |
| `applyDecision` (`by` defaults to `system:autonomy`, one ping) | 333-359 |
| `validateHumanTierRequest` | 390-410 |
| `effectiveTier` (module-private) | 422-426 |
| `evaluateAutonomy` (applies every non-hold decision when `dryRun` is false) | 492-519 |

`server/cron.ts:129-143`: the 07:30 job, worker-gated by `gateCustomerLoop`, the single
`isAutonomyEnabled()` gate at 135-136. `server/spine/config.ts:92-95`: master switch AND
`autonomy.enabled`; `getSpineConfig` at 111-128 fails closed.

`server/verdicts.ts:33-49` `recordVerdict`: the single writer of `draft_verdicts`, never throws.
Its four call sites: `server/message-drafts.ts:814` (approve / edit-with-reason) and `:861`
(reject), `server/spine/sampler.ts:211` (the judge), `server/agent-questions.ts:157` (Ben's tap on a
sampler question).

**Two facts the PRD does not state, and this brief rests on:**

1. **A message that went out at SEND tier never becomes a pending draft**, so the approve and
   reject routes can never record `unsafe` against it. The exit's `send` path
   (`server/spine/exit.ts:179-226`) queues a draft and approves it in the same pass with the agent
   approver; once its status is `sent`, approve returns `NOT_PENDING` and reject matches only
   `status = 'pending'` (`server/message-drafts.ts:851-853`). The one nuance: a SEND-tier proposal
   whose window is shut and has no approved template is *refused* and left pending
   (`exit.ts:223`), and Ben can reject that with `unsafe`. That is an unsent draft, and its verdict
   demoting the intent is the right outcome. For a message that was actually sent, the sampler's
   judge and Ben's tap on the sampler question are the only writers, and both sit behind
   `spine.sampler.enabled` (`sampler.ts:190`). **This task does not flip that flag.**
2. **The incident signal is `trust_concern` in practice.** `INCIDENT_TAGS` is
   `incident`, `trust_concern`, `complaint`. Nothing in `server/` writes an `incident` tag; triage
   raises `complaint` as an exception, not a tag (`server/spine/triage.ts:149`); `trust_concern`
   arrives through the Scoper's proposal tags (`server/spine/exit.ts:137`
   `PROPOSAL_TAG_ALLOWLIST`). The tag list is not widened here.

## What to build

All three parts. The job first, because it is where every signal is evaluated; the hook second,
because it closes the gap between the 08:30 sampler and the next 07:30 run.

### 1. Demote-only mode on the job

`evaluateAutonomy` gains `mode: 'full' | 'demote_only'`, default `'full'`, so every existing caller
and test is unchanged. In `demote_only`, `decideTier` runs exactly as today and every decision
still appears in the report and the table, but only `action === 'demote'` is applied; a `promote`
is neither applied nor errored and its table row says it was held. `applyDecision` is unchanged.

`server/cron.ts`: replace the single gate with a pure `autonomyJobMode(cfg): 'off' | 'demote_only'
| 'full'` in `server/spine/config.ts`: master switch off → `off` (fail closed); master on and
autonomy on → `full` (today's behaviour, byte for byte); master on and autonomy off →
`demote_only`. **No new `app_settings` field**: the point is that there is no flag to forget.
Still worker-gated.

`scripts/_autonomy-report.ts` gains `--demote-only`; `--apply --demote-only` is allowed while
`autonomy.enabled` is false (that is the mode's purpose); the existing refusal stays for a full
apply.

### 2. Window the evidence from the last human tier change

Where `lastChange.by` starts with `human:` and its tier is SEND, count `unsafe` verdicts,
`not fine: unsafe` samples, incidents and the sampled-approval set only from that moment onwards,
still capped by the 30-day window. Everything else counts as today. Apply the floor in
`gatherEvidence`; `decideTier` stays pure. The floor applies **only** to a human SEND: a
`system:autonomy` promotion is not floored, because the job's own signals blocking its own
re-promotion for a window is deliberate.

Why: without this the owner's day-one act is undone the next morning by an `unsafe` verdict Ben
recorded on a DRAFT-era draft of the same intent inside the last 30 days.

### 3. Synchronous demotion on an `unsafe` verdict

After a successful insert in `recordVerdict`, when the reason is `unsafe` and the verdict is not
`sample_fine`, fire and forget `demoteOnUnsafeVerdict` from `server/spine/autonomy.ts`, wrapped so
nothing it does can change `recordVerdict`'s return value, timing, or never-throw contract. Not
inside the verdict's transaction.

`demoteOnUnsafeVerdict` resolves (pack, intent) exactly as the job does (shared expression, not a
copy), returns quietly on no pack / no intent / a pack off the ladder, reads the effective tier and
returns when it is not SEND (the idempotence), otherwise builds a demote decision with rule
`unsafe_verdict` and calls `applyDecision` with `by: 'system:verdict'`. Never throws; every
failure is one warning line.

## Hard constraints

1. Demote-only never promotes. Pinned by a test over injected evidence.
2. `decideTier` stays pure and its numbers stay: no change to `GATE`, `FAST_TRACK_INTENTS`,
   `INCIDENT_TAGS` or the signal list.
3. The verdict row is never at risk: `recordVerdict` returns its row when the injected demoter
   rejects.
4. The evidence floor applies only to a human SEND.
5. No `app_settings` field added or flipped, no tier changed, no migration.
6. One owner ping per change, as today. A demote-only run that changes nothing pings nobody.
7. Do not touch the sampler, the verifier rubric, the tier route, the first-contact ack, prices,
   the sandbox, or the cadence work. The sibling task B7a works in `validateHumanTierRequest` and
   `server/spine/types.ts`; keep this diff away from those.

## Build gate (CLAUDE.md), measured

- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .`: zero NEW errors against
  `8c80af6` (1,880 pre-existing, measured here).
- vitest server project with a placeholder `DATABASE_URL`: failing set unchanged (43 tests in 4
  files on `8c80af6`, measured here), new tests passing. Judge by the set diff, not the count.
- esbuild bundles `server/index.ts`.
- Never `db:push`; no migration.

## Definition of done

- Demote-only over a set containing one promotable DRAFT intent and one SEND intent with an
  incident applies exactly the demotion and shows the held promotion.
- `autonomyJobMode` returns the three values for the three config shapes and the cron job uses it.
- A human SEND at t0 with an `unsafe` verdict at t0 − 1 d holds; the same verdict at t0 + 1 d
  demotes. Proven through the evidence fold with injected rows.
- `demoteOnUnsafeVerdict` with injected dependencies: SEND → one write and one ping; DRAFT →
  neither; unknown run → neither; a throwing write does not throw out.
- `recordVerdict` returns the inserted row when the demoter rejects.
- The dry-run report prints its table (injected evidence; there is no database here).
- The DONE report states plainly that no signal can reach a *sent* SEND-tier message until
  `spine.sampler.enabled` is on, that the incident signal is `trust_concern` in practice, and gives
  the exact route that turns the sampler on, without running it.
