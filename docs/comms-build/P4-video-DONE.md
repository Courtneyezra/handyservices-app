# Phase 4 / A — describe_video via Gemini, direct — DONE (3 Sep 2026)

Worktree `/Users/courtneebonnick/v6-wt-exit`, branch **`p4-video`**, one commit on top of 53b7340 (comms-v3). Not merged, not pushed. No dev server, no DB access, no app_settings writes, no external calls (the owner script only calls Gemini with `--live`).

**Ships dark.** `spine.video.enabled` (new, default false) gates every description; `spine.video.images` (default false) keeps photos on the existing image-block path; `spine.video.maxPerRun` (default 3) bounds one case-file build.

## Migrations

None. The child run rows reuse `agent_runs` (Phase 1); `'vision'` is a new `AgentName` value, added ADDITIVELY to `server/spine/types.ts` and `vocab.ts` (no non-partial `Record<AgentName, …>` exists, so nothing else changes).

## Files

New
- `server/spine/tools/describe-video.ts` — `describeMedia({ path | url, kind, mediaId?, mimeType?, customerContext? }, deps?)` → `{ whatIsShown, whatIsMissing[], defects[{item, severity: minor|moderate|severe, note}], textFound[], confidence: low|medium|high }` validated by `MediaDescriptionSchema` (zod), or `null`. Gemini 2.5 Flash over HTTPS with `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), `responseMimeType: application/json`, system prompt salvaged from `server/workers/vision.ts` and tightened to the schema. Inline base64 up to 20 MB, else the Files API resumable upload (start → upload+finalize → poll to ACTIVE → `file_data`). 60 s timeout per HTTP call (AbortController), one retry over the whole attempt (transport, HTTP status, empty reply, or schema failure), then `null` with the reason logged. Cache: `server/storage/media/.descriptions/<sha256 of bytes>.json` (already under the gitignored `server/storage/media/`), holding the description, usage, model and every media id that resolved to those bytes. Also exports `formatDescription` (the one-line form the case file carries), `extractJson`, `mimeTypeFor`, `hashBytes`, `GEMINI_MODEL`, `INLINE_LIMIT_BYTES`, `DESCRIPTIONS_DIR`. All deps injectable (fetch, key, cache dir, timeout, retries, inline limit, path resolver, clock, sleep, log).
- `server/spine/tools/describe-video.test.ts` — 9 tests: schema accept/reject/defaults, JSON extraction and formatting, cache miss → Gemini → cache hit (fetch once, media ids accumulate), same bytes under another name hit / different bytes miss, retry-then-null on throw / off-schema / HTTP 429 with nothing cached, null without a call when the key or the file is missing, timeout retried once and reported, the Files API sequence (start, upload+finalize, poll, generate) above the inline limit.
- `scripts/_describe-media.ts <file> [--live] [--kind] [--context] [--cache-dir]` — dry by default (size, mime, transport, hash, cache status); `--live` calls Gemini and prints the JSON, the one-line form, tokens and cost.

Changed
- `server/spine/case-file.ts` — `describeCaseFileMedia`: when `video.enabled`, the newest `maxPerRun` videos (and photos if `video.images`) get `MediaItem.description` = `formatDescription(...)`; the customer's caption on the message row is passed as context. One child `agent_runs` row per model call: agent `vision`, trigger `describe_media`, model `gemini-2.5-flash`, `transcript_ref = media:<id>`, usage, `cost_pence`, duration, `proposal = { mediaId, kind, bytes, hash, transport, attempts, description }`, `decision = described | failed`. A cache hit sets the description and writes no row. Nothing here can throw into the build. The Scoper's case-file summary already prints `m.description`, so descriptions reach the model with no agent change.
- `server/spine/config.ts` — `video: { enabled, images, maxPerRun }`, nested-merged.
- `server/agent-cost.ts` — price family `gemini-2.5-flash` (`/gemini.*flash/i`).
- `server/spine/types.ts`, `server/spine/vocab.ts` — `'vision'`.

## Verification

- **tsc** — `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.json 2>&1 | sort` on 53b7340 and on the finished tree: **1882 both**; diff by (file, code) with line numbers stripped: nothing new, nothing gone. One tsc at a time (waited for the baseline run to finish first).
- **vitest** — `DATABASE_URL=postgres://u:p@127.0.0.1:1/x npx vitest run`: baseline 42 failed / 782 passed (the baseline job's vitest phase ran after the new test file existed, so both counts include the 9 new tests); finished tree **42 failed / 782 passed** on the final run, the same three pre-existing files. One earlier run tripped `call-script/__tests__/performance.test.ts` (a wall-clock "< 5 ms" assertion) while the baseline job was still running alongside it; it passes on the clean re-run.
- **esbuild** — `npx esbuild server/index.ts --bundle --platform=node --format=esm --packages=external` succeeds.
- Not run: Gemini itself (no network in this pane), the owner script with `--live`, anything against a database.

## Not done, and why

- **No `describe_video` tool on the Scoper's belt.** The brief's build list puts the description on the case-file media item, which the Scoper already renders; an on-demand tool call from inside a run is a follow-up if the pre-described item proves insufficient.
- **Images stay on the image-block path** by default (`video.images: false`), as the brief says.
- **`server/workers/vision.ts` is untouched** (read, not imported); it is on the Phase 5 deletion list with the OpenRouter client.
- **The `/admin/staff` page has no vision card**; the rows are in `agent_runs` (agent `vision`) and the existing per-agent spend query will pick them up if it groups by agent.

## Decisions the design left open

1. **Cache key = sha256 of the bytes**, not media id + hash: the same clip forwarded twice (two message rows) is described once; the cache file records every media id that mapped to it. A different file with the same id can never hit.
2. **Gemini price**: the repo carried none, so `agent-cost.ts` uses the brief's assumption of $0.10/M input (video tokens) with output set to $0.40/M. The public list price at the time of writing is higher (about $0.30/M input, $2.50/M output for 2.5 Flash); the two numbers live in one constant and should be corrected when the first bill arrives. Every vision run's `cost_pence` derives from them.
3. **Retry semantics**: one retry covers the whole attempt — network, HTTP status, timeout, empty reply, JSON parse, schema — so an off-schema reply gets one more go before `null`.
4. **The build waits for the descriptions** (bounded by `maxPerRun` × two attempts × 60 s worst case) rather than describing asynchronously, because a description that arrives after the run is a description the run never used. The cache makes every later run free.
5. **Cache hits write no run row** (no call, no cost). Failures do write one (`decision = failed`) so the spend page and the run drawer show that a description was attempted.
6. **Empty files and unreadable paths** return `null` before any network; a missing key returns `null` and logs once per item.
7. **`formatDescription` is the string on the case file** (one line: shown, defects, text seen, not shown, confidence); the full structured object stays in the cache file and the run row's `proposal`.
8. **Trigger name `describe_media`** on the vision run row (not one of the spine `Trigger` values, which describe why a conversation run started; `agent_runs.trigger` is free text).
