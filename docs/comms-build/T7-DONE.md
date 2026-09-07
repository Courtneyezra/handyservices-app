# T7 — photos toggle, per-pass media limit, and images on the Scoper: DONE report

Brief: `BRIEF-T7-media-controls.md`. Branch `fm/media-controls-t7`, start commit `9b0627b` (B6 merged).

**Nothing here was seen running.** No `.env`, no database, no model key, no dev server in this
worktree. Every claim below rests on unit tests and the build gate. No `app_settings` value was
read or written. The live row still holds `video: { enabled: false, images: false, maxPerRun: 3 }`
and will until someone changes it on the page.

---

## How to check this (copy and paste; no developer needed)

After the PR is merged and deployed, open **https://www.handyservices.app/admin/staff** (or
`http://localhost:5001/admin/staff` on a machine running `npm run dev` from `main`).

Find the **Spine switches** box: the dark pill that says `SPINE LIVE` (or `SHADOW` / `OFF`),
with a row of small chips under it.

| Step | Do | You should see | A fault would look like |
|---|---|---|---|
| 1 | Just look at the chip row. | After `SAMPLER …` there are now **three** media chips in a row: `VIDEO OFF`, `PHOTOS OFF · NEEDS VIDEO ON`, and `− MEDIA/RUN 3 +`. The `3` is the value stored in production today, not the new default. | Only a `VIDEO OFF` chip, or no `MEDIA/RUN` stepper: the old page is still deployed. |
| 2 | Hover each of the three. | A tooltip in plain words: what the setting does, what OFF means for the reply-writing agent, and "last change: …". | No tooltip, or one that mentions nothing about Gemini or the Scoper. |
| 3 | Click `PHOTOS` **while video is still off**. | The chip pulses for a moment, then reads `PHOTOS ON · NEEDS VIDEO ON` and **stays grey**. It is deliberately not lit: photos are stored ON, but nothing is described until video is on. | The chip turns dark/black while `VIDEO` is still `OFF`. That would be the "looks enabled, does nothing" fault the brief forbids. |
| 4 | Click `+` on the stepper once. **This changes the live setting** (which is the point, but it is your hand on it). | The stepper pulses, then reads `MEDIA/RUN 4`. The small grey line under the chips now says `video.maxPerRun: <your name> · <today's time>`. `/admin/activity` shows `spine config changed by human:<you>: {"video":{"maxPerRun":4}}`. Click `−` to put it back if you are not ready. | A red line appears under the chips (the server refused the value), or the number never changes after the pulse (the save failed; refresh the page). |
| 5 | Keep pressing `+`. | It stops at `12` and the `+` goes faint. `−` stops at `1`. There is no way to type a number. | It goes past 12 or below 1. |
| 6 | When you are ready for descriptions: click `VIDEO`. | `VIDEO ON` turns dark. The `PHOTOS` chip now turns dark too and reads just `PHOTOS ON`. From the next customer message with a photo or video, the **Vision** card on the same page starts showing runs and spend, and the Scoper's case file carries a one-line description per item. | `VIDEO ON` but the `PHOTOS` chip still says `NEEDS VIDEO ON`: refresh; if it persists, the page did not refetch. |

Two things that are NOT faults: on your laptop nothing is ever described, because your local
`.env` has no `GEMINI_API_KEY` (Railway has it). And the new compiled-in default of 6 does not
show anywhere in production, because production has a stored value (3) and a stored value always
wins over the default.

---

## What changed

| File | Change |
|---|---|
| `server/spine/config.ts` | `VIDEO_MAX_PER_RUN = { min: 1, max: 12 }` (new export, with the reasoning). Default `video.maxPerRun` **3 → 6**. Doc comment on `video` corrected: the old one said photos "already reach the model as image blocks", which is false for the Scoper (see the investigation below). |
| `server/spine/controls.ts` | `validateSpineConfigPatch` accepts `video.maxPerRun` as a whole number inside `VIDEO_MAX_PER_RUN`, refuses anything else with `video.maxPerRun must be a whole number from 1 to 12` (400 from the route); a bad count refuses the whole body. `changes` gains `video.maxPerRun → N`. `SPINE_CONTROLS` gains `video.images` and `video.maxPerRun` so `lastChangeByField` reports who changed each and when. Rights: admin-level, same as `video`. |
| `server/spine/case-file.ts` | The `?? 3` fallback now reads `DEFAULT_SPINE_CONFIG.video.maxPerRun`. Nothing else in `describeCaseFileMedia` moved. |
| `client/src/pages/admin/AgentStaffPage.tsx` | `VIDEO_MAX_PER_RUN` (client mirror of the bound). A `stepper(...)` helper in the `toggle(...)` idiom (same `pending` key, same last-change title, `data-testid="stepper-<key>"`). The strip now renders `video` (label simplified to on/off), `video.images` through `toggle`, and `video.maxPerRun` through `stepper`, all posting through `flipSpine` to `POST /api/spine/config`. The photos chip is lit only when `video.enabled && video.images`; when video is off its label says `· needs video on` and its tooltip says why. The "last change" row and the non-owner footnote list the two new controls. |
| `server/spine/controls.test.ts` | +5 tests: in-bound accept and change text; refusal of 0, −1, 13, 99, 2.5, `'6'`, NaN, null, true; the three fields travelling together and no stray `undefined` key; the bound equals config's; `lastChangeByField` for the two new controls. |
| `server/spine/config.test.ts` | +1: default is `{ enabled: false, images: false, maxPerRun: 6 }`, inside the bound, and a stored row keeps its own value. |
| `client/src/pages/admin/__tests__/AgentStaffPage.test.tsx` | +4: video off → photos chip says "needs video on", is not lit, is clickable by a VA, posts `{ video: { images: false } }`; video on + photos on → lit, posts `images:false`; stepper shows the count, posts ±1, disables `+` at 12 and `−` at 1 with nothing posted; a 400 from the server lands in the strip's error line. |
| `docs/comms-build/BRIEF-T7-media-controls.md`, this file | The brief and the report. |

No migration. No change to `describe-video.ts`, the Gemini model, the sampler, autonomy, send
preconditions, the first-contact ack, prices or money.

## The default: why 6, and what it costs

**Where the number comes from.** The repo carries no per-thread media statistics, so the
evidence is the bursts written down in the build reports and fixtures:

| Source | Media in the thread |
|---|---|
| P19 thread `f7ebd4f6` (4 Sep) | 2 photos in one burst ("the manual and the box") |
| P13b MJ backfill fixture | 2 photos |
| P13c my-week pack | 4 photos on one task |
| P15 job drawer ("something extra") | capped at 4 photos |
| `eval-cases/confirm_received` | 2 images in one message |
| `quote-prep-readiness` | 1 video |
| Legacy image-block path (`media-context.ts` `MAX_MEDIA_ITEMS`) | 12, "enough for any real enquiry" |
| The first-contact ack | asks for "a quick photo or video", singular |

The largest burst on record is 4. With `maxPerRun: 3`, the P13c thread's first photo is never
described, and a thread that sent one video and then four follow-up photos loses the video and
the first photo. **6** covers every burst on record plus an earlier item, and is half the ceiling
the legacy path already accepted. The stepper lets the owner go to 12 if a real thread proves
bigger.

**Cost per item** (Gemini 2.5 Flash; the repo prices it at $0.10/M in, $0.40/M out in
`agent-cost.ts`, with a note that the list price is roughly $0.30/M in, $2.50/M out):

| Item | Tokens (about) | At the repo's rate | At list price |
|---|---|---|---|
| One phone photo (≈1024 px, 4 tiles) + prompt + reply | ~1,600 | $0.0002 | $0.001 |
| One 30 s video (263 tokens/s) + prompt + reply | ~8,500 | $0.001 | $0.003 |

So raising the bound from 3 to 6 adds **at most about 1p per case-file build at list price**,
and only on a build that finds uncached items. The cache is keyed on the bytes, so a photo is
paid for once ever; every re-run of the same thread (the 10-minute debounce, the 5-minute
Ben-lane cadence, replays) costs nothing for it. In practice the extra spend is per unique
media item, not per run.

**Latency is the real bound**, and it is why the ceiling is 12 and not unbounded: the build waits
for the descriptions. A description normally takes a few seconds; the worst case is two attempts
of 60 s per item, so 6 items could in theory hold a build for 12 minutes against 6 minutes today.
That worst case needs Gemini to time out twelve times in a row, but it exists.

**Existing stored settings keep their value.** `mergeOverDefaults` spreads the stored `video`
sub-object over the default, so production's `maxPerRun: 3` stays 3 until someone presses `+`.
The new default applies only where no `spine` row exists (a fresh database, the sandbox with
process-local config, tests).

## Is "the newest N" the right ordering?

`describeCaseFileMedia` takes `media.slice(-maxPerRun)`: the newest items. For the reply the
Scoper is about to write, the newest inbound is the one being answered, so newest-first is the
right tiebreak at a low bound. It is wrong in one way worth knowing: the selection does not know
which items are already cached. Under a low bound a burst of five loses its first two photos on
every build, even though describing them would be free from the second build onward. The correct
fix is a higher bound (this task) rather than a smarter selection; a smarter selection would need
the tool to expose a cache-only lookup, and the tool is out of scope here. Left as-is, said here.

## The two contracts, untouched

- `describeCaseFileMedia` still catches every throw per item, logs it, leaves `description`
  unset and continues; the build never fails on a description. Only the `?? 3` literal moved.
- A cache hit still sets the description and `continue`s before any `agent_runs` row: no call,
  no cost, no row.

---

## Investigation: should the Scoper be handed images, as well as descriptions? (report only)

### What is true today

- `loadCaseFileImageBlocks` (`server/spine/case-file.ts:327`) is defined and **has no caller**
  anywhere in `server`, `client` or `scripts`. It would build Anthropic image blocks (EXIF-rotated
  JPEGs at 1024 px, 4 keyframes per video) from a case file, through the same `buildMediaBlocks`
  the legacy comms agent and the quote clerk use.
- The Scoper's user turn is `renderCaseFile(...)`, a string. Media reaches it as
  `Media on file: <id> (image: <description>)` and `[media: <id>]` on the timeline line. With
  `video.enabled` false, or `video.images` false for a photo, that is `<id> (image)` and nothing
  else. **The Scoper is scoping blind on media today.**
- The Scoper's model is `claude-sonnet-5` (`server/llm.ts`), which can see images. The runner
  (`server/agents/runner.ts:32-46, 282-292`) already sends `{ data, mediaBlocks }` tool results
  as text plus image blocks; that is how the legacy comms agent's `get_thread` puts photos in
  front of its model. The runner's `goal` is typed `string`.
- The Scoper's prompts are written for a model that **reads**, not one that sees: the core
  orders say "Ask for a photo or video first"; the customer packs never mention looking at a
  photo; the evidence-check rule ("name what is actually in frame before replying") lives in
  `media-context.ts` and travels with the blocks, not in any spine pack.

### What wiring it in would take

Two shapes, both small in code, neither small in consequence:

1. **In the user turn.** Make `runAgent`'s `goal` accept `string | ContentBlockParam[]`
   (additive, one line in the runner) and have the Scoper pass
   `[{ type: 'text', text: renderCaseFile(...) }, ...await loadCaseFileImageBlocks(caseFile)]`.
   The model sees every photo on every run, whether or not it needs to.
2. **As a tool on the belt** (`look_at_media`): returns `{ data, mediaBlocks }` from
   `loadCaseFileImageBlocks`. Zero runner change; the model looks only when it decides to; the
   pixels arrive in a tool result, exactly the legacy `get_thread` pattern.

Either way the worker needs `sharp`, `ffmpeg` and `ensureLocalMedia` (S3 restore), which the
Railway worker already has because the quote clerk uses them.

### What it would cost per run

Anthropic bills an image at about (width × height) / 750 tokens: a 1024 × 768 photo is ~1,050
tokens, a video's 4 keyframes ~4,200. On Sonnet 5 at $2/M input, a 4-photo + 1-video thread is
~8,400 tokens ≈ **$0.017 per model turn**. The Scoper runs up to 6 turns and the images sit in
the history for every one of them, so a run is **$0.02–0.10** without prompt caching (roughly a
tenth of that with it), **every run**, since the case file only stores ids and the blocks are
rebuilt from disk each time. The Gemini description of the same five items is ~$0.005 **once**,
cached by bytes, replayable from the case-file JSON.

### Duplicate or complement?

Complement, with different failure modes. The description is structured (what is shown, what is
missing, defects, text found, confidence), cheap, cached and part of the hashed case file, so a
run is replayable against exactly what the agent saw. Pixels let the model check the description
and notice what it missed, but they are not in the case file, cost per run, and (per the 20 Aug
2026 under-the-sink incident recorded in `media-context.ts`) a seeing model still replied
"straightforward tap swap" to a photo that did not show the tap. Seeing is not the same as
looking.

### Recommendation, as a BACKLOG row

| ID | Row | Owner's call because |
|---|---|---|
| **T7-b** | **Do not wire images into the Scoper now.** Turn `video` and `photos` on (the owner's stated direction) and read the descriptions the Scoper starts receiving. Revisit only if Ben's edit and reject reasons show replies wrong *about* a photo that the description described correctly, in which case add option 2 (`look_at_media` tool, on-demand, behind a `spine.video.scoperLooks` flag defaulting off) and put the evidence-check rule into the customer pack. Do not take option 1 (always-on in the user turn) at all: it multiplies the cost of every run by the media on the thread and makes the case file no longer the whole of what the agent saw. | It changes how the reply-writing agent perceives a conversation, what a run costs, and whether a persisted case file is the full record of a run. Today every send is explainable from the case-file JSON; with pixels in the turn it is not. |

---

## Verification (measured, not assumed)

Start commit `9b0627b`; `git merge-base --is-ancestor 9b0627b HEAD` → ok.

| Gate | Before (9b0627b) | After | Verdict |
|---|---|---|---|
| `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .` | 1,880 errors | 1,880 errors | **0 new.** Diffed by (file, code, message): the only lines that differ are 10 pre-existing messages whose union-type members print in a different order; with the type text stripped, `comm -3` is empty. None in a touched file. |
| `DATABASE_URL=postgres://u:p@127.0.0.1:1/x npx vitest run --project server` | 43 failed / 1,500 passed / 1,551 | 42 failed / 1,507 passed / 1,557 | Failing-set diff: **one line**, `call-script/__tests__/performance.test.ts › should handle repeated classifications without memory growth`, which failed in the baseline and passed after. It is the load-flaky heap benchmark the brief names. Nothing new fails. +6 tests pass. |
| `npx vitest run --project client` | 0 failed / 165 | 0 failed / 169 | Green; +4 tests pass. |
| `npx esbuild server/index.ts --bundle --platform=node --format=esm --packages=external` | — | 4.2 MB, done in 86 ms | Bundles. |

The three touched suites alone: `config.test.ts` 5/5, `controls.test.ts` 16/16,
`AgentStaffPage.test.tsx` 15/15.

Not run, because it cannot be here: the page in a browser, a real `POST /api/spine/config`,
Gemini, the sandbox with media, anything against a database.

## Not done

- **The page was not seen.** The layout, the wrapping of three more chips in the strip on a
  narrow screen, and the pulse/refetch behaviour are asserted by jsdom tests only. The check
  table at the top is how to find out.
- **`agent-staff.ts` Vision card** still shows only `VIDEO ON/OFF`; it does not show photos or
  the count. The strip is the control surface; the card is a mirror and was left alone.
- **No clamp on read.** A row a script wrote with `maxPerRun: 50` is honoured as 50; only the
  settings route refuses it. Deliberate: a read-side clamp would silently change a value someone
  chose, and the only writer besides the route is a script run by hand.
- **The newest-N selection is unchanged** (see above); a cache-aware selection needs a tool
  change that is out of scope.
- **`loadCaseFileImageBlocks` is still unused.** Reported, not wired, per the brief.
- **`AGENTS.md` not created.** `fm-ensure-agents-md.sh` would rewrite the repo's `CLAUDE.md`
  into an `AGENTS.md` plus a two-line pointer, a repo-wide restructuring unrelated to this task
  that no previous crewmate PR on this repo has made. The one durable fact this task produced
  (the Scoper reads media as text only; the image-block loader is unused) is now in the doc
  comment on `SpineConfig.video` in `server/spine/config.ts`, where the next person will read it.
- **The sandbox** (`/admin/sandbox`) builds real case files, so once `video` is on it will call
  Gemini for any media typed into it on production. It is excluded from evidence, not from
  spend. Not changed; worth knowing.
