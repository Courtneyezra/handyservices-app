# BRIEF T14 — the describer's model is retired; every description has failed silently

Branch `fm/gemini-model-fix-t14`, start commit `0d7bb6c`. Owner's report after T13:
*"Description FAILED on this pass: the Scoper saw this item as bare media with no description.
Error: no description (see describe_video log)"*, and from his server console:

```
[describe_video] msg_sbx_a5e5e03bf5fc4: attempt 1 failed (gemini 404: {
    "message": "This model models/gemini-2.5-flash is no longer available to new users.
                Please update your code to use models/gemini-3.6-flash for the latest features
                and improvements. We recommend you to use the Interactions API.",
[describe_video] msg_sbx_a5e5e03bf5fc4: no description after 2 attempt(s)
```

`spine.video` has been `{enabled: true, images: true, maxPerRun: 6}` in production since 7 Sep and
has never produced a description. This brief is written before any code changes.

## What was established before a line was changed

No Gemini key and no live call from here: everything below is Google's current documentation
(read 7 Sep 2026) plus the code. Where the documentation and the code disagree, the documentation
wins; where the documentation is silent, it is said so in the DONE report.

1. **Which model.** Google's error names `gemini-3.6-flash`. Its model card
   (ai.google.dev/gemini-api/docs/models/gemini-3.6-flash) lists it as a stable model, inputs
   *Text, Image, Video, Audio, PDF*, output text, with *Structured outputs* and *Thinking*, input
   1,048,576 tokens, released 21 Jul 2026. The models index positions it as the Flash that
   "balances speed with multimodal capabilities"; the two newer Flash models (3.7, 13 Aug; 3.8,
   2 Sep) are positioned for coding and agents at the same price. So the defensible pick is the one
   Google told this account to use, which is also the one Google positions for this kind of work.
   The deprecations page shows `gemini-2.5-flash` with "no shutdown date announced": the 404 is a
   *new-user* restriction, not a shutdown, which is why nothing in the docs warned about it and why
   the same string may still work for older accounts. This account is a new user to Google.
2. **Which interface.** Google's Interactions overview says, verbatim: *"While it is now
   considered legacy, the original `generateContent` API remains fully supported."* The
   `generateContent` reference still documents `v1beta/models/{model}:generateContent`,
   `systemInstruction`, `contents[].parts[]` with `inline_data` / `file_data`, and
   `generationConfig.responseMimeType`. The request shape in `describe-video.ts` stays. No move
   to the Interactions API in this task: it is a different resource with a different response
   shape, and the recommendation is for new projects, not a requirement.
3. **Video and images take the same model and the same shape.** The video-understanding guide says
   all Gemini models take video; the 3.6 card lists image and video as inputs; both paths in the
   code build the same `generateContent` body with a different mime type. Inline requests are now
   allowed under 100 MB, so the code's 20 MB inline cap is safely conservative and stays as it is.
   The Files API resumable upload is unchanged.
4. **Usage fields.** `usageMetadata` still carries `promptTokenCount`, `candidatesTokenCount` and
   `totalTokenCount`, and for a thinking model also `thoughtsTokenCount`. The 3.x Flash models
   think by default and cannot have thinking turned off (`minimal` is the floor on 3.6). Google's
   pricing page: *"output price includes thinking tokens"*. The code reads only
   `candidatesTokenCount` as output, so on the new model cost would be under-recorded. Fix: output
   tokens = candidates + thoughts.
5. **Price.** Google's pricing page, paid tier: Gemini 3.6 Flash **$0.75 / M input, $3.75 / M
   output through 31 Dec 2026, then $1.50 / $7.50 from 1 Jan 2027**; context caching $0.075.
   The repo's `agent-cost.ts` carries `$0.10 / $0.40`, marked as "the brief's working
   assumption" and wrong even for 2.5 Flash (which was $0.30 / $2.50). Update to 3.6's figures with
   the January step noted in the comment.
6. **Temperature.** Google's Gemini 3 migration guide: *"For all Gemini 3 models, we strongly
   recommend keeping the temperature parameter at its default value of 1.0"* and, for code that
   explicitly sets a low temperature for deterministic output, *"we recommend removing this
   parameter"* to avoid looping and degraded performance. The code sets `temperature: 0.2`.
   Remove it. The JSON shape is held by `responseMimeType: application/json` and the zod schema,
   not by the temperature.
7. **Thinking level.** The Gemini 3 guide documents a thinking level (`minimal | low | medium |
   high`) for 3.x models. The exact REST key spelling could not be confirmed from the fetched
   pages (the guide's example reads `thinking_level` directly under `generation_config`, while
   the SDK nests it under a thinking config), and an unknown field returns a 400 that would put
   every description back to failing. Not set in this task: the default thinking level costs a
   fraction of a penny per photo at these rates and cannot 400. Recorded as a follow-up.

## The second half of the defect: the silence

`describeMedia` returns `null` for every failure and logs the reason to `console.warn`. The row
`describeCaseFileMedia` writes carries the generic `no description (see describe_video log)`. A
404 saying the model is retired is a permanent configuration failure that will fail identically
on every item until someone changes a constant; today it is retried once like a timeout and
counted like a timeout. 445 vision rows in 30 hours said "error" and nothing said why or that it
was every one of them.

## Plan

**`server/spine/tools/describe-video.ts`**
- `GEMINI_MODEL = 'gemini-3.6-flash'`; drop `temperature`; output tokens include
  `thoughtsTokenCount`. The endpoint, the body shape, the inline / Files API split, the cache
  by sha256, the 60 s timeout stay as they are.
- Classify failures. A new exported `classifyFailure(message, status)` says whether a failure is
  `config` (HTTP 400 / 401 / 403 / 404: the model, the key, the request itself), `transient`
  (429, 5xx, timeout, network), `reply` (off-schema or empty reply) or `input` (no key, file
  missing or empty). `config` failures are **not retried**: retrying a retired model is a second
  identical 404 and a second 60 s wait. Transient and reply failures keep the one retry exactly
  as today.
- `describeMedia` keeps its contract (`DescribeMediaResult | null`, never throws), so the script
  and every existing test stand. A new `describeMediaDetailed` returns
  `{ ok: true, result } | { ok: false, failure }` where `failure` is
  `{ kind, permanent, reason, status?, attempts }`; `describeMedia` is a thin wrapper over it.

**`server/spine/case-file.ts`** (`describeCaseFileMedia`)
- Calls the detailed form. The vision row's `error` becomes the real reason, prefixed by its
  class (`config: gemini 404: …`, clipped to 400 characters), and `proposal.failure` carries the
  structured form. A cache hit still writes no row and costs nothing; a failure still never
  breaks the pass; the per-pass bound and the selection rule are untouched.

**Making it visible without building a notification system**
- `server/spine/vision-health.ts`: one read of the last 20 finished vision rows →
  `{ failing, permanent, reason, since, lastAt, window: { runs, failed } }`. `failing` is true when
  the most recent row failed with a `config:` error, or when every row in the window failed.
  Never throws; a database error reads as "unknown".
- Three readers of that one function, no new tables, no push, no email:
  1. `GET /api/spine/vision-health` and a red **VISION** badge on the sidebar's *AI Staff* item,
     polled a minute apart like the price-queue badge. This is the piece that reaches the owner
     on any admin page without him going to look, which the staff card alone did not do
     (its "Errors (7d)" count has been red for 30 hours).
  2. The Vision card on `/admin/staff` gets a `bad` stat *Describer: FAILING — <reason>* which the
     card face already surfaces, and a `DESCRIBER FAILING` chip.
  3. The sandbox's banner over the composer (`videoWarning`) says every description is failing
     and why, from `video.lastFailure` on the state payload, so the page that showed him the
     generic error now shows the reason before he attaches anything.

**Tests**: describe-video (new model in the URL, no temperature, thoughts counted, a 404 not
retried and classified `config`, a 429 still retried, the detailed result shape), case-file's
row error (a stubbed describer), vision-health's rules (pure), mediaReportFor carrying the
reason, the sandbox `videoWarning` with a `lastFailure`, the staff card, the sidebar badge.

**Docs**: `docs/comms-build/T14-DONE.md` with a copy-and-paste check and a **Not done** section;
`CLAUDE.md` one sentence; `BACKLOG.md` closes T13-a and adds the thinking-level follow-up;
`staff.ts` model label; the script's header comment.

## Not changed

The Scoper's prompts and its text-only rendering of media (T7-b is the owner's call), `spine.video`
and every other setting, the per-pass bound, send preconditions, tiers, the sampler, autonomy, the
first-contact ack, prices (the *cost record* of a vision run changes; no customer price does). No
migration, no `db:push`.

## Build gate

Baseline `tsc` (8 GB heap) and vitest (server and client projects, placeholder `DATABASE_URL`)
taken at `0d7bb6c` in this worktree before any edit; the branch measured with the same commands;
failing-set diff, not counts; esbuild bundle of `server/index.ts`.

## What cannot be proven here

No key and no network to Google from this worktree, so no live call. The new model, the removed
temperature and the usage fields are taken from Google's documentation as read on 7 Sep 2026.
The DONE report says exactly what the owner should see on his server when he pulls and attaches
a photo, and what to send back if it still fails.
