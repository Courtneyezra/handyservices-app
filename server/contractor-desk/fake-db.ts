/**
 * Test-only stand-in for `server/db.ts`, for the contractor desk tests. It holds full rows, secrets
 * included, and answers a select with only the columns the query named, the way Postgres does, so
 * a test proves what a route's own column list lets out. It knows just enough of drizzle for
 * `requireAdmin`, the contractor desk sources, the contractor app's job loaders
 * (`server/contractor-jobs.ts`), the old `/api/admin/contractors/:id` read and `/api/handymen`:
 * `select(fields).from(t).innerJoin/leftJoin/where/orderBy/limit/groupBy`, and
 * `query.<table>.findFirst/findMany({ columns, with })`. A select's `where` is evaluated for
 * `and`, `or`, comparisons, `in`, `is (not) null` and a literal `like`, and throws on anything else;
 * ordering, limits and the `query.*` filters are ignored.
 */
import { getTableColumns, getTableName, SQL, type Table } from 'drizzle-orm';
import {
  bookingAssignments,
  contractorAvailabilityDates,
  contractorBookingRequests,
  contractorDiaryItems,
  contractorSessions,
  handymanAvailability,
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

/** The value of column `col` for a source row, following a join the way `project` does. */
function columnValue(col: any, base: Row, baseTable: Table): unknown {
  const table: Table = col.table;
  const byName = Object.entries(getTableColumns(table)).find(([, c]) => c === col)?.[0];
  return byName ? related(table, base, baseTable)?.[byName] : undefined;
}

const isColumn = (x: any): boolean => !!x && typeof x === 'object' && !!x.table && typeof x.name === 'string';
const paramValue = (x: any): unknown => (x && typeof x === 'object' && 'value' in x && x.constructor?.name === 'Param' ? x.value : x);

function compare(a: unknown, b: unknown): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  if (a instanceof Date || b instanceof Date) {
    const x = new Date(a as any).getTime();
    const y = new Date(b as any).getTime();
    return x === y ? 0 : x < y ? -1 : 1;
  }
  return a === b ? 0 : (a as any) < (b as any) ? -1 : 1;
}

/** Evaluate a drizzle condition against one source row. */
function matches(cond: unknown, base: Row, baseTable: Table): boolean {
  if (cond === undefined) return true;
  if (!(cond instanceof SQL)) throw new Error(`fake-db: unsupported condition ${String(cond)}`);
  const chunks = (cond as any).queryChunks.filter((c: any) => !(c?.constructor?.name === 'StringChunk' && c.value.join('') === ''));
  const text = (c: any): string | null => (c?.constructor?.name === 'StringChunk' ? c.value.join('') : null);
  if (text(chunks[0]) === '(' && text(chunks[chunks.length - 1]) === ')') return matches(new SQL(chunks.slice(1, -1)), base, baseTable);
  if (chunks.length === 1 && chunks[0] instanceof SQL) return matches(chunks[0], base, baseTable);
  const joiner = chunks.map(text).find((t: string | null) => t === ' and ' || t === ' or ');
  if (joiner) {
    const parts = chunks.filter((c: any) => text(c) !== joiner);
    return joiner === ' and ' ? parts.every((p: unknown) => matches(p, base, baseTable)) : parts.some((p: unknown) => matches(p, base, baseTable));
  }
  if (isColumn(chunks[0])) {
    const value = columnValue(chunks[0], base, baseTable);
    const op = text(chunks[1]);
    if (op === ' is null') return value === null || value === undefined;
    if (op === ' is not null') return value !== null && value !== undefined;
    if (op === ' in ' && Array.isArray(chunks[2])) return chunks[2].some((p: any) => compare(value, paramValue(p)) === 0);
    const like = op?.match(/^ like '([^']*)'$/);
    if (like) return typeof value === 'string' && new RegExp(`^${like[1].split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(value);
    const cmp = compare(value, paramValue(chunks[2]));
    if (cmp === null) return false;
    if (op === ' = ') return cmp === 0;
    if (op === ' <> ') return cmp !== 0;
    if (op === ' >= ') return cmp >= 0;
    if (op === ' > ') return cmp > 0;
    if (op === ' <= ') return cmp <= 0;
    if (op === ' < ') return cmp < 0;
  }
  throw new Error(`fake-db: unsupported condition shape ${chunks.map((c: any) => text(c) ?? (isColumn(c) ? `<${c.name}>` : typeof c)).join('')}`);
}

function selectChain(fields?: Record<string, any>) {
  let table: Table | null = null;
  let condition: unknown;
  const chain: any = {
    from(t: Table) { table = t; return chain; },
    where(c: unknown) { condition = c; return chain; },
    then(resolve: (rows: Row[]) => unknown, reject?: (e: unknown) => unknown) {
      try {
        if (!table) return Promise.resolve([]).then(resolve, reject);
        if (table === contractorSessions) {
          const id = fakeState.sessionUserId;
          const rows = id ? [{ sessionToken: 't', userId: id, expiresAt: new Date(Date.now() + 3600_000) }] : [];
          return Promise.resolve(rows).then(resolve, reject);
        }
        const known = [
          handymanProfiles, contractorBookingRequests, handymanSkills, personalizedQuotes, bookingAssignments,
          contractorDiaryItems, handymanAvailability, contractorAvailabilityDates,
        ] as Table[];
        if (!known.includes(table)) return Promise.resolve([]).then(resolve, reject);
        const t = table;
        const base = rowsOf(t).filter((r) => matches(condition, r, t));
        return Promise.resolve(fields ? base.map((r) => project(fields, r, t)) : base).then(resolve, reject);
      } catch (e) {
        return Promise.reject(e).then(resolve, reject);
      }
    },
  };
  for (const m of ['innerJoin', 'leftJoin', 'orderBy', 'limit', 'groupBy', 'offset']) chain[m] = () => chain;
  return chain;
}

function pickColumns(row: Row | undefined, columns?: Record<string, boolean>): Row | undefined {
  if (!row) return row;
  if (!columns) return { ...row };
  const includes = Object.entries(columns).filter(([, v]) => v).map(([k]) => k);
  if (includes.length > 0) return Object.fromEntries(includes.map((k) => [k, row[k]]));
  return Object.fromEntries(Object.entries(row).filter(([k]) => columns[k] !== false));
}

type ProfileQuery = { columns?: Record<string, boolean>; with?: Record<string, any> };

function profileWith(profile: Row, opts: ProfileQuery): Row {
  const out = pickColumns(profile, opts.columns)!;
  const w = opts.with ?? {};
  if (w.user) {
    const user = fakeRows.users?.find((u) => u.id === profile.userId);
    out.user = pickColumns(user, w.user === true ? undefined : w.user.columns);
  }
  if (w.skills) out.skills = (fakeRows.handyman_skills ?? []).filter((s) => s.handymanId === profile.id);
  if (w.availability) out.availability = (fakeRows.handyman_availability ?? []).filter((a) => a.handymanId === profile.id);
  return out;
}

export const fakeDb: any = {
  select: (fields?: Record<string, any>) => selectChain(fields),
  query: {
    users: {
      findFirst: async () => fakeRows.users?.find((u) => u.id === fakeState.sessionUserId),
    },
    handymanProfiles: {
      findFirst: async (opts: ProfileQuery = {}) => {
        const profile = fakeRows.handyman_profiles?.[0];
        return profile ? profileWith(profile, opts) : undefined;
      },
      findMany: async (opts: ProfileQuery = {}) =>
        (fakeRows.handyman_profiles ?? []).map((p) => profileWith(p, opts)),
    },
  },
};
