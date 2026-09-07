# BRIEF T13 — the sandbox's Attach drops the photo before it is sent

Branch `fm/sandbox-attach-fix-t13`, start commit `ec53cf4`. Owner's report, first real use of T11:
*"the attach media in the sandbox doesnt upload the media and post in the chat?"*

## What was found before a line was changed

Reproduced live against the owner's own dev server (`63390fa`, production database, customer loops
off) from an automation browser, on `/admin/sandbox` only.

1. **The file never leaves the browser.** Picking a photo through the real `<input type=file>`
   produced no chip, left Send disabled, and the input was empty again straight after React's
   handler ran. The owner's own thread confirmed it from the other side: every one of his rows was
   `type: text, mediaUrl: null`, and the message ids his log printed (`msg_sbx_02a1a150-7657`,
   dash included) are the text-only id shape — a media row's id is 13 hex characters. The server
   was never handed a file.
2. **The cause is in `addFiles` (`SandboxPage.tsx`).** It hands React a state updater that reads
   the picked `FileList` *inside* the updater, then immediately sets the input's `value = ''` to
   let the same file be picked again. Clearing a file input's value empties its `FileList` (per
   spec, and measured in Chrome: length 1 → 0). React runs the updater lazily when the component
   has any other pending update — which the sandbox page nearly always has (events stream,
   query polling) — so the updater reads an empty list and `files` stays `[]`. Proven in the
   owner's browser: with the value setter neutralised on the input, the identical change event
   produced the chip and enabled Send. The T11 unit tests passed because in that isolated render
   React computed the updater eagerly.
3. **Everything downstream works on his server**, proven by forcing the file past the bug:
   multipart arrives, multer stores `msg_sbx_<13 hex>.jpg` in `MEDIA_DIR`, the `messages` row
   carries `mediaUrl`/`mediaType`/`type: image`, the bubble renders the stored photo off
   `/api/media/…` (900×502, loaded), the case file reads `1 media`, the Scoper replied "thanks for
   the photo".
4. **One further fault, not in this task's code:** Gemini's description FAILED on his server
   (`0 of 1 described`, vision row error is the generic `no description (see describe_video log)`).
   The real reason is only in his server console (`[describe_video] …`). The describer has never
   been run live in P4, T7 or T11. Out of scope to change (`describe-video.ts` is off-limits); the
   DONE report gives him the one command that prints the reason.
5. **The 10–31 s.** Measured on a text-only send: 48 s wall = ~8 s before the run starts (DB
   round trips to Neon from his machine; a plain state read takes 3–8 s), ~8 s case file (a second
   failed Gemini attempt on the photo already on the thread), ~3 s triage + pack, ~25 s in the
   model loop, ~3 s post-run state loading. Model calls dominate; DB latency adds ~10 s. Not the
   same fault; reported, not fixed.

## Plan

- Fix `addFiles`: read the `FileList` synchronously into an array, clear the input, then set
  state from the array. One function, no new UI.
- A client test that reproduces the browser: a file input whose `files` empties when `value` is
  set to `''`, and a pending update on the same component so React defers the updater. Fails on
  the old code, passes on the new.
- Re-check list for the owner (copy and paste) in `T13-DONE.md`, including the describer
  diagnostic and the timing breakdown.
- Nothing else changes: not `describe-video.ts`, not the model, no setting, no flag, no
  preconditions, tiers, sampler, autonomy, first-contact ack, prices. No migration.

## Build gate

Baseline `tsc` (8 GB heap) taken at `ec53cf4` before the change; failing-set diff for vitest, not
the count; esbuild bundle of `server/index.ts`.
