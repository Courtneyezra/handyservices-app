# P17: the five capability eval reds that gate autonomy (pane bottom-left)
Worktree: /Users/courtneebonnick/v6-wt-worker (branch p17-eval-reds, from comms-v3)

The go-live checker blocks on regression reds only, so these five never blocked the flip. They DO gate
promotion: no intent may move DRAFT → SEND while the guard chain misses this often (design §9, and the
autonomy ladder reads the eval families). Autonomy is eligible from 17 Sep, so these want fixing before it.
Same rules as every brief: worktree only; no DB, no `app_settings`, no push; zero new tsc errors; server
vitest failing set unchanged (42); client green; esbuild bundles; commit per item; `docs/comms-build/P17-DONE.md`.

Reproduce first: `npx tsx scripts/eval-comms.ts --family absence --adapter triage` and
`--family guards --adapter replay`. Read `eval-results/latest.md` and the JSON beside it.

## 1. `ab-007-in-on-thursday` — triage over-escalates a bare weekday
The customer says "we're in on Thursday", stating availability, not asking about a date. `RE_DATE`
(`server/spine/triage.ts`) fires, adds the `date_question` exception and lanes Ben. The case's own note
says this is a triage improvement target.
**Fix:** a bare weekday or date with no question and no request is availability, not a date question.
It must still fire on "can you come Thursday?", "what day are you coming?", "is Thursday ok?", and on any
message that pairs a day with a question mark or an asking verb. Availability statements ("we're in on
Thursday", "I'm around Tuesday", "we're away next week") do not escalate — but if the thread is at a stage
where a date matters the message still reaches the right lane, it simply carries no `date_question`.
Test both directions with the real strings, and keep every other `date_question` eval green.

## 2–5. Four incident-corpus sends the guards should have held
`guards-incident-{163c5f9b30, 26b662f923, 8ac0c27f6b, e0ee83c869}` — all four fail `must-flag`:
"nothing put Ben in the loop: no flag, no escalating guard, no lexicon exception". Read each case's
context and candidate body in `eval-cases/guards/incident-v2-unguarded.json`. They come from the 31 Aug
incident corpus, so each one is a real message the old pipeline sent unguarded. Look at what the four have
in common before writing anything: from a first read they are replies that COMMIT us to something soft —
a time Craig will confirm, attaching a shed to a customer's concrete floor, fitting a kit to a window
"like we chatted" — without a price or a date literal, which is why the money and date guards miss them.
**Fix:** whatever the shared shape is, name it and guard it. The measure in the scoreboard is the
"Guard chain on the incident corpus" block: text-guard false-negative 90.9 % alone, 36.4 % with the
lexicon pre-checks. Move both down. Do NOT fix it by widening a guard until ordinary replies trip it:
after the change, run the FULL suite and show that no previously-green case turned red — that is the
gate, not the four cases alone.

## Report
`P17-DONE.md` must include the before/after of the guard-chain block from `eval-results/latest.md`
(counts and both false-negative rates) and the full-suite green/red totals before and after.
