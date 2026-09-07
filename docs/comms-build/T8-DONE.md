# T8 — DONE: the leads review counter reaches its handler (`server/leads.ts` route order)

Brief: `docs/comms-build/BRIEF-T8-leads-route-order.md`. Start commit `d45f94f`. 7 Sep 2026.

## What was wrong

`GET /api/admin/leads/needs-review` was registered at the bottom of `server/leads.ts`, after
`GET /api/admin/leads/:id`. Express matches in registration order, so `/:id` took the request,
looked up a lead with id `needs-review`, and answered `404 {"success":false,"error":"Lead not found"}`.
The sidebar badge (`SidebarLayout.tsx`, polled every 60 s) and `LeadReviewPage` both call that path,
so the badge has shown nothing waiting since it was written, and the server log carried one 404 a
minute for as long as the admin was open.

## What changed

- `server/leads.ts`: the `needs-review` docblock and handler moved, byte-for-byte, from after the
  station-counts route to just above `GET /api/admin/leads/:id`, next to `by-stage`, which already
  sat ahead of `/:id`. Four comment lines explain why it lives there. Nothing else in the file
  changed: `git diff -U0 | sort` on removed vs added lines differs only by those four comments.
  Same path, same handler body, same `{ leads, count }` response, same (absent) auth.
- `server/leads-route-order.test.ts` (new, 2 tests, no database):
  1. mounts the real `leadsRouter` on an Express app with `./db` mocked to return no rows and
     requests the literal path over HTTP. On the start commit it gets the id handler's
     `404 Lead not found`; on this branch it gets `200 { leads: [], count: 0 }`.
  2. walks `leadsRouter.stack` with Express's own `Layer.match`: every literal path on the router
     must be the first layer that matches itself, for every method it is registered on. On the
     start commit it reports `GET /api/admin/leads/needs-review -> /api/admin/leads/:id`. This is
     the file audit made permanent — it does not care about line numbers, only about order.

Verified the first test fails on the start commit (both assertions, as above) and both pass after
the move.

## Audit: every literal segment registered after a `/:param` at the same depth

Method: a scanner over all `X.get|post|put|patch|delete|all('path')` registrations in `server/`,
replaying the `app.use` mount order from `server/index.ts` (817 registrations), with first-match
semantics (a literal is shadowed only if the first route Express would try for it is not the
literal itself). Hits then read by hand.

### In `server/leads.ts`

| Route | Registered relative to `/:id` | Reachable before | Action |
|---|---|---|---|
| `GET /api/admin/leads/needs-review` | after (line 2312) | **No** — 404 "Lead not found" | **Fixed**: moved to line 600, above `/:id` |
| `GET /api/admin/leads/by-stage` | before (line 518) | Yes | none |
| `POST /api/admin/leads/bulk-approve`, `bulk-junk` | after `POST /:id/route` and `/:id/segment` | Yes — those need two segments after `leads`, so a one-segment literal never matches them | none |
| `POST /api/leads/quick-capture` | after `POST /api/leads` | Yes — an exact literal, no param involved | none |
| `PATCH /:id/stage`, `PUT /:id/approve-segment`, `PUT /:id/segment`, `PUT /:id/mark-junk`, `GET /:id/timeline`, `GET /:id/video` | param then literal | Yes — no literal is registered after them at that depth | none |

The stack test now pins the whole file.

### In other routers (reported, not fixed — the brief says report rather than sprawl)

| Route | Shadowed by | Reachable today | Who calls it | Why left |
|---|---|---|---|---|
| `GET /api/admin/leads/snoozed` (`server/lead-tube-map.ts:893`) | the same `GET /api/admin/leads/:id` — `leadTubeMapRouter` is mounted at `index.ts:549`, after `leadsRouter` at `:472` | **No** — 404 "Lead not found" | no caller found in `client/src` | Cross-file: the fix is either mount order in `index.ts` or moving the route into `leads.ts`. Unused today, so no one is hurt. |
| `GET /api/settings/call-timing` (`server/settings.ts:1153`) | `GET /:key` (`:691`) | **No** — the `:key` handler looks up a setting named `call-timing`, finds none, no default under that name, 404 "Setting not found" | `client/src/pages/SettingsPage.tsx:320` (the call-timing panel) | Other file. Worth its own small PR: move both `call-timing` routes above `/:key`. |
| `PUT /api/settings/call-timing` (`server/settings.ts:1180`) | `PUT /:key` (`:713`) | **No — and it writes the wrong thing.** The `:key` handler upserts an `app_settings` row with key `call-timing` and the whole request body as its value; the real `call_timing.*` keys never change, so saving that panel silently does nothing and leaves a junk row | `SettingsPage.tsx:339` | Same fix as above. Not security-relevant (admin-only, own settings table), so no `needs-decision`; but the captain should know the call-timing panel has never saved. |
| `POST /api/quote-research/process-pending` (`server/quote-research-routes.ts:129`) | `POST /:conversationId` (`:48`) | **No** — runs `runResearchImmediate('process-pending')` instead | none found in client, server, scripts or docs ("call from cron/worker") | Other file, no caller. |

### Apparent hits that are fine

- Sixteen `/api/...` GETs flagged against `GET /:city/:service[/:suburb]` in `server/seo-pages-routes.ts`.
  Both handlers call `next()` unless the first segment is a known city slug, so every `/api` path
  falls through. Safe.
- `GET /api/calls/actions`, `/active`, `/recent-callers` are registered before `GET /api/calls/:id`
  in `server/calls.ts`; the naive scan tripped on `callsRouter` being mounted twice
  (`index.ts:516–517`). First match wins, reachable. `index.ts:515` shows the team already applies
  the rule for `callPerformanceRouter`.

## Client side

No change needed. `SidebarLayout.tsx` returns `{ count: 0 }` on a non-OK response — a fallback,
not a hardcoded zero — and renders `reviewData.count` otherwise. `LeadReviewPage.tsx` throws on a
non-OK response, which is its normal error path. Both simply start receiving 200s.

## How to check this (captain)

With the dev server running and the admin open, watch the server log for one line a minute:

```
GET /api/admin/leads/needs-review 200        <- was 404 {"success":false,"error":"Lead not found"}
```

and the "needs review" badge in the sidebar shows a number whenever any lead has status
`needs_review`. `/admin` → the review page lists the same leads. I cannot run the server here, so I
make no claim about the number, only that the request now reaches the handler that counts.

## Build gate (measured, start commit `d45f94f` vs this branch, no `.env`)

| Gate | Before | After |
|---|---|---|
| `NODE_OPTIONS=--max-old-space-size=8192 tsc --noEmit -p .` | 1,880 errors | 1,880 errors; per-file counts identical; the three pre-existing `server/leads.ts` errors moved down 64 lines with the block |
| `vitest run --project server` (dummy `DATABASE_URL`) | 43 failed / 1,557 in 4 files | 42 failed / 1,559; failing set identical except `call-script performance › short transcript < 2ms` (the documented load-flaky benchmark) passed this run; `leads-route-order.test.ts` 2/2 passed |
| `esbuild server/index.ts --bundle` | — | bundles (4.2 MB) |

Nothing under `server/spine/`, the sandbox, media controls, the ack, prices or money was touched.
No migration, no `db:push`, no `app_settings` flag.

## Not done

- The three shadowed routes in `settings.ts`, `lead-tube-map.ts` and `quote-research-routes.ts`
  are reported above, not fixed. The `call-timing` pair is the one that hurts a real page.
- No AGENTS.md promotion: `fm-ensure-agents-md.sh` would turn `CLAUDE.md` into a pointer file and
  create `AGENTS.md`, a repo-wide convention change no prior lane has made; it does not belong in a
  route-order fix.
- Not run against a database or a live server; see "How to check this".
