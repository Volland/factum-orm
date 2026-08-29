import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sampleModel } from '../src/model/sample.js';
import { verbalizeModel, verbalizeModelAsText } from '../src/core/verbalize.js';
import { OrmModel } from '../src/model/types.js';

function allLines(model: OrmModel): string[] {
  return verbalizeModel(model).flatMap((group) => group.lines.map((line) => line.text));
}

test('a mandatory functional binary reads as "exactly one"', () => {
  const lines = allLines(sampleModel());
  assert.ok(lines.includes('Each Person works for exactly one Company.'), lines.join('\n'));
});

test('an optional functional binary reads as "at most one"', () => {
  const model = sampleModel();
  model.constraints = model.constraints.filter((c) => c.id !== 'mc_works');
  const lines = allLines(model);
  assert.ok(lines.includes('Each Person works for at most one Company.'), lines.join('\n'));
});

test('an m:n binary verbalizes as a combination that occurs at most once', () => {
  const lines = allLines(sampleModel());
  assert.ok(
    lines.some((line) => line.includes('each Person, Skill combination occurs at most once')),
    lines.join('\n'),
  );
});

test('reference modes expand into their injective binary', () => {
  const lines = allLines(sampleModel());
  assert.ok(
    lines.includes('Each Person has exactly one PersonNr; each PersonNr refers to at most one Person.'),
    lines.join('\n'),
  );
});

test('subtypes and value constraints are verbalized', () => {
  const lines = allLines(sampleModel());
  assert.ok(lines.includes('Each Manager is a kind of Person.'), lines.join('\n'));
  assert.ok(
    lines.some((line) => line.includes("the possible values of GenderCode are {'M', 'F'}")),
    lines.join('\n'),
  );
});

test('the text rendering groups lines under headings', () => {
  const text = verbalizeModelAsText(sampleModel());
  assert.match(text, /^# New Model — verbalization/);
  assert.match(text, /## Person works for Company/);
});

test('ring constraints verbalize their ring types', () => {
  const model = sampleModel();
  model.factTypes.push({
    id: 'ft_reports',
    roles: [
      { id: 'r_rep_a', objectTypeId: 'ot_person' },
      { id: 'r_rep_b', objectTypeId: 'ot_person' },
    ],
    readings: [{ id: 'rd_rep', roleOrder: ['r_rep_a', 'r_rep_b'], text: '{0} reports to {1}', isPrimary: true }],
  });
  model.constraints.push(
    { id: 'uc_rep', kind: 'uniqueness', roles: ['r_rep_a'] },
    { id: 'rc_rep', kind: 'ring', roles: ['r_rep_a', 'r_rep_b'], types: ['irreflexive', 'acyclic'] },
  );
  const lines = allLines(model);
  assert.ok(
    lines.some((line) => line.includes('no Person is related to itself') && line.includes('no cycle of Persons')),
    lines.join('\n'),
  );
});
