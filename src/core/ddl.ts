import { DataType, ValueRange } from '../model/types.js';
import { Column, RelationalSchema, Table } from './rmap.js';

export type SqlDialect = 'postgres' | 'sqlserver' | 'mysql' | 'sqlite' | 'ansi';

export interface DdlOptions {
  dialect?: SqlDialect;
  /** Quote every identifier, even when it does not need it. */
  quoteIdentifiers?: boolean;
  /** Emit `DROP TABLE IF EXISTS` statements before the creates. */
  includeDrops?: boolean;
}

const TYPE_MAP: Record<SqlDialect, Record<DataType, string>> = {
  postgres: {
    string: 'varchar',
    text: 'text',
    integer: 'integer',
    decimal: 'numeric',
    float: 'double precision',
    money: 'numeric(19,4)',
    boolean: 'boolean',
    date: 'date',
    time: 'time',
    dateTime: 'timestamp',
    guid: 'uuid',
    binary: 'bytea',
    autoCounter: 'integer generated always as identity',
  },
  sqlserver: {
    string: 'nvarchar',
    text: 'nvarchar(max)',
    integer: 'int',
    decimal: 'decimal',
    float: 'float',
    money: 'money',
    boolean: 'bit',
    date: 'date',
    time: 'time',
    dateTime: 'datetime2',
    guid: 'uniqueidentifier',
    binary: 'varbinary(max)',
    autoCounter: 'int identity(1,1)',
  },
  mysql: {
    string: 'varchar',
    text: 'text',
    integer: 'int',
    decimal: 'decimal',
    float: 'double',
    money: 'decimal(19,4)',
    boolean: 'tinyint(1)',
    date: 'date',
    time: 'time',
    dateTime: 'datetime',
    guid: 'char(36)',
    binary: 'blob',
    autoCounter: 'int auto_increment',
  },
  sqlite: {
    string: 'text',
    text: 'text',
    integer: 'integer',
    decimal: 'numeric',
    float: 'real',
    money: 'numeric',
    boolean: 'integer',
    date: 'text',
    time: 'text',
    dateTime: 'text',
    guid: 'text',
    binary: 'blob',
    autoCounter: 'integer',
  },
  ansi: {
    string: 'VARCHAR',
    text: 'CLOB',
    integer: 'INTEGER',
    decimal: 'DECIMAL',
    float: 'DOUBLE PRECISION',
    money: 'DECIMAL(19,4)',
    boolean: 'BOOLEAN',
    date: 'DATE',
    time: 'TIME',
    dateTime: 'TIMESTAMP',
    guid: 'CHAR(36)',
    binary: 'BLOB',
    autoCounter: 'INTEGER',
  },
};

/** Sized types take a length; everything else ignores it. */
const SIZED: DataType[] = ['string', 'decimal'];

export function generateDdl(schema: RelationalSchema, options: DdlOptions = {}): string {
  const dialect = options.dialect ?? 'postgres';
  const out: string[] = [
    `-- Relational schema generated from the ORM model "${schema.name}".`,
    `-- Dialect: ${dialect}`,
    '',
  ];
  if (schema.notes.length) {
    out.push('-- Mapping notes:');
    for (const note of schema.notes) out.push(`--   ${note}`);
    out.push('');
  }

  if (options.includeDrops) {
    for (const table of [...schema.tables].reverse()) {
      out.push(`DROP TABLE IF EXISTS ${quote(table.name, dialect, options)};`);
    }
    out.push('');
  }

  for (const table of schema.tables) {
    out.push(renderTable(table, dialect, options));
    out.push('');
  }

  const alters = schema.tables.flatMap((table) =>
    table.foreignKeys.map(
      (fk) =>
        `ALTER TABLE ${quote(table.name, dialect, options)} ADD CONSTRAINT ${quote(
          truncate(fk.name),
          dialect,
          options,
        )}\n    FOREIGN KEY (${fk.columns.map((c) => quote(c, dialect, options)).join(', ')})\n    REFERENCES ${quote(
          fk.refTable,
          dialect,
          options,
        )} (${fk.refColumns.map((c) => quote(c, dialect, options)).join(', ')});`,
    ),
  );
  if (alters.length) {
    out.push('-- Foreign keys', ...alters, '');
  }

  return out.join('\n');
}

function renderTable(table: Table, dialect: SqlDialect, options: DdlOptions): string {
  const lines: string[] = [];
  if (table.comment) lines.push(`-- ${table.comment}`);
  lines.push(`CREATE TABLE ${quote(table.name, dialect, options)} (`);

  const body: string[] = table.columns.map((column) => `    ${renderColumn(column, dialect, options)}`);

  if (table.primaryKey.length) {
    body.push(
      `    CONSTRAINT ${quote(truncate(`PK_${table.name}`), dialect, options)} PRIMARY KEY (${table.primaryKey
        .map((c) => quote(c, dialect, options))
        .join(', ')})`,
    );
  }
  table.uniques.forEach((unique, position) => {
    body.push(
      `    CONSTRAINT ${quote(
        truncate(`UQ_${table.name}_${position + 1}`),
        dialect,
        options,
      )} UNIQUE (${unique.map((c) => quote(c, dialect, options)).join(', ')})`,
    );
  });
  for (const check of table.checks) {
    const expression = renderCheck(check.column, check.ranges, dialect, options);
    if (expression) {
      body.push(`    CONSTRAINT ${quote(truncate(check.name), dialect, options)} CHECK (${expression})`);
    }
  }

  lines.push(body.join(',\n'));
  lines.push(');');
  return lines.join('\n');
}

function renderColumn(column: Column, dialect: SqlDialect, options: DdlOptions): string {
  const parts = [quote(column.name, dialect, options), sqlType(column, dialect)];
  parts.push(column.nullable ? 'NULL' : 'NOT NULL');
  const comment = column.comment ? ` -- ${column.comment}` : '';
  return `${parts.join(' ')}${comment}`;
}

function sqlType(column: Column, dialect: SqlDialect): string {
  const base = TYPE_MAP[dialect][column.dataType];
  if (!SIZED.includes(column.dataType)) return base;
  if (column.dataType === 'decimal') {
    const precision = column.length ?? 19;
    const scale = column.scale ?? 2;
    return `${base}(${precision},${scale})`;
  }
  if (dialect === 'sqlite') return base;
  return `${base}(${column.length ?? 255})`;
}

function renderCheck(column: string, ranges: ValueRange[], dialect: SqlDialect, options: DdlOptions): string {
  const name = quote(column, dialect, options);
  const discrete = ranges.filter((r) => r.value !== undefined).map((r) => literal(r.value!));
  const intervals = ranges.filter((r) => r.value === undefined);
  const parts: string[] = [];
  if (discrete.length) parts.push(`${name} IN (${discrete.join(', ')})`);
  for (const range of intervals) {
    const bounds: string[] = [];
    if (range.min !== undefined) bounds.push(`${name} ${range.minInclusive === false ? '>' : '>='} ${literal(range.min)}`);
    if (range.max !== undefined) bounds.push(`${name} ${range.maxInclusive === false ? '<' : '<='} ${literal(range.max)}`);
    if (bounds.length) parts.push(bounds.length > 1 ? `(${bounds.join(' AND ')})` : bounds[0]);
  }
  return parts.join(' OR ');
}

function literal(value: string | number): string {
  return typeof value === 'number' ? String(value) : `'${value.replace(/'/g, "''")}'`;
}

const RESERVED = new Set([
  'order', 'user', 'group', 'table', 'select', 'from', 'where', 'index', 'key', 'value', 'values',
  'check', 'column', 'default', 'primary', 'foreign', 'references', 'constraint', 'date', 'time',
  'timestamp', 'year', 'month', 'day', 'level', 'role', 'end', 'start', 'name', 'type', 'desc',
]);

export function quote(identifier: string, dialect: SqlDialect, options: DdlOptions = {}): string {
  const lowercaseSafe = /^[a-z_][a-z0-9_]*$/.test(identifier);
  const asciiSafe = /^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier);
  const reserved = RESERVED.has(identifier.toLowerCase());
  // Postgres, SQLite and ANSI fold unquoted identifiers, so PascalCase needs quotes.
  const foldingDialect = dialect === 'postgres' || dialect === 'sqlite' || dialect === 'ansi';
  const needed = options.quoteIdentifiers || reserved || (foldingDialect ? !lowercaseSafe : !asciiSafe);
  if (!needed) return identifier;
  switch (dialect) {
    case 'mysql':
      return `\`${identifier.replace(/`/g, '``')}\``;
    case 'sqlserver':
      return `[${identifier.replace(/]/g, ']]')}]`;
    default:
      return `"${identifier.replace(/"/g, '""')}"`;
  }
}

function truncate(name: string): string {
  return name.length <= 63 ? name : `${name.slice(0, 60)}_${name.length}`;
}
