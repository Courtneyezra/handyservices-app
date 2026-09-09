---
name: spine-prompt-change
description: Use before editing anything under server/spine/prompts/ or eval-cases/ — the repo gates a prompt change on a matching eval-case change, and the change must be run against the model before merge. Also covers reading the eval scoreboard the autonomy promotion gate depends on.
---

# Changing a spine prompt

## The gate

A change under `server/spine/prompts/` must arrive with a change under `eval-cases/`.
This is enforced twice:

- `npm run gate:prompts` (`scripts/check-prompt-gate.ts`) locally.
- The **Prompt gate** pull-request check, `.github/workflows/prompt-gate.yml`.

A prompt edit with no eval-case edit will not merge. Add or amend the fixture that proves
the behaviour you are changing, in the same commit.

## Running the evals

Grading with no model key runs the deterministic adapter only. To exercise the model:

```bash
EVAL_LIVE=1 npx tsx scripts/eval-comms.ts --adapter spine --family <family>
```

Roughly £0.30–£0.60 per family, so run the affected families, not all of them.
`--adapter triage` grades triage and `expected.precondition` cases without a key.

Families are the directories under `eval-cases/`.

## The scoreboard

Results land in the `eval_runs` table (migration `20260908_eval_runs.sql`,
`shared/schema.ts`) as well as `eval-results/latest.json`. The autonomy promotion job
reads the row first, the file second, then reports `missing`. A server with no `eval_runs`
row has no evidence half to its promotion gate, whatever the local file says.

See `docs/RUNBOOK.md` §"Changing a prompt" and §"The eval scoreboard on the server".

## What promotes and demotes

Ben's approve / edit / reject verdicts (`draft_verdicts`) plus the eval families are what
promote an intent from DRAFT to SEND (`server/spine/autonomy.ts`). The 10% sampler and any
`unsafe` verdict demote; `demoteOnUnsafeVerdict` fires synchronously and is not gated on
`spine.autonomy.enabled`.
