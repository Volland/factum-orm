import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { installDomShim, countByClass, StubNode } from './domShim.js';
import { deleteElement, parseModel, serializeModel } from '../src/model/model.js';
import {
  addPage,
  deletePage,
  isOnPage,
  movePage,
  pageCount,
  pageName,
  pageShapes,
  pageView,
  pagesOf,
  placeOnPage,
  removeFromPage,
} from '../src/model/pages.js';
import { sampleModel } from '../src/model/sample.js';
import { OrmModel } from '../src/model/types.js';
import { renderDiagram } from '../src/webview/render.js';

installDomShim();

const root = join(__dirname, '..', '..');
const schema = JSON.parse(readFileSync(join(root, 'schema/orm-model-2.schema.json'), 'utf8'));

/**
 * The sample model on two pages: employment on "Staff", skills on "Skills".
 * Person is on both; GenderCode, its fact type and Manager are on no page.
 */
function twoPages(): OrmModel {
  const model = sampleModel();
  model.diagram = {
    name: 'Staff',
    shapes: {
      ot_person: { x: 40, y: 40 },
      ot_company: { x: 300, y: 40 },
      ft_works: { x: 160, y: 50 },
    },
    pages: [
      {
        name: 'Skills',
        shapes: {
          ot_person: { x: 500, y: 500 },
          ot_skill: { x: 800, y: 500 },
          ft_skill: { x: 650, y: 510 },
        },
      },
    ],
  };
  return model;
}

function ids(model: OrmModel): string[] {
  return [...model.objectTypes.map((o) => o.id), ...model.factTypes.map((f) => f.id)].sort();
}

// @lat: [[tests#Diagram pages#A single-page file has no pages key]]
test('a single-page file has no pages key', () => {
  const text = serializeModel(sampleModel());
  assert.equal(serializeModel(parseModel(text)), text);
  assert.ok(!('pages' in JSON.parse(text).diagram));
});

// @lat: [[tests#Diagram pages#Pages survive a round trip]]
test('pages survive a round trip with their names, shapes and extensions', () => {
  const model = twoPages();
  model.diagram.pages![0]['x-colour'] = 'teal';
  model.diagram['x-origin'] = 'test';
  const back = parseModel(serializeModel(model));
  assert.deepEqual(back.diagram, model.diagram);
});

// @lat: [[tests#Diagram pages#The schema accepts pages]]
test('the schema accepts pages and rejects an unknown key on one', () => {
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  const doc = JSON.parse(serializeModel(twoPages())) as { diagram: { pages: Record<string, unknown>[] } };
  assert.ok(validate(doc), JSON.stringify(validate.errors));
  doc.diagram.pages[0].shape = {};
  assert.ok(!validate(doc));
});

// @lat: [[tests#Diagram pages#An element can be on several pages]]
test('an element is drawn on every page that holds a shape for it', () => {
  const model = twoPages();
  assert.deepEqual(pagesOf(model, 'ot_person'), [0, 1]);
  assert.deepEqual(pagesOf(model, 'ot_company'), [0]);
  assert.deepEqual(pagesOf(model, 'ot_skill'), [1]);
  assert.deepEqual(pageView(model, 1).diagram.shapes.ot_person, { x: 500, y: 500 });
});

// @lat: [[tests#Diagram pages#An unplaced element falls on the first page]]
test('an element with no shape on any page is on the first page only', () => {
  const model = twoPages();
  assert.ok(isOnPage(model, 0, 'ot_gender'));
  assert.ok(!isOnPage(model, 1, 'ot_gender'));
  assert.deepEqual(ids(pageView(model, 0)), ['ft_gender', 'ft_works', 'ot_company', 'ot_gender', 'ot_manager', 'ot_person']);
  assert.deepEqual(ids(pageView(model, 1)), ['ft_skill', 'ot_person', 'ot_skill']);
});

// @lat: [[tests#Diagram pages#A hidden shape keeps an element off the diagram]]
test('a hidden shape on the first page keeps an element off every page', () => {
  const model = twoPages();
  pageShapes(model, 0).ot_gender = { x: 0, y: 0, hidden: true };
  assert.deepEqual(pagesOf(model, 'ot_gender'), []);
});

// @lat: [[tests#Diagram pages#A page view draws only what is on the page]]
test('a page view draws only its elements, and links whose ends are both on it', () => {
  const model = twoPages();
  const draw = (index: number): StubNode =>
    renderDiagram(pageView(model, index), {
      selection: new Set(),
      selectedRoles: new Set(),
      showGrid: false,
      gridSize: 10,
      problems: new Map(),
    }) as unknown as StubNode;
  // Person, Company, GenderCode and Manager — the last two unplaced.
  assert.equal(countByClass(draw(0), 'ot-box'), 4);
  assert.equal(countByClass(draw(0), 'subtype-arrow'), 1);
  assert.equal(countByClass(draw(1), 'ot-box'), 2);
  assert.equal(countByClass(draw(1), 'subtype-arrow'), 0);
  assert.equal(countByClass(draw(1), 'role-box'), 2);
});

// @lat: [[tests#Diagram pages#An objectifying entity type follows its fact type]]
test('an objectifying entity type is drawn wherever its fact type is', () => {
  const model = twoPages();
  model.objectTypes.push({ id: 'ot_skilled', name: 'Skilled', kind: 'entity', objectifiedFactTypeId: 'ft_skill' });
  assert.deepEqual(pagesOf(model, 'ot_skilled'), [1]);
  removeFromPage(model, 1, 'ot_skilled');
  assert.ok(!pageShapes(model, 1).ft_skill, 'removing the frame removes its fact type');
});

// @lat: [[tests#Diagram pages#Adding and moving pages]]
test('pages are added at the end and moved by position', () => {
  const model = twoPages();
  const index = addPage(model);
  assert.equal(index, 2);
  assert.equal(pageName(model, 2), 'Page 3');
  assert.deepEqual(pageShapes(model, 2), {});
  movePage(model, 1, 0);
  assert.equal(model.diagram.name, 'Skills');
  assert.deepEqual(model.diagram.pages!.map((p) => p.name), ['Staff', 'Page 3']);
  assert.deepEqual(pagesOf(model, 'ot_company'), [1]);
});

// @lat: [[tests#Diagram pages#Deleting a page keeps its elements in the model]]
test('deleting a page keeps what was only on it in the model, on no page', () => {
  const model = twoPages();
  deletePage(model, 1);
  assert.equal(pageCount(model), 1);
  assert.ok(model.objectTypes.some((o) => o.id === 'ot_skill'));
  assert.deepEqual(pagesOf(model, 'ot_skill'), []);
  assert.deepEqual(pagesOf(model, 'ot_person'), [0], 'a shape on a remaining page is left alone');
  deletePage(model, 0);
  assert.equal(pageCount(model), 1, 'the last page cannot be deleted');
});

// @lat: [[tests#Diagram pages#Deleting the first page promotes the next]]
test('deleting the first page makes the next one the diagram', () => {
  const model = twoPages();
  deletePage(model, 0);
  assert.equal(model.diagram.name, 'Skills');
  assert.equal(model.diagram.pages, undefined);
  assert.deepEqual(pagesOf(model, 'ot_company'), []);
});

// @lat: [[tests#Diagram pages#Removing the last placement keeps the element off the diagram]]
test('removing an element from its only page keeps it in the model, drawn nowhere', () => {
  const model = twoPages();
  removeFromPage(model, 1, 'ot_skill');
  assert.deepEqual(pagesOf(model, 'ot_skill'), []);
  assert.equal(pageShapes(model, 0).ot_skill?.hidden, true);
  placeOnPage(model, 1, 'ot_skill');
  assert.deepEqual(pagesOf(model, 'ot_skill'), [1]);
  assert.deepEqual(pageShapes(model, 1).ot_skill, { x: 800, y: 500 }, 'placed back where it was');
  assert.equal(pageShapes(model, 0).ot_skill, undefined, 'the off-diagram marker is gone');
});

// @lat: [[tests#Diagram pages#Removing one of several placements]]
test('removing an element from one of its pages leaves the others', () => {
  const model = twoPages();
  removeFromPage(model, 0, 'ot_person');
  assert.deepEqual(pagesOf(model, 'ot_person'), [1]);
  assert.equal(pageShapes(model, 0).ot_person, undefined);
});

// @lat: [[tests#Diagram pages#Deleting an element removes it from every page]]
test('deleting an element removes its shape from every page', () => {
  const model = twoPages();
  deleteElement(model, 'ot_person');
  assert.equal(pageShapes(model, 0).ot_person, undefined);
  assert.equal(pageShapes(model, 1).ot_person, undefined);
});
