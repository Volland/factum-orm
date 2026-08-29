import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deleteElement, parseModel, serializeModel } from '../src/model/model.js';
import { sampleModel } from '../src/model/sample.js';

test('models round-trip through serialize and parse', () => {
  const model = sampleModel('Round Trip');
  assert.deepEqual(parseModel(serializeModel(model)), model);
});

test('parsing tolerates a minimal hand-written file', () => {
  const model = parseModel('{ "name": "Tiny" }');
  assert.equal(model.name, 'Tiny');
  assert.deepEqual(model.objectTypes, []);
  assert.deepEqual(model.diagram.shapes, {});
});

test('parsing reports invalid JSON', () => {
  assert.throws(() => parseModel('{ nope'), /Not valid JSON/);
});

test('deleting an object type detaches its roles and drops its links', () => {
  const model = sampleModel();
  deleteElement(model, 'ot_company');
  assert.ok(!model.objectTypes.some((o) => o.id === 'ot_company'));
  const works = model.factTypes.find((f) => f.id === 'ft_works')!;
  assert.equal(works.roles[1].objectTypeId, null);
  assert.equal(model.diagram.shapes['ot_company'], undefined);
});

test('deleting a fact type removes the constraints over its roles', () => {
  const model = sampleModel();
  deleteElement(model, 'ft_works');
  assert.ok(!model.constraints.some((c) => c.id === 'uc_works' || c.id === 'mc_works'));
  assert.ok(model.constraints.some((c) => c.id === 'uc_gender'));
});

test('deleting a supertype removes the subtype link', () => {
  const model = sampleModel();
  deleteElement(model, 'ot_person');
  assert.deepEqual(model.subtypeRelations, []);
});
