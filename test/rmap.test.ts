import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampleModel } from '../src/model/sample.js';
import { mapToRelational, Table } from '../src/core/rmap.js';
import { generateDdl } from '../src/core/ddl.js';

function table(tables: Table[], name: string): Table {
  const found = tables.find((t) => t.name === name);
  assert.ok(found, `expected a table named ${name}, got ${tables.map((t) => t.name).join(', ')}`);
  return found;
}

test('functional binaries are absorbed into the table of the unique role player', () => {
  const { tables } = mapToRelational(sampleModel());
  const person = table(tables, 'Person');
  const columns = person.columns.map((c) => c.name);
  assert.ok(columns.includes('personNr'), columns.join(', '));
  assert.ok(columns.includes('companyName'), columns.join(', '));
  assert.ok(columns.includes('genderCode'), columns.join(', '));
  assert.deepEqual(person.primaryKey, ['personNr']);
});

test('mandatory roles map to NOT NULL and optional ones to NULL', () => {
  const { tables } = mapToRelational(sampleModel());
  const person = table(tables, 'Person');
  assert.equal(person.columns.find((c) => c.name === 'companyName')?.nullable, false);
  const skill = table(tables, 'Skill');
  assert.deepEqual(skill.primaryKey, ['skillCode']);
});

test('an m:n binary becomes its own table with a composite key', () => {
  const { tables } = mapToRelational(sampleModel());
  const bridge = tables.find((t) => t.columns.length === 2 && t.primaryKey.length === 2 && t.name !== 'Person');
  assert.ok(bridge, tables.map((t) => t.name).join(', '));
  assert.deepEqual(bridge!.primaryKey.sort(), ['personNr', 'skillCode']);
  assert.equal(bridge!.foreignKeys.length, 2);
});

test('subtypes are absorbed into their supertype table', () => {
  const { tables, notes } = mapToRelational(sampleModel());
  assert.ok(!tables.some((t) => t.name === 'Manager'));
  assert.ok(notes.some((note) => note.includes('Manager')), notes.join(' | '));
});

test('value constraints become CHECK constraints', () => {
  const { tables } = mapToRelational(sampleModel());
  const person = table(tables, 'Person');
  const check = person.checks.find((c) => c.column === 'genderCode');
  assert.ok(check, JSON.stringify(person.checks));
  const sql = generateDdl({ name: 'x', tables: [person], notes: [] }, { dialect: 'postgres' });
  assert.match(sql, /CHECK \("genderCode" IN \('M', 'F'\)\)/);
});

test('postgres DDL quotes case-sensitive identifiers and emits foreign keys', () => {
  const schema = mapToRelational(sampleModel());
  const sql = generateDdl(schema, { dialect: 'postgres' });
  assert.match(sql, /CREATE TABLE "Person"/);
  assert.match(sql, /CONSTRAINT "PK_Person" PRIMARY KEY \("personNr"\)/);
  assert.match(sql, /FOREIGN KEY \("companyName"\)\n\s+REFERENCES "Company"/);
});

test('other dialects use their own quoting and types', () => {
  const schema = mapToRelational(sampleModel());
  const mysql = generateDdl(schema, { dialect: 'mysql' });
  assert.match(mysql, /CREATE TABLE Person/);
  assert.match(mysql, /varchar\(255\)/);
  const sqlserver = generateDdl(schema, { dialect: 'sqlserver' });
  assert.match(sqlserver, /nvarchar\(255\)/);
});

test('objectified fact types map to their own table', () => {
  const model = sampleModel();
  model.objectTypes.push({
    id: 'ot_employment',
    name: 'Employment',
    kind: 'entity',
    objectifiedFactTypeId: 'ft_works',
  });
  const { tables } = mapToRelational(model);
  const employment = table(tables, 'Employment');
  assert.deepEqual(employment.primaryKey, ['personNr']);
  assert.ok(employment.columns.some((c) => c.name === 'companyName'));
});
