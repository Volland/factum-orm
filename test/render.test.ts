import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installDomShim, countByClass, textsOf, StubNode } from './domShim.js';
import { renderDiagram, diagramBounds } from '../src/webview/render.js';
import { sampleModel } from '../src/model/sample.js';
import { autoLayout } from '../src/webview/autolayout.js';
import { objectTypeRect, factTypeRect, roleRect, borderPoint } from '../src/webview/geometry.js';

// The renderer only touches `document` when it runs, so the shim can be
// installed after the imports.
installDomShim();

function draw(model = sampleModel()): StubNode {
  return renderDiagram(model, {
    selection: new Set(),
    selectedRoles: new Set(),
    showGrid: false,
    gridSize: 10,
    problems: new Map(),
  }) as unknown as StubNode;
}

test('every role, connector and object type is drawn', () => {
  const model = sampleModel();
  const root = draw(model);
  const roles = model.factTypes.reduce((sum, ft) => sum + ft.roles.length, 0);
  assert.equal(countByClass(root, 'role-box'), roles);
  assert.equal(countByClass(root, 'role-connector'), roles);
  assert.equal(countByClass(root, 'ot-box'), model.objectTypes.length);
});

test('mandatory dots, uniqueness bars and subtype arrows are drawn', () => {
  const root = draw();
  assert.equal(countByClass(root, 'mandatory-dot'), 2);
  assert.equal(countByClass(root, 'uniqueness-bar'), 3);
  assert.equal(countByClass(root, 'subtype-arrow'), 1);
});

test('preferred identifiers draw a double bar', () => {
  const model = sampleModel();
  const uc = model.constraints.find((c) => c.id === 'uc_works')!;
  if (uc.kind === 'uniqueness') uc.isPreferredIdentifier = true;
  assert.equal(countByClass(draw(model), 'uniqueness-bar'), 4);
});

test('value constraints and reference modes appear as text', () => {
  const texts = textsOf(draw());
  assert.ok(texts.includes("{'M', 'F'}"), texts.join(' | '));
  assert.ok(texts.includes('(.nr)'), texts.join(' | '));
  assert.ok(texts.includes('works for'), texts.join(' | '));
});

test('an objectified fact type is drawn as a frame around the fact type', () => {
  const model = sampleModel();
  model.objectTypes.push({
    id: 'ot_employment',
    name: 'Employment',
    kind: 'entity',
    objectifiedFactTypeId: 'ft_works',
  });
  const root = draw(model);
  // The frame *is* the object type: it must not also get a box of its own.
  assert.equal(countByClass(root, 'objectified'), 1);
  assert.equal(countByClass(root, 'ot-box'), model.objectTypes.length);
  assert.equal(
    countByClass(root, 'entity-type'),
    model.objectTypes.filter((o) => o.kind === 'entity' && !o.objectifiedFactTypeId).length,
  );
  assert.ok(textsOf(root).includes('"Employment"'));
});

test('an objectified object type takes the bounds of the fact type it frames', () => {
  const model = sampleModel();
  const objectifier = {
    id: 'ot_employment',
    name: 'Employment',
    kind: 'entity' as const,
    objectifiedFactTypeId: 'ft_works',
  };
  model.objectTypes.push(objectifier);
  const factType = model.factTypes.find((f) => f.id === 'ft_works')!;
  const inner = factTypeRect(model, factType);
  const frame = objectTypeRect(model, objectifier);
  // The frame encloses the roles, so connectors stop on the frame's border.
  assert.ok(frame.x < inner.x && frame.y < inner.y, JSON.stringify({ frame, inner }));
  assert.ok(frame.x + frame.w > inner.x + inner.w);
  assert.ok(frame.y + frame.h > inner.y + inner.h);
});

test('external uniqueness constraints get a circle with links to each role', () => {
  const model = sampleModel();
  model.constraints.push({
    id: 'uc_external',
    kind: 'uniqueness',
    roles: ['r_works_company', 'r_skill_skill'],
  });
  const root = draw(model);
  assert.equal(countByClass(root, 'constraint-circle'), 1);
  assert.equal(countByClass(root, 'constraint-link'), 2);
});

test('unattached roles are marked so the modeler can see them', () => {
  const model = sampleModel();
  model.factTypes[0].roles[1].objectTypeId = null;
  const root = draw(model);
  assert.equal(countByClass(root, 'unattached'), 1);
  assert.equal(countByClass(root, 'role-connector'), 5);
});

test('diagram bounds cover every shape', () => {
  const model = sampleModel();
  const bounds = diagramBounds(model);
  for (const ot of model.objectTypes) {
    const rect = objectTypeRect(model, ot);
    assert.ok(rect.x >= bounds.x && rect.x + rect.w <= bounds.x + bounds.w, ot.name);
    assert.ok(rect.y >= bounds.y && rect.y + rect.h <= bounds.y + bounds.h, ot.name);
  }
});

test('connectors stop on the border of the shapes they join', () => {
  const model = sampleModel();
  const person = model.objectTypes.find((o) => o.id === 'ot_person')!;
  const rect = objectTypeRect(model, person);
  const role = roleRect(model, model.factTypes[0], 0);
  const point = borderPoint(rect, { x: role.x, y: role.y });
  const onEdge =
    Math.abs(point.x - rect.x) < 0.01 ||
    Math.abs(point.x - (rect.x + rect.w)) < 0.01 ||
    Math.abs(point.y - rect.y) < 0.01 ||
    Math.abs(point.y - (rect.y + rect.h)) < 0.01;
  assert.ok(onEdge, JSON.stringify(point));
});

test('auto-layout places every shape at positive coordinates and is deterministic', () => {
  const first = autoLayout(sampleModel());
  const second = autoLayout(sampleModel());
  assert.deepEqual(first.diagram.shapes, second.diagram.shapes);
  for (const ot of first.objectTypes) {
    const shape = first.diagram.shapes[ot.id];
    assert.ok(shape, ot.name);
    assert.ok(shape.x > 0 && shape.y > 0, `${ot.name} at ${shape.x},${shape.y}`);
  }
  for (const ft of first.factTypes) {
    assert.ok(first.diagram.shapes[ft.id], ft.id);
  }
});

test('auto-layout keeps object types from overlapping', () => {
  const model = autoLayout(sampleModel());
  const rects = model.objectTypes.map((ot) => objectTypeRect(model, ot));
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i];
      const b = rects[j];
      const overlap = !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
      assert.ok(!overlap, `${model.objectTypes[i].name} overlaps ${model.objectTypes[j].name}`);
    }
  }
});
