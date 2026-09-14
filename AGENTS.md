# V6 Switchboard ("The Monitor")

The V6 Handyman Operations system, isolating the "High IQ" components from V5 legacy: **The Monitor** (Twilio Realtime call transcription), **The Brain** (SKU detector turning a transcript into services and pricing), **The Face** (the HandymanLanding conversion page), and the comms desk under `server/spine/`.

## Tech Stack
React 18 + Vite 5 + TypeScript + Tailwind + shadcn/ui + Wouter; Express 4 on Node; PostgreSQL (Neon) with Drizzle. Twilio, OpenAI, Gemini, Deepgram, ElevenLabs, Stripe, WhatsApp Web.js, S3.

## Project Structure
```
client/src/  pages/admin, pages/contractor, components/quote, lib/quote-*.ts
server/      index.ts (entry + routes), spine/ (comms desk), agents/ (legacy
             comms, sweeps), quote-engine.ts, segmentation/
shared/schema.ts   eval-cases/   scripts/   migrations/   docs/
```

## Commands
```bash
npm run dev / build / seed   # dev, production build, seed the SKU table
npm run gate:prompts         # prompt/eval-case gate (see the spine-prompt-change skill)
npx tsx scripts/_apply-migration.ts migrations/<file>.sql   # apply a migration
npm run db:scrub -- --dry-run / --confirm / --verify   # synthetic-ise a non-production database
npx tsx scripts/_spine-mode.ts --status   # read the comms desk switches
npm run comms-v2:door        # serve the new desk's sandbox door on a loopback port (branch database only)
```

## Key Documentation
- `docs/RUNBOOK.md` — operations, health endpoints, the prompt and eval procedure
- `.no-mistakes.yaml` - the pipeline's runbook: the test step boots the app in a run copy on the non-production environment its run root provides through direnv, logs in as Ben and drives the admin page under test (`/admin/sandbox`, or `/admin/comms-v2` for a board change); that is the only validation
- `docs/COMMS_AGENTS_V3_DESIGN.md` — comms desk design; `docs/comms-build/CUTOVER.md` to switch or roll back
- `docs/comms-v2/README.md` — clean-sheet rebuild of the comms desk (behaviour oracle, checklist, agent map, the contracts and how a goal is validated); it lands in `server/comms-v2/` beside `server/spine/`, never inside it. `server/comms-v2/README.md` covers the new desk under `server/comms-v2/desk/` contract by contract, the Quoting specialist and its tool server under `server/comms-v2/quoting/`, the Scheduling specialist and its diary read under `server/comms-v2/scheduling/`, the Service specialist and its tool server under `server/comms-v2/service/`, its sandbox door and door host, and the environment they read. The new desk is sandbox-only until cutover; nothing in it is fixed by editing `server/spine/`. Ben's kanban board over it (`/admin/comms-v2`, `server/comms-v2/api/`) is in the same README: a hold releases only from a session the `comms_v2_approvers` app_settings row lists for the slot, so with no row nobody can release, and a reply Ben writes on a card goes out through the desk's one sender as `human:<their email or user id>`, which is itself the record of which person wrote it, with the eight guards not run over his words because they gate what the composer writes, and only the slot a file answers to may answer it
- `docs/comms-desk-log.md` — historical shipping log for the comms desk and the quoting segments. Not loaded into sessions; read it only for the history behind a decision.
- `docs/ROADMAP_STRATEGY.md`, `docs/SYSTEMATIC_ROADMAP.md` — phase strategy and tasks

## Current Phase: Phase 1 "Bionic CRM"
Operational utility before AI autonomy: invoicing and payments, dispatch and calendar, field app.

## Database
Key tables: `users`, `leads`, `calls`, `messages`, `personalized_quotes`, `productized_services` (SKUs), `handyman_profiles`, `message_drafts`, `draft_verdicts`, `kb_entries`, `eval_runs`, `app_settings`. The `db:push` script has been removed; migrations are idempotent SQL applied with the runner above.
**Nothing on a non-production database may identify a real person.** The pipeline drives the
product live against the branch and attaches sandbox evidence to every PR, so the branch is
synthetic: `server/scrub/` rewrites every identifying value and refuses to run against production
or against a schema carrying a column it does not classify. A new column forces a decision in
`server/scrub/plan.ts`: `server/scrub/__tests__/plan.test.ts` fails on it, and so does the next
scrub. Read `server/scrub/README.md` before adding one, before changing what a column holds, or
when asked whether some data is safe to publish.

## API Routes
- `/api/quotes`, `/api/calls`, `/api/leads` — quote, call, lead CRUD; `/api/twilio/*` webhooks
- `/api/spine/*` — comms desk config, tiers, go-live check, vision health (admin)
- `/api/comms-sandbox/*` — dry-run harness (admin; see the `comms-sandbox` skill)
- `/api/comms-v2/*` — the new desk's board, release and its own sandbox door (admin; `server/comms-v2/README.md`)
- `/api/health/comms-worker` — worker heartbeat, `status: 'ok' | 'stale'` as 200 / 503

## Invariants and gotchas
- **One pipeline, one sender.** `server/spine/` is the only customer-messaging path: case file → triage → policy pack → agent → guards → decision → exit. The exit is the only sender; every send carries an `Approver` and a run id. Legacy `server/agents/comms.ts` still drafts until Phase 5.
- **`COMMS_V2_INTAKE` is the only bridge from the old inputs to the new desk** (`server/comms-v2/channels/intake.ts`): exactly `1` is on, the way `COMMS_WORKER` is read; off by default; on, each old entry point also forwards its event to the new gateway, which runs in dry run until the new desk is live. The switch alone does not start it: `INTAKE_REQUIREMENTS` there lists what must land first (now none; case files persist through `server/comms-v2/desk/database-store.ts`, migration `20260913_comms_v2_case_files.sql` applied to the branch first) and the gateway refuses while any is outstanding. Its identity is seeded from `server/internal-numbers.ts`, the one list of numbers that are ours; Ben's handset and staff numbers outside the database go in the `INTERNAL_PHONE_NUMBERS` env var, never the repo. The old handler keeps running until cutover.
- **The new desk is live only when `commsV2Live()` says so** (`server/comms-v2/switch.ts`): `COMMS_V2_INTAKE=1`, `spine.commsDesk = 'comms_v2'` (read only through `isCommsV2Desk`) and `spine.senders.comms_v2.enabled`, in the `COMMS_WORKER=1` process. Every live re-point asks it (the database the intake's store and tools open, `server/comms-v2/live-database.ts`; the store Ben's board reads); the sandbox purpose never opens production whatever the switches say. Live, the new desk delivers and the old desk stands down on the same read (`server/comms-v2/old-desk.ts`: `OLD_DESK_SENDERS` refused at `server/outbound.ts`, the spine and the legacy agent read as off, no row written), and the live clock chases in the worker. The flip and the one-switch roll-back are `docs/comms-v2/cutover.md`.
- **Every automated sender needs a row in `server/sender-registry.ts`** or it does not compile. `transactional` may never carry a switch key; `operational` and `agent` must. The gate refuses an unregistered or switched-off approver, and is the one spine read that fails open.
- **Desk switches live in the `app_settings` row keyed `spine`** (`server/spine/config.ts`), fail-closed and clamped on read. Ask about `desk` only through `isDeskV4()`; a test fails direct reads.
- **Tiers cannot be made unsafe.** A pack's `neverSend` intents can never reach SEND (`server/spine/packs.ts`); `server/spine/send-preconditions.ts` gates the SEND move, belted by `server/spine/ask-ledger.ts`, the one ledger for the four ask subjects (`media`, `postcode`, `access`, `handoff`).
- **Only gas and asbestos are out of scope** (`RE_REGULATED` in `server/spine/triage.ts`; `DeclineReason` is `gas_work` only). Plumbing, roofing, structural and electrical work go to the Scoper.
- **Only the process with `COMMS_WORKER=1` runs customer clocks**, so a dead worker is a silent desk. Two alarms in `server/comms-worker-heartbeat.ts` cover wedged and dead separately; only the dead-worker one gates on production.
- **An answered outbound call re-enters the desk** as `call_ended` behind `outboundHandoffVerdict`'s fail-closed rails (`server/post-call-ladder.ts`). The call is then the newest turn, so replies stay drafts.
- **A handover comes back through `releaseFromBen`** (`server/handover.ts`) on any `human:*` send. Chase lanes are in `server/agents/sla-sweep.ts`; `WAITING_DRAFT_WHERE` in `server/spine/price-brief.ts` is the only definition of a waiting price draft.
- **Outside WhatsApp's 24-hour window only a Meta-approved template sends.** One registry (`server/window-templates.ts`), one per purpose; live status only from `server/whatsapp-template-sync.ts`. Branch on `purpose`, never a name: a plain STOP blocks `marketing`; an omitted purpose takes the sender's registered one, else marketing.
- **Facts about the business come from `kb_entries`** (migration `20260908_kb_entries.sql`), read through the reviewed-only helpers in `server/spine/knowledge-base.ts`. Ben's page is `/admin/knowledge`; not wired into `server/spine/`'s reply path. The comms-v2 Service specialist (`server/comms-v2/service/`) reads it through those same helpers, sandbox-only until cutover.
- **Media descriptions come from Gemini** (`server/spine/tools/describe-video.ts`); model prices live only in `server/agent-cost.ts`. Check `server/spine/vision-health.ts` before debugging an empty one.
- **Build gate:** no new tsc errors or vitest failures against your own start commit; esbuild still bundles. The pre-existing baseline is large; measure it first.
- Two data-protection files must stay true when a data flow changes (`customer-data-processors` skill). Apple Pay's domain association file is served by a route in `server/index.ts`; never remove it (`apple-pay-domain` skill).

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
