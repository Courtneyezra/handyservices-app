/**
 * Test-only stand-in for `server/db.ts`, for the redaction tests. It holds full rows, secrets
 * included, and answers a select with only the columns the query named, the way Postgres does, so
 * a test proves what a route's own column list lets out. It knows just enough of drizzle for
 * `requireAdmin`, the contractor desk source and the old `/api/admin/contractors/:id` read:
 * `select(fields).from(t).innerJoin/leftJoin/where/orderBy/limit/groupBy`, and
 * `query.<table>.findFirst({ columns, with })`. Filters are ignored: every row of the table answers.
 */
import { getTableColumns, getTableName, type Table } from 'drizzle-orm';
import {
  contractorBookingRequests,
  contractorSessions,
  handymanProfiles,
  handymanSkills,
  personalizedQuotes,
  users,
} from '../../shared/schema';

type Row = Record<string, unknown>;

export const fakeRows: Record<string, Row[]> = {};
export const fakeState: { sessionUserId: string | null } = { sessionUserId: null };

export function resetFakeRows(rows: Record<string, Row[]>, sessionUserId: string | null): void {
  for (const k of Object.keys(fakeRows)) delete fakeRows[k];
  Object.assign(fakeRows, rows);
  fakeState.sessionUserId = sessionUserId;
}

const rowsOf = (t: Table): Row[] => fakeRows[getTableName(t)] ?? [];

/** The row of `table` that a joined source row relates to (quote by quoteId, user by userId). */
function related(table: Table, base: Row, baseTable: Table): Row | undefined {
  if (table === baseTable) return base;
  if (table === users) return fakeRows.users?.find((u) => u.id === base.userId);
  if (table === personalizedQuotes) return fakeRows.personalized_quotes?.find((q) => q.id === base.quoteId);
  return undefined;
}

function project(fields: Record<string, any>, base: Row, baseTable: Table): Row {
  const out: Row = {};
  for (const [key, col] of Object.entries(fields)) {
    const table: Table | undefined = col?.table;
    if (!table) { out[key] = undefined; continue; } // a sql`` expression: not evaluated here
    const byName = Object.entries(getTableColumns(table)).find(([, c]) => c === col)?.[0];
    out[key] = byName ? related(table, base, baseTable)?.[byName] : undefined;
  }
  return out;
}

function selectChain(fields?: Record<string, any>) {
  let table: Table | null = null;
  const chain: any = {
    from(t: Table) { table = t; return chain; },
    then(resolve: (rows: Row[]) => unknown, reject?: (e: unknown) => unknown) {
      try {
        if (!table) return Promise.resolve([]).then(resolve, reject);
        if (table === contractorSessions) {
          const id = fakeState.sessionUserId;
          const rows = id ? [{ sessionToken: 't', userId: id, expiresAt: new Date(Date.now() + 3600_000) }] : [];
          return Promise.resolve(rows).then(resolve, reject);
        }
        const known = [handymanProfiles, contractorBookingRequests, handymanSkills] as Table[];
        if (!known.includes(table)) return Promise.resolve([]).then(resolve, reject);
        const base = rowsOf(table);
        const t = table;
        return Promise.resolve(fields ? base.map((r) => project(fields, r, t)) : base).then(resolve, reject);
      } catch (e) {
        return Promise.reject(e).then(resolve, reject);
      }
    },
  };
  for (const m of ['innerJoin', 'leftJoin', 'where', 'orderBy', 'limit', 'groupBy', 'offset']) chain[m] = () => chain;
  return chain;
}

function pickColumns(row: Row | undefined, columns?: Record<string, boolean>): Row | undefined {
  if (!row) return row;
  if (!columns) return { ...row };
  const includes = Object.entries(columns).filter(([, v]) => v).map(([k]) => k);
  if (includes.length > 0) return Object.fromEntries(includes.map((k) => [k, row[k]]));
  return Object.fromEntries(Object.entries(row).filter(([k]) => columns[k] !== false));
}

export const fakeDb: any = {
  select: (fields?: Record<string, any>) => selectChain(fields),
  query: {
    users: {
      findFirst: async () => fakeRows.users?.find((u) => u.id === fakeState.sessionUserId),
    },
    handymanProfiles: {
      findFirst: async (opts: { columns?: Record<string, boolean>; with?: Record<string, any> } = {}) => {
        const profile = fakeRows.handyman_profiles?.[0];
        if (!profile) return undefined;
        const out = pickColumns(profile, opts.columns)!;
        const w = opts.with ?? {};
        if (w.user) {
          const user = fakeRows.users?.find((u) => u.id === profile.userId);
          out.user = pickColumns(user, w.user === true ? undefined : w.user.columns);
        }
        if (w.skills) out.skills = (fakeRows.handyman_skills ?? []).filter((s) => s.handymanId === profile.id);
        return out;
      },
    },
  },
};
