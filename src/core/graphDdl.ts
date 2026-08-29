import { DataType, ValueRange } from '../model/types.js';
import { GraphProperty, GraphSchema, NodeTable, RelTable } from './lpg.js';

export interface GraphDdlOptions {
  /** Emit `IF NOT EXISTS` so the script can be re-run against a live database. */
  ifNotExists?: boolean;
  /** Include the explanatory comments; on by default. */
  includeComments?: boolean;
}

/**
 * LadybugDB property types. Ladybug has no TIME type, so a time of day is
 * stored as a STRING and flagged in the generated comment.
 */
const TYPE_MAP: Record<DataType, string> = {
  string: 'STRING',
  text: 'STRING',
  integer: 'INT64',
  decimal: 'DECIMAL',
  float: 'DOUBLE',
  money: 'DECIMAL(19, 4)',
  boolean: 'BOOLEAN',
  date: 'DATE',
  time: 'STRING',
  dateTime: 'TIMESTAMP',
  guid: 'UUID',
  binary: 'BLOB',
  autoCounter: 'SERIAL',
};

/** Generates LadybugDB Cypher DDL for a labeled property graph schema. */
export function generateGraphDdl(schema: GraphSchema, options: GraphDdlOptions = {}): string {
  const comments = options.includeComments !== false;
  const guard = options.ifNotExists ? 'IF NOT EXISTS ' : '';
  const out: string[] = [];

  if (comments) {
    out.push(
      `// Property graph schema generated from the ORM model "${schema.name}".`,
      '// Target: LadybugDB (Cypher DDL).',
      '//',
      '// Entity types become node tables, value types become properties unless they are',
      '// played many-to-many, binary fact types become relationship tables whose',
      '// multiplicity comes from their uniqueness constraints, and n-ary or objectified',
      '// fact types are reified into nodes linked to each role player.',
      '',
    );
    if (schema.notes.length) {
      out.push('// Mapping notes:');
      for (const note of schema.notes) out.push(`//   - ${note}`);
      out.push('');
    }
  }

  for (const node of schema.nodeTables) {
    out.push(renderNodeTable(node, guard, comments), '');
  }
  for (const rel of schema.relTables) {
    out.push(renderRelTable(rel, guard, comments), '');
  }

  if (comments && schema.unenforced.length) {
    out.push(
      '// ---------------------------------------------------------------------------',
      '// Constraints the schema cannot enforce. LadybugDB checks primary keys and',
      '// relationship multiplicities; the rules below must be upheld by the',
      '// application or by a validation query.',
      '// ---------------------------------------------------------------------------',
    );
    for (const constraint of schema.unenforced) {
      out.push(`//   [${constraint.kind}] ${constraint.text}`);
    }
    out.push('');
  }

  return out.join('\n');
}

function renderNodeTable(node: NodeTable, guard: string, comments: boolean): string {
  const lines: string[] = [];
  if (comments && node.comment) lines.push(`// ${node.comment}`);
  lines.push(`CREATE NODE TABLE ${guard}${node.name}(`);
  // The separating comma has to precede the trailing comment, or the comment
  // would swallow it and the statement would lose the separator.
  lines.push(
    node.properties
      .map((property, position) => {
        const separator = position < node.properties.length - 1 ? ',' : '';
        const { declaration, note } = renderProperty(property);
        const trailing = comments && note ? `  // ${note}` : '';
        return `    ${declaration}${separator}${trailing}`;
      })
      .join('\n'),
  );
  lines.push(');');
  return lines.join('\n');
}

function renderRelTable(rel: RelTable, guard: string, comments: boolean): string {
  const parts = rel.pairs.map((pair) => `FROM ${pair.from} TO ${pair.to}`);
  for (const property of rel.properties) parts.push(renderProperty(property).declaration);
  parts.push(rel.multiplicity);
  const comment = comments && rel.comment ? `// ${rel.comment}\n` : '';
  return `${comment}CREATE REL TABLE ${guard}${rel.name}(${parts.join(', ')});`;
}

function renderProperty(property: GraphProperty): { declaration: string; note: string } {
  const parts = [property.name, sqlType(property)];
  if (property.isPrimaryKey) parts.push('PRIMARY KEY');
  const notes: string[] = [];
  if (property.comment) notes.push(property.comment);
  if (property.isRequired && !property.isPrimaryKey) notes.push('mandatory');
  if (property.allowedValues?.length) notes.push(`values ${formatRanges(property.allowedValues)}`);
  if (property.dataType === 'time') notes.push('time of day; LadybugDB has no TIME type');
  return { declaration: parts.join(' '), note: notes.join('; ') };
}

function sqlType(property: GraphProperty): string {
  if (property.dataType === 'decimal') {
    return `DECIMAL(${property.length ?? 19}, ${property.scale ?? 2})`;
  }
  return TYPE_MAP[property.dataType];
}

function formatRanges(ranges: ValueRange[]): string {
  const parts = ranges.map((range) => {
    if (range.value !== undefined) return typeof range.value === 'number' ? String(range.value) : `'${range.value}'`;
    const min = range.min !== undefined ? String(range.min) : '';
    const max = range.max !== undefined ? String(range.max) : '';
    return `${min}..${max}`;
  });
  return `{${parts.join(', ')}}`;
}
