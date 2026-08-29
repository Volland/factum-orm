import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';

/** Repository root, from the compiled tests in `out-test/test`. */
const root = join(__dirname, '..', '..');
import { parseModel, serializeModel } from '../src/model/model.js';
import { sampleModel } from '../src/model/sample.js';
import { LEGACY_SCHEMA_URLS, MODEL_FORMAT_VERSION, MODEL_SCHEMA_URL, OrmModel } from '../src/model/types.js';

const schema = JSON.parse(readFileSync(join(root, 'schema/orm-model-2.schema.json'), 'utf8'));

function validator() {
  // `strict: false` because the schema uses `format` purely as documentation.
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return ajv.compile(schema);
}

function explain(validate: ReturnType<typeof validator>): string {
  return (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`).join('\n');
}

// @lat: [[tests#File format#The sample model satisfies the published schema]]
test('the sample model satisfies the published schema', () => {
  const validate = validator();
  assert.ok(validate(JSON.parse(serializeModel(sampleModel()))), explain(validate));
});

// @lat: [[tests#File format#The shipped example satisfies the published schema]]
test('the shipped example satisfies the published schema', () => {
  const example = JSON.parse(readFileSync(join(root, 'examples/hr.orm.json'), 'utf8'));
  const validate = validator();
  assert.ok(validate(example), explain(validate));
});

// @lat: [[tests#File format#The schema rejects a misspelled key but allows an x- extension]]
test('the schema rejects a misspelled key but allows an x- extension', () => {
  const base = JSON.parse(serializeModel(sampleModel()));
  const validate = validator();

  assert.equal(validate({ ...base, objectTypess: [] }), false);

  assert.ok(
    validate({ ...base, 'x-factengine': { boston: true } }),
    explain(validate),
  );
});

// @lat: [[tests#File format#A version 1 file loads as version 2]]
test('a version 1 file loads as version 2 without losing anything', () => {
  const v1 = { version: 1, name: 'Legacy', objectTypes: [{ id: 'ot_a', name: 'A', kind: 'entity' }] };
  const model = parseModel(JSON.stringify(v1));
  assert.equal(model.version, MODEL_FORMAT_VERSION);
  assert.equal(model.name, 'Legacy');
  assert.equal(model.objectTypes[0].name, 'A');
});

// @lat: [[tests#File format#Unknown keys survive a round trip]]
test('unknown keys survive a round trip at every level', () => {
  const source = {
    $schema: MODEL_SCHEMA_URL,
    version: 2,
    name: 'Extended',
    'x-vendor': { tool: 'Boston' },
    meta: { guid: '8DAE1FE4-4D4E-477C-B90C-415ACCCF22A9', synonyms: ['Party'] },
    hints: { relational: { schemaName: 'hr' }, ossie: { dataset: 'PERSONS' } },
    objectTypes: [
      { id: 'ot_a', name: 'A', kind: 'entity', 'x-note': 'kept', meta: { description: 'An A.' } },
    ],
    factTypes: [],
    subtypeRelations: [],
    constraints: [],
    diagram: { shapes: {} },
  };
  const round = JSON.parse(serializeModel(parseModel(JSON.stringify(source)))) as Record<string, unknown>;
  assert.deepEqual(round['x-vendor'], { tool: 'Boston' });
  assert.deepEqual(round.meta, source.meta);
  assert.deepEqual(round.hints, source.hints);
  assert.deepEqual((round.objectTypes as Record<string, unknown>[])[0], source.objectTypes[0]);
});

// @lat: [[tests#File format#The published schema matches the one in the repository]]
test('the schema published on the docs site matches the one in the repository', () => {
  // `$schema` points at the docs site, so the copy served there is the contract
  // other tools compile against. A drifted copy would validate the wrong format.
  const source = readFileSync(join(root, 'schema/orm-model-2.schema.json'), 'utf8');
  const published = readFileSync(join(root, 'docs/schema/orm-model-2.schema.json'), 'utf8');
  assert.equal(published, source);
});

// @lat: [[tests#File format#The schema url resolves to the published copy]]
test('the schema URL the model declares resolves to the published copy', () => {
  const { $id } = JSON.parse(readFileSync(join(root, 'schema/orm-model-2.schema.json'), 'utf8'));
  assert.equal($id, MODEL_SCHEMA_URL);
  assert.ok(
    MODEL_SCHEMA_URL.endsWith('/schema/orm-model-2.schema.json'),
    'the published path must match the docs/schema layout',
  );
});

// @lat: [[tests#File format#A legacy schema url is upgraded on load]]
test('a document naming the schema at its old address is upgraded on load', () => {
  for (const legacy of LEGACY_SCHEMA_URLS) {
    const model = parseModel(JSON.stringify({ $schema: legacy, name: 'Old', objectTypes: [], factTypes: [] }));
    assert.equal(model.$schema, MODEL_SCHEMA_URL);
  }
  // Any other value is the caller's, and is left exactly as it was.
  const custom = parseModel('{"$schema":"https://example.org/mine.json","name":"X"}');
  assert.equal(custom.$schema, 'https://example.org/mine.json');
});

// @lat: [[tests#File format#A new model declares its schema and version]]
test('a new model declares its schema and format version', () => {
  const model: OrmModel = sampleModel();
  assert.equal(model.$schema, MODEL_SCHEMA_URL);
  assert.equal(model.version, MODEL_FORMAT_VERSION);
  assert.match(serializeModel(model), /^\{\n  "\$schema"/);
});
