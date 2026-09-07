# T7 — photos toggle, per-pass media limit, and the question of images on the Scoper

## The correction that paid for this brief

Firstmate told the owner that photos were already in front of the agent that writes replies.
That was wrong. Read from the tree at `9b0627b` on 7 Sep 2026:

- `server/spine/agents/scoper.ts` line 185 renders `cf.media` as **text only**: the media id, its
  kind, and `m.description` if one exists. No image block is built for the Scoper anywhere.
- `loadCaseFileImageBlocks` (`server/spine/case-file.ts` line 327) would build image blocks from
  a case file. `grep -rn loadCaseFileImageBlocks server client scripts` finds its definition and
  nothing else. Nobody calls it.
- The two places that put pixels in front of a model are `server/agents/quote-prep.ts` (line 363)
  and `server/agents/comms.ts` (line 813), both through `buildMediaBlocks`. The comms agent is on
  the Phase 5 delete list.

So with `spine.video.enabled` false, which is what production holds today, a customer's photo
reaches the Scoper as `<uuid> (image)` and nothing more. The Gemini description written in Phase 4
(`P4-video-DONE.md`) is the **only** route by which the reply-writing agent learns what a photo
or a video shows. It is not an enhancement. It is the eyes.

The owner's words: *"Videos and image will be better analysed through Gemini that anthropic. We
need to increase item descriptions per pass to ensure we get the best information. Yes add photos
toggle."*

## Live settings on 7 Sep (read, not changed, and NOT to be changed by this task)

`spine.video = { enabled: false, images: false, maxPerRun: 3 }`. `sampler.enabled`,
`autonomy.enabled` and `asks.enabled` are all true. Production Railway has `GEMINI_API_KEY`;
the owner's local `.env` does not, so the sandbox describes nothing locally.

## What the page has today

`client/src/pages/admin/AgentStaffPage.tsx`, the Spine switches strip (`SpineSwitchStrip`,
line ~709): one `video` chip that flips `video.enabled` and whose label already appends
`+photos` when `images` is true. There is no control for `images` and none for `maxPerRun`.
The server already accepts `video.images` (`validateSpineConfigPatch`, `controls.ts` line 96)
but refuses `video.maxPerRun` silently: the field is read by neither `boolField` call, so a body
`{ video: { maxPerRun: 6 } }` is answered "nothing to change".

## Build

1. **Photos chip.** Alongside `video`, same `toggle(...)` helper, same `flipSpine(...)` call
   shape, posting `{ video: { images: !spine.video.images } }`. When video is off the chip must
   not look armed: the case-file build gates the whole media pass on `video.enabled`, so a photos
   chip that reads "on" while video is off would be a lie. Rule: it renders in the "on" style
   only when `video.enabled && video.images`; when video is off the label says so in words and the
   title explains why. It stays clickable so the owner can arm photos before turning video on.
2. **Per-pass limit.** A small stepper (− count +) in the same strip, posting
   `{ video: { maxPerRun: n } }`, bounded client-side and **validated server-side** in
   `validateSpineConfigPatch`: an integer within `[VIDEO_MAX_PER_RUN.min, .max]` or a 400.
   No free-text field. Bounds live next to the default in `server/spine/config.ts`.
3. **Raise the default** in `DEFAULT_SPINE_CONFIG` from 3, chosen from what real threads carry
   (see the DONE report for the numbers). The stored production row keeps `3` until the owner
   changes it on the page; the default only applies where nothing is stored.
4. **"Last change" bookkeeping**: `SPINE_CONTROLS` gains `video.images` and `video.maxPerRun`
   so the chips' titles can say who changed them and when, like every other chip.
5. Both new controls sit on the same rights footing as `video`: any admin, not owner-only.

## Do not

- Flip or change any `app_settings` value. The spine is LIVE.
- Touch `server/spine/tools/describe-video.ts`, the Gemini model, the sampler, the autonomy
  job, the send preconditions, the first-contact ack, prices or money.
- Break `describeCaseFileMedia`'s two contracts: a failed description is a missing description
  and never fails the build; a cache hit writes no run row and costs nothing.
- Wire `loadCaseFileImageBlocks` in. That changes what the reply-writing agent perceives and the
  owner has said he wants to decide it knowingly. Investigate and report only.
- Add a migration or run `db:push`.

## Investigate and report only

Should the Scoper be handed images directly, as well as descriptions? Establish what wiring
`loadCaseFileImageBlocks` in would take, which model call would carry the blocks, what it costs
per run, whether it duplicates or complements the Gemini description, and whether the Scoper's
prompt is written for a model that can see. Recommendation goes in the DONE report as a proposed
BACKLOG row marked as the owner's call.

## What cannot be done here

No `.env`, no database, no model key, no dev server. The page cannot be looked at. Verification
is unit tests (server `controls.test.ts`, `config.test.ts`; client `AgentStaffPage.test.tsx`)
plus the build gate. The DONE report opens with a copy-and-paste "how to check this" section for
a non-developer, and makes no claim that the page works or looks right.

## Build gate (CLAUDE.md), measured

- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .` before and after, sorted,
  diffed by (file, code). Zero NEW errors; about 1,880 pre-existing.
- `DATABASE_URL=postgres://u:p@127.0.0.1:1/x npx vitest run --project server` and
  `--project client`, judged by the **failing-set diff**, never the count. Timing-flaky suites
  re-run alone.
- `npx esbuild server/index.ts --bundle --platform=node --format=esm --packages=external`.

## Definition of done

- The strip has a photos chip and a per-pass stepper, both any-admin, both posting through
  `flipSpine` to `/api/spine/config`.
- `validateSpineConfigPatch` accepts `video.maxPerRun` within bounds and refuses everything
  else, proven by test.
- `DEFAULT_SPINE_CONFIG.video.maxPerRun` is raised with the reasoning and the cost written down.
- The DONE report carries the "how to check this" section, the measured gate, the image-block
  recommendation as a BACKLOG row, and a Not done section.
- PR against `main`, not merged.
