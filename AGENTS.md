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
- `docs/comms-v2/README.md` — clean-sheet rebuild of the comms desk (behaviour oracle, checklist, agent map, the contracts and how a goal is validated); it lands in `server/comms-v2/` beside `server/spine/`, never inside it. `server/comms-v2/README.md` covers the new desk under `server/comms-v2/desk/` contract by contract, the Quoting specialist and its tool server under `server/comms-v2/quoting/`, the Scheduling specialist and its diary read under `server/comms-v2/scheduling/`, the Service specialist and its tool server under `server/comms-v2/service/`, its sandbox door and door host, and the environment they read. The new desk is the live desk in production whenever `commsV2Live()` holds (cut over 15 Sep 2026), the old desk its dormant roll-back; nothing in it is fixed by editing `server/spine/`. Ben's kanban board over it (`/admin/comms-v2`, `server/comms-v2/api/`) and the Handy Desk redesign's queue and ask bar over the same API (`/admin/handy-desk`; it never reads the old `/api/desk` or `/api/ops`) are in the same README: a hold releases only from a session the `comms_v2_approvers` app_settings row lists for the slot, so with no row nobody can release, and a reply Ben writes on a card goes out through the desk's one sender as `human:<their email or user id>`, which is itself the record of which person wrote it, with the eight guards not run over his words because they gate what the composer writes, and only the slot a file answers to may answer it
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
- `/api/comms-v2/*` — the new desk's board, release, its own sandbox door, and the Handy Desk ask agent under `/ask`, whose tools only read, hold a draft, or save a proposal (`comms_v2_ask_actions`) that runs only on the signed-in person's `POST /ask/actions/:id/confirm` (admin; `server/comms-v2/README.md`)
- `/api/admin/contractor-desk/*` — Ben's Contractors page, reached from the Handy Desk (admin, VAs included; `server/contractor-desk/`). Every read names its fields and never returns a login secret or password field; it replaces the old `/api/admin/contractors` reads, which stay for the old pages until the new page lands
- `/api/health/comms-worker` — worker heartbeat, `status: 'ok' | 'stale'` as 200 / 503

## Invariants and gotchas
- **One pipeline, one sender.** `server/spine/` is the only customer-messaging path: case file → triage → policy pack → agent → guards → decision → exit. The exit is the only sender; every send carries an `Approver` and a run id. Legacy `server/agents/comms.ts` still drafts until Phase 5.
- **`COMMS_V2_INTAKE` is the only bridge from the old inputs to the new desk** (`server/comms-v2/channels/intake.ts`): exactly `1` is on, the way `COMMS_WORKER` is read; off by default; on, each old entry point also forwards its event to the new gateway, which runs in dry run until the new desk is live. The switch alone does not start it: `INTAKE_REQUIREMENTS` there lists what must land first (now none; case files persist through `server/comms-v2/desk/database-store.ts`, migration `20260913_comms_v2_case_files.sql` applied to the branch first) and the gateway refuses while any is outstanding. Its identity is seeded from `server/internal-numbers.ts`, the one list of numbers that are ours; Ben's handset and staff numbers outside the database go in the `INTERNAL_PHONE_NUMBERS` env var, never the repo. The old handler keeps running until cutover. `POST /api/leads` is not only the web form's route — the quote page, the instant-quote card and a quote link all post to it — so only an enquiry forwards: `isWebFormEnquiry` (`server/leads.ts`) is the one rule both the forward and the old ingest read, and a lead carrying a `stripePaymentId` is never one. Add a lead source there, not to one path.
- **Inbound email is Resend's signed webhook** (`server/comms-v2/channels/email-inbound.ts`, `POST /api/webhooks/resend/inbound-email`), off unless `COMMS_V2_EMAIL_INBOUND=1` as well as `COMMS_V2_INTAKE=1`. A provider webhook is never mounted under `/api/comms-v2`, where `requireAdmin` refuses every provider POST; it authenticates itself, over a raw body parsed ahead of the global JSON parser. Each accepted email is written to `comms_v2_inbound_emails` before Resend gets its 200 and retried into the desk from the worker's minute loop (`server/comms-v2/channels/inbound-email-store.ts`); a hand-over carries `Turn.deliveryId`, which the gateway never lands twice. Runbook: `docs/RUNBOOK.md`, "Inbound email (Resend)".
- **The new desk is live only when `commsV2Live()` says so** (`server/comms-v2/switch.ts`): `COMMS_V2_INTAKE=1`, `spine.commsDesk = 'comms_v2'` (read only through `isCommsV2Desk`) and `spine.senders.comms_v2.enabled`, in the `COMMS_WORKER=1` process. Every live re-point asks it (the database the intake's store and tools open, `server/comms-v2/live-database.ts`; the store Ben's board reads; the Stripe webhook's acceptance, `server/comms-v2/quoting/live-acceptance.ts`); the sandbox purpose never opens production whatever the switches say. Live, the new desk delivers and the old desk stands down on the same read (`server/comms-v2/old-desk.ts`: `OLD_DESK_SENDERS` refused at `server/outbound.ts`, the spine and the legacy agent read as off, no row written), and the live clock chases in the worker. Live, the old `/admin/comms` page is retired for customers but keeps its contractor lane (`server/comms-v2/old-comms.ts`): its customer sends refuse, and staff links go to `/admin/comms-v2` through `staffThreadPath`; a new link to a customer thread asks that rather than hard-coding `/admin/comms`. The flip and the one-switch roll-back are `docs/comms-v2/cutover.md`.
- **`/admin/handy-desk` and `/admin/comms-v2` render full screen, outside the admin shell** (`isFullScreenAdmin`, `client/src/lib/handy-desk-path.ts`, read in `client/src/App.tsx`; the diary joins when it lands). `SidebarLayout` is a lazy chunk they never fetch, and the live-call provider does not mount there; the desk's header and the shell share the quick links in `client/src/components/layout/QuickLinks.tsx`, the comms board carries `client/src/components/layout/FullScreenHeader.tsx` (words only), and each lazy "More" menu lists the sidebar's own items from `client/src/components/layout/admin-nav.ts`. Keep new desk code off the shell's imports. Price and Send (`/admin/price/:slug`, matched by `client/src/lib/price-and-send-path.ts`) is outside the shell too, its own dark header the only one on the route; unlike the desk it keeps the live-call provider.
- **`requireAdmin` (`server/auth.ts`, admits VAs) reads only the `Authorization: Bearer` header.** Many routers are mounted bare in `server/index.ts` and guard each route themselves, so a new admin route carries its own `requireAdmin`, and an admin page's fetch sends `adminAuthHeaders()` (`client/src/lib/admin-auth.ts`). Only admins verify or activate a contractor; a contractor's own profile write is checked by `selfProfileRefusal` (`server/contractor-auth.ts`).
- **A new-desk case file is closed once `booked` or `done`** (`server/comms-v2/file-close.ts`): the person's next message opens a new file. Every booking, completion and invoice-paid writer calls it (listed in its header); a new writer of those events calls it too.
- **Every automated sender needs a row in `server/sender-registry.ts`** or it does not compile. `transactional` may never carry a switch key; `operational` and `agent` must. The gate refuses an unregistered or switched-off approver, and is the one spine read that fails open.
- **Desk switches live in the `app_settings` row keyed `spine`** (`server/spine/config.ts`), fail-closed and clamped on read. Ask about `desk` only through `isDeskV4()`; a test fails direct reads.
- **Tiers cannot be made unsafe.** A pack's `neverSend` intents can never reach SEND (`server/spine/packs.ts`); `server/spine/send-preconditions.ts` gates the SEND move, belted by `server/spine/ask-ledger.ts`, the one ledger for the four ask subjects (`media`, `postcode`, `access`, `handoff`).
- **Only gas and asbestos are out of scope** (`RE_REGULATED` in `server/spine/triage.ts`; `DeclineReason` is `gas_work` only). Plumbing, roofing, structural and electrical work go to the Scoper.
- **Only the process with `COMMS_WORKER=1` runs customer clocks**, so a dead worker is a silent desk. Two alarms in `server/comms-worker-heartbeat.ts` cover wedged and dead separately; only the dead-worker one gates on production. A breathing worker is not a desk that can answer: `server/comms-v2/desk/model-health.ts` judges each live customer turn's model calls structurally (`StructuredResult.failure`, never the error text), pages on it and feeds `status: 'cannot_answer'` on `/api/health/comms-worker`.
- **The new desk never promises to come back** (the captain's ruling, 18 Sep 2026: "remove that line entirely"). Where it cannot answer, it holds for Ben and says nothing about the held part; a turn with nothing else to answer sends nothing (`server/comms-v2/service/hold-reasons.ts` `FIXED_LINE_FOR`, `heldSilently` in `server/comms-v2/desk/desk.ts`), and the commitment guard refuses `RE_COMES_BACK` outside a fixed line. Never add a holding or reassurance line to fill that silence.
- **An answered outbound call re-enters the desk** as `call_ended` behind `outboundHandoffVerdict`'s fail-closed rails (`server/post-call-ladder.ts`). The call is then the newest turn, so replies stay drafts.
- **A handover comes back through `releaseFromBen`** (`server/handover.ts`) on any `human:*` send. Chase lanes are in `server/agents/sla-sweep.ts`; `WAITING_DRAFT_WHERE` in `server/spine/price-brief.ts` is the only definition of a waiting price draft.
- **Outside WhatsApp's 24-hour window only a Meta-approved template sends.** One registry (`server/window-templates.ts`), one per purpose; live status only from `server/whatsapp-template-sync.ts`. Branch on `purpose`, never a name: a plain STOP blocks `marketing`; an omitted purpose takes the sender's registered one, else marketing.
- **The new desk reads a known customer's CRM record read-only** (`server/comms-v2/service/customer-record.ts`): identity binds only a key a turn proved on WhatsApp, SMS or an email the record holds (answer 126; never a web form, a call or a form-linked key) to exactly one `service_clients` row, the binding rides on the turn, and Service reads that client's leads, quotes, jobs and sent invoices, never an email, address or postcode column. A record value is citable and passes the figure and date guards only on the run that read it (`isReadThisRunOnly`), and a money question is handed off by the router only to a specialist that answers it from a row (a live quote line, a known customer's invoice), which then owns the money hold.
- **Facts about the business come from `kb_entries`** (migration `20260908_kb_entries.sql`), read through the reviewed-only helpers in `server/spine/knowledge-base.ts`. Ben's page is `/admin/knowledge`; not wired into `server/spine/`'s reply path. The comms-v2 Service specialist (`server/comms-v2/service/`) reads it through those same helpers.
- **A JS array in a `sql` template is not an array parameter.** Drizzle expands it in place into `($1, $2)`, a record, so a following `::text[]` fails at runtime; bind it with `sql.param(ids)` (worked examples and tests: `server/spine/price-queue.ts`, `server/quote-extras-queries.ts`). A warn-only catch around such a query hides it completely — the extras pick count sat at zero unnoticed — so do not swallow a failed write to make it non-blocking; log it at error level at the call site instead.
- **Production's disk is wiped on every deploy** (Railway, no volume). A file written under `server/storage/media` survives only if mirrored through `server/media-store.ts` `mirrorMediaToS3` (`chat-media/<file>`), which `/api/media/:file` restores from; the new desk does it at its gateway (`server/comms-v2/desk/media-durability.ts`) and records a failure as `TurnMedia.stored: 'local_only'`.
- **Media descriptions come from Gemini** (`server/spine/tools/describe-video.ts`); model prices live only in `server/agent-cost.ts`. Check `server/spine/vision-health.ts` before debugging an empty one.
- **Build gate:** no new tsc errors or vitest failures against your own start commit; esbuild still bundles. The pre-existing baseline is large; measure it first.
- Two data-protection files must stay true when a data flow changes (`customer-data-processors` skill). Apple Pay's domain association file is served by a route in `server/index.ts`; never remove it (`apple-pay-domain` skill).

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
