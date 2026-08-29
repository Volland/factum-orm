import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateDdl } from '../src/core/ddl.js';
import { generateGraphDdl } from '../src/core/graphDdl.js';
import { mapToGraph } from '../src/core/lpg.js';
import { mapToRelational } from '../src/core/rmap.js';
import { sampleModel } from '../src/model/sample.js';
import { Annotated, Hints, OrmModel } from '../src/model/types.js';

/** The sample model with `hints` attached to one of its elements. */
function withHints(elementId: string, hints: Hints): OrmModel {
  const model = sampleModel();
  const element: Annotated | undefined =
    model.objectTypes.find((o) => o.id === elementId) ??
    model.factTypes.find((f) => f.id === elementId) ??
    model.factTypes.flatMap((f) => f.roles).find((r) => r.id === elementId);
  assert.ok(element, `no element ${elementId} in the sample model`);
  element.hints = hints;
  return model;
}

// @lat: [[tests#Schema generation hints#A table name hint renames the generated table]]
test('a relational table-name hint is used verbatim', () => {
  const { tables } = mapToRelational(withHints('ot_person', { relational: { tableName: 'HR_PERSON' } }));
  assert.ok(tables.some((t) => t.name === 'HR_PERSON'), tables.map((t) => t.name).join(', '));
  assert.ok(!tables.some((t) => t.name === 'Person'));
  // Foreign keys follow the renamed table.
  const referencing = tables.filter((t) => t.foreignKeys.some((fk) => fk.refTable === 'HR_PERSON'));
  assert.ok(referencing.length > 0);
});

// @lat: [[tests#Schema generation hints#Column name and SQL type hints reach the DDL]]
test('column-name and sqlType hints reach the generated DDL', () => {
  const model = withHints('ot_gender', {
    relational: { columnName: 'GENDER_CD', sqlType: 'CHAR(1)' },
  });
  const ddl = generateDdl(mapToRelational(model), { dialect: 'postgres' });
  assert.match(ddl, /"GENDER_CD" CHAR\(1\)/);
});

// @lat: [[tests#Schema generation hints#A schema name hint qualifies every table]]
test('a model-level schemaName hint qualifies every generated table', () => {
  const model = sampleModel();
  model.hints = { relational: { schemaName: 'hr' } };
  const ddl = generateDdl(mapToRelational(model), { dialect: 'postgres' });
  assert.match(ddl, /CREATE TABLE hr\."Person" \(/);
  assert.match(ddl, /REFERENCES hr\."/);
});

// @lat: [[tests#Schema generation hints#A separateTable hint overrides absorption]]
test('a separateTable hint stops a functional binary being absorbed', () => {
  const { tables } = mapToRelational(withHints('ft_works', { relational: { mapping: 'separateTable' } }));
  const person = tables.find((t) => t.name === 'Person');
  assert.ok(person && !person.columns.some((c) => c.name === 'companyName'), 'expected the column not to be absorbed');
  assert.ok(tables.length > 4, tables.map((t) => t.name).join(', '));
});

// @lat: [[tests#Schema generation hints#A graph label hint renames a node table]]
test('a graph label hint renames the node table and its relationships', () => {
  const schema = mapToGraph(withHints('ot_person', { graph: { label: 'Employee', labels: ['Party'] } }));
  const node = schema.nodeTables.find((n) => n.name === 'Employee');
  assert.ok(node, schema.nodeTables.map((n) => n.name).join(', '));
  assert.deepEqual(node.extraLabels, ['Party']);
  assert.ok(schema.relTables.every((r) => r.pairs.every((p) => p.from !== 'Person' && p.to !== 'Person')));
  assert.match(generateGraphDdl(schema), /\[labels\] also labelled Party/);
});

// @lat: [[tests#Schema generation hints#A graph property name hint renames an absorbed property]]
test('a graph propertyName hint renames an absorbed value property', () => {
  const schema = mapToGraph(withHints('ot_gender', { graph: { propertyName: 'gender' } }));
  const person = schema.nodeTables.find((n) => n.name === 'Person');
  assert.ok(person?.properties.some((p) => p.name === 'gender'), person?.properties.map((p) => p.name).join(', '));
});

// @lat: [[tests#Schema generation hints#A property mapping hint is refused when it would lose facts]]
test('a graph mapping hint of "property" is refused when the value is played many-to-many', () => {
  const model = sampleModel();
  const skill = model.objectTypes.find((o) => o.id === 'ot_skill');
  assert.ok(skill);
  skill.kind = 'value';
  skill.hints = { graph: { mapping: 'property' } };
  const schema = mapToGraph(model);
  assert.ok(schema.nodeTables.some((n) => n.name === 'Skill'), 'expected Skill to stay a node');
  assert.ok(schema.notes.some((n) => n.includes('refused') || n.includes('instead')), schema.notes.join(' | '));
});

// @lat: [[tests#Schema generation hints#Column comments do not swallow the separator]]
test('a column comment does not swallow the comma separating it from the next column', () => {
  const ddl = generateDdl(mapToRelational(sampleModel()));
  const body = ddl.split('\n').filter((line) => line.startsWith('    ') && line.includes('--'));
  assert.ok(body.length > 0, 'expected at least one commented column');
  for (const line of body) {
    const [declaration] = line.split('--');
    // The separator has to be in the code, not after the comment marker.
    assert.match(declaration, /,\s*$/, `separator lost inside the comment: ${line}`);
  }
  // Every column line except the last of its table must end in a separator.
  for (const statement of ddl.split('CREATE TABLE ').slice(1)) {
    const rows = statement.slice(statement.indexOf('(') + 1, statement.indexOf('\n);'))
      .split('\n')
      .filter((l) => l.trim());
    rows.slice(0, -1).forEach((row) => {
      assert.match(row.split('--')[0], /,\s*$/, `missing separator: ${row}`);
    });
    assert.doesNotMatch(rows[rows.length - 1].split('--')[0], /,\s*$/, 'trailing comma');
  }
});

// @lat: [[tests#Schema generation hints#A description becomes a generated comment]]
test('meta.description is emitted as the comment on generated schemas', () => {
  const model = sampleModel();
  const person = model.objectTypes.find((o) => o.id === 'ot_person');
  assert.ok(person);
  person.meta = { description: 'A human being known to the business.' };
  assert.match(generateDdl(mapToRelational(model)), /-- A human being known to the business\./);
  assert.match(generateGraphDdl(mapToGraph(model)), /\/\/ A human being known to the business\./);
});
