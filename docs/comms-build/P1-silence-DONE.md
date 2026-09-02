# PHASE 1 / B — due times, holding line, silence-breaker — DONE

Worktree `/Users/courtneebonnick/v6-wt-worker`, branch `p1-silence`, based on `c89b25e` (comms-v3 with all Phase 0 work).
Not pushed, not merged, not rebased. No dev server run, no DB queried; `app_settings` untouched.

## Migrations to apply (exact filenames)

- `migrations/20260902_due_at_holding_line.sql` — idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`):
  `message_drafts.due_at timestamptz`, `message_drafts.held_reason text`, `agent_questions.due_at timestamptz`, `agent_questions.expired_at timestamptz`, plus two partial indexes the 15 s sweeps poll on.
  Matching Drizzle change in `shared/schema.ts` (both tables). Apply BEFORE deploying this branch: `queueDraft`, `askBen` and `flagThreadForBen` now write `due_at` on every insert.

## Files changed

New
- `server/working-hours.ts` — THE working-hours implementation. Two named clocks on one engine: `OFFICE_HOURS` (Mon–Fri 08–18 Europe/London: the `due_at` clock) and `BEN_HOURS` (daily 08–20: every existing Ben-alert / proactive-send / promise-timer boundary, semantics unchanged). `ukParts`, `ukHour`, `ukHourNow`, `isOutOfHours`, `isWithinClock`, `nextWorkingSlot`, `addWorkingMinutes`, `addWorkingHours`, `workingHoursBetween` (memoised hour-bucket walk), `dueAtFor('draft'|'flag'|'flag_urgent')`, `formatUk`. Pure; every function takes `now`.
- `server/rules-layer.ts` — `sendHoldingLine(conversationId, 'silence'|'flag_expiry'|'draft_expiry', runId)`, `sendAsk(conversationId, 'ask_media'|'ask_postcode', runId)`. Fixed copy in Handy voice ("we", no em dashes, no prices/dates/names/"I"; guarded by `chatVoiceViolations` at module load AND in tests). Delivery reuses the first-contact ladder pieces (`canSendFreeform` → `findApprovedTemplateWithValues` by NAME → SMS via `isSmsSenderConfigured` → else pending draft for Ben) and goes `queueDraft` → `approveAndSendDraft(draftId, 'rules.holding' | 'rules.ask', runId)` → `sendCustomerMessage`, so opt-out, near-duplicate hold, ledger row and WhatsApp→SMS fallback are the ones a human approval gets. Suppression is one pure function `suppressReason()`: any outbound after the triggering inbound, opt-out (any scope), a rules-layer send in the last 2 h, test number, archived.
- `server/agents/silence-breaker.ts` — the worker sweeps (fast tick, once a minute, 24/7): `sweepSilence` (inbound ≥ 10 min, no outbound since → holding line; claim = atomic stamp `metadata.silenceBreakerAt` re-checked under the row lock, one per inbound burst), `expireFlags` (past `due_at`, unanswered, no human reply since → `expired_at` claim, holding line, Ben re-pinged ONCE via `notifyEscalation`), `expireDrafts` (pending past `due_at` → `held_reason='due_expired'` claim, holding line; draft stays pending), `sendMorningDigest` + `digestCounts` + `formatDigest`. Pure decision functions `isSilentBurst`, `isExpiredFlag`, `isExpiredDraft` are what the tests attack.
- Tests: `server/working-hours.test.ts` (35), `server/rules-layer.test.ts` (18), `server/agents/silence-breaker.test.ts` (14).

Modified
- `server/approver.ts` — `'rules.holding'`, `'rules.ask'` added to the Approver union.
- `server/message-drafts.ts` — `DraftSource` gains `'rules_layer'` (service purpose); `queueDraft` takes optional `dueAt` and writes `due_at = dueAtFor('draft')` (4 office hours) on every draft.
- `server/agent-questions.ts` — `askBen` takes `dueAt` / `urgent`, writes `due_at` (4 office hours; 20 office minutes when urgent).
- `server/agents/comms.ts` — `flagThreadForBen` writes `due_at` (20 min if the thread is priority `urgent` or tagged `callback_requested`, else 4 office hours). Inline UK-hour + date-format computations replaced with `ukHourNow()` / `formatUk()`.
- `server/agents/comms-sweep.ts` — both inline UK-hour computations replaced (`isOutOfHours`, `ukHourNow`); silence-breaker tick wired into the (worker-gated) fast tick.
- `server/agents/sla-sweep.ts`, `server/agents/va-call-tasks.ts` — local `ukHourOf` copies deleted, import `ukHour` from working-hours; sla-sweep's `isOutOfHours` import moved to working-hours; date formatting via `formatUk`.
- `server/first-contact-ack.ts` — `ukHourNow` / `isOutOfHours` now imported from working-hours and re-exported under the same names (its importers unchanged).
- `server/agents/promise-tracker.ts` — `addWorkingHours` delegates to working-hours on `BEN_HOURS` (same daily 08–20 arithmetic; kept under its name for desk-routes, sla-sweep, va-call-tasks). Local copy + `ukHourMinute` deleted.
- `server/comms-sla.ts` — `WORKING = OFFICE_HOURS`; `workingHoursBetween` delegates to working-hours. Its private `londonParts` + memo deleted (this also removed 4 pre-existing tsc errors in that file).
- `server/cron.ts` — 09:00 Europe/London digest, wrapped in `gateCustomerLoop` like the other customer-facing schedules.
- `server/pushover.ts` — `notifyCommsDigest({ title, lines })` on the existing `escalation` event (no new event key; same audience, same action).
- `server/__tests__/architecture.test.ts` — `server/rules-layer.ts` added to the allowed / expected `approveAndSendDraft` importers (it is a deliberate new caller).
- `shared/schema.ts` — the four columns above.

## How I verified

- **tsc gate** (`NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json`, private `--tsBuildInfoFile`, one shell at a time), baseline run in a throwaway worktree at `c89b25e`, error lines compared with `(line,col)` stripped:
  baseline 1,887 errors → after 1,883. **Zero new errors.** Four gone (the `comms-sla.ts` ones deleted with its private clock). The apparent "new/gone" pairs for `../v6-switchboard/server/agents/runner.ts` and `shared/schema.ts` are the same errors rendered with a different relative-path prefix from the two worktree locations.
- **vitest** (`DATABASE_URL=postgres://u:p@127.0.0.1:1/x npx vitest run`): baseline 42 failed / 512 passed / 8 skipped (23 files) → after **42 failed / 579 passed / 8 skipped (26 files)**. The 42 are the same 42 (eve-pricing-engine 37, segment-classifier 4, contractor-pay 1). 67 new tests, all green.
- `PHASE0_MERGED=1` architecture suite: the rules-layer importer assertions pass. One test in it ("Twilio Messages API is used only by sms.ts and meta-whatsapp.ts") fails **identically at the baseline commit** — pre-existing, not touched.
- Working-hours bank covers: Fri 17:30 + 4 h → Mon 11:30; Fri 18:30 → Mon 12:00; Sat/Sun → Mon 12:00; Tue 22:00 → Wed 12:00; landing exactly on close rolls to next opening; > 1 day over a weekend; 20-minute urgent clock (Fri 17:55 → Mon 08:15); GMT and BST; both DST changes of 2026; BEN clock keeps promise-tracker's 18:30 → 10:30 and 22:30 + 15 min → 08:15.
- NOT verified: a real boot, a real DB write, a real send, template resolution against the live `whatsapp_templates` cache. The brief forbids all of those from this pane.

## Not done, and why

- **`ask_media` / `ask_postcode` are implemented (`sendAsk`) but no caller is wired.** The Phase 1 row says "ack/ask_media/ask_postcode moved into the rules layer"; the first-contact ack keeps its own media sentence (folded into the ack burst), and moving the agent's `ask_gap` postcode/media asks onto `sendAsk` means changing the comms agent's tool belt, which pane A / the Scoper work owns. The function, copy, template preference (`postcode_request`, `video_request` / `job_video_request`) and approver are in place for the next pane to call.
- **No `holding_line` Meta template exists yet.** `HOLDING_TEMPLATE_PREFERENCE` names it; until it is approved the shut-window ladder falls to SMS (present in prod), so nobody is silent. Submit "Hi {{1}}, thanks for your message. We have got it and will come back to you shortly." as a UTILITY template named `holding_line` (one template per purpose; see docs/WHATSAPP-TEMPLATES.md).
- **Ledger events go through `logSystemEvent`** (kinds `send`, `hold`, `escalation`, `sweep`, each with `runId` and an `event` name in `detail`): `server/ledger.ts` does not exist in this worktree; `comms-ledger.ts` is the sync-from-source, not write-at-source. Pane A's ledger can backfill from `system_events.detail.event ∈ {silence_break, flag_expired, draft_due_expired}`.
- **sla-sweep's `needs_ben` lane still pings on its own SLA.** Flag expiry now re-pings once at `due_at`; a stale flag can therefore produce two pings (one per mechanism) until Phase 5 deletes sla-sweep. Left alone on purpose: the brief said replace the hour arithmetic there, not its behaviour.
- Existing drafts/flags have `due_at NULL` after the migration; the sweeps only act on rows with a due time, so the backlog does not all expire at once on deploy.

## Decisions the design left open

- **Which clock is which.** `due_at` uses Mon–Fri 08–18 (the brief). Every pre-existing 08–20 daily check (morning release, callback fallback, promise timers, VA call tasks, SLA sweep deferral, `isOutOfHours`) stays on 08–20 daily as `BEN_HOURS`. Changing those silently would have moved real alerts.
- **Urgent = priority `urgent` OR tag `callback_requested`** at flag time (brief said "callback_requested/urgent").
- **A flag is "unanswered"** = status `open`/`flagged`, `answered_at` null, `expired_at` null, and no human outbound since the flag (an outbound whose text is not one of our sent drafts). If Ben replied, the row gets `expired_at` set quietly so it is never rescanned, but no holding line and no ping.
- **Draft expiry never touches rules-layer drafts** and the holding line for it says the reply is "being checked", not what it says.
- **Silence-breaker scope:** `role_profile = 'customer'`, not archived, stage not closed/won, inbound between 10 min and 48 h old, test numbers skipped; 5 sends per pass; claim BEFORE send. A customer who writes again after the stamp is a new burst (stamp < lastCustomerContactAt).
- **Silence-breaker fires even if a pending draft exists** for the thread. Ten minutes of silence is silence; the draft's own `due_at` clock runs separately. The 2 h suppression and the near-duplicate hold stop it repeating.
- **"Bursts that got only a holding line yesterday"** = threads with a sent `[silence]` rules-layer draft yesterday (UK day) and no other outbound after it before midnight.
- **Digest rides the `escalation` Pushover event** rather than a new key: same recipient, same action, and the Notifications page needs no change.
- **`workingHoursBetween` now walks absolute hour buckets** (memoised) instead of `from`-aligned hours; board SLA numbers can differ by up to 0.1 h at boundaries. Rounding is unchanged.
- Voice: the brief says "we" not "I"; brand-voice/whatsapp-comms.md says "you ARE Ben". The rules layer is a template, not a person, so it follows the brief and design §4 (never "I", never names Ben).
