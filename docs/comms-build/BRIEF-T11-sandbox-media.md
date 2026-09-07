# T11 — media in the comms sandbox: attach a photo or video, watch it be described

## Why now

On 7 Sep the owner switched photo and video description on in production (`spine.video` is
`{ enabled: true, images: true, maxPerRun: 6 }`, `GEMINI_API_KEY` on Railway). That is the first
time the reply-writing agent could learn anything about a customer's photo, and it is the only way
it can: `server/spine/agents/scoper.ts` renders media into the case file as **text only** — the
media id, its kind, and the Gemini description if one exists. `loadCaseFileImageBlocks` has no
caller. The description *is* the Scoper's sight.

The one place that change can be watched, `/admin/sandbox`, accepts typed text only. There is no
media handling in `server/spine/sandbox-routes.ts` and no upload control on
`client/src/pages/admin/SandboxPage.tsx`. So the whole path — a customer sends a photo, Gemini
describes it, the description reaches the Scoper, the Scoper scopes from what it saw — cannot be
observed anywhere. Closing that gap is this task.

## The safety property that must not weaken

The sandbox cannot send, by three independent layers pinned in `server/spine/sandbox.test.ts` and
`sandbox-routes.test.ts` (T5): the pass runs `dryRun` (sandbox implies it inside `runOnce`), so the
exit is never reached; the route works only on the reserved Ofcom drama number `+447700900942` and
never accepts a client-supplied conversation id (no route has a parameter); the thread carries no
trigger, so no scheduled run can pick it up. Sandbox runs are excluded from the sampler and from
every autonomy evidence query.

A file arriving from a browser is new attack surface that text was not. Whatever is accepted must
be bounded in type and size, must attach only to the sandbox thread, and must never become a route
by which a real conversation can be reached or a real send triggered. The three layers are re-pinned
**with media attached**.

## How real inbound media is stored (what the sandbox must reproduce)

`server/conversation-engine.ts` (Twilio WhatsApp/SMS inbound) is the writer:

- the bytes are written to `server/storage/media/<MessageSid>.<ext>` (`MEDIA_DIR` in
  `server/media-store.ts`), then mirrored to S3 (`mirrorMediaToS3`, never throws, no-op without S3);
- the `messages` row carries `mediaUrl: '/api/media/<file>'`, `mediaType: <MIME>`,
  `type: 'image' | 'video'`, `content: <caption or ''>`; one media item per row;
- the spine is asked for a run with trigger `inbound_message` (`server/agents/comms-lanes.ts`),
  not `media_received`.

`buildCaseFile` (`server/spine/case-file.ts`) then builds `media[]` items `{ id: messages.id, kind,
url, description }` and — when `spine.video.enabled` — describes the **last `maxPerRun`** eligible
items (videos always; images only when `video.images`) via `describeMedia` in
`server/spine/tools/describe-video.ts`, which resolves `/api/media/<file>` through
`ensureLocalMedia` (disk, then S3), caches by sha256 of the bytes under
`server/storage/media/.descriptions/`, and writes one child `agent_runs` row (`agent = 'vision'`,
`parent_run_id = <the pass>`) per model call: `decision: 'described' | 'failed'`. A cache hit
writes no row and costs nothing.

**Decision: the sandbox writes exactly this.** Bytes go to the same directory with a server-chosen
name (`msg_sbx_<random>.<ext>`, never the browser's filename), are mirrored to S3 with the same
call, and the row has the same columns — so the case file, the describer and the Scoper see the
same thing they would see for a real customer. No parallel fiction. The only differences from
production are listed in the DONE report.

## What to build

1. **`POST /api/comms-sandbox/message` accepts multipart** (`text` + up to 8 `media` files) as
   well as the existing JSON body. Bounds: JPEG/PNG/WebP/GIF/HEIC images and MP4/MOV/WebM/3GP
   videos, 16 MB per file (WhatsApp's own cap, the same limit `server/voice-notes.ts` uses), 8
   files per message. Each file becomes its own inbound row in order; the typed text is the
   caption on the first (Twilio's Body + MediaUrl0 shape). Text-only still works; media-only is
   allowed; neither is a 400. On any failure after the files are written they are removed.
   Multer parses the body — it is already a dependency (`server/media-upload.ts`,
   `server/voice-notes.ts`). A multer refusal (type, size, count) is a 400 with the reason.
2. **Reset removes the uploaded files** from disk along with every row on the sandbox number.
3. **The pass reports what the desk saw.** The `/message` response gains `media[]`: one entry per
   media item on the thread with its kind, url, the description the Scoper read (or `null`), and
   a status that says *why* there is none: `described`, `cached`, `failed` (with the vision row's
   error), `over_bound` (an earlier item outside the last-`maxPerRun` window), `off`
   (`spine.video.enabled = false`), `images_off`, `no_key` (`GEMINI_API_KEY` absent on this
   server), `unsupported` (audio/document). The selection rule is extracted into one pure module
   (`server/spine/media-selection.ts`) used by **both** `buildCaseFile` and the report, so the
   report cannot drift from what actually happened. `GET /` and the response also carry the
   `video` config and whether the key is present, so the page can say up front when description
   is off.
4. **The live feed says how many were described.** The `case_file` stage line in
   `server/spine/index.ts` gains "N media (M described)" and the detail carries the items. Additive.
5. **The page**: an *Attach* control (paperclip; hidden `<input type=file multiple>`), preview chips
   with remove, the attachments visible on the sent bubble and on the thread's inbound bubbles
   (`<img>` / `<video>` exactly as `CommsPage` renders them), cleared on send and on reset. A
   banner when description is off or the key is missing. When more than `maxPerRun` are attached,
   the composer says only the last N will be described. `RunDetail` gains **"What the desk saw"**:
   every media item with its thumbnail, status pill and description; a missing description is red
   and says why. Same idiom as the rest of the page; no new component library.

## Out of scope

`server/spine/tools/describe-video.ts`, the Gemini model, `spine.video` or any other setting, the
send preconditions, tiers, the sampler, the autonomy job, the first-contact ack, customer prices or
money. Images are not wired to the Scoper (BACKLOG T7-b, the owner's decision).

## Tests

- `server/spine/sandbox-routes.test.ts`: router shape unchanged (four routes, no parameter);
  the media validator (type/size/count bounds; the stored name never derives from the browser's
  name); the report's statuses, including over-bound, off, no key, failed.
- `server/spine/media-selection.test.ts`: the last-N rule and the images flag.
- `server/spine/sandbox.test.ts`: the three layers with media on the case file — exit never
  called; a non-sandbox number with media is refused; the vision side of the case file is
  untouched by the sandbox flag.
- `client/src/pages/admin/__tests__/SandboxPage.test.tsx`: attaching a file posts multipart to
  the same parameterless url; the sent bubble shows the attachment; `RunDetail` shows
  descriptions, and a failed / over-bound / off item loudly.

## Build gate (CLAUDE.md), as measured

Start commit `d0be4db` (contains T9). Baselines on this machine: tsc 1,880 errors with an 8 GB
heap; vitest with a placeholder `DATABASE_URL`: 42 failing tests in 15 failing suites (server
project), client project green. Zero NEW tsc errors, failing set unchanged plus the new tests,
esbuild bundles `server/index.ts`. No `db:push`, no migration, no settings change.

## Cannot be verified here

No `.env`, no database, no Gemini key, no dev server in this worktree. Nothing in the DONE report
claims the path works end to end; its first section is the copy-and-paste check the owner runs.
