/**
 * Derives a first-draft conceptual schema from a table of examples.
 *
 * This is step one of both Halpin's design procedure and FCO-IM: start from
 * concrete data, read it as elementary facts, and let the model follow. What
 * comes back is deliberately a draft — one entity type, one binary fact type
 * per column — because the modeller's job is to decide which of those columns
 * are really about something else. Nothing here guesses beyond what the data
 * shows: a constraint is proposed only when every row supports it.
 */

import {
  DataType,
  FactType,
  MODEL_SCHEMA_URL,
  ObjectType,
  OrmModel,
  ValueRange,
} from '../model/types.js';
import { emptyModel, newId } from '../model/model.js';

/** Below this many rows, "every value is distinct" is coincidence, not a constraint. */
const UNIQUENESS_EVIDENCE = 5;

/** The most distinct values a column may have and still look like an enumeration. */
const ENUM_LIMIT = 12;
/** A column with more distinct values than this fraction of rows is not an enumeration. */
const ENUM_RATIO = 0.4;

export interface Table {
  /** Becomes the entity type's name. */
  name: string;
  header: string[];
  rows: string[][];
}

export interface DeriveResult {
  model: OrmModel;
  /** What was assumed, so the modeller can check each one. */
  notes: string[];
}

/**
 * Parses delimited text. Handles quoted fields containing the delimiter,
 * doubled quotes, and CRLF; anything more exotic belongs in a real CSV library.
 */
export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Splits parsed rows into a header and a body. */
export function tableFromRows(name: string, rows: string[][]): Table {
  const [header = [], ...body] = rows;
  return { name, header: header.map((h) => h.trim()), rows: body };
}

export function deriveModel(table: Table): DeriveResult {
  const notes: string[] = [];
  const model = emptyModel(titleCase(table.name));
  model.$schema = MODEL_SCHEMA_URL;
  model.generator = { name: 'Factum example-first derivation' };

  const columns = table.header.map((name, position) => analyse(name, position, table.rows));
  if (!columns.length) {
    return { model, notes: ['The table has no columns, so nothing was derived.'] };
  }

  // The first complete, all-distinct column is the natural candidate identifier.
  const identifier = columns.find((c) => c.unique && c.complete);

  const entity: ObjectType = {
    id: newId('ot'),
    name: titleCase(table.name),
    kind: 'entity',
    // An identifying column is the entity's reference mode — `Employee(.nr)` —
    // not a fact type of its own, which would duplicate the identifier.
    ...(identifier
      ? { refMode: referenceMode(identifier.name, table.name), dataType: identifier.dataType }
      : {}),
    meta: { description: `Derived from ${table.rows.length} example row(s).` },
  };
  model.objectTypes.push(entity);

  if (identifier) {
    notes.push(
      `"${identifier.name}" is unique and never empty across all ${table.rows.length} rows, so it became the reference mode of ${entity.name}.`,
    );
  } else {
    notes.push(
      `No column is both unique and complete, so ${entity.name} has no reference scheme yet. Give it one before mapping the model.`,
    );
  }

  for (const column of columns) {
    // The identifying column is already the reference mode.
    if (column === identifier) continue;
    const valueType: ObjectType = {
      id: newId('vt'),
      name: titleCase(column.name),
      kind: 'value',
      dataType: column.dataType,
      ...(column.maxLength && column.dataType === 'string' ? { dataTypeLength: column.maxLength } : {}),
    };
    model.objectTypes.push(valueType);

    const entityRole = { id: newId('r'), objectTypeId: entity.id };
    const valueRole = { id: newId('r'), objectTypeId: valueType.id };
    const factType: FactType = {
      id: newId('ft'),
      roles: [entityRole, valueRole],
      readings: [
        {
          id: newId('rd'),
          roleOrder: [entityRole.id, valueRole.id],
          text: '{0} has {1}',
          isPrimary: true,
        },
        { id: newId('rd'), roleOrder: [valueRole.id, entityRole.id], text: '{0} is of {1}' },
      ],
      population: table.rows.map((row) => ({
        values: [rowKey(row, columns, identifier), emptyToNull(row[column.position])],
      })),
    };
    model.factTypes.push(factType);

    // Each row has one value for the column, so the entity role is functional.
    model.constraints.push({ kind: 'uniqueness', id: newId('uc'), roles: [entityRole.id] });
    // A column whose values are all distinct is unique in the other direction
    // too — but only propose that with enough rows for it to mean anything.
    if (column.unique && table.rows.length >= UNIQUENESS_EVIDENCE) {
      model.constraints.push({ kind: 'uniqueness', id: newId('uc'), roles: [valueRole.id] });
      notes.push(
        `"${column.name}" is distinct in all ${table.rows.length} rows, so its role was constrained unique as well. Confirm that holds beyond the examples.`,
      );
    }
    if (column.complete) {
      model.constraints.push({ kind: 'mandatory', id: newId('mc'), roles: [entityRole.id] });
    } else {
      notes.push(
        `"${column.name}" is empty in some rows, so its role was left optional.`,
      );
    }
    if (column.enumeration) {
      model.constraints.push({
        kind: 'value',
        id: newId('vc'),
        objectTypeId: valueType.id,
        ranges: column.enumeration,
      });
      notes.push(
        `"${column.name}" takes only ${column.enumeration.length} distinct value(s) in the examples, so a value constraint was proposed. Confirm the list is closed.`,
      );
    }
  }

  notes.push(
    `Every column became a binary fact type about ${entity.name}. Where a column is really about something else — a company, a category — split it into its own object type before going further.`,
  );
  return { model, notes };
}

interface Column {
  name: string;
  position: number;
  dataType: DataType;
  maxLength?: number;
  unique: boolean;
  complete: boolean;
  enumeration?: ValueRange[];
}

function analyse(name: string, position: number, rows: string[][]): Column {
  const values = rows.map((row) => (row[position] ?? '').trim());
  const filled = values.filter((v) => v !== '');
  const distinct = new Set(filled);

  const enumeration =
    filled.length > 0 &&
    distinct.size <= ENUM_LIMIT &&
    distinct.size <= Math.max(2, Math.ceil(filled.length * ENUM_RATIO)) &&
    distinct.size < filled.length
      ? [...distinct].sort().map((value) => ({ value }))
      : undefined;

  return {
    name: name || `Column${position + 1}`,
    position,
    dataType: inferDataType(filled),
    maxLength: filled.reduce((max, v) => Math.max(max, v.length), 0) || undefined,
    unique: filled.length > 0 && distinct.size === filled.length,
    complete: filled.length === values.length && values.length > 0,
    enumeration,
  };
}

/** The narrowest type every value in the column satisfies. */
function inferDataType(values: string[]): DataType {
  if (!values.length) return 'string';
  const every = (test: (v: string) => boolean): boolean => values.every(test);
  if (every((v) => /^(true|false|yes|no|y|n)$/i.test(v))) return 'boolean';
  if (every((v) => /^-?\d+$/.test(v))) return 'integer';
  if (every((v) => /^-?\d*\.\d+$/.test(v) || /^-?\d+$/.test(v))) return 'decimal';
  if (every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))) return 'date';
  if (every((v) => /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v))) return 'dateTime';
  if (every((v) => /^\d{2}:\d{2}(:\d{2})?$/.test(v))) return 'time';
  if (every((v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))) return 'guid';
  return 'string';
}

/** The entity's value in a row: its identifier where there is one, else the row number. */
function rowKey(row: string[], columns: Column[], identifier: Column | undefined): string {
  if (identifier) return (row[identifier.position] ?? '').trim();
  void columns;
  return '';
}

function emptyToNull(value: string | undefined): string | null {
  const text = (value ?? '').trim();
  return text === '' ? null : text;
}

/**
 * `employee_nr` on a table called `employee` is the reference mode `nr`, the
 * ORM convention — the entity's own name does not repeat inside its identifier.
 */
function referenceMode(column: string, tableName: string): string {
  const entity = titleCase(tableName).toLowerCase();
  const pascal = titleCase(column);
  const stripped = pascal.toLowerCase().startsWith(entity) ? pascal.slice(entity.length) : pascal;
  const name = stripped || pascal;
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function titleCase(value: string): string {
  const parts = value.replace(/[_\-.]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim().split(/\s+/);
  return parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('') || 'Unnamed';
}
