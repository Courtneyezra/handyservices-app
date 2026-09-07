# T14 — the describer's model was retired, and its failure was silent: DONE report

Brief: `BRIEF-T14-gemini-model.md`. Branch `fm/gemini-model-fix-t14`, start commit `0d7bb6c`.
Your report after T13: *"Description FAILED on this pass … Error: no description (see
describe_video log)"*, and from your server console the reason: Google answers **404, "This model
models/gemini-2.5-flash is no longer available to new users. Please update your code to use
models/gemini-3.6-flash"** on every call. `spine.video` has been on in production since 7 Sep and
has never produced a description: 445 vision rows in 30 hours, every one `failed`, every one with
the same generic error, no cost recorded, nothing on any page saying so.

**This branch could not be proven live.** There is no Gemini key and no route to Google from this
worktree, so no call was made. The model, the endpoint, the removed temperature and the usage
fields come from Google's documentation as read on 7 Sep 2026 (every page is named below). The
check in the next section is how you prove it, and what to send back if it still fails.

---

## How to check this (copy and paste)

Your dev server (`npm run dev`) serves the page from source through Vite, but the describer and
the health read are **server** code, so this time restart the server after pulling. Nothing here
changes a setting; `spine.video` stays exactly as it is.

1. **Get the fix and restart.** In the repo directory:
   ```bash
   git fetch origin && git checkout fm/gemini-model-fix-t14
   ```
   (After it is merged: `git checkout main && git pull`.) Stop `npm run dev` (Ctrl-C) and start it
   again. Railway redeploys production on its own when the branch is merged to `main`.

2. **Look at the sidebar first.** Open any admin page, for example http://localhost:5001/admin/desk.
   In the DISPATCH CONSOLE group, the **AI Staff** item should now carry a red, pulsing
   **VISION FAILING** badge instead of the amber NEW. That is the last 30 hours being reported for
   the first time: the newest vision rows in the database are all failures. It reads
   `GET /api/spine/vision-health` once a minute. (If it says NEW, the server is not on this branch
   or you are not logged in as admin.)

3. **Open http://localhost:5001/admin/staff** and find the **Vision** card. Its face should show a
   red stat **Describer: FAILING — no description (see describe_video log)** and a
   **DESCRIBER FAILING** chip. The reason is the old generic one because those rows were written
   before this fix; the next row will carry the real reason.

4. **Open http://localhost:5001/admin/sandbox.** Above the composer there should be a red banner
   beginning **"Every description is FAILING since …"** with the same reason and the count of
   failed runs. This is the banner that was silent when you attached your photo in T13.

5. **Attach a photo and send** (Reset thread first). Under the message box the chip appears
   (T13); send it with a line such as `Hi, can you fix this? It stopped working last week.` Wait
   for the pass (15–50 s, as before). Then read **What the desk saw** in the pass detail. Three
   possible outcomes:

   - **Green "Described"** with one or two sentences about the photo, a confidence, and a cost of a
     penny or two on the vision row. **This is the goal.** The Scoper's proposal should read as if
     it knows what the photo shows. Refresh the page: the red banner is gone, and within a minute
     the sidebar badge goes back to NEW and the Vision card shows *Described (last N): 1 of N* —
     one success at the newest position clears the verdict even with the old failures behind it.

   - **Red "DESCRIPTION FAILED"**, but the error now starts **`config:`** and names the reason in
     Google's own words, for example `config: gemini 400: …` or `config: gemini 404: …`. That is
     the second half of this fix working (the reason reaches the page) while the first half did
     not. The one line to send me is that error text, verbatim; it is also the vision row's
     `error` column and the same line in your terminal (`[describe_video] … not retried`). The
     most likely candidates are named in *What could still be wrong* below.

   - **Red "DESCRIPTION FAILED"** with an error starting **`transient:`** or **`reply:`** — a
     timeout, a 429 or 503, or an off-schema reply. Send once more; these are retried once inside
     the pass and are not the model constant. If it repeats, send me the line.

6. **Prove nothing was sent**, as in every sandbox report: `/admin/comms` and `/admin/desk` must
   not show the sandbox thread; nothing arrives on a real phone.

7. **Optional, no database:** the describer on its own, from the repo directory, with a photo:
   ```bash
   npx tsx scripts/_describe-media.ts /path/to/the/photo.jpg --live
   ```
   A working model prints the JSON description, the one-line form, the token counts and the cost
   in pence. A failure prints the classified reason.

---

## What was established before the constant was changed

All from Google's documentation on 7 Sep 2026 (`ai.google.dev`), plus the code. No live call.

| Question | Answer | Source |
|---|---|---|
| Which model? | **`gemini-3.6-flash`** — the model Google's 404 named. Stable, inputs *Text, Image, Video, Audio, PDF*, output text; *Structured outputs*, *Thinking*; 1,048,576 input tokens; released 21 Jul 2026. The models index positions 3.6 as the Flash that "balances speed with multimodal capabilities"; 3.7 (13 Aug) and 3.8 (2 Sep) are positioned for coding and agents at the same price. | `gemini-api/docs/models`, `…/models/gemini-3.6-flash`, `…/docs/deprecations` |
| Is 2.5 Flash shut down? | No: "no shutdown date announced". The 404 is a **new-user** restriction, which is why no deprecation page warned and why the same string still works for older accounts. This key is a new user to Google. | `…/docs/deprecations`, `…/models/gemini-2.5-flash`, your log |
| Same endpoint and body? | Yes. Google's Interactions overview, verbatim: *"While it is now considered legacy, the original `generateContent` API remains fully supported."* The reference still documents `v1beta/models/{model}:generateContent`, `systemInstruction`, `contents[].parts[]` with `inline_data` / `file_data`, `generationConfig.responseMimeType`. The Interactions API is recommended for new projects, not required, and is a different resource with a different response; not adopted here. | `…/docs/interactions`, `api/generate-content` |
| Video and images, same model and shape? | Yes. All Gemini models take video; 3.6's card lists image and video; both paths here build the same body with a different mime type. Inline requests are now allowed under 100 MB, so the code's 20 MB inline cap is conservative and unchanged; the Files API path is unchanged. | `…/docs/video-understanding`, `…/models/gemini-3.6-flash` |
| Usage fields still there? | `usageMetadata.promptTokenCount`, `candidatesTokenCount`, `totalTokenCount` still exist; a thinking model also reports `thoughtsTokenCount`. 3.x Flash thinks on every call and cannot be told not to (`minimal` is the floor on 3.6). Pricing: *"output price includes thinking tokens"*. The code read only `candidatesTokenCount`, so cost would have been under-recorded on the new model. | `api/generate-content` (UsageMetadata), `…/docs/thinking`, `…/docs/pricing` |
| Price? | Gemini 3.6 Flash, paid tier: **$0.75 / M input, $3.75 / M output "through December 31, 2026"; $1.50 / $7.50 "starting January 1, 2027"**; context caching $0.075. The repo carried $0.10 / $0.40, marked "the brief's working assumption", wrong even for 2.5 Flash ($0.30 / $2.50). | `…/docs/pricing` |
| Temperature? | Gemini 3 migration guide: *"we strongly recommend keeping the temperature parameter at its default value of 1.0"*; for code that sets a low value for determinism, *"we recommend removing this parameter"* (looping, degraded performance). The code set `0.2`. | `…/docs/gemini-3` |
| Thinking level? | Documented for 3.x (`minimal | low | medium | high`), but the exact REST spelling under `generationConfig` could not be confirmed from the fetched pages, and an unknown field is a 400 that would put every description back to failing. **Not set.** Default thinking on a photo costs a fraction of a penny at these rates. BACKLOG T14-a. | `…/docs/gemini-3`, `…/docs/thinking` |

Railway's deploy log for the production service was also read through the Railway MCP; it
returned no lines for the current deployment, so production's own `[describe_video]` lines are
not quoted here. The 445 rows are from the brief.

---

## What shipped

**The model and the request** — `server/spine/tools/describe-video.ts`
- `GEMINI_MODEL = 'gemini-3.6-flash'`. Endpoint, body shape, inline / Files API split, sha256
  cache, 60 s timeout: unchanged.
- No `temperature` in `generationConfig` (Google's Gemini 3 guidance above). The JSON shape is
  held by `responseMimeType: application/json` and the zod schema.
- `usage.outputTokens = candidatesTokenCount + thoughtsTokenCount`, so the row's `cost_pence` is
  what Google bills.

**The failure, classified** — same file
- `describeMediaDetailed()` returns `{ ok: true, result }` or `{ ok: false, failure }` with
  `failure = { kind, permanent, reason, status, attempts }`. `kind` is `config` (HTTP 400 / 401 /
  403 / 404: the request, the key, the model), `transient` (429, 5xx, network, timeout), `reply`
  (off-schema or empty) or `input` (no file, empty file). `reason` is Google's own `error.message`
  when the body is Google's JSON, so a row reads `gemini 404: This model models/gemini-2.5-flash is
  no longer available to new users. …` rather than 300 characters of braces.
- **A `config` failure is not retried.** A retired model answers the same 404 twice; the second
  attempt was a second identical error and, on a slow night, a second 60 s wait. Transient and
  reply failures keep the one retry exactly as before (the existing tests for ECONNRESET, 429,
  timeout and off-schema all still pass unchanged).
- `describeMedia()` keeps its contract (`DescribeMediaResult | null`, never throws) as a wrapper,
  so `scripts/_describe-media.ts` and every existing caller and test stand. A cache hit still
  costs nothing and writes no row.

**The row carries the reason** — `server/spine/case-file.ts` (`describeCaseFileMedia`)
- Calls the detailed form. The vision row's `error` is `failureLabel(failure)`: the class first,
  then the reason (`config: gemini 404: …`), clipped to 400 characters. `proposal.failure` carries
  the structured form. A failed description still never breaks the pass; the selection rule and
  the per-pass bound are untouched. The sandbox's *What the desk saw* already printed the row's
  error, so it now prints the reason with no change of its own (BACKLOG T13-a, closed).

**Making it visible** — `server/spine/vision-health.ts`, `GET /api/spine/vision-health`
- One read of the newest 20 finished vision rows → `{ status, failing, permanent, reason, since,
  lastAt, window: { runs, failed, described } }`. `failing` is true when the newest row is a
  `config:` failure (one is enough: it will not clear on its own), or when every row in the window
  failed and there are at least three. One timeout on a working describer is not failing. A
  success at the newest position clears it. Rows written before this fix (the generic error, no
  class) count as failures. Sandbox rows count: same describer, same key, and a working sandbox
  pass after a fix is exactly the evidence that clears the badge. Never throws; a database fault
  reads as `unknown`, which no page treats as failing.
- **Why these three readers and nothing bigger.** The brief asked for the smallest mechanism that
  actually reaches you. The staff card alone did not: its *Errors (7d)* stat was red for 30 hours
  and nobody read it, because it is a number on a card on a page you open on purpose. The
  sidebar is on every admin page, and T9 already established a polled badge there for the price
  queue; so the **AI Staff** item goes red with **VISION FAILING**, one indexed select of 20 rows a
  minute, only with an admin token. The **Vision card** then says why (a `bad` stat with the
  reason, which the card face already surfaces, plus a chip), and the **sandbox banner** says it
  where you test photos and where the T13 report left you with "see the log". No email, no
  WhatsApp, no push, no table, no setting: the verdict is derived from rows that already exist.
- `client/src/hooks/useVisionHealth.ts` (the badge's query), `client/src/components/layout/SidebarLayout.tsx`
  (the badge, red when alarmed), `server/agent-staff.ts` (the card), `server/spine/sandbox-routes.ts`
  and `client/src/pages/admin/SandboxPage.tsx` (`video.health`, `videoWarning`).

**Price** — `server/agent-cost.ts`: `gemini-3.6-flash` at $0.75 / $3.75 per M with the 1 Jan 2027
step in the comment (BACKLOG T14-b). The family name changes with it; nothing else reads it.

**Docs**: `CLAUDE.md` one bullet; `BACKLOG.md` T13-a closed, Lane 11 (T14-a thinking level, T14-b
the January price step, T14-c one poll per badge); `server/spine/staff.ts` model label;
`scripts/_describe-media.ts` header.

**Tests (13 new, all passing; the 14 existing describe-video tests unchanged in substance)**
- `describe-video.test.ts`: the 404 with your server's exact body is `config`, permanent, called
  **once**, reason verbatim, `failureLabel` starts `config: gemini 404: This model models/gemini-2.5-flash`,
  the plain contract still returns null and writes no cache; 400 / 401 / 403 permanent and 429 /
  500 / 503 / off-schema retried; no key and missing file; thinking tokens counted as output;
  `geminiErrorDetail` on JSON and on HTML; the URL names `gemini-3.6-flash` and the body has no
  temperature.
- `vision-health.test.ts`: idle, ok, your 30 hours (failing, permanent, since the oldest of the
  streak), one config failure is enough, two transients are not, three of three are, legacy rows
  count, one success clears it.
- `SandboxPage.test.tsx`: the banner names the reason and says it will not clear on its own; the
  transient wording; quiet when ok; the key's line still comes first.
- `useVisionHealth.test.ts`: the badge rule (failing only, quiet on ok / idle / unknown), the
  fetch with the admin token, 401 as AUTH.

Untouched, as the brief required: the Scoper's prompts and its text-only rendering of media
(T7-b stays yours), `spine.video` and every other setting, the per-pass bound, send preconditions,
tiers, the sampler, autonomy, the first-contact ack, prices (a vision run's *cost record* changes;
no customer price does). No migration, no `db:push`.

### What could still be wrong, in order of likelihood

1. **The key's project has no access to 3.6 either** (a 403 or 404 naming 3.6). Then the fix is
   the model string again, to whatever Google's new message names; the page will show the message.
2. **A 400 on the request body.** Google is strict about unknown fields; nothing was added, one
   field was removed, and the remaining fields are all in the current reference, so this is
   unlikely, but it is the one this branch cannot rule out without a call.
3. **The description arrives but the reply is off-schema** (`reply: reply failed schema …`). A
   newer model may format differently; the prompt asks for exact keys and JSON mode is on. Send
   the line; the fix is the prompt or the extractor, not the model.

---

## Build gate, as measured

Both sides run in this worktree with the same commands: baseline on the clean checkout of
`0d7bb6c` before any edit, branch on the working tree of this commit.

| Check | Start commit `0d7bb6c` | This branch |
|---|---|---|
| `tsc --noEmit -p .` errors (8 GB heap) | 1,880 | 1,880 |
| tsc error set diff (file, line, col, code) | — | 3 lines moved in `SidebarLayout.tsx` (the same three pre-existing TS2339 errors, shifted 7 lines by the inserted hook); per-file counts identical; **0 new** |
| vitest server, placeholder `DATABASE_URL`, no `.env` | 42 failed, 1,554 passed, 8 skipped (1,604) | 43 failed, 1,564 passed, 8 skipped (1,615) |
| vitest server failing-set diff | — | one line: `server/call-script/__tests__/performance.test.ts › … without memory growth`, the `heapUsed` benchmark documented as load-flaky (it is in the 43 the T6 and T13 reports measured; it passed in this baseline run and failed on three isolated re-runs afterwards; the file is untouched by this branch) |
| vitest client | 0 failed, 199 passed | 0 failed, 202 passed |
| new tests | — | 13 (11 server, 2 client files), passing |
| esbuild bundle `server/index.ts` (the `build` script's flags) | — | bundles, 4.4 MB |
| `db:push` / migration / `app_settings` change | none | none |

---

## Not done

- **Not proven live.** No key and no network to Google here. The model string, the endpoint and
  the removed temperature are Google's documentation, not a call. Step 5 of the check is the proof;
  if it comes back `config:`, the line it prints is the whole next task.
- **Thinking level left at the model's default** (BACKLOG T14-a). A photo does not need medium
  thinking; setting `low` needs one live call to confirm the field spelling, and a wrong spelling
  is a 400 on every item. At $3.75 / M output, the default costs well under a penny per photo.
- **The health read polls once a minute from every admin page** (BACKLOG T14-c). One indexed
  select of 20 rows, admin token only; the same pattern as the price-queue badge. If a third
  such badge ever appears, they should share one request.
- **Production's own log lines were not quoted.** The Railway MCP returned no deploy log lines
  for the current deployment, filtered or not; the 445 rows and the 404 are from your report and
  your console.
- **`Errors (7d)` on the Vision card stays as it was** (a red count). The new stat sits beside it
  with the reason; the count was not removed because the other cards use it too.
- **Rows written before this fix keep the generic error.** The health verdict counts them as
  failures without a class, so today the badge says failing with `permanent: false`; the first
  row after the fix carries the class.
- **The AGENTS.md helper was not run**, as in T5/T6/T9/T11/T13: it would restructure `CLAUDE.md`,
  outside this task. The one bullet was added to `CLAUDE.md`.
