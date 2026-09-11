/**
 * Reading the target database's own shape, so the scrub is derived from the schema rather than
 * from a list somebody wrote down. Everything the scrub does is driven by what comes back here.
 */
import type { Client } from 'pg';
import { TEXTUAL_TYPES } from './plan';

export interface ColumnInfo {
    table: string;
    column: string;
    dataType: string;
    /** Element type when `dataType` is ARRAY, else null. */
    elementType: string | null;
    /** True when the column's type is a Postgres enum, which can only hold declared labels. */
    isEnum: boolean;
    /** True when the column is part of the table's primary key. */
    isPrimaryKey: boolean;
    /** True when the column is on either side of a foreign key, so its value must not move. */
    isForeignKey: boolean;
    /** Declared character limit, when the column has one. A synthetic value has to fit it. */
    maxLength: number | null;
}

export interface TableInfo {
    table: string;
    /** Primary-key columns in order; empty when the table has none. */
    primaryKey: string[];
    columns: ColumnInfo[];
}

const COLUMNS_SQL = `
  select c.table_name,
         c.column_name,
         c.data_type,
         c.ordinal_position,
         c.character_maximum_length,
         e.data_type                                as element_type,
         coalesce(t.typtype = 'e', false)           as is_enum
    from information_schema.columns c
    left join information_schema.element_types e
           on e.object_name = c.table_name
          and e.object_schema = c.table_schema
          and e.object_type = 'TABLE'
          and e.collection_type_identifier = c.dtd_identifier
    left join pg_type t on t.typname = c.udt_name
   where c.table_schema = 'public'
   order by c.table_name, c.ordinal_position`;

const KEY_SQL = `
  select tc.table_name, kcu.column_name, tc.constraint_type
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name
     and kcu.table_schema = tc.table_schema
   where tc.table_schema = 'public'
     and tc.constraint_type in ('PRIMARY KEY', 'FOREIGN KEY')`;

const PK_ORDER_SQL = `
  select tc.table_name, kcu.column_name, kcu.ordinal_position
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name
     and kcu.table_schema = tc.table_schema
   where tc.table_schema = 'public'
     and tc.constraint_type = 'PRIMARY KEY'
   order by tc.table_name, kcu.ordinal_position`;

/** Every table in `public`, with the key information the scrub needs to address a row. */
export async function readSchema(client: Client): Promise<TableInfo[]> {
    const [cols, keys, pks] = await Promise.all([
        client.query(COLUMNS_SQL),
        client.query(KEY_SQL),
        client.query(PK_ORDER_SQL),
    ]);

    const primaryKeys = new Set<string>();
    const foreignKeys = new Set<string>();
    for (const r of keys.rows) {
        const key = `${r.table_name}.${r.column_name}`;
        if (r.constraint_type === 'PRIMARY KEY') primaryKeys.add(key);
        else foreignKeys.add(key);
    }

    const pkOrder = new Map<string, string[]>();
    for (const r of pks.rows) {
        const list = pkOrder.get(r.table_name) ?? [];
        list.push(r.column_name);
        pkOrder.set(r.table_name, list);
    }

    const byTable = new Map<string, TableInfo>();
    for (const r of cols.rows) {
        let t = byTable.get(r.table_name);
        if (!t) {
            t = { table: r.table_name, primaryKey: pkOrder.get(r.table_name) ?? [], columns: [] };
            byTable.set(r.table_name, t);
        }
        t.columns.push({
            table: r.table_name,
            column: r.column_name,
            dataType: r.data_type,
            elementType: r.element_type ?? null,
            isEnum: r.is_enum === true,
            isPrimaryKey: primaryKeys.has(`${r.table_name}.${r.column_name}`),
            isForeignKey: foreignKeys.has(`${r.table_name}.${r.column_name}`),
            maxLength: r.character_maximum_length ?? null,
        });
    }
    return Array.from(byTable.values()).sort((a, b) => a.table.localeCompare(b.table));
}

/** The columns that can hold free text and therefore must be classified before a scrub may run. */
export function textualColumns(tables: TableInfo[]): ColumnInfo[] {
    return tables.flatMap((t) => t.columns.filter(needsClassification));
}

export function needsClassification(c: ColumnInfo): boolean {
    if (c.isEnum) return false;
    if (c.dataType === 'ARRAY') {
        // Only arrays of text can hold a name; an integer[] cannot.
        return c.elementType === 'text' || c.elementType === 'character varying' || c.elementType === 'character';
    }
    return TEXTUAL_TYPES.has(c.dataType);
}

/** How a row in this table is addressed. Falls back to `ctid` when the table has no primary key. */
export function rowKeyColumns(table: TableInfo): string[] {
    return table.primaryKey.length ? table.primaryKey : ['ctid'];
}
