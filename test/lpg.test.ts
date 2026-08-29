import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampleModel } from '../src/model/sample.js';
import { GraphSchema, NodeTable, RelTable, mapToGraph } from '../src/core/lpg.js';
import { generateGraphDdl } from '../src/core/graphDdl.js';
import { OrmModel } from '../src/model/types.js';

function node(schema: GraphSchema, name: string): NodeTable {
  const found = schema.nodeTables.find((t) => t.name === name);
  assert.ok(found, `expected a node table ${name}, got ${schema.nodeTables.map((t) => t.name).join(', ')}`);
  return found;
}

function rel(schema: GraphSchema, name: string): RelTable {
  const found = schema.relTables.find((t) => t.name === name);
  assert.ok(found, `expected a rel table ${name}, got ${schema.relTables.map((t) => t.name).join(', ')}`);
  return found;
}

/** A student/course model with a ternary fact type and an objectified binary. */
function enrolmentModel(): OrmModel {
  return {
    version: 1,
    name: 'Enrolment',
    subtypeRelations: [],
    diagram: { shapes: {} },
    objectTypes: [
      { id: 'st', name: 'Student', kind: 'entity', refMode: 'nr', dataType: 'integer' },
      { id: 'co', name: 'Course', kind: 'entity', refMode: 'code', dataType: 'string' },
      { id: 'sem', name: 'Semester', kind: 'entity', refMode: 'code', dataType: 'string' },
      { id: 'gr', name: 'Grade', kind: 'value', dataType: 'string' },
      { id: 'enr', name: 'Enrolment', kind: 'entity', objectifiedFactTypeId: 'ft_enrol' },
    ],
    factTypes: [
      {
        id: 'ft_enrol',
        roles: [
          { id: 'r1', objectTypeId: 'st' },
          { id: 'r2', objectTypeId: 'co' },
        ],
        readings: [{ id: 'rd1', roleOrder: ['r1', 'r2'], text: '{0} enrolled in {1}', isPrimary: true }],
      },
      {
        id: 'ft_res',
        roles: [
          { id: 'r3', objectTypeId: 'st' },
          { id: 'r4', objectTypeId: 'co' },
          { id: 'r5', objectTypeId: 'sem' },
          { id: 'r6', objectTypeId: 'gr' },
        ],
        readings: [
          { id: 'rd2', roleOrder: ['r3', 'r4', 'r5', 'r6'], text: '{0} in {1} during {2} scored {3}', isPrimary: true },
        ],
      },
    ],
    constraints: [
      { id: 'uc1', kind: 'uniqueness', roles: ['r1', 'r2'] },
      { id: 'uc2', kind: 'uniqueness', roles: ['r3', 'r4', 'r5'] },
      { id: 'mc1', kind: 'mandatory', roles: ['r3'] },
    ],
  };
}

test('entity types become node tables keyed by their reference mode', () => {
  const schema = mapToGraph(sampleModel());
  const person = node(schema, 'Person');
  const key = person.properties.find((p) => p.isPrimaryKey);
  assert.equal(key?.name, 'nr');
  assert.equal(key?.dataType, 'integer');
  assert.equal(person.isReified, false);
});

test('a lexical value type folds into the node as a property, not a node of its own', () => {
  const schema = mapToGraph(sampleModel());
  const person = node(schema, 'Person');
  const gender = person.properties.find((p) => p.name === 'genderCode');
  assert.ok(gender, person.properties.map((p) => p.name).join(', '));
  assert.equal(gender!.isRequired, true);
  assert.deepEqual(gender!.allowedValues, [{ value: 'M' }, { value: 'F' }]);
  assert.equal(schema.nodeTables.some((t) => t.name === 'GenderCode'), false);
});

test('uniqueness constraints determine the relationship multiplicity', () => {
  const schema = mapToGraph(sampleModel());
  // Each Person works for at most one Company: the Company end is the "one" end.
  assert.equal(rel(schema, 'WORKS_FOR').multiplicity, 'MANY_ONE');
  // Person has Skill carries only a spanning uniqueness constraint.
  assert.equal(rel(schema, 'HAS').multiplicity, 'MANY_MANY');
});

test('a one-to-one binary maps to ONE_ONE', () => {
  const model = sampleModel();
  model.constraints.push({ id: 'uc_company_side', kind: 'uniqueness', roles: ['r_works_company'] });
  assert.equal(rel(mapToGraph(model), 'WORKS_FOR').multiplicity, 'ONE_ONE');
});

test('an n-ary fact type is reified into a node with one relationship per role', () => {
  const schema = mapToGraph(enrolmentModel());
  const reified = schema.nodeTables.find((t) => t.isReified && t.name.startsWith('StudentIn'));
  assert.ok(reified, schema.nodeTables.map((t) => t.name).join(', '));
  assert.equal(reified!.properties[0].isPrimaryKey, true);
  assert.equal(reified!.properties[0].dataType, 'autoCounter');
  for (const roleRel of ['HAS_STUDENT', 'HAS_COURSE', 'HAS_SEMESTER', 'HAS_GRADE']) {
    const table = rel(schema, roleRel);
    assert.equal(table.multiplicity, 'MANY_ONE');
    assert.ok(table.pairs.some((pair) => pair.from === reified!.name));
  }
  assert.ok(schema.notes.some((note) => note.includes('4-ary')), schema.notes.join(' | '));
});

test('an objectified fact type becomes a node named after the objectifying type', () => {
  const schema = mapToGraph(enrolmentModel());
  const enrolment = node(schema, 'Enrolment');
  assert.equal(enrolment.isReified, true);
  assert.ok(rel(schema, 'HAS_STUDENT').pairs.some((pair) => pair.from === 'Enrolment'));
});

test('role links to the same player merge into one table with several endpoint pairs', () => {
  const schema = mapToGraph(enrolmentModel());
  const student = rel(schema, 'HAS_STUDENT');
  assert.equal(student.pairs.length, 2);
  assert.deepEqual(
    student.pairs.map((pair) => pair.to),
    ['Student', 'Student'],
  );
});

test('a value type played in an n-ary fact type is promoted to a node', () => {
  const schema = mapToGraph(enrolmentModel());
  node(schema, 'Grade');
  assert.ok(schema.notes.some((note) => note.includes('Grade')), schema.notes.join(' | '));
});

test('subtypes get their own label and an IS_A relationship by default', () => {
  const schema = mapToGraph(sampleModel());
  const manager = node(schema, 'Manager');
  assert.equal(manager.properties.find((p) => p.isPrimaryKey)?.name, 'nr');
  const isA = rel(schema, 'IS_A_PERSON');
  assert.deepEqual(isA.pairs, [{ from: 'Manager', to: 'Person' }]);
  assert.equal(isA.multiplicity, 'ONE_ONE');
});

test('the absorb strategy folds subtypes into the supertype node', () => {
  const schema = mapToGraph(sampleModel(), { subtypeStrategy: 'absorb' });
  assert.equal(schema.nodeTables.some((t) => t.name === 'Manager'), false);
  assert.equal(schema.relTables.some((t) => t.name.startsWith('IS_A')), false);
  assert.ok(schema.notes.some((note) => note.includes('Manager')), schema.notes.join(' | '));
});

test('constraints the schema cannot hold are reported, and enforced ones are not', () => {
  const schema = mapToGraph(sampleModel());
  const kinds = schema.unenforced.map((c) => c.kind);
  // Mandatory and value constraints have no schema-level equivalent.
  assert.ok(kinds.includes('mandatory'), kinds.join(', '));
  assert.ok(kinds.includes('value'), kinds.join(', '));
  // The uniqueness constraint that became MANY_ONE is enforced, so it is absent.
  assert.equal(schema.unenforced.some((c) => c.constraintId === 'uc_works'), false);
  // A spanning uniqueness on an m:n edge is not enforced by MANY_MANY.
  assert.ok(schema.unenforced.some((c) => c.constraintId === 'uc_skill'));
});

test('a uniqueness constraint over a reified fact type is reported as unenforced', () => {
  const schema = mapToGraph(enrolmentModel());
  assert.ok(schema.unenforced.some((c) => c.constraintId === 'uc1'), JSON.stringify(schema.unenforced));
  assert.ok(schema.unenforced.some((c) => c.constraintId === 'uc2'));
});

test('the generated DDL is valid LadybugDB Cypher', () => {
  const ddl = generateGraphDdl(mapToGraph(sampleModel()));
  assert.match(ddl, /CREATE NODE TABLE Person\(/);
  assert.match(ddl, /nr INT64 PRIMARY KEY,/);
  assert.match(ddl, /CREATE REL TABLE WORKS_FOR\(FROM Person TO Company, MANY_ONE\);/);
  // The separating comma must sit outside the trailing comment, or the comment
  // would swallow it. Every property line but the last one carries one.
  const start = ddl.indexOf('CREATE NODE TABLE Person(');
  const propertyLines = ddl
    .slice(start, ddl.indexOf(');', start))
    .split('\n')
    .slice(1)
    .filter((line) => line.trim().length);
  propertyLines.forEach((line, position) => {
    const code = line.split('//')[0].trimEnd();
    const isLast = position === propertyLines.length - 1;
    assert.equal(code.endsWith(','), !isLast, `separator wrong on: ${line}`);
  });
  assert.ok(propertyLines.length >= 2, ddl);
});

test('DDL types follow LadybugDB and IF NOT EXISTS is optional', () => {
  const model = sampleModel();
  model.objectTypes.push(
    { id: 'ot_t', name: 'Money', kind: 'value', dataType: 'money' },
    { id: 'ot_u', name: 'Ref', kind: 'value', dataType: 'guid' },
  );
  const plain = generateGraphDdl(mapToGraph(model));
  assert.doesNotMatch(plain, /IF NOT EXISTS/);
  const guarded = generateGraphDdl(mapToGraph(model), { ifNotExists: true });
  assert.match(guarded, /CREATE NODE TABLE IF NOT EXISTS Person\(/);
});

test('unenforced constraints are carried into the DDL as verbalized comments', () => {
  const ddl = generateGraphDdl(mapToGraph(sampleModel()));
  assert.match(ddl, /Constraints the schema cannot enforce/);
  assert.match(ddl, /\[mandatory\] It is necessary that each Person works for some Company\./);
});

test('a mandatory role of an absorbed subtype becomes an optional property', () => {
  const model = sampleModel();
  // Give the Manager subtype a fact type of its own, mandatory for managers.
  model.objectTypes.push({ id: 'ot_budget', name: 'Budget', kind: 'value', dataType: 'money' });
  model.factTypes.push({
    id: 'ft_budget',
    roles: [
      { id: 'r_b_mgr', objectTypeId: 'ot_manager' },
      { id: 'r_b_val', objectTypeId: 'ot_budget' },
    ],
    readings: [{ id: 'rd_b', roleOrder: ['r_b_mgr', 'r_b_val'], text: '{0} controls {1}', isPrimary: true }],
  });
  model.constraints.push(
    { id: 'uc_budget', kind: 'uniqueness', roles: ['r_b_mgr'] },
    { id: 'mc_budget', kind: 'mandatory', roles: ['r_b_mgr'] },
  );

  const own = mapToGraph(model);
  const manager = own.nodeTables.find((t) => t.name === 'Manager');
  assert.equal(manager?.properties.find((p) => p.name === 'budget')?.isRequired, true);

  const absorbed = mapToGraph(model, { subtypeStrategy: 'absorb' });
  const person = absorbed.nodeTables.find((t) => t.name === 'Person');
  const budget = person?.properties.find((p) => p.name === 'budget');
  assert.ok(budget, person?.properties.map((p) => p.name).join(', '));
  // Only managers control a budget, so the merged node cannot require it.
  assert.equal(budget!.isRequired, false);
  assert.ok(absorbed.notes.some((note) => note.includes('optional properties')), absorbed.notes.join(' | '));
});
