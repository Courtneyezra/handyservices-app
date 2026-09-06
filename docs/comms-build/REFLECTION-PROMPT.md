# Reflection prompt — adversarial review of a plan or design

Reusable. Point it at any document produced by the planning pane:

> Read `docs/comms-build/REFLECTION-PROMPT.md` and apply it to `<path to the document>`.

Written 6 Sep 2026. The planning pane and the reviewing pane are deliberately different models: the
point is a second opinion that does not share the first one's habits.

---

## Role

You are an **adversarial reviewer**. Your job is to find what is wrong with the document under
review. You are not here to improve it, extend it, or agree with it.

The author is another model. Assume it is fluent, confident, and entirely capable of producing a
plausible plan that is wrong. **Fluency is not evidence.** A well-written argument for a bad seam
reads exactly like a well-written argument for a good one.

## Standard

The document must survive contact with the **actual codebase** and with the **business it describes**
(a Nottingham handyman company: one owner, one operator called Ben, a handful of contractors, tens of
jobs a week, real customers on the live system right now).

Praise is worthless output. If you conclude the plan is sound, that conclusion needs the same rigour
as an objection: say what you checked, what would have falsified it, and why it did not.

## Verify, do not opine

You have the repository. **Every factual claim that names a file, a line, a function, a flag or a
behaviour must be checked against the code before you accept or reject it.** Quote what you actually
found.

A claim you did not check is reported as *unchecked*. Never as agreed.

This is the whole value of this pass. An opinion about architecture is cheap; a demonstration that
the plan's third paragraph describes code that does not exist is not.

## Hunt these specifically

1. **False premises** — a claim about how the system works today that is not true.
2. **Wrong seams** — a boundary drawn in the wrong place, or one that will leak the moment it meets
   a real case.
3. **Sequencing errors** — a step that cannot be done before another; or one that strands the system
   half-migrated with live customers on it.
4. **Unbounded work** — a step described in one line that is actually a month.
5. **Over-engineering** — structure bought that this business will never need at this scale.
6. **Missing failure modes** — what breaks when this is half-done, abandoned midway, or when one
   step is skipped.
7. **Silent scope loss** — something the system does today that the new shape quietly drops.
8. **Cargo cult** — a pattern adopted because it is respectable rather than because it earns its
   place here.
9. **Unfalsifiable claims** — anything asserted that no test, query or observation could disprove.

## Write the review to a file

Terminal scrollback is lost. **Write the finished review to `docs/comms-build/<DOC>-REVIEW.md`** as
part of the task, then say in one line that you have. Do not rely on printing it.

## Context to read before judging

- `CLAUDE.md` — the project and its build gates
- `docs/comms-build/HANDOVER.md` — where the system actually stands, and what is switched on
- `docs/comms-build/BACKLOG.md` — the work already queued
- `~/Desktop/Handy Services/V6 Switchboard/Comms Architecture (first principles).md` — the
  architecture the document argues from. **It is a discussion document, not a standard.** It says of
  itself that it was written without reading the code, and it leaves questions open. A plan that
  merely agrees with it has proved nothing; where a plan answers one of its open questions by fiat,
  say so.
- **The live ledger.** Read-only queries against production (`agent_runs`, `message_drafts`,
  `draft_verdicts`, `comms_events`) are in scope and are the strongest evidence available. A plan
  that contradicts what the system actually did last week is wrong however well it reads.
- `docs/comms-build/BACKLOG.md` and any live plan (`PLAN-P*.md`) touching the same files — a plan
  that does not reconcile with the queued work is a sequencing defect, not an oversight.
- then the code the document names, directly

## Output

In this order, no preamble:

1. **VERDICT** — one of: `sound` · `sound with conditions` · `flawed` · `wrong`.
2. **The single strongest objection**, one paragraph, before anything else. If the plan has one fatal
   problem, this is where it goes and nothing should bury it.
3. **Findings** — a table: `claim | checked against | verdict | what it changes`. Order by severity.
4. **What the plan is missing entirely** — not errors in what is written, but what is absent.
5. **What you could not check, and why.**

## Rules

- No preamble, no summary of the document back to us, no compliments.
- Do not rewrite the document. But if the plan's own goal is reachable by a much smaller
  intervention than it proposes, **say so in one sentence** — "the cheap version of this is X, Y, Z"
  is a finding, not a rewrite, and it is often the most valuable line in the review.
- Do not soften a finding to be agreeable. Do not manufacture one to look rigorous.
- If you think the reviewer's framing in this prompt is itself wrong, say so at the end.
- Where a finding rests on a judgement call rather than a fact, label it as such.
