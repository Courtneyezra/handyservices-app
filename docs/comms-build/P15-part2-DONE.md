# P15 part 2 — message the customer through the app (DONE)

Brief: `docs/comms-build/BRIEF-P15-contractor-loop.md` part 2. Pane: top-right, worktree
`/Users/courtneebonnick/v6-wt-exit`, branch `p15-contractor-loop`. Worktree only, no database, no
`app_settings`, no push. Parts 3 and 4 belong to the other two panes.

## The decision this encodes

At the door a contractor needs three things and rings the office for all of them: he has arrived, he
is running late, or he cannot work out which door and where to park. The alternative he reaches for
is worse than the phone call: a text from his own mobile that the business never sees and the
customer keeps forever.

This carries his words on the business number instead. He never sees hers, she never sees his, Ben
reads the exchange on the thread as usual, and the two things a contractor may not decide (a price,
a date) are held and handed to Ben rather than refused at him.

## Built

### The contractor's side

`client/src/components/contractor/MessageCustomerPanel.tsx` (new file, one-line mount in
`MyWeekPage.tsx` next to the job pack, accepted and uncompleted jobs only, hidden in the owner's
read-only preview). Three preset taps, a free-text box capped at 480 characters, a "running late by
N minutes" box, and the exchange underneath. The placeholder says the rule out loud: "No prices and
no dates, those go through the office."

The presets are fixed wording, not prompts: a contractor tapping "I've arrived" cannot reword it
into a promise. `running_late` clamps to 5–120 minutes at send time (the box stays typeable and
clamps on blur, rather than fighting every keystroke).

### The route

`server/contractor-relay-routes.ts` (new file) mounted with ONE line in `server/index.ts`, on the
same base path as the contractor app and immediately before it, so these two paths are served here
and every other `/api/contractor-app/*` path falls through to the other pane's router untouched:

```
POST /api/contractor-app/:token/jobs/:bookingId/message    his words → her thread
GET  /api/contractor-app/:token/jobs/:bookingId/messages   the exchange + what is left today
```

Same trust model as the rest of the app: the token IS the credential, the job must be his, and it
must be accepted (an unaccepted job has no customer to talk to) and not completed.

### The rules

`server/contractor-relay.ts` (new file), pure at the top and the store at the bottom:

| Rule | Behaviour |
|---|---|
| his name | the body is prefixed "Craig here, …" so an unknown number is a person. "I" and "I'm" keep their capital; he is not introduced twice if he already said his name |
| the voice | a dash between clauses becomes a full stop and a new sentence, which is the brief's own example: "I'm outside — which door?" leaves as "Craig here, I'm outside. Which door?" A banned closer is his to reword |
| money | HOLDS. Queued for Ben with the reason, and the contractor is told "it has gone to Ben, who will pick it up" |
| dates | HOLDS, same way. Dates are booked by the office |
| rate limit | 5 per job per day, checked BEFORE anything is composed. The sixth is "give the office a ring" |
| the exit | `sendCustomerMessage` with approver `contractor:<id>`, a run id and `purpose: 'service_reply'`. No new send path exists |

A hold is a success from his point of view and the UI says so in amber, not red: his words reached
the business, which is the point. Only a refusal (rate limit, empty, over-long, send failure) reads
as an error.

### Her reply, back to him

- The send tags the thread `contractor_relay_open`.
- `triageRules` gains one lane, `contractor_relay`: a customer message on a tagged thread belongs to
  the contractor who asked, not to an agent. No agent is registered for the lane
  (`agentForLane` returns null), so `decide` reaches "no proposal" and nothing is auto-answered.
- The lane sits AFTER the exception checks on purpose: a reply that also asks about money or a date
  still goes to Ben. He still gets the notice, because the notice fires off the RELAY TAG in the
  `triage()` wrapper, not off the final lane.
- The notice is a `job_pack_changed`-shaped line carrying her first name, her words trimmed to 160
  characters and HIS OWN portal link, run through P13's `guardContractorBody`. A reply carrying a
  phone number, a full postcode, a street, money or her surname is DROPPED rather than sanitised: he
  opens the app, where the thread is already on his screen.

### The approver

`contractor:<id>` is a new class in `server/approver.ts`, additive alongside `human:` and the
automated enum. He is a person, so `isAutomatedApprover` is false for him and the near-duplicate and
malformed-reason holds (which exist to catch code) do not apply. He is not staff either, so his
sends are greppable as their own class. `isApprover` accepts it, so the exit's Rule -1 lets it
through; `approverLabel` renders "contractor hp_aa212".

## Tests

| File | What it proves |
|---|---|
| `server/contractor-relay.test.ts` (new, 19) | preset wording and the minutes clamp; the name prefix, the dash-to-full-stop rule, no double introduction; money and dates HOLD with Ben's draft and the reason; an ordinary message sends with `contractor:<id>`, a `relay_` run id and the thread marked mid-relay; the sixth message is refused before composing; a failed send does not mark the thread; the reply notice carries his link and never her number; a reply with a phone number is dropped; no active job or no phone is a quiet no-op; the drawer view exposes only id, at, direction and body |
| `server/spine/triage.test.ts` (+4) | a reply on a tagged thread lanes `contractor_relay`; an exception still wins (money → Ben); no tag or no inbound and the lane never fires; no agent runs the lane |
| `client/src/components/contractor/__tests__/MessageCustomerPanel.test.tsx` (new, 9) | hidden until accepted; the three presets post their id and running late carries the minutes; free text posts his words and clears; a held message reads as "with the office" not an error; a refusal shows the server's words; none left disables everything and says why; no customer number anywhere in the panel's text |

## Verification

- `npx tsc --noEmit`: 1,869 baseline → **1,869**, zero errors in any touched file (eight were
  introduced and fixed before the commit: `users.name` is `firstName`/`lastName`, `systemEvents.at`
  is not `createdAt`, and the job gate needed an explicit union type).
- vitest: **42 pre-existing failures, identical set, three consecutive runs** (eve-pricing-engine 37,
  segment-classifier 4, contractor-pay 1); +28 new tests pass.
- esbuild: `server/index.ts` bundles (4.30 MB).
- Not run: anything against a database, and no message was sent anywhere.

## Notes for the merge

- New files only, plus one mount line in `server/index.ts`, one import and one JSX line in
  `MyWeekPage.tsx`. `server/contractor-app-routes.ts` is NOT touched, so part 4's completion work in
  that file cannot collide.
- Additive shared changes: `Approver` gains `contractor:<id>`; `Lane` and `LANES` gain
  `contractor_relay`; `TriageDeps` gains `notifyRelay` / `relayDeps` (both default to live
  behaviour, both switched off in tests).
- `server/spine/triage.ts` imports `RELAY_TAG` from `server/contractor-relay.ts`. That is the only
  spine → app-module import this part adds, and it is a constant, so it carries no runtime weight.
- Left for the orchestrator: nothing here is behind a flag. If the relay should ship dark, the
  cheapest kill is to stop rendering the panel (one line in `MyWeekPage.tsx`); the routes refuse
  anything that is not an accepted job anyway.
