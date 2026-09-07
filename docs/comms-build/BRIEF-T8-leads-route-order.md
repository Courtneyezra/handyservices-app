# T8 — the leads review counter has never worked (route order in `server/leads.ts`)

## The log line that paid for this brief

7 Sep 2026, the captain's dev server, once a minute for as long as the admin has been open:

```
GET /api/admin/leads/needs-review  404  {"success":false,"error":"Lead not found"}
```

The admin sidebar (`client/src/components/layout/SidebarLayout.tsx`, the `leads-needs-review-count`
query) polls that path every 60 s for the "leads needing review" badge. `LeadReviewPage` fetches the
same path for its list. Both have always got a 404.

## The actual defect

Express matches routes in registration order. In `server/leads.ts` the registrations are:

```
 518  GET /api/admin/leads/by-stage        literal, ahead of /:id — fine
 596  GET /api/admin/leads/:id             parameterised
1468  GET /api/admin/leads/:id/timeline
1713  GET /api/admin/leads/:id/video
2312  GET /api/admin/leads/needs-review    literal, registered AFTER /:id — unreachable
```

`/:id` matches the literal string `needs-review` first, looks up a lead with that id, finds none
and returns `sendNotFound(res, 'Lead')`. The real handler at line 2312 is dead code.

The sidebar swallows a non-OK response as `{ count: 0 }`, so the badge has always shown nothing
waiting, however many leads sit in `needs_review`. Nobody has been told there is work.

## What to build

1. **A test that fails on the start commit.** Mount the real `leadsRouter` on an Express app (db
   mocked to return no rows), request the literal path, and expect the needs-review shape
   (`{ leads: [], count: 0 }`, 200) rather than the id handler's 404. Plus a structural test over
   `leadsRouter.stack` using Express's own `Layer.match`: every literal path registered on the
   router must be the first layer that matches itself. That second test is the audit made
   permanent — it survives any future reorder of the file.
2. **Move the registration** of `GET /api/admin/leads/needs-review` above `GET /api/admin/leads/:id`,
   next to `by-stage`, which already follows the rule. Same path, same handler body, same response.
3. **Audit the whole file** for the same shape, then the other routers; report every hit with
   whether it is reachable today. Fix only inside `server/leads.ts`. Anything in another file is
   reported, not fixed (the brief says report rather than sprawl).
4. **Client:** confirm the sidebar and review page need no change. The sidebar's
   `if (!res.ok) return { count: 0 }` is a normal fallback, not a hardcoded zero; once the request
   reaches the handler the badge reflects the count.

## Hard constraints

- Behaviour-preserving: no path rename, no response-shape change, no auth change, no migration,
  never `db:push`, no `app_settings` flag.
- Nothing under `server/spine/`, the sandbox, media controls, first-contact ack, prices or money.
- If the audit turns up something security-relevant, stop and `needs-decision:`.
- No `.env`, no database, no dev server: prove by unit test and the build gate only. Make no claim
  about the number the badge shows; only that the request reaches the right handler.

## Build gate (CLAUDE.md, measured)

- `NODE_OPTIONS=--max-old-space-size=8192 ./node_modules/.bin/tsc --noEmit -p .` before and after;
  zero NEW errors (about 1,880 pre-existing).
- `DATABASE_URL=<dummy that never connects> npx vitest run --project server --reporter=json`
  before and after; failing-name set unchanged (about 43) plus nothing new. Re-run a lone new
  failure in isolation (the `state-machine` timing and `call-script` heap benchmarks are load-flaky).
- `esbuild server/index.ts --platform=node --packages=external --bundle --format=esm` must bundle.

## Definition of done

- The new test fails on `d45f94f` and passes on the branch.
- `GET /api/admin/leads/needs-review` is registered before `GET /api/admin/leads/:id`.
- `docs/comms-build/T8-DONE.md` lists every shadowed route found, reachable or not, fixed or left
  and why, with a one-line "how to check this" for the captain.
- PR against `main`, not merged.
