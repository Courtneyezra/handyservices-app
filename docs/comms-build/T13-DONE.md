# T13 — the sandbox's Attach dropped the photo before it was sent: DONE report

Brief: `BRIEF-T13-sandbox-attach.md`. Branch `fm/sandbox-attach-fix-t13`, start commit `ec53cf4`.
Your report, first real use of T11: *"the attach media in the sandbox doesnt upload the media and
post in the chat?"* — correct, and now fixed. **The file never left the browser.** Everything after
the browser was proven to work on your own running server, with one exception (Gemini's description
failed there; the reason is in your server terminal, not on the page — see below).

---

## How to check this (copy and paste)

Your dev server (`npm run dev`) serves the page from source through Vite, so **you do not need to
restart anything**: pull the branch and the page reloads itself. Nothing here changes a setting.

1. **Get the fix.** In the repo directory:
   ```bash
   git fetch origin && git checkout fm/sandbox-attach-fix-t13
   ```
   (After it is merged: `git checkout main && git pull`.) The dev server keeps running; the browser
   tab refreshes on its own within a second or two.

2. **Open the sandbox:** http://localhost:5001/admin/sandbox. Press **Reset thread**.

3. **Attach a photo.** Press **Attach**, pick a photo of something real (a door that will not
   shut, a dead fan). **This is the step that was broken:** before the fix, nothing happened after
   the file dialog closed. Now, under the message box, a chip must appear with the file's name and
   size and a thumbnail, and **Send as customer** must light up even with no text typed. If no chip
   appears, the fix has not reached your page (check the branch, or hard-refresh the tab).

4. **Send it** with a line: `Hi, can you fix this? It stopped working last week.` Watch for:
   - the photo in the customer's bubble on the left, the caption under it (this now happens);
   - on the right, *Case file: … 1 media (N described)*;
   - the proposed reply reads as if the desk knows a photo came in ("thanks for the photo").

5. **Read "What the desk saw"** in the pass detail. Green *Described* with a sentence about the
   photo is the goal. **On your server today it came up red: DESCRIPTION FAILED, with the error
   `no description (see describe_video log)`.** That is not the attach fault and not this branch's
   code; it is Gemini not returning a usable description, and the page cannot tell you why because
   the reason goes only to the server terminal. Two ways to see it:
   - **Your server terminal**, the window running `npm run dev`: look for lines starting
     `[describe_video]` around the time you sent. The last one names the reason
     (`gemini 503 …`, `gemini 400 …`, `reply failed schema …`, `timed out after 60000 ms`, or a
     network error).
   - **Or run the describer on its own**, which prints the reason to your screen and touches no
     database (this costs one Gemini call):
     ```bash
     npx tsx scripts/_describe-media.ts /path/to/the/photo.jpg --live
     ```
     A working key and model print a JSON description and a cost; a failure prints the reason.
   Send me the line and it becomes the next task. Until then the Scoper sees the photo as
   "bare media", which is what its reply today reflected ("Can you tell me what it is…").

6. **Send a second line** with no attachment: `Roughly what would that involve?` The photo is
   still on the thread; *What the desk saw* shows it again with the same status.

7. **Prove nothing was sent**, as in T5/T11: `/admin/comms` and `/admin/desk` must not show the
   sandbox thread; nothing arrives on a real phone.

**Expect each send to take 15–50 seconds.** That is the models, plus about ten seconds of database
round trips from your machine to Neon; the breakdown is below. It is not the upload.

---

## What was wrong, exactly

Reproduced from an automation browser on your running server (`63390fa`, production database,
customer loops off), on `/admin/sandbox` only, nothing clicked outside the panel.

**Your own thread told the story first.** Every row on it was `type: text, mediaUrl: null` —
including "i need a door handle putting on this door", the message you attached the photo to. The
message ids your server log printed (`msg_sbx_02a1a150-7657`, `msg_sbx_1e561a6f-19df`) have a
dash in them: that is the id shape of a text-only row. A row written for a file is named
`msg_sbx_` + 13 hex characters, no dash. So the server never received a file on either send, and
the 200 was the text-only path working as designed.

**Then the browser.** On a clean thread, picking a photo through the real file input produced no
chip and left Send disabled; straight after React's handler ran, the input was empty again. The
cause is four lines in `addFiles` (`client/src/pages/admin/SandboxPage.tsx`):

```ts
setFiles((prev) => [...prev, ...Array.from(list)].slice(0, MAX_ATTACHMENTS));
if (fileInputRef.current) fileInputRef.current.value = '';
```

`list` is the input's `FileList`, which is **live**. Setting a file input's `value` to `''` (done
so the same photo can be picked twice) empties that list — measured in your Chrome: length 1 → 0.
React runs a state updater like the one above **lazily** whenever the component already has
another update pending, and the sandbox page nearly always does (the live events stream, the
sidebar's polling). So the updater ran after the clear, read an empty list, and `files` stayed
`[]`. Proven in your browser: with the input's value setter neutralised, the identical change
event produced the chip and enabled Send. The T11 unit tests passed because in that isolated
render React computed the updater eagerly, before the clear.

**The fix** copies the list first, clears the input, then sets state from the copy. One function;
no new UI; nothing on the server.

**Everything downstream works**, proven on your server by forcing the file past the bug: the
request went out as multipart with the file part; multer stored `msg_sbx_a5e5e03bf5fc4.jpg` in
`MEDIA_DIR`; the `messages` row carried `mediaUrl`, `mediaType: image/jpeg`, `type: image`; the
bubble rendered the stored photo off `/api/media/…` (900×502, loaded); the case file read
`1 media`; the Scoper replied "Hiya, thanks for the photo!". Only Gemini's description failed
(`0 of 1 described`).

### The 10–31 seconds

Measured on a text-only send like yours, with the live feed's timestamps:

| Segment | Time | What it is |
|---|---|---|
| POST → `run_started` | 8.0 s | auth, find the sandbox thread, insert the row, load the agents — database round trips to Neon |
| case file | 7.8 s | on this send it included a second failed Gemini attempt on the photo already on the thread |
| triage + pack | 3.0 s | rules triage, tier overlay, Ben-lane clerk read |
| agent loop | 25.2 s | the model (quote clerk preparing the intake) |
| decision → `run_finished` | 0.5 s | |
| `run_finished` → response | 2.6 s | five sequential reads to build the response and the thread state |
| **total** | **48.0 s** | |

A plain `GET /api/comms-sandbox` (the thread state, no model) took 3.2 s, 3.1 s and 8.2 s on three
tries. So: the model calls are the bulk; the database adds roughly ten seconds per send from your
machine. It is not the upload path and not the same fault, so it is reported, not fixed
(BACKLOG T13-b).

---

## What shipped

- `client/src/pages/admin/SandboxPage.tsx` — `addFiles` reads the `FileList` into an array
  before touching the input, clears the input, then updates state from the array.
- `client/src/pages/admin/__tests__/SandboxPage.test.tsx` — one new test, *T13: the picked file
  survives the input being cleared, even when React defers the updater*. It gives the input a
  Chrome-like live `files` list that empties when `value` is set to `''`, and a pending update on
  the page in the same batch so React defers the updater. It fails on the old code (no chip) and
  passes on the new (chip, input still cleared, Send enabled).
- `CLAUDE.md` sandbox bullet: one sentence and this report's path. `BACKLOG.md`: Lane 10 (T13-a
  the describer's reason never reaches the page; T13-b the ten seconds of database time; T13-c
  `GET /api/spine/price-queue` returned 500 in your console).

Untouched, as the brief required: `describe-video.ts`, the Gemini model, every setting and flag,
send preconditions, tiers, the sampler, autonomy, the first-contact ack, prices. No migration.
The three sandbox isolation layers are unchanged (server code is unchanged); their tests still pass.

### Which links are proven by test, and which only by hand

| Link | Proof |
|---|---|
| Picked file survives the input clear and a deferred updater | **test** (new), fails on old code |
| Chip, Send enabled, multipart body with the file part and the caption | **test** (T11, still passing) |
| The request leaves the browser with the file | **by hand** on your server (the stored file and the media row exist) — the fixed page has not itself been run in a real browser, because the fix lives in this worktree and your server serves your copy; step 3 above is that proof |
| multer stores the file under the sandbox name; S3 mirror; `messages` row with `mediaUrl` | **by hand** on your server; bounds and naming by T11's tests |
| Bubble renders the stored photo | **by hand** (img loaded, 900×502) and T11's test |
| Case file carries the media (`1 media`) | **by hand** and `sandbox.test.ts` |
| Gemini description reaches *What the desk saw* | **not proven** — failed on your server; reason unknown from here (step 5) |
| Exit never called; real number refused; sandbox stamped | unchanged code; `sandbox.test.ts`, `sandbox-routes.test.ts` pass |

---

## Build gate, as measured

Both sides were run in this worktree, the baseline on a checkout of `ec53cf4`, the branch on the
WIP commit, with the same script.

| Check | Start commit `ec53cf4` | This branch |
|---|---|---|
| `tsc --noEmit -p .` errors (8 GB heap) | 1,880 | 1,880 |
| tsc error lines NEW / GONE vs start (positions stripped) | — | 0 / 0 |
| vitest, server + client, placeholder `DATABASE_URL`, no `.env` | 43 failed, 1,751 passed, 8 skipped (1,802) | 43 failed, 1,752 passed, 8 skipped (1,803) |
| vitest failing-set diff, test by test | — | identical (0 new, 0 gone) |
| new tests | — | 1, passing |
| esbuild bundle `server/index.ts` (the `build` script's flags) | — | bundles, 4.2 MB |
| `db:push` / migration / `app_settings` change | none | none |

Note: tsc's exit status was 1 at the baseline and 2 on the branch with an identical error list;
the list is the gate, not the status.

---

## Not done

- **The fixed page was not run in a real browser.** Your server serves your checkout, so the fix
  could not appear on your screen; it is proven by the new test, which reproduces your browser's
  behaviour deterministically, and by the by-hand run that forced the file past the bug and
  showed the rest of the path working. Step 3 of the check list is the real-browser proof.
- **Why Gemini's description failed on your server is unknown here.** The vision row holds only
  the generic `no description (see describe_video log)`; the reason is in your terminal. The
  describer has never been run live in any of its three build reports (P4, T7, T11), so this is
  the first time anyone has seen it fail, and it may be as small as a model name or as ordinary
  as a 503. Step 5 prints it. It is not fixable from this branch without seeing it, and
  `describe-video.ts` was off-limits. BACKLOG T13-a makes the page show the reason next time.
- **The ten seconds of database time per send** (BACKLOG T13-b). Reported, not changed.
- **`GET /api/spine/price-queue` was returning 500** on your server every 30 seconds (the
  sidebar badge, seen in the browser console while reproducing). Outside the sandbox fence; not
  investigated. BACKLOG T13-c.
- **Your server is one commit behind this branch's base** (`63390fa` vs `ec53cf4`). The
  difference is the D1/D10 clerk re-run stamp, nothing to do with attachments; it did not matter
  for reproducing and does not matter for the fix.
- **The AGENTS.md helper was not run**, as in T5/T6/T9/T11: it would restructure `CLAUDE.md` into
  `AGENTS.md`, outside this task. The one-sentence pointer was added to `CLAUDE.md`.
- **Reset was pressed once and two sandbox messages were sent** on your production-connected
  server during the reproduction (one with the photo, one text-only). Both are on the sandbox
  number, both dry runs, both excluded from evidence as every sandbox pass is; press **Reset
  thread** to clear them. The uploaded `msg_sbx_a5e5e03bf5fc4.jpg` goes with the reset; its S3 copy
  stays (T11-a).
