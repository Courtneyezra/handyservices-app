# Phase 0 ops checklist — "Close the doors" (comms worker gate)

Companion to the code in `server/worker-gate.ts`, `server/comms-worker-heartbeat.ts` and the
gated loops in `server/agents/comms-sweep.ts`, `server/cron.ts`, `server/index.ts`.
Design: `docs/COMMS_AGENTS_V3_DESIGN.md` §1.2, §3.1, §3.9, §10 (Phase 0 row).

What the code now does, so the checklist makes sense:

- Every loop that can reach a customer (comms fast tick + slow sweep, the three comms-agent
  cron lanes, day-before reminders, lead automations) registers **only** when the process has
  `COMMS_WORKER=1`. Any other process logs one `[WorkerGate] SKIPPED "<loop>"` line per loop
  at boot and registers nothing. Read-only pulls (template poll, won auto-archive, SEO/GMB/GSC)
  are untouched.
- A production boot **without** the flag logs an error and pages Pushover
  (`COMMS_WORKER flag absent on production: no sweeps will run`).
- A non-production boot whose `DATABASE_URL` contains the production Neon host
  (`ep-broad-king`) prints a loud warning banner.
- The worker stamps `app_settings.comms_worker_heartbeat` every 60 s. `GET /api/health/comms-worker`
  returns `{ ok, ageSeconds, stale }` (200 fresh, 503 stale > 10 min). The worker pages once an
  hour in UK daytime (08–20) if its own heartbeat goes stale.
- The V2 pipeline branch in the sweep is deleted; the sweep always runs `runCommsAgent`.

Do these in order. Tick each one.

## 1. Railway — make production the one and only worker

- [ ] Railway → project → service **handyservices-app** → Variables → add `COMMS_WORKER` = `1`.
- [ ] Confirm `NODE_ENV=production` is set on the same service (the boot alarm keys off it).
- [ ] Confirm `PUSHOVER_APP_TOKEN` is set on the service (the alarm cannot fire without it) and
      that the new **Worker** event is enabled on /admin/notifications (it defaults on, and old
      saved configs get it back-filled).
- [ ] Redeploy (the variable change triggers one; otherwise Deploy → Redeploy).

## 2. Neon — give local dev its own database

- [ ] Neon console → project → Branches → **Create branch** from `main` (name it e.g. `dev-<yourname>`).
      Choose "data + schema" if you want realistic rows locally; the branch is copy-on-write,
      so nothing you do there touches production.
- [ ] Copy the branch's connection string (the host will be `ep-<something>` that is **not**
      `ep-broad-king`).
- [ ] In `/Users/courtneebonnick/v6-switchboard/.env` (and any `.env.local`, and the `.env` in every
      worktree under `~/v6-switchboard*` and `~/v6-switchboard/.claude/worktrees/*` that has one)
      set `DATABASE_URL` to the branch string.
- [ ] Sanity check before booting anything:
      `grep -l 'ep-broad-king' ~/v6-switchboard/.env ~/v6-switchboard*/.env ~/v6-switchboard/.claude/worktrees/*/.env 2>/dev/null`
      must print nothing.
- [ ] Do **not** set `COMMS_WORKER=1` in any local `.env`.

## 3. Local .env — remove the send secrets

A local process must be physically unable to send, even if a flag is wrong.

- [ ] Remove `TWILIO_AUTH_TOKEN` from every local `.env` / `.env.local` (main checkout and worktrees).
- [ ] Remove `WHATSAPP_ACCESS_TOKEN` from the same files.
- [ ] Sanity check: `grep -l 'TWILIO_AUTH_TOKEN\|WHATSAPP_ACCESS_TOKEN' ~/v6-switchboard/.env ~/v6-switchboard*/.env ~/v6-switchboard/.claude/worktrees/*/.env 2>/dev/null`
      must print nothing.
- [ ] If a local script genuinely needs to send (rare), pass the secret on the command line for
      that one run rather than putting it back in a file.

## 4. The Mac — kill the six stray dev servers

These are the processes that sent the 24 unguarded replies. They will keep running old code
(pre-gate) until they are killed.

- [ ] List them: `ps aux | grep 'tsx watch' | grep -v grep`
- [ ] Kill them: `pkill -f 'tsx watch'` then re-run the list command; it must be empty.
- [ ] Also check nothing else is holding the dev port: `lsof -i :5001 -sTCP:LISTEN`
- [ ] Close the terminal panes / cmux workspaces that were running them so they are not restarted
      by a stale shell history.

## 5. Verify after the Railway deploy

- [ ] Railway logs on boot show `[WorkerGate] comms worker (production): customer-facing loops run here`
      and `[CommsSweep] Started: fast tick every 15s ...` — and **no** `[WorkerGate] SKIPPED` lines.
- [ ] Within two minutes: `curl -s https://www.handyservices.app/api/health/comms-worker`
      returns HTTP 200 with `"ok":true`, `"stale":false`, a small `ageSeconds`, and `thisProcess.role` = `worker`.
- [ ] /admin/staff → comms card shows the chip `WORKER ALIVE · <host> · <n>s ago`.
- [ ] Boot a local dev server (on the Neon branch, no send secrets) and confirm its log shows
      `[WorkerGate] SKIPPED "..."` for every customer-facing loop and `[CommsSweep] NOT started`.
      Its `/api/health/comms-worker` still reports the production worker's heartbeat (it reads the
      shared row only if you pointed it at production — on a branch it will say never seen, which is correct).
- [ ] Optional: temporarily remove `COMMS_WORKER` on Railway, redeploy, and confirm the Pushover
      `COMMS_WORKER flag absent on production` alarm arrives. Put it back.
- [ ] Add an uptime monitor (Railway healthcheck or external) on `/api/health/comms-worker`
      expecting 200.

## Rollback

Unset `COMMS_WORKER` on Railway and redeploy: production goes passive (nothing sweeps, nothing
sends on a timer, Ben works the queue by hand) and pages you at boot to say so. That is the
fail-closed state by design.
