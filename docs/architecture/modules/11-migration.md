# Module 11: Migration & Compatibility Shim

**Status:** Wave 3 — authoritative
**Primary flag:** `FF_LEGACY_BRIDGE` (defaults `1`; flips to `0` at Phase 9)
**Depends on:** ADR-001, `data-model.md`, `state-machine.md`

---

## 1. Purpose

Per ADR-001, two job-assignment tables coexist: `contractorBookingRequests`
(legacy, read by `/admin/daily-planner`) and `jobDispatches` +
`contractorJobLinks` (current, written by `server/contractor-dispatch.ts`).
v2 treats `jobDispatches` as the single canonical store. This module ships
a **write-only shim** mirroring every canonical write into the legacy
table so the daily planner keeps working through Phases 1–8. At Phase 9
the flag flips off, a reconciliation script verifies parity, and the
legacy table is dropped after a 30-day grace.

The bridge is one-way (canonical → legacy). New code **never** reads
`contractorBookingRequests`; legacy reads hit it directly.

---

## 2. Strategy timeline

| Phase | State |
|---|---|
| 0–1 | Flag plumbing in place; `FF_LEGACY_BRIDGE=1` (default ON). |
| 2–3 | Shim active. Every `jobDispatches` lifecycle event mirrors to `contractor_booking_requests`. Control tower ships in Phase 3 but daily planner remains canonical for ops. |
| 4–7 | Shim continues. Control tower gradually replaces the daily planner. |
| 8 | Daily planner read traffic monitored; expected <5% by mid-phase 8 (FF_CONTROL_TOWER hides the menu link). |
| 9 | `FF_LEGACY_BRIDGE=0`; reconcile runs; daily planner route removed; `contractor_booking_requests` dropped after 30-day grace. |

---

## 3. Files

```
NEW       server/migration/legacy-bridge.ts        — the shim
NEW       server/migration/data-backfill.ts        — one-shot helpers (rarely used)
NEW       server/migration/cutover-reconcile.ts    — Phase 9 parity verifier
MODIFIED  server/contractor-dispatch.ts            — calls bridge on lifecycle events
MODIFIED  server/feature-flags.ts                  — already exports FLAGS.LEGACY_BRIDGE
```

---

## 4. The bridge interface

`legacy-bridge.ts` exposes one function per dispatch lifecycle transition.
Each is a no-op when `FLAGS.LEGACY_BRIDGE` is off.

```ts
// server/migration/legacy-bridge.ts
import { db } from '../db';
import { eq } from 'drizzle-orm';
import { contractorBookingRequests, type JobDispatch } from '@shared/schema';
import { FLAGS } from '../feature-flags';

export async function bridgeOnDispatchCreated(dispatch: JobDispatch) {
  if (!FLAGS.LEGACY_BRIDGE) return;
  if (!dispatch.lockedToContractorId) return; // pre-accept broadcasts skipped
  await db.insert(contractorBookingRequests).values({
    id: dispatch.id, // re-use dispatch id as legacy PK
    quoteId: dispatch.quoteId,
    contractorId: dispatch.lockedToContractorId,
    assignedContractorId: dispatch.lockedToContractorId,
    customerName: dispatch.customerFullName ?? dispatch.customerFirstName,
    customerPhone: dispatch.customerPhone,
    scheduledDate: dispatch.scheduledDate,
    assignmentStatus: 'assigned',
    status: 'pending',
    assignedAt: dispatch.lockedAt ?? new Date(),
    createdAt: dispatch.createdAt,
  }).onConflictDoNothing();
}

export async function bridgeOnContractorAccepted(dispatch: JobDispatch) {
  if (!FLAGS.LEGACY_BRIDGE) return;
  await db.update(contractorBookingRequests)
    .set({ status: 'accepted', assignmentStatus: 'accepted', acceptedAt: new Date() })
    .where(eq(contractorBookingRequests.id, dispatch.id));
}

export async function bridgeOnDispatchCompleted(dispatch: JobDispatch) {
  if (!FLAGS.LEGACY_BRIDGE) return;
  await db.update(contractorBookingRequests)
    .set({ status: 'completed', assignmentStatus: 'completed',
           completedAt: dispatch.completedAt ?? new Date() })
    .where(eq(contractorBookingRequests.id, dispatch.id));
}

export async function bridgeOnDispatchCancelled(dispatch: JobDispatch, reason: string) {
  if (!FLAGS.LEGACY_BRIDGE) return;
  await db.update(contractorBookingRequests)
    .set({ status: 'declined', declineReason: 'other', declineNotes: reason })
    .where(eq(contractorBookingRequests.id, dispatch.id));
}

export async function bridgeOnDayPackAssigned(packJobIds: string[], unitId: string,
                                              date: Date, dispatchIds: string[]) {
  // One legacy row per job in the pack — see §6 day-pack edge case.
}
```

Idempotency: `INSERT … ON CONFLICT DO NOTHING` on the create path; UPDATEs
are naturally idempotent. Failures surface as logged warnings, not thrown
errors — a bridge failure must never block a canonical write.

---

## 5. Field mapping

| `jobDispatches` | `contractor_booking_requests` |
|---|---|
| `id` | `id` (re-used so update-by-id is trivial) |
| `quoteId` | `quoteId` |
| `lockedToContractorId` | `contractorId` + `assignedContractorId` |
| `customerFullName` (fallback `customerFirstName`) | `customerName` |
| `customerPhone` | `customerPhone` |
| `scheduledDate` | `scheduledDate` |
| `status` (`pending`/`accepted`/`completed`/`cancelled`) | mapped to `assignmentStatus` + `status` (see §4) |
| `lockedAt` | `assignedAt` |
| `completedAt` | `completedAt` |
| `createdAt` | `createdAt` |
| `totalContractorPayPence`, `bondAmountPence`, `viewCount`, `tasks`, `mediaUrls`, `proposalSummary`, `preferredDates` | **dropped** — no legacy equivalent |
| `customerEmail`, `requestedSlot`, `description` | **mocked** with safe defaults (NULL / `'[v2 dispatch]'`) |

---

## 6. Edge cases

**Pre-accept broadcasts.** `jobDispatches` rows with
`lockedToContractorId IS NULL` are **not** bridged — legacy has no
concept of an unaccepted broadcast. Bridge fires on first accept
(upsert: insert-as-accepted).

**Day-pack dispatches.** When the solver assigns one Builder to N jobs,
`bridgeOnDayPackAssigned` writes **N** legacy rows (one per job). Pack
identity is lost on the legacy side — the daily planner never modelled
packs.

**Cancellations.** Bridge sets `status='declined'` with `declineNotes`
describing the v2 cancellation cause. Legacy row is **never deleted** —
audit preservation.

**Concurrent writes.** Hand-edits in the daily planner racing a v2
lifecycle event resolve last-write-wins on overlapping columns. Risk
accepted; `FF_CONTROL_TOWER` hides the planner link to wind down
hand-edits.

**Quote-less dispatches.** Some jobDispatches are invoice-derived
(`quoteId=NULL`); legacy planner already tolerates this.

---

## 7. Phase 9 cutover

Steps, in order:

1. Set `FF_LEGACY_BRIDGE=0` in production env. Bridge writes stop.
2. Run `npx tsx server/migration/cutover-reconcile.ts`:
   - Iterate every `jobDispatches` row created in last 90 days.
   - For each, `SELECT` its mirror in `contractor_booking_requests`.
   - Diff status / scheduledDate / contractorId; report drift.
   - Identify orphan legacy rows (no matching dispatch) — likely
     hand-created via daily planner; offer a migrate-to-jobDispatches path.
3. Hide daily planner UI (`FF_CONTROL_TOWER` already does this; this step
   removes the route entirely from `client/src/App.tsx`).
4. After 30-day grace (no dispatcher complaints, no orphan growth):
   `DROP TABLE contractor_booking_requests CASCADE;`
5. Delete `server/migration/legacy-bridge.ts`, archive
   `data-backfill.ts` and `cutover-reconcile.ts` under
   `docs/archive/migration/` for audit. Remove all bridge call-sites
   from `server/contractor-dispatch.ts`.

---

## 8. Backfill scripts

Phase 0–1 backfill: **none.** Both tables already hold their pre-existing
production data. The shim starts mirroring fresh from Phase 2 onward;
old rows are not retroactively synced.

`backfillExistingDispatches.ts` is provided but not run by default —
opt-in for ops to retroactively surface a `jobDispatches` row in the
daily planner. Idempotent (`ON CONFLICT DO NOTHING`).

---

## 9. Tests

`tests/migration/legacy-bridge.test.ts`:

- Bridge fires on create / accept / complete / cancel transitions.
- Field mapping correct: insert sample `jobDispatch`, assert legacy row
  values column-by-column.
- Day-pack: 4 jobs in one pack produces 4 legacy rows.
- Pre-accept broadcast: `lockedToContractorId=NULL` produces no legacy row.
- `FF_LEGACY_BRIDGE=0`: every bridge fn is a no-op.
- Idempotency: calling `bridgeOnDispatchCreated` twice does not duplicate.
- Reconcile: synthesise drift (modify legacy row directly), assert
  `cutover-reconcile.ts` flags it.

---

## 10. Rollback

`FF_LEGACY_BRIDGE=1` is the safe default through Phases 1–8. Flipping to
`0` is the Phase 9 cutover. Reverting `0 → 1` after the table drop is
impossible. Reverting between flag-flip and drop is safe but leaves a
sync gap — backfill rows from the off-window before trusting legacy
reads again. The Phase 9 PR description must surface this warning.

---

## 11. Cross-references

- `adrs/adr-001-legacy-table.md` — the decision record (Option B → C).
- `modules/08-control-tower.md` — replaces the daily planner UI.
- `state-machine.md` — bridge fires on canonical state transitions, not
  on arbitrary writes.
- `feature-flags.md` — `FF_LEGACY_BRIDGE` row, dependency rules.
- `data-model.md` — confirms `contractor_booking_requests` is **not**
  modified by Wave 1 schema changes; it lives untouched until Phase 9.
