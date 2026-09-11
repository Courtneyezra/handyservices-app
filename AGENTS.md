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
npx tsx scripts/_spine-mode.ts --status   # read the comms desk switches
npm run comms-v2:judge       # Goal 0 judge: the eleven Goal 1 checklist lines through the sandbox door, twice
```

## Key Documentation
- `docs/RUNBOOK.md` — operations, health endpoints, the prompt and eval procedure
- `docs/COMMS_AGENTS_V3_DESIGN.md` — comms desk design; `docs/comms-build/CUTOVER.md` to switch or roll back
- `docs/comms-v2/README.md` — clean-sheet rebuild of the comms desk (behaviour oracle, checklist, agent map, the seven contracts); it lands in `server/comms-v2/` beside `server/spine/`, never inside it. `server/comms-v2/README.md` covers the judge (how to run it, `--desk v2|current`, where the reports go) and the new desk under `server/comms-v2/desk/`, contract by contract. The new desk is sandbox-only until cutover; nothing in it is fixed by editing `server/spine/`
- `docs/comms-desk-log.md` — historical shipping log for the comms desk and the quoting segments. Not loaded into sessions; read it only for the history behind a decision.
- `docs/ROADMAP_STRATEGY.md`, `docs/SYSTEMATIC_ROADMAP.md` — phase strategy and tasks

## Current Phase: Phase 1 "Bionic CRM"
Operational utility before AI autonomy: invoicing and payments, dispatch and calendar, field app.

## Database
Key tables: `users`, `leads`, `calls`, `messages`, `personalized_quotes`, `productized_services` (SKUs), `handyman_profiles`, `message_drafts`, `draft_verdicts`, `kb_entries`, `eval_runs`, `app_settings`. Never `db:push`; migrations are idempotent SQL applied with the runner above.

## API Routes
- `/api/quotes`, `/api/calls`, `/api/leads` — quote, call, lead CRUD; `/api/twilio/*` webhooks
- `/api/spine/*` — comms desk config, tiers, go-live check, vision health (admin)
- `/api/comms-sandbox/*` — dry-run harness (admin; see the `comms-sandbox` skill)
- `/api/health/comms-worker` — worker heartbeat, `status: 'ok' | 'stale'` as 200 / 503

## Invariants and gotchas
- **One pipeline, one sender.** `server/spine/` is the only customer-messaging path: case file → triage → policy pack → agent → guards → decision → exit. The exit is the only sender; every send carries an `Approver` and a run id. Legacy `server/agents/comms.ts` still drafts until Phase 5.
- **Every automated sender needs a row in `server/sender-registry.ts`** or it does not compile. `transactional` may never carry a switch key; `operational` and `agent` must. The gate refuses an unregistered or switched-off approver, and is the one spine read that fails open.
- **Desk switches live in the `app_settings` row keyed `spine`** (`server/spine/config.ts`), fail-closed and clamped on read. Ask about `desk` only through `isDeskV4()`; a test fails direct reads.
- **Tiers cannot be made unsafe.** A pack's `neverSend` intents can never reach SEND (`server/spine/packs.ts`); `server/spine/send-preconditions.ts` gates the SEND move, belted by `server/spine/ask-ledger.ts`, the one ledger for the four ask subjects (`media`, `postcode`, `access`, `handoff`).
- **Only gas and asbestos are out of scope** (`RE_REGULATED` in `server/spine/triage.ts`; `DeclineReason` is `gas_work` only). Plumbing, roofing, structural and electrical work go to the Scoper.
- **Only the process with `COMMS_WORKER=1` runs customer clocks**, so a dead worker is a silent desk. Two alarms in `server/comms-worker-heartbeat.ts` cover wedged and dead separately; only the dead-worker one gates on production.
- **An answered outbound call re-enters the desk** as `call_ended` behind `outboundHandoffVerdict`'s fail-closed rails (`server/post-call-ladder.ts`). The call is then the newest turn, so replies stay drafts.
- **A handover comes back through `releaseFromBen`** (`server/handover.ts`) on any `human:*` send. Chase lanes are in `server/agents/sla-sweep.ts`; `WAITING_DRAFT_WHERE` in `server/spine/price-brief.ts` is the only definition of a waiting price draft.
- **Outside WhatsApp's 24-hour window only a Meta-approved template sends.** One registry (`server/window-templates.ts`), one per purpose; live status only from `server/whatsapp-template-sync.ts`. Branch on `purpose`, never a name: a plain STOP blocks `marketing`; an omitted purpose takes the sender's registered one, else marketing.
- **Facts about the business come from `kb_entries`** (migration `20260908_kb_entries.sql`), read through the reviewed-only helpers in `server/spine/knowledge-base.ts`. Ben's page is `/admin/knowledge`; not wired into a reply path.
- **Media descriptions come from Gemini** (`server/spine/tools/describe-video.ts`); model prices live only in `server/agent-cost.ts`. Check `server/spine/vision-health.ts` before debugging an empty one.
- **Build gate:** no new tsc errors or vitest failures against your own start commit; esbuild still bundles. The pre-existing baseline is large; measure it first.
- Two data-protection files must stay true when a data flow changes (`customer-data-processors` skill). Apple Pay's domain association file is served by a route in `server/index.ts`; never remove it (`apple-pay-domain` skill).

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
