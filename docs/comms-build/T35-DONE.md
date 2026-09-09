# T35 — reply in seconds, in the Scoper's own words

**8 September 2026.** The captain, after sending a WhatsApp from his own number and watching it go
unanswered for a long stretch and then answered by a canned line:

> "we need this comms to be autonomous and stop the templated messages and reply quick"

Three changes, and they only work together. Moving one without the others either leaves the
template speaking first or leaves every reply parked as a draft.

---

## 1. The reply delay

`spine.debounceMinutes` was `10`. Ten minutes is not a burst window, it is a wait — and it landed on
the same minute as the rules layer's ten-minute holding line, so the template usually reached the
customer first.

The field is now **`debounceSeconds`**, default **8** (`server/spine/config.ts`).

It was renamed rather than re-scaled on purpose. The live `app_settings` row carries whatever the
last `setSpineConfig` wrote — `debounceMinutes: 10` — and a stored key beats a code default, so
changing the constant alone would have changed nothing in production. A key the row does not have
takes the code default the moment the deploy lands.

- `DEBOUNCE_SECONDS = { min: 3, max: 120, dflt: 8 }` is the one bound. `min` is the floor
  `requestRun` always applied (`Math.max(3_000, …)`), now said once so the two cannot drift; `max`
  is well short of ten minutes, so no configuration can put the template back in front of the
  Scoper.
- The bound is applied **on read** (`clampDebounceSeconds` in `mergeOverDefaults`), not only on
  write, because the live row was written by a script and can be written by one again.
- The retired `debounceMinutes` key is dropped on read, so it leaves the row at the next
  `setSpineConfig`.
- The arithmetic is one exported pure function, `debounceDelayMs` (`server/spine/request-run.ts`) —
  "how long before the customer hears back" now has exactly one readable answer.

### It is still a debounce

Proven in `server/spine/instant-reply-t35.test.ts` against the real `requestRun` with a stub
database that records the write: two inbound messages **three seconds apart** leave **one** due
time on the row, and it is the second message's. `nextTriageAt` is latest-writer-wins, so a worker
tick at the first message's due time finds nothing due; the single run happens at the second's. One
considered reply to both messages, exactly as the ten-minute version behaved.

### What the captain has to do for this to take effect

**Nothing. Deploy is enough.** The live row has no `debounceSeconds` key, so it reads the code
default of 8 s from the first request after the deploy.

To confirm it on the server:

```bash
npx tsx scripts/_spine-mode.ts --status     # now prints debounceSeconds in the JSON block
```

To change it later there is deliberately **no** admin toggle — `debounceSeconds` is not in
`SPINE_KEYS` (`server/spine/controls.ts`), so `POST /api/spine/config` refuses it, exactly as it
refused `debounceMinutes`. Changing it is a settings write:

```sql
UPDATE app_settings SET value = value || '{"debounceSeconds": 12}'::jsonb, updated_at = now()
WHERE key = 'spine';
```

Anything outside 3–120 is clamped on read rather than honoured.

---

## 2. The templated line

`server/agents/silence-breaker.ts` runs one clock with a lane per reason. The **`silence` lane is
removed from `SILENCE_LANES`**. `flag_expiry` and `draft_expiry` are untouched — those are threads
deliberately held for Ben, a different situation and not what the captain objected to.

`sendHoldingLine`, its copy, `HOLDING_TEMPLATE_PREFERENCE`, the `holding_line` template on the pack
and the `silence` reason in the vocabulary are all unchanged. This retires a **trigger**, not the
mechanism.

**Why a removed row rather than a flag defaulting to off:** the lane is already the unit of this
design — "adding a fourth trigger is a row here, not a fourth clock" — so removing one is removing
a row, and bringing it back (at an interval that is a real net: hours, not minutes) is putting the
row back. The exact row to paste is in the comment above `SILENCE_LANES`. A new settings flag would
have been a second thing to remember, defaulting off forever, with no test in front of it.
`sweepSilence` and `isSilentBurst` stay exported and stay tested, so the behaviour under that row
is still honest if it is ever wanted.

`server/agents/silence-clock.test.ts` now asserts the lane list is `['flag_expiry',
'draft_expiry']` and that no lane carries `silence`, so re-adding it is a deliberate act with a
failing test in front of it.

`SILENCE_AFTER_MINUTES` was **not** set to 0 — that would have fired the template instantly on
every message, the opposite of the ask.

---

## 3. The Scoper's replies send

`server/spine/packs/customer-default.ts` had `defaultTier: 'DRAFT'` and `tierByIntent: {}`, so every
reply parked for Ben. From the customer's phone that is indistinguishable from silence.

Promoted to SEND — exactly the four the pack's own B7a comment already names as PRD v3 §5.1's
send-tier set, which are also exactly `PRECONDITIONED_INTENTS`:

| intent | what still gates it at SEND |
| --- | --- |
| `ask_gap` | no quote on the case file, no date asked, no question mark in the customer's last message |
| `confirm_received` | the last inbound actually brought media or a UK postcode |
| `point_to_quote_page` | a quote exists **and** the body names its slug |
| `point_to_picker` | a live unpaid quote exists **and** the body names its slug |

### Untouched, and asserted untouched in the new test

- **`guardSet`** — all eleven guards, `money` first. A price, a discount, a date, a duration or fee
  terms in the body is an escalating guard hit: the reply becomes a **flag for Ben**, never a send.
- **`neverSend`** — `['holding', 'clarify_scope', 'faq_from_kb', 'closing', 'offer_survey']`.
- **`exceptionsToBen`** — complaints, trust concerns, refunds, out of scope, regulated trade, money
  questions, callbacks. Read *before* any tier is.
- **`defaultTier: 'DRAFT'`** — anything added to this pack later still starts in Ben's queue.
- **`server/spine/send-preconditions.ts`** — not weakened by a line. It is still the last check
  before a send, and it still refuses `not_reactive`, `ours_is_newest`, `empty_body`, the T20/T28
  ask-ledger belts and the per-intent rules above.
- **The earned ladder** (`server/spine/autonomy.ts`) — this is a **starting position**, not a
  bypass. `pack_intent_tiers` still overlays these values, so:
  - an `unsafe` verdict from Ben demotes that intent to DRAFT **immediately and synchronously**
    (`demoteOnUnsafeVerdict`, fired from `recordVerdict`; it is *not* gated on
    `spine.autonomy.enabled`), and
  - the 07:30 job runs in `demote_only` while autonomy is off, so an unsafe sample or an incident
    tag takes a tier away overnight. With no demotion signal it holds at SEND — the absence of
    evidence is not a demotion.
  - Rolling back by hand is four calls: `POST /api/spine/tiers { packId: 'customer.default',
    intent: '<one of the four>', tier: 'DRAFT', reason: '…' }`.

`customer.post_quote` and `customer.exception` are **not** touched: both still have an empty
`tierByIntent`, so every reply on those packs is still a draft for Ben.

---

## The measured wait, before and after

No production database or Railway shell is reachable from this worktree, so the two components
that are decided by code are exact and the model-call time is the range the code and the existing
run records imply. The captain can read the real per-run number from `agent_runs.duration_ms`, or
watch a pass live in `/admin/sandbox`.

| | before | after |
| --- | --- | --- |
| inbound debounce (`nextTriageAt`) | **600 s** | **8 s** |
| worker fast tick granularity | 0–15 s (mean 7.5 s) | 0–15 s (mean 7.5 s) |
| the pass itself (case file + triage + Scoper) | ~5–20 s | ~5–20 s |
| **what the customer receives** | a **canned holding line** at ~10 min (the silence lane, racing the debounce); the Scoper's actual reply **never arrives** — it parks as a draft | **the Scoper's own words**, typically **~20–25 s**, worst case ~43 s |

The "never arrives" row is the important one. Before this change the ten-minute wait was not the
whole complaint: even after it elapsed, `defaultTier: 'DRAFT'` meant nothing the Scoper wrote ever
reached the phone unattended.

---

## Build gate

Measured in this worktree at start commit `804d3e4`.

- `tsc --noEmit -p .` — **1,880 errors before, 1,880 after**, identical per-file counts. Zero new.
- `vitest run` (dummy `DATABASE_URL`) — **42 failing in 3 files before, the same 42 after**. The
  one extra line in the branch run is `call-script/performance.test.ts`'s heap benchmark, which
  passes on an isolated re-run (`NODE_OPTIONS=--expose-gc`); it is the documented flake.
- `esbuild server/index.ts …` bundles (4.4 MB).
- `npm run gate:prompts` — no prompt under `server/spine/prompts/` changed; nothing to check.
- `scripts/eval-comms.ts --adapter replay` and `--adapter triage` — 0 regression red, 0 capability
  red on both.
- New: `server/spine/instant-reply-t35.test.ts` (18 cases) covering all three changes and every
  rail listed above.

---

## What still delays or blocks a reply, and was NOT in scope

Named, not fixed. Each is a separate decision.

1. **The worker fast tick is 15 s** (`TICK_EVERY_MS`, `server/agents/comms-sweep.ts`). It is now
   the *dominant* component of the wait — a 3–15 s debounce sits behind a poll of the same size.
   Dropping it to 5 s would take the typical reply to ~10–15 s, but that tick also carries the
   heartbeat, the morning release, held acks, the callback fallback and the promise / SLA /
   call-task / silence sweeps, so tripling its rate is a cost and load decision well beyond this
   task.

2. **The VA call-task lane holds triage for up to 15 WORKING minutes** on a first-contact text
   enquiry (`holdTriageForVaCallTask`, `server/agents/va-call-tasks.ts`), by pushing
   `nextTriageAt` out to the task's `dueAt`. This is very likely most of the "long stretch" the
   captain saw, and the debounce change does nothing about it. It is gated by
   `comms_agent.vaCallTask.enabled`, whose **code default is off** — but the live row is what
   decides, and I cannot read it from here. **Check this first on the server**; if it is on, the
   captain has to choose between the speed-to-lead call and a fast text reply, because today they
   are mutually exclusive.

3. **`ask_gap` refuses to send when the customer's last message contains a `?`**
   (`ask_gap:customer_question`, `send-preconditions.ts`). A customer who asks a question — a very
   common opener — still gets a draft for Ben, not a reply. That rule is doing real work (it stops
   the desk carrying on scoping past a question it did not answer), but it is also the single
   biggest remaining reason a promoted `ask_gap` will not fire.

4. **The first-contact ack can make our turn the newest one.** The ack is sent instantly, before
   the debounce (`ackFirstContact`, `server/agents/comms-lanes.ts`), while the Scoper's pass runs
   8 s later. If nothing else has landed, `ours_is_newest` then refuses the send and the reply
   parks as a draft. Practically: the promotion bites from the customer's **second** message
   onward on a first-contact thread. The ack was explicitly out of scope, so this is untouched.

5. **`customer.post_quote` is still all-DRAFT.** Once a quote is sent and unpaid,
   `resolveStaticPack` moves the thread to that pack, so `point_to_quote_page` and
   `point_to_picker` at SEND on `customer.default` will fire only on the narrow window where a
   quote exists but the thread has not been laned post-quote. Most of the value of this change is
   `ask_gap` and `confirm_received` on pre-quote threads.

6. **This does not sit behind `spine.desk`.** Item 0.5 built `v3` / `v4` as the switch for
   reply-by-default, and `isDeskV4` is still consulted by nothing. The four promotions take effect
   on deploy under `desk: 'v3'`. Rolling back is the four `POST /api/spine/tiers` calls above or a
   revert of this PR — a desk flip will not undo it.

7. **The between-runs floor is still 5 minutes** (`TRIAGE_TURN_MINUTES`, `claimTriageTurn`). One
   thread cannot have two passes inside five minutes, whatever the debounce says. A customer who
   writes again 30 s after a reply waits for that floor. Untouched, and correct as a triple-send
   guard, but it is a second clock on the same thread.
