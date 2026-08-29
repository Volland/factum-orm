import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampleModel } from '../src/model/sample.js';
import { validateModel } from '../src/core/validate.js';

test('the starter model is error-free', () => {
  const issues = validateModel(sampleModel()).filter((issue) => issue.severity === 'error');
  assert.deepEqual(issues, []);
});

test('a fact type without a uniqueness constraint is an error', () => {
  const model = sampleModel();
  model.constraints = model.constraints.filter((c) => c.id !== 'uc_skill');
  const codes = validateModel(model).map((issue) => issue.code);
  assert.ok(codes.includes('missing-uniqueness'), codes.join(', '));
});

test('an internal uniqueness constraint must span at least n-1 roles', () => {
  const model = sampleModel();
  model.factTypes.push({
    id: 'ft_ternary',
    roles: [
      { id: 'r_t1', objectTypeId: 'ot_person' },
      { id: 'r_t2', objectTypeId: 'ot_company' },
      { id: 'r_t3', objectTypeId: 'ot_skill' },
    ],
    readings: [{ id: 'rd_t', roleOrder: ['r_t1', 'r_t2', 'r_t3'], text: '{0} used {2} at {1}', isPrimary: true }],
  });
  model.constraints.push({ id: 'uc_t', kind: 'uniqueness', roles: ['r_t1'] });
  const codes = validateModel(model).map((issue) => issue.code);
  assert.ok(codes.includes('uniqueness-too-narrow'), codes.join(', '));
});

test('an entity type with no reference scheme is reported', () => {
  const model = sampleModel();
  const company = model.objectTypes.find((o) => o.id === 'ot_company')!;
  company.refMode = undefined;
  const issue = validateModel(model).find((i) => i.code === 'no-reference-scheme');
  assert.equal(issue?.elementId, 'ot_company');
});

test('a subtype inherits identification, so it needs no reference mode', () => {
  const codes = validateModel(sampleModel())
    .filter((issue) => issue.elementId === 'ot_manager')
    .map((issue) => issue.code);
  assert.ok(!codes.includes('no-reference-scheme'), codes.join(', '));
});

test('subtype cycles are detected', () => {
  const model = sampleModel();
  model.subtypeRelations.push({ id: 'st_cycle', subtypeId: 'ot_person', supertypeId: 'ot_manager' });
  const codes = validateModel(model).map((issue) => issue.code);
  assert.ok(codes.includes('subtype-cycle'), codes.join(', '));
});

test('an unattached role is an error', () => {
  const model = sampleModel();
  model.factTypes[0].roles[1].objectTypeId = null;
  const codes = validateModel(model).map((issue) => issue.code);
  assert.ok(codes.includes('unattached-role'), codes.join(', '));
});

test('a reading with the wrong placeholder count is an error', () => {
  const model = sampleModel();
  model.factTypes[0].readings[0].text = '{0} works';
  const codes = validateModel(model).map((issue) => issue.code);
  assert.ok(codes.includes('reading-arity-mismatch'), codes.join(', '));
});
