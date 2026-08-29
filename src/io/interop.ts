/**
 * Shared vocabulary for the model interchange converters.
 *
 * Every converter is deliberately tolerant in the same way the NORMA importer
 * is: unknown constructs are skipped and reported as warnings rather than
 * failing the whole conversion, because a partially-read model is more useful
 * to a modeller than an error message.
 */

import { DataType, OrmModel } from '../model/types.js';

/** The formats Factum can read and write besides its own. */
export type InteropFormat = 'norma' | 'fbm' | 'ossie' | 'ums';

export interface ImportResult {
  model: OrmModel;
  /** Constructs that were skipped, approximated or generated. */
  warnings: string[];
}

export interface ExportResult {
  text: string;
  /** Model content the target format cannot represent. */
  warnings: string[];
}

/**
 * Guesses the format of an interchange document from its file name, falling
 * back to a marker in the text because both YAML formats use `.yaml`.
 */
export function detectFormat(fileName: string, text: string): InteropFormat | undefined {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.fbm')) return 'fbm';
  if (lower.endsWith('.orm')) return 'norma';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) {
    if (/^\s*ModelElement\s*:/m.test(text)) return 'ums';
    if (/^\s*ontology\s*:/m.test(text)) return 'ossie';
    return undefined;
  }
  // An unhelpful extension still leaves the document's own root element.
  if (/<\s*(FBMModel|ORMModel)\b/.test(text) && /XSDVersionNr/.test(text)) return 'fbm';
  if (/<\s*\w*:?ORM2\b/.test(text)) return 'norma';
  if (/^\s*ModelElement\s*:/m.test(text)) return 'ums';
  if (/^\s*ontology\s*:/m.test(text)) return 'ossie';
  return undefined;
}

/** File extension and picker label for each format. */
export const FORMAT_INFO: Record<InteropFormat, { label: string; extension: string }> = {
  norma: { label: 'NORMA ORM 2 model', extension: 'orm' },
  fbm: { label: 'FBM Exchange MetaModel', extension: 'fbm' },
  ossie: { label: 'Apache Ossie ontology', extension: 'yaml' },
  ums: { label: 'Unified Modelling Schema', extension: 'yaml' },
};

/* -------------------------------------------------------------------------- */
/* Data types                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * NORMA and the FBM Exchange MetaModel share a data type vocabulary
 * (`TextFixedLength`, `NumericSignedInteger`, …), so one mapping serves both.
 */
export function dataTypeFromNorma(name: string): DataType {
  const key = name.toLowerCase();
  if (key.includes('autocounter') || key.includes('rowid')) return 'autoCounter';
  if (key.includes('money')) return 'money';
  if (key.includes('decimal')) return 'decimal';
  if (key.includes('float')) return 'float';
  if (key.includes('integer') || key.includes('numeric')) return 'integer';
  if (key.includes('dateandtime') || key.includes('timestamp')) return 'dateTime';
  if (key.includes('temporaldate')) return 'date';
  if (key.includes('temporaltime')) return 'time';
  if (key.includes('logical')) return 'boolean';
  if (key.includes('largelength') && key.includes('text')) return 'text';
  if (key.includes('text')) return 'string';
  if (key.includes('raw') || key.includes('picture') || key.includes('oleobject')) return 'binary';
  if (key.includes('uuid') || key.includes('guid') || key.includes('objectid')) return 'guid';
  return 'string';
}

/** The inverse of {@link dataTypeFromNorma}, for export. */
export function dataTypeToNorma(dataType: DataType | undefined, length?: number): string {
  switch (dataType) {
    case 'text': return 'TextLargeLength';
    case 'integer': return 'NumericSignedInteger';
    case 'decimal': return 'NumericDecimal';
    case 'float': return 'NumericFloatDoublePrecision';
    case 'money': return 'NumericMoney';
    case 'boolean': return 'LogicalTrueFalse';
    case 'date': return 'TemporalDate';
    case 'time': return 'TemporalTime';
    case 'dateTime': return 'TemporalDateAndTime';
    case 'guid': return 'OtherObjectID';
    case 'binary': return 'RawDataVariableLength';
    case 'autoCounter': return 'NumericAutoCounter';
    case 'string': return length ? 'TextFixedLength' : 'TextVariableLength';
    default: return 'DataTypeNotSet';
  }
}

/** Ossie and UMS both use a short, portable set of logical type names. */
export function dataTypeToPortable(dataType: DataType | undefined): string {
  switch (dataType) {
    case 'integer':
    case 'autoCounter': return 'Integer';
    case 'decimal':
    case 'money': return 'Decimal';
    case 'float': return 'Float';
    case 'boolean': return 'Boolean';
    case 'date': return 'Date';
    case 'time':
    case 'dateTime': return 'DateTime';
    default: return 'String';
  }
}

export function dataTypeFromPortable(name: string | undefined): DataType | undefined {
  switch ((name ?? '').toLowerCase()) {
    case 'integer': return 'integer';
    case 'decimal': return 'decimal';
    case 'float': return 'float';
    case 'boolean': return 'boolean';
    case 'date': return 'date';
    case 'datetime': return 'dateTime';
    case 'time': return 'time';
    case 'uuid': return 'guid';
    case 'binary': return 'binary';
    case 'textfixedlength':
    case 'textvariablelength':
    case 'string': return 'string';
    default: return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/* Names                                                                       */
/* -------------------------------------------------------------------------- */

/** A name usable as an identifier in YAML-based formats: `Person works for` → `PersonWorksFor`. */
export function pascalCase(value: string): string {
  const parts = value.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  return parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('') || 'Unnamed';
}

/** `Person works for` → `works_for`, the shape Ossie relationship names take. */
export function snakeCase(value: string): string {
  return (
    value
      .replace(/[^A-Za-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean)
      .join('_')
      .toLowerCase() || 'relates_to'
  );
}

/** Makes `base` unique against `used`, recording what it hands out. */
export function uniqueName(used: Set<string>, base: string): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  while (used.has(`${base}${n}`)) n += 1;
  const name = `${base}${n}`;
  used.add(name);
  return name;
}
