# Cutting over to the new desk, and rolling back

The new desk (`server/comms-v2/`) takes over from the old one on switches, never on a deploy
(behaviour.md answer 37): the addresses registered with Twilio, Meta and the web form stay, their
handlers already forward to the new gateway, and nothing is re-registered with a provider. The old
desk stays in the code as the roll-back for the first weeks, then is deleted.

Every step below is a switch or a query. Nothing here is flipped by a build, a test or the pipeline.

## The switches

The new desk is the live desk only while `commsV2Live()` (`server/comms-v2/switch.ts`) says so, and
it says so only with all of these on:

| Switch | Where | Default |
|---|---|---|
| intake | `COMMS_V2_INTAKE=1`, a Railway variable | off |
| delivery | `spine.senders.comms_v2.enabled = true`, the `spine` app_settings row | off |
| desk | `spine.commsDesk = 'comms_v2'`, the same row, owner-only, needs `confirm: 'LIVE'` | `spine` |
| the process | `COMMS_WORKER=1`: the desk's clock runs only in the worker, and production is one service that is both | — |

While it is live, at the same moment and on the same read:

- the intake's desk delivers (`INTAKE_DESK_MODE`, `server/comms-v2/channels/intake.ts`) and its
  store and tools use the production database (`server/comms-v2/live-database.ts`);
- the old desk stands down (`server/comms-v2/old-desk.ts`): every automatic customer sender of the
  old desk is refused at the one exit, `server/outbound.ts`, with a `send_refused` system event
  (`OLD_DESK_STOOD_DOWN`); the spine reads as off; the legacy comms agent reads as disabled. The list
  is `OLD_DESK_SENDERS`: the legacy agent and its autosend, the spine's lane agents, the SLA chase,
  the rules layer's replies, the webform chase and the lead automations. Transactional sends, the
  job-pack asks after a deposit, invoices, the price screen and every person's own send carry on;
- the live clock runs every minute (`server/comms-v2/channels/live-clock.ts`): Ben's chase, the
  owner's escalation and the unpriced draft's chase;
- Ben's board reads the live case files;
- Ben's quote notifications (ready to price, chase, accepted) reach his phone through Pushover
  (`quoting/ben-notifier.ts` `liveBenNotifier`), asked at every notice rather than latched once.

With any one of them off, none of that happens, and the old desk answers exactly as it does today.
A switch read that fails counts as off: the old desk answers, and the new desk's delivery refuses on
the same read, so exactly one desk speaks.

## Before the flip

Each of these is checked by hand; none is enforced by the code except where it says so.

- [ ] `migrations/20260913_comms_v2_case_files.sql` applied to production
      (`npx tsx scripts/_apply-migration.ts migrations/20260913_comms_v2_case_files.sql`).
- [ ] `INTERNAL_PHONE_NUMBERS` set on Railway (Ben's handset and any staff number the database does
      not hold), so no number of ours opens a case file.
- [ ] `COMMS_V2_CHASE_BEN_E164` and `COMMS_V2_CHASE_OWNER_E164` set on Railway. A number that is not
      set is a refusal recorded on the file on the first due chase, never a silent skip.
- [ ] The `comms_v2_approvers` app_settings row lists Ben's user id under `ben`
      (`server/comms-v2/api/approvers.ts` has the insert). With no row nobody can release or answer
      from the board.
- [ ] **The two chase templates are submitted to Meta and approved:** `desk_approver_chase_v1` and
      `desk_owner_escalation_v1` (`server/comms-v2/service/chase.ts`). Until then every live chase and
      escalation is refused and recorded on the file, and Ben is not chased. Known go-live item: not
      yet submitted.
- [ ] Ben's four fixed lines are reviewed rows in the knowledge base (`/admin/knowledge`). Live, a
      default line he has not reviewed is refused by the sender and the thread holds for him.
- [ ] Production runs one service with `COMMS_WORKER=1` (docs/RUNBOOK.md). A process without it is
      never the live desk and logs so.
- [ ] Pushover is set for Ben's quote notifications: `PUSHOVER_APP_TOKEN` on Railway, and Ben's
      recipient enabled for the "To price", "Chase" and "Accepted" events on /admin/notifications. The
      live desk sends them under those keys; a skipped push is recorded on the case file, never retried.
- [ ] The captain has read ten real threads (behaviour.md answer 18).

Also known before the flip, and landing as their own changes:

- A live email reply is refused: there is no outbound email path that checks the opt-out ledger.

## The flip

1. On Railway set `COMMS_V2_INTAKE=1` and redeploy. With the other switches off the intake builds
   a sandbox gateway, which refuses on the production database and logs why on every forward:
   nothing changes for a customer.
2. Turn the new desk's sender on. Still nothing changes: the desk switch is off.
   ```sql
   UPDATE app_settings SET value = jsonb_set(value, '{senders,comms_v2}', '{"enabled": true}'::jsonb, true), updated_at = now() WHERE key = 'spine';
   ```
3. The flip itself, as the owner on `POST /api/spine/config` (logged as a `config_change`):
   ```json
   { "commsDesk": "comms_v2", "confirm": "LIVE" }
   ```
   or, if the route cannot be reached:
   ```sql
   UPDATE app_settings SET value = value || '{"commsDesk": "comms_v2"}'::jsonb, updated_at = now() WHERE key = 'spine';
   ```

Check it took: `npx tsx scripts/_spine-mode.ts --status` prints `comms desk: comms_v2`; the next
forward logs `[comms-v2 intake] gateway built for the live desk (live delivery)`; an old automatic
send shows as a `send_refused` event with `oldDeskStoodDown`; `/admin/comms-v2` shows live threads.

## Roll-back

One switch, any time, felt on the very next read (the spine row is read on every call, never cached):

```sql
UPDATE app_settings SET value = value || '{"commsDesk": "spine"}'::jsonb, updated_at = now() WHERE key = 'spine';
```

or `{ "commsDesk": "spine" }` on `POST /api/spine/config` (no confirm word). Turning
`senders.comms_v2` off, or unsetting `COMMS_V2_INTAKE`, rolls back just the same; the desk switch is
the smallest act because it needs no redeploy.

What happens:

- The old desk's senders are no longer refused, the spine reads its own mode again and the legacy
  agent its own config: nothing was written to either row, so they are exactly as they were.
- The next forward builds a sandbox gateway, which refuses on the production database, so the new
  desk answers no one. The live clock's ticks do nothing. Ben's board shows the sandbox again.
- The case files stay in `comms_v2_case_files`, holds and chase records included; nothing is
  deleted. Flipped back on, the new desk carries on from them. A write that was still pending when
  the switch went off keeps retrying and lands if the switches come back.
- The old desk has no record of what the new desk said: the new desk's sends are not written to the
  old `messages` table. A customer mid-thread is answered by the old desk from its own history, so
  read the case file on the board (or the table) before answering anyone the new desk was talking to.
- Pending drafts in the old desk's queue from before the flip are still there; nothing was sent or
  cancelled by either flip.

## Known limitations

- The chase record is kept on the case file, so a restart never chases again; the chase intervals
  are the defaults in `server/comms-v2/service/chase.ts` (30 and 60 minutes).
- A clock pass and a customer's turn can reach the same case file in the same moment; each puts the
  whole file when it is done.
