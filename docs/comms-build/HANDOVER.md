# Comms desk handover — for Courtnee (owner) and Ben (operator)

Written 3 Sep 2026 at the end of the Phase 0–4 build. Plain English first; the technical detail is
in `docs/COMMS_AGENTS_V3_DESIGN.md` (why and what), `docs/comms-build/CUTOVER.md` (how to switch it
on and off), `docs/RUNBOOK.md` → "Comms desk" (where things live), and the `P*-DONE.md` reports in
this folder (what each build pane did).

## 1. Where we are right now (production, 3 Sep 2026)

- **The spine is in SHADOW mode** since about 00:15 UK on 3 Sep. It reads every customer thread,
  triages it, drafts what it *would* say, and records the run — but nothing it does reaches a
  customer. The legacy comms agent still drafts for Ben exactly as before.
- **Legacy autosend is OFF** (since the 2 Sep hotfix after the 31 Aug incident). Every legacy reply
  queues for Ben's approval. Only the rules layer sends by itself: the first-contact ack, the
  10-minute silence-breaker and the holding line when a draft or flag passes its due time.
- **Railway is the only process that can send.** A laptop pointed at production can serve the admin
  pages but its sweeps and ticks do not register (`COMMS_WORKER=1` lives only on Railway). The
  worker stamps a heartbeat every minute; `/admin/staff` shows it and Pushover fires if it goes stale.

## 2. What shipped, phase by phase

| Phase | In one line | What you see |
|---|---|---|
| 0 Close the doors | No send without a named approver and a run id; only the worker runs loops; tests can never touch production config | `/api/health/comms-worker`; worker chip on `/admin/staff` |
| 1 See everything, never go silent | Every draft, flag and send is on the ledger with a run id; drafts and flags carry a due time; the holding line fires at 10 min of silence and at expiry; Ben's approve/edit/reject is recorded with a reason | Reason chips on `/admin/comms`; "What the agent did" drawer; due-time chips; verdict stats on `/admin/staff` |
| 2 The spine | One pipeline: case file → triage → policy pack → agent → guards → decision → exit. The Scoper (customer replies), the Quote clerk (scope, never price) and Recovery (nudges) run on it. An eval harness grades 240+ real and written cases without a database | `eval-results/latest.md`; spine cards on `/admin/staff` |
| 3 Earn sending | Every Scoper intent starts at DRAFT and can earn SEND from Ben's verdicts plus a passing eval family (fast track for the two simplest intents); a 10% morning sample keeps SEND honest; the voice judge (advisory); the three-way switch off / shadow / live | Ladder table in the Scoper dossier; "Yesterday's sends to check" strip on `/admin/comms` |
| 4 Widen | Videos are described on the case file (Gemini); the in-chat quote card saves a draft quote from the clerk's intake; the contractor liaison drafts job briefs to our tradespeople; the post-call ladder is tested per call type | Quote card in the thread; "audience: contractor" chip; Vision and Liaison cards |

## 3. The switches, and what each one does

All of these are fields on one row: `app_settings` key `spine` (and key `comms_agent` for the
legacy agent). Read them on `/admin/staff` (the strip at the top). Flip the spine with
`npx tsx scripts/_spine-mode.ts --status | --off | --shadow | --live`; every flip is logged.

| Switch | Default | Means |
|---|---|---|
| `spine.enabled` | false | Master. Off = nothing in `server/spine` runs against customers. |
| `spine.shadow` / `spine.mode` | false / derived | **off** = legacy only · **shadow** = spine runs dry and records, legacy still drafts · **live** = spine answers, legacy `runCommsAgent` is never called. `mode` wins when set. |
| `spine.agents.<scoper\|quote_clerk\|recovery>.enabled` | follows master | Per-agent kill switch. |
| `spine.asks.enabled` | false | The rules layer asks for a photo, then a postcode, on a first contact the spine could not answer (one per thread per 24h). |
| `spine.autonomy.enabled` | false | The 07:30 job that promotes an intent DRAFT → SEND on evidence and demotes on any unsafe verdict. |
| `spine.sampler.enabled` (+ rate/min/max) | false / 10% | The 08:30 sample of yesterday's automatic sends for Ben's one-tap review. Needed once anything is at SEND. |
| `spine.video.enabled` (+ images, maxPerRun) | false | Describe the customer's videos on the case file. Costs Gemini calls. |
| `comms_agent.autosend.enabled` | false | Legacy direct send. **Keep OFF.** Turning it on lets the legacy agent send without Ben. |
| `comms_agent.onInbound` | true | Legacy agent drafts on new messages. Turn OFF when the spine goes live so two brains do not draft the same thread. |
| `comms_agent.enabled` | true | Legacy SLA sweep. Stays until Phase 5 deletes it. |

Rollback, any time, one command (`docs/comms-build/CUTOVER.md` §4):
`npx tsx scripts/_spine-mode.ts --off` — or the SQL in CUTOVER §4. Takes effect on the next tick (≤ 15 s).

## 4. Ben's day

1. **The queue** (`/admin/comms`). Drafts sit above the composer with a due-time chip ("due in 2h",
   "overdue"). One tap approves as-is. Edit then approve asks *why* (tone / wrong move / unsafe /
   missing info). Reject asks why. Those chips are the evidence that earns or removes autonomy — tap
   the honest one, not the quick one. **Unsafe** is the important chip: it demotes the intent.
2. **Flags** are the amber note cards with a deadline. Reply in the thread; the flag closes when
   you do. If a flag passes its deadline the customer gets a holding line automatically and you get
   one Pushover — so a slow answer is never silence, but it is still a slow answer.
3. **The morning strip** ("Yesterday's sends to check", top of the customer lane) appears once the
   sampler is on: 1 to 15 sends, fine / not fine, thirty seconds.
4. **Missed calls** get the missed-call text automatically. Answered calls: the transcript reaches
   the clerk (spine live) and a quote intake card appears in the thread when there is enough to price.
5. **What the agent did** — the drawer on any thread shows every run: lane, decision, guards hit,
   the proposal, cost. If a draft looks odd, that is where to look before rejecting.
6. Reply from the **business number only** (that is how the desk sees your replies and closes flags).

## 5. Courtnee's week

- `npx tsx scripts/_shadow-report.ts --days 7` — while in shadow: how often the spine agreed with
  the legacy agent on decision and intent, and the cases where it did not. This is the go-live evidence.
- `npx tsx scripts/_autonomy-report.ts --dry-run` — the ladder: per intent, verdicts / unedited % /
  unsafe / eval family, and what the job would promote or demote. Writes nothing without `--apply`.
- `npx tsx scripts/eval-comms.ts` — the eval scoreboard (`eval-results/latest.md`), no database
  needed. Zero regression red is the bar; the labelled misses stay visible as targets. Run
  `EVAL_LIVE=1 npx tsx scripts/eval-comms.ts --adapter spine` from a machine with the model key to
  make a family count for promotion.
- `/admin/staff` — worker alive, the switch strip, each role's runs / flags / drafts / spend for 7
  days, and the DRAFT → SEND ladder in the Scoper dossier.
- `GET /api/verdicts/stats?days=7` — Ben's verdict rate; below 50% of drafts after 14 days is the
  Phase 1 kill criterion (fix hours/pay before touching the UI).

## 6. Owner actions still open

| Action | How | Why it matters |
|---|---|---|
| Submit the holding-line Meta template | `npx tsx scripts/_submit-holding-template.ts` (prints), then `--submit` | Customers outside the 24h window get the holding line by template; until approval they get SMS or a queued draft |
| Enter the 8 contractor phones | `/admin/contractors` | The contractor lane resolves audience from the phone; empty phones = no contractor threads, no liaison |
| Neon dev branch + strip Twilio secrets from laptops | `docs/comms-build/PHASE0-OPS.md` §2–3 | A laptop `.env` on `ep-broad-king` with Twilio keys is how 31 Aug happened |
| Kill the six stale `tsx watch` processes | `pkill -f "tsx watch"` on the Mac, then check `ps aux \| grep tsx` | They hold the production URL and the keys |
| Agree Ben's hours and whether verdict-tapping is paid | conversation, then set the working clock if it changes (`server/working-hours.ts` OFFICE_HOURS) | Due times and the silence rules assume Mon–Fri 08–18 |
| Bot disclosure decision | before any intent reaches SEND | Design §4: automated messages speak as Handy Services, never "I" |

## 7. Go-live steps and when they become eligible

From `CUTOVER.md` §3, with dates counted from the shadow flip (3 Sep 2026 00:15 UK):

| Step | Eligible from | Condition |
|---|---|---|
| Shadow → live (`--live`, DRAFT everywhere) | **4 Sep** (one working day of shadow; §0b allows sooner) | shadow report shows no error spikes and a sane decision mix; every precondition in CUTOVER §0 ticked, including the holding template approved |
| `asks.enabled: true` | same day as live | the first-contact ack lands first; asks fill the gaps |
| `comms_agent.onInbound: false` | same day as live | one brain per thread |
| `sampler.enabled: true` | as soon as live | it is only useful once sends exist, but harmless before |
| `autonomy.enabled: true` | **≥ 17 Sep** (14 days of verdicts) | verdict rate ≥ 50% of drafts; fast-track intents can then promote after 14 clean days and ≥ 20 verdicts |
| First intent at SEND | **≥ 17 Sep at the earliest** | the job promotes; you get a Pushover |
| Phase 5 delete of the legacy agent | **7 live days** with zero unsafe verdicts | `docs/comms-build/PHASE5-DELETE.md` |

Kill criteria that undo any of this are in CUTOVER §6.
