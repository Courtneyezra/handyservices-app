/**
 * The scrub itself: rewrite every identifying value on a target database to synthetic data.
 *
 * Run in five passes, in this order and for these reasons:
 *
 *   0 refuse    a production URL, or a run without the operator's explicit confirmation, stops
 *               here. So does a schema carrying a column the plan does not classify.
 *   1 collect   read the real identifiers out of the classified columns and allocate a reserved
 *               telephone number to each real one. Held in memory for the run and never written.
 *   2 rewrite   table by table, replace the classified values with synthetic ones.
 *   3 sweep     go back over every column the plan deliberately kept and replace any of the real
 *               strings collected in pass 1 that turn up in them. This is the belt: it catches a
 *               customer's name sitting in free text nobody classified.
 *   4 prove     scan every textual column twice over — once for the literal strings from pass 1,
 *               once for anything that still pattern-matches a real UK telephone number, e-mail
 *               address or postcode — and report what is left, by count.
 *
 * Nothing in this file prints, returns or stores a value it read from the database. The report is
 * table names, column names and counts.
 */
import type { Client } from 'pg';
import { isProductionDatabaseUrl, databaseHostOf } from '../worker-gate';
import { classify, REGENERATING_TREATMENTS, type Treatment } from './plan';
import { readSchema, textualColumns, needsClassification, rowKeyColumns, type ColumnInfo, type TableInfo } from './introspect';
import { Substitutions, residualsIn, type IdentifierKind } from './detect';
import { scrubScalar, EMPTY_SESSION, type ValueContext } from './values';
import { scrubJson } from './json-walk';
import {
    DRAMA_CAPACITY, dramaNumberAt, digest, fakeEmail, fakeFullName, fakePostcode, fakeTown,
    isSyntheticPhone, nationalDigits,
} from './synthetic';

const PAGE = 500;

export interface ScrubOptions {
    /** Postgres connection string for the target. Never logged. */
    connectionString: string;
    /** Anything; the same seed always produces the same synthetic database. */
    seed: string;
    /** The operator's explicit `--confirm`. Without it the run refuses. */
    confirmed: boolean;
    /** Read and report, write nothing. */
    dryRun?: boolean;
    /**
     * Run the residual scan. A dry run leaves it off by default, because nothing has been written
     * yet and the scan would only count the real data the operator already knows is there; --verify
     * turns it on precisely to audit a database somebody else scrubbed.
     */
    scanResiduals?: boolean;
    /**
     * The one account whose e-mail address and password hash survive, because the pipeline logs in
     * with it. Everything else about the account is still scrubbed. Read from the environment by
     * the CLI so the address itself never appears on a command line.
     */
    preserveLoginEmail?: string | null;
    log?: (line: string) => void;
}

export interface ColumnChange { column: string; treatment: Treatment; changed: number; }

export interface TableReport {
    table: string;
    rows: number;
    rowsChanged: number;
    columns: ColumnChange[];
}

export interface ResidualReport {
    column: string;
    /** Occurrences of a string this run knew to be real. Must be zero after a complete scrub. */
    literals: number;
    /** Occurrences that still look like a real identifier, by kind. */
    patterns: Partial<Record<IdentifierKind, number>>;
}

export interface ScrubReport {
    databaseHost: string | null;
    dryRun: boolean;
    tablesScanned: number;
    textualColumns: number;
    /** Distinct real telephone numbers seen, and how many synthetic ones the pools hold. */
    phonesAllocated: number;
    phoneCapacity: number;
    /** Distinct real strings the sweep hunted for, and the ambiguous tokens it declined to. */
    sweepTerms: number;
    sweepSkipped: number;
    tables: TableReport[];
    residuals: ResidualReport[];
    preservedLogin: boolean;
}

export class ScrubRefusal extends Error {}

/** Pass 0's first gate, kept separate so a caller can ask the question without connecting. */
export function refusalFor(opts: ScrubOptions): string | null {
    if (isProductionDatabaseUrl(opts.connectionString)) {
        return 'the target is the production database (server/worker-gate.ts recognised the production host marker)';
    }
    if (!opts.confirmed) {
        return 'this rewrites every identifying value on the target database; re-run with --confirm to proceed';
    }
    if (!opts.seed) return 'a --seed is required so the result is reproducible';
    return null;
}

/** Treatments whose real values are worth collecting for the sweep in pass 3. */
const COLLECTED: ReadonlySet<Treatment> = new Set<Treatment>([
    'person_name', 'first_name', 'last_name', 'business_name', 'phone', 'phone_e164', 'phone_key',
    'email', 'address', 'address_line', 'postcode', 'town',
]);

export async function scrubDatabase(client: Client, opts: ScrubOptions): Promise<ScrubReport> {
    const refusal = refusalFor(opts);
    if (refusal) throw new ScrubRefusal(refusal);

    const log = opts.log ?? (() => {});
    const dryRun = opts.dryRun === true;
    const seed = opts.seed;

    // ---- pass 0: the schema must be fully classified before anything is written
    const tables = await readSchema(client);
    const textual = textualColumns(tables);
    const unclassified = textual
        .filter((c) => classify(c.table, c.column) === null)
        .map((c) => `${c.table}.${c.column}`);
    if (unclassified.length) {
        throw new ScrubRefusal(
            `${unclassified.length} column(s) are not classified in server/scrub/plan.ts, so the scrub `
            + `cannot know whether they hold personal data: ${unclassified.join(', ')}`,
        );
    }
    log(`schema: ${tables.length} tables, ${textual.length} textual columns, all classified`);

    // ---- pass 1: collect the real identifiers and allocate synthetic telephone numbers
    const subs = new Substitutions();
    const phoneMap = new Map<string, string>();
    const preserveEmail = (opts.preserveLoginEmail ?? '').trim().toLowerCase() || null;

    const scrubbedBefore = await readMarker(client, seed);
    const force = !scrubbedBefore;
    log(force
        ? 'first scrub with this seed: every classified value is rewritten, nothing is assumed already synthetic'
        : 'already scrubbed with this seed: values that are already synthetic are left alone');

    await collectPhones(client, tables, seed, phoneMap);
    await collectOthers(client, tables, seed, subs, phoneMap, preserveEmail, force);
    log(`collected: ${phoneMap.size} telephone number(s), ${subs.size} sweep term(s)`);

    // ---- passes 2 and 3: rewrite, then sweep
    const reports: TableReport[] = [];
    for (const table of tables) {
        const report = await scrubTable(client, table, {
            seed, subs, phoneMap, dryRun, preserveEmail, force,
        });
        if (report.rowsChanged || report.columns.length) reports.push(report);
    }
    if (!dryRun) await writeMarker(client, seed);

    // ---- pass 4: prove it. A dry run has written nothing, so there is nothing to prove yet and
    // scanning would only report the real data the operator already knows is there.
    const scan = opts.scanResiduals ?? !dryRun;
    const residuals = scan ? await findResiduals(client, tables, subs, preserveEmail) : [];

    return {
        databaseHost: databaseHostOf(opts.connectionString),
        dryRun,
        tablesScanned: tables.length,
        textualColumns: textual.length,
        phonesAllocated: phoneMap.size,
        phoneCapacity: DRAMA_CAPACITY,
        sweepTerms: subs.size,
        sweepSkipped: subs.skipped.size,
        tables: reports,
        residuals,
        preservedLogin: !!preserveEmail,
    };
}

// ---------------------------------------------------------------------------- pass 1

interface RunState {
    seed: string;
    subs: Substitutions;
    phoneMap: Map<string, string>;
    dryRun: boolean;
    preserveEmail: string | null;
    force: boolean;
}

/** The `app_settings` row a completed scrub leaves behind, naming the seed it used. */
export const MARKER_KEY = 'scrub';

/**
 * Has this database been scrubbed with this seed before?
 *
 * It matters because several of the "already synthetic" checks are pool memberships rather than
 * proofs — a real customer called Ada Beeston would pass one. So the first scrub of a database
 * rewrites every classified value unconditionally, and only a later run with the same seed is
 * allowed to trust the checks and do nothing. A different seed means a different synthetic world,
 * so that counts as a first run too.
 */
async function readMarker(client: Client, seed: string): Promise<boolean> {
    try {
        const r = await client.query(
            `select value from app_settings where key = $1 limit 1`, [MARKER_KEY],
        );
        if (!r.rows.length) return false;
        const value = typeof r.rows[0].value === 'string' ? JSON.parse(r.rows[0].value) : r.rows[0].value;
        return value?.seed === seed;
    } catch {
        return false;
    }
}

async function writeMarker(client: Client, seed: string): Promise<void> {
    const value = JSON.stringify({ seed, scrubbedAt: new Date().toISOString() });
    await client.query(
        `insert into app_settings (id, key, value, description)
         values ($1, $2, $3::jsonb, $4)
         on conflict (key) do update set value = excluded.value, description = excluded.description`,
        [`scrub-${MARKER_KEY}`, MARKER_KEY, value,
            'Written by scripts/scrub-database.ts: this database holds synthetic data only.'],
    );
}

/**
 * Allocate one reserved drama number per distinct real number. Allocation walks the real numbers
 * in sorted order and probes forward on a collision, so the result is a pure function of the seed
 * and the set of real numbers, and the same customer keeps the same fake number everywhere.
 */
async function collectPhones(
    client: Client, tables: TableInfo[], seed: string, phoneMap: Map<string, string>,
): Promise<void> {
    const real = new Set<string>();
    for (const table of tables) {
        for (const col of table.columns) {
            if (!needsClassification(col)) continue;
            const t = classify(col.table, col.column);
            if (t !== 'phone' && t !== 'phone_e164' && t !== 'phone_key') continue;
            const r = await client.query(
                `select distinct ${ident(col.column)}::text as v from ${ident(table.table)} where ${ident(col.column)} is not null`,
            );
            for (const row of r.rows) {
                const raw = String(row.v ?? '');
                const stripped = t === 'phone_key' ? raw.replace(/^[a-z]+:/, '') : raw;
                if (isSyntheticPhone(stripped)) continue;
                const national = nationalDigits(stripped);
                if (national) real.add(national);
            }
        }
    }

    const taken = new Set<string>();
    for (const national of Array.from(real).sort()) {
        let index = digest(seed, 'phone', national) % DRAMA_CAPACITY;
        let candidate = dramaNumberAt(index);
        let probes = 0;
        while (taken.has(candidate) && probes < DRAMA_CAPACITY) {
            index += 1;
            candidate = dramaNumberAt(index);
            probes += 1;
        }
        if (taken.has(candidate)) {
            throw new ScrubRefusal(
                `the reserved telephone ranges hold ${DRAMA_CAPACITY} numbers and this database has `
                + `more distinct ones; add another Ofcom drama block to DRAMA_BLOCKS in server/scrub/synthetic.ts`,
            );
        }
        taken.add(candidate);
        phoneMap.set(national, candidate);
    }
}

/** Collect names, e-mail addresses, addresses, postcodes and towns, and their replacements. */
async function collectOthers(
    client: Client, tables: TableInfo[], seed: string, subs: Substitutions,
    phoneMap: Map<string, string>, preserveEmail: string | null, force: boolean,
): Promise<void> {
    phoneMap.forEach((fake, national) => subs.addPhone(national, fake));

    for (const table of tables) {
        for (const col of table.columns) {
            if (!needsClassification(col)) continue;
            if (col.dataType === 'json' || col.dataType === 'jsonb' || col.dataType === 'ARRAY') continue;
            const t = classify(col.table, col.column);
            if (!t || !COLLECTED.has(t) || t === 'phone' || t === 'phone_e164' || t === 'phone_key') continue;
            const r = await client.query(
                `select distinct ${ident(col.column)}::text as v from ${ident(table.table)} where ${ident(col.column)} is not null`,
            );
            for (const row of r.rows) {
                const raw = String(row.v ?? '').trim();
                if (!raw) continue;
                const ctx = { ...valueContext(seed, table.table, col.column, 'collect', subs, phoneMap), force };
                const fake = scrubScalar(t, raw, ctx);
                if (!fake || fake === raw) continue;
                if (t === 'person_name' || t === 'first_name' || t === 'last_name' || t === 'business_name') {
                    subs.addName(raw, fake);
                } else if (t === 'email') {
                    if (preserveEmail && raw.toLowerCase() === preserveEmail) continue;
                    subs.add(raw, fake);
                    subs.add(raw.toLowerCase(), fake);
                } else {
                    subs.add(raw, fake);
                    if (t === 'postcode') {
                        // The same postcode written with and without its space.
                        const squashed = raw.replace(/\s+/g, '');
                        const spaced = squashed.length > 3
                            ? `${squashed.slice(0, -3)} ${squashed.slice(-3)}` : squashed;
                        subs.add(squashed, fake.replace(/\s+/g, ''));
                        subs.add(spaced, fake);
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------- passes 2 and 3

async function scrubTable(client: Client, table: TableInfo, state: RunState): Promise<TableReport> {
    const treated = table.columns
        .filter(needsClassification)
        .map((c) => ({ col: c, treatment: classify(c.table, c.column)! }))
        // A kept column still goes through, because the sweep runs over it.
        .filter(({ treatment }) => treatment !== undefined);

    if (!treated.length) return { table: table.table, rows: 0, rowsChanged: 0, columns: [] };

    const keyCols = rowKeyColumns(table);
    const selectCols = Array.from(new Set(keyCols.concat(treated.map((t) => t.col.column))));
    const changedPerColumn = new Map<string, number>();
    let rows = 0;
    let rowsChanged = 0;

    // Which columns carry the row's own customer name and town, so invented prose reads as a thread.
    const nameCol = treated.find(({ treatment }) => treatment === 'person_name')?.col.column ?? null;
    const townCol = treated.find(({ treatment }) => treatment === 'town')?.col.column ?? null;
    const postcodeCol = treated.find(({ treatment }) => treatment === 'postcode')?.col.column ?? null;
    const emailCol = treated.find(({ treatment }) => treatment === 'email')?.col.column ?? null;

    for (let offset = 0; ; offset += PAGE) {
        const order = keyCols.map(ident).join(', ');
        const sql = `select ${selectCols.map(ident).join(', ')} from ${ident(table.table)} order by ${order} limit ${PAGE} offset ${offset}`;
        const page = await client.query(sql);
        if (!page.rows.length) break;
        rows += page.rows.length;

        for (const row of page.rows) {
            const rowKey = keyCols.map((k) => String(row[k] ?? '')).join('|');
            const preserveThisRow = table.table === 'users'
                && state.preserveEmail !== null
                && emailCol !== null
                && String(row[emailCol] ?? '').trim().toLowerCase() === state.preserveEmail;

            // Work out the row's synthetic name and town first: prose keyed on them reads better.
            const rowName = nameCol ? asText(row[nameCol]) : null;
            const rowTown = townCol ? asText(row[townCol])
                : postcodeCol ? asText(row[postcodeCol]) : null;
            const ctxBase = { ...valueContext(state.seed, table.table, '', rowKey, state.subs, state.phoneMap), force: state.force };
            const syntheticName = rowName
                ? scrubScalar('person_name', rowName, { ...ctxBase, column: nameCol! })
                : null;
            // Derive the town from the SCRUBBED postcode, not the real one. Keying it on the real
            // value would give a different town on a second run, once the column holds the fake
            // postcode, and the invented prose that mentions the town would change with it.
            const syntheticTown = !rowTown ? null
                : townCol ? scrubScalar('town', rowTown, { ...ctxBase, column: townCol })
                    : fakeTown(state.seed, 'town-of',
                        (scrubScalar('postcode', rowTown, { ...ctxBase, column: postcodeCol! }) ?? rowTown)
                            .replace(/\s+/g, '').toUpperCase());

            const sets: string[] = [];
            const params: unknown[] = [];

            for (const { col, treatment } of treated) {
                if (preserveThisRow && PRESERVED_LOGIN_COLUMNS.has(col.column)) continue;
                const before = row[col.column];
                if (before === null || before === undefined) continue;

                const ctx: ValueContext = {
                    ...ctxBase,
                    column: col.column,
                    rowName: syntheticName,
                    rowTown: syntheticTown,
                };

                const after = scrubColumnValue(col, treatment, before, ctx);
                if (after === undefined) continue;              // nothing to do
                changedPerColumn.set(col.column, (changedPerColumn.get(col.column) ?? 0) + 1);
                params.push(after);
                sets.push(`${ident(col.column)} = $${params.length}${castFor(col)}`);
            }

            if (!sets.length) continue;
            rowsChanged += 1;
            if (state.dryRun) continue;

            const where = keyCols.map((k, i) => `${ident(k)} = $${params.length + i + 1}`).join(' and ');
            params.push(...keyCols.map((k) => row[k]));
            await client.query(`update ${ident(table.table)} set ${sets.join(', ')} where ${where}`, params);
        }

        if (page.rows.length < PAGE) break;
    }

    const columns: ColumnChange[] = treated
        .filter(({ col }) => changedPerColumn.has(col.column))
        .map(({ col, treatment }) => ({
            column: col.column, treatment, changed: changedPerColumn.get(col.column)!,
        }))
        .sort((a, b) => b.changed - a.changed);

    return { table: table.table, rows, rowsChanged, columns };
}

/** Columns on the preserved administrator account that must survive, or the pipeline cannot log in. */
const PRESERVED_LOGIN_COLUMNS = new Set(['email', 'password']);

/**
 * The new value for one column of one row, or `undefined` when it is already what it should be.
 * Handles the three storage shapes separately: scalar text, a text array, and json.
 */
function scrubColumnValue(
    col: ColumnInfo, treatment: Treatment, before: unknown, ctx: ValueContext,
): unknown {
    if (col.dataType === 'json' || col.dataType === 'jsonb') {
        if (treatment === 'session_blob') {
            const current = typeof before === 'string' ? safeParse(before) : before;
            if (current && typeof current === 'object' && Object.keys(current).length === 1
                && 'cookie' in (current as object)) return undefined;
            return JSON.stringify(EMPTY_SESSION);
        }
        const parsed = typeof before === 'string' ? safeParse(before) : before;
        if (parsed === undefined) return undefined;
        const after = treatment === 'url_list'
            ? scrubUrlList(parsed, ctx)
            : scrubJson(parsed, ctx, [], 0);
        const a = JSON.stringify(after);
        const b = JSON.stringify(parsed);
        return a === b ? undefined : a;
    }

    if (col.dataType === 'ARRAY') {
        if (!Array.isArray(before)) return undefined;
        const after = before.map((v, i) => v === null ? v : fit(scrubScalar(
            treatment === 'url_list' ? 'url' : treatment,
            String(v),
            { ...ctx, column: `${ctx.column}.${i}` },
        ), col.maxLength));
        return JSON.stringify(after) === JSON.stringify(before) ? undefined : after;
    }

    const after = fit(scrubScalar(treatment, asText(before), ctx), col.maxLength);
    return after === asText(before) ? undefined : after;
}

/**
 * Keep a synthetic value inside the column's declared width. Several columns are narrow on
 * purpose — a twelve-character access code, a ten-character postcode — and a value that does not
 * fit would abort the whole scrub. Truncation is deterministic, so a second run produces the same
 * short value and still writes nothing.
 */
function fit(value: string | null, maxLength: number | null): string | null {
    if (value === null || maxLength === null || value.length <= maxLength) return value;
    return value.slice(0, maxLength);
}

function scrubUrlList(value: unknown, ctx: ValueContext): unknown {
    if (Array.isArray(value)) {
        return value.map((v, i) => typeof v === 'string'
            ? scrubScalar('url', v, { ...ctx, column: `${ctx.column}.${i}` })
            : scrubJson(v, ctx, [String(i)], 1));
    }
    return scrubJson(value, ctx, [], 0);
}

// ---------------------------------------------------------------------------- pass 4

async function findResiduals(
    client: Client, tables: TableInfo[], subs: Substitutions, preserveEmail: string | null,
): Promise<ResidualReport[]> {
    const out: ResidualReport[] = [];
    for (const table of tables) {
        for (const col of table.columns) {
            if (!needsClassification(col)) continue;
            let literals = 0;
            const patterns: Partial<Record<IdentifierKind, number>> = {};
            for (let offset = 0; ; offset += PAGE * 4) {
                const r = await client.query(
                    `select ${ident(col.column)}::text as v from ${ident(table.table)} `
                    + `where ${ident(col.column)} is not null limit ${PAGE * 4} offset ${offset}`,
                );
                if (!r.rows.length) break;
                for (const row of r.rows) {
                    const text = String(row.v ?? '');
                    if (!text) continue;
                    // The one administrator account the pipeline logs in with is deliberately left
                    // alone, so its address is not a leak and must not be counted as one.
                    const scanned = preserveEmail ? text.split(preserveEmail).join('') : text;
                    literals += subs.countIn(scanned);
                    for (const res of residualsIn(scanned)) {
                        patterns[res.kind] = (patterns[res.kind] ?? 0) + res.count;
                    }
                }
                if (r.rows.length < PAGE * 4) break;
            }
            if (literals || Object.keys(patterns).length) {
                out.push({ column: `${table.table}.${col.column}`, literals, patterns });
            }
        }
    }
    return out.sort((a, b) => (b.literals - a.literals)
        || (sumPatterns(b.patterns) - sumPatterns(a.patterns))
        || a.column.localeCompare(b.column));
}

export function sumPatterns(p: Partial<Record<IdentifierKind, number>>): number {
    return (p.phone ?? 0) + (p.email ?? 0) + (p.postcode ?? 0);
}

// ---------------------------------------------------------------------------- plumbing

function valueContext(
    seed: string, table: string, column: string, rowKey: string,
    subs: Substitutions, phoneMap: Map<string, string>,
): ValueContext {
    return {
        seed, table, column, rowKey, subs,
        phoneFor: (real: string) => phoneMap.get(real) ?? null,
    };
}

/** Quote an identifier. Every name here comes from information_schema, never from an operator. */
function ident(name: string): string {
    if (name === 'ctid') return 'ctid';
    return '"' + name.replace(/"/g, '""') + '"';
}

/** jsonb needs telling; everything else takes a text parameter. */
function castFor(col: ColumnInfo): string {
    if (col.dataType === 'jsonb') return '::jsonb';
    if (col.dataType === 'json') return '::json';
    return '';
}

function asText(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    return typeof v === 'string' ? v : String(v);
}

function safeParse(text: string): unknown {
    try { return JSON.parse(text); } catch { return undefined; }
}

/* These are re-exported so the CLI can describe the run without importing three modules. */
export { fakeEmail, fakeFullName, fakePostcode };
