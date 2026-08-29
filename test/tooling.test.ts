import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffModels, formatDiffAsMarkdown, formatDiffAsText, isUnchanged } from '../src/core/diff.js';
import { deriveModel, parseDelimited, tableFromRows } from '../src/core/derive.js';
import { compareSchemas, detectDrift, parseSqlSchema } from '../src/core/drift.js';
import { checkPopulation, verbalizePopulation } from '../src/core/population.js';
import { mapToRelational } from '../src/core/rmap.js';
import { validateModel } from '../src/core/validate.js';
import { exportFbmFile, importFbmFile } from '../src/io/fbm.js';
import { populationSize } from '../src/model/model.js';
import { sampleModel } from '../src/model/sample.js';
import { Constraint, OrmModel } from '../src/model/types.js';

/** The sample model with a population that obeys every constraint on it. */
function populated(): OrmModel {
  const model = sampleModel();
  const works = model.factTypes.find((f) => f.id === 'ft_works')!;
  works.population = [
    { values: ['101', 'Acme'] },
    { values: ['102', 'Globex'] },
  ];
  const gender = model.factTypes.find((f) => f.id === 'ft_gender')!;
  gender.population = [{ values: ['101', 'M'] }, { values: ['102', 'F'] }];
  return model;
}

/* -------------------------------------------------------------------------- */
/* Populations                                                                 */
/* -------------------------------------------------------------------------- */

// @lat: [[tests#Populations#A clean population raises nothing]]
test('a population that obeys the constraints raises nothing', () => {
  assert.deepEqual(checkPopulation(populated()), []);
});

// @lat: [[tests#Populations#A repeated value breaks a uniqueness constraint]]
test('a repeated value is reported against the uniqueness constraint', () => {
  const model = populated();
  model.factTypes.find((f) => f.id === 'ft_works')!.population!.push({ values: ['101', 'Initech'] });
  const issues = checkPopulation(model);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'population-violates-uniqueness');
  assert.match(issues[0].message, /Rows 1 and 3/);
});

// @lat: [[tests#Populations#A value outside a value constraint is reported]]
test('a value outside the allowed set is reported', () => {
  const model = populated();
  model.factTypes.find((f) => f.id === 'ft_gender')!.population!.push({ values: ['103', 'X'] });
  const issues = checkPopulation(model);
  assert.ok(issues.some((i) => i.code === 'population-violates-value'), JSON.stringify(issues));
});

// @lat: [[tests#Populations#A row of the wrong width is reported]]
test('a row with the wrong number of values is reported', () => {
  const model = populated();
  model.factTypes.find((f) => f.id === 'ft_works')!.population!.push({ values: ['103'] });
  assert.ok(checkPopulation(model).some((i) => i.code === 'population-arity'));
});

// @lat: [[tests#Populations#Population problems reach the validator]]
test('population problems are reported by validateModel like any other issue', () => {
  const model = populated();
  model.factTypes.find((f) => f.id === 'ft_works')!.population!.push({ values: ['101', 'Initech'] });
  assert.ok(validateModel(model).some((i) => i.code === 'population-violates-uniqueness'));
});

// @lat: [[tests#Populations#Sample facts read back as sentences]]
test('sample facts are read back through the reading as sentences', () => {
  const model = populated();
  const works = model.factTypes.find((f) => f.id === 'ft_works')!;
  assert.deepEqual(verbalizePopulation(model, works), [
    '101 works for Acme',
    '102 works for Globex',
  ]);
});

// @lat: [[tests#Populations#Populations survive an FBM round trip]]
test('populations survive an export to FBM and back', () => {
  const model = populated();
  model.objectTypes.find((o) => o.id === 'ot_gender')!.population = ['M', 'F'];
  const back = importFbmFile(exportFbmFile(model).text).model;
  assert.equal(populationSize(back), populationSize(model));
  assert.deepEqual(back.factTypes[0].population?.[0].values, ['101', 'Acme']);
  assert.deepEqual(back.objectTypes.find((o) => o.name === 'GenderCode')?.population, ['M', 'F']);
});

/* -------------------------------------------------------------------------- */
/* Diff                                                                        */
/* -------------------------------------------------------------------------- */

// @lat: [[tests#Diff#An unchanged model produces no diff]]
test('a model compared with itself reports no change', () => {
  const diff = diffModels(sampleModel(), sampleModel());
  assert.ok(isUnchanged(diff));
  assert.match(formatDiffAsMarkdown(diff), /says exactly what it said before/);
});

// @lat: [[tests#Diff#A relaxed constraint reads as a changed sentence]]
test('relaxing a constraint reads as one changed sentence, not an add and a delete', () => {
  const before = sampleModel();
  const after = sampleModel();
  after.constraints = after.constraints.filter(
    (c) => !(c.kind === 'mandatory' && c.roles[0] === 'r_works_person'),
  );
  const diff = diffModels(before, after);
  const changed = diff.changes.filter((c) => c.kind === 'changed');
  assert.equal(changed.length, 1, formatDiffAsText(diff));
  assert.match(changed[0].before!, /works for exactly one Company/);
  assert.match(changed[0].after!, /works for at most one Company/);
});

// @lat: [[tests#Diff#The markdown report is a diff block with counts]]
test('the markdown report is a diff block with before and after counts', () => {
  const before = sampleModel();
  const after = sampleModel();
  after.objectTypes.push({ id: 'ot_new', name: 'Project', kind: 'entity', refMode: 'code' });
  const markdown = formatDiffAsMarkdown(diffModels(before, after));
  assert.match(markdown, /```diff/);
  assert.match(markdown, /\| Object types \| 5 \| 6 \|/);
});

/* -------------------------------------------------------------------------- */
/* Derivation                                                                  */
/* -------------------------------------------------------------------------- */

const CSV = [
  'employee_nr,first_name,department,start_date,active',
  '1001,Ada,Engineering,2021-03-01,true',
  '1002,Grace,Engineering,2019-07-15,true',
  '1003,Alan,Research,2022-11-02,false',
].join('\n');

// @lat: [[tests#Derivation#Delimited text is parsed including quoted fields]]
test('delimited text is parsed, including quoted fields and doubled quotes', () => {
  const rows = parseDelimited('a,b\n"x,1","he said ""hi"""\n');
  assert.deepEqual(rows, [['a', 'b'], ['x,1', 'he said "hi"']]);
});

// @lat: [[tests#Derivation#An identifying column becomes the reference mode]]
test('a unique, complete column becomes the reference mode rather than a fact type', () => {
  const { model, notes } = deriveModel(tableFromRows('employee', parseDelimited(CSV)));
  const employee = model.objectTypes.find((o) => o.name === 'Employee');
  assert.equal(employee?.refMode, 'nr', 'the entity name should not repeat inside its reference mode');
  assert.equal(employee?.dataType, 'integer');
  // Four columns remain, one fact type each; the identifier is not one of them.
  assert.equal(model.factTypes.length, 4);
  assert.ok(notes.some((n) => n.includes('reference mode')), notes.join(' | '));
});

// @lat: [[tests#Derivation#Data types and enumerations are inferred]]
test('data types and enumerations are inferred from the values', () => {
  const { model } = deriveModel(tableFromRows('employee', parseDelimited(CSV)));
  assert.equal(model.objectTypes.find((o) => o.name === 'StartDate')?.dataType, 'date');
  assert.equal(model.objectTypes.find((o) => o.name === 'Active')?.dataType, 'boolean');
  const department = model.objectTypes.find((o) => o.name === 'Department');
  const values = model.constraints.find(
    (c): c is Extract<Constraint, { kind: 'value' }> =>
      c.kind === 'value' && c.objectTypeId === department?.id,
  );
  assert.deepEqual(values?.ranges, [{ value: 'Engineering' }, { value: 'Research' }]);
});

// @lat: [[tests#Derivation#Uniqueness needs more than a handful of rows]]
test('a column distinct across only three rows is not proposed as unique', () => {
  const { model } = deriveModel(tableFromRows('employee', parseDelimited(CSV)));
  const firstName = model.objectTypes.find((o) => o.name === 'FirstName');
  const role = model.factTypes
    .flatMap((f) => f.roles)
    .find((r) => r.objectTypeId === firstName?.id);
  assert.ok(role);
  assert.ok(
    !model.constraints.some((c) => c.kind === 'uniqueness' && c.roles.length === 1 && c.roles[0] === role.id),
    'three distinct values is coincidence, not evidence of a constraint',
  );
});

// @lat: [[tests#Derivation#The derived model is populated and valid]]
test('the derived model carries the examples and validates cleanly', () => {
  const { model } = deriveModel(tableFromRows('employee', parseDelimited(CSV)));
  assert.equal(populationSize(model), 12); // 4 fact types x 3 rows
  assert.deepEqual(validateModel(model), []);
});

/* -------------------------------------------------------------------------- */
/* Drift                                                                       */
/* -------------------------------------------------------------------------- */

// @lat: [[tests#Drift#CREATE TABLE is parsed including multi-word types]]
test('CREATE TABLE is parsed, including multi-word types and inline keywords', () => {
  const [table] = parseSqlSchema(
    `-- a comment
     CREATE TABLE public."Person" (
       "personNr" integer NOT NULL,
       "companyName" character varying(255) NULL,
       created timestamp with time zone DEFAULT now(),
       amount numeric(10,2) NOT NULL,
       CONSTRAINT "PK_Person" PRIMARY KEY ("personNr")
     );`,
  );
  assert.equal(table.name, 'Person');
  assert.deepEqual(table.primaryKey, ['personNr']);
  assert.deepEqual(
    table.columns.map((c) => [c.name, c.type, c.nullable]),
    [
      ['personNr', 'integer', false],
      ['companyName', 'varchar(255)', true],
      ['created', 'timestamptz', true],
      ['amount', 'decimal(10,2)', false],
    ],
  );
});

// @lat: [[tests#Drift#A matching schema reports no drift]]
test('a database matching the model reports no drift', () => {
  const schema = mapToRelational(sampleModel());
  const existing = schema.tables.map((t) => ({
    name: t.name,
    columns: t.columns.map((c) => ({
      name: c.name,
      type: c.sqlType ?? typeOf(c.dataType, c.length),
      nullable: c.nullable,
    })),
    primaryKey: t.primaryKey,
  }));
  const report = compareSchemas(schema, existing);
  assert.deepEqual(report.items, []);
  assert.equal(report.compared, schema.tables.length);
});

function typeOf(dataType: string, length?: number): string {
  const base: Record<string, string> = {
    string: 'varchar', integer: 'integer', boolean: 'boolean', date: 'date',
    decimal: 'decimal', text: 'text', dateTime: 'timestamp',
  };
  return `${base[dataType] ?? 'varchar'}${length ? `(${length})` : ''}`;
}

// @lat: [[tests#Drift#Each kind of difference is reported]]
test('missing tables, missing columns and nullability differences are all reported', () => {
  const sql = `CREATE TABLE "Person" (
      "personNr" integer NOT NULL,
      "companyName" varchar(255) NULL,
      "nickname" text,
      CONSTRAINT pk PRIMARY KEY ("personNr")
    );
    CREATE TABLE audit_log (id integer NOT NULL);`;
  const report = detectDrift(sampleModel(), sql);
  const kinds = new Set(report.items.map((i) => i.kind));
  assert.ok(kinds.has('nullability'), 'companyName is mandatory in the model');
  assert.ok(kinds.has('missing-column'), 'genderCode is absent from the database');
  assert.ok(kinds.has('extra-column'), 'nickname is absent from the model');
  assert.ok(kinds.has('missing-table'), 'Company and Skill are absent from the database');
  assert.ok(kinds.has('extra-table'), 'audit_log is absent from the model');
});

// @lat: [[tests#Drift#Reconciling statements are emitted]]
test('drift comes with the statements that would reconcile it', () => {
  const sql = `CREATE TABLE "Person" ("personNr" integer NOT NULL, CONSTRAINT pk PRIMARY KEY ("personNr"));`;
  const report = detectDrift(sampleModel(), sql, { ignoreExtraTables: true });
  const sqlOut = report.statements.join('\n');
  assert.match(sqlOut, /ALTER TABLE "Person" ADD COLUMN "companyName"/);
  assert.match(sqlOut, /CREATE TABLE "Company"/);
});

// @lat: [[tests#Drift#Extra tables can be ignored]]
test('tables the model says nothing about can be ignored', () => {
  const sql = `CREATE TABLE unrelated (id integer NOT NULL);`;
  const withExtra = detectDrift(sampleModel(), sql);
  const without = detectDrift(sampleModel(), sql, { ignoreExtraTables: true });
  assert.ok(withExtra.items.some((i) => i.kind === 'extra-table'));
  assert.ok(!without.items.some((i) => i.kind === 'extra-table'));
});
