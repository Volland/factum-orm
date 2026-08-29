/**
 * Figures for the ORM 2 mini book. Every diagram is rendered by the extension's
 * own renderer, and every figure is also written to docs/models/ so a reader can
 * open the exact model in the editor.
 *
 *   npm run pretest && node scripts/build-figures.mjs
 */
import { defineModel, writeFigure } from './figure-lib.mjs';

/* Small helpers so each figure reads like the model it draws. */
const entity = (id, name, refMode, extra = {}) => ({ id, name, kind: 'entity', refMode, ...extra });
const value = (id, name, extra = {}) => ({ id, name, kind: 'value', dataType: 'string', ...extra });

function fact(id, players, text, extra = {}) {
  const roles = players.map((objectTypeId, index) => ({ id: `${id}.r${index}`, objectTypeId }));
  return {
    id,
    roles,
    readings: [{ id: `${id}.rd`, roleOrder: roles.map((r) => r.id), text, isPrimary: true }],
    ...extra,
  };
}
const role = (factId, index) => `${factId}.r${index}`;
const unique = (id, roles, extra = {}) => ({ id, kind: 'uniqueness', roles, ...extra });
const mandatory = (id, roles) => ({ id, kind: 'mandatory', roles });

const figures = [];
const figure = (slug, model, options) => figures.push(writeFigure(slug, model, options));

/* ------------------------------------------------------------ 1. an elementary fact */

figure('elementary-fact', defineModel({
  name: 'An elementary fact',
  objectTypes: [entity('person', 'Person', 'nr'), entity('company', 'Company', 'name')],
  factTypes: [fact('works', ['person', 'company'], '{0} works for {1}')],
  constraints: [unique('uc', [role('works', 0)]), mandatory('mc', [role('works', 0)])],
  shapes: {
    person: { x: 40, y: 60 },
    company: { x: 300, y: 60 },
    works: { x: 196, y: 68, orientation: 'horizontal' },
  },
}));

/* ------------------------------------------------- 2. splitting a compound fact type */

figure('compound-fact', defineModel({
  name: 'One fact type doing two jobs',
  objectTypes: [entity('person', 'Person', 'nr'), value('name', 'PersonName'), entity('company', 'Company', 'name')],
  factTypes: [fact('both', ['person', 'name', 'company'], '{0} named {1} works for {2}')],
  constraints: [unique('uc', [role('both', 0)])],
  shapes: {
    person: { x: 40, y: 60 },
    name: { x: 250, y: 0 },
    company: { x: 300, y: 120 },
    both: { x: 190, y: 68, orientation: 'horizontal' },
  },
}));

figure('elementary-split', defineModel({
  name: 'Split into elementary facts',
  objectTypes: [entity('person', 'Person', 'nr'), value('name', 'PersonName'), entity('company', 'Company', 'name')],
  factTypes: [
    fact('named', ['person', 'name'], '{0} is named {1}'),
    fact('works', ['person', 'company'], '{0} works for {1}'),
  ],
  constraints: [
    unique('uc1', [role('named', 0)]),
    mandatory('mc1', [role('named', 0)]),
    unique('uc2', [role('works', 0)]),
    mandatory('mc2', [role('works', 0)]),
  ],
  shapes: {
    person: { x: 40, y: 100 },
    name: { x: 300, y: 20 },
    company: { x: 300, y: 180 },
    named: { x: 200, y: 28, orientation: 'horizontal' },
    works: { x: 200, y: 188, orientation: 'horizontal' },
  },
}));

/* -------------------------------------------------- 3. entity types and value types */

figure('object-types', defineModel({
  name: 'Entity types and value types',
  objectTypes: [
    entity('person', 'Person', 'nr', { dataType: 'integer' }),
    value('gender', 'GenderCode', { dataTypeLength: 1 }),
    entity('room', 'Room', 'nr', { isIndependent: true }),
  ],
  factTypes: [
    fact('isof', ['person', 'gender'], '{0} is of {1}'),
    fact('occupies', ['person', 'room'], '{0} occupies {1}'),
  ],
  constraints: [
    unique('uc1', [role('isof', 0)]),
    mandatory('mc1', [role('isof', 0)]),
    unique('uc2', [role('occupies', 0)]),
    { id: 'vc', kind: 'value', objectTypeId: 'gender', ranges: [{ value: 'M' }, { value: 'F' }] },
  ],
  shapes: {
    person: { x: 40, y: 110 },
    gender: { x: 300, y: 30 },
    room: { x: 300, y: 190 },
    isof: { x: 200, y: 38, orientation: 'horizontal' },
    occupies: { x: 200, y: 198, orientation: 'horizontal' },
  },
}));


/* ----------------------------------------------------------------- 4. arity */

figure('arity', defineModel({
  name: 'Unary, binary and ternary fact types',
  objectTypes: [
    entity('person', 'Person', 'nr'),
    entity('company', 'Company', 'name'),
    entity('room', 'Room', 'nr'),
    entity('day', 'Day', 'code'),
    entity('emp', 'Employee', 'nr'),
  ],
  factTypes: [
    fact('smokes', ['person'], '{0} smokes'),
    fact('works', ['emp', 'company'], '{0} works for {1}'),
    fact('booked', ['emp', 'room', 'day'], '{0} booked {1} on {2}'),
  ],
  constraints: [
    unique('uc0', [role('smokes', 0)]),
    unique('uc1', [role('works', 0)]),
    unique('uc2', [role('booked', 1), role('booked', 2)]),
  ],
  shapes: {
    person: { x: 40, y: 20 },
    emp: { x: 40, y: 130 },
    company: { x: 330, y: 110 },
    room: { x: 330, y: 210 },
    day: { x: 330, y: 280 },
    smokes: { x: 200, y: 28, orientation: 'horizontal' },
    works: { x: 210, y: 118, orientation: 'horizontal' },
    booked: { x: 200, y: 220, orientation: 'horizontal' },
  },
}));

/* -------------------------------------------------------------- 5. readings */

figure('readings', defineModel({
  name: 'Two readings of one fact type',
  objectTypes: [entity('person', 'Person', 'nr'), entity('company', 'Company', 'name')],
  factTypes: [{
    id: 'works',
    roles: [{ id: 'works.r0', objectTypeId: 'person' }, { id: 'works.r1', objectTypeId: 'company' }],
    readings: [
      { id: 'rd1', roleOrder: ['works.r0', 'works.r1'], text: '{0} works for {1}', isPrimary: true },
      { id: 'rd2', roleOrder: ['works.r1', 'works.r0'], text: '{0} employs {1}' },
    ],
  }],
  constraints: [unique('uc', [role('works', 0)]), mandatory('mc', [role('works', 0)])],
  shapes: {
    person: { x: 40, y: 60 },
    company: { x: 300, y: 60 },
    works: { x: 196, y: 68, orientation: 'horizontal' },
  },
}));

/* ----------------------------------------------------- 6. uniqueness patterns */

const twoTypes = [entity('person', 'Person', 'nr'), entity('company', 'Company', 'name')];
const layout = {
  person: { x: 40, y: 60 },
  company: { x: 300, y: 60 },
  works: { x: 196, y: 68, orientation: 'horizontal' },
};

figure('uniqueness-n1', defineModel({
  name: 'Many to one',
  objectTypes: twoTypes,
  factTypes: [fact('works', ['person', 'company'], '{0} works for {1}')],
  constraints: [unique('uc', [role('works', 0)])],
  shapes: layout,
}));

figure('uniqueness-11', defineModel({
  name: 'One to one',
  objectTypes: twoTypes,
  factTypes: [fact('works', ['person', 'company'], '{0} heads {1}')],
  constraints: [unique('uc1', [role('works', 0)]), unique('uc2', [role('works', 1)])],
  shapes: layout,
}));

figure('uniqueness-mn', defineModel({
  name: 'Many to many',
  objectTypes: [entity('person', 'Person', 'nr'), entity('skill', 'Skill', 'code')],
  factTypes: [fact('has', ['person', 'skill'], '{0} has {1}')],
  constraints: [unique('uc', [role('has', 0), role('has', 1)])],
  shapes: {
    person: { x: 40, y: 60 },
    skill: { x: 300, y: 60 },
    has: { x: 196, y: 68, orientation: 'horizontal' },
  },
}));

/* The arity check: a uniqueness constraint that misses two roles means the
   fact type is splittable. */
figure('arity-check-bad', defineModel({
  name: 'A ternary that should be split',
  objectTypes: [entity('academic', 'Academic', 'nr'), entity('rank', 'Rank', 'code'), entity('dept', 'Dept', 'name')],
  factTypes: [fact('rankdept', ['academic', 'rank', 'dept'], '{0} of {1} works for {2}')],
  constraints: [unique('uc', [role('rankdept', 0)])],
  shapes: {
    academic: { x: 40, y: 100 },
    rank: { x: 330, y: 30 },
    dept: { x: 330, y: 170 },
    rankdept: { x: 210, y: 108, orientation: 'horizontal' },
  },
}));

figure('arity-check-good', defineModel({
  name: 'Split into two binaries',
  objectTypes: [entity('academic', 'Academic', 'nr'), entity('rank', 'Rank', 'code'), entity('dept', 'Dept', 'name')],
  factTypes: [
    fact('hasrank', ['academic', 'rank'], '{0} has {1}'),
    fact('works', ['academic', 'dept'], '{0} works for {1}'),
  ],
  constraints: [
    unique('uc1', [role('hasrank', 0)]), mandatory('mc1', [role('hasrank', 0)]),
    unique('uc2', [role('works', 0)]), mandatory('mc2', [role('works', 0)]),
  ],
  shapes: {
    academic: { x: 40, y: 100 },
    rank: { x: 330, y: 20 },
    dept: { x: 330, y: 180 },
    hasrank: { x: 220, y: 28, orientation: 'horizontal' },
    works: { x: 220, y: 188, orientation: 'horizontal' },
  },
}));

/* --------------------------------------------------- 7. mandatory constraints */

figure('mandatory', defineModel({
  name: 'Mandatory and optional roles',
  objectTypes: [entity('person', 'Person', 'nr'), entity('company', 'Company', 'name'), value('nick', 'Nickname')],
  factTypes: [
    fact('works', ['person', 'company'], '{0} works for {1}'),
    fact('nickname', ['person', 'nick'], '{0} is called {1}'),
  ],
  constraints: [
    unique('uc1', [role('works', 0)]), mandatory('mc1', [role('works', 0)]),
    unique('uc2', [role('nickname', 0)]),
  ],
  shapes: {
    person: { x: 40, y: 100 },
    company: { x: 320, y: 20 },
    nick: { x: 320, y: 180 },
    works: { x: 210, y: 28, orientation: 'horizontal' },
    nickname: { x: 210, y: 188, orientation: 'horizontal' },
  },
}));

figure('disjunctive-mandatory', defineModel({
  name: 'Inclusive-or: at least one of the two',
  objectTypes: [entity('academic', 'Academic', 'nr'), entity('date', 'Date', 'mdy')],
  factTypes: [
    fact('tenured', ['academic'], '{0} is tenured'),
    fact('contract', ['academic', 'date'], '{0} is contracted till {1}'),
  ],
  constraints: [
    unique('uc1', [role('tenured', 0)]),
    unique('uc2', [role('contract', 0)]),
    mandatory('mc', [role('tenured', 0), role('contract', 0)]),
  ],
  shapes: {
    academic: { x: 40, y: 100 },
    date: { x: 340, y: 170 },
    tenured: { x: 230, y: 40, orientation: 'horizontal' },
    contract: { x: 220, y: 178, orientation: 'horizontal' },
  },
}));

/* ------------------------------------------------------- 8. other constraints */

figure('ring-constraint', defineModel({
  name: 'A ring constraint',
  objectTypes: [entity('person', 'Person', 'nr')],
  factTypes: [fact('manages', ['person', 'person'], '{0} manages {1}')],
  constraints: [
    unique('uc', [role('manages', 1)]),
    { id: 'rc', kind: 'ring', roles: [role('manages', 0), role('manages', 1)], types: ['irreflexive', 'acyclic'] },
  ],
  shapes: {
    person: { x: 60, y: 140 },
    manages: { x: 250, y: 148, orientation: 'horizontal' },
    rc: { x: 276, y: 60 },
  },
}));

figure('subset-constraint', defineModel({
  name: 'A subset constraint',
  objectTypes: [entity('person', 'Person', 'nr'), entity('car', 'Car', 'vin'), entity('licence', 'Licence', 'nr')],
  factTypes: [
    fact('drives', ['person', 'car'], '{0} drives {1}'),
    fact('holds', ['person', 'licence'], '{0} holds {1}'),
  ],
  constraints: [
    unique('uc1', [role('drives', 0), role('drives', 1)]),
    unique('uc2', [role('holds', 0)]),
    { id: 'sc', kind: 'subset', roleSequences: [[role('drives', 0)], [role('holds', 0)]] },
  ],
  shapes: {
    person: { x: 40, y: 110 },
    car: { x: 330, y: 20 },
    licence: { x: 330, y: 200 },
    drives: { x: 220, y: 28, orientation: 'horizontal' },
    holds: { x: 220, y: 208, orientation: 'horizontal' },
    sc: { x: 250, y: 130 },
  },
}));

/* ---------------------------------------------------- 9. composite reference */

figure('composite-reference', defineModel({
  name: 'A composite reference scheme',
  objectTypes: [
    entity('room', 'Room'),
    entity('building', 'Building', 'nr'),
    value('roomnr', 'RoomNr'),
  ],
  factTypes: [
    fact('isin', ['room', 'building'], '{0} is in {1}'),
    fact('hasnr', ['room', 'roomnr'], '{0} has {1}'),
  ],
  constraints: [
    unique('uc1', [role('isin', 0)]), mandatory('mc1', [role('isin', 0)]),
    unique('uc2', [role('hasnr', 0)]), mandatory('mc2', [role('hasnr', 0)]),
    unique('euc', [role('isin', 1), role('hasnr', 1)], { isPreferredIdentifier: true }),
  ],
  shapes: {
    room: { x: 40, y: 110 },
    building: { x: 330, y: 20 },
    roomnr: { x: 330, y: 200 },
    isin: { x: 200, y: 28, orientation: 'horizontal' },
    hasnr: { x: 200, y: 208, orientation: 'horizontal' },
    euc: { x: 300, y: 120 },
  },
}));

/* --------------------------------------------------------------- 10. subtypes */

figure('subtypes', defineModel({
  name: 'Subtyping',
  objectTypes: [
    entity('person', 'Person', 'nr'),
    entity('student', 'Student'),
    entity('subject', 'Subject', 'code'),
  ],
  subtypeRelations: [{ id: 'st', subtypeId: 'student', supertypeId: 'person', isPreferredIdentificationPath: true }],
  factTypes: [fact('enrolled', ['student', 'subject'], '{0} is enrolled in {1}')],
  constraints: [unique('uc', [role('enrolled', 0), role('enrolled', 1)])],
  shapes: {
    person: { x: 60, y: 30 },
    student: { x: 60, y: 170 },
    subject: { x: 330, y: 170 },
    enrolled: { x: 220, y: 178, orientation: 'horizontal' },
  },
}));

/* --------------------------------------------------------- 11. objectification */

figure('objectification', defineModel({
  name: 'Objectification (nesting)',
  objectTypes: [
    entity('academic', 'Academic', 'nr'),
    entity('subject', 'Subject', 'code'),
    entity('teaching', 'Teaching', undefined, { objectifiedFactTypeId: 'teaches', isIndependent: true }),
    entity('rating', 'Rating', 'nr'),
  ],
  factTypes: [
    fact('teaches', ['academic', 'subject'], '{0} teaches {1}'),
    fact('gets', ['teaching', 'rating'], '{0} gets {1}'),
  ],
  constraints: [
    unique('uc1', [role('teaches', 0), role('teaches', 1)]),
    unique('uc2', [role('gets', 0)]),
  ],
  shapes: {
    academic: { x: 40, y: 150 },
    subject: { x: 350, y: 150 },
    rating: { x: 350, y: 20 },
    teaches: { x: 220, y: 158, orientation: 'horizontal' },
    gets: { x: 262, y: 28, orientation: 'horizontal' },
  },
}));



/* --------------------------------------- 12. the worked CSDP example, in stages */

const staffObjects = [
  entity('academic', 'Academic', 'empNr', { dataType: 'integer' }),
  value('empname', 'EmpName'),
  entity('dept', 'Dept', 'name'),
  entity('room', 'Room', 'nr'),
  entity('rank', 'Rank', 'code'),
  entity('date', 'Date', 'mdy', { dataType: 'date' }),
];
const staffFacts = [
  fact('named', ['academic', 'empname'], '{0} has {1}'),
  fact('works', ['academic', 'dept'], '{0} works for {1}'),
  fact('occupies', ['academic', 'room'], '{0} occupies {1}'),
  fact('hasrank', ['academic', 'rank'], '{0} has {1}'),
  fact('tenured', ['academic'], '{0} is tenured'),
  fact('contract', ['academic', 'date'], '{0} is contracted till {1}'),
];
const staffShapes = {
  academic: { x: 40, y: 210 },
  empname: { x: 430, y: 20 },
  dept: { x: 430, y: 90 },
  room: { x: 430, y: 160 },
  rank: { x: 430, y: 230 },
  date: { x: 430, y: 370 },
  named: { x: 280, y: 28, orientation: 'horizontal' },
  works: { x: 280, y: 98, orientation: 'horizontal' },
  occupies: { x: 280, y: 168, orientation: 'horizontal' },
  hasrank: { x: 280, y: 238, orientation: 'horizontal' },
  tenured: { x: 280, y: 308, orientation: 'horizontal' },
  contract: { x: 280, y: 378, orientation: 'horizontal' },
  excl: { x: 214, y: 348 },
};

// Step 2: the fact types are drawn, but nothing has been constrained yet.
figure('csdp-draft', defineModel({
  name: 'CSDP step 2 — draft fact types',
  objectTypes: staffObjects,
  factTypes: staffFacts,
  shapes: staffShapes,
}));

// Step 7: the same schema with every constraint in place.
figure('csdp-final', defineModel({
  name: 'CSDP step 7 — the finished schema',
  objectTypes: staffObjects,
  factTypes: staffFacts,
  shapes: staffShapes,
  constraints: [
    unique('uc1', [role('named', 0)]), unique('uc1b', [role('named', 1)]), mandatory('mc1', [role('named', 0)]),
    unique('uc2', [role('works', 0)]), mandatory('mc2', [role('works', 0)]),
    unique('uc3', [role('occupies', 0)]),
    unique('uc4', [role('hasrank', 0)]), mandatory('mc4', [role('hasrank', 0)]),
    unique('uc5', [role('tenured', 0)]),
    unique('uc6', [role('contract', 0)]),
    mandatory('mc-or', [role('tenured', 0), role('contract', 0)]),
    { id: 'excl', kind: 'exclusion', roleSequences: [[role('tenured', 0)], [role('contract', 0)]] },
    { id: 'vc', kind: 'value', objectTypeId: 'rank', ranges: [{ value: 'P' }, { value: 'SL' }, { value: 'L' }] },
  ],
}));

console.log(`${figures.length} figures written:`);
for (const slug of figures) console.log(`  docs/assets/book/${slug}.svg`);
