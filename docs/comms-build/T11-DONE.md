# T11 — media in the comms sandbox: DONE report

Brief: `BRIEF-T11-sandbox-media.md`. Branch `fm/sandbox-media-t11`, start commit `d0be4db`.

**This was built without being run.** The pane had no `.env`, no database, no Gemini key and no
dev server, so no photo was ever uploaded, described, or read by the Scoper on this branch.
Everything below is verified by unit tests and the build gate only. **Nothing in this report claims
the path works end to end.** The section right below is how you find out, and it is the deliverable.

---

## How to check this (copy and paste)

This is the run the task exists for: a customer sends a photo, Gemini describes it, the description
reaches the Scoper, the Scoper scopes from what it saw. You need the repo on this branch, your usual
`.env` **with `GEMINI_API_KEY` in it**, and an admin login. Your local server reads production's
settings row, so description is already on for you (`spine.video` is `enabled: true, images: true,
maxPerRun: 6`). Nothing here changes any setting.

1. **Start the app.**
   ```bash
   npm run dev
   ```
   Wait for `Production server running on port 5001`.

2. **Open the sandbox:** http://localhost:5001/admin/sandbox (or the sidebar, DISPATCH CONSOLE →
   **Sandbox**). Press **Start a clean thread** (or **Reset thread** if one is there).

3. **Look at the composer before you send anything.** If a red box above the message box says
   *Photo and video description is OFF* or *GEMINI_API_KEY is not set on this server*, stop: that is
   the fault this page exists to show you, and nothing you send will be described until it is fixed
   (the key goes in `.env`; the switch is `spine.video` in `app_settings`, which you turned on on
   7 Sep). No red box means description is on and the key is there.

4. **Send a photo of a job, as a customer would.** Press **Attach** (the paperclip), pick a photo
   of something real — a dead extractor fan, a cracked tile, a door that does not shut. Type a line
   with it, e.g. `Hi, can you fix this? It stopped working last week.` Press **Send as customer**.

   The chip under the message box shows the file and its size. Then, in order:
   - the photo appears in the customer's bubble on the left, with the caption under it;
   - on the right, *Agent working on this thread…* and a line `Case file: … 1 media (1 described)`.
     **That "(1 described)" is the first thing to look for.** `(0 described)` means Gemini did not
     describe it — read on for why;
   - because this is the first message on a clean thread, the rules layer answers it (that is what
     happens live too): a blue *First contact* box appears and the mirrored ack lands in the chat.
     The desk has not spoken yet. That is correct;
   - **a box headed "What the desk saw"** appears in the pass detail, with the photo's thumbnail,
     a green pill *Described — on the case file the Scoper read*, and the description itself: a
     sentence or two on what is in the photo, any defects, any text or model numbers seen, and a
     confidence. **Read it against the photo.** That text is the whole of what the reply-writing
     agent can know about the picture; it never sees the pixels — and its case-file summary
     carries only the first 160 characters of it (see Not done). This takes 5–20 seconds on top of
     the pass.

5. **Now make the desk scope from it.** Type a second line — `Roughly what would that involve?` —
   and send (no attachment this time). This one reaches the Scoper. What you are checking:
   - *What the desk saw* shows the same photo again, now with the pill *Described (from cache, no
     model call)*. Same text as before, no second Gemini call, no cost: the description is cached by
     the bytes;
   - the **proposed reply** (dashed amber, NOT SENT) should read as if the desk looked at the photo:
     it names the thing in the picture, asks about what the description said was *not shown*, and
     does not ask for a photo it already has. If the reply asks "could you send a photo?" while a
     green description sits above it, that is the finding: the description reached the case file
     but the Scoper did not use it. Note the wording and the run id (bottom of the detail).

6. **Try a video** the same way (MP4 or MOV from your phone, under 16 MB). Videos are described
   whether or not photos are; the description should cover motion and anything said out loud.

7. **Try the bound.** Attach seven or eight photos in one message. The composer says *Only the last
   6 will be described*, and after the pass *What the desk saw* shows the first one or two with an
   amber pill *NOT described — over the per-pass bound* and the rest described. Live, a customer
   who sends a burst of eight gets exactly this: the first two are invisible to the desk. That is
   `spine.video.maxPerRun` and it is your call whether 6 is right.

8. **Prove nothing was sent.** As in T5: `/admin/comms` and `/admin/desk` must not show the sandbox
   thread; nothing arrives on a real phone. In the database if you want it:
   `select id, agent, decision, parent_run_id, proposal->>'mediaId' from agent_runs order by
   started_at desc limit 8;` — the pass row shows `proposal->>'sandbox' = 'true'`, and each
   Gemini call is a child row with `agent = 'vision'` under it (a cache hit writes no row).

**What a fault looks like:**
- **Red box above the composer** (step 3): description off or no key. The page will still let you
  send, and *What the desk saw* will show a red *NOT described* item with the reason. Nothing is
  broken in the pipeline; the switch or the key is.
- **A red item in *What the desk saw* saying DESCRIPTION FAILED**, with an error line: Gemini was
  called and did not return a usable description (a bad key, a network refusal, an unsupported
  file, a 20 MB+ video that failed the Files API upload). The server log has a
  `[describe_video]` line with the reason. The Scoper saw bare media for that item.
- **A red item saying *no description and no vision row***: the describer threw before recording
  anything. Server log, `[Spine] describe_video`.
- **The green description does not match the photo** (wrong object, invented defects, "nothing
  relevant to a home repair" for a clear picture): that is the model's reading, and it is what the
  desk would have worked from. Worth a screenshot; it is the case for BACKLOG T7-b.
- **Broken thumbnail but a good description**: an iPhone HEIC. Chrome cannot show it; Gemini can
  read it. BACKLOG T11-c.
- **A 400 on send**: the file was refused before a byte was written — over 16 MB, more than 8
  files, or not a photo/video type. The message says which.
- **The sandbox thread on `/admin/comms` or `/admin/desk`, or anything on a real phone**: stop and
  report, as in T5. Nothing in this task touched those exclusions; the tests that pin them still
  pass with media attached.

**To clean up:** **Reset thread** deletes every row on the sandbox number and the uploaded files
from `server/storage/media/`. The S3 copies and the description cache stay (see Not done).

---

## What shipped

### 1. The sandbox writes media exactly as a real inbound is written

`server/conversation-engine.ts` is the writer for a real WhatsApp photo: bytes to
`server/storage/media/<MessageSid>.<ext>`, mirrored to S3 (`mirrorMediaToS3`), and a `messages`
row with `mediaUrl: '/api/media/<file>'`, `mediaType: <MIME>`, `type: 'image' | 'video'`, the
caption as `content`, one row per item. The sandbox (`server/spine/sandbox-routes.ts`) now does
the same thing: multer writes the bytes straight into `MEDIA_DIR` under a name this server chose
(`msg_sbx_<13 hex>.<ext>` — the message id, as a real file is named after its MessageSid; the
browser's filename is never used), the same S3 mirror call runs, and each file becomes one inbound
row with those columns, the typed text as the first one's caption (Twilio's Body + MediaUrl0
shape). The run is asked for with `inbound_message`, the trigger a real media inbound uses
(`server/agents/comms-lanes.ts`).

So `buildCaseFile` builds the same `media[]`, `describeMedia` resolves the same `/api/media/…` url
through `ensureLocalMedia` (disk, then S3), caches by the bytes' sha256, writes the same `vision`
child rows — and the Scoper reads the same one line of text per item. **Where the bytes live:**
production's own store, because it was available and because a sandbox that faked the shape would
teach nothing. The differences from production are only these: the file is named `msg_sbx_…`
rather than after a Twilio SID; the bytes come from a browser upload rather than a Twilio fetch;
and reset deletes the local file (a real inbound's file is never deleted).

**Bounds** (all pure, all tested): declared type in `SANDBOX_MEDIA_TYPES` (JPEG, PNG, WebP, GIF,
HEIC/HEIF, MP4, MOV, WebM, 3GP) checked in multer's `fileFilter` before a byte is written; 16 MB per
file (WhatsApp's cap, the limit `server/voice-notes.ts` uses); 8 files per message (above
`maxPerRun` on purpose so the over-bound case is reachable); text may be empty only when files
came with it. A refusal is a 400 in words. A failure after the files are written removes them.
A JSON body still works unchanged: multer only parses multipart.

### 2. The three layers, re-pinned with media

- **Layer 1 (dry run):** `server/spine/sandbox.test.ts` — a sandbox pass with a described photo
  and an undescribed video on the case file never calls the exit; `dryRun` and `sandbox` are
  recorded; the media reach the agent unchanged.
- **Layer 2 (the number):** the same case file on a real number is refused before triage.
- **Layer 3 (no trigger) and evidence:** `proposal.sandbox = true` still stamped with media on the
  file; the router still has exactly four parameterless routes (`sandbox-routes.test.ts`), so no
  upload can name a conversation. The file lands on whichever conversation is "the sandbox
  thread", found by number, as every write here always has.
- Reset deletes only files whose name matches `msg_sbx_<id>.<ext>` and only from `MEDIA_DIR`
  (`sandboxMediaIdOf`), so a row that somehow pointed at a customer's file could never delete it.

### 3. The pass reports what the desk saw, and why it saw nothing

`mediaReportFor` (pure, `sandbox-routes.ts`) gives one entry per media item on the case file:
kind, url, the description verbatim, and a status: `described` (vision row for this pass),
`cached` (description present, no row — identical bytes described earlier), `failed` (row with
`decision = 'failed'`, error carried), `over_bound` (an earlier item outside the last-`maxPerRun`
window), `off` (`spine.video.enabled = false`), `images_off`, `no_key` (`GEMINI_API_KEY` absent on
this server), `unsupported`, `missing` (no description, no row). Each carries a one-line note.

The selection rule was extracted from `buildCaseFile` into `server/spine/media-selection.ts`
(`selectMediaToDescribe`, `explainMediaSelection`) and **both** the case file and the report read
it, so the report cannot say "described" of something the case file dropped, or the reverse. The
extraction changed no behaviour: the same filter and the same `slice(-max(1, maxPerRun))`.

`GET /` and the `/message` response also carry `video` — `spine.video` as this server reads it,
plus `keyPresent` — so the page can warn before a send. Read-only; nothing here writes a setting.

### 4. The live feed counts descriptions

`server/spine/index.ts`: the `case_file` stage line gains `, N media (M described)` when there is
media, and its detail carries `{ id, kind, described, description }` per item. Additive; a file
with no media reads exactly as before (pinned). `LiveRunPanel` renders the label, so the count is
visible as the pass starts; the description text itself is in the detail (BACKLOG T11-d).

### 5. The page (`client/src/pages/admin/SandboxPage.tsx`)

**Attach** (paperclip, hidden `<input type=file multiple>`, accept list mirroring the server's) →
chips with thumbnail, name, size and remove → the sent bubble shows the file names while the desk
thinks → the thread's inbound bubbles render the stored photo or video off `/api/media/…` exactly
as `CommsPage` does. Send goes as `FormData` when there are files (no forced content type) and as
the JSON body when there are none. A photo alone can be sent. Reset and a successful send clear the
picker. When more than `maxPerRun` are attached the composer says *Only the last N will be
described*. A red box above the composer says when description is off or the key is missing
(`videoWarning`).

**"What the desk saw"** (`MediaSeen`) sits in the pass detail between the proposed reply and the
triage fields, with a line saying the Scoper's summary carries the first 160 characters of each
description: thumbnail, id, a pill (green *Described* / *Described (from cache)*; amber
*over the bound* / *unsupported*; red *FAILED* / *OFF* / *photos off* / *no key* / *no vision
row*), the description in a green box or, when there is none, a red box saying *No description*
and why, plus the vision run id, cost and error when a row exists. Header: *N of M described*, red
unless all are.

### Tests

New: `server/spine/media-selection.test.ts` (6). Extended: `server/spine/sandbox-routes.test.ts`
(+13: bounds, naming, the report's every status, the router shape re-pinned), `server/spine/sandbox.test.ts`
(+5: the three layers with media, the stage line and its control),
`client/src/pages/admin/__tests__/SandboxPage.test.tsx` (+16: helpers, `MediaSeen` in each state,
multipart post to the parameterless url with the caption, photo alone, JSON when no files, the
over-bound hint, the warning, reset clearing the picker). 40 new tests, all passing.

---

## Build gate, as measured

| Check | Start commit `d0be4db` | This branch |
|---|---|---|
| `tsc --noEmit` errors (8 GB heap) | 1,880 | 1,880 |
| tsc errors NEW vs start (diff of the lists, positions stripped) | — | 0 (the first full run showed 5 in `sandbox-routes.ts` — an interface extending an indexed type, and `.entries()` iteration under the project target — fixed before commit and re-measured) |
| vitest server + client, placeholder `DATABASE_URL`, no `.env` | 42 failing tests, 15 suites failing at collection | 42 failing tests (+ the load-flaky heap benchmark, see below), 15 suites |
| vitest failing-set diff, test by test | — | 0 new (see below), 0 fixed; 1,748 → 1,788 tests, 1,698 → 1,737 passing |
| new tests | — | 40 passing (24 server, 16 client) |
| esbuild bundle `server/index.ts` (the `build` script's flags) | — | bundles, 4.2 MB |
| `db:push` / migration / `app_settings` change | none | none |

The one line in the failing-set diff was `server/call-script/__tests__/performance.test.ts › should
handle repeated classifications without memory growth`, the heap benchmark the brief names as
load-flaky: it failed while the 8 GB tsc was running alongside. Re-run alone three times on this
machine, with nothing else running: fail, fail, pass (`expected 14160632 to be less than
10485760`, a heap-growth threshold). `server/call-script` is untouched by this branch
(`git diff d0be4db --stat -- server/call-script` is empty), and the same test passed in the
baseline run, so it is the machine, not the change.

Pre-existing tsc lines whose text differs only by the order of a union's members
(`server/lead-stage-engine.ts`, `server/first-contact-ack.ts`, `server/inbox-board.ts`,
`server/call-thread.ts`, `server/leads.ts`) appear on both sides of the raw diff; per-file counts
are identical for every file but the one this task added errors to and then fixed.

---

## Not done

- **Never run live.** No upload, no Gemini call, no Scoper pass happened on this branch. The
  multipart parse, the S3 mirror, the describer reading a sandbox file, the thumbnail off
  `/api/media`, the FormData round trip through `requireAdmin` — all unit-tested at their pure seams
  and never exercised. The "How to check" section is the deliverable in its place.
- **Reset leaves the S3 copies.** `server/media-store.ts` has no delete; the private objects
  under `chat-media/msg_sbx_…` stay after reset. Small and unreferenced. BACKLOG T11-a.
- **The description cache is not cleared by reset.** By design: a re-sent identical photo is a
  cache hit, which is what the "from cache" pill shows and what happens live when a customer
  forwards the same picture twice. To force a fresh Gemini call, send a different photo (or delete
  `server/storage/media/.descriptions/<hash>.json` by hand).
- **The declared type is trusted.** Bounds are on the browser's MIME and size, not the bytes
  (admin-only route, sandbox thread only). A mislabelled file fails at Gemini and shows as FAILED.
  BACKLOG T11-b.
- **HEIC thumbnails.** Accepted and describable; Chrome cannot render the preview. BACKLOG T11-c.
- **The live panel shows the count, not the text.** BACKLOG T11-d.
- **Images are not wired to the Scoper** (BACKLOG T7-b, the owner's decision). What this task
  makes plainer: the Scoper's whole knowledge of a photo is one line of text of at most ~160
  characters after `clip()` in `scoper.ts` (`Media on file: <id> (image: <description clipped to
  160>)`), while `formatDescription` produces defects, text seen, what is missing and a confidence
  that can run to several hundred. **The sandbox shows the full description; the Scoper reads the
  first 160 characters of it.** If step 5 above shows a reply that ignores a defect the description
  named late in its text, the clip — not the model — is the first suspect. Widening the clip in the
  Scoper's case-file summary is a one-line change but it is a change to what the reply-writing
  agent reads, so it is not made here.
- **The AGENTS.md helper was not run.** As in T5/T6/T9: `fm-ensure-agents-md.sh` would restructure
  `CLAUDE.md` into `AGENTS.md`, outside this task. A one-sentence pointer was added to the sandbox
  bullet in `CLAUDE.md`.

## New BACKLOG rows

Lane 9 (`docs/comms-build/BACKLOG.md`): T11-a S3 copies on reset; T11-b sniff the bytes; T11-c
HEIC previews; T11-d description text in the live panel.
