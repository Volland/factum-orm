/**
 * Compares the relational schema a model maps to against a schema that already
 * exists, and reports where the two have drifted apart.
 *
 * The existing schema is read from SQL text — a dump, a migration, or the
 * output of `pg_dump --schema-only` — rather than from a live connection, so
 * the check needs no database drivers and runs anywhere a file does. The parser
 * understands `CREATE TABLE` and nothing else, which is all this comparison
 * needs; everything it does not recognise is skipped rather than guessed at.
 */

import { OrmModel } from '../model/types.js';
import { Column, mapToRelational, RelationalSchema, Table } from './rmap.js';
import { quote, SqlDialect } from './ddl.js';

export type DriftKind =
  | 'missing-table'
  | 'extra-table'
  | 'missing-column'
  | 'extra-column'
  | 'nullability'
  | 'type'
  | 'primary-key';

export interface DriftItem {
  kind: DriftKind;
  table: string;
  column?: string;
  /** What the model says. */
  model?: string;
  /** What the database says. */
  database?: string;
  message: string;
}

export interface DriftReport {
  items: DriftItem[];
  /** Tables compared on both sides. */
  compared: number;
  /** `ALTER`/`CREATE` statements that would bring the database to the model. */
  statements: string[];
}

/* -------------------------------------------------------------------------- */
/* A very small CREATE TABLE reader                                            */
/* -------------------------------------------------------------------------- */

export interface ParsedColumn {
  name: string;
  type: string;
  nullable: boolean;
}

export interface ParsedTable {
  name: string;
  columns: ParsedColumn[];
  primaryKey: string[];
}

const CONSTRAINT_LEAD = /^(constraint\b|primary\s+key\b|unique\b|foreign\s+key\b|check\b|key\b|index\b)/i;

export function parseSqlSchema(sql: string): ParsedTable[] {
  const text = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');

  const tables: ParsedTable[] = [];
  const create = /create\s+table\s+(?:if\s+not\s+exists\s+)?([^\s(]+)\s*\(/gi;
  let match: RegExpExecArray | null;

  while ((match = create.exec(text)) !== null) {
    const body = balanced(text, create.lastIndex - 1);
    if (body === undefined) continue;
    const table: ParsedTable = { name: unquote(lastPart(match[1])), columns: [], primaryKey: [] };

    for (const part of splitTopLevel(body)) {
      const clause = part.trim();
      if (!clause) continue;
      if (CONSTRAINT_LEAD.test(clause)) {
        const pk = /primary\s+key\s*\(([^)]*)\)/i.exec(clause);
        if (pk) table.primaryKey = pk[1].split(',').map((c) => unquote(c.trim())).filter(Boolean);
        continue;
      }
      const column = readColumn(clause);
      if (!column) continue;
      table.columns.push(column);
      if (/\bprimary\s+key\b/i.test(clause)) table.primaryKey.push(column.name);
    }
    tables.push(table);
  }
  return tables;
}

function readColumn(clause: string): ParsedColumn | undefined {
  const name = /^("([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][\w$]*))/.exec(clause);
  if (!name) return undefined;
  const identifier = name[2] ?? name[3] ?? name[4] ?? name[5];
  const rest = clause.slice(name[0].length).trim();
  return {
    name: identifier,
    type: normalizeType(readType(rest)),
    // `NOT NULL` and a primary key both make the column required.
    nullable: !/\bnot\s+null\b/i.test(rest) && !/\bprimary\s+key\b/i.test(rest),
  };
}

/**
 * The type is everything before the first column-constraint keyword. A type can
 * contain spaces (`double precision`, `timestamp with time zone`), so it cannot
 * simply stop at the first one.
 */
const COLUMN_KEYWORD = /\b(not\s+null|null|primary\s+key|unique|default|references|check|constraint|generated|collate|auto_increment|identity|comment)\b/i;

function readType(rest: string): string {
  // Cut at the first constraint keyword, then read the size out of what's left.
  const stop = COLUMN_KEYWORD.exec(rest);
  const head = (stop ? rest.slice(0, stop.index) : rest).trim();
  const sized = /^([A-Za-z_][\w ]*?)\s*\(([^)]*)\)\s*$/.exec(head);
  return sized ? `${sized[1].trim()}(${sized[2].trim()})` : head;
}

/** Returns the text inside the parenthesis that starts at `open`. */
function balanced(text: string, open: number): string | undefined {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      const end = text.indexOf(ch, i + 1);
      if (end < 0) return undefined;
      i = end;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return undefined;
}

/** Splits on commas that are not inside parentheses or quotes. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "'" || ch === '"') {
      const end = body.indexOf(ch, i + 1);
      const chunk = end < 0 ? body.slice(i) : body.slice(i, end + 1);
      current += chunk;
      i += chunk.length - 1;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function lastPart(identifier: string): string {
  const parts = identifier.split('.');
  return parts[parts.length - 1];
}

function unquote(value: string): string {
  return value.replace(/^["'`[]|["'`\]]$/g, '');
}

/** Enough normalisation that `VARCHAR(255)` and `character varying(255)` agree. */
function normalizeType(type: string): string {
  const t = type.trim().toLowerCase().replace(/\s+/g, ' ');
  const base = t.replace(/\s*\(.*\)$/, '');
  const size = /\(([^)]*)\)/.exec(t)?.[1]?.replace(/\s+/g, '');
  const aliases: Record<string, string> = {
    'character varying': 'varchar',
    character: 'char',
    'double precision': 'double',
    int4: 'integer',
    int8: 'bigint',
    int: 'integer',
    bool: 'boolean',
    'timestamp without time zone': 'timestamp',
    'timestamp with time zone': 'timestamptz',
    numeric: 'decimal',
    number: 'decimal',
    text: 'text',
  };
  const normalized = aliases[base] ?? base;
  return size ? `${normalized}(${size})` : normalized;
}

/* -------------------------------------------------------------------------- */
/* Comparison                                                                  */
/* -------------------------------------------------------------------------- */

export interface DriftOptions {
  dialect?: SqlDialect;
  /** Ignore tables in the database that the model says nothing about. */
  ignoreExtraTables?: boolean;
}

export function detectDrift(model: OrmModel, sql: string, options: DriftOptions = {}): DriftReport {
  return compareSchemas(mapToRelational(model), parseSqlSchema(sql), options);
}

export function compareSchemas(
  schema: RelationalSchema,
  existing: ParsedTable[],
  options: DriftOptions = {},
): DriftReport {
  const dialect = options.dialect ?? 'postgres';
  const items: DriftItem[] = [];
  const statements: string[] = [];
  const byName = new Map(existing.map((t) => [t.name.toLowerCase(), t]));
  const seen = new Set<string>();
  let compared = 0;

  for (const table of schema.tables) {
    const found = byName.get(table.name.toLowerCase());
    if (!found) {
      items.push({
        kind: 'missing-table',
        table: table.name,
        model: table.name,
        message: `The model has table "${table.name}", the database does not.`,
      });
      statements.push(createTableStatement(table, dialect));
      continue;
    }
    seen.add(found.name.toLowerCase());
    compared += 1;
    compareTable(table, found, dialect, items, statements);
  }

  if (!options.ignoreExtraTables) {
    for (const table of existing) {
      if (seen.has(table.name.toLowerCase())) continue;
      items.push({
        kind: 'extra-table',
        table: table.name,
        database: table.name,
        message: `The database has table "${table.name}", the model says nothing about it.`,
      });
    }
  }

  return { items, compared, statements };
}

function compareTable(
  table: Table,
  existing: ParsedTable,
  dialect: SqlDialect,
  items: DriftItem[],
  statements: string[],
): void {
  const byName = new Map(existing.columns.map((c) => [c.name.toLowerCase(), c]));

  for (const column of table.columns) {
    const found = byName.get(column.name.toLowerCase());
    if (!found) {
      items.push({
        kind: 'missing-column',
        table: table.name,
        column: column.name,
        model: columnType(column),
        message: `"${table.name}"."${column.name}" is in the model but not in the database.`,
      });
      statements.push(
        `ALTER TABLE ${quote(table.name, dialect)} ADD COLUMN ${quote(column.name, dialect)} ${columnType(column)}${column.nullable ? '' : ' NOT NULL'};`,
      );
      continue;
    }
    const wanted = normalizeType(columnType(column));
    if (wanted !== found.type && !typesAgree(wanted, found.type)) {
      items.push({
        kind: 'type',
        table: table.name,
        column: column.name,
        model: wanted,
        database: found.type,
        message: `"${table.name}"."${column.name}" is ${wanted} in the model and ${found.type} in the database.`,
      });
    }
    if (column.nullable !== found.nullable) {
      items.push({
        kind: 'nullability',
        table: table.name,
        column: column.name,
        model: column.nullable ? 'NULL' : 'NOT NULL',
        database: found.nullable ? 'NULL' : 'NOT NULL',
        message: column.nullable
          ? `"${table.name}"."${column.name}" is optional in the model but NOT NULL in the database.`
          : `"${table.name}"."${column.name}" is mandatory in the model but nullable in the database.`,
      });
      statements.push(
        `ALTER TABLE ${quote(table.name, dialect)} ALTER COLUMN ${quote(column.name, dialect)} ${column.nullable ? 'DROP' : 'SET'} NOT NULL;`,
      );
    }
  }

  const modelColumns = new Set(table.columns.map((c) => c.name.toLowerCase()));
  for (const column of existing.columns) {
    if (modelColumns.has(column.name.toLowerCase())) continue;
    items.push({
      kind: 'extra-column',
      table: table.name,
      column: column.name,
      database: column.type,
      message: `"${table.name}"."${column.name}" is in the database but not in the model.`,
    });
  }

  const modelKey = table.primaryKey.map((c) => c.toLowerCase()).join(', ');
  const existingKey = existing.primaryKey.map((c) => c.toLowerCase()).join(', ');
  if (modelKey && existingKey && modelKey !== existingKey) {
    items.push({
      kind: 'primary-key',
      table: table.name,
      model: table.primaryKey.join(', '),
      database: existing.primaryKey.join(', '),
      message: `"${table.name}" is keyed on (${table.primaryKey.join(', ')}) in the model and (${existing.primaryKey.join(', ')}) in the database.`,
    });
  }
}

/** Types agree when one omits a size the other states. */
function typesAgree(a: string, b: string): boolean {
  const base = (t: string): string => t.replace(/\(.*\)$/, '');
  return base(a) === base(b) && (!a.includes('(') || !b.includes('('));
}

function columnType(column: Column): string {
  if (column.sqlType) return column.sqlType;
  const sized = column.length ? `(${column.length}${column.scale ? `,${column.scale}` : ''})` : '';
  const base: Record<string, string> = {
    string: 'varchar', text: 'text', integer: 'integer', decimal: 'decimal',
    float: 'double', money: 'decimal', boolean: 'boolean', date: 'date',
    time: 'time', dateTime: 'timestamp', guid: 'uuid', binary: 'bytea',
    autoCounter: 'integer',
  };
  return `${base[column.dataType] ?? 'varchar'}${sized}`;
}

function createTableStatement(table: Table, dialect: SqlDialect): string {
  const columns = table.columns.map(
    (c) => `    ${quote(c.name, dialect)} ${columnType(c)}${c.nullable ? '' : ' NOT NULL'}`,
  );
  if (table.primaryKey.length) {
    columns.push(`    PRIMARY KEY (${table.primaryKey.map((c) => quote(c, dialect)).join(', ')})`);
  }
  return `CREATE TABLE ${quote(table.name, dialect)} (\n${columns.join(',\n')}\n);`;
}

/** The report as Markdown, for a pull request comment or a terminal. */
export function formatDriftAsMarkdown(report: DriftReport): string {
  if (!report.items.length) {
    return `### Schema drift\n\nThe database matches the model across ${report.compared} table(s).\n`;
  }
  const lines = [
    '### Schema drift',
    '',
    `${report.items.length} difference(s) across ${report.compared} compared table(s).`,
    '',
    '| | Table | Column | Model | Database |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const item of report.items) {
    lines.push(
      `| \`${item.kind}\` | ${item.table} | ${item.column ?? ''} | ${item.model ?? ''} | ${item.database ?? ''} |`,
    );
  }
  if (report.statements.length) {
    lines.push('', 'To bring the database to the model:', '', '```sql', ...report.statements, '```');
  }
  lines.push('');
  return lines.join('\n');
}
