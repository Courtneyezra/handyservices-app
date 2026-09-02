# Comms spine cutover — off → shadow → live

For the orchestrator. Every step is a flag flip or a query; nothing here edits code. The spine ships
dark (`app_settings.spine.enabled = false`, fail-closed), so until step 2 nothing below changes what
customers receive. Design references: COMMS_AGENTS_V3_DESIGN §3.9 (kill switches), §4 (evidence
gates), §10 (phase kill criteria), §0b (go-live: "switch as soon as eval families pass; no
mandatory shadow week").

## 0. Preconditions (all must be true)

- [ ] Railway service has `COMMS_WORKER=1` and `/api/health/comms-worker` returns 200 with a fresh
      heartbeat (Phase 0). No other process (laptop, second service) carries `COMMS_WORKER=1`.
- [ ] Local `.env` files point at a Neon branch, not `ep-broad-king` (worker gate warns loudly if not).
- [ ] Migrations applied: Phase 1 (`draft_verdicts`, `agent_runs`, `due_at`), Phase 3 / A
      (`pack_intent_tiers`, `pack_tier_events`). `SELECT to_regclass('pack_intent_tiers')` is not null.
- [ ] Meta templates APPROVED (check `/admin/staff` → templates, or `scripts/_wa-templates-status.ts`):
      `holding_line_v1` (submit with `npx tsx scripts/_submit-holding-template.ts --submit`, owner
      decision), `video_request` or `job_video_request`, `postcode_request`, `call_request`.
- [ ] `npx tsx scripts/eval-comms.ts` on the deploy commit: zero REGRESSION red (exit 0).
- [ ] Ben's operating model agreed (design §12.1): hours, and whether verdict-tapping is paid.
- [ ] Ben confirmed on the business number only (§3.1).

## 1. Flags (the `spine` row in `app_settings`)

```json
{
  "enabled": false,           // master; false = nothing in server/spine runs against customers
  "shadow": false,            // true = compute + record every run, never exit (no sends, no flags)
  "agents": { "scoper": { "enabled": true }, "quote_clerk": { "enabled": true }, "recovery": { "enabled": true } },
  "asks": { "enabled": false },      // rules-layer ask_media / ask_postcode from the exit (Phase 3 / C)
  "autonomy": { "enabled": false },  // promotion / demotion job (Phase 3 / A)
  "sampler": { "enabled": false },   // 10% next-morning sample review
  "sweepLimit": 3, "debounceMinutes": 10, "triageModel": "claude-haiku-4-5", "city": "nottingham"
}
```

Flip them on `/admin/staff` (every flip is logged to `system_events` as `config_change`) or with:

```sql
UPDATE app_settings SET value = value || '{"enabled": true, "shadow": true}'::jsonb, updated_at = now() WHERE key = 'spine';
```

## 2. Off → shadow (one working day minimum, optional per §0b but cheap)

1. `enabled: true, shadow: true`, everything else as above. The worker starts claiming runs;
   `runOnce(..., { dryRun: true })` records `agent_runs` rows with `proposal.dryRun = true`; the exit
   never fires; `asks` in shadow log `system_events` (`source = 'spine-asks'`, "would ask …").
2. Legacy comms agent keeps running exactly as before (DRAFT-only). Customers see no change.
3. Watch for a day (queries in §5). Exit shadow when: no `agent_runs.error` spikes, decision mix looks
   like the replay (`docs/comms-model/replay-summary.md` §B: ~17% Ben lane), and shadow asks would
   have fired on first contacts only.

## 3. Shadow → live (DRAFT everywhere; the rules layer is the only SEND)

1. `shadow: false`. Now the exit runs: Scoper proposals land as PENDING drafts with `due_at`
   (tier DRAFT for every intent, `pack_intent_tiers` empty), exceptions land as FLAGS with `due_at`,
   the holding line fires at 10 minutes of silence and at flag/draft expiry.
2. `asks.enabled: true`. First-contact silences get ONE content-free ask (media, then postcode),
   max one per thread per 24h, same suppression as the holding line.
3. Turn the legacy comms agent's on-inbound path OFF for the customer lane so two brains do not
   draft the same thread (`comms_agent.onInbound = false` in `app_settings`; the sweeps stay until
   Phase 5). Ben's queue now comes from the spine. **Note (P8, 3 Sep):** the legacy quote-prep
   handoff is ALREADY off in code — `maybeAutoQuotePrep` is a no-op and `comms_agent.quotePrep`
   is ignored whatever the row says. The spine clerk is the only intake in every mode (its card
   reads in shadow too); nothing to flip for it here.
4. `sampler.enabled: true` (needs Phase 3 / B if built; otherwise leave false and note it).
5. After ≥ 14 days of verdicts: `autonomy.enabled: true`. The daily job promotes per §4 / §0b and
   demotes on any `unsafe`. Promotions and demotions appear on `/admin/staff` and as Pushover.

## 4. Rollback (one command, any time)

```sql
UPDATE app_settings SET value = value || '{"enabled": false}'::jsonb, updated_at = now() WHERE key = 'spine';
```

Effect within one tick (≤ 15 s): no spine runs, no exits, no asks, no autonomy job. Pending drafts and
open flags stay where they are for Ben; nothing is deleted. Re-enable the legacy on-inbound path
(`comms_agent.onInbound = true`) if it was turned off in step 3.3. Demote a single intent instead of
the whole spine with `INSERT INTO pack_intent_tiers … tier = 'DRAFT'` (Phase 3 / A writes the event).

## 5. What to watch (first hour, then daily)

| Signal | Where | Healthy | Act when |
|---|---|---|---|
| Worker alive | `GET /api/health/comms-worker` (200/503), `/admin/staff` strip | 200, beat < 2 min | 503 or stale > 10 min → Pushover already fires; check Railway logs |
| Runs and decisions | `SELECT decision, lane, count(*) FROM agent_runs WHERE started_at > now() - interval '1 day' GROUP BY 1,2` | send ≈ 0 at launch (DRAFT everywhere), pending + flag + none | any `send` from `agent.*` before a promotion event |
| Errors | `SELECT count(*) FROM agent_runs WHERE error IS NOT NULL AND started_at > now() - interval '1 hour'` | 0–1 | > 3/hour → shadow |
| Holding-line rate | `SELECT count(*) FROM message_drafts WHERE source = 'rules_layer' AND reason LIKE '[silence]%' AND sent_at > now() - interval '1 day'` vs inbound bursts | < 30% of bursts | > 50% means drafts are not being approved in time: Ben's hours, not the code |
| Asks | `SELECT reason, count(*) FROM message_drafts WHERE source = 'rules_layer' AND reason LIKE '[ask_%' AND sent_at > now() - interval '1 day' GROUP BY 1` | ≤ 1 per new thread | asks on threads that already had media → bug, flip `asks.enabled` false |
| Ben's queue | `SELECT count(*) FROM message_drafts WHERE status = 'pending'` and past-due (`due_at < now()`) | past-due ≈ 0 | past-due growing → expiry holding lines are covering silence; fix hours |
| Opt-outs | `SELECT count(*) FROM opt_outs WHERE created_at > now() - interval '1 day'` (or the suppression table in use) | baseline | any rise the day after a change |
| Unanswered bursts | `docs/comms-model` replay definition; the 30-day metric | 23% → < 2% (§0b) | not falling after 2 weeks live |
| Verdicts | `GET /api/verdicts/stats?days=7` | ≥ 50% of drafts get a verdict | < 50% after 14 days → fix Ben's operating model before touching UI (§10 Phase 1 kill) |
| Unsafe | `SELECT count(*) FROM draft_verdicts WHERE reason = 'unsafe' AND created_at > now() - interval '7 days'` | 0 | any → the autonomy job demotes; read the thread the same day |

## 6. Kill criteria (design §10)

- **Phase 1**: verdict rate < 50% of drafts after 14 days → fix Ben's operating model (hours / pay)
  before touching the UI.
- **Phase 2**: the Scoper's eval family cannot reach pass^3 in two weeks → stop and review packs.
  (`npx tsx scripts/eval-comms.ts`, `eval-results/latest.json` → `families[intent].passed`; only the
  spine adapter run under `EVAL_LIVE=1` counts.)
- **Phase 3**: any `unsafe` verdict on a SEND-tier intent → automatic demotion to DRAFT, then review.
- **Any time**: a send with no `run_id` in the ledger, a send from a non-worker process, or a customer
  message that neither a person nor the rules layer answered within 24h → rollback (§4) and read the
  ledger before re-enabling.
